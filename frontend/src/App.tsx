import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { useChatStore } from './stores/chatStore';
import { useExtensionStore, useUIStore, useSettingsStore } from './stores';
import { piApi } from './api/client';
import { AppShell } from './components/layout/AppShell';
import { ChatView } from './components/chat/ChatView';
import { EmptyState } from './components/shared/EmptyState';
import { DesktopTitleBar } from './components/desktop/DesktopTitleBar';
import { isMarkdownStandaloneRoute, MarkdownStandaloneView } from './components/markdown/MarkdownStandaloneView';
import { isWorkspaceFileStandaloneRoute, WorkspaceFileStandaloneView } from './components/workspace/WorkspaceFileStandaloneView';
import { applyRuntimeSettings } from './lib/runtimeSettings';
import { createNewSessionFromPicker } from './lib/sessionActions';
import { useI18n } from './lib/i18n';
import { useScheduledTaskRunner } from './hooks/useScheduledTaskRunner';
import { Loader2, RotateCcw } from 'lucide-react';

const SettingsView = lazy(() => import('./components/settings/SettingsView').then((m) => ({ default: m.SettingsView })));
const PackagesView = lazy(() => import('./components/settings/PackagesView').then((m) => ({ default: m.PackagesView })));
const ThemeEditor = lazy(() => import('./components/settings/ThemeEditor').then((m) => ({ default: m.ThemeEditor })));
const ExtensionsView = lazy(() => import('./components/settings/ExtensionsView').then((m) => ({ default: m.ExtensionsView })));
const AgentsView = lazy(() => import('./components/agents/AgentsView').then((m) => ({ default: m.AgentsView })));
const SkillsView = lazy(() => import('./components/skills/SkillsView').then((m) => ({ default: m.SkillsView })));
const ScheduledTasksView = lazy(() => import('./components/tasks/ScheduledTasksView').then((m) => ({ default: m.ScheduledTasksView })));
const DesktopDiagnostics = lazy(() => import('./components/desktop/DesktopDiagnostics').then((m) => ({ default: m.DesktopDiagnostics })));

export default function App() {
  if (isMarkdownStandaloneRoute()) {
    return <MarkdownStandaloneView />;
  }
  if (isWorkspaceFileStandaloneRoute()) {
    return <WorkspaceFileStandaloneView />;
  }

  return <MainApp />;
}

