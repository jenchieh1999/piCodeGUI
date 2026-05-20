import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { AgentRuntime, RuntimeCallbacks, RuntimePromptInput } from './agent-runtime.js';
import {
  getSession,
  getThinkingLevel,
  incrementSessionMessageCount,
  setSessionStatus,
} from './mock-agent.js';
import { extensionService } from './extension-service.js';
import type {
  FileChangeData,
  PermissionRequestData,
  PermissionPreviewData,
  RuntimeInfoData,
  ThinkingLevel,
  TokenUsageData,
  ToolResultData,
  ToolUseData,
} from './types.js';
import { getWorkspaceStatus } from './workspace-service.js';
import { getAuthPath, getModelsPath } from './agent-paths.js';

type PiSdk = typeof import('@earendil-works/pi-coding-agent');
type PiAgentSession = import('@earendil-works/pi-coding-agent').AgentSession;
type PiAgentSessionEvent = import('@earendil-works/pi-coding-agent').AgentSessionEvent;

interface PiRuntimeSession {
  appSessionId: string;
  cwd: string;
  resourceRevision: number;
  session: PiAgentSession;
  unsubscribe: () => void;
  callbacks: RuntimeCallbacks;
  currentMessageId?: string;
  completedCurrentMessage: boolean;
  emittedToolCalls: Set<string>;
  permissionCounter: number;
}

interface PiImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

export class PiAgentRuntime implements AgentRuntime {
  readonly kind = 'pi';

  private sdkPromise?: Promise<PiSdk>;
  private sessions = new Map<string, PiRuntimeSession>();
  private selectedModel?: { provider: string; modelId: string };
  private thinkingLevel: ThinkingLevel = getThinkingLevel();

  async prompt(input: RuntimePromptInput, callbacks: RuntimeCallbacks, signal: AbortSignal): Promise<void> {
    const runtimeSession = await this.ensureSession(input.sessionId, callbacks);
    runtimeSession.callbacks = callbacks;
    runtimeSession.completedCurrentMessage = false;

    const abortHandler = () => {
      void runtimeSession.session.abort().catch((err) => {
        console.warn('[PiRuntime] Abort failed:', toErrorMessage(err));
      });
    };

    if (signal.aborted) {
      await runtimeSession.session.abort();
      return;
    }

    signal.addEventListener('abort', abortHandler, { once: true });

    try {
      await Promise.resolve(runtimeSession.session.modelRegistry.refresh?.());
      await runtimeSession.session.prompt(input.message, {
        images: toPiImages(input.images),
        source: 'rpc',
      });

      this.completeIfNeeded(runtimeSession, usageFromMessages(runtimeSession.session.messages));
      this.emitStatus(input.sessionId, 'idle');
    } catch (err) {
      if (signal.aborted || isAbortError(err)) {
        await runtimeSession.session.abort().catch(() => undefined);
        return;
      }

      this.emitStatus(input.sessionId, 'error', toErrorMessage(err));
      throw err;
    } finally {
      signal.removeEventListener('abort', abortHandler);
    }
  }

  async steer(sessionId: string, message: string, images?: RuntimePromptInput['images']): Promise<void> {
    const runtimeSession = this.sessions.get(sessionId);
    if (!runtimeSession) {
      throw new Error('Pi runtime session is not ready yet. Send a prompt first.');
    }
    await runtimeSession.session.steer(message, toPiImages(images));
  }

  async followUp(sessionId: string, message: string, images?: RuntimePromptInput['images']): Promise<void> {
    const runtimeSession = this.sessions.get(sessionId);
    if (!runtimeSession) {
      throw new Error('Pi runtime session is not ready yet. Send a prompt first.');
    }
    await runtimeSession.session.followUp(message, toPiImages(images));
  }

  async setModel(provider: string, modelId: string): Promise<void> {
    this.selectedModel = { provider, modelId };
    for (const runtimeSession of this.sessions.values()) {
      const model = runtimeSession.session.modelRegistry.find(provider, modelId);
      if (!model) {
        throw new Error(`Pi SDK model not found: ${provider}/${modelId}`);
      }
      await runtimeSession.session.setModel(model);
    }
  }

