import {
  ArrowLeft,
  Bot,
  Briefcase,
  FolderOpen,
  Plus,
  Power,
  RefreshCw,
  RadioTower,
  Save,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { piApi } from '../../api/client';
import { useI18n, type TranslationKey } from '../../lib/i18n';
import { createNewSessionFromPicker, createSessionForProject } from '../../lib/sessionActions';
import { useAgentStore } from '../../stores/agentStore';
import { useModelStore } from '../../stores/modelStore';
import { useUIStore } from '../../stores/uiStore';
import type { AgentConfig, ChannelConfig, ModelInfo } from '../../types';
import { cn } from '../shared/utils';

interface AgentDraft {
  name: string;
  description: string;
  systemPrompt: string;
  enabled: boolean;
  modelKey: string;
  projectPath: string;
  channelIds: string[];
}

type AgentCardModel = {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  enabled: boolean;
  isDefault: boolean;
  modelProvider?: string;
  modelId?: string;
  projectPath?: string;
  channelIds: string[];
  createdAt: number;
  updatedAt: number;
};

type TFunction = (key: TranslationKey, values?: Record<string, string | number>) => string;

const MAIN_AGENT_ID = 'main-agent';

export function AgentsView() {
  const { t } = useI18n();
  const setActiveView = useUIStore((s) => s.setActiveView);
  const setSettingsTab = useUIStore((s) => s.setSettingsTab);
  const addToast = useUIStore((s) => s.addToast);
  const agents = useAgentStore((s) => s.agents);
  const agentsLoading = useAgentStore((s) => s.loading);
  const loadAgents = useAgentStore((s) => s.loadAgents);
  const createAgent = useAgentStore((s) => s.createAgent);
  const updateAgent = useAgentStore((s) => s.updateAgent);
  const deleteAgent = useAgentStore((s) => s.deleteAgent);
  const toggleAgent = useAgentStore((s) => s.toggleAgent);
  const currentModel = useModelStore((s) => s.currentModel);
  const availableModels = useModelStore((s) => s.availableModels);
  const [channels, setChannels] = useState<ChannelConfig[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [savingAgent, setSavingAgent] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentCardModel | null>(null);
  const [draft, setDraft] = useState<AgentDraft>(() => createDraft(t));

  const loadChannels = useCallback(async () => {
    setLoadingChannels(true);
    try {
      const result = await piApi.getChannels();
      setChannels(result.channels);
    } catch (err) {
      addToast({
        type: 'warning',
        message: t('agents.refreshChannelsFailed', { message: err instanceof Error ? err.message : String(err) }),
        duration: 5000,
      });
    } finally {
      setLoadingChannels(false);
    }
  }, [addToast, t]);

  useEffect(() => {
    void loadChannels();
    void loadAgents().catch((err) => {
      addToast({
        type: 'warning',
        message: t('agents.refreshAgentsFailed', { message: err instanceof Error ? err.message : String(err) }),
        duration: 5000,
      });
    });
  }, [addToast, loadAgents, loadChannels, t]);

  const cards = useMemo<AgentCardModel[]>(() => {
    const mainAgent: AgentCardModel = {
      id: MAIN_AGENT_ID,
      name: t('agents.mainName'),
      description: t('agents.mainDescription'),
      systemPrompt: '',
      enabled: true,
      isDefault: true,
      modelProvider: currentModel?.provider,
      modelId: currentModel?.id,
      projectPath: undefined,
      channelIds: [],
      createdAt: 0,
      updatedAt: 0,
    };

    return [
      mainAgent,
      ...agents.map((agent) => ({ ...agent, isDefault: false })),
    ];
  }, [agents, currentModel?.id, currentModel?.provider, t]);

  const assignedChannelIds = useMemo(
    () => new Set(agents.flatMap((agent) => agent.channelIds)),
    [agents]
  );

  const openEditor = (agent?: AgentCardModel) => {
    if (agent) {
      setEditingAgent(agent);
      setDraft(draftFromAgent(agent));
      setEditorOpen(true);
      return;
    }
    setEditingAgent(null);
    setDraft(createDraft(t));
    setEditorOpen(true);
  };

  const refreshAgentsAndChannels = () => {
    void loadChannels();
    void loadAgents().catch((err) => {
      addToast({
        type: 'warning',
        message: t('agents.refreshAgentsFailed', { message: err instanceof Error ? err.message : String(err) }),
        duration: 5000,
      });
    });
  };

  const saveDraft = async () => {
    const model = modelFromKey(draft.modelKey, availableModels);
    const input = {
      name: draft.name,
      description: draft.description,
      systemPrompt: draft.systemPrompt,
      enabled: draft.enabled,
      modelProvider: model?.provider,
      modelId: model?.id,
      projectPath: draft.projectPath,
      channelIds: draft.channelIds,
    };

    setSavingAgent(true);
    try {
      if (editingAgent && !editingAgent.isDefault) {
        const agent = await updateAgent(editingAgent.id, input);
        setEditingAgent({ ...agent, isDefault: false });
        addToast({ type: 'success', message: t('agents.saved', { name: agent.name }) });
      } else {
        const agent = await createAgent(input);
        setEditingAgent({ ...agent, isDefault: false });
        addToast({ type: 'success', message: t('agents.created', { name: agent.name }) });
      }
      setEditorOpen(false);
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : String(err), duration: 6000 });
    } finally {
      setSavingAgent(false);
    }
  };

  const removeAgent = async (agent: AgentCardModel) => {
    if (agent.isDefault) return;
    if (!confirm(t('agents.deleteConfirm', { name: agent.name }))) return;
    try {
      await deleteAgent(agent.id);
      setEditingAgent(null);
      setEditorOpen(false);
      addToast({ type: 'success', message: t('agents.deleted', { name: agent.name }) });
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : String(err), duration: 6000 });
    }
  };

  const toggleAgentEnabled = async (agent: AgentCardModel) => {
    if (agent.isDefault) return;
    try {
      await toggleAgent(agent.id, !agent.enabled);
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : String(err), duration: 6000 });
    }
  };

  const startAgent = async (agent: AgentCardModel) => {
    if (agent.projectPath) {
      createSessionForProject(agent.projectPath);
      return;
    }
    await createNewSessionFromPicker();
  };

  const openMainAgentSettings = () => {
    setSettingsTab('model');
    setActiveView('settings');
  };

  return (
    <div className="h-full overflow-y-auto bg-pi-bg">
      <div className="mx-auto w-full max-w-6xl px-8 py-10">
        <div className="flex items-start justify-between gap-5">
          <button
            onClick={() => setActiveView('chat')}
            className="mt-1 flex h-8 w-8 items-center justify-center rounded-md text-pi-dim transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
            title={t('common.backToChat')}
          >
            <ArrowLeft size={17} />
          </button>

          <div className="min-w-0 flex-1">
            <h1 className="font-display text-5xl font-semibold text-pi-text">{t('agents.title')}</h1>
            <p className="mt-3 max-w-2xl text-sm font-medium leading-relaxed text-pi-muted">
              {t('agents.summary')}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={refreshAgentsAndChannels}
              disabled={loadingChannels || agentsLoading}
              className="flex h-9 items-center gap-1.5 rounded-full border border-pi-border px-4 text-xs font-medium text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text disabled:opacity-50"
              title={t('agents.refresh')}
            >
              <RefreshCw size={13} className={cn((loadingChannels || agentsLoading) && 'animate-spin')} />
              {t('common.refresh')}
            </button>
            <button
              onClick={() => openEditor()}
              className="flex h-9 items-center gap-1.5 rounded-full bg-pi-accent px-4 text-xs font-semibold text-white transition-opacity hover:opacity-90"
            >
              <Plus size={14} />
              {t('agents.add')}
            </button>
          </div>
        </div>

        <div className="mt-10 space-y-4">
          {cards.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              currentModel={currentModel}
              availableModels={availableModels}
              channels={channels}
              assignedChannelIds={assignedChannelIds}
              onStart={() => void startAgent(agent)}
              onSettings={() => agent.isDefault ? openMainAgentSettings() : openEditor(agent)}
              onToggle={() => void toggleAgentEnabled(agent)}
              onDelete={() => void removeAgent(agent)}
            />
          ))}
        </div>
      </div>

      {editorOpen && (
        <AgentEditor
          editingAgent={editingAgent}
          draft={draft}
          setDraft={setDraft}
          availableModels={availableModels}
          channels={channels}
          agents={agents}
          onBrowseWorkspace={async () => {
            try {
              const selected = window.piDesktop
                ? await window.piDesktop.selectProjectDirectory()
                : '';
              if (selected) {
                setDraft((current) => ({ ...current, projectPath: selected }));
              }
            } catch (err) {
              addToast({ type: 'error', message: err instanceof Error ? err.message : String(err) });
            }
          }}
          onClose={() => {
            setEditorOpen(false);
            setEditingAgent(null);
            setDraft(createDraft(t));
          }}
          onSave={saveDraft}
          saving={savingAgent}
          onDelete={editingAgent && !editingAgent.isDefault ? () => void removeAgent(editingAgent) : undefined}
        />
      )}
    </div>
  );
}

