import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import { getAuthPath, getModelsPath } from './agent-paths.js';
import { normalizeProviderModelId } from './model-catalog.js';
import {
  getProviderAliases,
  getProviderCredentialIds,
  getProviderDefaultBaseUrl,
  getProviderDisplayName,
  getProviderDocsUrl,
  normalizeProviderAlias,
} from './provider-metadata.js';

export interface AuthProviderStatusData {
  id: string;
  name: string;
  configured: boolean;
  source?: string;
  label?: string;
  baseUrl?: string;
  defaultBaseUrl?: string;
  aliases?: string[];
  docsUrl?: string;
  customConfig?: boolean;
  models: number;
  availableModels: number;
}

export interface AuthStatusResponse {
  providers: AuthProviderStatusData[];
  modelsJsonPath?: string;
  modelsJsonError?: string;
}

export interface AuthProviderTestResponse {
  provider: string;
  name: string;
  ok: boolean;
  configured: boolean;
  source?: string;
  label?: string;
  models: number;
  availableModels: number;
  modelId?: string;
  endpoint?: string;
  durationMs: number;
  message: string;
  error?: string;
}

export interface AuthHttpResponse {
  status: number;
  body: unknown;
}

interface ModelsJsonDocument {
  providers?: Record<string, unknown>;
  [key: string]: unknown;
}

interface ProviderModelsConfig {
  baseUrl?: string;
  [key: string]: unknown;
}

interface AuthTestModel {
  id: string;
  name?: string;
  provider: string;
  api?: string;
  baseUrl?: string;
}

interface ResolvedRequestAuth {
  ok: true;
  apiKey?: string;
  headers?: Record<string, string>;
}

const COMMON_AUTH_PROVIDERS = [
  'anthropic',
  'openai',
  'openai-codex',
  'google',
  'github-copilot',
  'openrouter',
  'zai',
  'deepseek',
  'xai',
  'groq',
  'mistral',
  'moonshotai',
  'moonshotai-cn',
];

const COMMON_AUTH_PROVIDER_ORDER = new Map(COMMON_AUTH_PROVIDERS.map((provider, index) => [provider, index]));

export async function handleAuthRequest(req: IncomingMessage): Promise<AuthHttpResponse | null> {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');

  if (url.pathname === '/api/auth/status' && method === 'GET') {
    return json(200, await getAuthStatus());
  }

  if (url.pathname === '/api/auth/api-key' && method === 'POST') {
    const body = await readJsonBody(req);
    const provider = normalizeProvider(body.provider);
    const apiKey = normalizeApiKey(body.apiKey);

    if (!provider || !apiKey) {
      return json(400, { error: 'provider and apiKey are required.' });
    }

    const { AuthStorage } = await import('@earendil-works/pi-coding-agent');
    const authStorage = AuthStorage.create(getAuthPath());
    authStorage.set(provider, { type: 'api_key', key: apiKey });
    for (const alias of getProviderCredentialIds(provider)) {
      if (alias !== provider) authStorage.remove(alias);
    }
    return json(200, await getAuthStatus());
  }

  if (url.pathname === '/api/auth/provider-config' && method === 'POST') {
    const body = await readJsonBody(req);
    const provider = normalizeProvider(body.provider);
    if (!provider) {
      return json(400, { error: 'provider is required.' });
    }

    setProviderBaseUrl(provider, normalizeProviderBaseUrl(provider, body.baseUrl));
    return json(200, await getAuthStatus());
  }

  if (url.pathname === '/api/auth/test' && method === 'POST') {
    const body = await readJsonBody(req);
    const provider = normalizeProvider(body.provider);
    if (!provider) {
      return json(400, { error: 'provider is required.' });
    }

    return json(200, await testAuthProvider(provider));
  }

  if (url.pathname === '/api/auth/api-key' && method === 'DELETE') {
    const provider = normalizeProvider(url.searchParams.get('provider'));
    if (!provider) {
      return json(400, { error: 'provider is required.' });
    }

    const { AuthStorage } = await import('@earendil-works/pi-coding-agent');
    const authStorage = AuthStorage.create(getAuthPath());
    for (const credentialId of getProviderCredentialIds(provider)) {
      authStorage.remove(credentialId);
    }
    return json(200, await getAuthStatus());
  }

  if (url.pathname === '/api/auth/provider-config' && method === 'DELETE') {
    const provider = normalizeProvider(url.searchParams.get('provider'));
    if (!provider) {
      return json(400, { error: 'provider is required.' });
    }

    removeProviderBaseUrl(provider);
    return json(200, await getAuthStatus());
  }

  return null;
}

