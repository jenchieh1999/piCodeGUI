import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Clock, FolderOpen, GitBranch, Loader2, Plus, Search } from 'lucide-react';
import { piApi } from '../../api/client';
import { createSessionForProject } from '../../lib/sessionActions';
import { useI18n } from '../../lib/i18n';
import { useChatStore } from '../../stores/chatStore';
import { useUIStore } from '../../stores/uiStore';
import type { RecentProject, Session } from '../../types';
import { cn } from '../shared/utils';

interface WorkspaceSwitcherProps {
  activeSession: Session;
  placement?: 'standalone' | 'composer' | 'toolbar';
}

interface WorkspaceOption {
  key: string;
  path: string;
  name: string;
  branch?: string | null;
  sessionId?: string;
  updatedAt: number;
  source: 'session' | 'recent';
}

export function WorkspaceSwitcher({ activeSession, placement = 'standalone' }: WorkspaceSwitcherProps) {
  const { t } = useI18n();
  const sessions = useChatStore((s) => s.sessions);
  const setActiveSession = useChatStore((s) => s.setActiveSession);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const addToast = useUIStore((s) => s.addToast);
  const [open, setOpen] = useState(false);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [query, setQuery] = useState('');

  const sessionOptions = useMemo(() => {
    const byPath = new Map<string, WorkspaceOption>();

    for (const session of sessions) {
      const key = normalizePath(session.projectPath);
      const current = byPath.get(key);
      if (!current || session.updatedAt > current.updatedAt) {
        byPath.set(key, {
          key,
          path: session.projectPath,
          name: session.projectName,
          branch: session.branch,
          sessionId: session.id,
          updatedAt: session.updatedAt,
          source: 'session',
        });
      }
    }

    return Array.from(byPath.values()).sort((a, b) => b.updatedAt - a.updatedAt);
  }, [sessions]);

  const recentOptions = useMemo(() => {
    const sessionPaths = new Set(sessionOptions.map((option) => option.key));
    return recentProjects
      .map((project): WorkspaceOption => {
        const path = project.realPath || project.projectPath;
        return {
          key: normalizePath(path),
          path,
          name: project.projectName,
          branch: project.branch,
          sessionId: project.lastSessionId,
          updatedAt: project.updatedAt,
          source: 'recent',
        };
      })
      .filter((option) => !sessionPaths.has(option.key));
  }, [recentProjects, sessionOptions]);

  const options = useMemo(() => {
    const filter = query.trim().toLowerCase();
    const combined = [...sessionOptions, ...recentOptions];
    if (!filter) return combined;
    return combined.filter((option) =>
      option.name.toLowerCase().includes(filter)
      || option.path.toLowerCase().includes(filter)
      || option.branch?.toLowerCase().includes(filter)
    );
  }, [query, recentOptions, sessionOptions]);

  useEffect(() => {
    if (!open || recentProjects.length > 0 || loadingRecent) return;
    setLoadingRecent(true);
    void piApi.getRecentProjects(8)
      .then(({ projects }) => setRecentProjects(projects))
      .catch((err) => {
        addToast({
          type: 'warning',
          message: err instanceof Error ? err.message : String(err),
          duration: 5000,
        });
      })
      .finally(() => setLoadingRecent(false));
  }, [addToast, loadingRecent, open, recentProjects.length]);

  const selectWorkspace = (option: WorkspaceOption) => {
    if (option.sessionId && sessions.some((session) => session.id === option.sessionId)) {
      setActiveSession(option.sessionId);
      setActiveView('chat');
      setOpen(false);
      return;
    }

    createSessionForProject(option.path, { branch: option.branch ?? null });
    setOpen(false);
  };

  const browseWorkspace = async () => {
    try {
      const selected = window.piDesktop
        ? await window.piDesktop.selectProjectDirectory()
        : '.';
      if (!selected) return;
      createSessionForProject(selected);
      setOpen(false);
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div
      className={cn(
        'relative bg-pi-bg',
        placement === 'standalone' && 'border-t border-pi-border px-3 py-2',
        placement === 'composer' && 'px-3 py-1',
        placement === 'toolbar' && 'min-w-[220px] flex-1 bg-transparent px-0 py-0'
      )}
    >
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div
            className={cn(
              'absolute bottom-full z-40 mb-2 w-[min(520px,calc(100vw-360px))] min-w-[320px] overflow-hidden rounded-lg border border-pi-border bg-pi-bg-secondary shadow-2xl shadow-black/30',
              placement === 'toolbar' ? 'left-0' : 'left-3'
            )}
          >
            <div className="border-b border-pi-border p-2">
              <div className="relative">
                <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-pi-dim" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('workspaceSwitcher.search')}
                  className="h-8 w-full rounded-md border border-pi-border bg-pi-bg-tertiary pl-8 pr-3 text-xs text-pi-text placeholder:text-pi-dim focus:border-pi-accent focus:outline-none"
                  autoFocus
                />
              </div>
            </div>

            <div className="max-h-[320px] overflow-y-auto py-1">
              {options.map((option) => (
                <WorkspaceOptionRow
                  key={`${option.source}-${option.key}`}
                  option={option}
                  active={normalizePath(activeSession.projectPath) === option.key}
                  onSelect={() => selectWorkspace(option)}
                />
              ))}

              {loadingRecent && (
                <div className="flex items-center gap-2 px-3 py-2 text-xs text-pi-dim">
                  <Loader2 size={13} className="animate-spin" />
                  {t('workspaceSwitcher.loadingRecent')}
                </div>
              )}

              {!loadingRecent && options.length === 0 && (
                <div className="px-3 py-3 text-xs text-pi-dim">{t('workspaceSwitcher.noMatching')}</div>
              )}
            </div>

            <div className="border-t border-pi-border p-2">
              <button
                onClick={() => void browseWorkspace()}
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs font-medium text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
              >
                <Plus size={13} className="text-pi-accent" />
                {t('workspaceSwitcher.browseStart')}
              </button>
            </div>
          </div>
        </>
      )}

      <button
        onClick={() => setOpen((current) => !current)}
        className={cn(
          'flex w-full items-center gap-2 rounded-md border text-left text-xs transition-colors',
          placement === 'toolbar' ? 'h-7 max-w-none px-2' : 'mx-auto h-8 max-w-3xl px-3',
          open
            ? 'border-pi-accent/50 bg-pi-accent/10 text-pi-text'
            : 'border-pi-border bg-pi-bg-secondary text-pi-muted hover:bg-pi-bg-hover hover:text-pi-text'
        )}
        title={activeSession.projectPath}
      >
        <FolderOpen size={14} className="flex-shrink-0 text-pi-accent" />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium text-pi-text">{activeSession.projectName}</span>
          <span className="ml-2 text-pi-dim">{activeSession.projectPath}</span>
        </span>
        {activeSession.branch && (
          <span className="hidden max-w-[160px] items-center gap-1 truncate rounded bg-pi-bg-tertiary px-1.5 py-0.5 text-[10px] text-pi-dim sm:inline-flex">
            <GitBranch size={10} />
            {activeSession.branch}
          </span>
        )}
        <span className="text-[10px] font-medium text-pi-dim">{t('workspaceSwitcher.switch')}</span>
        <ChevronDown size={14} className={cn('flex-shrink-0 transition-transform', open && 'rotate-180')} />
      </button>
    </div>
  );
}

