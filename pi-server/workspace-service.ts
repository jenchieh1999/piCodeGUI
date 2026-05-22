import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import path from 'node:path';
import { getSession } from './mock-agent.js';

export type WorkspaceFileStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'copied'
  | 'type_changed'
  | 'unknown';

export interface WorkspaceChangedFile {
  path: string;
  oldPath?: string;
  status: WorkspaceFileStatus;
  additions: number;
  deletions: number;
  staged?: boolean;
  unstaged?: boolean;
}

export interface WorkspaceStatusResult {
  state: 'ok' | 'not_git_repo' | 'missing_workdir' | 'error';
  workDir: string;
  repoName: string | null;
  branch: string | null;
  upstream?: string | null;
  ahead?: number;
  behind?: number;
  hasStagedChanges?: boolean;
  hasUnstagedChanges?: boolean;
  isGitRepo: boolean;
  changedFiles: WorkspaceChangedFile[];
  error?: string;
}

export type WorkspaceChangeAction = 'accept' | 'discard' | 'unstage';

export interface WorkspaceChangeOperationResult {
  state: 'ok' | 'not_git_repo' | 'missing_workdir' | 'error';
  action: WorkspaceChangeAction;
  path: string;
  status?: WorkspaceFileStatus;
  statusResult?: WorkspaceStatusResult;
  error?: string;
}

export type WorkspaceGitOperationAction = 'stage_all' | 'unstage_all' | 'commit' | 'pull' | 'push';

export interface WorkspaceGitOperationResult {
  state: 'ok' | 'not_git_repo' | 'missing_workdir' | 'error';
  action: WorkspaceGitOperationAction;
  output?: string;
  statusResult?: WorkspaceStatusResult;
  error?: string;
}

export interface WorkspaceTreeEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface WorkspaceTreeResult {
  state: 'ok' | 'missing' | 'error';
  path: string;
  entries: WorkspaceTreeEntry[];
  error?: string;
}

export interface WorkspaceReadFileResult {
  state: 'ok' | 'binary' | 'too_large' | 'missing' | 'error';
  path: string;
  previewType?: 'text' | 'image';
  content?: string;
  dataUrl?: string;
  mimeType?: string;
  language: string;
  size: number;
  truncated?: boolean;
  readBytes?: number;
  error?: string;
}

export interface WorkspaceWriteFileResult {
  state: 'ok' | 'missing' | 'error';
  path: string;
  size: number;
  updatedAt: number;
  error?: string;
}

export interface WorkspaceDeleteFileResult {
  state: 'ok' | 'missing' | 'error';
  path: string;
  error?: string;
}

export interface WorkspaceMoveFileResult {
  state: 'ok' | 'missing' | 'conflict' | 'error';
  sourcePath: string;
  targetPath: string;
  error?: string;
}

export interface WorkspaceCopyFileResult {
  state: 'ok' | 'missing' | 'error';
  sourcePath: string;
  targetPath: string;
  error?: string;
}

export interface WorkspaceDiffResult {
  state: 'ok' | 'missing' | 'not_git_repo' | 'error';
  path: string;
  diff?: string;
  error?: string;
}

export interface WorkspaceSearchResult {
  state: 'ok' | 'missing' | 'error';
  query: string;
  files: WorkspaceTreeEntry[];
  error?: string;
}

export interface WorkspaceHttpResponse {
  status: number;
  body: unknown;
}

const MAX_TEXT_FILE_BYTES = 1024 * 1024;
const MAX_IMAGE_FILE_BYTES = 2 * 1024 * 1024;
const SEARCH_LIMIT = 80;
const SKIPPED_DIRS = new Set([
  '.git',
  '.pi-agent-desktop',
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '.cache',
  '.edge_tmp',
  '.edge_tmp_manual',
  'target',
]);

const IGNORED_FS_ERROR_CODES = new Set(['EACCES', 'EPERM', 'EBUSY', 'ENOENT', 'ENOTDIR']);

