import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { getAllSessions } from './mock-agent.js';
import { getDataDir } from './persistence.js';
import type {
  RecentProjectData,
  RepositoryBranchInfoData,
  RepositoryContextResultData,
  RepositoryWorktreeInfoData,
} from './types.js';

export interface RepositoryHttpResponse {
  status: number;
  body: unknown;
}

export interface PreparedSessionProject {
  projectPath: string;
  projectName?: string;
  branch?: string | null;
}

const GIT_TIMEOUT_MS = 10000;
const WORKTREE_TIMEOUT_MS = 60000;
const MAX_GIT_BUFFER = 4 * 1024 * 1024;

export function handleRepositoryRequest(rawUrl: string, method: string): RepositoryHttpResponse | null {
  if (method !== 'GET') return null;

  const url = new URL(rawUrl, 'http://127.0.0.1');
  try {
    if (url.pathname === '/api/projects/recent') {
      const limit = clampInt(url.searchParams.get('limit'), 1, 50, 12);
      return json(200, { projects: getRecentProjects(limit) });
    }

    if (url.pathname === '/api/repository/context') {
      return json(200, getRepositoryContext(url.searchParams.get('path') ?? '.'));
    }
  } catch (err) {
    return json(500, {
      state: 'error',
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return null;
}

export function getRecentProjects(limit = 12): RecentProjectData[] {
  const sessions = getAllSessions();
  const projects = new Map<string, RecentProjectData>();

  for (const session of sessions) {
    const realPath = resolveProjectPath(session.projectPath);
    const key = normalizePathKey(realPath);
    const existing = projects.get(key);
    if (existing) {
      existing.sessionCount += 1;
      continue;
    }

    const branch = readGitBranchSafe(realPath) ?? session.branch ?? null;
    projects.set(key, {
      projectPath: session.projectPath,
      realPath,
      projectName: session.projectName || path.basename(realPath) || realPath,
      branch,
      updatedAt: session.updatedAt,
      sessionCount: 1,
      lastSessionId: session.id,
      isGitRepo: isGitRepository(realPath),
      missing: !isDirectory(realPath),
    });
  }

  const cwd = resolveProjectPath('.');
  const cwdKey = normalizePathKey(cwd);
  if (!projects.has(cwdKey)) {
    projects.set(cwdKey, {
      projectPath: '.',
      realPath: cwd,
      projectName: path.basename(cwd) || cwd,
      branch: readGitBranchSafe(cwd),
      updatedAt: sessions.length === 0 ? Date.now() : 0,
      sessionCount: 0,
      isGitRepo: isGitRepository(cwd),
      missing: !isDirectory(cwd),
    });
  }

  return Array.from(projects.values())
    .sort((a, b) => b.updatedAt - a.updatedAt || a.projectName.localeCompare(b.projectName))
    .slice(0, limit);
}

export function getRepositoryContext(workDir: string): RepositoryContextResultData {
  const resolved = resolveProjectPath(workDir || '.');
  if (!isDirectory(resolved)) {
    return emptyRepositoryContext('missing_workdir', resolved, `Working directory does not exist: ${resolved}`);
  }

  const realPath = safeRealpath(resolved);
  const root = runGit(realPath, ['rev-parse', '--show-toplevel'], true)?.trim();
  if (!root) {
    return {
      ...emptyRepositoryContext('not_git_repo', realPath),
      repoName: path.basename(realPath) || realPath,
    };
  }

  const repoRoot = safeRealpath(root);
  const currentBranch = readGitBranchSafe(repoRoot);
  const worktrees = readWorktrees(repoRoot);
  const branches = readBranches(repoRoot, currentBranch, worktrees);

  return {
    state: 'ok',
    workDir: realPath,
    repoRoot,
    repoName: path.basename(repoRoot) || repoRoot,
    currentBranch,
    defaultBranch: readDefaultBranch(repoRoot, branches),
    dirty: Boolean(runGit(repoRoot, ['status', '--porcelain'], true)?.trim()),
    branches,
    worktrees,
  };
}

export function prepareSessionProject(
  projectPath: string,
  options: { branch?: string | null; worktree?: boolean } = {},
): PreparedSessionProject {
  const requested = projectPath || '.';
  const branch = options.branch?.trim() || null;
  if (!branch) {
    const context = getRepositoryContext(requested);
    return {
      projectPath: requested,
      projectName: context.repoName ?? undefined,
      branch: context.state === 'ok' ? context.currentBranch : readGitBranchSafe(resolveProjectPath(requested)),
    };
  }

  const context = getRepositoryContext(requested);
  if (context.state !== 'ok' || !context.repoRoot) {
    throw new Error(context.error || 'Selected project is not a Git repository.');
  }

  const selectedBranch = findBranch(context.branches, branch);
  if (!selectedBranch) {
    throw new Error(`Branch not found in selected repository: ${branch}`);
  }

  if (options.worktree) {
    return createIsolatedWorktree(context, selectedBranch);
  }

  if (selectedBranch.name !== context.currentBranch) {
    if (context.dirty) {
      throw new Error('Cannot switch branches while the repository has uncommitted changes. Enable isolated worktree instead.');
    }

    switchRepositoryBranch(context.repoRoot, selectedBranch);
  }

  return {
    projectPath: context.repoRoot,
    projectName: context.repoName ?? undefined,
    branch: selectedBranch.name,
  };
}

function createIsolatedWorktree(
  context: RepositoryContextResultData,
  selectedBranch: RepositoryBranchInfoData,
): PreparedSessionProject {
  if (!context.repoRoot) throw new Error('Cannot create worktree without a repository root.');

  const baseRef = selectedBranch.remote && !selectedBranch.local && selectedBranch.remoteRef
    ? selectedBranch.remoteRef
    : selectedBranch.name;
  const stamp = Date.now().toString(36);
  const branchSlug = sanitizeSlug(selectedBranch.name);
  const repoSlug = sanitizeSlug(context.repoName ?? 'repo');
  const worktreeBranch = `pi-desktop/${branchSlug}-${stamp}`;
  const worktreeRoot = path.join(getDataDir(), 'worktrees');
  const targetPath = path.join(worktreeRoot, `${repoSlug}-${branchSlug}-${stamp}`);

  mkdirSync(worktreeRoot, { recursive: true });
  runGitStrict(context.repoRoot, ['worktree', 'add', '-b', worktreeBranch, targetPath, baseRef], WORKTREE_TIMEOUT_MS);

  return {
    projectPath: targetPath,
    projectName: context.repoName ?? undefined,
    branch: worktreeBranch,
  };
}

function switchRepositoryBranch(repoRoot: string, selectedBranch: RepositoryBranchInfoData): void {
  const switched = runGit(repoRoot, ['switch', selectedBranch.name], true);
  if (switched !== null) return;

  if (selectedBranch.remoteRef) {
    runGitStrict(repoRoot, ['switch', '-c', selectedBranch.name, '--track', selectedBranch.remoteRef]);
    return;
  }

  throw new Error(`Failed to switch to branch: ${selectedBranch.name}`);
}

function readBranches(
  repoRoot: string,
  currentBranch: string | null,
  worktrees: RepositoryWorktreeInfoData[],
): RepositoryBranchInfoData[] {
  const branches = new Map<string, RepositoryBranchInfoData>();
  const checkedOutByBranch = new Map<string, string>();
  for (const worktree of worktrees) {
    if (worktree.branch) checkedOutByBranch.set(worktree.branch, worktree.path);
  }

  const addBranch = (name: string, patch: Partial<RepositoryBranchInfoData>) => {
    const existing = branches.get(name);
    const worktreePath = checkedOutByBranch.get(name);
    branches.set(name, {
      name,
      current: name === currentBranch,
      local: false,
      remote: false,
      checkedOut: Boolean(worktreePath),
      worktreePath,
      ...existing,
      ...patch,
    });
  };

  for (const name of splitLines(runGit(repoRoot, ['for-each-ref', '--format=%(refname:short)', 'refs/heads'], true))) {
    addBranch(name, { local: true });
  }

  for (const ref of splitLines(runGit(repoRoot, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes'], true))) {
    const remote = normalizeRemoteBranch(ref);
    if (!remote) continue;
    addBranch(remote.name, { remote: true, remoteRef: remote.remoteRef });
  }

  if (currentBranch && !branches.has(currentBranch)) {
    addBranch(currentBranch, { local: true, current: true });
  }

  return Array.from(branches.values()).sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1;
    if (a.local !== b.local) return a.local ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function readWorktrees(repoRoot: string): RepositoryWorktreeInfoData[] {
  const output = runGit(repoRoot, ['worktree', 'list', '--porcelain'], true);
  if (!output) return [];

  const worktrees: RepositoryWorktreeInfoData[] = [];
  let current: RepositoryWorktreeInfoData | null = null;
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      if (current) worktrees.push(current);
      const worktreePath = safeRealpath(line.slice('worktree '.length));
      current = {
        path: worktreePath,
        branch: null,
        current: normalizePathKey(worktreePath) === normalizePathKey(repoRoot),
      };
      continue;
    }

    if (current && line.startsWith('branch ')) {
      const ref = line.slice('branch '.length);
      current.branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
    }
  }
  if (current) worktrees.push(current);

  return worktrees;
}

function readDefaultBranch(repoRoot: string, branches: RepositoryBranchInfoData[]): string | null {
  const originHead = runGit(repoRoot, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], true)?.trim();
  const normalized = originHead?.replace(/^origin\//, '');
  if (normalized && branches.some((branch) => branch.name === normalized)) return normalized;

  for (const candidate of ['main', 'master']) {
    if (branches.some((branch) => branch.name === candidate)) return candidate;
  }

  return branches[0]?.name ?? null;
}

function normalizeRemoteBranch(ref: string): { name: string; remoteRef: string } | null {
  if (!ref || ref.endsWith('/HEAD')) return null;
  const slash = ref.indexOf('/');
  if (slash < 1) return null;
  const remote = ref.slice(0, slash);
  const name = ref.slice(slash + 1);
  if (!name) return null;
  return { name: remote === 'origin' ? name : ref, remoteRef: ref };
}

function findBranch(branches: RepositoryBranchInfoData[], name: string): RepositoryBranchInfoData | undefined {
  return branches.find((branch) => branch.name === name || branch.remoteRef === name);
}

function readGitBranchSafe(workDir: string): string | null {
  if (!isDirectory(workDir)) return null;
  const branch = runGit(workDir, ['branch', '--show-current'], true)?.trim();
  if (branch) return branch;
  return runGit(workDir, ['rev-parse', '--short', 'HEAD'], true)?.trim() || null;
}

function isGitRepository(workDir: string): boolean {
  return isDirectory(workDir) && Boolean(runGit(workDir, ['rev-parse', '--show-toplevel'], true)?.trim());
}

function runGit(workDir: string, args: string[], allowFailure = false): string | null {
  try {
    return execFileSync('git', args, {
      cwd: workDir,
      encoding: 'utf8',
      maxBuffer: MAX_GIT_BUFFER,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
    });
  } catch (err) {
    if (allowFailure) return null;
    throw err;
  }
}

function runGitStrict(workDir: string, args: string[], timeout = GIT_TIMEOUT_MS): string {
  try {
    return execFileSync('git', args, {
      cwd: workDir,
      encoding: 'utf8',
      maxBuffer: MAX_GIT_BUFFER,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
      windowsHide: true,
    });
  } catch (err) {
    const detail = err && typeof err === 'object' && 'stderr' in err
      ? String((err as { stderr?: unknown }).stderr ?? '')
      : '';
    throw new Error(detail.trim() || (err instanceof Error ? err.message : String(err)));
  }
}

function emptyRepositoryContext(
  state: RepositoryContextResultData['state'],
  workDir: string,
  error?: string,
): RepositoryContextResultData {
  return {
    state,
    workDir,
    repoRoot: null,
    repoName: null,
    currentBranch: null,
    defaultBranch: null,
    dirty: false,
    branches: [],
    worktrees: [],
    error,
  };
}

function resolveProjectPath(projectPath: string): string {
  if (projectPath && projectPath !== '.') {
    return path.resolve(projectPath);
  }

  const cwd = process.cwd();
  return path.basename(cwd).toLowerCase() === 'pi-server' ? path.dirname(cwd) : cwd;
}

function safeRealpath(value: string): string {
  try {
    return realpathSync(value);
  } catch {
    return path.resolve(value);
  }
}

function isDirectory(value: string): boolean {
  return existsSync(value) && statSync(value).isDirectory();
}

function normalizePathKey(value: string): string {
  return path.resolve(value).toLowerCase();
}

function sanitizeSlug(value: string): string {
  return value
    .replace(/\\/g, '/')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'branch';
}

function splitLines(value: string | null): string[] {
  return (value ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function clampInt(value: string | null, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function json(status: number, body: unknown): RepositoryHttpResponse {
  return { status, body };
}
