const { app, BrowserWindow, Tray, dialog, ipcMain, Menu, nativeImage, shell, session: electronSession } = require('electron');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

let autoUpdater = null;
let updaterLoadError = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch (err) {
  updaterLoadError = err instanceof Error ? err.message : String(err);
}

const isDev = process.argv.includes('--dev');
const isSmoke = process.argv.includes('--smoke');
const repoRoot = path.resolve(__dirname, '..');
const unpackedRepoRoot = app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked') : repoRoot;
const startupLogs = [];
const MAX_LOG_LINES = 160;
const WINDOW_STATE_FILE = 'window-state.json';
const LOG_FILE = 'desktop.log';
const APP_USER_MODEL_ID = 'works.pi-agent.desktop';
const RAW_UPDATE_FEED_URL = (process.env.PI_DESKTOP_UPDATE_URL ?? '').trim();
const UPDATE_FEED = normalizeUpdateFeedUrl(RAW_UPDATE_FEED_URL);
const UPDATE_FEED_URL = UPDATE_FEED.url;
const UPDATE_FEED_ERROR = UPDATE_FEED.error;
const UPDATE_CHANNEL = (process.env.PI_DESKTOP_UPDATE_CHANNEL ?? 'latest').trim() || 'latest';
const AUTO_UPDATE_DISABLED = process.env.PI_DESKTOP_DISABLE_AUTO_UPDATE === '1';

let mainWindow = null;
let serverChild = null;
let serverUrl = null;
let serverAuthToken = null;
let startupError = null;
let smokeChecks = null;
let tray = null;
let isQuitting = false;
let saveWindowTimer = null;
const markdownWindows = new Set();
const standaloneTabGroups = new Map();
let standaloneGroupCounter = 0;
let lastStandaloneGroupId = null;
const updateStatus = createInitialUpdateStatus();
let updaterConfigured = false;
let updateCheckInFlight = false;

app.setName('Pi Agent Desktop');
if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID);
}

if (!isSmoke) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    process.exit(0);
  }

  app.on('second-instance', showMainWindow);
}

function pushLog(source, chunk) {
  const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;
    const entry = `[${source}] ${trimmed}`;
    startupLogs.push(entry);
    appendLogLine(entry);
  }
  while (startupLogs.length > MAX_LOG_LINES) startupLogs.shift();
}

function appendLogLine(line) {
  if (!app.isReady()) return;
  try {
    fs.mkdirSync(logDirPath(), { recursive: true });
    fs.appendFileSync(logFilePath(), `${new Date().toISOString()} ${line}\n`, 'utf8');
  } catch {
    // Logging must never block app startup.
  }
}

function getStartupInfo() {
  return {
    mode: isDev ? 'development' : 'production',
    serverUrl,
    startupError,
    logs: [...startupLogs],
    dataDir: dataDirPath(),
    logsDir: logDirPath(),
    logFile: logFilePath(),
    appVersion: app.getVersion(),
    platform: process.platform,
    authEnabled: Boolean(serverAuthToken),
    smokeChecks,
    updates: getUpdateStatus(),
  };
}

function dataDirPath() {
  return path.join(app.getPath('userData'), 'data');
}

function logDirPath() {
  return path.join(app.getPath('userData'), 'logs');
}

function logFilePath() {
  return path.join(logDirPath(), LOG_FILE);
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function reserveLocalPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function waitForHttpOk(url, timeoutMs) {
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 500) {
          resolve();
          return;
        }
        retry();
      });

      req.on('error', retry);
      req.setTimeout(1000, () => {
        req.destroy();
        retry();
      });
    };

    const retry = () => {
      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error(`Timed out waiting for ${url}`));
        return;
      }
      setTimeout(tryOnce, 200);
    };

    tryOnce();
  });
}

function normalizeUpdateFeedUrl(rawUrl) {
  if (!rawUrl) return { url: '', error: null };

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { url: '', error: `Invalid update feed URL: ${rawUrl}` };
  }

  const allowInsecure = process.env.PI_DESKTOP_ALLOW_INSECURE_UPDATE_FEED === '1';
  const isLocalHttp = parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname);
  const isAllowed =
    parsed.protocol === 'https:' ||
    (isLocalHttp && (isDev || isSmoke || allowInsecure)) ||
    (allowInsecure && parsed.protocol === 'file:');

  if (!isAllowed) {
    return {
      url: '',
      error: 'Auto update feed must use HTTPS. Only loopback HTTP in dev/smoke or explicitly allowed file/http feeds are accepted.',
    };
  }

  return { url: parsed.toString().replace(/\/+$/g, ''), error: null };
}

function isLoopbackHostname(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

function requestJson(url, headers = {}, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`GET ${url} failed with ${res.statusCode}: ${body.slice(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Timed out fetching ${url}`));
    });
  });
}

function setupContentSecurityPolicy() {
  if (isDev || isSmoke || !app.isPackaged) return;

  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: file: http: https:",
    "font-src 'self' data:",
    "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:* http://localhost:* ws://localhost:*",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');

  electronSession.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...(details.responseHeaders ?? {}),
        'Content-Security-Policy': [csp],
      },
    });
  });

  pushLog('security', 'Production Content-Security-Policy is enabled.');
}