function MainApp() {
  const { t } = useI18n();
  useScheduledTaskRunner();

  const activeView = useUIStore((s) => s.activeView);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const theme = useSettingsStore((s) => s.theme);
  const language = useSettingsStore((s) => s.language);
  const fontSize = useSettingsStore((s) => s.fontSize);
  const fontFamily = useSettingsStore((s) => s.fontFamily);
  const monoFontFamily = useSettingsStore((s) => s.monoFontFamily);
  const themes = useExtensionStore((s) => s.themes);
  const customThemes = useExtensionStore((s) => s.customThemes);
  const [desktopStartup, setDesktopStartup] = useState<{
    state: 'initializing' | 'ready' | 'error';
    info?: DesktopStartupInfo;
    error?: string;
  }>({ state: 'initializing' });
  const [desktopDiagnosticsOpen, setDesktopDiagnosticsOpen] = useState(false);
  const desktopServerUrlRef = useRef<string | null>(null);

  useEffect(() => {
    applyRuntimeSettings({ theme, language, fontSize, fontFamily, monoFontFamily }, [...themes, ...customThemes]);
  }, [theme, language, fontSize, fontFamily, monoFontFamily, themes, customThemes]);

  // Initialize settings and connect WebSocket
  useEffect(() => {
    let disposed = false;

    async function boot() {
      useSettingsStore.getState().loadSettings();

      try {
        await piApi.configureFromDesktopShell();
        if (disposed) return;
        const info = window.piDesktop ? await window.piDesktop.getStartupInfo().catch(() => undefined) : undefined;
        desktopServerUrlRef.current = info?.serverUrl ?? null;
        setDesktopStartup({ state: 'ready', info });
        piApi.connect();
      } catch (err) {
        const bridge = window.piDesktop;
        const info = bridge ? await bridge.getStartupInfo().catch(() => undefined) : undefined;
        if (disposed) return;
        setDesktopStartup({
          state: 'error',
          info,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    void boot();

    return () => {
      disposed = true;
      piApi.disconnect();
    };
  }, []);

  useEffect(() => {
    const dispose = window.piDesktop?.onServerStatus((info) => {
      if (!info.startupError && info.serverUrl) {
        setDesktopStartup({ state: 'ready', info });
        if (desktopServerUrlRef.current !== info.serverUrl) {
          desktopServerUrlRef.current = info.serverUrl;
          piApi.reconnectToServerUrl(info.serverUrl);
        } else if (!piApi.connected) {
          piApi.connect();
        }
      } else {
        piApi.disconnect();
        setDesktopStartup({
          state: 'error',
          info,
          error: info.startupError ?? t('desktop.serverNotReady'),
        });
      }
    });
    return dispose;
  }, [t]);

  useEffect(() => {
    const bridge = window.piDesktop;
    const disposeMenu = bridge?.onMenuCommand((command) => {
      switch (command) {
        case 'new-session':
        case 'open-project':
          void createNewSessionFromPicker();
          break;
        case 'toggle-sidebar':
          useUIStore.getState().toggleSidebar();
          break;
        case 'show-changes':
          useUIStore.getState().setRightPanel('changes');
          break;
        case 'show-files':
          useUIStore.getState().setRightPanel('files');
          break;
        case 'show-diagnostics':
          setDesktopDiagnosticsOpen(true);
          break;
      }
    });

    const openDiagnostics = () => setDesktopDiagnosticsOpen(true);
    window.addEventListener('pi:desktop-open-diagnostics', openDiagnostics);

    return () => {
      disposeMenu?.();
      window.removeEventListener('pi:desktop-open-diagnostics', openDiagnostics);
    };
  }, []);

  const retryDesktopServer = async () => {
    if (!window.piDesktop) return;
    setDesktopStartup({ state: 'initializing' });
    try {
      const info = await window.piDesktop.restartServer();
      if (!info.serverUrl) {
        setDesktopStartup({ state: 'error', info, error: info.startupError ?? t('desktop.serverNotReady') });
        return;
      }
      desktopServerUrlRef.current = info.serverUrl;
      piApi.reconnectToServerUrl(info.serverUrl);
      setDesktopStartup({ state: 'ready', info });
    } catch (err) {
      const info = await window.piDesktop.getStartupInfo().catch(() => undefined);
      setDesktopStartup({
        state: 'error',
        info,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  if (window.piDesktop && desktopStartup.state === 'initializing') {
    return <DesktopStartupScreen />;
  }

  if (window.piDesktop && desktopStartup.state === 'error') {
    return (
      <DesktopStartupScreen
        error={desktopStartup.error}
        info={desktopStartup.info}
        onRetry={() => void retryDesktopServer()}
      />
    );
  }

  const renderContent = () => {
    switch (activeView) {
      case 'chat':
        return activeSessionId ? <ChatView /> : <EmptyState />;
      case 'settings':
        return <SettingsView />;
      case 'packages':
        return <PackagesView />;
      case 'themes':
        return <ThemeEditor />;
      case 'extensions':
        return <ExtensionsView />;
      case 'agents':
        return <AgentsView />;
      case 'skills':
        return <SkillsView />;
      case 'tasks':
        return <ScheduledTasksView />;
      default:
        return <EmptyState />;
    }
  };

  return (
    <>
      <AppShell>
        <Suspense fallback={<ViewLoading />}>{renderContent()}</Suspense>
      </AppShell>
      {window.piDesktop && desktopDiagnosticsOpen && (
        <Suspense fallback={null}>
          <DesktopDiagnostics
            open={desktopDiagnosticsOpen}
            info={desktopStartup.info}
            onClose={() => setDesktopDiagnosticsOpen(false)}
            onRestart={retryDesktopServer}
          />
        </Suspense>
      )}
    </>
  );
}

function ViewLoading() {
  const { t } = useI18n();

  return (
    <div className="flex h-full items-center justify-center gap-2 bg-pi-bg text-pi-muted">
      <Loader2 size={18} className="animate-spin" />
      <span className="text-xs">{t('app.viewLoading')}</span>
    </div>
  );
}

function DesktopStartupScreen({
  error,
  info,
  onRetry,
}: {
  error?: string;
  info?: DesktopStartupInfo;
  onRetry?: () => void;
}) {
  const { t } = useI18n();
  const logs = info?.logs?.slice(-18) ?? [];

  return (
    <div className="h-screen w-screen flex flex-col bg-pi-bg text-pi-text">
      <DesktopTitleBar />
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="w-full max-w-2xl rounded-lg border border-pi-border bg-pi-bg-secondary p-5 shadow-2xl">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 h-9 w-9 rounded-md bg-pi-accent/10 border border-pi-accent/20 flex items-center justify-center text-pi-accent">
              {error ? <RotateCcw size={18} /> : <Loader2 size={18} className="animate-spin" />}
            </div>
            <div className="min-w-0 flex-1">
              <h1 className="text-sm font-semibold text-pi-text">
                {error ? t('desktop.failedTitle') : t('desktop.launchingTitle')}
              </h1>
              <p className="mt-1 text-xs leading-relaxed text-pi-muted">
                {error ?? t('desktop.starting')}
              </p>
            </div>
            {onRetry && (
              <button
                onClick={onRetry}
                className="h-8 rounded-md bg-pi-accent px-3 text-xs font-medium text-white hover:bg-pi-accent/90 transition-colors"
              >
                {t('desktop.retry')}
              </button>
            )}
          </div>

          {info?.dataDir && (
            <div className="mt-4 rounded-md border border-pi-border bg-pi-bg-tertiary px-3 py-2 text-[11px] text-pi-dim">
              {t('desktop.dataDirectory')}: <span className="font-mono text-pi-muted">{info.dataDir}</span>
            </div>
          )}

          {logs.length > 0 && (
            <pre className="mt-3 max-h-[260px] overflow-auto rounded-md border border-pi-border bg-pi-bg px-3 py-2 text-[11px] leading-relaxed text-pi-tool-output">
              {logs.join('\n')}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
