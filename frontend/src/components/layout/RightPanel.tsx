import { useUIStore } from '../../stores/uiStore';
import { useChatStore } from '../../stores/chatStore';
import type { RightPanelType } from '../../types';
import { X, GitCompare, FolderTree, Activity, Files } from 'lucide-react';
import { cn } from '../shared/utils';

const PANEL_CONFIG: Record<RightPanelType & string, { icon: typeof GitCompare; label: string }> = {
  changes: { icon: GitCompare, label: 'Changes' },
  files: { icon: Files, label: 'Files' },
  tree: { icon: FolderTree, label: 'Session Tree' },
  usage: { icon: Activity, label: 'Token Usage' },
};

interface RightPanelProps {
  type: RightPanelType;
}

export function RightPanel({ type }: RightPanelProps) {
  const setRightPanel = useUIStore((s) => s.setRightPanel);
  const activeSessionId = useChatStore((s) => s.activeSessionId);

  if (!type) return null;

  const config = PANEL_CONFIG[type];
  const Icon = config?.icon ?? GitCompare;

  return (
    <div className="h-full flex flex-col">
      {/* Panel Header */}
      <div className="flex items-center justify-between h-9 px-3 border-b border-pi-border">
        <div className="flex items-center gap-2">
          <Icon size={14} className="text-pi-muted" />
          <span className="text-xs font-medium text-pi-text">{config?.label ?? type}</span>
        </div>
        <div className="flex items-center gap-1">
          {/* Panel type switcher */}
          {Object.entries(PANEL_CONFIG).map(([key, { icon: PIcon, label }]) => (
            <button
              key={key}
              onClick={() => setRightPanel(type === key ? null : (key as RightPanelType))}
              className={cn(
                'w-6 h-6 rounded flex items-center justify-center hover:bg-pi-bg-hover transition-colors',
                type === key ? 'text-pi-accent bg-pi-selected-bg' : 'text-pi-dim'
              )}
              title={label}
            >
              <PIcon size={13} />
            </button>
          ))}
          <div className="w-px h-4 bg-pi-border mx-1" />
          <button
            onClick={() => setRightPanel(null)}
            className="w-6 h-6 rounded flex items-center justify-center hover:bg-pi-bg-hover text-pi-dim hover:text-pi-text transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Panel Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {!activeSessionId ? (
          <div className="flex flex-col items-center justify-center h-full text-pi-dim gap-2">
            <Icon size={24} strokeWidth={1} />
            <p className="text-xs">Open a session to see {config?.label.toLowerCase()}</p>
          </div>
        ) : type === 'changes' ? (
          <ChangesPanel />
        ) : type === 'files' ? (
          <FilesPanel />
        ) : type === 'tree' ? (
          <TreePanel />
        ) : type === 'usage' ? (
          <UsagePanel />
        ) : null}
      </div>
    </div>
  );
}

// Placeholder panels
function ChangesPanel() {
  return (
    <div className="text-xs text-pi-muted">
      <p className="mb-2">File changes will appear here as the AI makes edits.</p>
      <div className="flex flex-col items-center justify-center py-8 text-pi-dim gap-2">
        <GitCompare size={20} strokeWidth={1} />
        <p>No changes yet</p>
      </div>
    </div>
  );
}

function FilesPanel() {
  return (
    <div className="text-xs text-pi-muted">
      <p className="mb-2">Project files</p>
      <div className="flex flex-col items-center justify-center py-8 text-pi-dim gap-2">
        <Files size={20} strokeWidth={1} />
        <p>File browser coming soon</p>
      </div>
    </div>
  );
}

function TreePanel() {
  return (
    <div className="text-xs text-pi-muted">
      <p className="mb-2">Session branching tree</p>
      <div className="flex flex-col items-center justify-center py-8 text-pi-dim gap-2">
        <FolderTree size={20} strokeWidth={1} />
        <p>Session tree visualization coming soon</p>
      </div>
    </div>
  );
}

function UsagePanel() {
  return (
    <div className="text-xs text-pi-muted">
      <p className="mb-2">Token usage</p>
      <div className="flex flex-col items-center justify-center py-8 text-pi-dim gap-2">
        <Activity size={20} strokeWidth={1} />
        <p>Token usage analytics coming soon</p>
      </div>
    </div>
  );
}