function WorkspaceOptionRow({
  option,
  active,
  onSelect,
}: {
  option: WorkspaceOption;
  active: boolean;
  onSelect: () => void;
}) {
  const { t } = useI18n();
  return (
    <button
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-2 px-3 py-2 text-left transition-colors',
        active ? 'bg-pi-selected-bg text-pi-text' : 'text-pi-muted hover:bg-pi-bg-hover hover:text-pi-text'
      )}
      title={option.path}
    >
      {option.source === 'recent' ? (
        <Clock size={14} className="mt-0.5 flex-shrink-0 text-pi-dim" />
      ) : (
        <FolderOpen size={14} className="mt-0.5 flex-shrink-0 text-pi-accent" />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-xs font-medium text-pi-text">{option.name}</span>
          {active && <span className="rounded bg-pi-accent/10 px-1.5 py-0.5 text-[9px] text-pi-accent">{t('workspaceSwitcher.active')}</span>}
        </span>
        <span className="mt-0.5 block truncate font-mono text-[10px] text-pi-dim">{option.path}</span>
      </span>
      {option.branch && (
        <span className="mt-0.5 inline-flex max-w-[120px] items-center gap-1 truncate rounded bg-pi-bg-tertiary px-1.5 py-0.5 text-[10px] text-pi-dim">
          <GitBranch size={10} />
          {option.branch}
        </span>
      )}
    </button>
  );
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}