async function startServer() {
  startupError = null;
  serverUrl = null;
  serverAuthToken = randomBytes(32).toString('base64url');
  const port = await reserveLocalPort();
  fs.mkdirSync(dataDirPath(), { recursive: true });
  fs.mkdirSync(logDirPath(), { recursive: true });
  const env = {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    PI_DESKTOP_DATA_DIR: dataDirPath(),
    PI_DESKTOP_SHELL: 'electron',
    PI_DESKTOP_AUTH_TOKEN: serverAuthToken,
  };

  const command = resolveServerCommand();
  pushLog('desktop', `Starting Pi server: ${command.display} on 127.0.0.1:${port}`);

  let child;
  try {
    child = spawn(command.bin, command.args, {
      cwd: command.cwd,
      env: { ...env, ...(command.env ?? {}) },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    serverChild = child;
  } catch (err) {
    startupError = err instanceof Error ? err.message : String(err);
    pushLog('desktop', `Unable to spawn Pi server: ${startupError}`);
    emitServerStatus();
    return getStartupInfo();
  }

  child.stdout?.on('data', (chunk) => pushLog('server', chunk));
  child.stderr?.on('data', (chunk) => pushLog('server', chunk));
  child.on('error', (err) => {
    if (serverChild !== child) return;
    startupError = err.message;
    serverUrl = null;
    pushLog('desktop', `Server process error: ${err.message}`);
    emitServerStatus();
  });
  child.on('exit', (code, signal) => {
    if (serverChild !== child) {
      pushLog('desktop', `Previous server exited with code=${code} signal=${signal ?? 'none'}`);
      return;
    }

    serverChild = null;
    serverUrl = null;
    if (!isQuitting && code !== 0 && code !== null) {
      startupError = `Pi server exited with code ${code}${signal ? `, signal ${signal}` : ''}.`;
    } else if (!isQuitting && !startupError) {
      startupError = `Pi server exited${signal ? ` with signal ${signal}` : ''}.`;
    }
    pushLog('desktop', `Server exited with code=${code} signal=${signal ?? 'none'}`);
    emitServerStatus();
  });

  const healthUrl = `http://127.0.0.1:${port}/health`;
  try {
    await waitForHttpOk(healthUrl, 12000);
    if (serverChild === child) {
      serverUrl = `http://127.0.0.1:${port}`;
      pushLog('desktop', `Pi server ready at ${serverUrl}`);
    }
  } catch (err) {
    stopServer();
    startupError = `${err instanceof Error ? err.message : String(err)}\n\n${startupLogs.slice(-40).join('\n')}`;
    pushLog('desktop', startupError);
  }

  emitServerStatus();
  return getStartupInfo();
}

function resolveServerCommand() {
  const serverRoot = resolveBundledServerRoot();
  const builtServer = path.join(serverRoot, 'pi-server', 'dist', 'server.cjs');
  if (!isDev && fs.existsSync(builtServer)) {
    const runtime = resolveServerNodeRuntime();
    return {
      bin: runtime.bin,
      args: [...runtime.args, builtServer],
      cwd: serverRoot,
      env: runtime.env,
      display: `${runtime.display} ${displayPath(builtServer, serverRoot)}`,
    };
  }

  const tsxCli = path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  if (fs.existsSync(tsxCli)) {
    return {
      bin: resolveNodeBinary(),
      args: [tsxCli, 'index.ts'],
      cwd: path.join(repoRoot, 'pi-server'),
      display: 'node node_modules/tsx/dist/cli.mjs pi-server/index.ts',
    };
  }

  const tsxBin = path.join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');
  if (fs.existsSync(tsxBin)) {
    return {
      bin: tsxBin,
      args: ['index.ts'],
      cwd: path.join(repoRoot, 'pi-server'),
      display: 'tsx pi-server/index.ts',
    };
  }

  return {
    bin: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args: ['--workspace', 'pi-server', 'run', 'start'],
    cwd: repoRoot,
    display: 'npm --workspace pi-server run start',
  };
}

function resolveBundledServerRoot() {
  const candidates = app.isPackaged ? [unpackedRepoRoot, repoRoot] : [repoRoot];
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'pi-server', 'dist', 'server.cjs'))) {
      return candidate;
    }
  }
  return candidates[0];
}

function displayPath(targetPath, rootPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative && !relative.startsWith('..') ? relative : targetPath;
}

function resolveNodeBinary() {
  if (process.env.PI_DESKTOP_NODE) return process.env.PI_DESKTOP_NODE;
  return process.platform === 'win32' ? 'node.exe' : 'node';
}

function resolveServerNodeRuntime() {
  if (process.env.PI_DESKTOP_NODE) {
    return {
      bin: process.env.PI_DESKTOP_NODE,
      args: [],
      env: {},
      display: 'node',
    };
  }

  if (process.versions.electron) {
    return {
      bin: process.execPath,
      args: [],
      env: { ELECTRON_RUN_AS_NODE: '1' },
      display: 'electron-as-node',
    };
  }

  return {
    bin: resolveNodeBinary(),
    args: [],
    env: {},
    display: 'node',
  };
}

