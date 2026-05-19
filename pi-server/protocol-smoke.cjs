const { spawn } = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');

const repoRoot = path.resolve(__dirname, '..');
const serverEntry = path.join(__dirname, 'dist', 'server.cjs');
const timeoutMs = 20000;
const smokeToken = 'pi-agent-protocol-smoke-token';

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

async function main() {
  if (!fs.existsSync(serverEntry)) {
    throw new Error(`Missing built server: ${serverEntry}. Run npm run build:server first.`);
  }

  const port = await reservePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-agent-smoke-'));
  const child = spawn(process.execPath, [serverEntry], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
      PI_AGENT_RUNTIME: process.env.PI_AGENT_RUNTIME || 'mock',
      PI_DESKTOP_DATA_DIR: dataDir,
      PI_DESKTOP_AUTH_TOKEN: smokeToken,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const logs = [];
  child.stdout.on('data', (chunk) => pushLog(logs, 'server', chunk));
  child.stderr.on('data', (chunk) => pushLog(logs, 'server', chunk));

  try {
    await waitForHealth(`http://127.0.0.1:${port}/health`, timeoutMs);
    await assertUnauthorized(`http://127.0.0.1:${port}/api/auth/status`);
    await assertDiagnostics(`http://127.0.0.1:${port}/api/diagnostics`);
    const authStatus = await assertAuthStatus(`http://127.0.0.1:${port}/api/auth/status`);
    await assertAuthTest(`http://127.0.0.1:${port}/api/auth/test`, authStatus.providers[0]?.id ?? 'anthropic');
    await runProtocolSmoke(`ws://127.0.0.1:${port}/ws?token=${encodeURIComponent(smokeToken)}`);
    await assertProjectLaunchApi(`http://127.0.0.1:${port}`);
    await assertPermissionRules(`http://127.0.0.1:${port}`);
    console.log('Protocol smoke passed');
  } catch (err) {
    console.error(logs.slice(-80).join('\n'));
    throw err;
  } finally {
    child.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

async function assertUnauthorized(url) {
  const statusCode = await getStatus(url);
  if (statusCode !== 401) {
    throw new Error(`Expected unauthenticated request to fail with 401, got ${statusCode}`);
  }
}

async function assertDiagnostics(url) {
  const body = await getJson(url);
  if (!body.ok || body.security?.authEnabled !== true || body.security?.cors !== 'loopback/file origins only') {
    throw new Error(`Expected secured diagnostics response, got: ${JSON.stringify(body).slice(0, 300)}`);
  }
  if (body.sdk?.available !== true || body.sdk?.exports?.AuthStorage !== true || body.sdk?.exports?.ModelRegistry !== true) {
    throw new Error(`Expected bundled SDK diagnostics, got: ${JSON.stringify(body.sdk).slice(0, 300)}`);
  }
}

async function assertAuthStatus(url) {
  const body = await getJson(url);
  if (!Array.isArray(body.providers)) {
    throw new Error('Expected auth status response to include providers array');
  }
  return body;
}

async function assertAuthTest(url, provider) {
  const body = await postJson(url, { provider });
  if (typeof body.ok !== 'boolean' || body.provider !== provider || typeof body.message !== 'string') {
    throw new Error(`Expected auth test response for ${provider}, got: ${JSON.stringify(body).slice(0, 300)}`);
  }
}

async function runProtocolSmoke(url) {
  const ws = new WebSocket(url);
  let sessionId;
  let firstPromptCompleted = false;
  let firstPromptText = '';
  let awaitingFork = false;
  let forkReceived = false;
  let permissionDeniedResult = false;
  let rememberedPermissionResult = false;
  let sawRememberPermissionPrompt = false;
  let secondPromptCompleted = false;
  let thirdPromptCompleted = false;
  let permissionPhase = 'deny';
  let alternateModel = null;
  let awaitingSessionModel = false;
  let awaitingSessionThinking = false;
  let autoTitleUpdated = false;
  let terminalSmokeSeen = false;
  const terminalId = 'terminal-smoke';

  await withTimeout(new Promise((resolve, reject) => {
    ws.on('open', () => undefined);
    ws.on('error', reject);
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());

      if (msg.type === 'connected') {
        if (!Array.isArray(msg.slashCommands) || !msg.slashCommands.some((command) => command.name === '/review')) {
          reject(new Error(`Expected connected message to include slash commands, got: ${JSON.stringify(msg.slashCommands).slice(0, 200)}`));
          return;
        }
        const models = (msg.providers ?? []).flatMap((provider) => provider.models ?? []);
        alternateModel = models.find((model) =>
          model.id !== msg.currentModel?.id || model.provider !== msg.currentModel?.provider
        ) ?? null;
        ws.send(JSON.stringify({ type: 'session_create', projectPath: '.' }));
        return;
      }

      if (msg.type === 'session_created') {
        if (sessionId && awaitingFork) {
          awaitingFork = false;
          forkReceived = true;
          if (!Array.isArray(msg.messages) || msg.messages.length === 0) {
            reject(new Error('Expected forked session to include copied messages'));
            return;
          }
          ws.send(JSON.stringify({ type: 'prompt', sessionId, message: 'please run bash and deny permission' }));
          return;
        }

        sessionId = msg.session.id;
        if (alternateModel) {
          awaitingSessionModel = true;
          ws.send(JSON.stringify({
            type: 'set_model',
            sessionId,
            provider: alternateModel.provider,
            modelId: alternateModel.id,
          }));
          return;
        }
        awaitingSessionThinking = true;
        ws.send(JSON.stringify({ type: 'set_thinking_level', sessionId, level: 'high' }));
        return;
      }

      if (msg.type === 'session_updated' && msg.session.id === sessionId && awaitingSessionModel) {
        awaitingSessionModel = false;
        if (msg.session.modelId !== alternateModel.id || msg.session.modelProvider !== alternateModel.provider) {
          reject(new Error(`Expected per-session model update, got: ${JSON.stringify(msg.session).slice(0, 300)}`));
          return;
        }
        awaitingSessionThinking = true;
        ws.send(JSON.stringify({ type: 'set_thinking_level', sessionId, level: 'high' }));
        return;
      }

      if (
        msg.type === 'session_updated'
        && msg.session.id === sessionId
        && msg.session.titleSource === 'auto'
        && !/^New Session \d+/.test(msg.session.title)
      ) {
        autoTitleUpdated = true;
      }

      if (msg.type === 'session_updated' && msg.session.id === sessionId && awaitingSessionThinking) {
        awaitingSessionThinking = false;
        if (msg.session.thinkingLevel !== 'high') {
          reject(new Error(`Expected per-session thinking update, got: ${JSON.stringify(msg.session).slice(0, 300)}`));
          return;
        }
        ws.send(JSON.stringify({ type: 'terminal_start', sessionId, terminalId }));
        ws.send(JSON.stringify({ type: 'prompt', sessionId, message: 'hello protocol smoke' }));
        return;
      }

      if (msg.type === 'terminal_started' && msg.terminalId === terminalId) {
        if (msg.backend !== 'pty' && msg.backend !== 'pipe') {
          reject(new Error(`Expected terminal backend to be reported, got: ${JSON.stringify(msg).slice(0, 200)}`));
          return;
        }
        ws.send(JSON.stringify({ type: 'terminal_resize', terminalId, cols: 100, rows: 24 }));
        ws.send(JSON.stringify({
          type: 'terminal_input',
          terminalId,
          data: 'node -e "console.log(\'pi-terminal-smoke\')"\n',
        }));
        return;
      }

      if (msg.type === 'terminal_output' && msg.terminalId === terminalId && msg.data.includes('pi-terminal-smoke')) {
        terminalSmokeSeen = true;
        ws.send(JSON.stringify({ type: 'terminal_stop', terminalId }));
        return;
      }

      if (msg.type === 'text_delta' && !firstPromptCompleted) {
        firstPromptText += msg.delta;
      }

      if (msg.type === 'message_complete' && msg.sessionId === sessionId && !firstPromptCompleted) {
        firstPromptCompleted = true;
        if (!firstPromptText.includes('Hello')) {
          reject(new Error(`Expected first prompt text to include Hello, got: ${firstPromptText.slice(0, 120)}`));
          return;
        }
        awaitingFork = true;
        ws.send(JSON.stringify({ type: 'session_fork', sessionId, entryId: msg.messageId }));
        return;
      }

      if (msg.type === 'permission_request') {
        if (msg.request.toolName === 'bash' && msg.request.preview?.kind !== 'bash') {
          reject(new Error('Expected bash permission request to include a bash preview'));
          return;
        }
        if (permissionPhase === 'remember') {
          sawRememberPermissionPrompt = true;
          ws.send(JSON.stringify({
            type: 'permission_response',
            sessionId: msg.sessionId,
            response: { requestId: msg.request.requestId, action: 'always_allow', scope: 'project' },
          }));
          return;
        }
        ws.send(JSON.stringify({
          type: 'permission_response',
          sessionId: msg.sessionId,
          response: { requestId: msg.request.requestId, action: 'deny' },
        }));
        return;
      }

      if (msg.type === 'tool_result' && msg.result?.isError && permissionPhase === 'deny') {
        permissionDeniedResult = true;
      }

      if (msg.type === 'tool_result' && !msg.result?.isError && permissionPhase === 'remember') {
        rememberedPermissionResult = true;
      }

      if (msg.type === 'message_complete' && msg.sessionId === sessionId && firstPromptCompleted) {
        if (permissionPhase === 'deny') {
          secondPromptCompleted = true;
          permissionPhase = 'remember';
          ws.send(JSON.stringify({ type: 'prompt', sessionId, message: 'please run bash and remember permission' }));
          return;
        }

        thirdPromptCompleted = true;
      }

      if (
        secondPromptCompleted
        && thirdPromptCompleted
        && permissionDeniedResult
        && rememberedPermissionResult
        && sawRememberPermissionPrompt
        && forkReceived
        && autoTitleUpdated
        && terminalSmokeSeen
      ) {
        ws.close();
        resolve();
      }
    });
  }), timeoutMs, 'Timed out waiting for protocol smoke to complete');
}

