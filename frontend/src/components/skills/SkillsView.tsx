import { ArrowLeft, BookOpen, Box, CheckCircle2, Code2, Copy, Loader2, Package, Plus, RefreshCw, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useExtensionStore } from '../../stores/extensionStore';
import { useUIStore } from '../../stores/uiStore';
import { useChatStore } from '../../stores/chatStore';
import { piApi } from '../../api/client';
import { useI18n } from '../../lib/i18n';
import type { ExtensionResourceSnapshot, SkillInfo } from '../../types';
import { cn } from '../shared/utils';

type SkillFilter = 'all' | 'enabled' | 'disabled' | 'project' | 'user';
type SkillScope = 'user' | 'project';

export function SkillsView() {
  const { t } = useI18n();
  const skills = useExtensionStore((s) => s.skills);
  const packages = useExtensionStore((s) => s.packages);
  const setResourceSnapshot = useExtensionStore((s) => s.setResourceSnapshot);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const setSlashCommands = useUIStore((s) => s.setSlashCommands);
  const addToast = useUIStore((s) => s.addToast);
  const activeSession = useChatStore((s) => s.sessions.find((session) => session.id === s.activeSessionId));
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<SkillFilter>('all');
  const [selectedSkill, setSelectedSkill] = useState<SkillInfo | null>(null);
  const [skillContent, setSkillContent] = useState('');
  const [loadingContent, setLoadingContent] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createBody, setCreateBody] = useState('');
  const [createScope, setCreateScope] = useState<SkillScope>('project');

  const projectPath = activeSession?.projectPath;

  useEffect(() => {
    void reload(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath]);

  const filtered = useMemo(() => {
    const lowerQuery = query.trim().toLowerCase();
    return skills
      .filter((skill) => {
        if (filter === 'enabled' && !skill.enabled) return false;
        if (filter === 'disabled' && skill.enabled) return false;
        if (filter === 'project' && skill.scope !== 'project') return false;
        if (filter === 'user' && skill.scope !== 'user') return false;
        if (!lowerQuery) return true;
        return `${skill.name} ${skill.description} ${skill.filePath} ${skill.scope} ${skill.sourceName ?? ''}`.toLowerCase().includes(lowerQuery);
      })
      .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));
  }, [filter, query, skills]);

  const enabledCount = skills.filter((skill) => skill.enabled).length;

  const applySnapshot = (snapshot: ExtensionResourceSnapshot) => {
    setResourceSnapshot(snapshot);
    setSlashCommands(Array.isArray(snapshot.slashCommands) ? snapshot.slashCommands : []);
  };

  const reload = async (showToast = true) => {
    setIsReloading(true);
    try {
      applySnapshot(await piApi.reloadExtensionResources(projectPath));
      if (showToast) addToast({ type: 'success', message: t('extensions.reloadSuccess') });
    } catch (err) {
      addToast({ type: 'error', message: t('extensions.reloadFailed', { message: errorMessage(err) }) });
    } finally {
      setIsReloading(false);
    }
  };

  const openSkill = async (skill: SkillInfo) => {
    setSelectedSkill(skill);
    setSkillContent('');
    setLoadingContent(true);
    try {
      const result = await piApi.getSkillContent(skill.filePath, projectPath);
      setSkillContent(result.content);
    } catch (err) {
      addToast({ type: 'error', message: t('skills.loadContentFailed', { message: errorMessage(err) }) });
    } finally {
      setLoadingContent(false);
    }
  };

  const createSkill = async () => {
    const name = createName.trim();
    if (!name) return;

    setCreating(true);
    try {
      applySnapshot(await piApi.createSkill({
        name,
        description: createDescription.trim() || undefined,
        body: createBody.trim() || undefined,
        scope: createScope,
        projectPath,
      }));
      setCreateName('');
      setCreateDescription('');
      setCreateBody('');
      addToast({ type: 'success', message: t('skills.createSuccess') });
    } catch (err) {
      addToast({ type: 'error', message: t('skills.createFailed', { message: errorMessage(err) }), duration: 6000 });
    } finally {
      setCreating(false);
    }
  };

  const copySkillCommand = async (skill: SkillInfo) => {
    const command = skill.command ?? `/skill:${skill.name}`;
    try {
      await navigator.clipboard.writeText(`${command} `);
      addToast({ type: 'success', message: t('skills.commandCopied') });
    } catch {
      addToast({ type: 'info', message: command });
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 border-b border-pi-border px-4 py-3">
        <button
          onClick={() => setActiveView('chat')}
          className="flex h-7 w-7 items-center justify-center rounded-md text-pi-dim transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
          title={t('common.backToChat')}
        >
          <ArrowLeft size={16} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-display font-semibold text-pi-text">{t('skills.title')}</h1>
          <div className="mt-0.5 text-[10px] text-pi-dim">
            {t('skills.summary', { enabled: enabledCount, total: skills.length, packages: packages.length })}
          </div>
        </div>
        <button
          onClick={() => void reload()}
          disabled={isReloading}
          className="flex h-8 items-center gap-1.5 rounded-md border border-pi-border px-3 text-xs text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text disabled:opacity-50"
        >
          {isReloading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          {t('skills.reload')}
        </button>
        <button
          onClick={() => setActiveView('packages')}
          className="flex h-8 items-center gap-1.5 rounded-md border border-pi-border px-3 text-xs text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
        >
          <Package size={13} />
          {t('skills.packages')}
        </button>
      </div>

      <div className="border-b border-pi-border px-4 py-3">
        <section className="mb-3 rounded-lg border border-pi-border bg-pi-bg-secondary p-3">
          <div className="mb-3 flex items-center gap-2">
            <Plus size={14} className="text-pi-accent" />
            <h2 className="text-xs font-semibold text-pi-text">{t('skills.creator')}</h2>
          </div>
          <div className="grid gap-2 lg:grid-cols-[150px_minmax(0,1fr)_auto]">
            <input
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              placeholder={t('skills.createName')}
              className="h-8 rounded-md border border-pi-border bg-pi-bg-tertiary px-3 text-xs text-pi-text placeholder:text-pi-dim focus:border-pi-accent focus:outline-none"
            />
            <input
              value={createDescription}
              onChange={(event) => setCreateDescription(event.target.value)}
              placeholder={t('skills.createDescription')}
              className="h-8 rounded-md border border-pi-border bg-pi-bg-tertiary px-3 text-xs text-pi-text placeholder:text-pi-dim focus:border-pi-accent focus:outline-none"
            />
            <div className="flex h-8 overflow-hidden rounded-md border border-pi-border">
              {(['project', 'user'] as const).map((scope) => (
                <button
                  key={scope}
                  onClick={() => setCreateScope(scope)}
                  className={cn(
                    'px-3 text-xs font-medium transition-colors',
                    createScope === scope ? 'bg-pi-selected-bg text-pi-accent' : 'text-pi-muted hover:bg-pi-bg-hover hover:text-pi-text'
                  )}
                >
                  {scope === 'project' ? t('packages.scope.project') : t('packages.scope.user')}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-2 grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto]">
            <textarea
              value={createBody}
              onChange={(event) => setCreateBody(event.target.value)}
              placeholder={t('skills.createBody')}
              className="h-20 resize-none rounded-md border border-pi-border bg-pi-bg-tertiary px-3 py-2 text-xs leading-relaxed text-pi-text placeholder:text-pi-dim focus:border-pi-accent focus:outline-none"
            />
            <button
              onClick={() => void createSkill()}
              disabled={!createName.trim() || creating}
              className="flex h-8 items-center justify-center gap-1.5 self-end rounded-md bg-pi-accent px-4 text-xs font-semibold text-white transition-opacity disabled:opacity-50"
            >
              {creating ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              {t('skills.create')}
            </button>
          </div>
        </section>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-pi-dim" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('skills.searchPlaceholder')}
              className="h-8 w-full rounded-md border border-pi-border bg-pi-bg-tertiary pl-8 pr-3 text-xs text-pi-text placeholder:text-pi-dim focus:border-pi-accent focus:outline-none"
            />
          </div>
          {(['all', 'enabled', 'disabled', 'project', 'user'] as const).map((item) => (
            <button
              key={item}
              onClick={() => setFilter(item)}
              className={cn(
                'h-8 rounded-md border px-3 text-xs font-medium transition-colors',
                filter === item
                  ? 'border-pi-accent bg-pi-selected-bg text-pi-accent'
                  : 'border-pi-border text-pi-muted hover:bg-pi-bg-hover hover:text-pi-text'
              )}
            >
              {t(`skills.filter.${item}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="overflow-y-auto p-4">
          {filtered.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-pi-border text-pi-dim">
              <BookOpen size={32} strokeWidth={1} />
              <div className="text-xs">{t('skills.empty')}</div>
            </div>
          ) : (
            <div className="grid gap-3 xl:grid-cols-2">
              {filtered.map((skill) => (
                <SkillCard
                  key={`${skill.scope}/${skill.name}/${skill.filePath}`}
                  skill={skill}
                  active={selectedSkill?.filePath === skill.filePath}
                  onOpen={() => void openSkill(skill)}
                />
              ))}
            </div>
          )}
        </div>

        <aside className="min-h-0 border-t border-pi-border bg-pi-bg-secondary xl:border-l xl:border-t-0">
          {selectedSkill ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="border-b border-pi-border p-4">
                <div className="flex items-center gap-2">
                  <BookOpen size={15} className="text-pi-accent" />
                  <h2 className="truncate text-sm font-semibold text-pi-text">{selectedSkill.name}</h2>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge>{selectedSkill.command ?? `/skill:${selectedSkill.name}`}</Badge>
                  <Badge>{selectedSkill.scope}</Badge>
                  <Badge>{selectedSkill.source}</Badge>
                </div>
                <button
                  onClick={() => void copySkillCommand(selectedSkill)}
                  className="mt-3 flex h-8 items-center gap-1.5 rounded-md border border-pi-border px-3 text-xs text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
                >
                  <Copy size={13} />
                  {t('skills.useCommand')}
                </button>
                <p className="mt-3 text-xs leading-relaxed text-pi-muted">{selectedSkill.description}</p>
                <div className="mt-2 truncate font-mono text-[10px] text-pi-dim">{selectedSkill.filePath}</div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-4">
                {loadingContent ? (
                  <div className="flex h-full items-center justify-center text-pi-dim">
                    <Loader2 size={18} className="animate-spin" />
                  </div>
                ) : (
                  <pre className="whitespace-pre-wrap rounded-lg bg-pi-bg-tertiary p-4 font-mono text-xs leading-relaxed text-pi-text">
                    {skillContent || selectedSkill.description}
                  </pre>
                )}
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-pi-dim">
              <Code2 size={28} strokeWidth={1.3} />
              <div className="text-xs">{t('skills.preview')}</div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function SkillCard({ skill, active, onOpen }: { skill: SkillInfo; active: boolean; onOpen: () => void }) {
  const { t } = useI18n();
  const scopeLabel = skill.scope === 'project'
    ? t('skills.scope.project')
    : skill.scope === 'user'
      ? t('skills.scope.user')
      : t('skills.scope.temporary');

  return (
    <button
      onClick={onOpen}
      className={cn(
        'group rounded-lg border bg-pi-bg-secondary p-3 text-left transition-colors',
        active ? 'border-pi-accent/70' : 'border-pi-border hover:border-pi-accent/50'
      )}
    >
      <div className="flex items-start gap-3">
        <BookOpen
          size={20}
          className={cn('mt-0.5 flex-shrink-0', skill.enabled ? 'text-pi-success' : 'text-pi-dim group-hover:text-pi-muted')}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-pi-text">{skill.name}</span>
            <span className="rounded bg-pi-bg-tertiary px-1.5 py-0.5 text-[9px] font-semibold uppercase text-pi-dim">
              {scopeLabel}
            </span>
            {skill.enabled && (
              <span className="inline-flex items-center gap-1 rounded bg-pi-success/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-pi-success">
                <CheckCircle2 size={10} />
                {t('skills.enabledBadge')}
              </span>
            )}
          </div>
          <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-pi-muted">{skill.description}</p>
          <div className="mt-3 flex items-center gap-1.5 truncate font-mono text-[10px] text-pi-dim">
            <Box size={11} className="flex-shrink-0" />
            <span className="truncate">{skill.filePath}</span>
          </div>
        </div>
      </div>
    </button>
  );
}

function Badge({ children }: { children: string }) {
  return (
    <span className="rounded bg-pi-bg-tertiary px-1.5 py-0.5 font-mono text-[10px] text-pi-dim">
      {children}
    </span>
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
