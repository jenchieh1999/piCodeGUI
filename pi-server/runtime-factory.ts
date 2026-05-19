import type { AgentRuntime, RuntimeCallbacks, RuntimePromptInput } from './agent-runtime.js';
import type { RuntimeInfoData, ThinkingLevel } from './types.js';
import { MockAgentRuntime } from './agent-runtime.js';
import { PiAgentRuntime } from './pi-agent-runtime.js';

type RuntimeMode = 'mock' | 'pi' | 'auto';

export function createAgentRuntime(): AgentRuntime {
  const mode = normalizeRuntimeMode(process.env.PI_AGENT_RUNTIME);

  if (mode === 'mock') return new MockAgentRuntime();
  if (mode === 'pi') return new PiAgentRuntime();

  return new AutoAgentRuntime(new PiAgentRuntime(), new MockAgentRuntime());
}

class AutoAgentRuntime implements AgentRuntime {
  readonly kind = 'auto';

  private useFallback = false;

  constructor(
    private readonly primary: AgentRuntime,
    private readonly fallback: AgentRuntime
  ) {}

  async prompt(input: RuntimePromptInput, callbacks: RuntimeCallbacks, signal: AbortSignal): Promise<void> {
    if (this.useFallback) {
      await this.fallback.prompt(input, callbacks, signal);
      return;
    }

    let emittedRenderableOutput = false;
    const wrappedCallbacks: RuntimeCallbacks = {
      requestPermission: callbacks.requestPermission,
      sendMessage: (msg) => {
        if (msg.type !== 'status' && msg.type !== 'queue_update') {
          emittedRenderableOutput = true;
        }
        callbacks.sendMessage(msg);
      },
    };

    try {
      await this.primary.prompt(input, wrappedCallbacks, signal);
    } catch (err) {
      if (signal.aborted || emittedRenderableOutput) throw err;

      this.useFallback = true;
      callbacks.sendMessage({
        type: 'status',
        sessionId: input.sessionId,
        status: 'idle',
        detail: `Pi SDK runtime unavailable, falling back to mock: ${toErrorMessage(err)}`,
      });
      callbacks.sendMessage({
        type: 'runtime_updated',
        runtimeInfo: this.getInfo(toErrorMessage(err)),
      });
      await this.fallback.prompt(input, callbacks, signal);
    }
  }

  async steer(sessionId: string, message: string, images?: RuntimePromptInput['images']): Promise<void> {
    const runtime = this.useFallback ? this.fallback : this.primary;
    await runtime.steer?.(sessionId, message, images);
  }

  async followUp(sessionId: string, message: string, images?: RuntimePromptInput['images']): Promise<void> {
    const runtime = this.useFallback ? this.fallback : this.primary;
    await runtime.followUp?.(sessionId, message, images);
  }

  async setModel(provider: string, modelId: string): Promise<void> {
    await this.primary.setModel?.(provider, modelId);
    await this.fallback.setModel?.(provider, modelId);
  }

  async setThinkingLevel(level: ThinkingLevel): Promise<void> {
    await this.primary.setThinkingLevel?.(level);
    await this.fallback.setThinkingLevel?.(level);
  }

  getInfo(errorMessage?: string): RuntimeInfoData {
    return {
      mode: 'auto',
      active: this.useFallback ? 'mock' : 'pi',
      fallback: this.useFallback,
      detail: this.useFallback
        ? `Pi SDK runtime is unavailable; mock fallback is active${errorMessage ? `: ${errorMessage}` : ''}.`
        : 'Auto runtime will prefer Pi SDK and fall back to mock only if startup fails before streaming.',
    };
  }

  async abort(sessionId: string): Promise<void> {
    await this.primary.abort(sessionId);
    await this.fallback.abort(sessionId);
  }

  async dispose(sessionId?: string): Promise<void> {
    await this.primary.dispose(sessionId);
    await this.fallback.dispose(sessionId);
  }
}

function normalizeRuntimeMode(value: string | undefined): RuntimeMode {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'pi' || normalized === 'real') return 'pi';
  if (normalized === 'mock') return 'mock';
  return 'auto';
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
