import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Download,
  Filter,
  Loader2,
  Package,
  Palette,
  Plus,
  Puzzle,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { useExtensionStore } from '../../stores/extensionStore';
import { useUIStore } from '../../stores/uiStore';
import { useChatStore } from '../../stores/chatStore';
import { piApi } from '../../api/client';
import { useI18n } from '../../lib/i18n';
import type { ExtensionResourceSnapshot, MarketplacePackageInfo, PackageInfo, PackageResourceFilter } from '../../types';
import { cn } from '../shared/utils';

type PackageScope = 'user' | 'project';
type PackageFilter = 'all' | 'user' | 'project' | 'disabled' | 'filtered';
type ResourceKind = keyof PackageResourceFilter;
type ResourceFilterMode = 'auto' | 'disabled' | 'patterns';

const RESOURCE_KINDS: ResourceKind[] = ['extensions', 'skills', 'prompts', 'themes'];

export function PackagesView() {
  const { t } = useI18n();
  const packages = useExtensionStore((s) => s.packages);
  const diagnostics = useExtensionStore((s) => s.diagnostics);
  const packageProgress = useExtensionStore((s) => s.packageProgress);
  const marketplace = useExtensionStore((s) => s.marketplace);
  const setResourceSnapshot = useExtensionStore((s) => s.setResourceSnapshot);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const setSlashCommands = useUIStore((s) => s.setSlashCommands);
  const addToast = useUIStore((s) => s.addToast);
  const activeSession = useChatStore((s) => s.sessions.find((session) => session.id === s.activeSessionId));
  const [source, setSource] = useState('');
  const [scope, setScope] = useState<PackageScope>('user');
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<PackageFilter>('all');
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [createName, setCreateName] = useState('');
  const [createDescription, setCreateDescription] = useState('');
  const [createSkillName, setCreateSkillName] = useState('');

  const projectPath = activeSession?.projectPath;
  const latestProgress = packageProgress[0];
  const selectedPackage = packages.find((pkg) => pkg.source === selectedSource) ?? packages[0] ?? null;
  const resourceTotals = useMemo(
    () => packages.reduce(
      (total, pkg) => ({
        extensions: total.extensions + pkg.extensions.length,
        skills: total.skills + pkg.skills.length,
        prompts: total.prompts + pkg.prompts.length,
        themes: total.themes + pkg.themes.length,
      }),
      { extensions: 0, skills: 0, prompts: 0, themes: 0 }
    ),
    [packages]
  );
  const filteredPackages = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return packages.filter((pkg) => {
      if (filter === 'user' && pkg.scope !== 'user') return false;
      if (filter === 'project' && pkg.scope !== 'project') return false;
      if (filter === 'disabled' && !pkg.disabled) return false;
      if (filter === 'filtered' && !pkg.filtered) return false;
      if (!needle) return true;
      return `${pkg.name} ${pkg.source} ${pkg.installedPath ?? ''}`.toLowerCase().includes(needle);
    });
  }, [filter, packages, query]);

  useEffect(() => {
    void refreshResources(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath]);

  const applySnapshot = (snapshot: ExtensionResourceSnapshot) => {
    setResourceSnapshot(snapshot);
    setSlashCommands(Array.isArray(snapshot.slashCommands) ? snapshot.slashCommands : []);
  };

  const refreshResources = async (showToast = true) => {
    setBusy('refresh');
    try {
      applySnapshot(await piApi.getExtensionResources(projectPath));
      if (showToast) addToast({ type: 'success', message: t('extensions.reloadSuccess') });
    } catch (err) {
      addToast({ type: 'error', message: t('extensions.reloadFailed', { message: errorMessage(err) }) });
    } finally {
      setBusy(null);
    }
  };

  const installSource = async (packageSource: string, packageScope = scope) => {
    const trimmed = packageSource.trim();
    if (!trimmed) return;
    if (!window.confirm(t('packages.installConfirm'))) return;

    setBusy(`install:${trimmed}`);
    try {
      applySnapshot(await piApi.installPackage(trimmed, packageScope, projectPath));
      setSource('');
      setSelectedSource(trimmed);
      addToast({ type: 'success', message: t('packages.installSuccess') });
    } catch (err) {
      addToast({ type: 'error', message: t('packages.operationFailed', { message: errorMessage(err) }), duration: 6000 });
    } finally {
      setBusy(null);
    }
  };

  const remove = async (pkg: PackageInfo) => {
    setBusy(`remove:${pkg.source}`);
    try {
      applySnapshot(await piApi.removePackage(pkg.source, packageScope(pkg), projectPath));
      addToast({ type: 'success', message: t('packages.removeSuccess') });
    } catch (err) {
      addToast({ type: 'error', message: t('packages.operationFailed', { message: errorMessage(err) }), duration: 6000 });
    } finally {
      setBusy(null);
    }
  };

  const update = async (pkg?: PackageInfo) => {
    setBusy(pkg ? `update:${pkg.source}` : 'update-all');
    try {
      applySnapshot(await piApi.updatePackage(pkg?.source, projectPath));
      addToast({ type: 'success', message: t('packages.updateSuccess') });
    } catch (err) {
      addToast({ type: 'error', message: t('packages.operationFailed', { message: errorMessage(err) }), duration: 6000 });
    } finally {
      setBusy(null);
    }
  };

  const togglePackage = async (pkg: PackageInfo) => {
    setBusy(`toggle:${pkg.source}`);
    try {
      applySnapshot(await piApi.setPackageEnabled(pkg.source, Boolean(pkg.disabled), packageScope(pkg), projectPath));
      addToast({ type: 'success', message: t('packages.filterSaved') });
    } catch (err) {
      addToast({ type: 'error', message: t('packages.operationFailed', { message: errorMessage(err) }), duration: 6000 });
    } finally {
      setBusy(null);
    }
  };

  const savePackageFilter = async (pkg: PackageInfo, nextFilter: PackageResourceFilter | undefined) => {
    setBusy(`filter:${pkg.source}`);
    try {
      applySnapshot(await piApi.setPackageFilter(pkg.source, nextFilter, packageScope(pkg), projectPath));
      addToast({ type: 'success', message: t('packages.filterSaved') });
    } catch (err) {
      addToast({ type: 'error', message: t('packages.operationFailed', { message: errorMessage(err) }), duration: 6000 });
    } finally {
      setBusy(null);
    }
  };

  const createPackage = async () => {
    const name = createName.trim();
    if (!name) return;
    setBusy('create-package');
    try {
      applySnapshot(await piApi.createPackage({
        name,
        description: createDescription.trim() || undefined,
        skillName: createSkillName.trim() || undefined,
        scope,
        projectPath,
      }));
      setCreateName('');
      setCreateDescription('');
      setCreateSkillName('');
      addToast({ type: 'success', message: t('packages.createSuccess') });
    } catch (err) {
      addToast({ type: 'error', message: t('packages.operationFailed', { message: errorMessage(err) }), duration: 6000 });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-pi-border px-4 py-3">
        <button
          onClick={() => setActiveView('chat')}
          className="flex h-7 w-7 items-center justify-center rounded-md text-pi-dim transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
          title={t('common.backToChat')}
        >
          <ArrowLeft size={16} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-display font-semibold text-pi-text">{t('packages.title')}</h1>
          <p className="mt-0.5 text-[10px] text-pi-dim">{t('packages.resources', resourceTotals)}</p>
        </div>
        <button
          onClick={() => void update()}
          disabled={Boolean(busy)}
          className="flex h-8 items-center gap-1.5 rounded-md border border-pi-border px-3 text-xs text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text disabled:opacity-50"
        >
          {busy === 'update-all' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
          {t('packages.updateAll')}
        </button>
        <button
          onClick={() => void refreshResources()}
          disabled={Boolean(busy)}
          className="flex h-8 items-center gap-1.5 rounded-md border border-pi-border px-3 text-xs text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text disabled:opacity-50"
        >
          {busy === 'refresh' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          {t('packages.refresh')}
        </button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden xl:grid-cols-[minmax(0,1fr)_400px]">
        <main className="min-h-0 overflow-y-auto p-5">
          <section className="rounded-lg border border-pi-border bg-pi-bg-secondary p-3">
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-[260px] flex-1">
                <span className="mb-1 block text-[10px] font-semibold uppercase text-pi-dim">{t('packages.installSource')}</span>
                <input
                  value={source}
                  onChange={(event) => setSource(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void installSource(source);
                  }}
                  placeholder={t('packages.installPlaceholder')}
                  className="h-9 w-full rounded-md border border-pi-border bg-pi-bg-tertiary px-3 text-xs text-pi-text placeholder:text-pi-dim focus:border-pi-accent focus:outline-none"
                />
              </label>
              <ScopeSegment value={scope} onChange={setScope} />
              <button
                onClick={() => void installSource(source)}
                disabled={!source.trim() || Boolean(busy)}
                className="flex h-9 items-center gap-1.5 rounded-md bg-pi-accent px-4 text-xs font-semibold text-white transition-opacity disabled:opacity-50"
              >
                {busy?.startsWith('install:') ? <Loader2 size={13} className="animate-spin" /> : <Package size={13} />}
                {t('packages.install')}
              </button>
            </div>
            {latestProgress && (
              <div className="mt-2 truncate text-[10px] text-pi-dim">
                {t('packages.latestProgress')}: {latestProgress.action} {latestProgress.source}
                {latestProgress.message ? ` · ${latestProgress.message}` : ''}
              </div>
            )}
          </section>

          <section className="mt-4 rounded-lg border border-pi-border bg-pi-bg-secondary p-3">
            <div className="mb-3 flex items-center gap-2">
              <Plus size={14} className="text-pi-accent" />
              <h2 className="text-xs font-semibold text-pi-text">{t('packages.creator')}</h2>
            </div>
            <div className="grid gap-2 lg:grid-cols-[160px_minmax(0,1fr)_160px_auto]">
              <input value={createName} onChange={(event) => setCreateName(event.target.value)} placeholder={t('packages.createName')} className="h-8 rounded-md border border-pi-border bg-pi-bg-tertiary px-3 text-xs text-pi-text placeholder:text-pi-dim focus:border-pi-accent focus:outline-none" />
              <input value={createDescription} onChange={(event) => setCreateDescription(event.target.value)} placeholder={t('packages.createDescription')} className="h-8 rounded-md border border-pi-border bg-pi-bg-tertiary px-3 text-xs text-pi-text placeholder:text-pi-dim focus:border-pi-accent focus:outline-none" />
              <input value={createSkillName} onChange={(event) => setCreateSkillName(event.target.value)} placeholder={t('packages.createSkillName')} className="h-8 rounded-md border border-pi-border bg-pi-bg-tertiary px-3 text-xs text-pi-text placeholder:text-pi-dim focus:border-pi-accent focus:outline-none" />
              <button onClick={() => void createPackage()} disabled={!createName.trim() || Boolean(busy)} className="flex h-8 items-center gap-1.5 rounded-md border border-pi-border px-3 text-xs text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text disabled:opacity-50">
                {busy === 'create-package' ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                {t('packages.createPackage')}
              </button>
            </div>
          </section>

          <MarketplaceSection marketplace={marketplace} busy={busy} onInstall={(item) => void installSource(item.source, item.recommendedScope)} />

          <section className="mt-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="relative min-w-[220px] flex-1">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-pi-dim" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('packages.searchPlaceholder')}
                  className="h-8 w-full rounded-md border border-pi-border bg-pi-bg-tertiary pl-8 pr-3 text-xs text-pi-text placeholder:text-pi-dim focus:border-pi-accent focus:outline-none"
                />
              </div>
              {(['all', 'user', 'project', 'disabled', 'filtered'] as const).map((item) => (
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
                  {t(`packages.filter.${item}`)}
                </button>
              ))}
            </div>

            {filteredPackages.length === 0 ? (
              <div className="flex h-48 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-pi-border text-pi-dim">
                <Package size={32} strokeWidth={1} />
                <p className="text-xs">{t('packages.empty')}</p>
                <p className="text-[10px]">{t('packages.emptyHint')}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredPackages.map((pkg) => (
                  <PackageRow
                    key={`${pkg.scope ?? 'user'}:${pkg.source}`}
                    pkg={pkg}
                    active={selectedPackage?.source === pkg.source}
                    busy={busy}
                    onSelect={() => setSelectedSource(pkg.source)}
                    onRemove={() => void remove(pkg)}
                    onUpdate={() => void update(pkg)}
                    onToggle={() => void togglePackage(pkg)}
                  />
                ))}
              </div>
            )}
          </section>
        </main>

        <aside className="min-h-0 overflow-y-auto border-t border-pi-border bg-pi-bg-secondary xl:border-l xl:border-t-0">
          <PackageDetails
            pkg={selectedPackage}
            busy={busy}
            diagnostics={diagnostics}
            progress={packageProgress}
            onSaveFilter={(pkg, nextFilter) => void savePackageFilter(pkg, nextFilter)}
          />
        </aside>
      </div>
    </div>
  );
}

function ScopeSegment({ value, onChange }: { value: PackageScope; onChange: (scope: PackageScope) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex h-9 overflow-hidden rounded-md border border-pi-border">
      {(['user', 'project'] as const).map((item) => (
        <button
          key={item}
          onClick={() => onChange(item)}
          className={cn(
            'px-3 text-xs font-medium transition-colors',
            value === item ? 'bg-pi-selected-bg text-pi-accent' : 'text-pi-muted hover:bg-pi-bg-hover hover:text-pi-text'
          )}
        >
          {t(`packages.scope.${item}`)}
        </button>
      ))}
    </div>
  );
}

function MarketplaceSection({
  marketplace,
  busy,
  onInstall,
}: {
  marketplace: MarketplacePackageInfo[];
  busy: string | null;
  onInstall: (item: MarketplacePackageInfo) => void;
}) {
  const { t } = useI18n();
  const installedCount = marketplace.filter((item) => item.installed).length;
  const availableCount = marketplace.length - installedCount;

  return (
    <section className="mt-4 rounded-lg border border-pi-border bg-pi-bg-secondary">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-pi-border px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <ShieldCheck size={14} className="flex-shrink-0 text-pi-accent" />
          <div className="min-w-0">
            <h2 className="text-xs font-semibold text-pi-text">{t('packages.marketplace')}</h2>
            <p className="mt-0.5 text-[10px] text-pi-dim">
              {t('packages.marketplaceSummary', {
                total: marketplace.length,
                available: availableCount,
                installed: installedCount,
              })}
            </p>
          </div>
        </div>
        <span className="rounded-full border border-pi-border bg-pi-bg-tertiary px-2.5 py-1 text-[10px] font-semibold text-pi-muted">
          {t('packages.marketplaceCount', { count: marketplace.length })}
        </span>
      </div>

      {marketplace.length === 0 ? (
        <div className="flex h-24 items-center justify-center px-3 text-center text-xs text-pi-dim">
          {t('packages.marketplaceEmpty')}
        </div>
      ) : (
        <div className="divide-y divide-pi-border">
        {marketplace.map((item) => (
          <div key={item.id} className="grid gap-3 px-3 py-3 transition-colors hover:bg-pi-bg-hover/45 lg:grid-cols-[minmax(220px,1.1fr)_minmax(0,1.5fr)_180px_96px] lg:items-center">
            <div className="flex min-w-0 items-start gap-3">
              <Package size={16} className={cn('mt-0.5 flex-shrink-0', item.installed ? 'text-pi-dim' : 'text-pi-accent')} />
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="truncate text-xs font-semibold text-pi-text">{item.name}</span>
                  {item.installed && <Badge tone="muted">{t('packages.installed')}</Badge>}
                  <span className="rounded bg-pi-bg-tertiary px-1.5 py-0.5 text-[9px] uppercase text-pi-dim">
                    {t(`packages.trust.${item.trustLevel}`)}
                  </span>
                </div>
                <div className="mt-1 truncate font-mono text-[10px] text-pi-dim">{item.source}</div>
              </div>
            </div>

            <div className="min-w-0">
              <p className="line-clamp-2 text-[10px] leading-relaxed text-pi-muted">{item.description}</p>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {item.tags.slice(0, 6).map((tag) => (
                  <span key={tag} className="rounded bg-pi-bg-tertiary px-1.5 py-0.5 text-[9px] text-pi-dim">{tag}</span>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[10px] text-pi-dim">
              <span className="rounded bg-pi-bg-tertiary px-2 py-1">
                {t('packages.recommendedScope', { scope: t(`packages.scope.${item.recommendedScope}`) })}
              </span>
            </div>

            <button
              onClick={() => onInstall(item)}
              disabled={item.installed || Boolean(busy)}
              className="flex h-7 items-center justify-center gap-1.5 rounded-md border border-pi-border px-2 text-[10px] font-medium text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text disabled:opacity-45"
            >
              {busy === `install:${item.source}` ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
              {item.installed ? t('packages.installed') : t('packages.installMarketplace')}
            </button>
          </div>
        ))}
      </div>
      )}
    </section>
  );
}

function PackageRow({
  pkg,
  active,
  busy,
  onSelect,
  onRemove,
  onUpdate,
  onToggle,
}: {
  pkg: PackageInfo;
  active: boolean;
  busy: string | null;
  onSelect: () => void;
  onRemove: () => void;
  onUpdate: () => void;
  onToggle: () => void;
}) {
  const { t } = useI18n();
  const isRemoving = busy === `remove:${pkg.source}`;
  const isUpdating = busy === `update:${pkg.source}`;
  const isToggling = busy === `toggle:${pkg.source}`;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg border bg-pi-bg-secondary p-3 text-left transition-colors',
        active ? 'border-pi-accent/70' : 'border-pi-border hover:border-pi-muted'
      )}
    >
      <Package size={16} className={cn('mt-0.5 flex-shrink-0', pkg.disabled ? 'text-pi-dim' : 'text-pi-accent')} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-pi-text">{pkg.name}</span>
          <span className="font-mono text-[10px] text-pi-dim">v{pkg.version}</span>
          <span className="rounded bg-pi-bg-tertiary px-1.5 py-0.5 text-[9px] font-semibold uppercase text-pi-dim">
            {pkg.scope === 'project' ? t('packages.scope.project') : t('packages.scope.user')}
          </span>
          {pkg.filtered && <Badge tone="warning">{t('packages.filteredBadge')}</Badge>}
          {pkg.disabled && <Badge tone="muted">{t('packages.disabledBadge')}</Badge>}
        </div>
        <div className="mt-0.5 truncate text-[10px] text-pi-dim">{pkg.source}</div>
        {pkg.installedPath && <div className="mt-0.5 truncate font-mono text-[10px] text-pi-dim">{pkg.installedPath}</div>}
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <ResourceCount icon={<Puzzle size={10} />} value={pkg.extensions.length} />
          <ResourceCount icon={<BookOpen size={10} />} value={pkg.skills.length} />
          <ResourceCount icon={<Package size={10} />} value={pkg.prompts.length} />
          <ResourceCount icon={<Palette size={10} />} value={pkg.themes.length} />
        </div>
      </div>
      <div className="flex items-center gap-1">
        <IconButton disabled={Boolean(busy)} title={pkg.disabled ? t('packages.enable') : t('packages.disable')} onClick={onToggle}>
          {isToggling ? <Loader2 size={13} className="animate-spin" /> : <Filter size={13} />}
        </IconButton>
        <IconButton disabled={Boolean(busy)} title={t('packages.update')} onClick={onUpdate}>
          {isUpdating ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
        </IconButton>
        <IconButton danger disabled={Boolean(busy)} title={t('packages.uninstall')} onClick={onRemove}>
          {isRemoving ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
        </IconButton>
      </div>
    </button>
  );
}

function PackageDetails({
  pkg,
  busy,
  diagnostics,
  progress,
  onSaveFilter,
}: {
  pkg: PackageInfo | null;
  busy: string | null;
  diagnostics: Array<{ type: string; message: string; path?: string; resourceType?: string; source?: string }>;
  progress: Array<{ type: string; action: string; source: string; message?: string; timestamp: number }>;
  onSaveFilter: (pkg: PackageInfo, nextFilter: PackageResourceFilter | undefined) => void;
}) {
  const { t } = useI18n();
  if (!pkg) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-pi-dim">
        <Package size={28} strokeWidth={1.3} />
        <div className="text-xs">{t('packages.noSelection')}</div>
      </div>
    );
  }

  const packageDiagnostics = diagnostics.filter((item) =>
    item.source === pkg.source || item.path?.includes(pkg.name) || item.path?.includes(pkg.source)
  );
  const packageProgress = progress.filter((item) => item.source === pkg.source).slice(0, 6);

  return (
    <div className="space-y-4 p-4">
      <section>
        <div className="flex items-start gap-3">
          <Package size={18} className="mt-0.5 flex-shrink-0 text-pi-accent" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-pi-text">{pkg.name}</h2>
            <div className="mt-1 truncate font-mono text-[10px] text-pi-dim">{pkg.source}</div>
            {pkg.installedPath && <div className="mt-1 truncate font-mono text-[10px] text-pi-dim">{pkg.installedPath}</div>}
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-pi-border p-3">
        <div className="mb-2 text-xs font-semibold text-pi-text">{t('packages.resourcesBreakdown')}</div>
        <div className="grid grid-cols-4 gap-2">
          <ResourceStat label={t('extensions.commands')} value={pkg.extensions.length} icon={<Puzzle size={13} />} />
          <ResourceStat label={t('extensions.skills')} value={pkg.skills.length} icon={<BookOpen size={13} />} />
          <ResourceStat label={t('packages.resource.prompts')} value={pkg.prompts.length} icon={<Package size={13} />} />
          <ResourceStat label={t('packages.resource.themes')} value={pkg.themes.length} icon={<Palette size={13} />} />
        </div>
      </section>

      <PackageFilterEditor pkg={pkg} busy={busy} onSave={onSaveFilter} />

      <section className="rounded-lg border border-pi-border p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-pi-text">
          <RefreshCw size={13} />
          {t('packages.progressTitle')}
        </div>
        {packageProgress.length === 0 ? (
          <div className="text-[10px] text-pi-dim">{t('packages.noProgress')}</div>
        ) : (
          <div className="space-y-2">
            {packageProgress.map((item) => (
              <div key={`${item.timestamp}:${item.action}`} className="rounded-md bg-pi-bg-tertiary p-2">
                <div className="text-[10px] font-semibold text-pi-muted">{item.action} · {item.type}</div>
                {item.message && <div className="mt-0.5 text-[10px] text-pi-dim">{item.message}</div>}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-pi-border p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-pi-text">
          <AlertTriangle size={13} />
          {t('extensions.diagnostics')}
        </div>
        {packageDiagnostics.length === 0 ? (
          <div className="text-[10px] text-pi-dim">{t('extensions.noDiagnostics')}</div>
        ) : (
          <div className="space-y-2">
            {packageDiagnostics.map((item, index) => (
              <div key={`${item.message}:${index}`} className="rounded-md bg-pi-warning/5 p-2 text-[10px] text-pi-warning">
                {item.message}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function PackageFilterEditor({ pkg, busy, onSave }: { pkg: PackageInfo; busy: string | null; onSave: (pkg: PackageInfo, nextFilter: PackageResourceFilter | undefined) => void }) {
  const { t } = useI18n();
  const [modes, setModes] = useState<Record<ResourceKind, ResourceFilterMode>>(() => filterToModes(pkg.filter));
  const [patterns, setPatterns] = useState<Record<ResourceKind, string>>(() => filterToPatterns(pkg.filter));

  useEffect(() => {
    setModes(filterToModes(pkg.filter));
    setPatterns(filterToPatterns(pkg.filter));
  }, [pkg.source, pkg.filter]);

  const save = () => {
    const next: PackageResourceFilter = {};
    for (const kind of RESOURCE_KINDS) {
      if (modes[kind] === 'auto') continue;
      if (modes[kind] === 'disabled') {
        next[kind] = [];
      } else {
        next[kind] = splitPatterns(patterns[kind]);
      }
    }
    onSave(pkg, Object.keys(next).length > 0 ? next : undefined);
  };

  return (
    <section className="rounded-lg border border-pi-border p-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-pi-text">
        <Filter size={13} />
        {t('packages.filterTitle')}
      </div>
      <p className="mb-3 text-[10px] leading-relaxed text-pi-dim">{t('packages.filterHint')}</p>
      <div className="space-y-2">
        {RESOURCE_KINDS.map((kind) => (
          <div key={kind} className="rounded-md bg-pi-bg-tertiary p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase text-pi-dim">{kind}</span>
              <select
                value={modes[kind]}
                onChange={(event) => setModes((current) => ({ ...current, [kind]: event.target.value as ResourceFilterMode }))}
                className="h-7 rounded-md border border-pi-border bg-pi-bg-secondary px-2 text-[10px] text-pi-text focus:border-pi-accent focus:outline-none"
              >
                <option value="auto">{t('packages.filterMode.auto')}</option>
                <option value="disabled">{t('packages.filterMode.disabled')}</option>
                <option value="patterns">{t('packages.filterMode.patterns')}</option>
              </select>
            </div>
            {modes[kind] === 'patterns' && (
              <textarea
                value={patterns[kind]}
                onChange={(event) => setPatterns((current) => ({ ...current, [kind]: event.target.value }))}
                placeholder={t('packages.filterPatternsPlaceholder')}
                className="h-16 w-full resize-none rounded-md border border-pi-border bg-pi-bg px-2 py-1 font-mono text-[10px] text-pi-text placeholder:text-pi-dim focus:border-pi-accent focus:outline-none"
              />
            )}
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <button onClick={save} disabled={Boolean(busy)} className="flex h-8 items-center gap-1.5 rounded-md bg-pi-accent px-3 text-xs font-semibold text-white disabled:opacity-50">
          {busy === `filter:${pkg.source}` ? <Loader2 size={13} className="animate-spin" /> : <Filter size={13} />}
          {t('packages.saveFilter')}
        </button>
        <button onClick={() => onSave(pkg, undefined)} disabled={Boolean(busy) || !pkg.filtered} className="h-8 rounded-md border border-pi-border px-3 text-xs text-pi-muted hover:bg-pi-bg-hover hover:text-pi-text disabled:opacity-50">
          {t('packages.clearFilter')}
        </button>
      </div>
    </section>
  );
}

function filterToModes(filter: PackageResourceFilter | undefined): Record<ResourceKind, ResourceFilterMode> {
  return RESOURCE_KINDS.reduce((result, kind) => {
    const value = filter?.[kind];
    result[kind] = !Array.isArray(value) ? 'auto' : value.length === 0 ? 'disabled' : 'patterns';
    return result;
  }, {} as Record<ResourceKind, ResourceFilterMode>);
}

function filterToPatterns(filter: PackageResourceFilter | undefined): Record<ResourceKind, string> {
  return RESOURCE_KINDS.reduce((result, kind) => {
    result[kind] = (filter?.[kind] ?? []).join('\n');
    return result;
  }, {} as Record<ResourceKind, string>);
}

function splitPatterns(value: string): string[] {
  return value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
}

function packageScope(pkg: PackageInfo): PackageScope {
  return pkg.scope === 'project' ? 'project' : 'user';
}

function ResourceStat({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-md bg-pi-bg-tertiary p-2 text-center">
      <div className="mx-auto mb-1 flex justify-center text-pi-accent">{icon}</div>
      <div className="text-xs font-semibold text-pi-text">{value}</div>
      <div className="truncate text-[9px] text-pi-dim">{label}</div>
    </div>
  );
}

function ResourceCount({ icon, value }: { icon: ReactNode; value: number }) {
  return (
    <span className="flex items-center gap-1 text-[10px] text-pi-dim">
      {icon}
      {value}
    </span>
  );
}

function IconButton({ children, title, disabled, danger, onClick }: { children: ReactNode; title: string; disabled?: boolean; danger?: boolean; onClick: () => void }) {
  return (
    <span
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={(event) => {
        event.stopPropagation();
        if (!disabled) onClick();
      }}
      className={cn(
        'flex h-7 w-7 items-center justify-center rounded-md text-pi-dim transition-colors',
        danger ? 'hover:bg-pi-error/10 hover:text-pi-error' : 'hover:bg-pi-bg-hover hover:text-pi-text',
        disabled && 'pointer-events-none opacity-40'
      )}
      title={title}
    >
      {children}
    </span>
  );
}

function Badge({ children, tone }: { children: string; tone: 'warning' | 'muted' }) {
  return (
    <span className={cn(
      'rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase',
      tone === 'warning' ? 'bg-pi-warning/10 text-pi-warning' : 'bg-pi-bg-tertiary text-pi-dim'
    )}>
      {children}
    </span>
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