export async function handleWorkspaceRequest(rawUrl: string, method: string, req?: NodeJS.ReadableStream): Promise<WorkspaceHttpResponse | null> {
  const url = new URL(rawUrl, 'http://127.0.0.1');
  const match = /^\/api\/sessions\/([^/]+)\/workspace\/(status|tree|file|diff|search|change|move|copy|git)$/.exec(url.pathname);
  if (!match) return null;

  const sessionId = decodeURIComponent(match[1]!);
  const resource = match[2]!;
  const workspacePath = url.searchParams.get('path') ?? '';

  try {
    if (method === 'PUT' && resource === 'file') {
      const body = await readJsonBody(req);
      const content = typeof body?.content === 'string' ? body.content : null;
      const targetPath = typeof body?.path === 'string' ? body.path : workspacePath;
      if (content === null) {
        return json(400, {
          state: 'error',
          path: normalizeWorkspacePath(targetPath),
          size: 0,
          updatedAt: Date.now(),
          error: 'Expected JSON body with a string content field.',
        });
      }
      return json(200, writeWorkspaceFile(sessionId, targetPath, content));
    }

    if (method === 'DELETE' && resource === 'file') {
      const body = await readJsonBody(req);
      const targetPath = typeof body?.path === 'string' ? body.path : workspacePath;
      return json(200, deleteWorkspacePath(sessionId, targetPath));
    }

    if (method === 'POST' && resource === 'move') {
      const body = await readJsonBody(req);
      const sourcePath = typeof body?.sourcePath === 'string' ? body.sourcePath : '';
      const targetDirectory = typeof body?.targetDirectory === 'string' ? body.targetDirectory : '';
      if (!sourcePath) {
        return json(400, {
          state: 'error',
          sourcePath: normalizeWorkspacePath(sourcePath),
          targetPath: '',
          error: 'Expected JSON body with a sourcePath field.',
        });
      }
      return json(200, moveWorkspacePath(sessionId, sourcePath, targetDirectory));
    }

    if (method === 'POST' && resource === 'copy') {
      const body = await readJsonBody(req);
      const sourcePath = typeof body?.sourcePath === 'string' ? body.sourcePath : '';
      const targetDirectory = typeof body?.targetDirectory === 'string' ? body.targetDirectory : '';
      if (!sourcePath) {
        return json(400, {
          state: 'error',
          sourcePath: normalizeWorkspacePath(sourcePath),
          targetPath: '',
          error: 'Expected JSON body with a sourcePath field.',
        });
      }
      return json(200, copyWorkspacePath(sessionId, sourcePath, targetDirectory));
    }

    if (method === 'POST' && resource === 'change') {
      const body = await readJsonBody(req);
      const action = isWorkspaceChangeAction(body?.action) ? body.action : null;
      const targetPath = typeof body?.path === 'string' ? body.path : '';
      const oldPath = typeof body?.oldPath === 'string' ? body.oldPath : undefined;
      const status = isWorkspaceFileStatus(body?.status) ? body.status : undefined;
      if (!action || !targetPath) {
        return json(400, {
          state: 'error',
          action: action ?? 'discard',
          path: normalizeWorkspacePath(targetPath),
          status,
          error: 'Expected JSON body with action and path.',
        });
      }
      return json(200, applyWorkspaceChange(sessionId, { action, path: targetPath, oldPath, status }));
    }

    if (method === 'POST' && resource === 'git') {
      const body = await readJsonBody(req);
      const action = isWorkspaceGitOperationAction(body?.action) ? body.action : null;
      const message = typeof body?.message === 'string' ? body.message : undefined;
      if (!action) {
        return json(400, {
          state: 'error',
          action: 'stage_all',
          error: 'Expected JSON body with a valid git action.',
        });
      }
      return json(200, applyWorkspaceGitOperation(sessionId, { action, message }));
    }

    if (method !== 'GET') return null;

    if (resource === 'status') {
      return json(200, getWorkspaceStatus(sessionId));
    }
    if (resource === 'tree') {
      return json(200, getWorkspaceTree(sessionId, workspacePath));
    }
    if (resource === 'file') {
      return json(200, readWorkspaceFile(sessionId, workspacePath));
    }
    if (resource === 'diff') {
      return json(200, getWorkspaceDiff(sessionId, workspacePath));
    }
    if (resource === 'search') {
      return json(200, searchWorkspaceFiles(sessionId, url.searchParams.get('q') ?? ''));
    }
  } catch (err) {
    return json(500, {
      state: 'error',
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return null;
}

export function getWorkspaceStatus(sessionId: string): WorkspaceStatusResult {
  const workspace = resolveWorkspace(sessionId);
  if (!workspace.ok) {
    return {
      state: 'missing_workdir',
      workDir: workspace.workDir,
      repoName: null,
      branch: null,
      upstream: null,
      isGitRepo: false,
      changedFiles: [],
      error: workspace.error,
    };
  }

  const workDir = workspace.workDir;
  try {
    const root = git(workDir, ['rev-parse', '--show-toplevel']).trim();
    const branch = readGitBranch(workDir);
    const upstream = readGitUpstream(workDir);
    const aheadBehind = upstream ? readGitAheadBehind(workDir) : { ahead: 0, behind: 0 };
    const changedFiles = readChangedFiles(workDir);
    const repoName = path.basename(root);
    return {
      state: 'ok',
      workDir,
      repoName,
      branch,
      upstream,
      ahead: aheadBehind.ahead,
      behind: aheadBehind.behind,
      hasStagedChanges: changedFiles.some((file) => file.staged),
      hasUnstagedChanges: changedFiles.some((file) => file.unstaged),
      isGitRepo: true,
      changedFiles,
    };
  } catch {
    return {
      state: 'not_git_repo',
      workDir,
      repoName: path.basename(workDir),
      branch: null,
      upstream: null,
      isGitRepo: false,
      changedFiles: [],
    };
  }
}

export function applyWorkspaceChange(
  sessionId: string,
  input: { action: WorkspaceChangeAction; path: string; oldPath?: string; status?: WorkspaceFileStatus }
): WorkspaceChangeOperationResult {
  const normalized = normalizeWorkspacePath(input.path);
  const oldPath = input.oldPath ? normalizeWorkspacePath(input.oldPath) : undefined;
  const workspace = resolveWorkspace(sessionId);

  if (!workspace.ok) {
    return {
      state: 'missing_workdir',
      action: input.action,
      path: normalized,
      status: input.status,
      error: workspace.error,
    };
  }

  try {
    git(workspace.workDir, ['rev-parse', '--show-toplevel']);
  } catch {
    return {
      state: 'not_git_repo',
      action: input.action,
      path: normalized,
      status: input.status,
      error: 'Current workspace is not a Git repository.',
    };
  }

  try {
    if (input.action === 'accept') {
      acceptWorkspaceChange(workspace.workDir, normalized, oldPath);
    } else if (input.action === 'unstage') {
      unstageWorkspaceChange(workspace.workDir, normalized, oldPath);
    } else {
      discardWorkspaceChange(workspace.workDir, normalized, oldPath, input.status);
    }

    return {
      state: 'ok',
      action: input.action,
      path: normalized,
      status: input.status,
      statusResult: getWorkspaceStatus(sessionId),
    };
  } catch (err) {
    return {
      state: 'error',
      action: input.action,
      path: normalized,
      status: input.status,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function applyWorkspaceGitOperation(
  sessionId: string,
  input: { action: WorkspaceGitOperationAction; message?: string }
): WorkspaceGitOperationResult {
  const workspace = resolveWorkspace(sessionId);

  if (!workspace.ok) {
    return {
      state: 'missing_workdir',
      action: input.action,
      error: workspace.error,
    };
  }

  try {
    git(workspace.workDir, ['rev-parse', '--show-toplevel']);
  } catch {
    return {
      state: 'not_git_repo',
      action: input.action,
      error: 'Current workspace is not a Git repository.',
    };
  }

  try {
    let output = '';
    if (input.action === 'stage_all') {
      output = git(workspace.workDir, ['add', '-A']);
    } else if (input.action === 'unstage_all') {
      output = git(workspace.workDir, ['restore', '--staged', '.']);
    } else if (input.action === 'commit') {
      const message = input.message?.trim();
      if (!message) throw new Error('Commit message is required.');
      output = git(workspace.workDir, ['commit', '-m', message], false, 60000);
    } else if (input.action === 'pull') {
      output = git(workspace.workDir, ['pull', '--ff-only'], false, 60000);
    } else if (input.action === 'push') {
      output = git(workspace.workDir, ['push'], false, 60000);
    }

    return {
      state: 'ok',
      action: input.action,
      output,
      statusResult: getWorkspaceStatus(sessionId),
    };
  } catch (err) {
    return {
      state: 'error',
      action: input.action,
      error: gitErrorMessage(err),
    };
  }
}

export function getWorkspaceTree(sessionId: string, workspacePath = ''): WorkspaceTreeResult {
  const workspace = resolveWorkspace(sessionId);
  if (!workspace.ok) {
    return { state: 'missing', path: workspacePath, entries: [], error: workspace.error };
  }

  try {
    const absolute = resolveInsideWorkspace(workspace.workDir, workspacePath);
    if (!isAccessibleDirectory(absolute)) {
      return { state: 'missing', path: normalizeWorkspacePath(workspacePath), entries: [] };
    }

    const directoryEntries = readDirectoryEntries(absolute);
    if (!directoryEntries) {
      return { state: 'ok', path: normalizeWorkspacePath(workspacePath), entries: [] };
    }

    const entries = directoryEntries
      .filter((entry) => !shouldSkipEntry(entry.name, entry.isDirectory()))
      .map<WorkspaceTreeEntry>((entry) => {
        const relative = joinWorkspacePath(workspacePath, entry.name);
        return {
          name: entry.name,
          path: relative,
          isDirectory: entry.isDirectory(),
        };
      })
      .sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

    return { state: 'ok', path: normalizeWorkspacePath(workspacePath), entries };
  } catch (err) {
    return {
      state: 'error',
      path: normalizeWorkspacePath(workspacePath),
      entries: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function readWorkspaceFile(sessionId: string, workspacePath: string): WorkspaceReadFileResult {
  const workspace = resolveWorkspace(sessionId);
  const normalized = normalizeWorkspacePath(workspacePath);
  if (!workspace.ok) {
    return { state: 'missing', path: normalized, language: languageFromPath(normalized), size: 0, error: workspace.error };
  }

  try {
    const absolute = resolveInsideWorkspace(workspace.workDir, workspacePath);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      return { state: 'missing', path: normalized, language: languageFromPath(normalized), size: 0 };
    }

    const size = statSync(absolute).size;
    const imageMime = imageMimeType(normalized);
    if (imageMime) {
      if (size > MAX_IMAGE_FILE_BYTES) {
        return { state: 'too_large', path: normalized, language: languageFromPath(normalized), size };
      }
      const buffer = readFileSync(absolute);
      return {
        state: 'ok',
        path: normalized,
        previewType: 'image',
        dataUrl: `data:${imageMime};base64,${buffer.toString('base64')}`,
        mimeType: imageMime,
        language: languageFromPath(normalized),
        size,
      };
    }

    const readBytes = Math.min(size, MAX_TEXT_FILE_BYTES);
    const buffer = readFileSync(absolute).subarray(0, readBytes);
    if (looksBinary(buffer)) {
      return { state: 'binary', path: normalized, language: languageFromPath(normalized), size };
    }

    return {
      state: size > MAX_TEXT_FILE_BYTES ? 'too_large' : 'ok',
      path: normalized,
      previewType: 'text',
      content: buffer.toString('utf8'),
      language: languageFromPath(normalized),
      size,
      truncated: size > MAX_TEXT_FILE_BYTES,
      readBytes,
    };
  } catch (err) {
    return {
      state: 'error',
      path: normalized,
      language: languageFromPath(normalized),
      size: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function writeWorkspaceFile(sessionId: string, workspacePath: string, content: string): WorkspaceWriteFileResult {
  const workspace = resolveWorkspace(sessionId);
  const normalized = normalizeWorkspacePath(workspacePath);
  if (!workspace.ok) {
    return { state: 'missing', path: normalized, size: 0, updatedAt: Date.now(), error: workspace.error };
  }

  try {
    const absolute = resolveInsideWorkspace(workspace.workDir, workspacePath);
    const parent = path.dirname(absolute);
    if (!existsSync(parent) || !statSync(parent).isDirectory()) {
      return {
        state: 'missing',
        path: normalized,
        size: 0,
        updatedAt: Date.now(),
        error: `Parent folder does not exist: ${normalizeWorkspacePath(path.relative(workspace.workDir, parent))}`,
      };
    }

    writeFileSync(absolute, content, 'utf8');
    const stat = statSync(absolute);
    return {
      state: 'ok',
      path: normalized,
      size: stat.size,
      updatedAt: stat.mtimeMs,
    };
  } catch (err) {
    return {
      state: 'error',
      path: normalized,
      size: 0,
      updatedAt: Date.now(),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function deleteWorkspacePath(sessionId: string, workspacePath: string): WorkspaceDeleteFileResult {
  const workspace = resolveWorkspace(sessionId);
  const normalized = normalizeWorkspacePath(workspacePath);
  if (!workspace.ok) {
    return { state: 'missing', path: normalized, error: workspace.error };
  }

  try {
    assertWorkspaceFilePath(normalized);
    const absolute = resolveInsideWorkspace(workspace.workDir, normalized);
    if (!existsSync(absolute)) {
      return { state: 'missing', path: normalized, error: `Path does not exist: ${normalized}` };
    }
    rmSync(absolute, { recursive: true, force: true });
    return { state: 'ok', path: normalized };
  } catch (err) {
    return {
      state: 'error',
      path: normalized,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function moveWorkspacePath(sessionId: string, sourcePath: string, targetDirectory: string): WorkspaceMoveFileResult {
  const workspace = resolveWorkspace(sessionId);
  const normalizedSource = normalizeWorkspacePath(sourcePath);
  const normalizedTargetDirectory = normalizeWorkspacePath(targetDirectory);
  const targetPath = joinWorkspacePath(normalizedTargetDirectory, path.posix.basename(normalizedSource));

  if (!workspace.ok) {
    return { state: 'missing', sourcePath: normalizedSource, targetPath, error: workspace.error };
  }

  try {
    assertWorkspaceFilePath(normalizedSource);
    const sourceAbsolute = resolveInsideWorkspace(workspace.workDir, normalizedSource);
    const targetDirectoryAbsolute = resolveInsideWorkspace(workspace.workDir, normalizedTargetDirectory);
    const targetAbsolute = resolveInsideWorkspace(workspace.workDir, targetPath);

    if (!existsSync(sourceAbsolute)) {
      return { state: 'missing', sourcePath: normalizedSource, targetPath, error: `Source path does not exist: ${normalizedSource}` };
    }
    if (!existsSync(targetDirectoryAbsolute) || !statSync(targetDirectoryAbsolute).isDirectory()) {
      return { state: 'missing', sourcePath: normalizedSource, targetPath, error: `Target folder does not exist: ${normalizedTargetDirectory || '.'}` };
    }
    if (sourceAbsolute === targetAbsolute) {
      return { state: 'ok', sourcePath: normalizedSource, targetPath: normalizedSource };
    }
    if (isPathInside(targetAbsolute, sourceAbsolute)) {
      return { state: 'error', sourcePath: normalizedSource, targetPath, error: 'Cannot move a folder into itself.' };
    }
    if (existsSync(targetAbsolute)) {
      return { state: 'conflict', sourcePath: normalizedSource, targetPath, error: `Target already exists: ${targetPath}` };
    }

    renameSync(sourceAbsolute, targetAbsolute);
    return { state: 'ok', sourcePath: normalizedSource, targetPath };
  } catch (err) {
    return {
      state: 'error',
      sourcePath: normalizedSource,
      targetPath,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function copyWorkspacePath(sessionId: string, sourcePath: string, targetDirectory: string): WorkspaceCopyFileResult {
  const workspace = resolveWorkspace(sessionId);
  const normalizedSource = normalizeWorkspacePath(sourcePath);
  const normalizedTargetDirectory = normalizeWorkspacePath(targetDirectory);
  const sourceName = path.posix.basename(normalizedSource);

  if (!workspace.ok) {
    return {
      state: 'missing',
      sourcePath: normalizedSource,
      targetPath: joinWorkspacePath(normalizedTargetDirectory, sourceName),
      error: workspace.error,
    };
  }

  try {
    assertWorkspaceFilePath(normalizedSource);
    const sourceAbsolute = resolveInsideWorkspace(workspace.workDir, normalizedSource);
    const targetDirectoryAbsolute = resolveInsideWorkspace(workspace.workDir, normalizedTargetDirectory);

    if (!existsSync(sourceAbsolute)) {
      return {
        state: 'missing',
        sourcePath: normalizedSource,
        targetPath: joinWorkspacePath(normalizedTargetDirectory, sourceName),
        error: `Source path does not exist: ${normalizedSource}`,
      };
    }
    if (!existsSync(targetDirectoryAbsolute) || !statSync(targetDirectoryAbsolute).isDirectory()) {
      return {
        state: 'missing',
        sourcePath: normalizedSource,
        targetPath: joinWorkspacePath(normalizedTargetDirectory, sourceName),
        error: `Target folder does not exist: ${normalizedTargetDirectory || '.'}`,
      };
    }
    if (statSync(sourceAbsolute).isDirectory() && isPathInside(targetDirectoryAbsolute, sourceAbsolute)) {
      return {
        state: 'error',
        sourcePath: normalizedSource,
        targetPath: joinWorkspacePath(normalizedTargetDirectory, sourceName),
        error: 'Cannot copy a folder into itself.',
      };
    }

    const targetPath = resolveAvailableCopyPath(workspace.workDir, normalizedTargetDirectory, sourceName);
    const targetAbsolute = resolveInsideWorkspace(workspace.workDir, targetPath);
    cpSync(sourceAbsolute, targetAbsolute, { recursive: true, errorOnExist: true, force: false });
    return { state: 'ok', sourcePath: normalizedSource, targetPath };
  } catch (err) {
    return {
      state: 'error',
      sourcePath: normalizedSource,
      targetPath: joinWorkspacePath(normalizedTargetDirectory, sourceName),
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function getWorkspaceDiff(sessionId: string, workspacePath: string): WorkspaceDiffResult {
  const workspace = resolveWorkspace(sessionId);
  const normalized = normalizeWorkspacePath(workspacePath);
  if (!workspace.ok) {
    return { state: 'missing', path: normalized, error: workspace.error };
  }

  try {
    git(workspace.workDir, ['rev-parse', '--show-toplevel']);
  } catch {
    return { state: 'not_git_repo', path: normalized, error: 'Current workspace is not a Git repository.' };
  }

  try {
    resolveInsideWorkspace(workspace.workDir, workspacePath);
    let diff = git(workspace.workDir, ['diff', 'HEAD', '--', normalized], true);
    if (!diff.trim()) {
      diff = git(workspace.workDir, ['diff', '--cached', '--', normalized], true);
    }
    if (!diff.trim() && existsSync(resolveInsideWorkspace(workspace.workDir, workspacePath))) {
      const file = readWorkspaceFile(sessionId, workspacePath);
      if (file.state === 'ok' && file.content) {
        diff = `Untracked or unchanged file: ${normalized}\n\n${file.content}`;
      }
    }
    return { state: 'ok', path: normalized, diff };
  } catch (err) {
    return {
      state: 'error',
      path: normalized,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function searchWorkspaceFiles(sessionId: string, query: string): WorkspaceSearchResult {
  const workspace = resolveWorkspace(sessionId);
  const normalizedQuery = query.trim().toLowerCase();
  if (!workspace.ok) {
    return { state: 'missing', query, files: [], error: workspace.error };
  }

  try {
    const matches: Array<{ entry: WorkspaceTreeEntry; score: number }> = [];
    const stack = [''];
    const matchLimit = SEARCH_LIMIT * 5;

    while (stack.length > 0 && matches.length < matchLimit) {
      const current = stack.pop()!;
      const absolute = resolveInsideWorkspace(workspace.workDir, current);
      if (!isAccessibleDirectory(absolute)) continue;

      const entries = readDirectoryEntries(absolute);
      if (!entries) continue;

      for (const entry of entries) {
        if (shouldSkipEntry(entry.name, entry.isDirectory())) continue;
        const relative = joinWorkspacePath(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(relative);
        } else {
          const score = scoreWorkspaceSearchResult(relative, normalizedQuery);
          if (score !== null) {
            matches.push({
              entry: { name: entry.name, path: relative, isDirectory: false },
              score,
            });
            if (matches.length >= matchLimit) break;
          }
        }
      }
    }

    const files = matches
      .sort((a, b) => a.score - b.score || a.entry.path.localeCompare(b.entry.path))
      .slice(0, SEARCH_LIMIT)
      .map((match) => match.entry);

    return { state: 'ok', query, files };
  } catch (err) {
    return {
      state: 'error',
      query,
      files: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function scoreWorkspaceSearchResult(filePath: string, query: string): number | null {
  if (!query) return filePath.split('/').length * 10 + filePath.length / 1000;

  const lowerPath = filePath.toLowerCase();
  const lowerName = path.basename(lowerPath);
  const basenameIndex = lowerName.indexOf(query);
  if (basenameIndex >= 0) {
    return basenameIndex + 20 + lowerName.length / 1000;
  }

  const pathIndex = lowerPath.indexOf(query);
  if (pathIndex >= 0) {
    return pathIndex + 80 + lowerPath.length / 1000;
  }

  let cursor = 0;
  let score = 140;
  for (const char of query) {
    const next = lowerPath.indexOf(char, cursor);
    if (next < 0) return null;
    score += next - cursor;
    cursor = next + 1;
  }
  return score + lowerPath.length / 1000;
}

function acceptWorkspaceChange(workDir: string, workspacePath: string, oldPath?: string): void {
  assertWorkspaceFilePath(workspacePath);
  resolveInsideWorkspace(workDir, workspacePath);
  const paths = uniqueWorkspacePaths([oldPath, workspacePath]);
  for (const filePath of paths) {
    resolveInsideWorkspace(workDir, filePath);
  }
  git(workDir, ['add', '--', ...paths]);
}

function unstageWorkspaceChange(workDir: string, workspacePath: string, oldPath?: string): void {
  assertWorkspaceFilePath(workspacePath);
  const paths = uniqueWorkspacePaths([oldPath, workspacePath]);
  for (const filePath of paths) {
    resolveInsideWorkspace(workDir, filePath);
  }
  git(workDir, ['restore', '--staged', '--', ...paths], true);
}

function discardWorkspaceChange(workDir: string, workspacePath: string, oldPath?: string, status?: WorkspaceFileStatus): void {
  assertWorkspaceFilePath(workspacePath);
  const paths = uniqueWorkspacePaths([oldPath, workspacePath]);
  for (const filePath of paths) {
    resolveInsideWorkspace(workDir, filePath);
  }

  if (status === 'untracked') {
    removeWorkspacePath(workDir, workspacePath);
    return;
  }

  const pathsInHead = paths.filter((filePath) => pathExistsInHead(workDir, filePath));
  const pathsNotInHead = paths.filter((filePath) => !pathsInHead.includes(filePath));

  if (pathsInHead.length > 0) {
    git(workDir, ['restore', '--source=HEAD', '--staged', '--worktree', '--', ...pathsInHead]);
  }

  for (const filePath of pathsNotInHead) {
    git(workDir, ['rm', '-f', '--cached', '--', filePath], true);
    removeWorkspacePath(workDir, filePath);
  }
}

function readChangedFiles(workDir: string): WorkspaceChangedFile[] {
  const status = git(workDir, ['status', '--porcelain=v1', '-b'], true);
  const numstat = readNumstat(workDir);
  const files: WorkspaceChangedFile[] = [];

  for (const line of status.split(/\r?\n/)) {
    if (!line || line.startsWith('## ')) continue;
    const code = line.slice(0, 2);
    const raw = line.slice(3).trim();
    if (!raw) continue;

    const renamed = raw.includes(' -> ');
    const [oldRaw, newRaw] = renamed ? raw.split(' -> ', 2) : [undefined, raw];
    const filePath = unquoteGitPath(newRaw ?? raw);
    const oldPath = oldRaw ? unquoteGitPath(oldRaw) : undefined;
    const stat = numstat.get(filePath) ?? { additions: 0, deletions: 0 };

    files.push({
      path: filePath,
      oldPath,
      status: mapGitStatus(code),
      additions: stat.additions,
      deletions: stat.deletions,
      staged: isStagedGitStatus(code),
      unstaged: isUnstagedGitStatus(code),
    });
  }

  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function pathExistsInHead(workDir: string, workspacePath: string): boolean {
  return git(workDir, ['ls-tree', '--name-only', 'HEAD', '--', workspacePath], true).trim().length > 0;
}

function uniqueWorkspacePaths(paths: Array<string | undefined>): string[] {
  const normalized = paths
    .filter((value): value is string => Boolean(value))
    .map((value) => normalizeWorkspacePath(value))
    .filter(Boolean);
  return Array.from(new Set(normalized));
}

function assertWorkspaceFilePath(workspacePath: string): void {
  if (!normalizeWorkspacePath(workspacePath)) {
    throw new Error('Expected a file path inside the current workspace.');
  }
}

function removeWorkspacePath(root: string, workspacePath: string): void {
  assertWorkspaceFilePath(workspacePath);
  const absolute = resolveInsideWorkspace(root, workspacePath);
  if (existsSync(absolute)) {
    rmSync(absolute, { recursive: true, force: true });
  }
}

function isPathInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function resolveAvailableCopyPath(root: string, targetDirectory: string, sourceName: string): string {
  const firstPath = joinWorkspacePath(targetDirectory, sourceName);
  if (!existsSync(resolveInsideWorkspace(root, firstPath))) return firstPath;

  const parsed = path.posix.parse(sourceName);
  const stem = parsed.name || parsed.base;
  const ext = parsed.name ? parsed.ext : '';
  for (let index = 1; index < 1000; index += 1) {
    const suffix = index === 1 ? ' copy' : ` copy ${index}`;
    const candidateName = `${stem}${suffix}${ext}`;
    const candidatePath = joinWorkspacePath(targetDirectory, candidateName);
    if (!existsSync(resolveInsideWorkspace(root, candidatePath))) return candidatePath;
  }

  throw new Error(`Unable to find an available copy name for ${sourceName}.`);
}

function readNumstat(workDir: string): Map<string, { additions: number; deletions: number }> {
  const output = git(workDir, ['diff', '--numstat', 'HEAD', '--'], true);
  const stats = new Map<string, { additions: number; deletions: number }>();

  for (const line of output.split(/\r?\n/)) {
    const [added, deleted, ...pathParts] = line.split('\t');
    const filePath = pathParts.join('\t');
    if (!filePath) continue;
    stats.set(normalizeWorkspacePath(unquoteGitPath(filePath)), {
      additions: added === '-' ? 0 : Number(added) || 0,
      deletions: deleted === '-' ? 0 : Number(deleted) || 0,
    });
  }

  return stats;
}

function readGitBranch(workDir: string): string | null {
  try {
    const branch = git(workDir, ['branch', '--show-current'], true).trim();
    if (branch) return branch;
  } catch {
    // Fall back below.
  }

  const head = git(workDir, ['rev-parse', '--short', 'HEAD'], true).trim();
  return head || null;
}

function readGitUpstream(workDir: string): string | null {
  try {
    const upstream = git(workDir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'], true).trim();
    return upstream || null;
  } catch {
    return null;
  }
}

function readGitAheadBehind(workDir: string): { ahead: number; behind: number } {
  const output = git(workDir, ['rev-list', '--left-right', '--count', 'HEAD...@{upstream}'], true).trim();
  const [aheadRaw, behindRaw] = output.split(/\s+/, 2);
  return {
    ahead: Number(aheadRaw) || 0,
    behind: Number(behindRaw) || 0,
  };
}

function mapGitStatus(code: string): WorkspaceFileStatus {
  if (code === '??') return 'untracked';
  if (code.includes('R')) return 'renamed';
  if (code.includes('C')) return 'copied';
  if (code.includes('A')) return 'added';
  if (code.includes('D')) return 'deleted';
  if (code.includes('T')) return 'type_changed';
  if (code.includes('M')) return 'modified';
  return 'unknown';
}

function isStagedGitStatus(code: string): boolean {
  if (code === '??') return false;
  const index = code[0] ?? ' ';
  return index !== ' ' && index !== '?';
}

function isUnstagedGitStatus(code: string): boolean {
  if (code === '??') return true;
  const worktree = code[1] ?? ' ';
  return worktree !== ' ';
}

function isWorkspaceChangeAction(value: unknown): value is WorkspaceChangeAction {
  return value === 'accept' || value === 'discard' || value === 'unstage';
}

function isWorkspaceGitOperationAction(value: unknown): value is WorkspaceGitOperationAction {
  return (
    value === 'stage_all' ||
    value === 'unstage_all' ||
    value === 'commit' ||
    value === 'pull' ||
    value === 'push'
  );
}

function isWorkspaceFileStatus(value: unknown): value is WorkspaceFileStatus {
  return (
    value === 'modified' ||
    value === 'added' ||
    value === 'deleted' ||
    value === 'renamed' ||
    value === 'untracked' ||
    value === 'copied' ||
    value === 'type_changed' ||
    value === 'unknown'
  );
}

function resolveWorkspace(sessionId: string): { ok: true; workDir: string } | { ok: false; workDir: string; error: string } {
  const session = getSession(sessionId);
  if (!session) {
    return { ok: false, workDir: '', error: 'Session not found.' };
  }

  const workDir = resolveProjectPath(session.projectPath);
  if (!existsSync(workDir) || !statSync(workDir).isDirectory()) {
    return { ok: false, workDir, error: `Workspace does not exist: ${workDir}` };
  }

  return { ok: true, workDir };
}

function resolveProjectPath(projectPath: string): string {
  if (projectPath && projectPath !== '.') {
    return path.resolve(projectPath);
  }

  const cwd = process.cwd();
  return path.basename(cwd).toLowerCase() === 'pi-server' ? path.dirname(cwd) : cwd;
}

function resolveInsideWorkspace(root: string, workspacePath: string): string {
  const normalized = normalizeWorkspacePath(workspacePath);
  const resolved = path.resolve(root, normalized || '.');
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Path escapes the current workspace.');
  }
  return resolved;
}

function joinWorkspacePath(parent: string, name: string): string {
  return normalizeWorkspacePath(parent ? `${parent}/${name}` : name);
}

function normalizeWorkspacePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function shouldSkipEntry(name: string, isDirectory: boolean): boolean {
  return isDirectory && SKIPPED_DIRS.has(name);
}

function isAccessibleDirectory(absolutePath: string): boolean {
  try {
    return existsSync(absolutePath) && statSync(absolutePath).isDirectory();
  } catch (err) {
    if (isIgnorableFsError(err)) return false;
    throw err;
  }
}

function readDirectoryEntries(absolutePath: string): Dirent[] | null {
  try {
    return readdirSync(absolutePath, { withFileTypes: true });
  } catch (err) {
    if (isIgnorableFsError(err)) return null;
    throw err;
  }
}

function isIgnorableFsError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' && IGNORED_FS_ERROR_CODES.has(code);
}

function git(workDir: string, args: string[], allowFailure = false, timeout = 5000): string {
  try {
    return execFileSync('git', args, {
      cwd: workDir,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
      windowsHide: true,
    });
  } catch (err) {
    if (allowFailure) return '';
    throw err;
  }
}

function gitErrorMessage(err: unknown): string {
  if (!err || typeof err !== 'object') return String(err);
  const maybe = err as { message?: unknown; stdout?: unknown; stderr?: unknown };
  const stderr = typeof maybe.stderr === 'string' ? maybe.stderr.trim() : '';
  const stdout = typeof maybe.stdout === 'string' ? maybe.stdout.trim() : '';
  const message = typeof maybe.message === 'string' ? maybe.message.trim() : '';
  return stderr || stdout || message || String(err);
}

function unquoteGitPath(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return normalizeWorkspacePath(JSON.parse(trimmed));
    } catch {
      return normalizeWorkspacePath(trimmed.slice(1, -1));
    }
  }
  return normalizeWorkspacePath(trimmed);
}

function looksBinary(buffer: Buffer): boolean {
  if (buffer.length === 0) return false;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  return sample.includes(0);
}

function languageFromPath(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    json: 'json',
    md: 'markdown',
    css: 'css',
    html: 'html',
    rs: 'rust',
    py: 'python',
    go: 'go',
    java: 'java',
    sh: 'bash',
    ps1: 'powershell',
    yml: 'yaml',
    yaml: 'yaml',
  };
  return map[ext] ?? ext ?? 'text';
}

function imageMimeType(filePath: string): string | null {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const map: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
  };
  return map[ext] ?? null;
}

function json(status: number, body: unknown): WorkspaceHttpResponse {
  return { status, body };
}

function readJsonBody(req?: NodeJS.ReadableStream): Promise<Record<string, unknown> | null> {
  if (!req) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding?.('utf8');
    req.on('data', (chunk) => {
      body += String(chunk);
      if (body.length > MAX_TEXT_FILE_BYTES * 2) {
        reject(new Error('Request body is too large.'));
      }
    });
    req.on('end', () => {
      if (!body.trim()) {
        resolve(null);
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}
