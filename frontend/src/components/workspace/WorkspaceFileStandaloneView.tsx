import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { piApi } from '../../api/client';
import { useStandaloneRuntimeSettings } from '../../hooks/useStandaloneRuntimeSettings';
import { useI18n } from '../../lib/i18n';
import { DesktopTitleBar } from '../desktop/DesktopTitleBar';
import { ToastContainer } from '../shared/ToastContainer';
import { CodeFileViewer } from './CodeFileViewer';

export function isWorkspaceFileStandaloneRoute(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('desktopView') === 'workspace-file';
}

export function WorkspaceFileStandaloneView() {
  useStandaloneRuntimeSettings();
  const { t } = useI18n();
  const [state, setState] = useState<'booting' | 'ready' | 'error'>('booting');
  const [error, setError] = useState<string | null>(null);

  const route = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      sessionId: params.get('sessionId') ?? '',
      filePath: params.get('path') ?? '',
    };
  }, []);
  const windowTitle = useMemo(
    () => (route.filePath ? `${getDisplayName(route.filePath)} - ${t('standalone.codeTitleSuffix')}` : t('standalone.codeTitle')),
    [route.filePath, t]
  );

  useEffect(() => {
    let disposed = false;

    async function boot() {
      try {
        if (!route.sessionId || !route.filePath) {
          throw new Error(t('standalone.codeRouteMissing'));
        }
        await piApi.configureFromDesktopShell();
        if (!disposed) setState('ready');
      } catch (err) {
        if (!disposed) {
          setError(err instanceof Error ? err.message : String(err));
          setState('error');
        }
      }
    }

    void boot();
    return () => {
      disposed = true;
    };
  }, [route.filePath, route.sessionId, t]);

  if (state === 'booting') {
    return (
      <StandaloneFrame title={windowTitle}>
        <div className="flex h-full items-center justify-center text-pi-muted">
          <Loader2 size={18} className="mr-2 animate-spin" />
          {t('standalone.codeLoading')}
        </div>
      </StandaloneFrame>
    );
  }

  if (state === 'error') {
    return (
      <StandaloneFrame title={windowTitle}>
        <div className="flex h-full items-center justify-center px-6 text-pi-text">
          <div className="max-w-lg rounded-lg border border-pi-error/30 bg-pi-error/10 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-pi-error">
              <AlertTriangle size={16} />
              {t('standalone.codeFailed')}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-pi-muted">{error}</p>
          </div>
        </div>
      </StandaloneFrame>
    );
  }

  return (
    <StandaloneFrame title={windowTitle}>
      <div className="min-h-0 flex-1 overflow-hidden">
        <CodeFileViewer sessionId={route.sessionId} filePath={route.filePath} />
      </div>
    </StandaloneFrame>
  );
}

function StandaloneFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="pi-shell flex h-screen w-screen flex-col text-pi-text">
      <DesktopTitleBar title={title} showMenus={false} />
      <div className="min-h-0 flex flex-1 flex-col overflow-hidden">{children}</div>
      <ToastContainer />
    </div>
  );
}

function getDisplayName(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;
}
