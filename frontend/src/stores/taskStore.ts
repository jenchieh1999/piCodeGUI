import { create } from 'zustand';
import type { PermissionMode, ScheduledTask, TaskRun } from '../types';
import { computeNextRunAt, normalizeDays, timeToCron } from '../lib/scheduledTasks';

interface CreateTaskInput {
  name: string;
  prompt: string;
  time: string;
  daysOfWeek: number[];
  modelId: string;
  permissionMode: PermissionMode;
  enabled: boolean;
}

interface UpdateTaskInput extends Partial<CreateTaskInput> {
  cronExpression?: string;
}

interface TaskState {
  tasks: ScheduledTask[];
  runs: TaskRun[];
  createTask: (input: CreateTaskInput) => ScheduledTask;
  updateTask: (id: string, input: UpdateTaskInput) => void;
  deleteTask: (id: string) => void;
  toggleTask: (id: string, enabled: boolean) => void;
  recordRunStart: (taskId: string) => TaskRun;
  recordRunFinish: (runId: string, status: 'success' | 'error', error?: string) => void;
  markTaskScheduled: (id: string, from?: number) => void;
}

const TASKS_KEY = 'pi-desktop-scheduled-tasks';
const RUNS_KEY = 'pi-desktop-task-runs';

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: loadTasks(),
  runs: loadRuns(),

  createTask: (input) => {
    const now = Date.now();
    const cronExpression = timeToCron(input.time);
    const task: ScheduledTask = {
      id: `task-${now}-${Math.random().toString(16).slice(2)}`,
      name: clean(input.name, 'Scheduled task'),
      prompt: clean(input.prompt, 'Summarize the current project status.'),
      cronExpression,
      daysOfWeek: normalizeDays(input.daysOfWeek),
      modelId: input.modelId,
      permissionMode: input.permissionMode,
      enabled: input.enabled,
      nextRunAt: input.enabled ? computeNextRunAt(cronExpression, input.daysOfWeek, now) : undefined,
    };

    const tasks = [task, ...get().tasks];
    saveTasks(tasks);
    set({ tasks });
    return task;
  },

  updateTask: (id, input) => {
    const tasks = get().tasks.map((task) => {
      if (task.id !== id) return task;
      const cronExpression = input.cronExpression ?? (input.time ? timeToCron(input.time) : task.cronExpression);
      const daysOfWeek = input.daysOfWeek ? normalizeDays(input.daysOfWeek) : task.daysOfWeek;
      const enabled = input.enabled ?? task.enabled;
      const next: ScheduledTask = {
        ...task,
        name: input.name !== undefined ? clean(input.name, task.name) : task.name,
        prompt: input.prompt !== undefined ? clean(input.prompt, task.prompt) : task.prompt,
        cronExpression,
        daysOfWeek,
        modelId: input.modelId ?? task.modelId,
        permissionMode: input.permissionMode ?? task.permissionMode,
        enabled,
        nextRunAt: enabled ? computeNextRunAt(cronExpression, daysOfWeek) : undefined,
      };
      return next;
    });
    saveTasks(tasks);
    set({ tasks });
  },

  deleteTask: (id) => {
    const tasks = get().tasks.filter((task) => task.id !== id);
    const runs = get().runs.filter((run) => run.taskId !== id);
    saveTasks(tasks);
    saveRuns(runs);
    set({ tasks, runs });
  },

  toggleTask: (id, enabled) => {
    get().updateTask(id, { enabled });
  },

  recordRunStart: (taskId) => {
    const run: TaskRun = {
      id: `run-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      taskId,
      startedAt: Date.now(),
      status: 'running',
    };
    const runs = [run, ...get().runs].slice(0, 80);
    saveRuns(runs);
    set({ runs });
    return run;
  },

  recordRunFinish: (runId, status, error) => {
    const runs = get().runs.map((run) =>
      run.id === runId
        ? { ...run, status, error, finishedAt: Date.now() }
        : run
    );
    saveRuns(runs);
    set({ runs });
  },

  markTaskScheduled: (id, from = Date.now()) => {
    const tasks = get().tasks.map((task) => {
      if (task.id !== id) return task;
      return {
        ...task,
        lastRunAt: from,
        nextRunAt: task.enabled ? computeNextRunAt(task.cronExpression, task.daysOfWeek, from) : undefined,
      };
    });
    saveTasks(tasks);
    set({ tasks });
  },
}));

function clean(value: string, fallback: string): string {
  const next = value.trim();
  return next || fallback;
}

function loadTasks(): ScheduledTask[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(TASKS_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTaskLike);
  } catch {
    return [];
  }
}

function loadRuns(): TaskRun[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(RUNS_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRunLike).slice(0, 80);
  } catch {
    return [];
  }
}

function saveTasks(tasks: ScheduledTask[]): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(TASKS_KEY, JSON.stringify(tasks));
}

function saveRuns(runs: TaskRun[]): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(RUNS_KEY, JSON.stringify(runs));
}

function isTaskLike(value: unknown): value is ScheduledTask {
  if (!value || typeof value !== 'object') return false;
  const task = value as Partial<ScheduledTask>;
  return typeof task.id === 'string'
    && typeof task.name === 'string'
    && typeof task.prompt === 'string'
    && typeof task.cronExpression === 'string'
    && Array.isArray(task.daysOfWeek)
    && typeof task.modelId === 'string'
    && typeof task.permissionMode === 'string'
    && typeof task.enabled === 'boolean';
}

function isRunLike(value: unknown): value is TaskRun {
  if (!value || typeof value !== 'object') return false;
  const run = value as Partial<TaskRun>;
  return typeof run.id === 'string'
    && typeof run.taskId === 'string'
    && typeof run.startedAt === 'number'
    && (run.status === 'running' || run.status === 'success' || run.status === 'error');
}
