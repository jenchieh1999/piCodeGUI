import { useEffect, useMemo, useState } from 'react';
import type React from 'react';
import { useChatStore } from '../../stores/chatStore';
import { useUIStore } from '../../stores/uiStore';
import { useExtensionStore } from '../../stores/extensionStore';
import { useModelStore } from '../../stores/modelStore';
import { useTaskStore } from '../../stores/taskStore';
import { useAgentStore } from '../../stores/agentStore';
import { piApi } from '../../api/client';
import type { Session, SessionGroup } from '../../types';
import { useI18n } from '../../lib/i18n';
import { createNewSessionFromPicker } from '../../lib/sessionActions';
import {
  Plus,
  Search,
  Settings,
  Package,
  Puzzle,
  FolderOpen,
  MessageSquare,
  Trash2,
  Edit3,
  GitBranch,
  Bot,
  CalendarClock,
  Moon,
  RadioTower,
  Terminal,
  Users,
  Wrench,
} from 'lucide-react';
import { cn } from '../shared/utils';

export function Sidebar() {
  const { t } = useI18n();
  const sessions = useChatStore((s) => s.sessions);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const setActiveSession = useChatStore((s) => s.setActiveSession);
  const sessionStatuses = useChatStore((s) => s.sessionStatuses);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const activeView = useUIStore((s) => s.activeView);
  const rightPanelType = useUIStore((s) => s.rightPanelType);
  const setRightPanel = useUIStore((s) => s.setRightPanel);
  const settingsTab = useUIStore((s) => s.settingsTab);
  const setSettingsTab = useUIStore((s) => s.setSettingsTab);
  const availableModels = useModelStore((s) => s.availableModels);
  const skills = useExtensionStore((s) => s.skills);
  const tasks = useTaskStore((s) => s.tasks);
  const agents = useAgentStore((s) => s.agents);
  const loadAgents = useAgentStore((s) => s.loadAgents);

  const [searchQuery, setSearchQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ sessionId: string; x: number; y: number } | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [channelStats, setChannelStats] = useState<{ total: number; enabled: number } | null>(null);

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
      if (diff < dayMs) addToGroup(t('sidebar.today'), s);
      else if (diff < 2 * dayMs) addToGroup(t('sidebar.yesterday'), s);
      else if (diff < 7 * dayMs) addToGroup(t('sidebar.last7'), s);
      else if (diff < 30 * dayMs) addToGroup(t('sidebar.last30'), s);
      else addToGroup(t('sidebar.older'), s);
    });

    return groups;
  }, [sessions, searchQuery, projectFilter, t]);

  // Project list for filter
  const projects = useMemo(() => {
    const set = new Set(sessions.map((s) => s.projectPath));
    return Array.from(set).sort();
  }, [sessions]);

  const runningAgents = sessions.filter((session) => (sessionStatuses[session.id] ?? session.status) === 'running').length;
  const erroredAgents = sessions.filter((session) => (sessionStatuses[session.id] ?? session.status) === 'error').length;
  const enabledSkills = skills.filter((skill) => skill.enabled).length;
  const enabledTasks = tasks.filter((task) => task.enabled).length;

  useEffect(() => {
    let disposed = false;
    void loadAgents().catch(() => undefined);
    void piApi.getChannels()
      .then(({ channels }) => {
        if (disposed) return;
        setChannelStats({
          total: channels.length,
          enabled: channels.filter((channel) => channel.enabled).length,
        });
      })
      .catch(() => {
        if (!disposed) setChannelStats(null);
      });
    return () => {
      disposed = true;
    };
  }, [loadAgents]);

  const handleNewSession = () => {
    void createNewSessionFromPicker();
  };

  const openSettingsTab = (tab: string) => {
    setSettingsTab(tab);
    setActiveView('settings');
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
    setRenamingSessionId(sessionId);
    setRenameDraft(session.title);
    setContextMenu(null);
  };

  const cancelRename = () => {
    setRenamingSessionId(null);
    setRenameDraft('');
  };

  const commitRename = () => {
    if (!renamingSessionId) return;
    const session = sessions.find((s) => s.id === renamingSessionId);
    const title = renameDraft.trim();
    if (session && title && title !== session.title) {
      piApi.send({ type: 'session_rename', sessionId: renamingSessionId, title });
    }
    cancelRename();
  };

  return (
    <div className="h-full flex flex-col">
      {/* ClawX-style action rail */}
      <div className="border-b border-pi-border/70 px-2 py-2">
        <div className="space-y-1">
          <SidebarActionButton
            icon={Plus}
            label={t('sidebar.newSession')}
            active={false}
            primary
            onClick={handleNewSession}
          />
          <SidebarActionButton
            icon={Bot}
            label={t('nav.model')}
            active={activeView === 'settings' && settingsTab === 'model'}
            badge={availableModels.length > 0 ? String(availableModels.length) : undefined}
            onClick={() => openSettingsTab('model')}
          />
          <SidebarActionButton
            icon={RadioTower}
            label={t('nav.channels')}
            active={activeView === 'settings' && settingsTab === 'channels'}
            badge={channelStats ? `${channelStats.enabled}/${channelStats.total}` : undefined}
            onClick={() => openSettingsTab('channels')}
          />
          <SidebarActionButton
            icon={Users}
            label={t('nav.agents')}
            active={activeView === 'agents'}
            badge={erroredAgents > 0 ? String(erroredAgents) : runningAgents > 0 ? String(runningAgents) : String(agents.length + 1)}
            badgeTone={erroredAgents > 0 ? 'error' : runningAgents > 0 ? 'active' : undefined}
            onClick={() => setActiveView('agents')}
          />
          <SidebarActionButton
            icon={Wrench}
            label={t('nav.skills')}
            active={activeView === 'skills'}
            badge={skills.length > 0 ? `${enabledSkills}/${skills.length}` : undefined}
            onClick={() => setActiveView('skills')}
          />
          <SidebarActionButton
            icon={CalendarClock}
            label={t('nav.scheduledTasks')}
            active={activeView === 'tasks'}
            badge={tasks.length > 0 ? `${enabledTasks}/${tasks.length}` : undefined}
            onClick={() => setActiveView('tasks')}
          />
          <SidebarActionButton
            icon={Moon}
            label={t('nav.themes')}
            active={activeView === 'themes'}
            onClick={() => setActiveView('themes')}
          />
          <SidebarActionButton
            icon={Package}
            label={t('nav.packages')}
            active={activeView === 'packages'}
            onClick={() => setActiveView('packages')}
          />
          <SidebarActionButton
            icon={Puzzle}
            label={t('nav.extensions')}
            active={activeView === 'extensions'}
            onClick={() => setActiveView('extensions')}
          />
          <SidebarActionButton
            icon={Terminal}
            label={t('nav.terminal')}
            active={rightPanelType === 'terminal'}
            onClick={() => {
              setActiveView('chat');
              setRightPanel(rightPanelType === 'terminal' ? null : 'terminal');
            }}
          />
        </div>
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <div className="relative">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-pi-dim" />
          <input
            type="text"
            placeholder={t('sidebar.search')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pi-glass-control h-8 w-full rounded-lg pl-7 pr-2 text-xs text-pi-text
                       placeholder-pi-dim transition-colors focus:border-pi-accent focus:outline-none"
          />
        </div>
      </div>

      {/* Project Filter */}
      {projects.length > 1 && (
        <div className="px-3 pb-2">
          <select
            value={projectFilter ?? ''}
            onChange={(e) => setProjectFilter(e.target.value || null)}
            className="pi-glass-control h-8 w-full rounded-lg px-2 text-xs text-pi-muted
                       focus:border-pi-accent focus:outline-none"
          >
            <option value="">{t('sidebar.allProjects')}</option>
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
                ? t('sidebar.noSessions')
                : t('sidebar.noMatching')}
            </p>
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.label} className="mb-3">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-pi-dim/90">
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
                      'pi-sidebar-row group flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-2 transition-colors',
                      isActive
                        ? 'border-pi-accent/20 bg-pi-accent/10 text-pi-text shadow-sm shadow-black/10'
                        : 'border-transparent text-pi-muted hover:border-pi-border/70 hover:bg-pi-bg-hover/80 hover:text-pi-text'
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
                      {renamingSessionId === session.id ? (
                        <input
                          value={renameDraft}
                          onChange={(event) => setRenameDraft(event.target.value)}
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') commitRename();
                            if (event.key === 'Escape') cancelRename();
                          }}
                          onBlur={commitRename}
                          autoFocus
                          className="h-6 w-full rounded-md border border-pi-accent bg-pi-bg px-1.5 text-xs font-medium text-pi-text outline-none"
                        />
                      ) : (
                        <div className="text-xs font-medium truncate">{session.title}</div>
                      )}
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
                    <span className="flex-shrink-0 rounded border border-pi-border/60 bg-pi-bg-tertiary/70 px-1.5 py-0.5 text-[9px] text-pi-dim opacity-0 transition-opacity group-hover:opacity-100">
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
      <div className="space-y-1 border-t border-pi-border/70 p-2">
        <SidebarActionButton
          icon={Settings}
          label={t('nav.settings')}
          active={activeView === 'settings'}
          onClick={() => openSettingsTab('general')}
        />
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
            className="pi-glass-menu fixed z-50 w-40 rounded-lg py-1"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              className="mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-md px-3 py-1.5 text-xs text-pi-text hover:bg-pi-bg-hover"
              onClick={() => handleRenameSession(contextMenu.sessionId)}
            >
              <Edit3 size={12} /> {t('sidebar.rename')}
            </button>
            <button
              className="mx-1 flex w-[calc(100%-0.5rem)] items-center gap-2 rounded-md px-3 py-1.5 text-xs text-pi-error hover:bg-pi-bg-hover"
              onClick={(e) => handleDeleteSession(contextMenu.sessionId, e)}
            >
              <Trash2 size={12} /> {t('sidebar.delete')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function SidebarActionButton({
  icon: Icon,
  label,
  active,
  primary,
  badge,
  badgeTone,
  onClick,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  active: boolean;
  primary?: boolean;
  badge?: string;
  badgeTone?: 'active' | 'error';
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'group flex h-9 w-full items-center gap-2 rounded-lg border px-2 text-left text-xs font-semibold transition-colors',
        primary
          ? 'border-pi-border/70 bg-pi-bg-tertiary/80 text-pi-text hover:bg-pi-bg-hover'
          : active
            ? 'border-pi-accent/30 bg-pi-accent/10 text-pi-accent'
            : 'border-transparent text-pi-muted hover:border-pi-border/70 hover:bg-pi-bg-hover/80 hover:text-pi-text'
      )}
      title={label}
    >
      <Icon size={15} className={cn('flex-shrink-0', primary ? 'text-pi-text' : 'text-pi-dim group-hover:text-pi-muted')} />
      <span className="min-w-0 truncate">{label}</span>
      {badge && (
        <span
          className={cn(
            'ml-auto flex-shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] font-semibold leading-none',
            badgeTone === 'error'
              ? 'border-pi-error/20 bg-pi-error/10 text-pi-error'
              : badgeTone === 'active'
                ? 'border-pi-accent/20 bg-pi-accent/10 text-pi-accent'
                : 'border-pi-border/60 bg-pi-bg-tertiary/70 text-pi-dim'
          )}
        >
          {badge}
        </span>
      )}
    </button>
  );
}
