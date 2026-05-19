import { piApi } from '../api/client';
import { useUIStore } from '../stores/uiStore';

export async function createNewSessionFromPicker(): Promise<void> {
  try {
    const projectPath = window.piDesktop
      ? await window.piDesktop.selectProjectDirectory()
      : '.';

    if (!projectPath) return;
    createSessionForProject(projectPath);
  } catch (err) {
    useUIStore.getState().addToast({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

export function createSessionForProject(
  projectPath: string,
  options: { branch?: string | null; worktree?: boolean } = {},
): boolean {
  const sent = piApi.send({
    type: 'session_create',
    projectPath,
    branch: options.branch ?? null,
    worktree: options.worktree ?? false,
  });

  if (!sent) {
    useUIStore.getState().addToast({
      type: 'error',
      message: 'Pi server is not connected. Please wait for reconnect or restart the local server.',
      duration: 6000,
    });
  }

  return sent;
}