function stopServer() {
  const child = serverChild;
  serverChild = null;
  if (!child || child.killed) return;
  try {
    child.kill();
  } catch (err) {
    pushLog('desktop', `Failed to kill server: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function restartServer() {
  stopServer();
  smokeChecks = null;
  return startServer();
}

async function runSmokeChecks() {
  if (!serverUrl || !serverAuthToken) {
    throw new Error('Pi server smoke checks require a ready authenticated server.');
  }

  const diagnostics = await requestJson(`${serverUrl}/api/diagnostics`, {
    Authorization: `Bearer ${serverAuthToken}`,
  });
  if (!diagnostics?.ok || diagnostics?.sdk?.available !== true) {
    throw new Error(`Pi server diagnostics failed: ${JSON.stringify(diagnostics?.sdk ?? diagnostics).slice(0, 300)}`);
  }

  return {
    diagnostics: true,
    sdkAvailable: diagnostics.sdk.available,
    authEnabled: diagnostics.security?.authEnabled === true,
    cors: diagnostics.security?.cors ?? 'unknown',
  };
}

function createInitialUpdateStatus() {
  const supported = isUpdateSupported();
  return {
    supported,
    enabled: supported && !AUTO_UPDATE_DISABLED,
    state: supported ? 'idle' : 'unsupported',
    currentVersion: app.getVersion(),
    version: null,
    releaseName: null,
    releaseDate: null,
    releaseNotes: null,
    progress: null,
    error: supported ? null : getUpdateUnsupportedReason(),
    feedUrl: UPDATE_FEED_URL || null,
    channel: UPDATE_CHANNEL,
    lastCheckedAt: null,
    downloadedFile: null,
    source: null,
  };
}

function isUpdateSupported() {
  return Boolean(autoUpdater) && app.isPackaged && !isSmoke && !AUTO_UPDATE_DISABLED && !UPDATE_FEED_ERROR;
}

function getUpdateUnsupportedReason() {
  if (AUTO_UPDATE_DISABLED) return 'Auto update is disabled by PI_DESKTOP_DISABLE_AUTO_UPDATE.';
  if (UPDATE_FEED_ERROR) return UPDATE_FEED_ERROR;
  if (!autoUpdater) return updaterLoadError || 'electron-updater is not available.';
  if (isSmoke) return 'Auto update is disabled during smoke checks.';
  if (!app.isPackaged) return 'Auto update is available in packaged builds only.';
  return null;
}

function getUpdateStatus() {
  return {
    ...updateStatus,
    supported: isUpdateSupported(),
    enabled: isUpdateSupported(),
    currentVersion: app.getVersion(),
    feedUrl: UPDATE_FEED_URL || updateStatus.feedUrl || null,
    channel: UPDATE_CHANNEL,
  };
}

function setUpdateStatus(patch) {
  Object.assign(updateStatus, patch, {
    supported: isUpdateSupported(),
    enabled: isUpdateSupported(),
    currentVersion: app.getVersion(),
    feedUrl: UPDATE_FEED_URL || updateStatus.feedUrl || null,
    channel: UPDATE_CHANNEL,
  });
  emitUpdateStatus();
  return getUpdateStatus();
}

function markUpdateUnsupported() {
  return setUpdateStatus({
    state: 'unsupported',
    error: getUpdateUnsupportedReason(),
    progress: null,
  });
}

function setupAutoUpdater() {
  if (updaterConfigured) return;
  updaterConfigured = true;

  if (!autoUpdater) {
    markUpdateUnsupported();
    pushLog('updater', `electron-updater unavailable: ${updaterLoadError || 'module not found'}`);
    return;
  }

  if (UPDATE_FEED_ERROR) {
    markUpdateUnsupported();
    pushLog('updater', UPDATE_FEED_ERROR);
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = process.env.PI_DESKTOP_UPDATE_PRERELEASE === '1';
  if (UPDATE_CHANNEL) {
    autoUpdater.channel = UPDATE_CHANNEL;
  }

  if (UPDATE_FEED_URL) {
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: UPDATE_FEED_URL,
      channel: UPDATE_CHANNEL,
    });
  }

  autoUpdater.on('checking-for-update', () => {
    pushLog('updater', 'Checking for updates');
    setUpdateStatus({
      state: 'checking',
      error: null,
      progress: null,
      lastCheckedAt: Date.now(),
      downloadedFile: null,
    });
  });

  autoUpdater.on('update-available', (info) => {
    pushLog('updater', `Update available: ${info?.version ?? 'unknown'}`);
    setUpdateStatus({
      state: 'available',
      error: null,
      progress: null,
      ...updateInfoPatch(info),
    });
  });

  autoUpdater.on('update-not-available', (info) => {
    pushLog('updater', `No update available: ${info?.version ?? app.getVersion()}`);
    setUpdateStatus({
      state: 'not-available',
      error: null,
      progress: null,
      ...updateInfoPatch(info),
    });
  });

  autoUpdater.on('download-progress', (progress) => {
    setUpdateStatus({
      state: 'downloading',
      error: null,
      progress: {
        percent: Number(progress?.percent ?? 0),
        transferred: Number(progress?.transferred ?? 0),
        total: Number(progress?.total ?? 0),
        bytesPerSecond: Number(progress?.bytesPerSecond ?? 0),
      },
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    pushLog('updater', `Update downloaded: ${info?.version ?? 'unknown'}`);
    setUpdateStatus({
      state: 'downloaded',
      error: null,
      progress: null,
      downloadedFile: info?.downloadedFile ?? null,
      ...updateInfoPatch(info),
    });
  });

  autoUpdater.on('error', (err) => {
    const message = err instanceof Error ? err.message : String(err);
    pushLog('updater', `Update error: ${message}`);
    setUpdateStatus({
      state: 'error',
      error: message,
      progress: null,
    });
  });

  if (!isUpdateSupported()) {
    markUpdateUnsupported();
  }
}

function updateInfoPatch(info) {
  return {
    version: info?.version ?? updateStatus.version ?? null,
    releaseName: info?.releaseName ?? null,
    releaseDate: info?.releaseDate ?? null,
    releaseNotes: normalizeReleaseNotes(info?.releaseNotes),
  };
}

function normalizeReleaseNotes(notes) {
  if (!notes) return null;
  if (typeof notes === 'string') return notes;
  if (Array.isArray(notes)) {
    return notes
      .map((item) => {
        if (typeof item === 'string') return item;
        if (!item || typeof item !== 'object') return '';
        const title = item.version ? `Version ${item.version}` : '';
        const note = item.note || item.notes || '';
        return [title, note].filter(Boolean).join('\n');
      })
      .filter(Boolean)
      .join('\n\n') || null;
  }
  return String(notes);
}

function emitUpdateStatus() {
  const status = getUpdateStatus();
  for (const targetWindow of BrowserWindow.getAllWindows()) {
    if (!targetWindow || targetWindow.isDestroyed()) continue;
    targetWindow.webContents.send('desktop:update-status', status);
  }
}

async function checkForUpdates(source = 'manual') {
  setupAutoUpdater();
  if (!isUpdateSupported()) return markUpdateUnsupported();
  if (updateCheckInFlight || updateStatus.state === 'checking' || updateStatus.state === 'downloading') {
    return getUpdateStatus();
  }

  updateCheckInFlight = true;
  setUpdateStatus({
    state: 'checking',
    error: null,
    progress: null,
    source,
    lastCheckedAt: Date.now(),
  });

  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setUpdateStatus({
      state: 'error',
      error: message,
      progress: null,
    });
  } finally {
    updateCheckInFlight = false;
  }

  return getUpdateStatus();
}

async function downloadUpdate() {
  setupAutoUpdater();
  if (!isUpdateSupported()) return markUpdateUnsupported();
  if (updateStatus.state === 'downloaded') return getUpdateStatus();
  if (updateStatus.state !== 'available') {
    throw new Error('No update is ready to download.');
  }

  setUpdateStatus({
    state: 'downloading',
    error: null,
    progress: {
      percent: 0,
      transferred: 0,
      total: 0,
      bytesPerSecond: 0,
    },
  });

  try {
    await autoUpdater.downloadUpdate();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setUpdateStatus({
      state: 'error',
      error: message,
      progress: null,
    });
    throw err;
  }

  return getUpdateStatus();
}

function installDownloadedUpdate() {
  setupAutoUpdater();
  if (!isUpdateSupported()) return markUpdateUnsupported();
  if (updateStatus.state !== 'downloaded') {
    throw new Error('No downloaded update is ready to install.');
  }

  setUpdateStatus({
    state: 'installing',
    error: null,
    progress: null,
  });

  setImmediate(() => {
    autoUpdater.quitAndInstall(false, true);
  });

  return getUpdateStatus();
}

function scheduleStartupUpdateCheck() {
  if (!isUpdateSupported()) return;
  const timer = setTimeout(() => {
    checkForUpdates('startup').catch((err) => {
      pushLog('updater', err instanceof Error ? err.message : String(err));
    });
  }, 15000);
  if (typeof timer.unref === 'function') timer.unref();
}

function emitServerStatus() {
  refreshTrayMenu();
  setupApplicationMenu();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('desktop:server-status', getStartupInfo());
}

function setupApplicationMenu() {
  if (isSmoke) return;

  const isMac = process.platform === 'darwin';
  if (!isMac) {
    Menu.setApplicationMenu(null);
    return;
  }

  const template = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: 'New Session', accelerator: 'CmdOrCtrl+N', click: () => sendMenuCommand('new-session') },
        { label: 'Open Project...', accelerator: 'CmdOrCtrl+O', click: () => sendMenuCommand('open-project') },
        { type: 'separator' },
        { label: 'Close Window', accelerator: 'CmdOrCtrl+W', click: () => mainWindow?.hide() },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B', click: () => sendMenuCommand('toggle-sidebar') },
        { label: 'Show Changes', accelerator: 'CmdOrCtrl+Shift+G', click: () => sendMenuCommand('show-changes') },
        { label: 'Show Files', accelerator: 'CmdOrCtrl+Shift+F', click: () => sendMenuCommand('show-files') },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Pi Server',
      submenu: [
        {
          label: 'Restart Local Server',
          accelerator: 'CmdOrCtrl+Alt+R',
          click: () => restartServer().catch((err) => pushLog('desktop', err instanceof Error ? err.message : String(err))),
        },
        { label: 'Show Diagnostics', accelerator: 'CmdOrCtrl+Shift+D', click: () => sendMenuCommand('show-diagnostics') },
        { type: 'separator' },
        { label: 'Open Data Directory', click: () => openDirectory(dataDirPath()) },
        { label: 'Open Logs Directory', click: () => openDirectory(logDirPath()) },
        { type: 'separator' },
        { label: serverUrl ? `Server: ${serverUrl}` : 'Server unavailable', enabled: false },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function windowFromEvent(event) {
  return BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
}

function getWindowState(targetWindow = mainWindow) {
  return {
    maximized: Boolean(targetWindow && !targetWindow.isDestroyed() && targetWindow.isMaximized()),
    focused: Boolean(targetWindow && !targetWindow.isDestroyed() && targetWindow.isFocused()),
  };
}

function emitWindowState(targetWindow = mainWindow) {
  if (!targetWindow || targetWindow.isDestroyed()) return;
  targetWindow.webContents.send('desktop:window-state', getWindowState(targetWindow));
}

function sendMenuCommand(command) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  showMainWindow();
  mainWindow.webContents.send('desktop:menu-command', command);
}

function hardenBrowserWindow(targetWindow) {
  targetWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: 'deny' };
  });

  targetWindow.webContents.on('will-navigate', (event, url) => {
    if (isAllowedRendererNavigation(url)) return;
    event.preventDefault();
    openExternalUrl(url);
  });
}

function openExternalUrl(rawUrl) {
  const url = safeExternalUrl(rawUrl);
  if (!url) {
    pushLog('security', `Blocked external URL: ${String(rawUrl).slice(0, 300)}`);
    return false;
  }

  shell.openExternal(url.toString()).catch((err) => {
    pushLog('security', `Failed to open external URL: ${err instanceof Error ? err.message : String(err)}`);
  });
  return true;
}

function safeExternalUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === 'https:' || url.protocol === 'mailto:') {
      return url;
    }
    if (url.protocol === 'http:' && isLoopbackHostname(url.hostname)) return url;
  } catch {
    // Fall through to blocked.
  }
  return null;
}

function isAllowedRendererNavigation(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === 'file:' || url.protocol === 'data:' || url.protocol === 'about:') return true;
    return isDev && (url.protocol === 'http:' || url.protocol === 'https:') && isLoopbackHostname(url.hostname);
  } catch {
    return false;
  }
}

function isTrustedRendererUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === 'file:') return true;
    return isDev && (url.protocol === 'http:' || url.protocol === 'https:') && isLoopbackHostname(url.hostname);
  } catch {
    return false;
  }
}

function requireTrustedIpc(event) {
  const senderUrl = event.senderFrame?.url || event.sender.getURL();
  if (!isTrustedRendererUrl(senderUrl)) {
    pushLog('security', `Blocked IPC from untrusted renderer: ${String(senderUrl).slice(0, 300)}`);
    throw new Error('Blocked IPC from untrusted renderer.');
  }
}

function setupRendererContextMenu(targetWindow) {
  targetWindow.webContents.on('context-menu', (event, params) => {
    const hasSelection = Boolean(params.selectionText && params.selectionText.trim());
    const template = [];

    if (params.isEditable) {
      template.push(
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'delete' },
        { type: 'separator' },
        { role: 'selectAll' }
      );
    } else if (hasSelection) {
      template.push(
        { label: 'Copy', role: 'copy', accelerator: 'CmdOrCtrl+C' },
        { type: 'separator' },
        { label: 'Select All', role: 'selectAll', accelerator: 'CmdOrCtrl+A' }
      );
    }

    if (template.length === 0) return;

    event.preventDefault();
    Menu.buildFromTemplate(template).popup({ window: targetWindow });
  });
}

async function openDirectory(targetPath) {
  try {
    fs.mkdirSync(targetPath, { recursive: true });
    const error = await shell.openPath(targetPath);
    if (error) pushLog('desktop', `Unable to open ${targetPath}: ${error}`);
    return error;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    pushLog('desktop', `Unable to open ${targetPath}: ${message}`);
    return message;
  }
}

function normalizeWorkspacePath(value) {
  return String(value ?? '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function resolveWorkspacePathInsideRoot(workDir, workspacePath) {
  const root = path.resolve(String(workDir ?? ''));
  if (!root || !fs.existsSync(root)) {
    throw new Error(`Workspace folder does not exist: ${root}`);
  }

  const normalized = normalizeWorkspacePath(workspacePath);
  const target = path.resolve(root, normalized || '.');
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error('Path escapes the current workspace.');
  }
  return target;
}

async function revealWorkspacePath(workDir, workspacePath) {
  try {
    const target = resolveWorkspacePathInsideRoot(workDir, workspacePath);
    if (!fs.existsSync(target)) {
      const parent = path.dirname(target);
      if (!fs.existsSync(parent)) {
        throw new Error(`Path does not exist: ${target}`);
      }
      shell.showItemInFolder(parent);
      return { ok: true, path: parent, missing: true };
    }

    shell.showItemInFolder(target);
    return { ok: true, path: target };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    pushLog('desktop', `Unable to reveal workspace path: ${message}`);
    return { ok: false, error: message };
  }
}

function sanitizeWorkspaceReference(input) {
  if (!input || typeof input !== 'object') return null;
  const sessionId = typeof input.sessionId === 'string' ? input.sessionId : '';
  const workspacePath = typeof input.path === 'string' ? input.path : '';
  if (!sessionId || !workspacePath) return null;

  const detail = {
    sessionId,
    path: workspacePath,
    name: typeof input.name === 'string' ? input.name : path.basename(workspacePath),
  };
  if (Number.isInteger(input.lineStart) && input.lineStart > 0) detail.lineStart = input.lineStart;
  if (Number.isInteger(input.lineEnd) && input.lineEnd > 0) detail.lineEnd = input.lineEnd;
  if (typeof input.excerpt === 'string') detail.excerpt = input.excerpt;
  if (input.sourceKind === 'file' || input.sourceKind === 'diff') detail.sourceKind = input.sourceKind;
  return detail;
}

async function createMainWindow() {
  const storedState = loadWindowState();
  mainWindow = new BrowserWindow({
    width: storedState?.width ?? 1280,
    height: storedState?.height ?? 820,
    x: storedState?.x,
    y: storedState?.y,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'Pi Agent Desktop',
    frame: process.platform === 'darwin',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    autoHideMenuBar: true,
    icon: appIconPath(),
    backgroundColor: '#111114',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (storedState?.maximized) {
    mainWindow.maximize();
  }

  applyWindowIcon(mainWindow);
  mainWindow.setAutoHideMenuBar(true);
  mainWindow.setMenuBarVisibility(false);
  mainWindow.on('close', (event) => {
    saveWindowState();
    if (isQuitting || isSmoke) return;
    event.preventDefault();
    mainWindow?.hide();
  });
  mainWindow.on('resize', scheduleWindowStateSave);
  mainWindow.on('move', scheduleWindowStateSave);
  mainWindow.on('maximize', () => {
    scheduleWindowStateSave();
    emitWindowState(mainWindow);
  });
  mainWindow.on('unmaximize', () => {
    scheduleWindowStateSave();
    emitWindowState(mainWindow);
  });
  mainWindow.on('focus', () => emitWindowState(mainWindow));
  mainWindow.on('blur', () => emitWindowState(mainWindow));
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
    emitWindowState(mainWindow);
  });
  hardenBrowserWindow(mainWindow);
  setupRendererContextMenu(mainWindow);
  mainWindow.webContents.on('console-message', (_event, levelOrDetails, message, line, sourceId) => {
    if (typeof levelOrDetails === 'object' && levelOrDetails) {
      const details = levelOrDetails;
      pushLog('renderer', `${details.level ?? 'log'} ${details.message ?? ''} ${details.sourceId ?? ''}:${details.lineNumber ?? 0}`);
      return;
    }
    pushLog('renderer', `${levelOrDetails} ${message ?? ''} ${sourceId ?? ''}:${line ?? 0}`);
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    pushLog('renderer', `render-process-gone reason=${details.reason} exitCode=${details.exitCode}`);
  });
  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    pushLog('renderer', `did-fail-load code=${code} description=${description} url=${url}`);
  });
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    pushLog('renderer', `preload-error ${preloadPath}: ${error.message}`);
  });

  if (isDev) {
    const frontendUrl = process.env.PI_DESKTOP_FRONTEND_URL || 'http://localhost:1420';
    try {
      await waitForHttpOk(frontendUrl, 30000);
      await mainWindow.loadURL(frontendUrl);
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    } catch (err) {
      await mainWindow.loadURL(errorHtml(`Frontend dev server is not available at ${frontendUrl}`, err));
    }
    return;
  }

  const indexHtml = path.join(repoRoot, 'frontend', 'dist', 'index.html');
  if (fs.existsSync(indexHtml)) {
    await mainWindow.loadFile(indexHtml);
  } else {
    await mainWindow.loadURL(errorHtml('Frontend build was not found.', `Missing file: ${indexHtml}`));
  }
}

async function createMarkdownWindow(sessionId, filePath) {
  return openStandaloneTab({
    type: 'markdown',
    sessionId,
    filePath,
  });
}

async function createWorkspaceFileWindow(sessionId, filePath) {
  return openStandaloneTab({
    type: isMarkdownPath(filePath) ? 'markdown' : 'workspace-file',
    sessionId,
    filePath,
  });
}

async function createWorkspaceFileDetachedWindow(sessionId, filePath, screenPoint) {
  const group = createStandaloneTabGroup();
  return openStandaloneTab({
    type: isMarkdownPath(filePath) ? 'markdown' : 'workspace-file',
    sessionId,
    filePath,
  }, group, screenPoint);
}

async function createWorkspaceFileTabInGroup(group, sessionId, filePath) {
  return openStandaloneTab({
    type: isMarkdownPath(filePath) ? 'markdown' : 'workspace-file',
    sessionId,
    filePath,
  }, group);
}

async function createTerminalWindow(sessionId) {
  if (!sessionId) {
    throw new Error('Standalone terminal window requires sessionId.');
  }

  return openStandaloneTab({
    type: 'terminal',
    sessionId,
  });
}

async function openStandaloneTab(input, targetGroup, screenPoint) {
  const tab = normalizeStandaloneTab(input);
  const existingGroup = findStandaloneGroupByTab(tab.id);
  const group = targetGroup ?? existingGroup ?? preferredStandaloneGroup() ?? createStandaloneTabGroup();

  if (existingGroup && targetGroup && existingGroup.id !== targetGroup.id) {
    const sourceIndex = existingGroup.tabs.findIndex((item) => item.id === tab.id);
    if (sourceIndex >= 0) {
      const [existingTab] = existingGroup.tabs.splice(sourceIndex, 1);
      if (!group.tabs.some((item) => item.id === existingTab.id)) {
        group.tabs.push(existingTab);
      }
      if (existingGroup.activeTabId === existingTab.id) {
        existingGroup.activeTabId = existingGroup.tabs[Math.min(sourceIndex, existingGroup.tabs.length - 1)]?.id ?? null;
      }
      if (existingGroup.tabs.length === 0) {
        const sourceWindow = existingGroup.window;
        if (sourceWindow && !sourceWindow.isDestroyed()) {
          sourceWindow.close();
        } else {
          standaloneTabGroups.delete(existingGroup.id);
        }
      } else {
        emitStandaloneTabs(existingGroup);
      }
    }
  } else if (!existingGroup) {
    group.tabs.push(tab);
  }
  group.activeTabId = tab.id;
  lastStandaloneGroupId = group.id;

  const tabWindow = await ensureStandaloneTabsWindow(group, screenPoint);
  emitStandaloneTabs(group);

  if (tabWindow.isMinimized()) tabWindow.restore();
  tabWindow.show();
  tabWindow.focus();
  return true;
}

function normalizeStandaloneTab(input) {
  if (!input.sessionId) {
    throw new Error('Standalone tab requires sessionId.');
  }
  if (input.type !== 'terminal' && !input.filePath) {
    throw new Error('Standalone file tab requires filePath.');
  }

  const type = input.type;
  const filePath = input.filePath ? String(input.filePath) : null;
  const id = type === 'terminal'
    ? `terminal:${input.sessionId}`
    : `${type}:${input.sessionId}:${filePath}`;
  const title = type === 'terminal' ? 'Terminal' : path.basename(filePath);

  return {
    id,
    type,
    title,
    sessionId: input.sessionId,
    filePath,
  };
}

function createStandaloneTabGroup() {
  const group = {
    id: `tools-${Date.now()}-${++standaloneGroupCounter}`,
    window: null,
    tabs: [],
    activeTabId: null,
  };
  standaloneTabGroups.set(group.id, group);
  return group;
}

function preferredStandaloneGroup() {
  const lastGroup = lastStandaloneGroupId ? standaloneTabGroups.get(lastStandaloneGroupId) : null;
  if (lastGroup && lastGroup.window && !lastGroup.window.isDestroyed()) {
    return lastGroup;
  }

  for (const group of standaloneTabGroups.values()) {
    if (group.window && !group.window.isDestroyed()) {
      return group;
    }
  }

  return null;
}

function findStandaloneGroupByTab(tabId) {
  for (const group of standaloneTabGroups.values()) {
    if (group.tabs.some((tab) => tab.id === tabId)) {
      return group;
    }
  }
  return null;
}

function findStandaloneGroupByWebContents(webContents) {
  for (const group of standaloneTabGroups.values()) {
    if (group.window && !group.window.isDestroyed() && group.window.webContents === webContents) {
      return group;
    }
  }
  return null;
}

function standaloneGroupFromEvent(event) {
  const group = findStandaloneGroupByWebContents(event.sender);
  if (group) return group;
  return preferredStandaloneGroup() ?? createStandaloneTabGroup();
}

async function ensureStandaloneTabsWindow(group, screenPoint) {
  if (group.window && !group.window.isDestroyed()) {
    return group.window;
  }

  const windowOptions = {
    width: 1120,
    height: 780,
    minWidth: 760,
    minHeight: 520,
    title: 'Pi Agent Tools',
    icon: appIconPath(),
    frame: process.platform === 'darwin',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    autoHideMenuBar: true,
    backgroundColor: '#111114',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  };

  if (screenPoint && Number.isFinite(screenPoint.x) && Number.isFinite(screenPoint.y)) {
    windowOptions.x = Math.max(0, Math.round(screenPoint.x - 220));
    windowOptions.y = Math.max(0, Math.round(screenPoint.y - 28));
  }

  const tabWindow = new BrowserWindow(windowOptions);
  group.window = tabWindow;

  markdownWindows.add(tabWindow);
  applyWindowIcon(tabWindow);
  tabWindow.on('closed', () => {
    markdownWindows.delete(tabWindow);
    if (group.window === tabWindow) {
      group.window = null;
      standaloneTabGroups.delete(group.id);
      if (lastStandaloneGroupId === group.id) {
        lastStandaloneGroupId = null;
      }
    }
  });
  tabWindow.on('maximize', () => emitWindowState(tabWindow));
  tabWindow.on('unmaximize', () => emitWindowState(tabWindow));
  tabWindow.on('focus', () => {
    lastStandaloneGroupId = group.id;
    emitWindowState(tabWindow);
  });
  tabWindow.on('blur', () => emitWindowState(tabWindow));
  hardenBrowserWindow(tabWindow);
  setupRendererContextMenu(tabWindow);

  const params = new URLSearchParams({ desktopView: 'standalone-tabs', groupId: group.id });
  if (isDev) {
    const frontendUrl = process.env.PI_DESKTOP_FRONTEND_URL || 'http://localhost:1420';
    await waitForHttpOk(frontendUrl, 30000);
    await tabWindow.loadURL(`${frontendUrl}/?${params.toString()}`);
  } else {
    const indexHtml = path.join(repoRoot, 'frontend', 'dist', 'index.html');
    if (!fs.existsSync(indexHtml)) {
      await tabWindow.loadURL(errorHtml('Frontend build was not found.', `Missing file: ${indexHtml}`));
      return tabWindow;
    }
    await tabWindow.loadFile(indexHtml, { search: `?${params.toString()}` });
  }

  return tabWindow;
}

function getStandaloneTabsState(group) {
  return {
    groupId: group.id,
    tabs: group.tabs,
    activeTabId: group.activeTabId,
  };
}

function emitStandaloneTabs(group) {
  if (!group.window || group.window.isDestroyed()) return;
  group.window.setTitle(activeStandaloneTabTitle(group));
  group.window.webContents.send('desktop:standalone-tabs-updated', getStandaloneTabsState(group));
}

function activeStandaloneTabTitle(group) {
  const active = group.tabs.find((tab) => tab.id === group.activeTabId);
  return active ? `${active.title} - Pi Agent Tools` : 'Pi Agent Tools';
}

function activateStandaloneTab(group, tabId) {
  if (group.tabs.some((tab) => tab.id === tabId)) {
    group.activeTabId = tabId;
    lastStandaloneGroupId = group.id;
    emitStandaloneTabs(group);
  }
  return getStandaloneTabsState(group);
}

function closeStandaloneTab(group, tabId) {
  const index = group.tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) return getStandaloneTabsState(group);

  group.tabs.splice(index, 1);
  if (group.tabs.length === 0) {
    const tabWindow = group.window;
    group.activeTabId = null;
    if (tabWindow && !tabWindow.isDestroyed()) {
      tabWindow.close();
    }
    return getStandaloneTabsState(group);
  }

  if (group.activeTabId === tabId) {
    group.activeTabId = group.tabs[Math.min(index, group.tabs.length - 1)].id;
  }
  emitStandaloneTabs(group);
  return getStandaloneTabsState(group);
}

async function detachStandaloneTab(event, tabId, screenPoint) {
  if (screenPoint?.sourceGroupId) {
    const hintedGroup = standaloneTabGroups.get(screenPoint.sourceGroupId);
    if (!hintedGroup) {
      return { groupId: screenPoint.sourceGroupId, tabs: [], activeTabId: null };
    }
    if (!hintedGroup.tabs.some((tab) => tab.id === tabId)) {
      return getStandaloneTabsState(hintedGroup);
    }
  }

  const sourceGroup = (screenPoint?.sourceGroupId ? standaloneTabGroups.get(screenPoint.sourceGroupId) : null)
    ?? findStandaloneGroupByTab(tabId)
    ?? standaloneGroupFromEvent(event);
  const index = sourceGroup.tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) return getStandaloneTabsState(sourceGroup);

  if (sourceGroup.tabs.length <= 1) {
    return activateStandaloneTab(sourceGroup, tabId);
  }

  const [tab] = sourceGroup.tabs.splice(index, 1);
  if (sourceGroup.activeTabId === tabId) {
    sourceGroup.activeTabId = sourceGroup.tabs[Math.min(index, sourceGroup.tabs.length - 1)]?.id ?? null;
  }
  emitStandaloneTabs(sourceGroup);

  const targetGroup = createStandaloneTabGroup();
  targetGroup.tabs.push(tab);
  targetGroup.activeTabId = tab.id;
  lastStandaloneGroupId = targetGroup.id;
  const tabWindow = await ensureStandaloneTabsWindow(targetGroup, screenPoint);
  emitStandaloneTabs(targetGroup);
  tabWindow.show();
  tabWindow.focus();

  return getStandaloneTabsState(targetGroup);
}

async function moveStandaloneTab(event, tabId, targetGroupId) {
  const sourceGroup = findStandaloneGroupByTab(tabId) ?? standaloneGroupFromEvent(event);
  const targetGroup = standaloneTabGroups.get(targetGroupId) ?? standaloneGroupFromEvent(event);
  const sourceIndex = sourceGroup.tabs.findIndex((tab) => tab.id === tabId);
  if (sourceIndex < 0) return getStandaloneTabsState(targetGroup);

  if (sourceGroup.id === targetGroup.id) {
    return activateStandaloneTab(targetGroup, tabId);
  }

  const [tab] = sourceGroup.tabs.splice(sourceIndex, 1);
  if (!targetGroup.tabs.some((item) => item.id === tab.id)) {
    targetGroup.tabs.push(tab);
  }
  targetGroup.activeTabId = tab.id;
  lastStandaloneGroupId = targetGroup.id;

  if (sourceGroup.activeTabId === tabId) {
    sourceGroup.activeTabId = sourceGroup.tabs[Math.min(sourceIndex, sourceGroup.tabs.length - 1)]?.id ?? null;
  }

  if (sourceGroup.tabs.length === 0) {
    const sourceWindow = sourceGroup.window;
    if (sourceWindow && !sourceWindow.isDestroyed()) {
      sourceWindow.close();
    } else {
      standaloneTabGroups.delete(sourceGroup.id);
    }
  } else {
    emitStandaloneTabs(sourceGroup);
  }

  await ensureStandaloneTabsWindow(targetGroup);
  emitStandaloneTabs(targetGroup);
  if (targetGroup.window && !targetGroup.window.isDestroyed()) {
    targetGroup.window.focus();
  }
  return getStandaloneTabsState(targetGroup);
}

async function createStandaloneFileWindow(sessionId, filePath, desktopView) {
  if (!sessionId || !filePath) {
    throw new Error('Standalone file window requires both sessionId and filePath.');
  }

  const standaloneWindow = new BrowserWindow({
    width: desktopView === 'markdown' ? 1040 : 1120,
    height: 780,
    minWidth: 760,
    minHeight: 520,
    title: path.basename(filePath),
    icon: appIconPath(),
    frame: process.platform === 'darwin',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    autoHideMenuBar: true,
    backgroundColor: '#111114',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  markdownWindows.add(standaloneWindow);
  applyWindowIcon(standaloneWindow);
  standaloneWindow.on('closed', () => {
    markdownWindows.delete(standaloneWindow);
  });
  standaloneWindow.on('maximize', () => emitWindowState(standaloneWindow));
  standaloneWindow.on('unmaximize', () => emitWindowState(standaloneWindow));
  standaloneWindow.on('focus', () => emitWindowState(standaloneWindow));
  standaloneWindow.on('blur', () => emitWindowState(standaloneWindow));
  hardenBrowserWindow(standaloneWindow);
  setupRendererContextMenu(standaloneWindow);

  const params = new URLSearchParams({
    desktopView,
    sessionId,
    path: filePath,
  });

  if (isDev) {
    const frontendUrl = process.env.PI_DESKTOP_FRONTEND_URL || 'http://localhost:1420';
    await waitForHttpOk(frontendUrl, 30000);
    await standaloneWindow.loadURL(`${frontendUrl}/?${params.toString()}`);
  } else {
    const indexHtml = path.join(repoRoot, 'frontend', 'dist', 'index.html');
    if (!fs.existsSync(indexHtml)) {
      await standaloneWindow.loadURL(errorHtml('Frontend build was not found.', `Missing file: ${indexHtml}`));
      return true;
    }
    await standaloneWindow.loadFile(indexHtml, { search: `?${params.toString()}` });
  }

  standaloneWindow.show();
  return true;
}

function isMarkdownPath(filePath) {
  return /\.(md|markdown|mdx)$/i.test(String(filePath));
}

function setupTray() {
  if (isSmoke || tray) return;
  tray = new Tray(createTrayIcon());
  tray.setToolTip('Pi Agent Desktop');
  tray.on('click', showMainWindow);
  refreshTrayMenu();
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Show Pi Agent', click: showMainWindow },
    { label: serverUrl ? `Server: ${serverUrl}` : 'Server unavailable', enabled: false },
    { type: 'separator' },
    { label: 'New Session', click: () => sendMenuCommand('new-session') },
    { label: 'Show Diagnostics', click: () => sendMenuCommand('show-diagnostics') },
    { type: 'separator' },
    {
      label: 'Restart Server',
      click: () => {
        restartServer().catch((err) => pushLog('desktop', err instanceof Error ? err.message : String(err)));
      },
    },
    { label: 'Open Data Directory', click: () => openDirectory(dataDirPath()) },
    { label: 'Open Logs Directory', click: () => openDirectory(logDirPath()) },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]));
}

function createTrayIcon() {
  const icon = nativeImage.createFromPath(appIconPath());
  if (!icon.isEmpty()) return icon;

  const svg = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect width="32" height="32" rx="7" fill="#050505"/>
      <text x="16" y="16" text-anchor="middle" dominant-baseline="central" fill="#ffffff" font-family="Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="15" font-weight="800">Pi</text>
    </svg>
  `);
  return nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${svg}`);
}

function appIconPath() {
  return path.join(repoRoot, 'desktop', 'assets', 'pi-icon.ico');
}

function applyWindowIcon(targetWindow) {
  try {
    targetWindow.setIcon(createTrayIcon());
  } catch (err) {
    pushLog('desktop', `Unable to set window icon: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function windowStatePath() {
  return path.join(app.getPath('userData'), WINDOW_STATE_FILE);
}

function loadWindowState() {
  try {
    const file = windowStatePath();
    if (!fs.existsSync(file)) return null;
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!state || typeof state !== 'object') return null;
    if (state.width < 960 || state.height < 640) return null;
    return state;
  } catch (err) {
    pushLog('desktop', `Failed to load window state: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

function scheduleWindowStateSave() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (saveWindowTimer) clearTimeout(saveWindowTimer);
  saveWindowTimer = setTimeout(saveWindowState, 500);
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const bounds = mainWindow.getNormalBounds();
    const state = {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      maximized: mainWindow.isMaximized(),
    };
    fs.mkdirSync(path.dirname(windowStatePath()), { recursive: true });
    fs.writeFileSync(windowStatePath(), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  } catch (err) {
    pushLog('desktop', `Failed to save window state: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function errorHtml(title, detail) {
  const message = detail instanceof Error ? detail.message : String(detail ?? '');
  const html = `<!doctype html>
    <meta charset="utf-8" />
    <title>Pi Agent Desktop</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #111114; color: #e8e8ef; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      main { width: min(720px, calc(100vw - 48px)); border: 1px solid #33333a; border-radius: 10px; background: #18181d; padding: 24px; }
      h1 { margin: 0 0 10px; font-size: 18px; }
      pre { white-space: pre-wrap; color: #a8a8b3; font-size: 12px; line-height: 1.6; }
    </style>
    <main><h1>${escapeHtml(title)}</h1><pre>${escapeHtml(message)}</pre></main>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

ipcMain.handle('desktop:get-server-url', (event) => {
  requireTrustedIpc(event);
  if (serverUrl) return serverUrl;
  throw new Error(startupError || 'Pi server is not ready yet.');
});
ipcMain.handle('desktop:get-server-auth-token', (event) => {
  requireTrustedIpc(event);
  if (serverAuthToken) return serverAuthToken;
  throw new Error(startupError || 'Pi server auth token is not ready yet.');
});
ipcMain.handle('desktop:get-startup-info', (event) => {
  requireTrustedIpc(event);
  return getStartupInfo();
});
ipcMain.handle('desktop:restart-server', (event) => {
  requireTrustedIpc(event);
  return restartServer();
});
ipcMain.handle('desktop:open-data-directory', (event) => {
  requireTrustedIpc(event);
  return openDirectory(dataDirPath());
});
ipcMain.handle('desktop:open-logs-directory', (event) => {
  requireTrustedIpc(event);
  return openDirectory(logDirPath());
});
ipcMain.handle('desktop:reveal-workspace-path', (event, workDir, workspacePath) => {
  requireTrustedIpc(event);
  return revealWorkspacePath(workDir, workspacePath);
});
ipcMain.handle('desktop:add-workspace-reference', (event, detail) => {
  requireTrustedIpc(event);
  const payload = sanitizeWorkspaceReference(detail);
  if (!payload || !mainWindow || mainWindow.isDestroyed()) return false;
  mainWindow.webContents.send('desktop:add-workspace-reference', payload);
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  return true;
});
ipcMain.handle('desktop:get-update-status', (event) => {
  requireTrustedIpc(event);
  return getUpdateStatus();
});
ipcMain.handle('desktop:check-for-updates', (event) => {
  requireTrustedIpc(event);
  return checkForUpdates('manual');
});
ipcMain.handle('desktop:download-update', (event) => {
  requireTrustedIpc(event);
  return downloadUpdate();
});
ipcMain.handle('desktop:install-update', (event) => {
  requireTrustedIpc(event);
  return installDownloadedUpdate();
});
ipcMain.handle('desktop:get-window-state', (event) => {
  requireTrustedIpc(event);
  return getWindowState(windowFromEvent(event));
});
ipcMain.handle('desktop:minimize-window', (event) => {
  requireTrustedIpc(event);
  const targetWindow = windowFromEvent(event);
  targetWindow?.minimize();
  return getWindowState(targetWindow);
});
ipcMain.handle('desktop:toggle-maximize-window', (event) => {
  requireTrustedIpc(event);
  const targetWindow = windowFromEvent(event);
  if (!targetWindow || targetWindow.isDestroyed()) return getWindowState(targetWindow);
  if (targetWindow.isMaximized()) {
    targetWindow.unmaximize();
  } else {
    targetWindow.maximize();
  }
  return getWindowState(targetWindow);
});
ipcMain.handle('desktop:close-window', (event) => {
  requireTrustedIpc(event);
  const targetWindow = windowFromEvent(event);
  targetWindow?.close();
  return getWindowState(targetWindow);
});
ipcMain.handle('desktop:select-project-directory', async (event) => {
  requireTrustedIpc(event);
  const targetWindow = windowFromEvent(event);
  const result = await dialog.showOpenDialog(targetWindow ?? mainWindow ?? undefined, {
    title: 'Select project folder',
    properties: ['openDirectory'],
  });
  if (result.canceled) return null;
  return result.filePaths[0] ?? null;
});
ipcMain.handle('desktop:open-markdown-window', (event, sessionId, filePath) => {
  requireTrustedIpc(event);
  return createMarkdownWindow(sessionId, filePath);
});
ipcMain.handle('desktop:open-workspace-file-window', (event, sessionId, filePath) => {
  requireTrustedIpc(event);
  return createWorkspaceFileWindow(sessionId, filePath);
});
ipcMain.handle('desktop:open-workspace-file-detached-window', (event, sessionId, filePath, screenPoint) => {
  requireTrustedIpc(event);
  return createWorkspaceFileDetachedWindow(sessionId, filePath, screenPoint);
});
ipcMain.handle('desktop:open-workspace-file-tab', (event, sessionId, filePath) => {
  requireTrustedIpc(event);
  return createWorkspaceFileTabInGroup(standaloneGroupFromEvent(event), sessionId, filePath);
});
ipcMain.handle('desktop:open-terminal-window', (event, sessionId) => {
  requireTrustedIpc(event);
  return createTerminalWindow(sessionId);
});
ipcMain.handle('desktop:get-standalone-tabs', (event) => {
  requireTrustedIpc(event);
  return getStandaloneTabsState(standaloneGroupFromEvent(event));
});
ipcMain.handle('desktop:activate-standalone-tab', (event, tabId) => {
  requireTrustedIpc(event);
  return activateStandaloneTab(standaloneGroupFromEvent(event), tabId);
});
ipcMain.handle('desktop:close-standalone-tab', (event, tabId) => {
  requireTrustedIpc(event);
  return closeStandaloneTab(standaloneGroupFromEvent(event), tabId);
});
ipcMain.handle('desktop:detach-standalone-tab', (event, tabId, screenPoint) => {
  requireTrustedIpc(event);
  return detachStandaloneTab(event, tabId, screenPoint);
});
ipcMain.handle('desktop:move-standalone-tab', (event, tabId, targetGroupId) => {
  requireTrustedIpc(event);
  return moveStandaloneTab(event, tabId, targetGroupId);
});

app.whenReady().then(async () => {
  if (process.platform === 'win32') {
    app.setAppUserModelId('works.pi-agent.desktop');
  }
  setupContentSecurityPolicy();
  setupApplicationMenu();
  setupTray();
  setupAutoUpdater();
  await startServer();
  if (isSmoke) {
    if (serverUrl) {
      try {
        smokeChecks = await runSmokeChecks();
      } catch (err) {
        startupError = err instanceof Error ? err.message : String(err);
        pushLog('desktop', `Smoke checks failed: ${startupError}`);
      }
    }
    const info = getStartupInfo();
    console.log(JSON.stringify(info, null, 2));
    stopServer();
    app.exit(info.serverUrl && !info.startupError ? 0 : 1);
    return;
  }
  await createMainWindow();
  scheduleStartupUpdateCheck();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow().catch((err) => pushLog('desktop', err.message));
    } else {
      showMainWindow();
    }
  });
});

app.on('before-quit', () => {
  isQuitting = true;
  saveWindowState();
  stopServer();
});

app.on('window-all-closed', () => {
  if (isQuitting && process.platform !== 'darwin') {
    app.quit();
  }
});
