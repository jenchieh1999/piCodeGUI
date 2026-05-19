import { useEffect, useState } from 'react';
import type { ToolCall } from '../../types';
import { cn, truncateMiddle } from '../shared/utils';
import {
  ChevronDown,
  ChevronRight,
  Terminal,
  FileText,
  Pencil,
  CheckCircle,
  XCircle,
  Loader,
  Wrench,
} from 'lucide-react';

interface ToolCallCardProps {
  toolCall: ToolCall;
}

const TOOL_ICONS: Record<string, typeof Terminal> = {
  bash: Terminal,
  read: FileText,
  write: Pencil,
  edit: Pencil,
  grep: FileText,
  find: FileText,
  ls: FileText,
};

const STATUS_STYLES: Record<string, { bg: string; border: string; icon: typeof CheckCircle }> = {
  pending: { bg: 'bg-pi-tool-pending-bg', border: 'border-pi-border-muted', icon: Loader },
  running: { bg: 'bg-pi-tool-pending-bg', border: 'border-pi-accent/30', icon: Loader },
  success: { bg: 'bg-pi-tool-success-bg', border: 'border-pi-success/30', icon: CheckCircle },
  error: { bg: 'bg-pi-tool-error-bg', border: 'border-pi-error/30', icon: XCircle },
};

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [expanded, setExpanded] = useState(toolCall.status === 'error');
  const statusStyle = STATUS_STYLES[toolCall.status] ?? STATUS_STYLES.pending;
  const StatusIcon = statusStyle.icon;
  const ToolIcon = TOOL_ICONS[toolCall.name] ?? Wrench;

  useEffect(() => {
    if (toolCall.status === 'error') {
      setExpanded(true);
    }
  }, [toolCall.status]);

  // Format tool arguments for display
  const argsPreview = Object.entries(toolCall.args)
    .map(([k, v]) => `${k}=${truncateMiddle(String(v), 60)}`)
    .join(', ');

  const resultText = toolCall.result?.content ?? '';

  return (
    <div
      className={cn(
        'border rounded-md overflow-hidden my-1.5 transition-colors',
        statusStyle.border,
        statusStyle.bg
      )}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-xs hover:bg-pi-bg-hover/50 transition-colors"
      >
        {expanded ? (
          <ChevronDown size={11} className="text-pi-dim flex-shrink-0" />
        ) : (
          <ChevronRight size={11} className="text-pi-dim flex-shrink-0" />
        )}
        <StatusIcon
          size={12}
          className={cn(
            'flex-shrink-0',
            toolCall.status === 'success' && 'text-pi-success',
            toolCall.status === 'error' && 'text-pi-error',
            toolCall.status === 'running' && 'text-pi-accent animate-spin',
            toolCall.status === 'pending' && 'text-pi-dim'
          )}
        />
        <ToolIcon size={12} className="text-pi-tool-title flex-shrink-0" />
        <span className="font-medium text-pi-tool-title">{toolCall.name}</span>
        <span className="text-pi-dim truncate flex-1 text-left">
          {argsPreview || '(no args)'}
        </span>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-2.5 pb-2 space-y-1.5">
          {/* Arguments */}
          {Object.keys(toolCall.args).length > 0 && (
            <div>
              <div className="text-[10px] font-semibold text-pi-dim uppercase mb-1">
                Arguments
              </div>
              <pre className="text-xs bg-pi-bg/50 rounded p-2 overflow-x-auto font-mono text-pi-tool-output">
                {JSON.stringify(toolCall.args, null, 2)}
              </pre>
            </div>
          )}

          {/* Result */}
          {resultText && (
            <div>
              <div className="text-[10px] font-semibold text-pi-dim uppercase mb-1">
                {toolCall.status === 'error' ? 'Error' : 'Result'}
              </div>
              <pre
                className={cn(
                  'text-xs rounded p-2 overflow-x-auto font-mono max-h-[300px] overflow-y-auto',
                  toolCall.status === 'error'
                    ? 'bg-pi-error/10 text-pi-error'
                    : 'bg-pi-bg/50 text-pi-tool-output'
                )}
              >
                {resultText}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
