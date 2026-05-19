import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FolderOpen,
  GitBranch,
  GitFork,
  Loader2,
  Play,
  RefreshCw,
} from 'lucide-react';
import { piApi } from '../../api/client';
import type { RecentProject, RepositoryContextResult } from '../../types';
import { createSessionForProject } from '../../lib/sessionActions';
import { useUIStore } from '../../stores/uiStore';
import { useI18n } from '../../lib/i18n';
import { cn } from './utils';

export function ProjectLauncher() {
  const { t } = useI18n();
  const addToast = useUIStore((s) => s.addToast);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [projectPath, setProjectPath] = useState('');
  const [context, setContext] = useState<RepositoryContextResult | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [useWorktree, setUseWorktree] = useState(false);

  const refreshRecent = async () => {
    setLoadingRecent(true);
    try {
      const { projects } = await piApi.getRecentProjects(10);
      setRecentProjects(projects);
      if (!projectPath && projects[0]) {
        setProjectPath(projects[0].realPath || projects[0].projectPath);
        setSelectedBranch(projects[0].branch);
      }
    } catch (err) {
      addToast({
        type: 'warning',
        message: err instanceof Error ? err.message : String(err),
        duration: 5000,
      });
    } finally {
      setLoadingRecent(false);
    }
  };

  useEffect(() => {
    void refreshRecent();
  }, []);

  useEffect(() => {
    const value = projectPath.trim();
    if (!value) {
      setContext(null);
      setContextError(null);
      setContextLoading(false);
      setSelectedBranch(null);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      setContextLoading(true);
      setContextError(null);
      void piApi.getRepositoryContext(value)
        .then((result) => {
          if (cancelled) return;
          setContext(result);
          if (result.state === 'ok') {
            const fallback = result.currentBranch ?? result.defaultBranch ?? result.branches[0]?.name ?? null;
            setSelectedBranch((current) =>
              current && result.branches.some((branch) => branch.name === current || branch.remoteRef === current)
                ? current
                : fallback
            );
          } else {
            setSelectedBranch(null);
            setUseWorktree(false);
          }
        })
        .catch((err) => {
          if (cancelled) return;
          setContext(null);
          setContextError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (!cancelled) setContextLoading(false);
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [projectPath]);

  const activeBranch = useMemo(() => {
    if (context?.state !== 'ok' || !selectedBranch) return null;
    return context.branches.find((branch) => branch.name === selectedBranch || branch.remoteRef === selectedBranch) ?? null;
  }, [context, selectedBranch]);

  const launchBlocked = Boolean(
    context?.state === 'ok'
    && selectedBranch
    && selectedBranch !== context.currentBranch
    && context.dirty
    && !useWorktree
  );
  const canLaunch = Boolean(projectPath.trim()) && !contextLoading && !launchBlocked;

  const handleBrowse = async () => {
    try {
      const selected = window.piDesktop
        ? await window.piDesktop.selectProjectDirectory()
        : null;
      if (selected) {
        setProjectPath(selected);
        setSelectedBranch(null);
        setUseWorktree(false);
      }
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleLaunch = () => {
    if (!canLaunch) return;
    createSessionForProject(projectPath.trim(), {
      branch: context?.state === 'ok' ? selectedBranch : null,
      worktree: context?.state === 'ok' ? useWorktree : false,
    });
  };

  const selectRecentProject = (project: RecentProject) => {
    setProjectPath(project.realPath || project.projectPath);
    setSelectedBranch(project.branch);
    setUseWorktree(false);
  };

  const branchStatus = context?.state === 'ok'
    ? t('launcher.branchCount', {
        count: context.branches.length,
        suffix: context.branches.length === 1 ? '' : 'es',
      })
    : context?.state === 'not_git_repo'
      ? t('launcher.notGit')
      : context?.state === 'missing_workdir'
        ? t('launcher.folderMissing')
        : contextError ?? null;

  return (
    <div className="w-full rounded-lg border border-pi-border bg-pi-bg-secondary shadow-xl shadow-black/15 text-left overflow-hidden">
      <div className="border-b border-pi-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-pi-text">{t('launcher.title')}</div>
            <div className="mt-0.5 text-xs text-pi-dim">{t('launcher.subtitle')}</div>
          </div>
          <button
            onClick={() => void refreshRecent()}
            className="h-8 w-8 rounded-md flex items-center justify-center text-pi-muted hover:text-pi-text hover:bg-pi-bg-hover transition-colors"
            title={t('launcher.refresh')}
          >
            {loadingRecent ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          </button>
        </div>
      </div>

      <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_230px]">
        <div className="p-4">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-pi-dim">{t('launcher.workspace')}</label>
          <div className="mt-2 flex gap-2">
            <div className="relative flex-1 min-w-0">
              <FolderOpen size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-pi-dim" />
              <input
                value={projectPath}
                onChange={(event) => {
                  setProjectPath(event.target.value);
                  setSelectedBranch(null);
                  setUseWorktree(false);
                }}
                placeholder={t('launcher.pathPlaceholder')}
                className="h-9 w-full rounded-md border border-pi-border bg-pi-bg-tertiary pl-9 pr-3 text-xs text-pi-text placeholder:text-pi-dim focus:outline-none focus:border-pi-accent"
              />
            </div>
            <button
              onClick={handleBrowse}
              className="h-9 rounded-md border border-pi-border px-3 text-xs text-pi-muted hover:text-pi-text hover:bg-pi-bg-hover transition-colors"
            >
              {t('launcher.browse')}
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-pi-dim">
            {contextLoading ? (
              <span className="inline-flex items-center gap-1.5">
                <Loader2 size={13} className="animate-spin" /> {t('launcher.readingRepo')}
              </span>
            ) : context?.state === 'ok' ? (
              <>
                <span className="inline-flex items-center gap-1.5 text-pi-muted">
                  <CheckCircle2 size={13} className="text-pi-success" />
                  {context.repoName}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <GitBranch size={13} />
                  {branchStatus}
                </span>
                {context.dirty && <span className="text-pi-warning">{t('launcher.uncommitted')}</span>}
              </>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <AlertCircle size={13} />
                {branchStatus ?? t('launcher.enterPath')}
              </span>
            )}
          </div>

          {context?.state === 'ok' && (
            <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <label className="min-w-0">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-pi-dim">{t('launcher.branch')}</span>
                <select
                  value={selectedBranch ?? ''}
                  onChange={(event) => setSelectedBranch(event.target.value || null)}
                  className="mt-2 h-9 w-full rounded-md border border-pi-border bg-pi-bg-tertiary px-3 text-xs text-pi-text focus:outline-none focus:border-pi-accent"
                >
                  {context.branches.map((branch) => (
                    <option key={`${branch.name}-${branch.remoteRef ?? 'local'}`} value={branch.name}>
                      {branch.name}{branch.current
                        ? ` (${t('launcher.branchCurrent')})`
                        : branch.checkedOut
                          ? ` (${t('launcher.branchCheckedOut')})`
                          : branch.remote && !branch.local
                            ? ` (${t('launcher.branchRemote')})`
                            : ''}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex items-end gap-2 pb-2 text-xs text-pi-muted">
                <input
                  type="checkbox"
                  checked={useWorktree}
                  onChange={(event) => setUseWorktree(event.target.checked)}
                  className="h-4 w-4 accent-pi-accent"
                />
                <span className="inline-flex items-center gap-1.5">
                  <GitFork size={14} />
                  {t('launcher.isolatedWorktree')}
                </span>
              </label>
            </div>
          )}

          {launchBlocked && (
            <div className="mt-3 flex items-center gap-2 rounded-md border border-pi-warning/30 bg-pi-warning/10 px-3 py-2 text-[11px] text-pi-warning">
              <AlertCircle size={14} />
              {t('launcher.dirtyWarning')}
            </div>
          )}

          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="min-w-0 text-[11px] text-pi-dim">
              {activeBranch?.remote && !activeBranch.local ? t('launcher.remoteMaterialize') : t('launcher.launchImmediate')}
            </div>
            <button
              onClick={handleLaunch}
              disabled={!canLaunch}
              className="h-9 shrink-0 inline-flex items-center gap-2 rounded-md bg-pi-accent px-4 text-xs font-semibold text-white hover:bg-pi-accent/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Play size={14} />
              {t('launcher.launch')}
            </button>
          </div>
        </div>

        <div className="border-t border-pi-border bg-pi-bg/40 p-3 md:border-l md:border-t-0">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-pi-dim">
            <Clock size={12} />
            {t('launcher.recent')}
          </div>

          <div className="space-y-1.5">
            {recentProjects.length === 0 && !loadingRecent ? (
              <div className="rounded-md border border-dashed border-pi-border px-3 py-5 text-center text-xs text-pi-dim">
                {t('launcher.noRecent')}
              </div>
            ) : recentProjects.slice(0, 6).map((project) => {
              const selected = (project.realPath || project.projectPath) === projectPath;
              return (
                <button
                  key={project.realPath}
                  onClick={() => selectRecentProject(project)}
                  className={cn(
                    'w-full rounded-md border px-2.5 py-2 text-left transition-colors',
                    selected
                      ? 'border-pi-accent/50 bg-pi-accent/10'
                      : 'border-transparent hover:border-pi-border hover:bg-pi-bg-hover'
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs font-medium text-pi-text">
                      {project.projectName}
                    </span>
                    {project.branch && (
                      <span className="max-w-[92px] truncate rounded bg-pi-bg-tertiary px-1.5 py-0.5 text-[9px] text-pi-dim">
                        {project.branch}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 truncate font-mono text-[10px] text-pi-dim">
                    {project.realPath}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
