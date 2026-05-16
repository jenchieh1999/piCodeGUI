import { useState, useMemo } from 'react';
import { useChatStore } from '../../stores/chatStore';
import { useUIStore } from '../../stores/uiStore';
import { useModelStore } from '../../stores/modelStore';
import { piApi } from '../../api/client';
import type { Session, SessionGroup } from '../../types';
import {
  Plus,
  Search,
  Settings,
  Package,
  Palette,
  Puzzle,
  Clock,
  FolderOpen,
  MessageSquare,
  Trash2,
  Edit3,
  ExternalLink,
  GitBranch,
  MoreHorizontal,
} from 'lucide-react';
import { cn } from '../shared/utils';

export function Sidebar() {
  const sessions = useChatStore((s) => s.sessions);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const setActiveSession = useChatStore((s) => s.setActiveSession);
  const sessionStatuses = useChatStore((s) => s.sessionStatuses);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const activeView = useUIStore((s) => s.activeView);

  const [searchQuery, setSearchQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ sessionId: string; x: number; y: number } | null>(null);

  // Group sessions by time
  const groups = useMemo(() => {
    const filtered = sessions
      .filter((s) => {
        if (projectFilter && s.projectPath !== projectFilter) return false;
        if (searchQuery && !s.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
        return true;
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);

    const groups: SessionGroup[] = [];
    const now = Date.now();
    const dayMs = 86400000;

    const addToGroup = (label: string, session: Session) => {
      let group = groups.find((g) => g.label === label);
      if (!group) {
        group = { label, sessions: [] };
        groups.push(group);
      }
      group.sessions.push(session);
    };

    filtered.forEach((s) => {
      const diff = now - s.updatedAt;
      if (diff < dayMs) addToGroup('Today', s);
      else if (diff < 2 * dayMs) addToGroup('Yesterday', s);
      else if (diff < 7 * dayMs) addToGroup('Last 7 days', s);
      else if (diff < 30 * dayMs) addToGroup('Last 30 days', s);
      else addToGroup('Older', s);
    });

    return groups;
  }, [sessions, searchQuery, projectFilter]);

  // Project list for filter
  const projects = useMemo(() => {
    const set = new Set(sessions.map((s) => s.projectPath));
    return Array.from(set).sort();
  }, [sessions]);

  const handleNewSession = () => {
    // For now, create with current directory
    piApi.send({ type: 'session_create', projectPath: '.' });
  };

  const handleSelectSession = (sessionId: string) => {
    setActiveSession(sessionId);
    setActiveView('chat');
  };

  const handleDeleteSession = (sessionId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    piApi.send({ type: 'session_delete', sessionId });
    setContextMenu(null);
  };

  const handleRenameSession = (sessionId: string) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;
    const newTitle = prompt('New title:', session.title);
    if (newTitle) {
      piApi.send({ type: 'session_rename', sessionId, title: newTitle });
    }
    setContextMenu(null);
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-pi-border">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-pi-accent flex items-center justify-center">
            <span className="text-white font-bold text-xs">π</span>
          </div>
          <span className="font-display font-semibold text-sm text-pi-text">Pi Desktop</span>
        </div>
        <button
          onClick={handleNewSession}
          className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-pi-bg-hover text-pi-muted hover:text-pi-text transition-colors"
          title="New Session (Ctrl+N)"
        >
          <Plus size={16} />
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <div className="relative">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-pi-dim" />
          <input
            type="text"
            placeholder="Search sessions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-7 pl-7 pr-2 text-xs bg-pi-bg-tertiary border border-pi-border rounded-md
                       text-pi-text placeholder-pi-dim focus:outline-none focus:border-pi-accent transition-colors"
          />
        </div>
      </div>

      {/* Project Filter */}
      {projects.length > 1 && (
        <div className="px-3 pb-2">
          <select
            value={projectFilter ?? ''}
            onChange={(e) => setProjectFilter(e.target.value || null)}
            className="w-full h-7 text-xs bg-pi-bg-tertiary border border-pi-border rounded-md
                       text-pi-muted focus:outline-none focus:border-pi-accent px-2"
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p} value={p}>{p.split('/').pop() || p}</option>
            ))}
          </select>
        </div>
      )}

      {/* Session List */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-pi-dim gap-3 px-4">
            <MessageSquare size={32} strokeWidth={1} />
            <p className="text-xs text-center">
              {sessions.length === 0
                ? 'No sessions yet.\nClick + to start.'
                : 'No matching sessions.'}
            </p>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="mb-3">
              <div className="px-2 py-1 text-[10px] font-semibold text-pi-dim uppercase tracking-wider">
                {group.label}
              </div>
              {group.sessions.map((session) => {
                const isActive = session.id === activeSessionId;
                const status = sessionStatuses[session.id] ?? session.status;
                const isRunning = status === 'running';
                const hasError = status === 'error';

                return (
                  <div
                    key={session.id}
                    onClick={() => handleSelectSession(session.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ sessionId: session.id, x: e.clientX, y: e.clientY });
                    }}
                    className={cn(
                      'group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer transition-colors',
                      isActive
                        ? 'bg-pi-selected-bg text-pi-text'
                        : 'text-pi-muted hover:bg-pi-bg-hover hover:text-pi-text'
                    )}
                  >
                    {/* Status indicator */}
                    <div className="flex-shrink-0 w-2 h-2">
                      {isRunning ? (
                        <div className="w-2 h-2 rounded-full bg-pi-success pulse-dot" />
                      ) : hasError ? (
                        <div className="w-2 h-2 rounded-full bg-pi-error" />
                      ) : (
                        <div className="w-1.5 h-1.5 rounded-full border border-pi-dim mt-0.5 ml-0.5" />
                      )}
                    </div>

                    {/* Session info */}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">{session.title}</div>
                      <div className="flex items-center gap-1 text-[10px] text-pi-dim">
                        <FolderOpen size={10} />
                        <span className="truncate">{session.projectName}</span>
                        {session.branch && (
                          <>
                            <GitBranch size={10} />
                            <span>{session.branch}</span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Model badge */}
                    <span className="flex-shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-pi-bg-tertiary text-pi-dim opacity-0 group-hover:opacity-100 transition-opacity">
                      {session.modelId}
                    </span>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>

      {/* Bottom Navigation */}
      <div className="border-t border-pi-border p-2 flex items-center gap-1">
        {[
          { icon: Settings, view: 'settings' as const, label: 'Settings' },
          { icon: Package, view: 'packages' as const, label: 'Packages' },
          { icon: Palette, view: 'themes' as const, label: 'Themes' },
          { icon: Puzzle, view: 'extensions' as const, label: 'Extensions' },
        ].map(({ icon: Icon, view, label }) => (
          <button
            key={view}
            onClick={() => setActiveView(view)}
            className={cn(
              'flex-1 h-8 rounded-md flex flex-col items-center justify-center gap-0.5 transition-colors',
              activeView === view
                ? 'bg-pi-selected-bg text-pi-accent'
                : 'text-pi-dim hover:text-pi-muted hover:bg-pi-bg-hover'
            )}
            title={label}
          >
            <Icon size={15} />
          </button>
        ))}
      </div>

      {/* Context Menu (simplified) */}
      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-50"
            onClick={() => setContextMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }}
          />
          <div
            className="fixed z-50 w-40 py-1 rounded-md border border-pi-border bg-pi-bg-secondary shadow-xl"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-pi-text hover:bg-pi-bg-hover"
              onClick={() => handleRenameSession(contextMenu.sessionId)}
            >
              <Edit3 size={12} /> Rename
            </button>
            <button
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-pi-error hover:bg-pi-bg-hover"
              onClick={(e) => handleDeleteSession(contextMenu.sessionId, e)}
            >
              <Trash2 size={12} /> Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}
