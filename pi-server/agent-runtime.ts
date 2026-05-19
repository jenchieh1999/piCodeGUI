import type { PermissionAction, PermissionRequestData, RuntimeInfoData, ThinkingLevel, WsServerMsg } from './types.js';
import { simulateAgentResponse } from './mock-agent.js';

export interface RuntimePromptInput {
  sessionId: string;
  message: string;
  images?: Array<{ data: string; mimeType: string }>;
}

export interface RuntimeCallbacks {
  sendMessage: (msg: WsServerMsg) => void;
  requestPermission: (request: PermissionRequestData) => Promise<PermissionAction>;
}

export interface AgentRuntime {
  readonly kind: string;
  prompt(input: RuntimePromptInput, callbacks: RuntimeCallbacks, signal: AbortSignal): Promise<void>;
  steer?(sessionId: string, message: string, images?: RuntimePromptInput['images']): Promise<void>;
  followUp?(sessionId: string, message: string, images?: RuntimePromptInput['images']): Promise<void>;
  setModel?(provider: string, modelId: string): Promise<void> | void;
  setThinkingLevel?(level: ThinkingLevel): Promise<void> | void;
  getInfo(): RuntimeInfoData;
  abort(sessionId: string): Promise<void> | void;
  dispose(sessionId?: string): Promise<void> | void;
}

export class MockAgentRuntime implements AgentRuntime {
  readonly kind = 'mock';

  private queues = new Map<string, { steering: RuntimePromptInput[]; followUp: RuntimePromptInput[] }>();
  private callbacksBySession = new Map<string, RuntimeCallbacks>();

  async prompt(input: RuntimePromptInput, callbacks: RuntimeCallbacks, signal: AbortSignal): Promise<void> {
    this.callbacksBySession.set(input.sessionId, callbacks);
    let current: RuntimePromptInput | undefined = input;

    while (current && !signal.aborted) {
      await simulateAgentResponse(current.sessionId, current.message, {
        signal,
        sendMessage: (msg) => callbacks.sendMessage(msg as WsServerMsg),
        requestPermission: callbacks.requestPermission,
      });
      current = this.dequeueNext(current.sessionId);
    }
  }

  async steer(sessionId: string, message: string, images?: RuntimePromptInput['images']): Promise<void> {
    const queue = this.ensureQueue(sessionId);
    queue.steering.push({ sessionId, message, images });
    this.emitQueueUpdate(sessionId);
  }

  async followUp(sessionId: string, message: string, images?: RuntimePromptInput['images']): Promise<void> {
    const queue = this.ensureQueue(sessionId);
    queue.followUp.push({ sessionId, message, images });
    this.emitQueueUpdate(sessionId);
  }

  abort(sessionId: string): void {
    this.queues.delete(sessionId);
    this.emitQueueUpdate(sessionId);
  }

  getInfo(): RuntimeInfoData {
    return {
      mode: 'mock',
      active: 'mock',
      fallback: false,
      detail: 'Mock runtime is active. Agent responses are simulated.',
    };
  }

  dispose(sessionId?: string): void {
    if (sessionId) {
      this.queues.delete(sessionId);
      this.callbacksBySession.delete(sessionId);
      return;
    }

    this.queues.clear();
    this.callbacksBySession.clear();
  }

  private ensureQueue(sessionId: string): { steering: RuntimePromptInput[]; followUp: RuntimePromptInput[] } {
    let queue = this.queues.get(sessionId);
    if (!queue) {
      queue = { steering: [], followUp: [] };
      this.queues.set(sessionId, queue);
    }
    return queue;
  }

  private dequeueNext(sessionId: string): RuntimePromptInput | undefined {
    const queue = this.ensureQueue(sessionId);
    const next = queue.steering.shift() ?? queue.followUp.shift();
    this.emitQueueUpdate(sessionId);
    return next;
  }

  private emitQueueUpdate(sessionId: string): void {
    const queue = this.ensureQueue(sessionId);
    this.callbacksBySession.get(sessionId)?.sendMessage({
      type: 'queue_update',
      sessionId,
      steering: queue.steering.length,
      followUp: queue.followUp.length,
    });
  }
}
