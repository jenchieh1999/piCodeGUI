import type { IncomingMessage } from 'node:http';

export interface AuthProviderStatusData {
  id: string;
  name: string;
  configured: boolean;
  source?: string;
  label?: string;
  models: number;
  availableModels: number;
}

export interface AuthStatusResponse {
  providers: AuthProviderStatusData[];
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
  durationMs: number;
  message: string;
  error?: string;
}

export interface AuthHttpResponse {
  status: number;
  body: unknown;
}

const COMMON_AUTH_PROVIDERS = [
  'anthropic',
  'openai',
  'openai-codex',
  'google',
  'github-copilot',
  'openrouter',
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
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';

    if (!provider || !apiKey) {
      return json(400, { error: 'provider and apiKey are required.' });
    }

    const { AuthStorage } = await import('@earendil-works/pi-coding-agent');
    const authStorage = AuthStorage.create();
    authStorage.set(provider, { type: 'api_key', key: apiKey });
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
    const authStorage = AuthStorage.create();
    authStorage.remove(provider);
    return json(200, await getAuthStatus());
  }

  return null;
}

async function testAuthProvider(provider: string): Promise<AuthProviderTestResponse> {
  const startedAt = Date.now();
  const { AuthStorage, ModelRegistry } = await import('@earendil-works/pi-coding-agent');
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  await Promise.resolve(modelRegistry.refresh?.());

  const allModels = modelRegistry.getAll().filter((model) => model.provider === provider);
  const availableModels = modelRegistry.getAvailable().filter((model) => model.provider === provider);
  const status = modelRegistry.getProviderAuthStatus(provider);
  const base = {
    provider,
    name: modelRegistry.getProviderDisplayName(provider),
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

    const model = availableModels[0]!;
    const auth = await modelRegistry.getApiKeyAndHeaders(model);
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

    return finishAuthTest(startedAt, {
      ...base,
      ok: true,
      modelId: model.id,
      message: `Credentials resolved for ${provider}/${model.id}.`,
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
  const { AuthStorage, ModelRegistry } = await import('@earendil-works/pi-coding-agent');
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const allModels = modelRegistry.getAll();
  const availableModels = modelRegistry.getAvailable();
  const providerIds = Array.from(new Set(allModels.map((model) => model.provider)))
    .sort((a, b) => {
      const commonA = COMMON_AUTH_PROVIDER_ORDER.get(a) ?? Number.MAX_SAFE_INTEGER;
      const commonB = COMMON_AUTH_PROVIDER_ORDER.get(b) ?? Number.MAX_SAFE_INTEGER;
      if (commonA !== commonB) return commonA - commonB;
      return modelRegistry.getProviderDisplayName(a).localeCompare(modelRegistry.getProviderDisplayName(b));
    });

  const providers = providerIds
    .map<AuthProviderStatusData>((provider) => {
      const status = modelRegistry.getProviderAuthStatus(provider);
      return {
        id: provider,
        name: modelRegistry.getProviderDisplayName(provider),
        configured: status.configured,
        source: status.source,
        label: status.label,
        models: allModels.filter((model) => model.provider === provider).length,
        availableModels: availableModels.filter((model) => model.provider === provider).length,
      };
    });

  return { providers };
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
  return /^[a-zA-Z0-9._-]+$/.test(provider) ? provider : null;
}

function json(status: number, body: unknown): AuthHttpResponse {
  return { status, body };
}