  setThinkingLevel(level: ThinkingLevel): void {
    this.thinkingLevel = level;
    for (const runtimeSession of this.sessions.values()) {
      runtimeSession.session.setThinkingLevel(level as any);
    }
  }

  getInfo(): RuntimeInfoData {
    return {
      mode: 'pi',
      active: 'pi',
      fallback: false,
      detail: 'Pi SDK runtime is active. High-risk tools require desktop approval.',
    };
  }

  async abort(sessionId: string): Promise<void> {
    await this.sessions.get(sessionId)?.session.abort();
  }

  async dispose(sessionId?: string): Promise<void> {
    const targets = sessionId
      ? [...this.sessions.entries()].filter(([id]) => id === sessionId)
      : [...this.sessions.entries()];

    for (const [id, runtimeSession] of targets) {
      runtimeSession.unsubscribe();
      runtimeSession.session.dispose();
      this.sessions.delete(id);
    }
  }

  private async ensureSession(appSessionId: string, callbacks: RuntimeCallbacks): Promise<PiRuntimeSession> {
    const appSession = getSession(appSessionId);
    const cwd = resolveProjectPath(appSession?.projectPath ?? '.');
    const resourceContext = await extensionService.getRuntimeContext(cwd);
    const existing = this.sessions.get(appSessionId);
    if (existing && existing.cwd === cwd && existing.resourceRevision === resourceContext.revision) {
      return existing;
    }

    if (existing) {
      existing.unsubscribe();
      existing.session.dispose();
      this.sessions.delete(appSessionId);
    }

    const sdk = await this.loadSdk();
    const authStorage = sdk.AuthStorage.create(getAuthPath());
    const modelRegistry = sdk.ModelRegistry.create(authStorage, getModelsPath());
    const sessionManager = sdk.SessionManager.inMemory(cwd);
    const selectedModel = this.selectedModel
      ? modelRegistry.find(this.selectedModel.provider, this.selectedModel.modelId)
      : undefined;

    const { session, modelFallbackMessage } = await sdk.createAgentSession({
      cwd,
      authStorage,
      modelRegistry,
      sessionManager,
      settingsManager: resourceContext.settingsManager,
      resourceLoader: resourceContext.resourceLoader,
      agentDir: resourceContext.agentDir,
      model: selectedModel,
      thinkingLevel: this.thinkingLevel as any,
      tools: ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'],
      sessionStartEvent: { type: 'session_start', reason: 'startup' },
    });

    const runtimeSession: PiRuntimeSession = {
      appSessionId,
      cwd,
      resourceRevision: resourceContext.revision,
      session,
      callbacks,
      currentMessageId: undefined,
      completedCurrentMessage: false,
      emittedToolCalls: new Set(),
      permissionCounter: 0,
      unsubscribe: () => undefined,
    };

    this.installPermissionHook(runtimeSession);

    runtimeSession.unsubscribe = session.subscribe((event) => {
      this.handleEvent(runtimeSession, event);
    });

    if (modelFallbackMessage) {
      callbacks.sendMessage({ type: 'status', sessionId: appSessionId, status: 'idle', detail: modelFallbackMessage });
    }

    this.sessions.set(appSessionId, runtimeSession);
    return runtimeSession;
  }

  private async loadSdk(): Promise<PiSdk> {
    this.sdkPromise ??= import('@earendil-works/pi-coding-agent');
    return this.sdkPromise;
  }

  private installPermissionHook(runtimeSession: PiRuntimeSession): void {
    const originalBeforeToolCall = runtimeSession.session.agent.beforeToolCall;

    runtimeSession.session.agent.beforeToolCall = async (context, signal) => {
      const originalResult = await originalBeforeToolCall?.(context, signal);
      if (originalResult?.block) return originalResult;

      const request = createPermissionRequest(runtimeSession, context.toolCall.name, context.args);
      if (!request) return originalResult;

      const action = await runtimeSession.callbacks.requestPermission(request);
      if (action === 'deny') {
        return {
          block: true,
          reason: `Permission denied by user for ${context.toolCall.name}.`,
        };
      }

      return originalResult;
    };
  }