function AgentCard({
  agent,
  currentModel,
  availableModels,
  channels,
  assignedChannelIds,
  onStart,
  onSettings,
  onToggle,
  onDelete,
}: {
  agent: AgentCardModel;
  currentModel: ModelInfo | null;
  availableModels: ModelInfo[];
  channels: ChannelConfig[];
  assignedChannelIds: Set<string>;
  onStart: () => void;
  onSettings: () => void;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const boundChannels = channels.filter((channel) => agent.channelIds.includes(channel.id));
  const unassignedCount = agent.isDefault
    ? channels.filter((channel) => !assignedChannelIds.has(channel.id)).length
    : 0;
  const modelLabel = agent.modelId
    ? `${agent.modelProvider ? `${agent.modelProvider}/` : ''}${modelName(agent.modelId, currentModel, availableModels)}`
    : t('common.inherit');
  const channelsLabel = boundChannels.length > 0
    ? boundChannels.map((channel) => channel.name).join(', ')
    : agent.isDefault && unassignedCount > 0
      ? t('agents.unassignedChannels', { count: unassignedCount })
      : t('agents.none');

  return (
    <div className="rounded-2xl border border-pi-border bg-pi-bg-secondary px-5 py-4 transition-colors hover:border-pi-muted">
      <div className="flex items-center gap-4">
        <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-pi-accent/10 text-pi-accent">
          <Bot size={20} />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-pi-text">{agent.name}</span>
            {agent.isDefault && (
              <span className="rounded-full bg-pi-bg-tertiary px-2 py-0.5 text-[10px] font-semibold text-pi-muted">
                {t('common.default')}
              </span>
            )}
            {!agent.isDefault && (
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                  agent.enabled ? 'bg-pi-success/10 text-pi-success' : 'bg-pi-bg-tertiary text-pi-dim'
                )}
              >
                {agent.enabled ? t('common.enabled') : t('common.disabled')}
              </span>
            )}
          </div>
          <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-pi-muted">{agent.description}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-pi-muted">
            <span>
              {t('agents.modelLine', { model: modelLabel })}
              {agent.isDefault ? ` ${t('agents.inheritedSuffix')}` : ''}
            </span>
            <span>{t('agents.channelsLine', { channels: channelsLabel })}</span>
            {agent.projectPath && (
              <span className="inline-flex min-w-0 items-center gap-1">
                <Briefcase size={12} />
                <span className="max-w-[360px] truncate">{agent.projectPath}</span>
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-shrink-0 items-center gap-2">
          <IconButton label={t('agents.startSession')} onClick={onStart}>
            <Plus size={14} />
          </IconButton>
          {!agent.isDefault && (
            <IconButton label={agent.enabled ? t('tasks.disable') : t('tasks.enable')} onClick={onToggle}>
              <Power size={14} />
            </IconButton>
          )}
          <IconButton label={t('common.configure')} onClick={onSettings}>
            <Settings2 size={14} />
          </IconButton>
          {!agent.isDefault && (
            <IconButton label={t('common.delete')} danger onClick={onDelete}>
              <Trash2 size={14} />
            </IconButton>
          )}
        </div>
      </div>
    </div>
  );
}

function AgentEditor({
  editingAgent,
  draft,
  setDraft,
  availableModels,
  channels,
  agents,
  onBrowseWorkspace,
  onClose,
  onSave,
  saving,
  onDelete,
}: {
  editingAgent: AgentCardModel | null;
  draft: AgentDraft;
  setDraft: Dispatch<SetStateAction<AgentDraft>>;
  availableModels: ModelInfo[];
  channels: ChannelConfig[];
  agents: AgentConfig[];
  onBrowseWorkspace: () => void;
  onClose: () => void;
  onSave: () => void | Promise<void>;
  saving: boolean;
  onDelete?: () => void;
}) {
  const { t } = useI18n();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-5">
      <div className="max-h-[88vh] w-full max-w-3xl overflow-hidden rounded-2xl border border-pi-border bg-pi-bg-secondary shadow-2xl">
        <div className="flex items-center justify-between border-b border-pi-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-pi-text">
              {editingAgent ? t('agents.editorTitleEdit') : t('agents.editorTitleAdd')}
            </h2>
            <p className="mt-0.5 text-[10px] text-pi-dim">{t('agents.editorDescription')}</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-pi-dim transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
            title={t('common.close')}
          >
            <X size={15} />
          </button>
        </div>

        <div className="max-h-[calc(88vh-120px)] overflow-y-auto p-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t('common.name')}>
              <input
                value={draft.name}
                onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                className={inputClass}
              />
            </Field>

            <Field label={t('common.model')}>
              <select
                value={draft.modelKey}
                onChange={(event) => setDraft((current) => ({ ...current, modelKey: event.target.value }))}
                className={inputClass}
              >
                <option value="">{t('agents.inheritGlobalModel')}</option>
                {availableModels.map((model) => (
                  <option key={`${model.provider}/${model.id}`} value={modelKey(model)}>
                    {model.provider}/{model.name}
                  </option>
                ))}
              </select>
            </Field>

            <Field label={t('agents.field.description')} wide>
              <input
                value={draft.description}
                onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                className={inputClass}
              />
            </Field>

            <Field label={t('agents.field.workspace')} wide>
              <div className="grid grid-cols-[minmax(0,1fr)_86px] gap-2">
                <input
                  value={draft.projectPath}
                  onChange={(event) => setDraft((current) => ({ ...current, projectPath: event.target.value }))}
                  placeholder={t('agents.workspacePlaceholder')}
                  className={cn(inputClass, 'min-w-0')}
                />
                <button
                  type="button"
                  onClick={onBrowseWorkspace}
                  className="inline-flex h-8 w-full flex-shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-pi-border bg-pi-bg-tertiary px-3 text-xs font-medium text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
                >
                  <FolderOpen size={13} />
                  {t('common.select')}
                </button>
              </div>
            </Field>

            <Field label={t('agents.channelRouting')} wide>
              <div className="grid gap-2 md:grid-cols-2">
                {channels.map((channel) => {
                  const checked = draft.channelIds.includes(channel.id);
                  const owner = agents.find((agent) =>
                    agent.id !== editingAgent?.id && agent.channelIds.includes(channel.id)
                  );
                  return (
                    <button
                      key={channel.id}
                      onClick={() => setDraft((current) => ({
                        ...current,
                        channelIds: checked
                          ? current.channelIds.filter((id) => id !== channel.id)
                          : [...current.channelIds, channel.id],
                      }))}
                      className={cn(
                        'flex items-center gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors',
                        checked
                          ? 'border-pi-accent bg-pi-selected-bg text-pi-accent'
                          : 'border-pi-border text-pi-muted hover:bg-pi-bg-hover hover:text-pi-text'
                      )}
                    >
                      <RadioTower size={13} />
                      <span className="min-w-0 flex-1 truncate">{channel.name}</span>
                      <span className="rounded bg-pi-bg-tertiary px-1.5 py-0.5 text-[9px] uppercase text-pi-dim">
                        {owner ? t('agents.moveFrom', { name: owner.name }) : channel.provider}
                      </span>
                    </button>
                  );
                })}
                {channels.length === 0 && (
                  <div className="rounded-md border border-dashed border-pi-border px-3 py-6 text-center text-xs text-pi-dim md:col-span-2">
                    {t('agents.noChannels')}
                  </div>
                )}
              </div>
            </Field>

            <Field label={t('agents.systemPrompt')} wide>
              <textarea
                value={draft.systemPrompt}
                onChange={(event) => setDraft((current) => ({ ...current, systemPrompt: event.target.value }))}
                rows={6}
                placeholder={t('agents.systemPromptPlaceholder')}
                className="w-full resize-y rounded-md border border-pi-border bg-pi-bg-tertiary px-3 py-2 text-xs leading-relaxed text-pi-text placeholder:text-pi-dim focus:border-pi-accent focus:outline-none"
              />
            </Field>

            <div className="md:col-span-2 flex items-center justify-between rounded-md border border-pi-border bg-pi-bg-tertiary px-3 py-2">
              <div>
                <div className="text-xs font-medium text-pi-text">{t('agents.enable')}</div>
                <div className="mt-0.5 text-[10px] text-pi-dim">{t('agents.enableHint')}</div>
              </div>
              <ToggleSwitch
                enabled={draft.enabled}
                onClick={() => setDraft((current) => ({ ...current, enabled: !current.enabled }))}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-pi-border px-5 py-4">
          <div>
            {onDelete && (
              <button
                onClick={onDelete}
                className="flex h-8 items-center gap-1.5 rounded-md border border-pi-error/40 px-3 text-xs text-pi-error transition-colors hover:bg-pi-error/10"
              >
                <Trash2 size={13} />
                {t('common.delete')}
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="h-8 rounded-md border border-pi-border px-3 text-xs text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={onSave}
              disabled={saving}
              className="flex h-8 items-center gap-1.5 rounded-md bg-pi-accent px-3 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Save size={13} className={cn(saving && 'animate-pulse')} />
              {t('common.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToggleSwitch({ enabled, onClick }: { enabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full border p-0.5 transition-colors focus:outline-none focus:ring-2 focus:ring-pi-accent/40',
        enabled
          ? 'border-pi-accent bg-pi-accent'
          : 'border-pi-border bg-pi-bg-hover'
      )}
    >
      <span
        className={cn(
          'h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
          enabled ? 'translate-x-5' : 'translate-x-0'
        )}
      />
    </button>
  );
}

function IconButton({
  label,
  danger,
  onClick,
  children,
}: {
  label: string;
  danger?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-md border border-pi-border transition-colors',
        danger
          ? 'text-pi-dim hover:border-pi-error/50 hover:bg-pi-error/10 hover:text-pi-error'
          : 'text-pi-dim hover:bg-pi-bg-hover hover:text-pi-text'
      )}
    >
      {children}
    </button>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <label className={cn('block space-y-1.5', wide && 'md:col-span-2')}>
      <span className="text-[10px] font-semibold uppercase text-pi-dim">{label}</span>
      {children}
    </label>
  );
}

