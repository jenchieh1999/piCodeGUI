import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowLeft,
  Bot,
  CheckCircle2,
  FileText,
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
import { useUIStore } from '../../stores/uiStore';
import type {
  AgentRoom,
  AgentRoomArtifact,
  AgentRoomCreateInput,
  AgentRoomMessage,
  AgentRoomRun,
  AgentRoomTask,
} from '../../types';
import { cn } from '../shared/utils';

const EMPTY_MESSAGES: AgentRoomMessage[] = [];
const EMPTY_ARTIFACTS: AgentRoomArtifact[] = [];
const EMPTY_TASKS: AgentRoomTask[] = [];
const EMPTY_RUNS: AgentRoomRun[] = [];

export function AgentsRoomView() {
  const { t } = useI18n();
  const setActiveView = useUIStore((s) => s.setActiveView);
  const addToast = useUIStore((s) => s.addToast);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const activeSession = useChatStore((s) => s.sessions.find((session) => session.id === activeSessionId));
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

  const updateRoomLabels = async (
    room: AgentRoom,
    input: Pick<AgentRoomCreateInput, 'title' | 'leftLabel' | 'rightLabel' | 'neutralLabel'>,
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

  const insertFinalToChat = () => {
    if (!finalReport || !activeSessionId) {
      addToast({ type: 'warning', message: t('agentsRoom.noFinalReport') });
      return;
    }
    window.dispatchEvent(new CustomEvent('pi:add-workspace-reference', { detail: { sessionId: activeSessionId } }));
    useChatStore.getState().addUserMessage(activeSessionId, finalReport.content);
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

      <div className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)_320px] overflow-hidden">
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
          ) : (
            <EmptyRoomCanvas onCreate={() => setLauncherOpen(true)} />
          )}
        </main>

        <aside className="min-h-0 overflow-hidden border-l border-pi-border/70 bg-pi-bg-secondary/40">
          <EvidencePanel
            artifacts={artifacts}
            finalReport={finalReport}
            onInsertFinal={insertFinalToChat}
          />
        </aside>
      </div>

      {launcherOpen && (
        <AgentRoomLauncher
          defaultQuestion={activeSession ? t('agentsRoom.defaultQuestion', { project: activeSession.projectName }) : ''}
          sessionId={activeSessionId ?? undefined}
          projectPath={activeSession?.projectPath}
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
          onClose={() => setEditingRoom(null)}
          onSave={(input) => updateRoomLabels(editingRoom, input)}
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
    <div className="flex flex-shrink-0 items-center gap-2 overflow-x-auto border-b border-pi-border/70 px-4 py-2">
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
    <div className="max-h-[220px] flex-shrink-0 overflow-y-auto border-t border-pi-border/70 bg-pi-bg-secondary/50 px-4 py-3">
      <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-pi-text">
        <span className="flex h-6 w-6 items-center justify-center rounded-lg border border-pi-success/25 bg-pi-success/10 text-pi-success">
          <ShieldCheck size={14} />
        </span>
        {label}
      </div>
      {messages.length === 0 ? (
        <div className="text-xs text-pi-dim">{t('agentsRoom.neutralWaiting')}</div>
      ) : (
        <div className="grid gap-2 lg:grid-cols-2">
          {messages.slice(-4).map((message) => <AgentRoomMessageCard key={message.id} message={message} compact />)}
        </div>
      )}
    </div>
  );
}

function EvidencePanel({
  artifacts,
  finalReport,
  onInsertFinal,
}: {
  artifacts: AgentRoomArtifact[];
  finalReport: AgentRoomArtifact | null;
  onInsertFinal: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 flex-shrink-0 items-center gap-2 border-b border-pi-border/70 px-3">
        <FileText size={15} className="text-pi-accent" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold">{t('agentsRoom.evidence')}</div>
          <div className="text-[10px] text-pi-dim">{t('agentsRoom.evidenceCount', { count: artifacts.length })}</div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {finalReport && (
          <div className="mb-3 rounded-xl border border-pi-accent/25 bg-pi-accent/10 p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-pi-accent">
              <Sparkles size={14} />
              {t('agentsRoom.finalReport')}
            </div>
            <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-xs leading-relaxed text-pi-text">{finalReport.content}</p>
            <button
              onClick={onInsertFinal}
              className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg bg-pi-accent px-3 text-xs font-semibold text-white transition-opacity hover:opacity-90"
            >
              <MessageSquarePlus size={13} />
              {t('agentsRoom.insertFinal')}
            </button>
          </div>
        )}

        {artifacts.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-xs leading-relaxed text-pi-dim">
            {t('agentsRoom.noArtifacts')}
          </div>
        ) : (
          <div className="space-y-2">
            {artifacts.map((artifact) => (
              <ArtifactCard key={artifact.id} artifact={artifact} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AgentRoomMessageCard({ message, compact }: { message: AgentRoomMessage; compact?: boolean }) {
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
      <p className={cn('mt-2 whitespace-pre-wrap text-xs leading-relaxed text-pi-muted', compact && 'line-clamp-4')}>
        {messageText(message)}
      </p>
    </article>
  );
}

function ArtifactCard({ artifact }: { artifact: AgentRoomArtifact }) {
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
      <p className="mt-2 line-clamp-5 whitespace-pre-wrap text-xs leading-relaxed text-pi-muted">{artifact.content}</p>
    </article>
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
  onClose,
  onCreated,
}: {
  defaultQuestion: string;
  sessionId?: string;
  projectPath?: string;
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
            <ToggleOption label={t('agentsRoom.workspaceSearch')} checked={draft.useWorkspaceSearch} onClick={() => setDraft((current) => ({ ...current, useWorkspaceSearch: !current.useWorkspaceSearch }))} />
            <ToggleOption label={t('agentsRoom.webSearch')} checked={draft.useWebSearch} onClick={() => setDraft((current) => ({ ...current, useWebSearch: !current.useWebSearch }))} />
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
  onClose,
  onSave,
}: {
  room: AgentRoom;
  onClose: () => void;
  onSave: (input: Pick<AgentRoomCreateInput, 'title' | 'leftLabel' | 'rightLabel' | 'neutralLabel'>) => Promise<void>;
}) {
  const { t } = useI18n();
  const addToast = useUIStore((s) => s.addToast);
  const [draft, setDraft] = useState({
    title: room.title,
    leftLabel: room.leftLabel,
    rightLabel: room.rightLabel,
    neutralLabel: room.neutralLabel,
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
      await onSave({ title, leftLabel, rightLabel, neutralLabel });
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

function ToggleOption({ label, checked, onClick }: { label: string; checked: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'mt-5 flex h-9 items-center justify-between rounded-xl border px-3 text-xs font-semibold transition-colors',
        checked
          ? 'border-pi-accent/30 bg-pi-accent/10 text-pi-accent'
          : 'border-pi-border text-pi-muted hover:bg-pi-bg-hover hover:text-pi-text'
      )}
    >
      {label}
      <span className={cn('h-4 w-7 rounded-full p-0.5 transition-colors', checked ? 'bg-pi-accent' : 'bg-pi-bg-hover')}>
        <span className={cn('block h-3 w-3 rounded-full bg-white transition-transform', checked && 'translate-x-3')} />
      </span>
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