async function testAuthProvider(provider: string): Promise<AuthProviderTestResponse> {
  const startedAt = Date.now();
  normalizeStoredProviderBaseUrlsSafe();
  const { AuthStorage, ModelRegistry } = await import('@earendil-works/pi-coding-agent');
  const authStorage = AuthStorage.create(getAuthPath());
  const modelRegistry = ModelRegistry.create(authStorage, getModelsPath());
  await Promise.resolve(modelRegistry.refresh?.());

  const allModels = modelRegistry.getAll().filter((model) => model.provider === provider);
  const availableModels = modelRegistry.getAvailable().filter((model) => model.provider === provider);
  const status = modelRegistry.getProviderAuthStatus(provider);
  const base = {
    provider,
    name: getProviderDisplayName(provider, modelRegistry.getProviderDisplayName(provider)),
    configured: status.configured,
    source: status.source,
    label: status.label,
    models: allModels.length,
    availableModels: availableModels.length,
    durationMs: 0,
  };

  try {
    if (allModels.length === 0) {
      return finishAuthTest(startedAt, {
        ...base,
        ok: false,
        message: 'No models are registered for this provider.',
      });
    }

    if (!status.configured || availableModels.length === 0) {
      return finishAuthTest(startedAt, {
        ...base,
        ok: false,
        message: 'No credentials are configured for this provider.',
      });
    }

    const selectedModel = pickAuthTestModel(availableModels, provider)!;
    const model = canonicalizeAuthTestModel(provider, selectedModel);
    const auth = await modelRegistry.getApiKeyAndHeaders(selectedModel);
    if (!auth.ok) {
      return finishAuthTest(startedAt, {
        ...base,
        ok: false,
        modelId: model.id,
        message: auth.error,
        error: auth.error,
      });
    }

    if (!auth.apiKey && !auth.headers) {
      return finishAuthTest(startedAt, {
        ...base,
        ok: false,
        modelId: model.id,
        message: 'Credentials resolved, but no API key or request headers were returned.',
      });
    }

    const liveTest = shouldRunLiveProviderTest(provider, model)
      ? await testOpenAIChatCompletionsProvider(provider, model, auth)
      : null;

    return finishAuthTest(startedAt, {
      ...base,
      ok: true,
      modelId: model.id,
      endpoint: liveTest?.endpoint,
      message: liveTest?.message ?? `Credentials resolved for ${provider}/${model.id}.`,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return finishAuthTest(startedAt, {
      ...base,
      ok: false,
      message: error,
      error,
    });
  }
}

function pickAuthTestModel<T extends { id: string; provider?: string }>(models: T[], provider: string): T | undefined {
  return models.find((model) => normalizeProviderModelId(model.provider ?? provider, model.id) === 'glm-5.1')
    ?? models.find((model) => normalizeProviderModelId(model.provider ?? provider, model.id) === 'glm-5-turbo')
    ?? models[0];
}

function canonicalizeAuthTestModel<T extends AuthTestModel>(provider: string, model: T): T {
  const normalizedProvider = model.provider || provider;
  const normalizedId = normalizeProviderModelId(normalizedProvider, model.id);
  if (normalizedProvider === model.provider && normalizedId === model.id) return model;
  return {
    ...model,
    provider: normalizedProvider,
    id: normalizedId,
    name: normalizedProvider === 'zai' ? normalizedId : model.name,
  };
}

function shouldRunLiveProviderTest(provider: string, model: AuthTestModel): boolean {
  return provider === 'zai' && model.api === 'openai-completions' && Boolean(model.baseUrl);
}

async function testOpenAIChatCompletionsProvider(
  provider: string,
  model: AuthTestModel,
  auth: ResolvedRequestAuth
): Promise<{ endpoint: string; message: string }> {
  const endpoint = `${normalizeEndpointBaseUrl(model.baseUrl!)}/chat/completions`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(auth.headers ?? {}),
    };
    if (auth.apiKey && !hasAuthorizationHeader(headers)) {
      headers.Authorization = `Bearer ${stripBearerPrefix(auth.apiKey)}`;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: model.id,
        messages: [{ role: 'user', content: 'ping' }],
        stream: false,
        max_tokens: 8,
      }),
      signal: controller.signal,
    });
    const text = await response.text();

    if (!response.ok) {
      const detail = summarizeProviderResponse(text, auth.apiKey);
      throw new Error(`${provider}/${model.id} live test failed: HTTP ${response.status}${detail ? ` - ${detail}` : ''}`);
    }

    return {
      endpoint,
      message: `Live request succeeded for ${provider}/${model.id}.`,
    };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`${provider}/${model.id} live test timed out after 15s.`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function hasAuthorizationHeader(headers: Record<string, string>): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === 'authorization');
}