  private handleEvent(runtimeSession: PiRuntimeSession, event: PiAgentSessionEvent): void {
    const sessionId = runtimeSession.appSessionId;

    switch (event.type) {
      case 'agent_start':
        this.emitStatus(sessionId, 'running');
        break;
      case 'agent_end':
        this.completeIfNeeded(runtimeSession, usageFromMessages(event.messages));
        this.emitStatus(sessionId, 'idle');
        break;
      case 'queue_update':
        runtimeSession.callbacks.sendMessage({
          type: 'queue_update',
          sessionId,
          steering: event.steering.length,
          followUp: event.followUp.length,
        });
        break;
      case 'compaction_start':
        runtimeSession.callbacks.sendMessage({ type: 'compaction_start', sessionId });
        break;
      case 'compaction_end':
        runtimeSession.callbacks.sendMessage({ type: 'compaction_end', sessionId });
        break;
      case 'message_start':
        this.ensureAssistantMessage(runtimeSession, messageIdFromEvent(sessionId, event.message));
        break;
      case 'message_update':
        this.handleAssistantMessageEvent(runtimeSession, event.assistantMessageEvent);
        break;
      case 'tool_execution_start':
        this.emitToolUse(runtimeSession, {
          id: event.toolCallId,
          name: event.toolName,
          args: normalizeRecord(event.args),
        });
        break;
      case 'tool_execution_end':
        this.emitToolResult(runtimeSession, {
          toolCallId: event.toolCallId,
          content: contentToText(event.result?.content),
          isError: Boolean(event.isError),
          details: normalizeDetails(event.result?.details),
        });
        this.emitWorkspaceChangesIfNeeded(runtimeSession, event.toolName);
        break;
      case 'thinking_level_changed':
        break;
      default:
        break;
    }
  }

  private handleAssistantMessageEvent(runtimeSession: PiRuntimeSession, event: any): void {
    const sessionId = runtimeSession.appSessionId;

    switch (event.type) {
      case 'start':
        this.ensureAssistantMessage(runtimeSession, messageIdFromEvent(sessionId, event.partial));
        break;
      case 'text_start':
        this.ensureAssistantMessage(runtimeSession, messageIdFromEvent(sessionId, event.partial));
        break;
      case 'text_delta':
        this.ensureAssistantMessage(runtimeSession, messageIdFromEvent(sessionId, event.partial));
        runtimeSession.callbacks.sendMessage({ type: 'text_delta', sessionId, delta: String(event.delta ?? '') });
        break;
      case 'text_end':
        if (runtimeSession.currentMessageId) {
          runtimeSession.callbacks.sendMessage({
            type: 'text_end',
            sessionId,
            messageId: runtimeSession.currentMessageId,
          });
        }
        break;
      case 'thinking_start':
        this.ensureAssistantMessage(runtimeSession, messageIdFromEvent(sessionId, event.partial));
        runtimeSession.callbacks.sendMessage({ type: 'thinking_start', sessionId });
        break;
      case 'thinking_delta':
        this.ensureAssistantMessage(runtimeSession, messageIdFromEvent(sessionId, event.partial));
        runtimeSession.callbacks.sendMessage({ type: 'thinking_delta', sessionId, delta: String(event.delta ?? '') });
        break;
      case 'thinking_end':
        runtimeSession.callbacks.sendMessage({ type: 'thinking_end', sessionId });
        break;
      case 'toolcall_end':
        this.emitToolUse(runtimeSession, toolUseFromToolCall(event.toolCall));
        break;
      case 'error':
        if (event.error?.errorMessage) {
          runtimeSession.callbacks.sendMessage({
            type: 'error',
            sessionId,
            message: String(event.error.errorMessage),
          });
        }
        break;
      case 'done':
        this.completeIfNeeded(runtimeSession, usageFromAssistant(event.message));
        break;
      default:
        break;
    }
  }

