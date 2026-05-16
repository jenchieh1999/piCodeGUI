import { useUIStore, type Toast } from '../../stores/uiStore';
import { cn } from '../shared/utils';
import { X, Info, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';

const TOAST_ICONS = {
  info: Info,
  success: CheckCircle,
  warning: AlertTriangle,
  error: XCircle,
};

const TOAST_STYLES = {
  info: 'border-pi-accent/30 bg-pi-bg-secondary',
  success: 'border-pi-success/30 bg-pi-bg-secondary',
  warning: 'border-pi-warning/30 bg-pi-bg-secondary',
  error: 'border-pi-error/30 bg-pi-bg-secondary',
};

const ICON_COLORS = {
  info: 'text-pi-accent',
  success: 'text-pi-success',
  warning: 'text-pi-warning',
  error: 'text-pi-error',
};

export function ToastContainer() {
  const toasts = useUIStore((s) => s.toasts);
  const removeToast = useUIStore((s) => s.removeToast);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-10 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => {
        const Icon = TOAST_ICONS[toast.type];
        return (
          <div
            key={toast.id}
            className={cn(
              'pointer-events-auto flex items-start gap-2 px-3 py-2 rounded-lg border shadow-lg toast-enter min-w-[280px] max-w-[400px]',
              TOAST_STYLES[toast.type]
            )}
          >
            <Icon size={15} className={cn('flex-shrink-0 mt-0.5', ICON_COLORS[toast.type])} />
            <p className="flex-1 text-xs text-pi-text leading-relaxed">{toast.message}</p>
            <button
              onClick={() => removeToast(toast.id)}
              className="flex-shrink-0 text-pi-dim hover:text-pi-text transition-colors"
            >
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
