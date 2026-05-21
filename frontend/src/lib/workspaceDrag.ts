import type { WorkspaceTreeEntry } from '../types';

export const WORKSPACE_FILE_MIME = 'application/x-pi-workspace-file';

export interface WorkspaceFileDragPayload {
  sessionId: string;
  path: string;
  name: string;
  isDirectory: boolean;
}

export function createWorkspaceFileDragPayload(
  sessionId: string,
  entry: WorkspaceTreeEntry
): WorkspaceFileDragPayload {
  return {
    sessionId,
    path: entry.path,
    name: entry.name,
    isDirectory: entry.isDirectory,
  };
}

export function setWorkspaceFileDragData(
  dataTransfer: DataTransfer,
  payload: WorkspaceFileDragPayload
): void {
  dataTransfer.effectAllowed = payload.isDirectory ? 'move' : 'copyMove';
  dataTransfer.setData(WORKSPACE_FILE_MIME, JSON.stringify(payload));
  dataTransfer.setData('text/plain', payload.path);
}

export function readWorkspaceFileDragPayload(dataTransfer: DataTransfer | null): WorkspaceFileDragPayload | null {
  if (!dataTransfer || !Array.from(dataTransfer.types).includes(WORKSPACE_FILE_MIME)) return null;

  try {
    const raw = dataTransfer.getData(WORKSPACE_FILE_MIME);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<WorkspaceFileDragPayload>;
    if (
      typeof value.sessionId !== 'string' ||
      typeof value.path !== 'string' ||
      typeof value.name !== 'string' ||
      typeof value.isDirectory !== 'boolean'
    ) {
      return null;
    }
    return {
      sessionId: value.sessionId,
      path: value.path,
      name: value.name,
      isDirectory: value.isDirectory,
    };
  } catch {
    return null;
  }
}

export function hasWorkspaceFileDragPayload(dataTransfer: DataTransfer | null): boolean {
  return Boolean(dataTransfer && Array.from(dataTransfer.types).includes(WORKSPACE_FILE_MIME));
}
