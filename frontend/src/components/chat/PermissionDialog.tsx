import { useChatStore } from '../../stores/chatStore';
import { piApi } from '../../api/client';
import type { PermissionRequest } from '../../types';
import { Shield, AlertTriangle, Check, X, CheckCheck } from 'lucide-react';
import { cn } from '../shared/utils';

export function PermissionOverlay() {
  const pendingPermission = useChatStore((s) => s.pendingPermission);
  const setPendingPermission = useChatStore((s) => s.setPendingPermission);

  if (!pendingPermission) return null;

  const { requestId, toolName, message, risk, args, sessionId } = pendingPermission;

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
      response: { action: 'always_allow', requestId },
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
                Permission Required
              </span>
              <span
                className={cn(
                  'text-[10px] px-1.5 py-0.5 rounded font-medium uppercase',
                  risk === 'high' ? 'bg-pi-error/20 text-pi-error' :
                  risk === 'medium' ? 'bg-pi-warning/20 text-pi-warning' :
                  'bg-pi-accent/20 text-pi-accent'
                )}
              >
                {risk} risk
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-pi-dim">
              <span className="font-mono text-pi-accent">{toolName}</span>
              <span>wants to execute</span>
            </div>
            {message && (
              <p className="text-xs text-pi-muted mt-1 leading-relaxed">{message}</p>
            )}
          </div>
        </div>

        {/* Arguments preview */}
        <div className="mb-3">
          <pre className="text-xs bg-pi-bg/50 rounded-lg p-2.5 overflow-x-auto font-mono text-pi-tool-output max-h-[120px] overflow-y-auto">
            {JSON.stringify(args, null, 2)}
          </pre>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleAllow}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-pi-accent text-white hover:bg-pi-accent/90 transition-colors"
          >
            <Check size={13} />
            Allow Once
          </button>
          <button
            onClick={handleAlwaysAllow}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-pi-success/20 text-pi-success hover:bg-pi-success/30 transition-colors"
          >
            <CheckCheck size={13} />
            Always Allow
          </button>
          <button
            onClick={handleDeny}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-pi-error/20 text-pi-error hover:bg-pi-error/30 transition-colors ml-auto"
          >
            <X size={13} />
            Deny
          </button>
        </div>
      </div>
    </div>
  );
}
