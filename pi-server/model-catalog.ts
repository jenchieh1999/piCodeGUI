import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ModelData, ProviderData } from './types.js';
import { getAgentDir, getAuthPath, getModelsPath } from './agent-paths.js';
import { getProviderDisplayName, normalizeProviderAlias } from './provider-metadata.js';

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

interface AgentSettingsDocument {
  defaultProvider?: unknown;
  defaultModel?: unknown;
  model?: unknown;
  env?: unknown;
}

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
        name: getProviderDisplayName(model.provider, modelRegistry.getProviderDisplayName(model.provider)),
        models: [],
      };
      providers.set(model.provider, provider);
    }

    if (provider.models.some((existing) => existing.id === model.id)) continue;
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
  const providerKey = normalizeProviderAlias(providerId);
  const targetId = normalizeProviderModelId(providerKey, modelId);
  const provider = providers.find((item) => normalizeProviderAlias(item.id) === providerKey);
  return provider?.models.find((model) => normalizeProviderModelId(model.provider, model.id) === targetId) ?? null;
}

export function firstModelInProviders(providers: ProviderData[]): ModelData | null {
  return providers.find((provider) => provider.models.length > 0)?.models[0] ?? null;
}

export function configuredDefaultModelInProviders(providers: ProviderData[], projectPath?: string): ModelData | null {
  const configured = readConfiguredModel(projectPath);
  if (!configured?.modelId) return null;

  const configuredModelId = configured.modelId;
  const provider = configured.provider ?? inferProviderFromModelId(configuredModelId);
  if (provider) {
    const model = findModelInProviders(providers, provider, configuredModelId);
    if (model) return model;
  }

  return providers
    .flatMap((item) => item.models)
    .find((model) => normalizeProviderModelId(model.provider, model.id) === normalizeProviderModelId(model.provider, configuredModelId))
    ?? null;
}

function toModelData(model: SdkModel): ModelData | null {
  const rawId = stringOrNull(model.id);
  const rawProvider = stringOrNull(model.provider);
  if (!rawId || !rawProvider) return null;

  const provider = normalizeProviderAlias(rawProvider);
  const id = normalizeProviderModelId(provider, rawId);

  return {
    id,
    name: normalizeProviderModelName(provider, stringOrNull(model.name), id),
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

export function normalizeProviderModelId(provider: string, modelId: string): string {
  const normalizedProvider = normalizeProviderAlias(provider);
  let normalizedModelId = modelId.trim();

  if (normalizedProvider === 'zai') {
    normalizedModelId = normalizedModelId.replace(/^(?:zai|z\.ai|z-ai|zhipu|zhipuai|bigmodel)\//i, '');
    if (/^glm-/i.test(normalizedModelId)) {
      normalizedModelId = normalizedModelId.toLowerCase();
    }
  }

  return normalizedModelId;
}

function normalizeProviderModelName(provider: string, name: string | null, modelId: string): string {
  if (normalizeProviderAlias(provider) === 'zai') return modelId;
  return name ?? modelId;
}

function readConfiguredModel(projectPath?: string): { provider?: string; modelId?: string } | null {
  const settings = mergeSettingsDocuments([
    readSettingsDocument(path.join(getAgentDir(), 'settings.json')),
    projectPath ? readSettingsDocument(path.join(resolveProjectPath(projectPath), '.pi', 'settings.json')) : null,
  ]);
  if (!settings) return null;

  const modelId = stringOrNull(settings.defaultModel)
    ?? stringOrNull(settings.model)
    ?? modelIdFromEnvSettings(settings.env);
  const provider = stringOrNull(settings.defaultProvider);
  return {
    provider: provider ? normalizeProviderAlias(provider) : undefined,
    modelId: modelId ? normalizeProviderModelId(provider ?? inferProviderFromModelId(modelId) ?? '', modelId) : undefined,
  };
}

function readSettingsDocument(filePath: string): AgentSettingsDocument | null {
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as AgentSettingsDocument : null;
  } catch {
    return null;
  }
}

function mergeSettingsDocuments(documents: Array<AgentSettingsDocument | null>): AgentSettingsDocument | null {
  const merged: AgentSettingsDocument = {};
  let hasSettings = false;

  for (const document of documents) {
    if (!document) continue;
    hasSettings = true;
    const previousEnv = isRecord(merged.env) ? merged.env : {};
    Object.assign(merged, document);
    if (isRecord(document.env)) {
      merged.env = {
        ...previousEnv,
        ...document.env,
      };
    }
  }

  return hasSettings ? merged : null;
}

function modelIdFromEnvSettings(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return stringOrNull(value.ANTHROPIC_DEFAULT_OPUS_MODEL)
    ?? stringOrNull(value.ANTHROPIC_DEFAULT_SONNET_MODEL)
    ?? stringOrNull(value.ANTHROPIC_DEFAULT_HAIKU_MODEL);
}

function inferProviderFromModelId(modelId: string): string | undefined {
  const normalized = modelId.trim().toLowerCase();
  if (/^(?:glm-|zai\/glm-|z\.ai\/glm-|z-ai\/glm-|zhipu\/glm-|zhipuai\/glm-|bigmodel\/glm-)/.test(normalized)) {
    return 'zai';
  }
  return undefined;
}

function resolveProjectPath(projectPath: string): string {
  if (!projectPath || projectPath === '.') return process.cwd();
  return path.isAbsolute(projectPath) ? projectPath : path.resolve(process.cwd(), projectPath);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
