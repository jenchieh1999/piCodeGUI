import path from 'node:path';
import { getSession } from './mock-agent.js';
import {
  appendPermissionAudit,
  loadPermissionRules,
  upsertPermissionRule,
} from './permission-store.js';
import type {
  PermissionAction,
  PermissionAuditEntryData,
  PermissionRequestData,
  PermissionRuleData,
  PermissionScopeData,
  WsServerMsg,
} from './types.js';

type SendMessage = (msg: WsServerMsg) => void;

interface PendingPermission {
  sessionId: string;
  request: PermissionRequestData;
  resolve: (action: PermissionAction) => void;
  reject: (err: Error) => void;
  abortHandler?: () => void;
}

interface PermissionResponse {
  action: PermissionAction;
  requestId: string;
  scope?: PermissionScopeData;
}

interface PermissionTarget {
  command?: string;
  filePath?: string;
}

export class PermissionBroker {
  private pending = new Map<string, PendingPermission>();

  request(
    sessionId: string,
    request: PermissionRequestData,
    sendMessage: SendMessage,
    signal?: AbortSignal
  ): Promise<PermissionAction> {
    const matchedRule = this.findMatchingRule(sessionId, request);
    if (matchedRule) {
      this.markRuleUsed(matchedRule);
      this.recordAudit(sessionId, request, {
        action: 'allow',
        ruleId: matchedRule.id,
        scope: matchedRule.scope,
        reason: 'Matched saved permission rule',
      });
      return Promise.resolve('allow');
    }

    if (signal?.aborted) {
      return Promise.reject(createAbortError());
    }

    sendMessage({ type: 'permission_request', sessionId, request });

    let abortHandler: (() => void) | undefined;
    return new Promise<PermissionAction>((resolve, reject) => {
      abortHandler = () => {
        this.pending.delete(request.requestId);
        reject(createAbortError());
      };

      signal?.addEventListener('abort', abortHandler, { once: true });
      this.pending.set(request.requestId, {
        sessionId,
        request,
        resolve,
        reject,
        abortHandler,
      });
    }).finally(() => {
      if (signal && abortHandler) {
        signal.removeEventListener('abort', abortHandler);
      }
      this.pending.delete(request.requestId);
    });
  }

  resolve(sessionId: string, response: PermissionResponse): boolean {
    const pending = this.pending.get(response.requestId);
    if (!pending || pending.sessionId !== sessionId) {
      return false;
    }

    let rule: PermissionRuleData | undefined;
    if (response.action === 'always_allow') {
      rule = this.createRule(sessionId, pending.request, normalizeScope(response.scope));
      upsertPermissionRule(rule);
    }

    this.recordAudit(sessionId, pending.request, {
      action: response.action,
      scope: response.action === 'always_allow' ? rule?.scope : undefined,
      ruleId: rule?.id,
      reason: response.action === 'always_allow'
        ? 'User saved permission rule'
        : response.action === 'allow'
          ? 'User allowed once'
          : 'User denied request',
    });

    pending.resolve(response.action);
    return true;
  }

  recordModeDecision(
    sessionId: string,
    request: PermissionRequestData,
    action: PermissionAction,
    reason: string
  ): void {
    this.recordAudit(sessionId, request, { action, reason });
  }

  abortSession(sessionId: string): void {
    for (const [requestId, pending] of this.pending) {
      if (pending.sessionId === sessionId) {
        pending.reject(createAbortError());
        this.pending.delete(requestId);
      }
    }
  }

  private findMatchingRule(sessionId: string, request: PermissionRequestData): PermissionRuleData | undefined {
    const session = getSession(sessionId);
    const projectPath = normalizeProjectPath(session?.projectPath);
    const target = extractPermissionTarget(request);
    const toolName = normalizeToolName(request.toolName);

    return loadPermissionRules().find((rule) => {
      if (normalizeToolName(rule.toolName) !== toolName) return false;
      if (riskRank(request.risk) > riskRank(rule.riskMax)) return false;
      if (!scopeMatches(rule, sessionId, projectPath)) return false;
      if (rule.commandPrefix && !target.command?.startsWith(rule.commandPrefix)) return false;
      if (rule.pathPattern && !matchesPathPattern(rule.pathPattern, target.filePath)) return false;
      return true;
    });
  }

  private markRuleUsed(rule: PermissionRuleData): void {
    const now = Date.now();
    upsertPermissionRule({
      ...rule,
      updatedAt: now,
      lastUsedAt: now,
      useCount: rule.useCount + 1,
    });
  }