async function assertPermissionRules(baseUrl) {
  const rulesBody = await getJson(`${baseUrl}/api/permissions/rules`);
  if (!Array.isArray(rulesBody.rules) || rulesBody.rules.length === 0) {
    throw new Error('Expected saved permission rules after always_allow response');
  }

  const bashRule = rulesBody.rules.find((rule) =>
    rule.toolName === 'bash' && rule.scope === 'project' && rule.commandPrefix === 'npm run build'
  );
  if (!bashRule) {
    throw new Error(`Expected project-scoped bash rule, got: ${JSON.stringify(rulesBody.rules).slice(0, 300)}`);
  }

  const auditBody = await getJson(`${baseUrl}/api/permissions/audit?limit=20`);
  if (!Array.isArray(auditBody.entries) || !auditBody.entries.some((entry) => entry.action === 'always_allow')) {
    throw new Error('Expected permission audit to include always_allow');
  }
}

async function assertProjectLaunchApi(baseUrl) {
  const projectsBody = await getJson(`${baseUrl}/api/projects/recent?limit=5`);
  if (!Array.isArray(projectsBody.projects) || projectsBody.projects.length === 0) {
    throw new Error(`Expected recent projects response, got: ${JSON.stringify(projectsBody).slice(0, 300)}`);
  }
  const first = projectsBody.projects[0];
  if (!first.projectName || !first.realPath || typeof first.sessionCount !== 'number') {
    throw new Error(`Expected recent project metadata, got: ${JSON.stringify(first).slice(0, 300)}`);
  }

  const contextBody = await getJson(`${baseUrl}/api/repository/context?path=${encodeURIComponent('.')}`);
  if (!['ok', 'not_git_repo', 'missing_workdir', 'error'].includes(contextBody.state) || typeof contextBody.workDir !== 'string') {
    throw new Error(`Expected repository context response, got: ${JSON.stringify(contextBody).slice(0, 300)}`);
  }
  if (contextBody.state === 'ok' && (!Array.isArray(contextBody.branches) || !contextBody.repoRoot)) {
    throw new Error(`Expected Git repository context details, got: ${JSON.stringify(contextBody).slice(0, 300)}`);
  }
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { headers: authHeaders() }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        if (res.statusCode !== 200) {
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
    req.setTimeout(3000, () => {
      req.destroy(new Error(`Timed out fetching ${url}`));
    });
  });
}

