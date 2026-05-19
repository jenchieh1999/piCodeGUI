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
      getUpdateStatus: () => Promise<DesktopUpdateStatus>;
      checkForUpdates: () => Promise<DesktopUpdateStatus>;
      downloadUpdate: () => Promise<DesktopUpdateStatus>;
      installUpdate: () => Promise<DesktopUpdateStatus>;
      selectProjectDirectory: () => Promise<string | null>;
      openMarkdownWindow: (sessionId: string, filePath: string) => Promise<boolean>;
      openWorkspaceFileWindow: (sessionId: string, filePath: string) => Promise<boolean>;
      getWindowState: () => Promise<DesktopWindowState>;
      minimizeWindow: () => Promise<DesktopWindowState>;
      toggleMaximizeWindow: () => Promise<DesktopWindowState>;
      closeWindow: () => Promise<DesktopWindowState>;
      onServerStatus: (callback: (status: DesktopStartupInfo) => void) => () => void;
      onWindowState: (callback: (state: DesktopWindowState) => void) => () => void;
      onUpdateStatus: (callback: (status: DesktopUpdateStatus) => void) => () => void;
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
