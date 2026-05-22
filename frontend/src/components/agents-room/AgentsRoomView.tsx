import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  Copy,
  FileText,
  FolderOpen,
  FlaskConical,
  Loader2,
  MessageSquarePlus,
  Network,
  PauseCircle,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Scale,
  ShieldCheck,
  Sparkles,
  Trash2,
  UsersRound,
  X,
} from 'lucide-react';
import { piApi } from '../../api/client';
import { useI18n } from '../../lib/i18n';
import { useAgentRoomStore } from '../../stores/agentRoomStore';
import { useChatStore } from '../../stores/chatStore';
import { useModelStore } from '../../stores/modelStore';
import { useUIStore } from '../../stores/uiStore';
import type {
  AgentRoom,
  AgentRoomArtifact,
  AgentRoomCreateInput,
  AgentRoomCitation,
  AgentRoomInterventionAction,
  AgentRoomMessage,
  AgentRoomRun,
  AgentRoomTask,
  ModelInfo,
  ModelRef,
} from '../../types';
import { MarkdownRenderer } from '../markdown/MarkdownRenderer';
import { cn } from '../shared/utils';

const EMPTY_MESSAGES: AgentRoomMessage[] = [];
const EMPTY_ARTIFACTS: AgentRoomArtifact[] = [];
const EMPTY_TASKS: AgentRoomTask[] = [];
const EMPTY_RUNS: AgentRoomRun[] = [];

type AgentRoomArtifactFilter = 'all' | 'final' | 'evidence' | 'claims' | 'risks';
type AgentRoomInterventionDraft =
  | { action: 'add_note'; title: string; placeholder: string }
  | { action: 'add_evidence'; group: 'left' | 'right'; title: string; placeholder: string }
  | { action: 'rerun_final'; title: string; placeholder: string };

