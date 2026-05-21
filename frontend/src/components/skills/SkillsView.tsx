import {
  ArrowLeft,
  BookOpen,
  Box,
  CheckCircle2,
  Code2,
  Copy,
  Download,
  ExternalLink,
  Globe2,
  KeyRound,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useExtensionStore } from '../../stores/extensionStore';
import { useUIStore } from '../../stores/uiStore';
import { useChatStore } from '../../stores/chatStore';
import { piApi } from '../../api/client';
import { useI18n, type TranslationKey } from '../../lib/i18n';
import type { ExtensionResourceSnapshot, SkillHubItem, SkillHubStatus, SkillInfo } from '../../types';
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
  const [hubQuery, setHubQuery] = useState('');
  const [hubProvider, setHubProvider] = useState<'clawhub' | 'skillhub'>('clawhub');
  const [hubScope, setHubScope] = useState<SkillScope>('project');
  const [hubResults, setHubResults] = useState<SkillHubItem[]>([]);
  const [hubStatus, setHubStatus] = useState<SkillHubStatus | null>(null);
  const [hubEndpoint, setHubEndpoint] = useState('');
  const [hubApiKey, setHubApiKey] = useState('');
  const [hubMessage, setHubMessage] = useState('');
  const [hubSearching, setHubSearching] = useState(false);
  const [hubSavingConfig, setHubSavingConfig] = useState(false);
  const [hubInstalling, setHubInstalling] = useState<string | null>(null);

  const projectPath = activeSession?.projectPath;

  useEffect(() => {
    void reload(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath]);

  useEffect(() => {
    void (async () => {
      const status = await loadSkillHubStatus();
      await searchSkillHub('', status?.defaultProvider ?? hubProvider);
    })();
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

  const loadSkillHubStatus = async (): Promise<SkillHubStatus | null> => {
    try {
      const status = await piApi.getSkillHubStatus();
      setHubStatus(status);
      setHubEndpoint(status.endpoint);
      setHubProvider(status.defaultProvider);
      return status;
    } catch (err) {
      setHubMessage(t('skills.hub.statusFailed', { message: errorMessage(err) }));
      return null;
    }
  };

  const saveSkillHubConfig = async () => {
    setHubSavingConfig(true);
    try {
      const status = await piApi.saveSkillHubConfig({
        endpoint: hubEndpoint,
        apiKey: hubApiKey.trim() || undefined,
        defaultProvider: hubProvider,
      });
      setHubStatus(status);
      setHubEndpoint(status.endpoint);
      setHubApiKey('');
      addToast({ type: 'success', message: t('skills.hub.configSaved') });
    } catch (err) {
      addToast({ type: 'error', message: t('skills.hub.configFailed', { message: errorMessage(err) }), duration: 6000 });
    } finally {
      setHubSavingConfig(false);
    }
  };

  const searchSkillHub = async (nextQuery = hubQuery, nextProvider = hubProvider) => {
    setHubSearching(true);
    setHubMessage('');
    try {
      const result = await piApi.searchSkillHub({
        query: nextQuery.trim() || undefined,
        limit: 12,
        projectPath,
        provider: nextProvider,
      });
      setHubResults(result.items);
      setHubMessage(result.message ?? (result.usedFallback ? t('skills.hub.fallback') : ''));
    } catch (err) {
      setHubResults([]);
      setHubMessage(t('skills.hub.searchFailed', { message: errorMessage(err) }));
    } finally {
      setHubSearching(false);
    }
  };

  const installHubSkill = async (item: SkillHubItem) => {
    if (!window.confirm(t('skills.hub.installConfirm'))) return;
    setHubInstalling(item.id);
    try {
      applySnapshot(await piApi.installSkillHubItem({ item, scope: hubScope, projectPath }));
      setHubResults((current) => current.map((result) => result.id === item.id ? { ...result, installed: true } : result));
      addToast({ type: 'success', message: t('skills.hub.installSuccess', { name: item.displayName }) });
    } catch (err) {
      addToast({ type: 'error', message: t('skills.hub.installFailed', { message: errorMessage(err) }), duration: 7000 });
    } finally {
      setHubInstalling(null);
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

        <SkillHubSection
          query={hubQuery}
          provider={hubProvider}
          scope={hubScope}
          results={hubResults}
          status={hubStatus}
          endpoint={hubEndpoint}
          apiKey={hubApiKey}
          message={hubMessage}
          searching={hubSearching}
          savingConfig={hubSavingConfig}
          installingId={hubInstalling}
          onQueryChange={setHubQuery}
          onProviderChange={(provider) => {
            setHubProvider(provider);
            void searchSkillHub(hubQuery, provider);
          }}
          onScopeChange={setHubScope}
          onEndpointChange={setHubEndpoint}
          onApiKeyChange={setHubApiKey}
          onSearch={() => void searchSkillHub()}
          onSaveConfig={() => void saveSkillHubConfig()}
          onInstall={(item) => void installHubSkill(item)}
        />

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

function SkillHubSection({
  query,
  provider,
  scope,
  results,
  status,
  endpoint,
  apiKey,
  message,
  searching,
  savingConfig,
  installingId,
  onQueryChange,
  onProviderChange,
  onScopeChange,
  onEndpointChange,
  onApiKeyChange,
  onSearch,
  onSaveConfig,
  onInstall,
}: {
  query: string;
  provider: 'clawhub' | 'skillhub';
  scope: SkillScope;
  results: SkillHubItem[];
  status: SkillHubStatus | null;
  endpoint: string;
  apiKey: string;
  message: string;
  searching: boolean;
  savingConfig: boolean;
  installingId: string | null;
  onQueryChange: (query: string) => void;
  onProviderChange: (provider: 'clawhub' | 'skillhub') => void;
  onScopeChange: (scope: SkillScope) => void;
  onEndpointChange: (endpoint: string) => void;
  onApiKeyChange: (apiKey: string) => void;
  onSearch: () => void;
  onSaveConfig: () => void;
  onInstall: (item: SkillHubItem) => void;
}) {
  const { t } = useI18n();
  const availableCount = results.filter((item) => !item.installed).length;

  return (
    <section className="mb-3 overflow-hidden rounded-lg border border-pi-border bg-pi-bg-secondary">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-pi-border px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Globe2 size={15} className="flex-shrink-0 text-pi-accent" />
          <div className="min-w-0">
            <h2 className="text-xs font-semibold text-pi-text">{t('skills.hub.title')}</h2>
            <p className="mt-0.5 truncate text-[10px] text-pi-dim">
              {t('skills.hub.summary', { count: results.length, available: availableCount })}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn(
            'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[10px] font-semibold',
            provider === 'skillhub' && !status?.apiKeyConfigured
              ? 'border-pi-warning/40 bg-pi-warning/10 text-pi-warning'
              : 'border-pi-border bg-pi-bg-tertiary text-pi-muted'
          )}>
            <ShieldCheck size={11} />
            {provider === 'skillhub' && !status?.apiKeyConfigured ? t('skills.hub.keyMissing') : t('skills.hub.ready')}
          </span>
          <HubSegment
            value={provider}
            items={[
              { value: 'clawhub', label: 'ClawHub' },
              { value: 'skillhub', label: 'SkillHub' },
            ]}
            onChange={onProviderChange}
          />
        </div>
      </div>

      <div className="space-y-3 p-3">
        <div className="grid gap-2 xl:grid-cols-[minmax(240px,1fr)_auto_auto]">
          <label className="relative min-w-0">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-pi-dim" />
            <input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onSearch();
              }}
              placeholder={t('skills.hub.searchPlaceholder')}
              className="h-9 w-full rounded-md border border-pi-border bg-pi-bg-tertiary pl-8 pr-3 text-xs text-pi-text placeholder:text-pi-dim focus:border-pi-accent focus:outline-none"
            />
          </label>
          <HubSegment
            value={scope}
            items={[
              { value: 'project', label: t('packages.scope.project') },
              { value: 'user', label: t('packages.scope.user') },
            ]}
            onChange={onScopeChange}
          />
          <button
            onClick={onSearch}
            disabled={searching}
            className="flex h-9 items-center justify-center gap-1.5 rounded-md bg-pi-accent px-4 text-xs font-semibold text-white transition-opacity disabled:opacity-50"
          >
            {searching ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
            {t('skills.hub.search')}
          </button>
        </div>

        <div className="grid gap-2 xl:grid-cols-[minmax(260px,1fr)_minmax(180px,260px)_auto]">
          <input
            value={endpoint}
            onChange={(event) => onEndpointChange(event.target.value)}
            placeholder={t('skills.hub.endpointPlaceholder')}
            className="h-8 rounded-md border border-pi-border bg-pi-bg-tertiary px-3 text-[10px] text-pi-text placeholder:text-pi-dim focus:border-pi-accent focus:outline-none"
          />
          <label className="relative min-w-0">
            <KeyRound size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-pi-dim" />
            <input
              value={apiKey}
              type="password"
              onChange={(event) => onApiKeyChange(event.target.value)}
              placeholder={status?.apiKeyConfigured ? t('skills.hub.keyConfigured') : t('skills.hub.keyPlaceholder')}
              className="h-8 w-full rounded-md border border-pi-border bg-pi-bg-tertiary pl-8 pr-3 text-[10px] text-pi-text placeholder:text-pi-dim focus:border-pi-accent focus:outline-none"
            />
          </label>
          <button
            onClick={onSaveConfig}
            disabled={savingConfig}
            className="flex h-8 items-center justify-center gap-1.5 rounded-md border border-pi-border px-3 text-[10px] font-medium text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text disabled:opacity-50"
          >
            {savingConfig ? <Loader2 size={12} className="animate-spin" /> : <KeyRound size={12} />}
            {t('skills.hub.saveConfig')}
          </button>
        </div>

        {message && (
          <div className="rounded-md border border-pi-border bg-pi-bg-tertiary px-3 py-2 text-[10px] text-pi-dim">
            {message}
          </div>
        )}

        <div className="max-h-72 overflow-y-auto rounded-lg border border-pi-border">
          {searching && results.length === 0 ? (
            <div className="flex h-24 items-center justify-center text-pi-dim">
              <Loader2 size={18} className="animate-spin" />
            </div>
          ) : results.length === 0 ? (
            <div className="flex h-24 flex-col items-center justify-center gap-2 text-pi-dim">
              <Sparkles size={20} strokeWidth={1.4} />
              <span className="text-xs">{t('skills.hub.empty')}</span>
            </div>
          ) : (
            <div className="divide-y divide-pi-border">
              {results.map((item) => (
                <div key={item.id} className="grid gap-3 px-3 py-3 transition-colors hover:bg-pi-bg-hover/45 xl:grid-cols-[minmax(0,1fr)_160px_92px] xl:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-xs font-semibold text-pi-text">{item.displayName}</span>
                      <span className="rounded bg-pi-bg-tertiary px-1.5 py-0.5 text-[9px] font-semibold uppercase text-pi-dim">
                        {item.sourceLabel ?? item.provider}
                      </span>
                      {item.installed && (
                        <span className="inline-flex items-center gap-1 rounded bg-pi-success/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-pi-success">
                          <CheckCircle2 size={10} />
                          {t('skills.hub.installed')}
                        </span>
                      )}
                      {item.url && (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-5 w-5 items-center justify-center rounded text-pi-dim transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
                          title={t('skills.hub.openSource')}
                          onClick={(event) => event.stopPropagation()}
                        >
                          <ExternalLink size={11} />
                        </a>
                      )}
                    </div>
                    <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-pi-muted">{item.description}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {item.author && <HubBadge>{`@${item.author}`}</HubBadge>}
                      {item.version && <HubBadge>{`v${item.version}`}</HubBadge>}
                      {formatHubMetric(item, t) && <HubBadge>{formatHubMetric(item, t)!}</HubBadge>}
                      {item.tags.slice(0, 4).map((tag) => <HubBadge key={tag}>{tag}</HubBadge>)}
                    </div>
                  </div>
                  <div className="min-w-0 truncate font-mono text-[10px] text-pi-dim">{item.name}</div>
                  <button
                    onClick={() => onInstall(item)}
                    disabled={item.installed || Boolean(installingId)}
                    className="flex h-7 items-center justify-center gap-1.5 rounded-md border border-pi-border px-2 text-[10px] font-medium text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text disabled:opacity-45"
                  >
                    {installingId === item.id ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                    {item.installed ? t('skills.hub.installed') : t('skills.hub.install')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function HubSegment<T extends string>({
  value,
  items,
  onChange,
}: {
  value: T;
  items: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex h-9 overflow-hidden rounded-md border border-pi-border bg-pi-bg-tertiary">
      {items.map((item) => (
        <button
          key={item.value}
          onClick={() => onChange(item.value)}
          className={cn(
            'px-3 text-[10px] font-semibold transition-colors',
            value === item.value ? 'bg-pi-selected-bg text-pi-accent' : 'text-pi-muted hover:bg-pi-bg-hover hover:text-pi-text'
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

function HubBadge({ children }: { children: string }) {
  return (
    <span className="rounded bg-pi-bg-tertiary px-1.5 py-0.5 text-[9px] text-pi-dim">
      {children}
    </span>
  );
}

function formatHubMetric(
  item: SkillHubItem,
  t: (key: TranslationKey, values?: Record<string, string | number>) => string,
): string | null {
  if (typeof item.installs === 'number') return t('skills.hub.metric.installs', { count: item.installs });
  if (typeof item.downloads === 'number') return t('skills.hub.metric.downloads', { count: item.downloads });
  if (typeof item.stars === 'number') return t('skills.hub.metric.stars', { count: item.stars });
  return null;
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
