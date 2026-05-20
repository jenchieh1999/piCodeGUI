import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Bot,
  CalendarClock,
  Command,
  Flag,
  Loader2,
  Package,
  Puzzle,
  Radio,
  RefreshCw,
  ShieldCheck,
  Wrench,
  Zap,
} from 'lucide-react';
import { useExtensionStore } from '../../stores/extensionStore';
import { useUIStore } from '../../stores/uiStore';
import { useChatStore } from '../../stores/chatStore';
import { piApi } from '../../api/client';
import { useI18n } from '../../lib/i18n';
import type {
  ExtensionInfo,
  ExtensionResourceSnapshot,
  ResourceDiagnosticInfo,
  ResourceTrustDecision,
  ResourceTrustRecord,
} from '../../types';
import { cn } from '../shared/utils';

export function ExtensionsView() {
  const { t } = useI18n();
  const extensions = useExtensionStore((s) => Array.isArray(s.extensions) ? s.extensions : []);
  const skills = useExtensionStore((s) => Array.isArray(s.skills) ? s.skills : []);
  const prompts = useExtensionStore((s) => Array.isArray(s.prompts) ? s.prompts : []);
  const diagnostics = useExtensionStore((s) => Array.isArray(s.diagnostics) ? s.diagnostics : []);
  const trust = useExtensionStore((s) => Array.isArray(s.trust) ? s.trust : []);
  const setResourceSnapshot = useExtensionStore((s) => s.setResourceSnapshot);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const setSettingsTab = useUIStore((s) => s.setSettingsTab);
  const setSlashCommands = useUIStore((s) => s.setSlashCommands);
  const addToast = useUIStore((s) => s.addToast);
  const activeSession = useChatStore((s) => s.sessions.find((session) => session.id === s.activeSessionId));
  const [isReloading, setIsReloading] = useState(false);
  const [trustBusy, setTrustBusy] = useState<string | null>(null);

  const projectPath = activeSession?.projectPath;
  const extensionDiagnostics = useMemo(
    () => diagnostics.filter((item) => item && (item.resourceType === 'extension' || item.resourceType === 'package')),
    [diagnostics]
  );

  useEffect(() => {
    void reload(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath]);

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

  const updateTrust = async (record: ResourceTrustRecord, decision: ResourceTrustDecision) => {
    setTrustBusy(record.id);
    try {
      applySnapshot(await piApi.setResourceTrust({
        id: record.id,
        kind: record.kind,
        name: record.name,
        source: record.source,
        path: record.path,
        decision,
        projectPath,
      }));
      addToast({ type: 'success', message: t('extensions.trustSaved') });
    } catch (err) {
      addToast({ type: 'error', message: t('extensions.reloadFailed', { message: errorMessage(err) }), duration: 6000 });
    } finally {
      setTrustBusy(null);
    }
  };

  const openChannels = () => {
    setSettingsTab('channels');
    setActiveView('settings');
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-pi-border">
        <button
          onClick={() => setActiveView('chat')}
          className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-pi-bg-hover text-pi-dim hover:text-pi-text transition-colors"
          title={t('common.backToChat')}
        >
          <ArrowLeft size={16} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-display font-semibold text-pi-text">{t('extensions.title')}</h1>
          <p className="mt-0.5 text-[10px] text-pi-dim">
            {t('extensions.resourcesSummary', {
              extensions: extensions.length,
              skills: skills.length,
              prompts: prompts.length,
              trust: trust.length,
            })}
          </p>
        </div>
        <button
          onClick={() => void reload()}
          disabled={isReloading}
          className="flex h-8 items-center gap-1.5 rounded-md border border-pi-border px-3 text-xs text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text disabled:opacity-50"
        >
          {isReloading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          {t('extensions.reload')}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 space-y-8">
        <section>
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck size={15} className="text-pi-accent" />
            <h2 className="text-xs font-semibold text-pi-text">{t('extensions.trustCenter')}</h2>
            <span className="text-[10px] text-pi-dim">{trust.length}</span>
          </div>
          <p className="mb-3 text-[10px] leading-relaxed text-pi-dim">{t('extensions.trustHint')}</p>
          {trust.length === 0 ? (
            <EmptyList label={t('extensions.trustEmpty')} />
          ) : (
            <div className="grid gap-2 xl:grid-cols-2">
              {trust.filter(Boolean).slice(0, 10).map((record) => (
                <TrustRecordCard
                  key={record.id}
                  record={record}
                  busy={trustBusy === record.id}
                  onDecision={(decision) => void updateTrust(record, decision)}
                />
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="flex items-center gap-2 mb-3">
            <Command size={15} className="text-pi-accent" />
            <h2 className="text-xs font-semibold text-pi-text">{t('extensions.capabilityHub')}</h2>
          </div>
          <div className="grid gap-2 md:grid-cols-4">
            <QuickLink icon={<Bot size={14} />} label={t('extensions.openAgents')} onClick={() => setActiveView('agents')} />
            <QuickLink icon={<Radio size={14} />} label={t('extensions.openChannels')} onClick={openChannels} />
            <QuickLink icon={<CalendarClock size={14} />} label={t('extensions.openTasks')} onClick={() => setActiveView('tasks')} />
            <QuickLink icon={<Package size={14} />} label={t('extensions.openPackages')} onClick={() => setActiveView('packages')} />
          </div>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-3">
            <Puzzle size={15} className="text-pi-accent" />
            <h2 className="text-xs font-semibold text-pi-text">{t('extensions.runtime')}</h2>
            <span className="text-[10px] text-pi-dim">{extensions.length}</span>
          </div>

          {extensions.length === 0 ? (
            <EmptyList label={t('extensions.emptyRuntime')} />
          ) : (
            <div className="space-y-2">
              {extensions.filter(Boolean).map((extension) => (
                <ExtensionCard key={`${extension.scope}/${extension.path}`} extension={extension} />
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="flex items-center gap-2 mb-3">
            <BookOpen size={15} className="text-pi-accent" />
            <h2 className="text-xs font-semibold text-pi-text">{t('extensions.skills')}</h2>
            <span className="text-[10px] text-pi-dim">{skills.length}</span>
          </div>

          {skills.length === 0 ? (
            <EmptyList label={t('extensions.emptySkills')} />
          ) : (
            <div className="grid gap-2 xl:grid-cols-2">
              {skills.filter(Boolean).slice(0, 8).map((skill) => (
                <div key={`${skill.scope}/${skill.filePath}`} className="rounded-lg border border-pi-border p-3">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-xs font-medium text-pi-text">{skill.name}</span>
                    <span className="rounded bg-pi-bg-tertiary px-1.5 py-0.5 text-[9px] uppercase text-pi-dim">
                      {skill.scope}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-pi-muted">{skill.description}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle size={15} className="text-pi-warning" />
            <h2 className="text-xs font-semibold text-pi-text">{t('extensions.diagnostics')}</h2>
            <span className="text-[10px] text-pi-dim">{extensionDiagnostics.length}</span>
          </div>

          {extensionDiagnostics.length === 0 ? (
            <div className="rounded-lg border border-dashed border-pi-border py-8 text-center text-xs text-pi-dim">
              {t('extensions.noDiagnostics')}
            </div>
          ) : (
            <div className="space-y-2">
              {extensionDiagnostics.map((diagnostic, index) => (
                <DiagnosticRow key={`${diagnostic.path ?? diagnostic.message}:${index}`} diagnostic={diagnostic} />
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="flex items-center gap-2 mb-3">
            <Zap size={15} className="text-pi-accent" />
            <h2 className="text-xs font-semibold text-pi-text">{t('extensions.widgetAdaptation')}</h2>
          </div>
          <div className="rounded-lg border border-pi-border bg-pi-bg-secondary p-4 text-xs leading-relaxed text-pi-muted">
            {t('extensions.widgetHint')}
          </div>
        </section>
      </div>
    </div>
  );
}

function TrustRecordCard({
  record,
  busy,
  onDecision,
}: {
  record: ResourceTrustRecord;
  busy: boolean;
  onDecision: (decision: ResourceTrustDecision) => void;
}) {
  const { t } = useI18n();
  const actionLabels = {
    trusted: 'extensions.trust.setTrusted',
    untrusted: 'extensions.trust.setUntrusted',
    blocked: 'extensions.trust.setBlocked',
  } as const;
  const decision: ResourceTrustDecision = record.decision === 'trusted' || record.decision === 'blocked' ? record.decision : 'untrusted';
  const tone = decision === 'blocked'
    ? 'border-pi-error/40 bg-pi-error/5 text-pi-error'
    : decision === 'trusted'
      ? 'border-pi-success/40 bg-pi-success/5 text-pi-success'
      : 'border-pi-warning/40 bg-pi-warning/5 text-pi-warning';

  return (
    <div className="rounded-lg border border-pi-border bg-pi-bg-secondary p-3">
      <div className="flex items-start gap-3">
        <ShieldCheck size={16} className="mt-0.5 flex-shrink-0 text-pi-accent" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-xs font-semibold text-pi-text">{record.name || record.id}</span>
            <span className="rounded bg-pi-bg-tertiary px-1.5 py-0.5 text-[9px] uppercase text-pi-dim">{record.kind}</span>
            <span className={cn('rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase', tone)}>
              {t(`extensions.trust.${decision}`)}
            </span>
          </div>
          {record.source && <div className="mt-1 truncate text-[10px] text-pi-dim">{record.source}</div>}
          {record.path && <div className="mt-0.5 truncate font-mono text-[10px] text-pi-dim">{record.path}</div>}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {(['trusted', 'untrusted', 'blocked'] as const).map((decision) => (
              <button
                key={decision}
                onClick={() => onDecision(decision)}
                disabled={busy || record.decision === decision}
                className={cn(
                  'h-7 rounded-md border px-2 text-[10px] font-medium transition-colors disabled:opacity-45',
                  record.decision === decision
                    ? 'border-pi-accent bg-pi-selected-bg text-pi-accent'
                    : 'border-pi-border text-pi-muted hover:bg-pi-bg-hover hover:text-pi-text'
                )}
              >
                {t(actionLabels[decision])}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function QuickLink({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex h-10 items-center justify-center gap-2 rounded-lg border border-pi-border bg-pi-bg-secondary px-3 text-xs font-medium text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
    >
      <span className="text-pi-accent">{icon}</span>
      {label}
    </button>
  );
}

function ExtensionCard({ extension }: { extension: ExtensionInfo }) {
  const { t } = useI18n();
  const capabilityGroups = [
    { label: t('extensions.tools'), icon: Wrench, values: extension.tools ?? [] },
    { label: t('extensions.commands'), icon: Command, values: extension.commands ?? [] },
    { label: t('extensions.flags'), icon: Flag, values: extension.flags ?? [] },
    { label: t('extensions.shortcuts'), icon: Zap, values: extension.shortcuts ?? [] },
  ].filter((group) => group.values.length > 0);

  return (
    <div
      className={cn(
        'rounded-lg border p-3 transition-colors',
        extension.errors?.length ? 'border-pi-error/40 bg-pi-error/5' : 'border-pi-border hover:border-pi-muted'
      )}
    >
      <div className="flex items-start gap-3">
        <Puzzle size={17} className={cn('mt-0.5 flex-shrink-0', extension.errors?.length ? 'text-pi-error' : 'text-pi-accent')} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-pi-text">{extension.name}</span>
            <span className="rounded bg-pi-bg-tertiary px-1.5 py-0.5 text-[9px] uppercase text-pi-dim">
              {extension.scope}
            </span>
            <span className="rounded bg-pi-bg-tertiary px-1.5 py-0.5 text-[9px] uppercase text-pi-dim">
              {extension.source}
            </span>
          </div>
          <div className="mt-1 truncate font-mono text-[10px] text-pi-dim">{extension.path}</div>
          {extension.sourceName && (
            <div className="mt-0.5 truncate text-[10px] text-pi-dim">{extension.sourceName}</div>
          )}
          {capabilityGroups.length > 0 && (
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {capabilityGroups.map((group) => (
                <div key={group.label} className="rounded-md bg-pi-bg-tertiary p-2">
                  <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase text-pi-dim">
                    <group.icon size={11} />
                    {group.label}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {group.values.slice(0, 8).map((value) => (
                      <span key={value} className="rounded bg-pi-bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-pi-muted">
                        {value}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {extension.errors?.map((error) => (
            <div key={error} className="mt-2 text-[10px] text-pi-error">{error}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DiagnosticRow({ diagnostic }: { diagnostic: ResourceDiagnosticInfo }) {
  return (
    <div className="rounded-lg border border-pi-warning/30 bg-pi-warning/5 p-3">
      <div className="flex items-center gap-2 text-xs font-medium text-pi-warning">
        <AlertTriangle size={13} />
        {diagnostic.type} {diagnostic.resourceType ? `· ${diagnostic.resourceType}` : ''}
      </div>
      <p className="mt-1 text-xs text-pi-muted">{diagnostic.message}</p>
      {diagnostic.path && <div className="mt-1 truncate font-mono text-[10px] text-pi-dim">{diagnostic.path}</div>}
    </div>
  );
}

function EmptyList({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 rounded-lg border border-dashed border-pi-border text-pi-dim">
      <Puzzle size={22} strokeWidth={1} />
      <p className="text-xs mt-2">{label}</p>
    </div>
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