  private ensureAssistantMessage(runtimeSession: PiRuntimeSession, preferredMessageId?: string): string {
    if (runtimeSession.currentMessageId) return runtimeSession.currentMessageId;

    const messageId = preferredMessageId ?? `pi-${runtimeSession.appSessionId}-${Date.now()}`;
    runtimeSession.currentMessageId = messageId;
    runtimeSession.completedCurrentMessage = false;
    runtimeSession.emittedToolCalls.clear();
    runtimeSession.callbacks.sendMessage({
      type: 'text_start',
      sessionId: runtimeSession.appSessionId,
      messageId,
    });
    return messageId;
  }

  private completeIfNeeded(runtimeSession: PiRuntimeSession, usage: TokenUsageData): void {
    if (!runtimeSession.currentMessageId || runtimeSession.completedCurrentMessage) return;

    const messageId = runtimeSession.currentMessageId;
    runtimeSession.callbacks.sendMessage({
      type: 'message_complete',
      sessionId: runtimeSession.appSessionId,
      messageId,
      usage,
    });
    incrementSessionMessageCount(runtimeSession.appSessionId);
    runtimeSession.completedCurrentMessage = true;
    runtimeSession.currentMessageId = undefined;
  }

  private emitToolUse(runtimeSession: PiRuntimeSession, toolCall: ToolUseData): void {
    if (!toolCall.id || runtimeSession.emittedToolCalls.has(toolCall.id)) return;
    this.ensureAssistantMessage(runtimeSession);
    runtimeSession.emittedToolCalls.add(toolCall.id);
    runtimeSession.callbacks.sendMessage({
      type: 'tool_use',
      sessionId: runtimeSession.appSessionId,
      toolCall,
    });
  }

  private emitToolResult(runtimeSession: PiRuntimeSession, result: ToolResultData): void {
    this.ensureAssistantMessage(runtimeSession);
    runtimeSession.callbacks.sendMessage({
      type: 'tool_result',
      sessionId: runtimeSession.appSessionId,
      result,
    });
  }

  private emitStatus(sessionId: string, status: 'idle' | 'running' | 'error', detail?: string): void {
    setSessionStatus(sessionId, status);
    const runtimeSession = this.sessions.get(sessionId);
    runtimeSession?.callbacks.sendMessage({ type: 'status', sessionId, status, detail });
  }

  private emitWorkspaceChangesIfNeeded(runtimeSession: PiRuntimeSession, toolName: string): void {
    if (!isWorkspaceMutationTool(toolName)) return;

    const status = getWorkspaceStatus(runtimeSession.appSessionId);
    if (status.state !== 'ok') return;

    runtimeSession.callbacks.sendMessage({
      type: 'file_changes',
      sessionId: runtimeSession.appSessionId,
      changes: status.changedFiles.map<FileChangeData>((file) => ({
        path: file.path,
        oldPath: file.oldPath,
        status: mapWorkspaceStatus(file.status),
      })),
    });
  }
}

function createPermissionRequest(runtimeSession: PiRuntimeSession, toolName: string, args: unknown): PermissionRequestData | null {
  const risk = permissionRisk(toolName);
  if (!risk) return null;

  runtimeSession.permissionCounter += 1;
  return {
    requestId: `pi-perm-${runtimeSession.appSessionId}-${Date.now()}-${runtimeSession.permissionCounter}`,
    toolName,
    args: normalizeRecord(args),
    message: permissionMessage(toolName, args),
    risk,
    preview: createPermissionPreview(runtimeSession, toolName, args),
  };
}