function summarizeProviderResponse(text: string, apiKey?: string): string {
  if (!text.trim()) return '';
  const redacted = redactSecret(text.trim(), apiKey);
  try {
    const parsed = JSON.parse(redacted) as unknown;
    const message = providerErrorMessage(parsed);
    if (message) return message;
  } catch {
    // Fall back to a compact raw body below.
  }
  return redacted.length > 360 ? `${redacted.slice(0, 360)}...` : redacted;
}

function providerErrorMessage(value: unknown): string | null {
  const object = objectValue(value);
  if (!object) return null;
  const error = objectValue(object.error);
  if (error) {
    const message = stringValue(error.message) ?? stringValue(error.msg) ?? stringValue(error.code);
    if (message) return message;
  }
  return stringValue(object.message) ?? stringValue(object.msg) ?? null;
}

function redactSecret(text: string, secret?: string): string {
  const cleanSecret = secret ? stripBearerPrefix(secret).trim() : '';
  if (!cleanSecret) return text;
  return text.split(cleanSecret).join('[REDACTED]');
}

function finishAuthTest<T extends AuthProviderTestResponse>(
  startedAt: number,
  result: Omit<T, 'durationMs'> & { durationMs?: number }
): T {
  return {
    ...result,
    durationMs: Date.now() - startedAt,
  } as T;
}

async function getAuthStatus(): Promise<AuthStatusResponse> {
  const normalizationError = normalizeStoredProviderBaseUrlsSafe();
  const { AuthStorage, ModelRegistry } = await import('@earendil-works/pi-coding-agent');
  const authStorage = AuthStorage.create(getAuthPath());
  const modelRegistry = ModelRegistry.create(authStorage, getModelsPath());
  await Promise.resolve(modelRegistry.refresh?.());
  const allModels = modelRegistry.getAll();
  const availableModels = modelRegistry.getAvailable();
  const modelsJson = readModelsJsonSafe();
  const configuredProviders = providerConfigsFromDocument(modelsJson.document);
  const providerIds = Array.from(new Set(allModels.map((model) => model.provider)))
    .sort((a, b) => {
      const commonA = COMMON_AUTH_PROVIDER_ORDER.get(a) ?? Number.MAX_SAFE_INTEGER;
      const commonB = COMMON_AUTH_PROVIDER_ORDER.get(b) ?? Number.MAX_SAFE_INTEGER;
      if (commonA !== commonB) return commonA - commonB;
      return getProviderDisplayName(a, modelRegistry.getProviderDisplayName(a))
        .localeCompare(getProviderDisplayName(b, modelRegistry.getProviderDisplayName(b)));
    });

  const providers = providerIds
    .map<AuthProviderStatusData>((provider) => {
      const status = modelRegistry.getProviderAuthStatus(provider);
      const providerConfig = configuredProviders.get(provider);
      const providerModels = allModels.filter((model) => model.provider === provider);
      const defaultBaseUrl = defaultBaseUrlFromModels(provider, providerModels);
      return {
        id: provider,
        name: getProviderDisplayName(provider, modelRegistry.getProviderDisplayName(provider)),
        configured: status.configured,
        source: status.source,
        label: status.label,
        baseUrl: providerConfig?.baseUrl,
        defaultBaseUrl,
        aliases: getProviderAliases(provider),
        docsUrl: getProviderDocsUrl(provider),
        customConfig: Boolean(providerConfig),
        models: providerModels.length,
        availableModels: availableModels.filter((model) => model.provider === provider).length,
      };
    });

  const loadError = normalizationError ?? modelsJson.error ?? modelRegistry.getError?.();
  return {
    providers,
    modelsJsonPath: getModelsPath(),
    modelsJsonError: loadError || undefined,
  };
}

function setProviderBaseUrl(provider: string, baseUrl: string | undefined): void {
  const document = readModelsJsonForWrite();
  const providers = ensureProvidersObject(document);
  const current = objectValue(providers[provider]) ?? {};

  if (baseUrl) {
    current.baseUrl = baseUrl;
    providers[provider] = current;
  } else {
    delete current.baseUrl;
    if (Object.keys(current).length > 0) {
      providers[provider] = current;
    } else {
      delete providers[provider];
    }
  }

  writeModelsJson(document);
}

function removeProviderBaseUrl(provider: string): void {
  setProviderBaseUrl(provider, undefined);
}

