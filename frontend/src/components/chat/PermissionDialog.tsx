import { useEffect, useState } from 'react';
import { useChatStore } from '../../stores/chatStore';
import { piApi } from '../../api/client';
import type { PermissionPreview, PermissionRequest, PermissionScope } from '../../types';
import { Shield, AlertTriangle, Check, X, CheckCheck, FileText, Terminal, FolderLock, Globe2, type LucideIcon } from 'lucide-react';
import { useI18n, type TranslationKey } from '../../lib/i18n';
import { cn } from '../shared/utils';

export function PermissionOverlay() {
  const { t } = useI18n();
  const pendingPermission = useChatStore((s) => s.pendingPermission);
  const setPendingPermission = useChatStore((s) => s.setPendingPermission);
  const [rememberScope, setRememberScope] = useState<PermissionScope>('session');

  useEffect(() => {
    if (pendingPermission) {
      setRememberScope(defaultPermissionScope(pendingPermission.preview));
    }
  }, [pendingPermission?.requestId, pendingPermission?.preview]);

  if (!pendingPermission) return null;

  const { requestId, toolName, message, risk, args, sessionId, preview } = pendingPermission;

  const handleAllow = () => {
    piApi.send({
      type: 'permission_response',
      sessionId,
      response: { action: 'allow', requestId },
    });
    setPendingPermission(null);
  };

  const handleAlwaysAllow = () => {
    piApi.send({
      type: 'permission_response',
      sessionId,
      response: { action: 'always_allow', requestId, scope: rememberScope },
    });
    setPendingPermission(null);
  };

  const handleDeny = () => {
    piApi.send({
      type: 'permission_response',
      sessionId,
      response: { action: 'deny', requestId },
    });
    setPendingPermission(null);
  };

  const riskColors = {
    low: 'border-pi-success/30 bg-pi-success/5',
    medium: 'border-pi-warning/30 bg-pi-warning/5',
    high: 'border-pi-error/30 bg-pi-error/5',
  };

  const riskIcons = {
    low: Shield,
    medium: AlertTriangle,
    high: AlertTriangle,
  };

  const RiskIcon = riskIcons[risk];

  return (
    <div className="absolute inset-0 z-40 flex items-end justify-center pb-6 bg-black/20">
      <div
        className={cn(
          'w-full max-w-xl border rounded-xl shadow-2xl p-4 mx-4 animate-slide-in-right',
          riskColors[risk]
        )}
      >
        {/* Header */}
        <div className="flex items-start gap-3 mb-3">
          <div
            className={cn(
              'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
              risk === 'high' ? 'bg-pi-error/20' : risk === 'medium' ? 'bg-pi-warning/20' : 'bg-pi-accent/20'
            )}
          >
            <RiskIcon
              size={16}
              className={cn(
                risk === 'high' ? 'text-pi-error' : risk === 'medium' ? 'text-pi-warning' : 'text-pi-accent'
              )}
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="font-semibold text-sm text-pi-text">
                {t('permission.title')}
              </span>
              <span
                className={cn(
                  'text-[10px] px-1.5 py-0.5 rounded font-medium uppercase',
                  risk === 'high' ? 'bg-pi-error/20 text-pi-error' :
                  risk === 'medium' ? 'bg-pi-warning/20 text-pi-warning' :
                  'bg-pi-accent/20 text-pi-accent'
                )}
              >
                {t('permission.risk', { risk })}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-pi-dim">
              <span className="font-mono text-pi-accent">{toolName}</span>
              <span>{t('permission.wantsExecute')}</span>
            </div>
            {message && (
              <p className="text-xs text-pi-muted mt-1 leading-relaxed">{message}</p>
            )}
          </div>
        </div>

        {/* Preview */}
        <div className="mb-3 space-y-2">
          {preview ? (
            <PermissionPreviewBlock preview={preview} />
          ) : (
            <pre className="text-xs bg-pi-bg/50 rounded-lg p-2.5 overflow-x-auto font-mono text-pi-tool-output max-h-[120px] overflow-y-auto">
              {JSON.stringify(args, null, 2)}
            </pre>
          )}
          {preview && (
            <details className="rounded-lg bg-pi-bg/40 border border-pi-border/60">
              <summary className="cursor-pointer px-2.5 py-1.5 text-[10px] text-pi-dim hover:text-pi-text">
                {t('permission.rawArguments')}
              </summary>
              <pre className="border-t border-pi-border/60 text-[11px] bg-pi-bg/40 p-2.5 overflow-x-auto font-mono text-pi-tool-output max-h-[110px] overflow-y-auto">
                {JSON.stringify(args, null, 2)}
              </pre>
            </details>
          )}
        </div>

        {/* Actions */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-[10px] text-pi-dim">
            <span className="shrink-0">{t('permission.rememberFor')}</span>
            <div className="flex min-w-0 rounded-md border border-pi-border overflow-hidden">
              {permissionScopes(t).map((scope) => {
                const Icon = scope.icon;
                return (
                  <button
                    key={scope.value}
                    onClick={() => setRememberScope(scope.value)}
                    className={cn(
                      'h-7 px-2 flex items-center gap-1 border-r border-pi-border last:border-r-0 transition-colors',
                      rememberScope === scope.value
                        ? 'bg-pi-selected-bg text-pi-accent'
                        : 'bg-pi-bg/40 text-pi-muted hover:text-pi-text hover:bg-pi-bg-hover'
                    )}
                    title={scope.title}
                  >
                    <Icon size={11} />
                    <span>{scope.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-2">
          <button
            onClick={handleAllow}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-pi-accent text-white hover:bg-pi-accent/90 transition-colors"
          >
            <Check size={13} />
            {t('permission.allowOnce')}
          </button>
          <button
            onClick={handleAlwaysAllow}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-pi-success/20 text-pi-success hover:bg-pi-success/30 transition-colors"
          >
            <CheckCheck size={13} />
            {t('permission.allowRemember')}
          </button>
          <button
            onClick={handleDeny}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-pi-error/20 text-pi-error hover:bg-pi-error/30 transition-colors ml-auto"
          >
            <X size={13} />
            {t('permission.deny')}
          </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function permissionScopes(t: (key: TranslationKey, values?: Record<string, string | number>) => string): Array<{
  value: PermissionScope;
  label: string;
  title: string;
  icon: LucideIcon;
}> {
  return [
    { value: 'session', label: t('permission.scope.session'), title: t('permission.scope.sessionTitle'), icon: Shield },
    { value: 'project', label: t('permission.scope.project'), title: t('permission.scope.projectTitle'), icon: FolderLock },
    { value: 'global', label: t('permission.scope.global'), title: t('permission.scope.globalTitle'), icon: Globe2 },
  ];
}

function defaultPermissionScope(preview: PermissionPreview | undefined): PermissionScope {
  return preview?.kind === 'file' ? 'project' : 'session';
}

function PermissionPreviewBlock({ preview }: { preview: PermissionPreview }) {
  const { t } = useI18n();
  if (preview.kind === 'bash') {
    return (
      <div className="rounded-lg border border-pi-border bg-pi-bg/50 overflow-hidden">
        <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-pi-border text-[10px] text-pi-dim">
          <Terminal size={12} className="text-pi-warning" />
          <span className="font-medium text-pi-muted">{t('permission.shellCommand')}</span>
          {preview.cwd && <span className="ml-auto font-mono truncate">{preview.cwd}</span>}
        </div>
        <pre className="max-h-[150px] overflow-auto p-2.5 text-xs font-mono text-pi-tool-output whitespace-pre-wrap">
          {preview.command}
        </pre>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-pi-border bg-pi-bg/50 overflow-hidden">
      <div className="flex items-center gap-2 px-2.5 py-1.5 border-b border-pi-border text-[10px] text-pi-dim">
        <FileText size={12} className="text-pi-accent" />
        <span className="font-medium text-pi-muted uppercase">{preview.operation}</span>
        <span className="font-mono truncate text-pi-text">{preview.path}</span>
      </div>
      {preview.summary && (
        <div className="px-2.5 py-1.5 text-xs text-pi-muted border-b border-pi-border/60">
          {preview.summary}
        </div>
      )}
      {preview.diff ? (
        <DiffPreview diff={preview.diff} />
      ) : (
        <div className="px-2.5 py-3 text-xs text-pi-dim">{t('permission.noPreview')}</div>
      )}
      {preview.truncated && (
        <div className="border-t border-pi-border/60 px-2.5 py-1.5 text-[10px] text-pi-warning">
          {t('permission.previewTruncated')}
        </div>
      )}
    </div>
  );
}

function DiffPreview({ diff }: { diff: string }) {
  return (
    <pre className="max-h-[180px] overflow-auto p-0 text-[11px] leading-[1.5] font-mono">
      {diff.split('\n').map((line, index) => {
        const added = line.startsWith('+') && !line.startsWith('+++');
        const removed = line.startsWith('-') && !line.startsWith('---');
        const meta = line.startsWith('@@') || line.startsWith('---') || line.startsWith('+++');
        return (
          <div
            key={index}
            className={cn(
              'px-2.5 whitespace-pre',
              added && 'bg-pi-success/10 text-pi-success',
              removed && 'bg-pi-error/10 text-pi-error',
              meta && 'bg-pi-accent/10 text-pi-accent',
              !added && !removed && !meta && 'text-pi-tool-output'
            )}
          >
            {line || ' '}
          </div>
        );
      })}
    </pre>
  );
}