function createDraft(t: TFunction, name?: string, visible = true): AgentDraft {
  return {
    name: visible ? (name ?? t('agents.defaultDraftName')) : '',
    description: visible ? t('agents.defaultDraftDescription') : '',
    systemPrompt: '',
    enabled: true,
    modelKey: '',
    projectPath: '',
    channelIds: [],
  };
}

function draftFromAgent(agent: AgentCardModel): AgentDraft {
  return {
    name: agent.name,
    description: agent.description,
    systemPrompt: agent.systemPrompt,
    enabled: agent.enabled,
    modelKey: agent.modelProvider && agent.modelId ? `${agent.modelProvider}/${agent.modelId}` : '',
    projectPath: agent.projectPath ?? '',
    channelIds: agent.channelIds,
  };
}

function modelKey(model: ModelInfo): string {
  return `${model.provider}/${model.id}`;
}

function modelFromKey(value: string, models: ModelInfo[]): ModelInfo | undefined {
  if (!value) return undefined;
  const [provider, ...rest] = value.split('/');
  const id = rest.join('/');
  return models.find((model) => model.provider === provider && model.id === id);
}

function modelName(modelId: string, currentModel: ModelInfo | null, availableModels: ModelInfo[]): string {
  if (currentModel?.id === modelId) return currentModel.name;
  const model = availableModels.find((item) => item.id === modelId);
  if (model) return model.name;
  return modelId;
}

const inputClass = 'h-8 w-full rounded-md border border-pi-border bg-pi-bg-tertiary px-3 text-xs text-pi-text placeholder:text-pi-dim focus:border-pi-accent focus:outline-none';
