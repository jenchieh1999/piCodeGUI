import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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
}

export interface WorkspaceStatusResult {
  state: 'ok' | 'not_git_repo' | 'missing_workdir' | 'error';
  workDir: string;
  repoName: string | null;
  branch: string | null;
  isGitRepo: boolean;
  changedFiles: WorkspaceChangedFile[];
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
  'target',
]);

export async function handleWorkspaceRequest(rawUrl: string, method: string, req?: NodeJS.ReadableStream): Promise<WorkspaceHttpResponse | null> {
  const url = new URL(rawUrl, 'http://127.0.0.1');
  const match = /^\/api\/sessions\/([^/]+)\/workspace\/(status|tree|file|diff|search)$/.exec(url.pathname);
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
      isGitRepo: false,
      changedFiles: [],
      error: workspace.error,
    };
  }

  const workDir = workspace.workDir;
  try {
    const root = git(workDir, ['rev-parse', '--show-toplevel']).trim();
    const branch = readGitBranch(workDir);
    const repoName = path.basename(root);
    return {
      state: 'ok',
      workDir,
      repoName,
      branch,
      isGitRepo: true,
      changedFiles: readChangedFiles(workDir),
    };
  } catch {
    return {
      state: 'not_git_repo',
      workDir,
      repoName: path.basename(workDir),
      branch: null,
      isGitRepo: false,
      changedFiles: [],
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
    if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
      return { state: 'missing', path: normalizeWorkspacePath(workspacePath), entries: [] };
    }

    const entries = readdirSync(absolute, { withFileTypes: true })
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
    const files: WorkspaceTreeEntry[] = [];
    const stack = [''];

    while (stack.length > 0 && files.length < SEARCH_LIMIT) {
      const current = stack.pop()!;
      const absolute = resolveInsideWorkspace(workspace.workDir, current);
      if (!existsSync(absolute) || !statSync(absolute).isDirectory()) continue;

      for (const entry of readdirSync(absolute, { withFileTypes: true })) {
        if (shouldSkipEntry(entry.name, entry.isDirectory())) continue;
        const relative = joinWorkspacePath(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(relative);
        } else if (!normalizedQuery || relative.toLowerCase().includes(normalizedQuery)) {
          files.push({ name: entry.name, path: relative, isDirectory: false });
          if (files.length >= SEARCH_LIMIT) break;
        }
      }
    }

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
    });
  }

  return files.sort((a, b) => a.path.localeCompare(b.path));
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

function git(workDir: string, args: string[], allowFailure = false): string {
  try {
    return execFileSync('git', args, {
      cwd: workDir,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5000,
      windowsHide: true,
    });
  } catch (err) {
    if (allowFailure) return '';
    throw err;
  }
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
