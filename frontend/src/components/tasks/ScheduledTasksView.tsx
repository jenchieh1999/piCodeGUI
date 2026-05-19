import { ArrowLeft, CalendarClock, Clock, Loader2, Play, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { cronToTime, normalizeDays } from '../../lib/scheduledTasks';
import { runTask } from '../../hooks/useScheduledTaskRunner';
import { useI18n, type TranslationKey } from '../../lib/i18n';
import { useModelStore } from '../../stores/modelStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTaskStore } from '../../stores/taskStore';
import { useUIStore } from '../../stores/uiStore';
import type { PermissionMode, ScheduledTask } from '../../types';
import { cn } from '../shared/utils';

interface TaskDraft {
  name: string;
  prompt: string;
  time: string;
  daysOfWeek: number[];
  modelId: string;
  permissionMode: PermissionMode;
  enabled: boolean;
}

const WEEKDAYS = [
  { value: 1, labelKey: 'tasks.weekday.mon' },
  { value: 2, labelKey: 'tasks.weekday.tue' },
  { value: 3, labelKey: 'tasks.weekday.wed' },
  { value: 4, labelKey: 'tasks.weekday.thu' },
  { value: 5, labelKey: 'tasks.weekday.fri' },
  { value: 6, labelKey: 'tasks.weekday.sat' },
  { value: 0, labelKey: 'tasks.weekday.sun' },
];

const PERMISSION_MODES: PermissionMode[] = ['ask', 'acceptEdits', 'plan', 'bypassPermissions'];

export function ScheduledTasksView() {
  const { t } = useI18n();
  const tasks = useTaskStore((s) => s.tasks);
  const runs = useTaskStore((s) => s.runs);
  const createTask = useTaskStore((s) => s.createTask);
  const updateTask = useTaskStore((s) => s.updateTask);
  const deleteTask = useTaskStore((s) => s.deleteTask);
  const toggleTask = useTaskStore((s) => s.toggleTask);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const availableModels = useModelStore((s) => s.availableModels);
  const currentModel = useModelStore((s) => s.currentModel);
  const permissionMode = useSettingsStore((s) => s.permissionMode);
  const [selectedId, setSelectedId] = useState<string | null>(tasks[0]?.id ?? null);
  const selectedTask = tasks.find((task) => task.id === selectedId) ?? null;
  const [draft, setDraft] = useState<TaskDraft>(() => createDefaultDraft(currentModel?.id ?? '', permissionMode, t));

  useEffect(() => {
    if (selectedTask) {
      setDraft(draftFromTask(selectedTask));
    }
  }, [selectedTask]);

  useEffect(() => {
    if (!selectedId && tasks[0]) setSelectedId(tasks[0].id);
  }, [selectedId, tasks]);

  const recentRuns = useMemo(() => runs.slice(0, 8), [runs]);
  const enabledCount = tasks.filter((task) => task.enabled).length;

  const createNew = () => {
    setSelectedId(null);
    setDraft(createDefaultDraft(currentModel?.id ?? availableModels[0]?.id ?? '', permissionMode, t));
  };

  const save = () => {
    if (selectedTask) {
      updateTask(selectedTask.id, draft);
    } else {
      const task = createTask(draft);
      setSelectedId(task.id);
    }
  };

  const remove = () => {
    if (!selectedTask || !confirm(t('tasks.deleteConfirm', { name: selectedTask.name }))) return;
    deleteTask(selectedTask.id);
    setSelectedId(null);
    setDraft(createDefaultDraft(currentModel?.id ?? availableModels[0]?.id ?? '', permissionMode, t));
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
          <h1 className="text-sm font-display font-semibold text-pi-text">{t('tasks.title')}</h1>
          <div className="mt-0.5 text-[10px] text-pi-dim">
            {t('tasks.summary', { enabled: enabledCount, total: tasks.length })}
          </div>
        </div>
        <button
          onClick={createNew}
          className="flex h-8 items-center gap-1.5 rounded-md bg-pi-accent px-3 text-xs font-medium text-white transition-opacity hover:opacity-90"
        >
          <Plus size={13} />
          {t('tasks.newTask')}
        </button>
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="border-r border-pi-border p-3">
          <div className="space-y-2">
            {tasks.map((task) => (
              <button
                key={task.id}
                onClick={() => setSelectedId(task.id)}
                className={cn(
                  'w-full rounded-lg border p-3 text-left transition-colors',
                  selectedId === task.id
                    ? 'border-pi-accent bg-pi-accent/5'
                    : 'border-pi-border bg-pi-bg-secondary hover:border-pi-muted'
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-pi-text">{task.name}</div>
                    <div className="mt-1 text-[10px] text-pi-dim">{describeTaskScheduleLocalized(task, t)}</div>
                  </div>
                  <span
                    className={cn(
                      'rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase',
                      task.enabled ? 'bg-pi-success/10 text-pi-success' : 'bg-pi-bg-tertiary text-pi-dim'
                    )}
                  >
                    {task.enabled ? t('common.on') : t('common.off')}
                  </span>
                </div>
                <div className="mt-2 truncate font-mono text-[10px] text-pi-dim">{task.modelId || t('tasks.currentModel')}</div>
                <div className="mt-2 text-[10px] text-pi-dim">
                  {t('tasks.next', { time: task.nextRunAt ? formatTime(task.nextRunAt) : t('tasks.noNext') })}
                </div>
              </button>
            ))}

            {tasks.length === 0 && (
              <div className="rounded-lg border border-dashed border-pi-border px-4 py-10 text-center text-xs text-pi-dim">
                <CalendarClock size={28} strokeWidth={1} className="mx-auto mb-2" />
                {t('tasks.empty')}
              </div>
            )}
          </div>
        </div>

        <div className="min-w-0 overflow-y-auto p-5">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-4">
              <div className="rounded-lg border border-pi-border bg-pi-bg-secondary p-4">
                <div className="flex items-center justify-between gap-3 border-b border-pi-border pb-3">
                  <div>
                    <h2 className="text-sm font-semibold text-pi-text">{selectedTask ? t('tasks.editTask') : t('tasks.newTask')}</h2>
                    <div className="mt-0.5 text-[10px] text-pi-dim">{t('tasks.description')}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedTask && (
                      <>
                        <button
                          onClick={() => toggleTask(selectedTask.id, !selectedTask.enabled)}
                          className="h-8 rounded-md border border-pi-border px-3 text-xs text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
                        >
                          {selectedTask.enabled ? t('tasks.disable') : t('tasks.enable')}
                        </button>
                        <button
                          onClick={() => runTask(selectedTask)}
                          className="flex h-8 items-center gap-1.5 rounded-md border border-pi-border px-3 text-xs text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
                        >
                          <Play size={13} />
                          {t('tasks.run')}
                        </button>
                      </>
                    )}
                    <button
                      onClick={save}
                      className="flex h-8 items-center gap-1.5 rounded-md bg-pi-accent px-3 text-xs font-medium text-white transition-opacity hover:opacity-90"
                    >
                      <Save size={13} />
                      {t('common.save')}
                    </button>
                    {selectedTask && (
                      <button
                        onClick={remove}
                        className="flex h-8 w-8 items-center justify-center rounded-md border border-pi-border text-pi-muted transition-colors hover:border-pi-error/50 hover:text-pi-error"
                        title={t('tasks.deleteTask')}
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid gap-4 pt-4 xl:grid-cols-2">
                  <Field label={t('common.name')}>
                    <input
                      value={draft.name}
                      onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                      className={inputClass}
                    />
                  </Field>

                  <Field label={t('tasks.time')}>
                    <input
                      type="time"
                      value={draft.time}
                      onChange={(event) => setDraft((current) => ({ ...current, time: event.target.value }))}
                      className={inputClass}
                    />
                  </Field>

                  <Field label={t('common.model')}>
                    <select
                      value={draft.modelId}
                      onChange={(event) => setDraft((current) => ({ ...current, modelId: event.target.value }))}
                      className={inputClass}
                    >
                      {availableModels.length === 0 && <option value="">{t('tasks.currentModel')}</option>}
                      {availableModels.map((model) => (
                        <option key={`${model.provider}/${model.id}`} value={model.id}>
                          {model.provider}/{model.name}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label={t('common.permission')}>
                    <select
                      value={draft.permissionMode}
                      onChange={(event) => setDraft((current) => ({ ...current, permissionMode: event.target.value as PermissionMode }))}
                      className={inputClass}
                    >
                      {PERMISSION_MODES.map((mode) => (
                        <option key={mode} value={mode}>{mode}</option>
                      ))}
                    </select>
                  </Field>

                  <Field label={t('tasks.days')} wide>
                    <div className="flex flex-wrap gap-2">
                      {WEEKDAYS.map((day) => {
                        const active = draft.daysOfWeek.includes(day.value);
                        return (
                          <button
                            key={day.value}
                            onClick={() => setDraft((current) => ({
                              ...current,
                              daysOfWeek: active
                                ? current.daysOfWeek.filter((value) => value !== day.value)
                                : [...current.daysOfWeek, day.value],
                            }))}
                            className={cn(
                              'h-8 rounded-md border px-3 text-xs font-medium transition-colors',
                              active
                                ? 'border-pi-accent bg-pi-selected-bg text-pi-accent'
                                : 'border-pi-border text-pi-muted hover:bg-pi-bg-hover hover:text-pi-text'
                            )}
                          >
                            {t(day.labelKey as TranslationKey)}
                          </button>
                        );
                      })}
                      <button
                        onClick={() => setDraft((current) => ({ ...current, daysOfWeek: WEEKDAYS.map((day) => day.value) }))}
                        className="h-8 rounded-md border border-pi-border px-3 text-xs text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
                      >
                        {t('tasks.everyDay')}
                      </button>
                    </div>
                  </Field>

                  <Field label={t('common.prompt')} wide>
                    <textarea
                      value={draft.prompt}
                      onChange={(event) => setDraft((current) => ({ ...current, prompt: event.target.value }))}
                      rows={8}
                      className="w-full resize-y rounded-md border border-pi-border bg-pi-bg-tertiary px-3 py-2 text-xs leading-relaxed text-pi-text placeholder:text-pi-dim focus:border-pi-accent focus:outline-none"
                    />
                  </Field>

                  <div className="xl:col-span-2 flex items-center justify-between gap-4 rounded-md border border-pi-border bg-pi-bg-tertiary px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-pi-text">{t('common.enabled')}</div>
                      <div className="text-[10px] text-pi-dim">{t('tasks.enabledHint')}</div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={draft.enabled}
                      onClick={() => setDraft((current) => ({ ...current, enabled: !current.enabled }))}
                      className={cn(
                        'inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full p-0.5 transition-colors focus:outline-none focus:ring-2 focus:ring-pi-accent/40',
                        draft.enabled ? 'bg-pi-accent' : 'bg-pi-border'
                      )}
                    >
                      <span
                        className={cn(
                          'h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
                          draft.enabled ? 'translate-x-4' : 'translate-x-0'
                        )}
                      />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <div className="rounded-lg border border-pi-border bg-pi-bg-secondary p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-pi-text">
                  <Clock size={14} className="text-pi-accent" />
                  {t('tasks.recentRuns')}
                </div>
                <div className="mt-3 space-y-2">
                  {recentRuns.map((run) => {
                    const task = tasks.find((item) => item.id === run.taskId);
                    return (
                      <div key={run.id} className="rounded-md border border-pi-border bg-pi-bg-tertiary px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs text-pi-text">{task?.name ?? t('tasks.deletedTask')}</span>
                          <RunStatus run={run} />
                        </div>
                        <div className="mt-1 text-[10px] text-pi-dim">{formatTime(run.startedAt)}</div>
                        {run.error && <div className="mt-1 text-[10px] text-pi-error">{run.error}</div>}
                      </div>
                    );
                  })}
                  {recentRuns.length === 0 && (
                    <div className="rounded-md border border-dashed border-pi-border px-3 py-8 text-center text-xs text-pi-dim">
                      {t('tasks.noRuns')}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <label className={cn('block space-y-1.5', wide && 'xl:col-span-2')}>
      <span className="text-[10px] font-semibold uppercase text-pi-dim">{label}</span>
      {children}
    </label>
  );
}

function RunStatus({ run }: { run: { status: string } }) {
  if (run.status === 'running') {
    return <Loader2 size={13} className="animate-spin text-pi-accent" />;
  }
  return (
    <span
      className={cn(
        'rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase',
        run.status === 'success' ? 'bg-pi-success/10 text-pi-success' : 'bg-pi-error/10 text-pi-error'
      )}
    >
      {run.status}
    </span>
  );
}

function createDefaultDraft(
  modelId: string,
  permissionMode: PermissionMode,
  t?: (key: TranslationKey, values?: Record<string, string | number>) => string
): TaskDraft {
  return {
    name: t ? t('tasks.defaultName') : 'Daily project check',
    prompt: t ? t('tasks.defaultPrompt') : 'Review the current project state, summarize risks, and suggest the next highest-value step.',
    time: '09:00',
    daysOfWeek: [1, 2, 3, 4, 5],
    modelId,
    permissionMode,
    enabled: true,
  };
}

function draftFromTask(task: ScheduledTask): TaskDraft {
  return {
    name: task.name,
    prompt: task.prompt,
    time: cronToTime(task.cronExpression),
    daysOfWeek: task.daysOfWeek,
    modelId: task.modelId,
    permissionMode: task.permissionMode,
    enabled: task.enabled,
  };
}

function describeTaskScheduleLocalized(
  task: Pick<ScheduledTask, 'cronExpression' | 'daysOfWeek'>,
  t: (key: TranslationKey, values?: Record<string, string | number>) => string
): string {
  const time = cronToTime(task.cronExpression);
  const days = normalizeDays(task.daysOfWeek);
  if (days.length === 0 || days.length === 7) return t('tasks.schedule.everyDayAt', { time });
  const labels = days.map((day) => {
    const item = WEEKDAYS.find((candidate) => candidate.value === day);
    return item ? t(item.labelKey as TranslationKey) : String(day);
  }).join(', ');
  return t('tasks.schedule.daysAt', { days: labels, time });
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

const inputClass = 'h-8 w-full rounded-md border border-pi-border bg-pi-bg-tertiary px-3 text-xs text-pi-text placeholder:text-pi-dim focus:border-pi-accent focus:outline-none';