function createPermissionPreview(runtimeSession: PiRuntimeSession, toolName: string, args: unknown): PermissionPreviewData | undefined {
  const normalized = toolName.toLowerCase();
  const record = normalizeRecord(args);
  const appSession = getSession(runtimeSession.appSessionId);
  const cwd = resolveProjectPath(appSession?.projectPath ?? '.');

  if (normalized === 'bash') {
    const command = stringValue(record.command);
    return command ? { kind: 'bash', command, cwd } : { kind: 'bash', command: 'Shell command', cwd };
  }

  if (normalized === 'write') {
    const filePath = stringValue(record.path) ?? stringValue(record.filePath);
    const content = stringValue(record.content);
    if (!filePath) return undefined;

    const exists = fileExistsInWorkspace(cwd, filePath);
    const existing = readTextFileIfAvailable(cwd, filePath);
    return {
      kind: 'file',
      path: normalizePreviewPath(filePath),
      operation: 'write',
      diff: content !== undefined ? createWritePreviewDiff(filePath, existing, content) : undefined,
      summary: content !== undefined
        ? `${exists ? 'Overwrite' : 'Create'} ${normalizePreviewPath(filePath)} with ${lineCount(content)} lines.`
        : `Write ${normalizePreviewPath(filePath)}.`,
    };
  }

  if (normalized === 'edit') {
    const filePath = stringValue(record.path) ?? stringValue(record.filePath);
    const edits = Array.isArray(record.edits) ? record.edits : [];
    if (!filePath) return undefined;

    return {
      kind: 'file',
      path: normalizePreviewPath(filePath),
      operation: 'edit',
      diff: createEditPreviewDiff(filePath, edits),
      summary: `Apply ${edits.length || 'one or more'} targeted edit${edits.length === 1 ? '' : 's'} to ${normalizePreviewPath(filePath)}.`,
      truncated: edits.length > 6,
    };
  }

  return undefined;
}

function permissionRisk(toolName: string): PermissionRequestData['risk'] | null {
  const normalized = toolName.toLowerCase();
  if (normalized === 'bash') return 'high';
  if (normalized === 'write' || normalized === 'edit') return 'high';
  return null;
}

function permissionMessage(toolName: string, args: unknown): string {
  const normalized = toolName.toLowerCase();
  const record = normalizeRecord(args);

  if (normalized === 'bash') {
    const command = typeof record.command === 'string' ? record.command : '';
    return command ? `Run shell command: ${command}` : 'Run a shell command in this workspace.';
  }

  if (normalized === 'write') {
    const filePath = typeof record.path === 'string' ? record.path : typeof record.filePath === 'string' ? record.filePath : '';
    return filePath ? `Write file: ${filePath}` : 'Write a file in this workspace.';
  }

  if (normalized === 'edit') {
    const filePath = typeof record.path === 'string' ? record.path : typeof record.filePath === 'string' ? record.filePath : '';
    return filePath ? `Edit file: ${filePath}` : 'Edit a file in this workspace.';
  }

  return `Run tool: ${toolName}`;
}

function isWorkspaceMutationTool(toolName: string): boolean {
  const normalized = toolName.toLowerCase();
  return normalized === 'write' || normalized === 'edit';
}

function createWritePreviewDiff(filePath: string, existing: string | null, next: string): string {
  const normalized = normalizePreviewPath(filePath);
  const oldLines = existing === null ? [] : existing.split('\n');
  const nextLines = next.split('\n');
  return limitDiffLines([
    `--- a/${normalized}`,
    `+++ b/${normalized}`,
    '@@ proposed write @@',
    ...oldLines.map((line) => `-${line}`),
    ...nextLines.map((line) => `+${line}`),
  ]);
}

function createEditPreviewDiff(filePath: string, edits: unknown[]): string {
  const normalized = normalizePreviewPath(filePath);
  const blocks = [
    `--- a/${normalized}`,
    `+++ b/${normalized}`,
  ];

  for (const [index, rawEdit] of edits.slice(0, 6).entries()) {
    const edit = normalizeRecord(rawEdit);
    const oldText = stringValue(edit.oldText) ?? stringValue(edit.old_string) ?? '';
    const newText = stringValue(edit.newText) ?? stringValue(edit.new_string) ?? '';
    blocks.push(`@@ edit ${index + 1} @@`);
    blocks.push(...oldText.split('\n').map((line) => `-${line}`));
    blocks.push(...newText.split('\n').map((line) => `+${line}`));
  }

  if (edits.length > 6) {
    blocks.push(`... ${edits.length - 6} more edit blocks`);
  }

  return limitDiffLines(blocks);
}

