import { useChatStore } from '../../stores/chatStore';
import { useUIStore } from '../../stores/uiStore';
import { cn } from '../shared/utils';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';

export function TabBar() {
  const sessions = useChatStore((s) => s.sessions);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const setActiveSession = useChatStore((s) => s.setActiveSession);
  const removeSession = useChatStore((s) => s.removeSession);
  const sessionStatuses = useChatStore((s) => s.sessionStatuses);
  const activeView = useUIStore((s) => s.activeView);
  const setActiveView = useUIStore((s) => s.setActiveView);

  // Only show open sessions (recently active)
  const openSessions = sessions.slice(0, 10);

  const handleClose = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const status = sessionStatuses[sessionId];
    if (status === 'running') {
      if (confirm('This session is still running. Stop and close?')) {
        removeSession(sessionId);
      }
    } else {
      removeSession(sessionId);
    }
  };

  return (
    <div className="flex items-center h-9 bg-pi-bg-secondary border-b border-pi-border px-1 gap-0.5 overflow-x-auto scrollbar-none">
      {/* Scroll left */}
      <button className="flex-shrink-0 w-6 h-6 flex items-center justify-center text-pi-dim hover:text-pi-text rounded">
        <ChevronLeft size={14} />
      </button>

      {/* Tabs */}
      <div className="flex-1 flex items-center gap-0.5 overflow-hidden">
        {openSessions.map((session) => {
          const isActive = session.id === activeSessionId && activeView === 'chat';
          const status = sessionStatuses[session.id] ?? session.status;
          const isRunning = status === 'running';

          return (
            <button
              key={session.id}
              onClick={() => {
                setActiveSession(session.id);
                setActiveView('chat');
              }}
              className={cn(
                'group flex items-center gap-1.5 h-7 px-2.5 rounded-md text-xs font-medium transition-colors flex-shrink-0 max-w-[180px]',
                isActive
                  ? 'bg-pi-bg text-pi-text'
                  : 'text-pi-muted hover:bg-pi-bg-hover hover:text-pi-text'
              )}
            >
              {/* Status dot */}
              {isRunning ? (
                <div className="w-1.5 h-1.5 rounded-full bg-pi-success pulse-dot flex-shrink-0" />
              ) : (
                <div className="w-1.5 h-1.5 rounded-full border border-pi-dim flex-shrink-0" />
              )}
              <span className="truncate">{session.title}</span>
              <button
                onClick={(e) => handleClose(session.id, e)}
                className="flex-shrink-0 w-4 h-4 rounded-sm flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-pi-bg-hover text-pi-dim hover:text-pi-text transition-all"
              >
                <X size={11} />
              </button>
            </button>
          );
        })}
      </div>

      {/* Scroll right */}
      <button className="flex-shrink-0 w-6 h-6 flex items-center justify-center text-pi-dim hover:text-pi-text rounded">
        <ChevronRight size={14} />
      </button>
    </div>
  );
}
