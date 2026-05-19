import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Database,
  FileText,
  FolderOpen,
  RefreshCcw,
  Server,
  X,
  type LucideIcon,
} from 'lucide-react';
import { piApi } from '../../api/client';
import { useI18n } from '../../lib/i18n';
import { useUIStore } from '../../stores/uiStore';
import type { ServerDiagnostics } from '../../types';
import { cn } from '../shared/utils';

interface DesktopDiagnosticsProps {
  open: boolean;
  info?: DesktopStartupInfo;
  onClose: () => void;
  onRestart?: () => Promise<void> | void;
}

export function DesktopDiagnostics({ open, info, onClose, onRestart }: DesktopDiagnosticsProps) {
  const { t } = useI18n();
  const addToast = useUIStore((s) => s.addToast);
  const [snapshot, setSnapshot] = useState<DesktopStartupInfo | undefined>(info);
  const [serverDiagnostics, setServerDiagnostics] = useState<ServerDiagnostics | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSnapshot(info);
  }, [info]);

  useEffect(() => {
    if (!open || !window.piDesktop) return;

    let disposed = false;
    window.piDesktop.getStartupInfo().then((latest) => {
      if (!disposed) setSnapshot(latest);
    }).catch(() => {});
    piApi.getDiagnostics().then((latest) => {
      if (!disposed) setServerDiagnostics(latest);
    }).catch(() => {
      if (!disposed) setServerDiagnostics(null);
    });

    const dispose = window.piDesktop.onServerStatus((latest) => {
      setSnapshot(latest);
      piApi.getDiagnostics().then(setServerDiagnostics).catch(() => setServerDiagnostics(null));
    });

    return () => {
      disposed = true;
      dispose();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const status = useMemo(() => {
    if (snapshot?.startupError) return { labelKey: 'diagnostics.status.error' as const, tone: 'error' as const };
    if (snapshot?.serverUrl) return { labelKey: 'diagnostics.status.ready' as const, tone: 'success' as const };
    return { labelKey: 'diagnostics.status.starting' as const, tone: 'warning' as const };
  }, [snapshot]);

  if (!open) return null;

  const logs = snapshot?.logs?.slice(-80) ?? [];

  const statusLabel = t(status.labelKey);

  const restart = async () => {
    if (!window.piDesktop) return;
    setBusy(true);
    try {
      if (onRestart) {
        await onRestart();
      } else {
        setSnapshot(await window.piDesktop.restartServer());
      }
      const latest = await window.piDesktop.getStartupInfo();
      setSnapshot(latest);
      setServerDiagnostics(await piApi.getDiagnostics().catch(() => null));
      addToast({
        type: latest.startupError ? 'error' : 'success',
        message: latest.startupError ? t('diagnostics.restartFailed') : t('diagnostics.restarted'),
      });
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const openDataDirectory = async () => {
    const error = await window.piDesktop?.openDataDirectory();
    if (error) {
      addToast({ type: 'error', message: error });
    }
  };

  const openLogsDirectory = async () => {
    const error = await window.piDesktop?.openLogsDirectory();
    if (error) {
      addToast({ type: 'error', message: error });
    }
  };

  const copyDiagnostics = async () => {
    try {
      await navigator.clipboard.writeText(formatDiagnostics(snapshot, serverDiagnostics));
      addToast({ type: 'success', message: t('diagnostics.copied') });
    } catch {
      addToast({ type: 'error', message: t('diagnostics.copyFailed') });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-5">
      <div className="w-full max-w-3xl rounded-lg border border-pi-border bg-pi-bg-secondary shadow-2xl">
        <div className="flex items-center justify-between border-b border-pi-border px-4 py-3">
          <div className="flex items-center gap-2">
            <div className={cn(
              'flex h-8 w-8 items-center justify-center rounded-md border',
              status.tone === 'success' && 'border-pi-success/30 bg-pi-success/10 text-pi-success',
              status.tone === 'warning' && 'border-pi-warning/30 bg-pi-warning/10 text-pi-warning',
              status.tone === 'error' && 'border-pi-error/30 bg-pi-error/10 text-pi-error'
            )}>
              {status.tone === 'success' ? <CheckCircle2 size={17} /> : <AlertTriangle size={17} />}
            </div>
            <div>
              <h2 className="text-sm font-semibold text-pi-text">{t('diagnostics.title')}</h2>
              <p className="text-[11px] text-pi-dim">{t('diagnostics.serverIs', { status: statusLabel })}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-pi-dim hover:bg-pi-bg-hover hover:text-pi-text"
            title={t('common.close')}
          >
            <X size={15} />
          </button>
        </div>

        <div className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_220px]">
          <div className="min-w-0">
            <div className="grid gap-2 text-xs">
              <InfoRow icon={Server} label={t('diagnostics.server')} value={snapshot?.serverUrl ?? t('diagnostics.notReady')} />
              <InfoRow icon={FolderOpen} label={t('diagnostics.data')} value={snapshot?.dataDir ?? '-'} />
              <InfoRow icon={FileText} label={t('diagnostics.logs')} value={snapshot?.logFile ?? '-'} />
              <InfoRow icon={Database} label={t('diagnostics.mode')} value={`${snapshot?.mode ?? '-'} / ${snapshot?.platform ?? '-'}`} />
              <InfoRow
                icon={CheckCircle2}
                label={t('diagnostics.security')}
                value={`${serverDiagnostics?.security.authEnabled || snapshot?.authEnabled ? t('diagnostics.tokenOn') : t('diagnostics.tokenOff')} / ${serverDiagnostics?.security.cors ?? t('diagnostics.unknownCors')}`}
              />
              <InfoRow
                icon={Database}
                label={t('diagnostics.runtime')}
                value={`${serverDiagnostics?.runtime.mode ?? '-'} / ${t('diagnostics.sessions', { count: serverDiagnostics?.counts.sessions ?? 0 })} / ${t('diagnostics.agents', { count: serverDiagnostics?.counts.agents ?? 0 })}`}
              />
              <InfoRow
                icon={CheckCircle2}
                label={t('diagnostics.sdk')}
                value={serverDiagnostics
                  ? `${serverDiagnostics.sdk.available ? t('diagnostics.bundled') : t('diagnostics.missing')} / ${t('diagnostics.auth')} ${serverDiagnostics.sdk.exports?.AuthStorage ? t('diagnostics.ok') : '-'} / ${t('diagnostics.models')} ${serverDiagnostics.sdk.exports?.ModelRegistry ? t('diagnostics.ok') : '-'}`
                  : t('diagnostics.unknown')}
              />
            </div>

            {snapshot?.startupError && (
              <div className="mt-3 rounded-md border border-pi-error/30 bg-pi-error/10 px-3 py-2 text-xs leading-relaxed text-pi-error">
                {snapshot.startupError}
              </div>
            )}

            <pre className="mt-3 max-h-[320px] overflow-auto rounded-md border border-pi-border bg-pi-bg px-3 py-2 text-[11px] leading-relaxed text-pi-tool-output">
              {logs.length > 0 ? logs.join('\n') : t('diagnostics.noLogs')}
            </pre>
          </div>

          <div className="flex flex-col gap-2">
            <button
              onClick={() => void restart()}
              disabled={busy}
              className="flex h-9 items-center justify-center gap-2 rounded-md bg-pi-accent px-3 text-xs font-medium text-white hover:bg-pi-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCcw size={14} className={busy ? 'animate-spin' : undefined} />
              {t('diagnostics.restartServer')}
            </button>
            <button
              onClick={() => void openDataDirectory()}
              className="flex h-9 items-center justify-center gap-2 rounded-md border border-pi-border bg-pi-bg-tertiary px-3 text-xs text-pi-muted hover:bg-pi-bg-hover hover:text-pi-text"
            >
              <FolderOpen size={14} />
              {t('diagnostics.openData')}
            </button>
            <button
              onClick={() => void openLogsDirectory()}
              className="flex h-9 items-center justify-center gap-2 rounded-md border border-pi-border bg-pi-bg-tertiary px-3 text-xs text-pi-muted hover:bg-pi-bg-hover hover:text-pi-text"
            >
              <FileText size={14} />
              {t('diagnostics.openLogs')}
            </button>
            <button
              onClick={() => void copyDiagnostics()}
              className="flex h-9 items-center justify-center gap-2 rounded-md border border-pi-border bg-pi-bg-tertiary px-3 text-xs text-pi-muted hover:bg-pi-bg-hover hover:text-pi-text"
            >
              <Copy size={14} />
              {t('diagnostics.copyReport')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="grid grid-cols-[80px_minmax(0,1fr)] items-center gap-2 rounded-md border border-pi-border bg-pi-bg-tertiary px-3 py-2">
      <div className="flex items-center gap-2 text-pi-dim">
        <Icon size={13} />
        <span>{label}</span>
      </div>
      <div className="truncate font-mono text-[11px] text-pi-muted" title={value}>
        {value}
      </div>
    </div>
  );
}

function formatDiagnostics(info?: DesktopStartupInfo, server?: ServerDiagnostics | null) {
  if (!info) return 'Pi Agent Desktop diagnostics unavailable.';

  return [
    'Pi Agent Desktop Diagnostics',
    `Version: ${info.appVersion}`,
    `Mode: ${info.mode}`,
    `Platform: ${info.platform}`,
    `Server URL: ${info.serverUrl ?? 'not ready'}`,
    `Startup error: ${info.startupError ?? 'none'}`,
    `Data directory: ${info.dataDir}`,
    `Logs directory: ${info.logsDir}`,
    `Log file: ${info.logFile}`,
    `Auth enabled: ${server?.security.authEnabled ?? info.authEnabled ?? false}`,
    `CORS: ${server?.security.cors ?? 'unknown'}`,
    `Runtime: ${server?.runtime.mode ?? 'unknown'}`,
    `SDK: ${server ? JSON.stringify(server.sdk) : 'unavailable'}`,
    `Counts: ${server ? JSON.stringify(server.counts) : 'unavailable'}`,
    '',
    'Recent logs:',
    ...(info.logs.length > 0 ? info.logs : ['No logs.']),
  ].join('\n');
}