function normalizeStoredProviderBaseUrlsSafe(): string | undefined {
  try {
    const safe = readModelsJsonSafe();
    if (safe.error) return safe.error;
    const document = safe.document;
    const providers = objectValue(document.providers);
    if (!providers) return undefined;

    let changed = false;
    for (const [provider, rawConfig] of Object.entries(providers)) {
      const config = objectValue(rawConfig);
      if (!config || typeof config.baseUrl !== 'string') continue;
      const normalized = normalizeProviderBaseUrl(provider, config.baseUrl);
      if (normalized && normalized !== config.baseUrl) {
        config.baseUrl = normalized;
        changed = true;
      }
    }

    if (changed) writeModelsJson(document);
    return undefined;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

function readModelsJsonSafe(): { document: ModelsJsonDocument; error?: string } {
  const filePath = getModelsPath();
  if (!existsSync(filePath)) return { document: { providers: {} } };

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    return {
      document: objectValue(parsed) ?? { providers: {} },
    };
  } catch (err) {
    return {
      document: { providers: {} },
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function readModelsJsonForWrite(): ModelsJsonDocument {
  const safe = readModelsJsonSafe();
  if (safe.error) {
    throw new Error(`models.json is not valid JSON: ${safe.error}`);
  }
  return safe.document;
}

function writeModelsJson(document: ModelsJsonDocument): void {
  const filePath = getModelsPath();
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
}

function ensureProvidersObject(document: ModelsJsonDocument): Record<string, unknown> {
  const providers = objectValue(document.providers);
  if (providers) return providers;
  const next: Record<string, unknown> = {};
  document.providers = next;
  return next;
}

function providerConfigsFromDocument(document: ModelsJsonDocument): Map<string, ProviderModelsConfig> {
  const providers = objectValue(document.providers);
  const configs = new Map<string, ProviderModelsConfig>();
  if (!providers) return configs;

  for (const [provider, rawConfig] of Object.entries(providers)) {
    const config = objectValue(rawConfig);
    if (!config) continue;
    const baseUrl = typeof config.baseUrl === 'string' && config.baseUrl.trim() ? config.baseUrl.trim() : undefined;
    configs.set(provider, {
      ...config,
      baseUrl,
    });
  }

  return configs;
}

function normalizeBaseUrl(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new Error('baseUrl must be a string.');
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const withProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withProtocol);
  } catch {
    throw new Error('baseUrl must be a valid URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('baseUrl must use http or https.');
  }

  if (url.protocol === 'http:' && !isLoopbackHostname(url.hostname) && process.env.PI_AGENT_ALLOW_INSECURE_MODEL_ENDPOINTS !== '1') {
    throw new Error('baseUrl must use https for remote endpoints. HTTP is allowed only for localhost/127.0.0.1 unless PI_AGENT_ALLOW_INSECURE_MODEL_ENDPOINTS=1 is set.');
  }

  const normalized = normalizeEndpointBaseUrl(url.toString());
  return normalized;
}

function normalizeProviderBaseUrl(provider: string, value: unknown): string | undefined {
  const normalized = normalizeBaseUrl(value);
  if (!normalized) return undefined;
  return normalizeZaiCodingBaseUrl(provider, normalized);
}

function normalizeZaiCodingBaseUrl(provider: string, baseUrl: string): string {
  if (normalizeProviderAlias(provider) !== 'zai') return baseUrl;

  const url = new URL(baseUrl);
  const pathName = url.pathname.replace(/\/+$/, '');
  if (pathName === '/api/paas/v4') {
    url.pathname = '/api/coding/paas/v4';
    return normalizeEndpointBaseUrl(url.toString());
  }

  return baseUrl;
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('Request body is too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON body.'));
      }
    });
    req.on('error', reject);
  });
}

function normalizeProvider(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const provider = value.trim();
  const normalized = normalizeProviderAlias(provider);
  if (normalized !== provider) return normalized;
  return /^[a-zA-Z0-9._-]+$/.test(provider) ? normalized : null;
}

function normalizeApiKey(value: unknown): string {
  if (typeof value !== 'string') return '';
  return stripBearerPrefix(value.trim());
}

function stripBearerPrefix(value: string): string {
  return value.replace(/^Bearer\s+/i, '').trim();
}

function normalizeEndpointBaseUrl(value: string): string {
  let normalized = value.trim().replace(/\/+$/, '');
  normalized = normalized.replace(/\/chat\/completions$/i, '');
  return normalized.replace(/\/+$/, '');
}

function defaultBaseUrlFromModels(provider: string, models: Array<{ baseUrl?: unknown }>): string | undefined {
  const fallback = models.map((model) => stringValue(model.baseUrl)).find((value): value is string => Boolean(value));
  return getProviderDefaultBaseUrl(provider, fallback);
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function json(status: number, body: unknown): AuthHttpResponse {
  return { status, body };
}
