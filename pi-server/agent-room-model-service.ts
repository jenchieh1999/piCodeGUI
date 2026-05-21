import type { Api, Model, TextContent, UserMessage, Usage } from '@earendil-works/pi-ai';
import { getAuthPath, getModelsPath } from './agent-paths.js';
import { normalizeProviderModelId } from './model-catalog.js';
import { normalizeProviderAlias } from './provider-metadata.js';
import type { ModelRefData, TokenUsageData } from './types.js';

type SdkModel = Model<Api>;

export interface AgentRoomModelCompletionInput {
  systemPrompt: string;
  userPrompt: string;
  purpose: 'quick' | 'deep';
  preferredModel?: ModelRefData;
  signal: AbortSignal;
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface AgentRoomModelCompletionResult {
  text: string;
  provider: string;
  modelId: string;
  usage?: TokenUsageData;
}

const QUICK_TIMEOUT_MS = intEnv('PI_AGENT_ROOM_QUICK_TIMEOUT_MS', 30_000, 5_000, 180_000);
const DEEP_TIMEOUT_MS = intEnv('PI_AGENT_ROOM_DEEP_TIMEOUT_MS', 90_000, 15_000, 300_000);
const QUICK_MAX_TOKENS = 1_600;
const DEEP_MAX_TOKENS = 3_600;

const QUICK_MODEL_KEYWORDS = [
  ['nano', 135],
  ['mini', 125],
  ['haiku', 120],
  ['flash', 115],
  ['air', 110],
  ['lite', 95],
  ['light', 90],
  ['turbo', 80],
  ['small', 70],
] as const;

const DEEP_MODEL_KEYWORDS = [
  ['opus', 130],
  ['sonnet', 105],
  ['pro', 95],
  ['max', 90],
  ['reason', 75],
  ['thinking', 70],
  ['gpt-5', 65],
  ['glm-5', 60],
  ['deepseek-reasoner', 55],
] as const;

export async function completeAgentRoomStep(
  input: AgentRoomModelCompletionInput,
): Promise<AgentRoomModelCompletionResult> {
  if (input.signal.aborted) throw abortError();

  const { AuthStorage, ModelRegistry } = await import('@earendil-works/pi-coding-agent');
  const { complete } = await import('@earendil-works/pi-ai');

  const authStorage = AuthStorage.create(getAuthPath());
  const modelRegistry = ModelRegistry.create(authStorage, getModelsPath());
  await Promise.resolve(modelRegistry.refresh?.());

  const models = (modelRegistry.getAvailable() as SdkModel[]).filter((model) => model.input?.includes('text'));
  const model = selectAgentRoomModel(models, input);
  if (!model) throw new Error('No configured text model is available.');

  const auth = await modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) throw new Error(auth.error || `No auth for ${model.provider}.`);
  if (!auth.apiKey && !auth.headers) throw new Error(`No API key or request headers configured for ${model.provider}.`);

  const controller = new AbortController();
  const timeoutMs = input.timeoutMs ?? (input.purpose === 'quick' ? QUICK_TIMEOUT_MS : DEEP_TIMEOUT_MS);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  input.signal.addEventListener('abort', abort, { once: true });

  try {
    const userMessage: UserMessage = {
      role: 'user',
      content: [{ type: 'text', text: input.userPrompt }],
      timestamp: Date.now(),
    };

    const response = await complete(
      model,
      { systemPrompt: input.systemPrompt, messages: [userMessage] },
      {
        apiKey: auth.apiKey,
        headers: auth.headers,
        signal: controller.signal,
        temperature: input.temperature ?? (input.purpose === 'quick' ? 0.25 : 0.35),
        maxTokens: input.maxTokens ?? (input.purpose === 'quick' ? QUICK_MAX_TOKENS : DEEP_MAX_TOKENS),
        timeoutMs,
        maxRetries: 0,
      },
    );

    if (response.stopReason === 'aborted') throw new Error('Agent room model request timed out.');
    if (response.stopReason === 'error') throw new Error(response.errorMessage || 'Agent room model request failed.');

    const text = sanitizeModelText(
      response.content
        .filter((part): part is TextContent => part.type === 'text')
        .map((part) => part.text)
        .join('\n'),
    );
    if (!text) throw new Error('Agent room model returned empty text.');

    return {
      text,
      provider: normalizeProviderAlias(model.provider),
      modelId: normalizeProviderModelId(model.provider, model.id),
      usage: usageToTokenUsage(response.usage),
    };
  } finally {
    clearTimeout(timeout);
    input.signal.removeEventListener('abort', abort);
  }
}