  private createRule(
    sessionId: string,
    request: PermissionRequestData,
    scope: PermissionScopeData
  ): PermissionRuleData {
    const now = Date.now();
    const session = getSession(sessionId);
    const projectPath = normalizeProjectPath(session?.projectPath);
    const target = extractPermissionTarget(request);
    const toolName = normalizeToolName(request.toolName);
    const existing = loadPermissionRules().find((rule) =>
      normalizeToolName(rule.toolName) === toolName
      && rule.scope === scope
      && (rule.sessionId ?? '') === (scope === 'session' ? sessionId : '')
      && (rule.projectPath ?? '') === (scope === 'project' ? projectPath : '')
      && (rule.commandPrefix ?? '') === (target.command ?? '')
      && (rule.pathPattern ?? '') === (target.filePath ?? '')
    );

    return {
      id: existing?.id ?? `perm-rule-${now}-${Math.random().toString(36).slice(2, 8)}`,
      toolName,
      scope,
      sessionId: scope === 'session' ? sessionId : undefined,
      projectPath: scope === 'project' ? projectPath : undefined,
      commandPrefix: target.command,
      pathPattern: target.filePath,
      riskMax: request.risk,
      description: describeRule(toolName, scope, target),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      useCount: existing?.useCount ?? 0,
      lastUsedAt: existing?.lastUsedAt,
    };
  }

  private recordAudit(
    sessionId: string,
    request: PermissionRequestData,
    decision: {
      action: PermissionAction;
      scope?: PermissionScopeData;
      ruleId?: string;
      reason?: string;
    }
  ): void {
    const target = extractPermissionTarget(request);
    const session = getSession(sessionId);
    const entry: PermissionAuditEntryData = {
      id: `perm-audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
      sessionId,
      projectPath: normalizeProjectPath(session?.projectPath),
      toolName: normalizeToolName(request.toolName),
      action: decision.action,
      scope: decision.scope,
      risk: request.risk,
      command: target.command,
      path: target.filePath,
      ruleId: decision.ruleId,
      reason: decision.reason,
      message: request.message,
    };
    appendPermissionAudit(entry);
  }
}

function createAbortError(): Error {
  const err = new Error('Aborted');
  err.name = 'AbortError';
  return err;
}

function normalizeScope(scope: unknown): PermissionScopeData {
  return scope === 'project' || scope === 'global' || scope === 'session' ? scope : 'session';
}

function normalizeToolName(toolName: string): string {
  return toolName.trim().toLowerCase();
}

function normalizeProjectPath(projectPath: string | undefined): string | undefined {
  if (!projectPath) return undefined;
  if (projectPath === '.') return process.cwd();
  return path.resolve(projectPath);
}

function extractPermissionTarget(request: PermissionRequestData): PermissionTarget {
  if (request.preview?.kind === 'bash') {
    return { command: normalizeCommand(request.preview.command) };
  }

  if (request.preview?.kind === 'file') {
    return { filePath: normalizeFilePath(request.preview.path) };
  }

  const command = typeof request.args.command === 'string' ? normalizeCommand(request.args.command) : undefined;
  const rawPath =
    typeof request.args.path === 'string'
      ? request.args.path
      : typeof request.args.filePath === 'string'
        ? request.args.filePath
        : undefined;
  return {
    command,
    filePath: rawPath ? normalizeFilePath(rawPath) : undefined,
  };
}

function normalizeCommand(command: string | undefined): string | undefined {
  const normalized = command?.trim().replace(/\s+/g, ' ');
  return normalized || undefined;
}

function normalizeFilePath(filePath: string | undefined): string | undefined {
  const normalized = filePath?.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  return normalized || undefined;
}

function scopeMatches(rule: PermissionRuleData, sessionId: string, projectPath: string | undefined): boolean {
  if (rule.scope === 'global') return true;
  if (rule.scope === 'session') return rule.sessionId === sessionId;
  if (rule.scope === 'project') return Boolean(projectPath) && rule.projectPath === projectPath;
  return false;
}

function matchesPathPattern(pattern: string, filePath: string | undefined): boolean {
  if (!filePath) return false;
  if (pattern.endsWith('/**')) {
    const prefix = pattern.slice(0, -3);
    return filePath === prefix || filePath.startsWith(`${prefix}/`);
  }
  return filePath === pattern;
}

function riskRank(risk: PermissionRequestData['risk']): number {
  if (risk === 'low') return 1;
  if (risk === 'medium') return 2;
  return 3;
}

function describeRule(toolName: string, scope: PermissionScopeData, target: PermissionTarget): string {
  const scopeLabel = scope === 'session' ? 'this session' : scope === 'project' ? 'this project' : 'all projects';
  if (target.command) return `Allow ${target.command} in ${scopeLabel}`;
  if (target.filePath) return `Allow ${toolName} on ${target.filePath} in ${scopeLabel}`;
  return `Allow ${toolName} in ${scopeLabel}`;
}
