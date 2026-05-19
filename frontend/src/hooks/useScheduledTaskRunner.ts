import { useEffect } from 'react';
import { piApi } from '../api/client';
import { useChatStore } from '../stores/chatStore';
import { useModelStore } from '../stores/modelStore';
import { useTaskStore } from '../stores/taskStore';
import { useUIStore } from '../stores/uiStore';
import type { ScheduledTask } from '../types';

const runningTaskIds = new Set<string>();

export function useScheduledTaskRunner() {
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const dueTasks = useTaskStore.getState().tasks.filter((task) =>
        task.enabled
        && task.nextRunAt !== undefined
        && task.nextRunAt <= now
        && !runningTaskIds.has(task.id)
      );

      for (const task of dueTasks) {
        runTask(task, 'scheduled');
      }
    };

    const timer = window.setInterval(tick, 30_000);
    const initial = window.setTimeout(tick, 2_000);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(initial);
    };
  }, []);
}

export function runTask(task: ScheduledTask, mode: 'manual' | 'scheduled' = 'manual'): boolean {
  if (runningTaskIds.has(task.id)) return false;
  runningTaskIds.add(task.id);

  const taskStore = useTaskStore.getState();
  const chatStore = useChatStore.getState();
  const uiStore = useUIStore.getState();
  const run = taskStore.recordRunStart(task.id);

  try {
    const sessionId = chatStore.activeSessionId;
    if (!sessionId) {
      throw new Error('No active session. Open or create a session before running this task.');
    }

    const model = useModelStore.getState().availableModels.find((item) => item.id === task.modelId);
    if (model) {
      piApi.send({ type: 'set_model', sessionId, provider: model.provider, modelId: model.id });
    }
    piApi.send({ type: 'set_permission_mode', mode: task.permissionMode });

    const sent = piApi.send({
      type: 'prompt',
      sessionId,
      message: task.prompt,
    });
    if (!sent) {
      throw new Error('Pi server is not connected.');
    }

    chatStore.addUserMessage(sessionId, task.prompt);
    taskStore.recordRunFinish(run.id, 'success');
    taskStore.markTaskScheduled(task.id);
    if (mode === 'manual') {
      uiStore.setActiveView('chat');
      uiStore.addToast({ type: 'success', message: `Task "${task.name}" dispatched.` });
    }
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    taskStore.recordRunFinish(run.id, 'error', message);
    taskStore.markTaskScheduled(task.id);
    uiStore.addToast({
      type: mode === 'manual' ? 'error' : 'warning',
      message: `Task "${task.name}" failed: ${message}`,
      duration: 6000,
    });
    return false;
  } finally {
    runningTaskIds.delete(task.id);
  }
}
