export {};

declare global {
  interface Window {
    piDesktop?: {
      getServerUrl: () => Promise<string>;
      getServerAuthToken: () => Promise<string>;
      getStartupInfo: () => Promise<DesktopStartupInfo>;
      restartServer: () => Promise<DesktopStartupInfo>;
      openDataDirectory: () => Promise<string>;
      openLogsDirectory: () => Promise<string>;
      revealWorkspacePath: (workDir: string, filePath: string) => Promise<DesktopRevealPathResult>;
      addWorkspaceReference: (detail: DesktopWorkspaceReferenceDetail) => Promise<boolean>;
      getUpdateStatus: () => Promise<DesktopUpdateStatus>;
      checkForUpdates: () => Promise<DesktopUpdateStatus>;
      downloadUpdate: () => Promise<DesktopUpdateStatus>;
      installUpdate: () => Promise<DesktopUpdateStatus>;
      selectProjectDirectory: () => Promise<string | null>;
      openMarkdownWindow: (sessionId: string, filePath: string) => Promise<boolean>;
      openWorkspaceFileWindow: (sessionId: string, filePath: string) => Promise<boolean>;
      openWorkspaceFileDetachedWindow: (
        sessionId: string,
        filePath: string,
        screenPoint?: { x: number; y: number }
      ) => Promise<boolean>;
      openWorkspaceFileTab: (sessionId: string, filePath: string) => Promise<boolean>;
      openTerminalWindow: (sessionId: string) => Promise<boolean>;
      getStandaloneTabs: () => Promise<DesktopStandaloneTabsState>;
      activateStandaloneTab: (tabId: string) => Promise<DesktopStandaloneTabsState>;
      closeStandaloneTab: (tabId: string) => Promise<DesktopStandaloneTabsState>;
      detachStandaloneTab: (
        tabId: string,
        screenPoint?: { x: number; y: number; sourceGroupId?: string }
      ) => Promise<DesktopStandaloneTabsState>;
      moveStandaloneTab: (tabId: string, targetGroupId: string) => Promise<DesktopStandaloneTabsState>;
      getWindowState: () => Promise<DesktopWindowState>;
      minimizeWindow: () => Promise<DesktopWindowState>;
      toggleMaximizeWindow: () => Promise<DesktopWindowState>;
      closeWindow: () => Promise<DesktopWindowState>;
      onServerStatus: (callback: (status: DesktopStartupInfo) => void) => () => void;
      onWindowState: (callback: (state: DesktopWindowState) => void) => () => void;
      onUpdateStatus: (callback: (status: DesktopUpdateStatus) => void) => () => void;
      onStandaloneTabs: (callback: (state: DesktopStandaloneTabsState) => void) => () => void;
      onWorkspaceReference: (callback: (detail: DesktopWorkspaceReferenceDetail) => void) => () => void;
      onMenuCommand: (callback: (command: DesktopMenuCommand) => void) => () => void;
    };
  }

  type DesktopMenuCommand =
    | 'new-session'
    | 'open-project'
    | 'toggle-sidebar'
    | 'show-changes'
    | 'show-files'
    | 'show-diagnostics';

  interface DesktopStartupInfo {
    mode: 'development' | 'production';
    serverUrl: string | null;
    startupError: string | null;
    logs: string[];
    dataDir: string;
    logsDir: string;
    logFile: string;
    appVersion: string;
    platform: string;
    authEnabled?: boolean;
    updates?: DesktopUpdateStatus;
    smokeChecks?: {
      diagnostics: boolean;
      sdkAvailable: boolean;
      authEnabled: boolean;
      cors: string;
    } | null;
  }

  interface DesktopWindowState {
    maximized: boolean;
    focused: boolean;
  }

  interface DesktopRevealPathResult {
    ok: boolean;
    path?: string;
    missing?: boolean;
    error?: string;
  }

  interface DesktopWorkspaceReferenceDetail {
    sessionId: string;
    path: string;
    name?: string;
    lineStart?: number;
    lineEnd?: number;
    excerpt?: string;
    sourceKind?: 'file' | 'diff';
  }

  type DesktopStandaloneTabType = 'markdown' | 'workspace-file' | 'terminal';

  interface DesktopStandaloneTab {
    id: string;
    type: DesktopStandaloneTabType;
    title: string;
    sessionId: string;
    filePath: string | null;
  }

  interface DesktopStandaloneTabsState {
    groupId: string;
    tabs: DesktopStandaloneTab[];
    activeTabId: string | null;
  }

  type DesktopUpdateState =
    | 'idle'
    | 'checking'
    | 'available'
    | 'not-available'
    | 'downloading'
    | 'downloaded'
    | 'installing'
    | 'error'
    | 'unsupported';

  interface DesktopUpdateStatus {
    supported: boolean;
    enabled: boolean;
    state: DesktopUpdateState;
    currentVersion: string;
    version: string | null;
    releaseName: string | null;
    releaseDate: string | null;
    releaseNotes: string | null;
    progress: {
      percent: number;
      transferred: number;
      total: number;
      bytesPerSecond: number;
    } | null;
    error: string | null;
    feedUrl: string | null;
    channel: string;
    lastCheckedAt: number | null;
    downloadedFile: string | null;
    source: string | null;
  }
}