function postJson(url, body) {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      path: `${parsed.pathname}${parsed.search}`,
      method: 'POST',
      headers: {
        ...authHeaders(),
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, (res) => {
      let responseBody = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        responseBody += chunk;
      });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`POST ${url} failed with ${res.statusCode}: ${responseBody.slice(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(responseBody));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(3000, () => {
      req.destroy(new Error(`Timed out posting ${url}`));
    });
    req.end(payload);
  });
}

function getStatus(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.setTimeout(3000, () => {
      req.destroy(new Error(`Timed out fetching ${url}`));
    });
  });
}

function authHeaders() {
  return { Authorization: `Bearer ${smokeToken}` };
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address !== 'object') {
        reject(new Error('Could not reserve local port'));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

function waitForHealth(url, timeout) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode === 200) {
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
      if (Date.now() - startedAt > timeout) {
        reject(new Error(`Timed out waiting for ${url}`));
        return;
      }
      setTimeout(tryOnce, 150);
    };

    tryOnce();
  });
}

function withTimeout(promise, timeout, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeout);
    }),
  ]).finally(() => clearTimeout(timer));
}

function pushLog(logs, source, chunk) {
  for (const line of chunk.toString('utf8').split(/\r?\n/)) {
    if (line.trim()) logs.push(`[${source}] ${line}`);
  }
}