function limitDiffLines(lines: string[]): string {
  const maxLines = 120;
  if (lines.length <= maxLines) return lines.join('\n');
  return [
    ...lines.slice(0, maxLines),
    `... ${lines.length - maxLines} more preview lines`,
  ].join('\n');
}

function readTextFileIfAvailable(cwd: string, filePath: string): string | null {
  try {
    const absolute = resolveInsideRoot(cwd, filePath);
    if (!existsSync(absolute)) return null;
    if (!statSync(absolute).isFile() || statSync(absolute).size > 1024 * 1024) return null;
    const buffer = readFileSync(absolute);
    if (buffer.includes(0)) return null;
    return buffer.toString('utf8');
  } catch {
    return null;
  }
}

function fileExistsInWorkspace(cwd: string, filePath: string): boolean {
  try {
    return existsSync(resolveInsideRoot(cwd, filePath));
  } catch {
    return false;
  }
}

function resolveInsideRoot(root: string, filePath: string): string {
  const resolved = path.resolve(root, normalizePreviewPath(filePath));
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Path escapes workspace.');
  }
  return resolved;
}

function normalizePreviewPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function lineCount(value: string): number {
  return value.length === 0 ? 0 : value.split('\n').length;
}

function mapWorkspaceStatus(status: string): FileChangeData['status'] {
  if (status === 'added' || status === 'untracked') return 'added';
  if (status === 'deleted') return 'deleted';
  if (status === 'renamed') return 'renamed';
  return 'modified';
}

function resolveProjectPath(projectPath: string): string {
  if (!projectPath || projectPath === '.') return process.cwd();
  return path.isAbsolute(projectPath) ? projectPath : path.resolve(process.cwd(), projectPath);
}

function toPiImages(images: RuntimePromptInput['images']): PiImageContent[] | undefined {
  if (!images?.length) return undefined;
  return images.map((image) => ({
    type: 'image',
    data: image.data,
    mimeType: image.mimeType,
  }));
}

function messageIdFromEvent(sessionId: string, message: any): string | undefined {
  const timestamp = typeof message?.timestamp === 'number' ? message.timestamp : undefined;
  const responseId = typeof message?.responseId === 'string' ? message.responseId : undefined;
  if (responseId) return `pi-${sessionId}-${responseId}`;
  if (timestamp) return `pi-${sessionId}-${timestamp}`;
  return undefined;
}

function toolUseFromToolCall(toolCall: any): ToolUseData {
  return {
    id: String(toolCall?.id ?? `tool-${Date.now()}`),
    name: String(toolCall?.name ?? 'tool'),
    args: normalizeRecord(toolCall?.arguments ?? toolCall?.args),
  };
}

function usageFromMessages(messages: readonly any[] | undefined): TokenUsageData {
  if (!messages?.length) return zeroUsage();

  return messages.reduce<TokenUsageData>((total, message) => {
    if (message?.role !== 'assistant') return total;
    const usage = usageFromAssistant(message);
    return {
      input: total.input + usage.input,
      output: total.output + usage.output,
      cacheRead: total.cacheRead + usage.cacheRead,
      cacheWrite: total.cacheWrite + usage.cacheWrite,
      cost: total.cost + usage.cost,
    };
  }, zeroUsage());
}

function usageFromAssistant(message: any): TokenUsageData {
  const usage = message?.usage;
  if (!usage) return zeroUsage();

  return {
    input: numberOrZero(usage.input),
    output: numberOrZero(usage.output),
    cacheRead: numberOrZero(usage.cacheRead),
    cacheWrite: numberOrZero(usage.cacheWrite),
    cost: numberOrZero(usage.cost?.total ?? usage.cost),
  };
}

function zeroUsage(): TokenUsageData {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeDetails(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content ? JSON.stringify(content) : '';

  return content
    .map((item) => {
      if (typeof item === 'string') return item;
      if (item?.type === 'text') return String(item.text ?? '');
      if (item?.type === 'image') return `[image: ${String(item.mimeType ?? 'unknown')}]`;
      return JSON.stringify(item);
    })
    .filter(Boolean)
    .join('\n');
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === 'AbortError';
}