function selectAgentRoomModel(models: SdkModel[], input: AgentRoomModelCompletionInput): SdkModel | null {
  if (models.length === 0) return null;

  if (input.preferredModel) {
    const explicit = findSdkModel(models, input.preferredModel.provider, input.preferredModel.id);
    if (explicit) return explicit;
  }

  const envModel = input.purpose === 'quick'
    ? process.env.PI_AGENT_ROOM_QUICK_MODEL?.trim() || process.env.PI_AGENT_FAST_MODEL?.trim()
    : process.env.PI_AGENT_ROOM_DEEP_MODEL?.trim();
  const envProvider = input.purpose === 'quick'
    ? process.env.PI_AGENT_ROOM_QUICK_PROVIDER?.trim() || process.env.PI_AGENT_FAST_PROVIDER?.trim()
    : process.env.PI_AGENT_ROOM_DEEP_PROVIDER?.trim();
  if (envModel) {
    const parsed = parseProviderModel(envModel, envProvider);
    const explicit = parsed.provider
      ? findSdkModel(models, parsed.provider, parsed.modelId)
      : findSdkModelByModelId(models, parsed.modelId);
    if (explicit) return explicit;
  }

  const ranked = [...models].sort((a, b) => scoreModel(b, input.purpose) - scoreModel(a, input.purpose));
  return ranked[0] ?? models[0] ?? null;
}

function parseProviderModel(rawModel: string, rawProvider?: string): { provider?: string; modelId: string } {
  const provider = rawProvider ? normalizeProviderAlias(rawProvider) : undefined;
  const slashIndex = rawModel.indexOf('/');
  if (!provider && slashIndex > 0) {
    const maybeProvider = rawModel.slice(0, slashIndex);
    const maybeModel = rawModel.slice(slashIndex + 1);
    return {
      provider: normalizeProviderAlias(maybeProvider),
      modelId: normalizeProviderModelId(maybeProvider, maybeModel),
    };
  }
  return {
    provider,
    modelId: normalizeProviderModelId(provider ?? '', rawModel),
  };
}

function findSdkModel(models: SdkModel[], provider: string, modelId: string): SdkModel | null {
  const targetProvider = normalizeProviderAlias(provider);
  const targetModel = normalizeProviderModelId(targetProvider, modelId);
  return models.find((model) => {
    const candidateProvider = normalizeProviderAlias(model.provider);
    const candidateModel = normalizeProviderModelId(candidateProvider, model.id);
    return candidateProvider === targetProvider && candidateModel === targetModel;
  }) ?? null;
}

function findSdkModelByModelId(models: SdkModel[], modelId: string): SdkModel | null {
  const targetModel = normalizeProviderModelId('', modelId).toLowerCase();
  return models.find((model) => {
    const provider = normalizeProviderAlias(model.provider);
    const candidate = normalizeProviderModelId(provider, model.id).toLowerCase();
    return candidate === targetModel || `${provider}/${candidate}` === targetModel;
  }) ?? null;
}

function scoreModel(model: SdkModel, purpose: 'quick' | 'deep'): number {
  const label = `${model.provider} ${model.id} ${model.name}`.toLowerCase();
  let score = model.reasoning ? 25 : 10;
  const preferred = purpose === 'quick' ? QUICK_MODEL_KEYWORDS : DEEP_MODEL_KEYWORDS;
  const penalized = purpose === 'quick' ? DEEP_MODEL_KEYWORDS : QUICK_MODEL_KEYWORDS;

  for (const [keyword, weight] of preferred) {
    if (label.includes(keyword)) score += weight;
  }
  for (const [keyword, weight] of penalized) {
    if (label.includes(keyword)) score -= Math.round(weight * 0.35);
  }

  if (purpose === 'quick') {
    if (label.includes('glm-4.5-air')) score += 65;
    if (label.includes('gpt-4o-mini') || label.includes('gpt-4.1-mini')) score += 55;
    if (label.includes('gemini-2.5-flash') || label.includes('gemini-2.0-flash')) score += 55;
    if (label.includes('claude-3-5-haiku') || label.includes('claude-3-haiku')) score += 55;
    if (model.reasoning) score -= 30;
  } else {
    if (label.includes('glm-5.1') || label.includes('glm-5')) score += 65;
    if (label.includes('claude') && label.includes('sonnet')) score += 60;
    if (label.includes('gpt-5') || label.includes('gpt-4.1')) score += 55;
    if (label.includes('gemini') && label.includes('pro')) score += 50;
  }

  const inputCost = Number(model.cost?.input ?? 0);
  if (Number.isFinite(inputCost) && inputCost > 0) {
    score -= purpose === 'quick' ? Math.min(35, inputCost * 2) : Math.min(18, inputCost);
  }

  return score;
}

function sanitizeModelText(output: string): string {
  let text = output
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
  text = text.replace(/^```(?:markdown|md|text)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return text;
}

function usageToTokenUsage(usage: Usage | undefined): TokenUsageData | undefined {
  if (!usage) return undefined;
  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    cost: usage.cost.total,
  };
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function abortError(): Error {
  const err = new Error('Agent room run was cancelled.');
  err.name = 'AbortError';
  return err;
}
