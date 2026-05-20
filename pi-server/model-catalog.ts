import type { ModelData, ProviderData } from './types.js';
import { getAuthPath, getModelsPath } from './agent-paths.js';

type SdkModel = {
  id?: unknown;
  name?: unknown;
  provider?: unknown;
  reasoning?: unknown;
  contextWindow?: unknown;
  maxTokens?: unknown;
  cost?: {
    input?: unknown;
    output?: unknown;
    cacheRead?: unknown;
    cacheWrite?: unknown;
  };
};

export async function getAvailableSdkProviders(): Promise<ProviderData[]> {
  const { AuthStorage, ModelRegistry } = await import('@earendil-works/pi-coding-agent');
  const authStorage = AuthStorage.create(getAuthPath());
  const modelRegistry = ModelRegistry.create(authStorage, getModelsPath());
  await Promise.resolve(modelRegistry.refresh?.());

  const providers = new Map<string, ProviderData>();
  for (const rawModel of modelRegistry.getAvailable() as SdkModel[]) {
    const model = toModelData(rawModel);
    if (!model) continue;

    let provider = providers.get(model.provider);
    if (!provider) {
      provider = {
        id: model.provider,
        name: modelRegistry.getProviderDisplayName(model.provider),
        models: [],
      };
      providers.set(model.provider, provider);
    }
    provider.models.push(model);
  }

  return Array.from(providers.values())
    .map((provider) => ({
      ...provider,
      models: provider.models.sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function findModelInProviders(
  providers: ProviderData[],
  providerId: string,
  modelId: string
): ModelData | null {
  return providers.find((provider) => provider.id === providerId)?.models.find((model) => model.id === modelId) ?? null;
}

export function firstModelInProviders(providers: ProviderData[]): ModelData | null {
  return providers.find((provider) => provider.models.length > 0)?.models[0] ?? null;
}

function toModelData(model: SdkModel): ModelData | null {
  const id = stringOrNull(model.id);
  const provider = stringOrNull(model.provider);
  if (!id || !provider) return null;

  return {
    id,
    name: stringOrNull(model.name) ?? id,
    provider,
    reasoning: Boolean(model.reasoning),
    contextWindow: numberOrZero(model.contextWindow),
    maxTokens: numberOrZero(model.maxTokens),
    cost: {
      input: numberOrZero(model.cost?.input),
      output: numberOrZero(model.cost?.output),
      cacheRead: numberOrZero(model.cost?.cacheRead),
      cacheWrite: numberOrZero(model.cost?.cacheWrite),
    },
  };
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
