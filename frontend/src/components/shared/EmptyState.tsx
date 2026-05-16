import { useUIStore } from '../../stores/uiStore';
import { useChatStore } from '../../stores/chatStore';
import { piApi } from '../../api/client';
import { Plus, FolderOpen, MessageSquare, Sparkles } from 'lucide-react';

export function EmptyState() {
  const setActiveView = useUIStore((s) => s.setActiveView);
  const sessions = useChatStore((s) => s.sessions);

  const handleNewSession = () => {
    piApi.send({ type: 'session_create', projectPath: '.' });
  };

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="max-w-md w-full px-4 text-center">
        {/* Central visual */}
        <div className="mb-8">
          <div className="w-20 h-20 rounded-2xl bg-pi-accent/5 border border-pi-accent/10 flex items-center justify-center mx-auto mb-4">
            <Sparkles size={36} className="text-pi-accent/40" />
          </div>
          <h2 className="text-lg font-display font-semibold text-pi-text mb-1">
            Pi Desktop
          </h2>
          <p className="text-sm text-pi-dim max-w-sm mx-auto">
            A modern desktop workspace for the pi coding agent.
            Start a new session or pick up where you left off.
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2 items-center">
          <button
            onClick={handleNewSession}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-pi-accent text-white
                       hover:bg-pi-accent/90 transition-all font-medium text-sm shadow-lg shadow-pi-accent/20"
          >
            <Plus size={16} />
            New Session
          </button>

          {sessions.length > 0 && (
            <button
              onClick={() => {
                if (sessions[0]) {
                  useChatStore.getState().setActiveSession(sessions[0].id);
                  setActiveView('chat');
                }
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm text-pi-muted
                         hover:text-pi-text hover:bg-pi-bg-hover transition-all"
            >
              <MessageSquare size={15} />
              Continue last session
            </button>
          )}

          <button
            onClick={() => setActiveView('settings')}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm text-pi-dim
                       hover:text-pi-muted transition-all"
          >
            <FolderOpen size={15} />
            Open project folder
          </button>
        </div>

        {/* Keyboard shortcuts */}
        <div className="mt-8 flex items-center justify-center gap-4 text-[10px] text-pi-dim">
          <span><kbd className="px-1 py-0.5 rounded bg-pi-bg-tertiary border border-pi-border font-mono">Ctrl+N</kbd> New session</span>
          <span><kbd className="px-1 py-0.5 rounded bg-pi-bg-tertiary border border-pi-border font-mono">Ctrl+L</kbd> Switch model</span>
        </div>
      </div>
    </div>
  );
}