export function AgentsRoomView() {
  const { t } = useI18n();
  const setActiveView = useUIStore((s) => s.setActiveView);
  const addToast = useUIStore((s) => s.addToast);
  const requestWorkspaceOpen = useUIStore((s) => s.requestWorkspaceOpen);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const activeSession = useChatStore((s) => s.sessions.find((session) => session.id === activeSessionId));
  const availableModels = useModelStore((s) => s.availableModels);
  const currentModel = useModelStore((s) => s.currentModel);
  const rooms = useAgentRoomStore((s) => s.rooms);
  const activeRoomId = useAgentRoomStore((s) => s.activeRoomId);
  const setSnapshot = useAgentRoomStore((s) => s.setSnapshot);
  const setLoading = useAgentRoomStore((s) => s.setLoading);
  const loading = useAgentRoomStore((s) => s.loading);
  const setActiveRoom = useAgentRoomStore((s) => s.setActiveRoom);
  const runsByRoom = useAgentRoomStore((s) => s.runsByRoom);
  const messagesByRoom = useAgentRoomStore((s) => s.messagesByRoom);
  const artifactsByRoom = useAgentRoomStore((s) => s.artifactsByRoom);
  const tasksByRoom = useAgentRoomStore((s) => s.tasksByRoom);
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<AgentRoom | null>(null);
  const [interventionDraft, setInterventionDraft] = useState<AgentRoomInterventionDraft | null>(null);

  useEffect(() => {
    let disposed = false;
    setLoading(true);
    piApi.getAgentRooms()
      .then((snapshot) => {
        if (!disposed) setSnapshot(snapshot);
      })
      .catch((err) => {
        if (!disposed) {
          addToast({
            type: 'error',
            message: t('agentsRoom.loadFailed', { message: err instanceof Error ? err.message : String(err) }),
            duration: 6000,
          });
        }
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [addToast, setLoading, setSnapshot, t]);

  const activeRoom = rooms.find((room) => room.id === activeRoomId) ?? rooms[0] ?? null;
  const runs = activeRoom ? runsByRoom[activeRoom.id] ?? EMPTY_RUNS : EMPTY_RUNS;
  const latestRun = runs[0] ?? null;
  const messages = activeRoom ? messagesByRoom[activeRoom.id] ?? EMPTY_MESSAGES : EMPTY_MESSAGES;
  const artifacts = activeRoom ? artifactsByRoom[activeRoom.id] ?? EMPTY_ARTIFACTS : EMPTY_ARTIFACTS;
  const tasks = activeRoom ? tasksByRoom[activeRoom.id] ?? EMPTY_TASKS : EMPTY_TASKS;
  const finalReport = artifacts.find((artifact) => artifact.type === 'final_report') ?? null;
  const activeModel = activeSession?.modelId
    ? availableModels.find((model) => model.id === activeSession.modelId && (!activeSession.modelProvider || model.provider === activeSession.modelProvider)) ?? currentModel
    : currentModel;

  const startRun = async (room: AgentRoom) => {
    try {
      const result = await piApi.startAgentRoomRun(room.id);
      useAgentRoomStore.getState().upsertRoom(result.room);
      useAgentRoomStore.getState().upsertRun(result.run);
      setActiveRoom(room.id);
    } catch (err) {
      addToast({
        type: 'error',
        message: t('agentsRoom.startFailed', { message: err instanceof Error ? err.message : String(err) }),
        duration: 6000,
      });
    }
  };

  const cancelRun = async (room: AgentRoom, run: AgentRoomRun) => {
    try {
      const result = await piApi.cancelAgentRoomRun(room.id, run.id);
      useAgentRoomStore.getState().upsertRoom(result.room);
      useAgentRoomStore.getState().upsertRun(result.run);
    } catch (err) {
      addToast({
        type: 'error',
        message: t('agentsRoom.cancelFailed', { message: err instanceof Error ? err.message : String(err) }),
        duration: 6000,
      });
    }
  };

  const deleteRoom = async (room: AgentRoom) => {
    if (!confirm(t('agentsRoom.deleteConfirm', { title: room.title }))) return;
    try {
      await piApi.deleteAgentRoom(room.id);
      useAgentRoomStore.getState().removeRoom(room.id);
    } catch (err) {
      addToast({
        type: 'error',
        message: t('agentsRoom.deleteFailed', { message: err instanceof Error ? err.message : String(err) }),
        duration: 6000,
      });
    }
  };

  const updateRoom = async (
    room: AgentRoom,
    input: Pick<AgentRoomCreateInput, 'title' | 'leftLabel' | 'rightLabel' | 'neutralLabel' | 'quickModel' | 'deepModel'>,
  ) => {
    try {
      const result = await piApi.updateAgentRoom(room.id, input);
      useAgentRoomStore.getState().upsertRoom(result.room);
      setEditingRoom(null);
    } catch (err) {
      addToast({
        type: 'error',
        message: t('agentsRoom.updateFailed', { message: err instanceof Error ? err.message : String(err) }),
        duration: 6000,
      });
    }
  };

  const submitIntervention = async (draft: AgentRoomInterventionDraft, text: string) => {
    if (!activeRoom || !latestRun) {
      addToast({ type: 'warning', message: t('agentsRoom.noRunForIntervention') });
      return;
    }

    try {
      const input = draft.action === 'add_note'
        ? { action: 'add_note' as AgentRoomInterventionAction, note: text }
        : draft.action === 'add_evidence'
          ? { action: 'add_evidence' as AgentRoomInterventionAction, group: draft.group, instruction: text }
          : { action: 'rerun_final' as AgentRoomInterventionAction, instruction: text };
      const result = await piApi.createAgentRoomIntervention(activeRoom.id, input);
      useAgentRoomStore.getState().setSnapshot(result.snapshot);
      setInterventionDraft(null);
      addToast({ type: 'success', message: t('agentsRoom.interventionDone') });
    } catch (err) {
      addToast({
        type: 'error',
        message: t('agentsRoom.interventionFailed', { message: err instanceof Error ? err.message : String(err) }),
        duration: 6000,
      });
    }
  };

  const insertFinalToChat = () => {
    if (!finalReport || !activeSessionId) {
      addToast({ type: 'warning', message: t('agentsRoom.noFinalReport') });
      return;
    }
    window.dispatchEvent(new CustomEvent('pi:add-workspace-reference', { detail: { sessionId: activeSessionId } }));
    useChatStore.getState().addUserMessage(activeSessionId, finalReport.content);
    setActiveView('chat');
  };

  const insertArtifactToChat = (artifact: AgentRoomArtifact) => {
    if (!activeSessionId) {
      addToast({ type: 'warning', message: t('agentsRoom.noActiveChat') });
      return;
    }
    useChatStore.getState().addUserMessage(activeSessionId, `# ${artifact.title}\n\n${artifact.content}`);
    addToast({ type: 'success', message: t('agentsRoom.artifactInserted') });
    setActiveView('chat');
  };

  const openWorkspaceSource = (artifact: AgentRoomArtifact) => {
    const citation = workspaceCitationForArtifact(artifact);
    const sessionId = activeRoom?.sessionId ?? activeSessionId;
    if (!citation || !sessionId) {
      addToast({ type: 'warning', message: t('agentsRoom.noWorkspaceSource') });
      return;
    }
    requestWorkspaceOpen(sessionId, citation.source);
    setActiveView('chat');
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-pi-bg text-pi-text">
      <div className="flex h-14 flex-shrink-0 items-center gap-3 border-b border-pi-border/70 px-4">
        <button
          onClick={() => setActiveView('chat')}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-pi-dim transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
          title={t('common.backToChat')}
        >
          <ArrowLeft size={16} />
        </button>
        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-pi-accent/20 bg-pi-accent/10 text-pi-accent">
          <Network size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{t('agentsRoom.title')}</div>
          <div className="truncate text-[11px] text-pi-dim">{t('agentsRoom.subtitle')}</div>
        </div>
        <button
          onClick={() => setLauncherOpen(true)}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-pi-accent px-3 text-xs font-semibold text-white transition-opacity hover:opacity-90"
        >
          <Plus size={14} />
          {t('agentsRoom.newRoom')}
        </button>
        <button
          onClick={() => void piApi.getAgentRooms().then(setSnapshot)}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-pi-border text-pi-dim transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
          title={t('common.refresh')}
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
        </button>
      </div>

      <div
        className="grid min-h-0 flex-1 overflow-hidden"
        style={{ gridTemplateColumns: '260px minmax(0, 1fr) clamp(360px, 30vw, 460px)' }}
      >
        <aside className="min-h-0 border-r border-pi-border/70 bg-pi-bg-secondary/40">
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex-shrink-0 px-3 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-pi-dim">{t('agentsRoom.rooms')}</div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
              {rooms.length === 0 ? (
                <EmptyRoomList onCreate={() => setLauncherOpen(true)} />
              ) : (
                <div className="space-y-1.5">
                  {rooms.map((room) => (
                    <RoomListItem
                      key={room.id}
                      room={room}
                      active={room.id === activeRoom?.id}
                      latestRun={runsByRoom[room.id]?.[0]}
                      onClick={() => setActiveRoom(room.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </aside>

        <main className="min-h-0 overflow-hidden">
          {activeRoom ? (
            <div className="flex h-full min-h-0 flex-col">
              <RoomHeader
                room={activeRoom}
                run={latestRun}
                onStart={() => void startRun(activeRoom)}
                onCancel={latestRun && latestRun.status === 'running' ? () => void cancelRun(activeRoom, latestRun) : undefined}
                onEdit={() => setEditingRoom(activeRoom)}
                onDelete={() => void deleteRoom(activeRoom)}
              />
              <Timeline room={activeRoom} run={latestRun} tasks={tasks} />
              <InterventionBar
                room={activeRoom}
                run={latestRun}
                finalReportReady={Boolean(finalReport)}
                onAddNote={() => setInterventionDraft({
                  action: 'add_note',
                  title: t('agentsRoom.intervention.noteTitle'),
                  placeholder: t('agentsRoom.intervention.notePlaceholder'),
                })}
                onAddLeftEvidence={() => setInterventionDraft({
                  action: 'add_evidence',
                  group: 'left',
                  title: t('agentsRoom.intervention.leftEvidenceTitle', { label: activeRoom.leftLabel }),
                  placeholder: t('agentsRoom.intervention.evidencePlaceholder'),
                })}
                onAddRightEvidence={() => setInterventionDraft({
                  action: 'add_evidence',
                  group: 'right',
                  title: t('agentsRoom.intervention.rightEvidenceTitle', { label: activeRoom.rightLabel }),
                  placeholder: t('agentsRoom.intervention.evidencePlaceholder'),
                })}
                onRerunFinal={() => setInterventionDraft({
                  action: 'rerun_final',
                  title: t('agentsRoom.intervention.finalTitle'),
                  placeholder: t('agentsRoom.intervention.finalPlaceholder'),
                })}
              />
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="grid min-h-0 flex-1 grid-cols-2 gap-px overflow-hidden bg-pi-border/50">
                  <AgentGroupColumn
                    group="left"
                    label={activeRoom.leftLabel}
                    icon={<UsersRound size={15} />}
                    messages={messages.filter((message) => message.group === 'left')}
                    tone="left"
                  />
                  <AgentGroupColumn
                    group="right"
                    label={activeRoom.rightLabel}
                    icon={<Scale size={15} />}
                    messages={messages.filter((message) => message.group === 'right')}
                    tone="right"
                  />
                </div>
                <NeutralStrip
                  label={activeRoom.neutralLabel}
                  messages={messages.filter((message) => message.group === 'neutral' || message.group === 'moderator')}
                />
              </div>
            </div>
          ) : (
            <EmptyRoomCanvas onCreate={() => setLauncherOpen(true)} />
          )}
        </main>

        <aside className="min-h-0 overflow-hidden border-l border-pi-border/70 bg-pi-bg-secondary/40">
          <EvidencePanel
            artifacts={artifacts}
            finalReport={finalReport}
            onInsertFinal={insertFinalToChat}
            onInsertArtifact={insertArtifactToChat}
            onOpenWorkspaceSource={openWorkspaceSource}
          />
        </aside>
      </div>

      {launcherOpen && (
        <AgentRoomLauncher
          defaultQuestion={activeSession ? t('agentsRoom.defaultQuestion', { project: activeSession.projectName }) : ''}
          sessionId={activeSessionId ?? undefined}
          projectPath={activeSession?.projectPath}
          availableModels={availableModels}
          defaultModel={activeModel}
          onClose={() => setLauncherOpen(false)}
          onCreated={(room) => {
            setLauncherOpen(false);
            setActiveRoom(room.id);
            void startRun(room);
          }}
        />
      )}
      {editingRoom && (
        <AgentRoomEditDialog
          room={editingRoom}
          availableModels={availableModels}
          onClose={() => setEditingRoom(null)}
          onSave={(input) => updateRoom(editingRoom, input)}
        />
      )}
      {interventionDraft && (
        <AgentRoomInterventionDialog
          draft={interventionDraft}
          onClose={() => setInterventionDraft(null)}
          onSubmit={(text) => void submitIntervention(interventionDraft, text)}
        />
      )}
    </div>
  );
}

function RoomHeader({
  room,
  run,
  onStart,
  onCancel,
  onEdit,
  onDelete,
}: {
  room: AgentRoom;
  run: AgentRoomRun | null;
  onStart: () => void;
  onCancel?: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useI18n();
  const running = run?.status === 'running';

  return (
    <div className="flex flex-shrink-0 items-center gap-3 border-b border-pi-border/70 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-base font-semibold text-pi-text">{room.title}</h1>
          <StatusPill status={room.status} />
        </div>
        <p className="mt-1 line-clamp-1 text-xs text-pi-muted">{room.question}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <SourceScopePill
            label={t('agentsRoom.workspaceSearch')}
            active={room.config.useWorkspaceSearch}
            title={t('agentsRoom.workspaceSearchHint')}
          />
          <SourceScopePill
            label={t('agentsRoom.webSearch')}
            active={room.config.useWebSearch}
            title={t('agentsRoom.webSearchHint')}
          />
        </div>
      </div>
      <div className="flex items-center gap-2">
        {onCancel ? (
          <button
            onClick={onCancel}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-pi-warning/40 bg-pi-warning/10 px-3 text-xs font-semibold text-pi-warning transition-colors hover:bg-pi-warning/15"
          >
            <PauseCircle size={14} />
            {t('agentsRoom.cancelRun')}
          </button>
        ) : (
          <button
            onClick={onStart}
            disabled={running}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-pi-accent px-3 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {running ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {run ? t('agentsRoom.rerun') : t('agentsRoom.startRun')}
          </button>
        )}
        <button
          onClick={onEdit}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-pi-border text-pi-dim transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
          title={t('agentsRoom.editRoom')}
        >
          <Pencil size={14} />
        </button>
        <button
          onClick={onDelete}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-pi-border text-pi-dim transition-colors hover:border-pi-error/40 hover:bg-pi-error/10 hover:text-pi-error"
          title={t('common.delete')}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

function InterventionBar({
  room,
  run,
  finalReportReady,
  onAddNote,
  onAddLeftEvidence,
  onAddRightEvidence,
  onRerunFinal,
}: {
  room: AgentRoom;
  run: AgentRoomRun | null;
  finalReportReady: boolean;
  onAddNote: () => void;
  onAddLeftEvidence: () => void;
  onAddRightEvidence: () => void;
  onRerunFinal: () => void;
}) {
  const { t } = useI18n();
  const hasRun = Boolean(run);
  const running = run?.status === 'running';
  return (
    <div className="flex flex-shrink-0 items-center gap-2 overflow-x-auto border-b border-pi-border/60 bg-pi-bg-secondary/35 px-4 py-2">
      <span className="flex-shrink-0 text-[10px] font-semibold uppercase tracking-wide text-pi-dim">
        {t('agentsRoom.intervention.title')}
      </span>
      <InterventionButton
        icon={<MessageSquarePlus size={13} />}
        label={t('agentsRoom.intervention.addNote')}
        title={t('agentsRoom.intervention.addNoteHint')}
        disabled={!hasRun}
        onClick={onAddNote}
      />
      <InterventionButton
        icon={<FlaskConical size={13} />}
        label={t('agentsRoom.intervention.addEvidence', { label: room.leftLabel })}
        title={t('agentsRoom.intervention.addEvidenceHint')}
        disabled={!hasRun}
        onClick={onAddLeftEvidence}
      />
      <InterventionButton
        icon={<FlaskConical size={13} />}
        label={t('agentsRoom.intervention.addEvidence', { label: room.rightLabel })}
        title={t('agentsRoom.intervention.addEvidenceHint')}
        disabled={!hasRun}
        onClick={onAddRightEvidence}
      />
      <InterventionButton
        icon={<RefreshCw size={13} />}
        label={t('agentsRoom.intervention.rerunFinal')}
        title={running ? t('agentsRoom.intervention.rerunFinalRunningHint') : t('agentsRoom.intervention.rerunFinalHint')}
        disabled={!hasRun || running || !finalReportReady}
        onClick={onRerunFinal}
      />
      {!hasRun && (
        <span className="flex-shrink-0 text-[10px] text-pi-dim">{t('agentsRoom.intervention.needsRun')}</span>
      )}
    </div>
  );
}

function InterventionButton({
  icon,
  label,
  title,
  disabled,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  title: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className="inline-flex h-7 flex-shrink-0 items-center gap-1.5 rounded-lg border border-pi-border/70 bg-pi-bg/70 px-2.5 text-[11px] font-medium text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text disabled:cursor-not-allowed disabled:opacity-45"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function AgentRoomInterventionDialog({
  draft,
  onClose,
  onSubmit,
}: {
  draft: AgentRoomInterventionDraft;
  onClose: () => void;
  onSubmit: (text: string) => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const optional = draft.action !== 'add_note';
  const canSubmit = optional || text.trim().length > 0;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm">
      <button className="absolute inset-0 cursor-default" aria-label={t('common.close')} onClick={onClose} />
      <div className="pi-panel-material relative z-10 w-full max-w-xl overflow-hidden rounded-xl border border-pi-border shadow-2xl shadow-black/35">
        <div className="flex items-start gap-3 border-b border-pi-border/70 px-4 py-3">
          <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl border border-pi-accent/20 bg-pi-accent/10 text-pi-accent">
            <MessageSquarePlus size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-pi-text">{draft.title}</div>
            <div className="mt-1 text-[11px] leading-relaxed text-pi-dim">{t(`agentsRoom.intervention.${draft.action}Hint` as never)}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-pi-dim transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
            title={t('common.close')}
          >
            <X size={15} />
          </button>
        </div>
        <div className="p-4">
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={draft.placeholder}
            className="pi-embedded-input min-h-[150px] w-full resize-y rounded-xl border border-pi-border/70 bg-pi-bg px-3 py-2 text-sm leading-relaxed text-pi-text outline-none transition-colors placeholder:text-pi-dim focus:border-pi-accent"
          />
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-[11px] text-pi-dim">
              {optional ? t('agentsRoom.intervention.optional') : t('agentsRoom.intervention.required')}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="h-8 rounded-lg border border-pi-border/70 px-3 text-xs font-medium text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                disabled={!canSubmit}
                onClick={() => onSubmit(text.trim())}
                className="h-8 rounded-lg bg-pi-accent px-3 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {t('agentsRoom.intervention.submit')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SourceScopePill({
  label,
  active,
  pending,
  title,
}: {
  label: string;
  active: boolean;
  pending?: boolean;
  title: string;
}) {
  const { t } = useI18n();
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded-full border px-2 text-[10px] font-medium',
        active
          ? 'border-pi-accent/30 bg-pi-accent/10 text-pi-accent'
          : 'border-pi-border/70 bg-pi-bg-tertiary/60 text-pi-dim',
        pending && 'border-pi-warning/25 bg-pi-warning/10 text-pi-warning'
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {label}
      {pending && <span className="text-[9px] opacity-80">{t('agentsRoom.plannedBadge')}</span>}
    </span>
  );
}

function Timeline({ room, run, tasks }: { room: AgentRoom; run: AgentRoomRun | null; tasks: AgentRoomTask[] }) {
  const { t } = useI18n();
  const stages = [
    'planning',
    'left_research',
    'right_research',
    'debate',
    'neutral_review',
    'final_report',
  ] as const;
  const current = run?.currentStage ?? 'intake';
  const activeIndex = stages.findIndex((stage) => stage === current);

  return (
    <div className="flex flex-shrink-0 flex-col border-b border-pi-border/70">
      <div className="flex items-center gap-2 overflow-x-auto px-4 py-2">
        {stages.map((stage, index) => {
          const active = stage === current;
          const done = room.status === 'completed' || (activeIndex >= 0 && index < activeIndex);
          return (
            <div
              key={stage}
              className={cn(
                'inline-flex h-7 flex-shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold',
                active
                  ? 'border-pi-accent/40 bg-pi-accent/10 text-pi-accent'
                  : done
                    ? 'border-pi-success/30 bg-pi-success/10 text-pi-success'
                    : 'border-pi-border bg-pi-bg-tertiary/60 text-pi-dim'
              )}
            >
              {done ? <CheckCircle2 size={12} /> : active ? <Loader2 size={12} className="animate-spin" /> : <FlaskConical size={12} />}
              {t(`agentsRoom.stage.${stage}` as never)}
            </div>
          );
        })}
        <div className="ml-auto hidden flex-shrink-0 text-[11px] text-pi-dim xl:block">
          {t('agentsRoom.taskSummary', {
            done: tasks.filter((task) => task.status === 'completed').length,
            total: tasks.length,
          })}
        </div>
      </div>
      {tasks.length > 0 && <TaskGraphStrip tasks={tasks} />}
    </div>
  );
}

function TaskGraphStrip({ tasks }: { tasks: AgentRoomTask[] }) {
  const { t } = useI18n();

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto border-t border-pi-border/50 px-4 py-2">
      <span className="flex-shrink-0 text-[10px] font-semibold uppercase text-pi-dim">{t('agentsRoom.taskGraph')}</span>
      {tasks.map((task) => (
        <div
          key={task.id}
          className={cn(
            'inline-flex h-7 max-w-[180px] flex-shrink-0 items-center gap-1.5 rounded-full border px-2 text-[10px] font-medium',
            task.status === 'completed'
              ? 'border-pi-success/25 bg-pi-success/10 text-pi-success'
              : task.status === 'running'
                ? 'border-pi-accent/30 bg-pi-accent/10 text-pi-accent'
                : task.status === 'failed'
                  ? 'border-pi-error/30 bg-pi-error/10 text-pi-error'
                  : 'border-pi-border bg-pi-bg-tertiary/60 text-pi-dim'
          )}
          title={[
            task.title,
            task.nodeId ? `node: ${task.nodeId}` : '',
            task.purpose ? t(`agentsRoom.taskPurpose.${task.purpose}` as never) : '',
            (task.dependencies?.length ?? 0) > 0 ? t('agentsRoom.taskDependencies', { count: task.dependencies.length }) : '',
          ].filter(Boolean).join('\n')}
        >
          {task.status === 'running' ? <Loader2 size={11} className="animate-spin" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
          <span className="truncate">{task.agentRole}</span>
          {task.purpose && <span className="rounded-full bg-pi-bg/50 px-1 uppercase">{task.purpose}</span>}
        </div>
      ))}
    </div>
  );
}

function AgentGroupColumn({
  label,
  icon,
  messages,
  tone,
}: {
  group: 'left' | 'right';
  label: string;
  icon: ReactNode;
  messages: AgentRoomMessage[];
  tone: 'left' | 'right';
}) {
  const { t } = useI18n();
  return (
    <section className="min-h-0 overflow-hidden bg-pi-bg">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-10 flex-shrink-0 items-center gap-2 border-b border-pi-border/70 px-3">
          <span
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-lg border',
              tone === 'left'
                ? 'border-pi-accent/25 bg-pi-accent/10 text-pi-accent'
                : 'border-pi-warning/25 bg-pi-warning/10 text-pi-warning'
            )}
          >
            {icon}
          </span>
          <span className="min-w-0 flex-1 truncate text-xs font-semibold">{label}</span>
          <span className="text-[10px] text-pi-dim">{messages.length}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {messages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-center text-xs text-pi-dim">
              {t('agentsRoom.waitingForGroup')}
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((message) => <AgentRoomMessageCard key={message.id} message={message} />)}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function NeutralStrip({ label, messages }: { label: string; messages: AgentRoomMessage[] }) {
  const { t } = useI18n();
  return (
    <section className="flex min-h-[240px] flex-[0_1_36%] flex-col overflow-hidden border-t border-pi-border/70 bg-pi-bg-secondary/50">
      <div className="flex h-11 flex-shrink-0 items-center gap-2 border-b border-pi-border/60 px-4 text-xs font-semibold text-pi-text">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg border border-pi-success/25 bg-pi-success/10 text-pi-success">
          <ShieldCheck size={14} />
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="text-[10px] font-medium text-pi-dim">{messages.length}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 ? (
          <div className="text-xs text-pi-dim">{t('agentsRoom.neutralWaiting')}</div>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {messages.map((message) => <AgentRoomMessageCard key={message.id} message={message} compact />)}
          </div>
        )}
      </div>
    </section>
  );
}

function EvidencePanel({
  artifacts,
  finalReport,
  onInsertFinal,
  onInsertArtifact,
  onOpenWorkspaceSource,
}: {
  artifacts: AgentRoomArtifact[];
  finalReport: AgentRoomArtifact | null;
  onInsertFinal: () => void;
  onInsertArtifact: (artifact: AgentRoomArtifact) => void;
  onOpenWorkspaceSource: (artifact: AgentRoomArtifact) => void;
}) {
  const { t } = useI18n();
  const addToast = useUIStore((s) => s.addToast);
  const [filter, setFilter] = useState<AgentRoomArtifactFilter>('all');
  const supportingArtifacts = finalReport
    ? artifacts.filter((artifact) => artifact.id !== finalReport.id)
    : artifacts;
  const filteredArtifacts = supportingArtifacts.filter((artifact) => artifactMatchesFilter(artifact, filter));
  const filters = agentRoomArtifactFilters(t);

  const copyArtifact = async (artifact: AgentRoomArtifact) => {
    try {
      await navigator.clipboard.writeText(`# ${artifact.title}\n\n${artifact.content}`);
      addToast({ type: 'success', message: t('common.copied') });
    } catch (err) {
      addToast({
        type: 'error',
        message: t('agentsRoom.copyArtifactFailed', { message: err instanceof Error ? err.message : String(err) }),
      });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-shrink-0 items-center gap-2 border-b border-pi-border/70 px-3 py-2">
        <FileText size={15} className="text-pi-accent" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold">{t('agentsRoom.evidence')}</div>
          <div className="text-[10px] text-pi-dim">{t('agentsRoom.evidenceCount', { count: artifacts.length })}</div>
        </div>
      </div>
      <div className="flex flex-shrink-0 gap-1 overflow-x-auto border-b border-pi-border/60 px-3 py-2">
        {filters.map((item) => (
          <button
            key={item.value}
            onClick={() => setFilter(item.value)}
            className={cn(
              'h-7 flex-shrink-0 rounded-full border px-2.5 text-[10px] font-semibold transition-colors',
              filter === item.value
                ? 'border-pi-accent/35 bg-pi-accent/10 text-pi-accent'
                : 'border-pi-border/70 bg-pi-bg-secondary/70 text-pi-dim hover:bg-pi-bg-hover hover:text-pi-text'
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {finalReport && (filter === 'all' || filter === 'final') && (
          <div className="mb-3 rounded-xl border border-pi-accent/25 bg-pi-accent/10 p-3 shadow-sm">
            <div className="flex items-center gap-2 text-xs font-semibold text-pi-accent">
              <Sparkles size={14} />
              {t('agentsRoom.finalReport')}
            </div>
            <AgentRoomMarkdown content={finalReport.content} className="mt-2 text-pi-text" />
            <div className="mt-3 flex flex-wrap gap-2">
              <ArtifactActionButton icon={<MessageSquarePlus size={13} />} label={t('agentsRoom.insertFinal')} onClick={onInsertFinal} primary />
              <ArtifactActionButton icon={<Copy size={13} />} label={t('common.copy')} onClick={() => void copyArtifact(finalReport)} />
              {workspaceCitationForArtifact(finalReport) && (
                <ArtifactActionButton icon={<FolderOpen size={13} />} label={t('agentsRoom.openSource')} onClick={() => onOpenWorkspaceSource(finalReport)} />
              )}
            </div>
          </div>
        )}

        {artifacts.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-xs leading-relaxed text-pi-dim">
            {t('agentsRoom.noArtifacts')}
          </div>
        ) : filter === 'final' && !finalReport ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-xs leading-relaxed text-pi-dim">
            {t('agentsRoom.noFinalReport')}
          </div>
        ) : filter !== 'final' && filteredArtifacts.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-xs leading-relaxed text-pi-dim">
            {t('agentsRoom.noArtifactsForFilter')}
          </div>
        ) : filter !== 'final' && filteredArtifacts.length > 0 ? (
          <div className="space-y-2">
            {filteredArtifacts.map((artifact) => (
              <ArtifactCard
                key={artifact.id}
                artifact={artifact}
                onCopy={() => void copyArtifact(artifact)}
                onInsert={() => onInsertArtifact(artifact)}
                onOpenSource={workspaceCitationForArtifact(artifact) ? () => onOpenWorkspaceSource(artifact) : undefined}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AgentRoomMessageCard({ message, compact }: { message: AgentRoomMessage; compact?: boolean }) {
  const content = messageText(message);
  return (
    <article className="rounded-xl border border-pi-border/70 bg-pi-bg-secondary/70 p-3 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg border border-pi-border bg-pi-bg-tertiary text-pi-accent">
          <Bot size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-pi-text">{message.agentName}</div>
          <div className="truncate text-[10px] text-pi-dim">{message.role}{message.round ? ` · R${message.round}` : ''}</div>
        </div>
      </div>
      <AgentRoomMarkdown content={content} compact={compact} className="mt-2 text-pi-muted" />
    </article>
  );
}

function ArtifactCard({
  artifact,
  onCopy,
  onInsert,
  onOpenSource,
}: {
  artifact: AgentRoomArtifact;
  onCopy: () => void;
  onInsert: () => void;
  onOpenSource?: () => void;
}) {
  const { t } = useI18n();
  const primaryCitation = artifact.citations[0];
  return (
    <article className="rounded-xl border border-pi-border/70 bg-pi-bg p-3">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 rounded-md border border-pi-border bg-pi-bg-tertiary px-1.5 py-0.5 text-[9px] font-semibold uppercase text-pi-dim">
          {artifact.type}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-pi-text">{artifact.title}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-pi-dim">
            <span>{t('agentsRoom.confidence', { value: Math.round(artifact.confidence * 100) })}</span>
            {primaryCitation && (
              <span
                className={cn(
                  'inline-flex max-w-full items-center rounded-full border px-1.5 py-0.5 font-medium',
                  primaryCitation.kind === 'model'
                    ? 'border-pi-accent/25 bg-pi-accent/10 text-pi-accent'
                    : primaryCitation.kind === 'mock'
                      ? 'border-pi-warning/25 bg-pi-warning/10 text-pi-warning'
                      : 'border-pi-border bg-pi-bg-tertiary text-pi-dim'
                )}
                title={primaryCitation.title}
              >
                <span className="truncate">{artifactSourceLabel(primaryCitation)}</span>
              </span>
            )}
          </div>
        </div>
      </div>
      <AgentRoomMarkdown content={artifact.content} compact className="mt-2 text-pi-muted" />
      <div className="mt-3 flex flex-wrap gap-2">
        <ArtifactActionButton icon={<Copy size={13} />} label={t('common.copy')} onClick={onCopy} />
        <ArtifactActionButton icon={<MessageSquarePlus size={13} />} label={t('agentsRoom.insertArtifact')} onClick={onInsert} />
        {onOpenSource && (
          <ArtifactActionButton icon={<FolderOpen size={13} />} label={t('agentsRoom.openSource')} onClick={onOpenSource} />
        )}
      </div>
    </article>
  );
}

function ArtifactActionButton({
  icon,
  label,
  onClick,
  primary,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-semibold transition-colors',
        primary
          ? 'border-pi-accent bg-pi-accent text-white hover:opacity-90'
          : 'border-pi-border/70 bg-pi-bg-secondary/70 text-pi-muted hover:bg-pi-bg-hover hover:text-pi-text'
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function AgentRoomMarkdown({
  content,
  compact,
  className,
}: {
  content: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('agent-room-markdown pi-selectable min-w-0', compact && 'agent-room-markdown-compact', className)}>
      <MarkdownRenderer content={content.trim() || ' '} />
    </div>
  );
}

function RoomListItem({
  room,
  latestRun,
  active,
  onClick,
}: {
  room: AgentRoom;
  latestRun?: AgentRoomRun;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full rounded-xl border px-3 py-2 text-left transition-colors',
        active
          ? 'border-pi-accent/30 bg-pi-accent/10 text-pi-text'
          : 'border-transparent text-pi-muted hover:border-pi-border hover:bg-pi-bg-hover hover:text-pi-text'
      )}
    >
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-pi-accent" />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold">{room.title}</span>
      </div>
      <div className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-pi-dim">{room.question}</div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-pi-dim">
        <span>{room.leftLabel} / {room.rightLabel}</span>
        <span>{latestRun?.status ?? room.status}</span>
      </div>
    </button>
  );
}

function AgentRoomLauncher({
  defaultQuestion,
  sessionId,
  projectPath,
  availableModels,
  defaultModel,
  onClose,
  onCreated,
}: {
  defaultQuestion: string;
  sessionId?: string;
  projectPath?: string;
  availableModels: ModelInfo[];
  defaultModel: ModelInfo | null;
  onClose: () => void;
  onCreated: (room: AgentRoom) => void;
}) {
  const { t } = useI18n();
  const addToast = useUIStore((s) => s.addToast);
  const [draft, setDraft] = useState({
    question: defaultQuestion,
    leftLabel: t('agentsRoom.defaultLeft'),
    rightLabel: t('agentsRoom.defaultRight'),
    neutralLabel: t('agentsRoom.defaultNeutral'),
    debateRounds: 2,
    useWorkspaceSearch: true,
    useWebSearch: false,
    quickModel: defaultModel ? modelRefFromModel(defaultModel) : undefined,
    deepModel: defaultModel ? modelRefFromModel(defaultModel) : undefined,
  });
  const [saving, setSaving] = useState(false);

  const create = async () => {
    if (!draft.question.trim()) {
      addToast({ type: 'warning', message: t('agentsRoom.questionRequired') });
      return;
    }
    const input: AgentRoomCreateInput = {
      sessionId,
      projectPath,
      question: draft.question,
      mode: 'balanced',
      leftLabel: draft.leftLabel,
      rightLabel: draft.rightLabel,
      neutralLabel: draft.neutralLabel,
      debateRounds: draft.debateRounds,
      quickModel: draft.quickModel,
      deepModel: draft.deepModel,
      useWorkspaceSearch: draft.useWorkspaceSearch,
      useWebSearch: draft.useWebSearch,
    };
    setSaving(true);
    try {
      const result = await piApi.createAgentRoom(input);
      useAgentRoomStore.getState().setSnapshot(result.snapshot);
      onCreated(result.room);
    } catch (err) {
      addToast({
        type: 'error',
        message: t('agentsRoom.createFailed', { message: err instanceof Error ? err.message : String(err) }),
        duration: 6000,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
      <button className="absolute inset-0 cursor-default" onClick={onClose} aria-label={t('common.close')} />
      <div className="pi-panel-material relative z-10 w-full max-w-2xl overflow-hidden rounded-2xl border border-pi-border shadow-2xl">
        <div className="flex items-center gap-3 border-b border-pi-border/70 px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-pi-accent/20 bg-pi-accent/10 text-pi-accent">
            <Network size={17} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">{t('agentsRoom.launcherTitle')}</div>
            <div className="text-[11px] text-pi-dim">{t('agentsRoom.launcherHint')}</div>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-pi-dim hover:bg-pi-bg-hover hover:text-pi-text">
            <X size={15} />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <label className="block space-y-1.5">
            <span className="text-[10px] font-semibold uppercase text-pi-dim">{t('agentsRoom.question')}</span>
            <textarea
              value={draft.question}
              onChange={(event) => setDraft((current) => ({ ...current, question: event.target.value }))}
              rows={5}
              className="w-full resize-y rounded-xl border border-pi-border bg-pi-bg px-3 py-2 text-sm leading-relaxed text-pi-text placeholder:text-pi-dim focus:border-pi-accent focus:outline-none"
              placeholder={t('agentsRoom.questionPlaceholder')}
            />
          </label>
          <div className="grid gap-3 md:grid-cols-3">
            <LauncherInput label={t('agentsRoom.leftLabel')} value={draft.leftLabel} onChange={(value) => setDraft((current) => ({ ...current, leftLabel: value }))} />
            <LauncherInput label={t('agentsRoom.rightLabel')} value={draft.rightLabel} onChange={(value) => setDraft((current) => ({ ...current, rightLabel: value }))} />
            <LauncherInput label={t('agentsRoom.neutralLabel')} value={draft.neutralLabel} onChange={(value) => setDraft((current) => ({ ...current, neutralLabel: value }))} />
          </div>
          <GroupPresetStrip
            onApply={(preset) => setDraft((current) => ({
              ...current,
              leftLabel: preset.left,
              rightLabel: preset.right,
              neutralLabel: preset.neutral,
            }))}
          />
          <div className="grid gap-3 md:grid-cols-2">
            <AgentRoomModelSelect
              label={t('agentsRoom.quickModel')}
              hint={t('agentsRoom.quickModelHint')}
              value={draft.quickModel}
              models={availableModels}
              onChange={(quickModel) => setDraft((current) => ({ ...current, quickModel }))}
            />
            <AgentRoomModelSelect
              label={t('agentsRoom.deepModel')}
              hint={t('agentsRoom.deepModelHint')}
              value={draft.deepModel}
              models={availableModels}
              onChange={(deepModel) => setDraft((current) => ({ ...current, deepModel }))}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <label className="block space-y-1.5">
              <span className="text-[10px] font-semibold uppercase text-pi-dim">{t('agentsRoom.debateRounds')}</span>
              <input
                type="number"
                min={1}
                max={5}
                value={draft.debateRounds}
                onChange={(event) => setDraft((current) => ({ ...current, debateRounds: Number(event.target.value) }))}
                className="h-9 w-full rounded-xl border border-pi-border bg-pi-bg px-3 text-sm text-pi-text focus:border-pi-accent focus:outline-none"
              />
            </label>
            <ToggleOption
              label={t('agentsRoom.workspaceSearch')}
              hint={t('agentsRoom.workspaceSearchHint')}
              checked={draft.useWorkspaceSearch}
              onClick={() => setDraft((current) => ({ ...current, useWorkspaceSearch: !current.useWorkspaceSearch }))}
            />
            <ToggleOption
              label={t('agentsRoom.webSearch')}
              hint={t('agentsRoom.webSearchHint')}
              checked={draft.useWebSearch}
              onClick={() => setDraft((current) => ({ ...current, useWebSearch: !current.useWebSearch }))}
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-pi-border/70 px-5 py-4">
          <button onClick={onClose} className="h-8 rounded-lg border border-pi-border px-3 text-xs font-semibold text-pi-muted hover:bg-pi-bg-hover hover:text-pi-text">
            {t('common.cancel')}
          </button>
          <button
            onClick={() => void create()}
            disabled={saving}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-pi-accent px-3 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
            {t('agentsRoom.createAndRun')}
          </button>
        </div>
      </div>
    </div>
  );
}

function AgentRoomEditDialog({
  room,
  availableModels,
  onClose,
  onSave,
}: {
  room: AgentRoom;
  availableModels: ModelInfo[];
  onClose: () => void;
  onSave: (input: Pick<AgentRoomCreateInput, 'title' | 'leftLabel' | 'rightLabel' | 'neutralLabel' | 'quickModel' | 'deepModel'>) => Promise<void>;
}) {
  const { t } = useI18n();
  const addToast = useUIStore((s) => s.addToast);
  const [draft, setDraft] = useState({
    title: room.title,
    leftLabel: room.leftLabel,
    rightLabel: room.rightLabel,
    neutralLabel: room.neutralLabel,
    quickModel: room.config.quickModel,
    deepModel: room.config.deepModel,
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const title = draft.title.trim();
    const leftLabel = draft.leftLabel.trim();
    const rightLabel = draft.rightLabel.trim();
    const neutralLabel = draft.neutralLabel.trim();
    if (!title || !leftLabel || !rightLabel || !neutralLabel) {
      addToast({ type: 'warning', message: t('agentsRoom.labelsRequired') });
      return;
    }
    setSaving(true);
    try {
      await onSave({ title, leftLabel, rightLabel, neutralLabel, quickModel: draft.quickModel, deepModel: draft.deepModel });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 px-4 py-6 backdrop-blur-sm">
      <button className="absolute inset-0 cursor-default" onClick={onClose} aria-label={t('common.close')} />
      <div className="pi-panel-material relative z-10 w-full max-w-xl overflow-hidden rounded-2xl border border-pi-border shadow-2xl">
        <div className="flex items-center gap-3 border-b border-pi-border/70 px-5 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-pi-accent/20 bg-pi-accent/10 text-pi-accent">
            <Pencil size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">{t('agentsRoom.editRoom')}</div>
            <div className="text-[11px] text-pi-dim">{t('agentsRoom.editRoomHint')}</div>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-pi-dim hover:bg-pi-bg-hover hover:text-pi-text">
            <X size={15} />
          </button>
        </div>
        <div className="space-y-4 p-5">
          <LauncherInput label={t('agentsRoom.roomTitle')} value={draft.title} onChange={(value) => setDraft((current) => ({ ...current, title: value }))} />
          <div className="grid gap-3 md:grid-cols-3">
            <LauncherInput label={t('agentsRoom.leftLabel')} value={draft.leftLabel} onChange={(value) => setDraft((current) => ({ ...current, leftLabel: value }))} />
            <LauncherInput label={t('agentsRoom.rightLabel')} value={draft.rightLabel} onChange={(value) => setDraft((current) => ({ ...current, rightLabel: value }))} />
            <LauncherInput label={t('agentsRoom.neutralLabel')} value={draft.neutralLabel} onChange={(value) => setDraft((current) => ({ ...current, neutralLabel: value }))} />
          </div>
          <GroupPresetStrip
            onApply={(preset) => setDraft((current) => ({
              ...current,
              leftLabel: preset.left,
              rightLabel: preset.right,
              neutralLabel: preset.neutral,
            }))}
          />
          <div className="grid gap-3 md:grid-cols-2">
            <AgentRoomModelSelect
              label={t('agentsRoom.quickModel')}
              hint={t('agentsRoom.quickModelHint')}
              value={draft.quickModel}
              models={availableModels}
              onChange={(quickModel) => setDraft((current) => ({ ...current, quickModel }))}
            />
            <AgentRoomModelSelect
              label={t('agentsRoom.deepModel')}
              hint={t('agentsRoom.deepModelHint')}
              value={draft.deepModel}
              models={availableModels}
              onChange={(deepModel) => setDraft((current) => ({ ...current, deepModel }))}
            />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-pi-border/70 px-5 py-4">
          <button onClick={onClose} className="h-8 rounded-lg border border-pi-border px-3 text-xs font-semibold text-pi-muted hover:bg-pi-bg-hover hover:text-pi-text">
            {t('common.cancel')}
          </button>
          <button
            onClick={() => void save()}
            disabled={saving}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-pi-accent px-3 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}

function GroupPresetStrip({ onApply }: { onApply: (preset: { left: string; right: string; neutral: string }) => void }) {
  const { t } = useI18n();
  const presets = [
    {
      label: t('agentsRoom.preset.supportOppose'),
      left: t('agentsRoom.preset.support'),
      right: t('agentsRoom.preset.oppose'),
      neutral: t('agentsRoom.preset.neutral'),
    },
    {
      label: t('agentsRoom.preset.planAB'),
      left: t('agentsRoom.preset.planA'),
      right: t('agentsRoom.preset.planB'),
      neutral: t('agentsRoom.preset.jury'),
    },
    {
      label: t('agentsRoom.preset.explorationStability'),
      left: t('agentsRoom.preset.exploration'),
      right: t('agentsRoom.preset.stability'),
      neutral: t('agentsRoom.preset.moderator'),
    },
  ];

  return (
    <div className="space-y-2">
      <div className="text-[10px] font-semibold uppercase text-pi-dim">{t('agentsRoom.groupPresets')}</div>
      <div className="flex flex-wrap gap-2">
        {presets.map((preset) => (
          <button
            key={preset.label}
            onClick={() => onApply(preset)}
            className="rounded-full border border-pi-border bg-pi-bg-secondary px-3 py-1.5 text-[11px] font-medium text-pi-muted transition-colors hover:border-pi-accent/40 hover:bg-pi-accent/10 hover:text-pi-accent"
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function AgentRoomModelSelect({
  label,
  hint,
  value,
  models,
  onChange,
}: {
  label: string;
  hint: string;
  value?: ModelRef;
  models: ModelInfo[];
  onChange: (value: ModelRef | undefined) => void;
}) {
  const { t } = useI18n();
  const selectedKey = value ? modelRefKey(value) : '';
  const selectedExists = !value || models.some((model) => modelKey(model) === selectedKey);

  return (
    <label className="block space-y-1.5">
      <span className="text-[10px] font-semibold uppercase text-pi-dim">{label}</span>
      <select
        value={selectedKey}
        onChange={(event) => onChange(modelRefFromKey(event.target.value, models))}
        className="h-9 w-full rounded-xl border border-pi-border bg-pi-bg px-3 text-xs text-pi-text focus:border-pi-accent focus:outline-none"
      >
        <option value="">{t('agentsRoom.autoModel')}</option>
        {!selectedExists && value && (
          <option value={selectedKey}>{value.provider}/{value.id}</option>
        )}
        {models.map((model) => (
          <option key={modelKey(model)} value={modelKey(model)}>
            {model.provider}/{model.name}
          </option>
        ))}
      </select>
      <p className="text-[10px] leading-relaxed text-pi-dim">
        {models.length === 0 ? t('agentsRoom.noModels') : hint}
      </p>
    </label>
  );
}

function LauncherInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-[10px] font-semibold uppercase text-pi-dim">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 w-full rounded-xl border border-pi-border bg-pi-bg px-3 text-sm text-pi-text focus:border-pi-accent focus:outline-none"
      />
    </label>
  );
}

function ToggleOption({
  label,
  hint,
  badge,
  checked,
  disabled,
  onClick,
}: {
  label: string;
  hint?: string;
  badge?: string;
  checked: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={() => {
        if (!disabled) onClick();
      }}
      aria-disabled={disabled}
      title={hint}
      className={cn(
        'flex min-h-[76px] flex-col justify-between rounded-xl border px-3 py-2 text-left transition-colors',
        checked
          ? 'border-pi-accent/30 bg-pi-accent/10 text-pi-accent'
          : 'border-pi-border text-pi-muted hover:bg-pi-bg-hover hover:text-pi-text',
        disabled && 'cursor-not-allowed opacity-75 hover:bg-transparent hover:text-pi-muted'
      )}
    >
      <span className="flex w-full items-center justify-between gap-2">
        <span className="min-w-0 text-xs font-semibold">
          {label}
          {badge && <span className="ml-1 rounded-full border border-pi-warning/30 bg-pi-warning/10 px-1.5 py-0.5 text-[9px] text-pi-warning">{badge}</span>}
        </span>
        <span className={cn('h-4 w-7 flex-shrink-0 rounded-full p-0.5 transition-colors', checked ? 'bg-pi-accent' : 'bg-pi-bg-hover')}>
          <span className={cn('block h-3 w-3 rounded-full bg-white transition-transform', checked && 'translate-x-3')} />
        </span>
      </span>
      {hint && <span className="mt-1 block text-[10px] font-normal leading-relaxed text-pi-dim">{hint}</span>}
    </button>
  );
}

function EmptyRoomList({ onCreate }: { onCreate: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center">
      <Network size={30} className="text-pi-dim" />
      <p className="text-xs leading-relaxed text-pi-dim">{t('agentsRoom.emptyList')}</p>
      <button onClick={onCreate} className="h-8 rounded-lg bg-pi-accent px-3 text-xs font-semibold text-white">
        {t('agentsRoom.newRoom')}
      </button>
    </div>
  );
}

function EmptyRoomCanvas({ onCreate }: { onCreate: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <Network size={42} strokeWidth={1.4} className="text-pi-dim" />
      <div>
        <div className="text-sm font-semibold text-pi-text">{t('agentsRoom.emptyTitle')}</div>
        <p className="mt-1 max-w-md text-xs leading-relaxed text-pi-muted">{t('agentsRoom.emptyDescription')}</p>
      </div>
      <button onClick={onCreate} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-pi-accent px-4 text-xs font-semibold text-white">
        <Plus size={14} />
        {t('agentsRoom.newRoom')}
      </button>
    </div>
  );
}

function StatusPill({ status }: { status: AgentRoom['status'] }) {
  const { t } = useI18n();
  return (
    <span className="rounded-full border border-pi-border bg-pi-bg-tertiary px-2 py-0.5 text-[10px] font-semibold text-pi-dim">
      {t(`agentsRoom.status.${status}` as never)}
    </span>
  );
}

function messageText(message: AgentRoomMessage): string {
  return message.content
    .map((part) => {
      if (part.type === 'text') return part.text ?? '';
      if (part.type === 'thinking') return part.thinking?.content ?? '';
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function artifactSourceLabel(citation: AgentRoomArtifact['citations'][number]): string {
  if (citation.kind === 'model') return citation.title;
  if (citation.kind === 'mock') return 'Fallback';
  if (citation.kind === 'workspace') return 'Workspace';
  if (citation.kind === 'web') return 'Web';
  if (citation.kind === 'memory') return 'Memory';
  return 'User';
}

function agentRoomArtifactFilters(t: ReturnType<typeof useI18n>['t']): Array<{ value: AgentRoomArtifactFilter; label: string }> {
  return [
    { value: 'all', label: t('agentsRoom.filter.all') },
    { value: 'final', label: t('agentsRoom.filter.final') },
    { value: 'evidence', label: t('agentsRoom.filter.evidence') },
    { value: 'claims', label: t('agentsRoom.filter.claims') },
    { value: 'risks', label: t('agentsRoom.filter.risks') },
  ];
}

function artifactMatchesFilter(artifact: AgentRoomArtifact, filter: AgentRoomArtifactFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'final') return artifact.type === 'final_report';
  if (filter === 'evidence') return artifact.type === 'evidence';
  if (filter === 'claims') return artifact.type === 'claim' || artifact.type === 'counterclaim' || artifact.type === 'summary';
  if (filter === 'risks') return artifact.type === 'risk';
  return true;
}

function workspaceCitationForArtifact(artifact: AgentRoomArtifact): AgentRoomCitation | undefined {
  return artifact.citations.find((citation) => {
    const source = citation.source.trim();
    return citation.kind === 'workspace'
      && Boolean(source)
      && source !== 'workspace'
      && !/^[a-zA-Z]:[\\/]/.test(source);
  });
}

function modelRefFromModel(model: ModelInfo): ModelRef {
  return { provider: model.provider, id: model.id };
}

function modelKey(model: ModelInfo): string {
  return `${model.provider}:::${model.id}`;
}

function modelRefKey(model: ModelRef): string {
  return `${model.provider}:::${model.id}`;
}

function modelRefFromKey(key: string, models: ModelInfo[]): ModelRef | undefined {
  if (!key) return undefined;
  const model = models.find((item) => modelKey(item) === key);
  if (model) return modelRefFromModel(model);
  const [provider, id] = key.split(':::');
  return provider && id ? { provider, id } : undefined;
}
