const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('piDesktop', {
  getServerUrl: () => ipcRenderer.invoke('desktop:get-server-url'),
  getServerAuthToken: () => ipcRenderer.invoke('desktop:get-server-auth-token'),
  getStartupInfo: () => ipcRenderer.invoke('desktop:get-startup-info'),
  restartServer: () => ipcRenderer.invoke('desktop:restart-server'),
  openDataDirectory: () => ipcRenderer.invoke('desktop:open-data-directory'),
  openLogsDirectory: () => ipcRenderer.invoke('desktop:open-logs-directory'),
  revealWorkspacePath: (workDir, filePath) => ipcRenderer.invoke('desktop:reveal-workspace-path', workDir, filePath),
  addWorkspaceReference: (detail) => ipcRenderer.invoke('desktop:add-workspace-reference', detail),
  getUpdateStatus: () => ipcRenderer.invoke('desktop:get-update-status'),
  checkForUpdates: () => ipcRenderer.invoke('desktop:check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('desktop:download-update'),
  installUpdate: () => ipcRenderer.invoke('desktop:install-update'),
  selectProjectDirectory: () => ipcRenderer.invoke('desktop:select-project-directory'),
  openMarkdownWindow: (sessionId, filePath) => ipcRenderer.invoke('desktop:open-markdown-window', sessionId, filePath),
  openWorkspaceFileWindow: (sessionId, filePath) => ipcRenderer.invoke('desktop:open-workspace-file-window', sessionId, filePath),
  openWorkspaceFileDetachedWindow: (sessionId, filePath, screenPoint) =>
    ipcRenderer.invoke('desktop:open-workspace-file-detached-window', sessionId, filePath, screenPoint),
  openWorkspaceFileTab: (sessionId, filePath) => ipcRenderer.invoke('desktop:open-workspace-file-tab', sessionId, filePath),
  openTerminalWindow: (sessionId) => ipcRenderer.invoke('desktop:open-terminal-window', sessionId),
  getStandaloneTabs: () => ipcRenderer.invoke('desktop:get-standalone-tabs'),
  activateStandaloneTab: (tabId) => ipcRenderer.invoke('desktop:activate-standalone-tab', tabId),
  closeStandaloneTab: (tabId) => ipcRenderer.invoke('desktop:close-standalone-tab', tabId),
  detachStandaloneTab: (tabId, screenPoint) => ipcRenderer.invoke('desktop:detach-standalone-tab', tabId, screenPoint),
  moveStandaloneTab: (tabId, targetGroupId) => ipcRenderer.invoke('desktop:move-standalone-tab', tabId, targetGroupId),
  getWindowState: () => ipcRenderer.invoke('desktop:get-window-state'),
  minimizeWindow: () => ipcRenderer.invoke('desktop:minimize-window'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('desktop:toggle-maximize-window'),
  closeWindow: () => ipcRenderer.invoke('desktop:close-window'),
  onServerStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('desktop:server-status', handler);
    return () => ipcRenderer.removeListener('desktop:server-status', handler);
  },
  onWindowState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('desktop:window-state', handler);
    return () => ipcRenderer.removeListener('desktop:window-state', handler);
  },
  onUpdateStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('desktop:update-status', handler);
    return () => ipcRenderer.removeListener('desktop:update-status', handler);
  },
  onStandaloneTabs: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('desktop:standalone-tabs-updated', handler);
    return () => ipcRenderer.removeListener('desktop:standalone-tabs-updated', handler);
  },
  onWorkspaceReference: (callback) => {
    const handler = (_event, detail) => callback(detail);
    ipcRenderer.on('desktop:add-workspace-reference', handler);
    return () => ipcRenderer.removeListener('desktop:add-workspace-reference', handler);
  },
  onMenuCommand: (callback) => {
    const allowed = new Set([
      'new-session',
      'open-project',
      'toggle-sidebar',
      'show-changes',
      'show-files',
      'show-diagnostics',
    ]);
    const handler = (_event, command) => {
      if (allowed.has(command)) callback(command);
    };
    ipcRenderer.on('desktop:menu-command', handler);
    return () => ipcRenderer.removeListener('desktop:menu-command', handler);
  },
});
