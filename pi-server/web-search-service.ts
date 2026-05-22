import type { IncomingMessage } from 'node:http';
import type { Api, Model } from '@earendil-works/pi-ai';
import { getAuthPath, getModelsPath } from './agent-paths.js';
import { normalizeProviderModelId } from './model-catalog.js';
import { getProviderDefaultBaseUrl, normalizeProviderAlias } from './provider-metadata.js';

type DedicatedWebSearchProviderData = 'tavily' | 'brave' | 'exa';
type ModelWebSearchProviderData = 'zai' | 'openai';
export type WebSearchProviderData = DedicatedWebSearchProviderData | ModelWebSearchProviderData;
type WebSearchProviderRequestData = WebSearchProviderData | 'auto';

export interface WebSearchResultData {
  provider: WebSearchProviderData;
  title: string;
  url: string;
  snippet: string;
  content?: string;
  publishedDate?: string;
  score?: number;
}

export interface WebSearchStatusData {
  enabled: boolean;
  provider?: WebSearchProviderData;
  configuredProviders: WebSearchProviderData[];
  message: string;
}

export interface WebSearchHttpResponse {
  status: number;
  body: unknown;
}

interface WebSearchInput {
  query: string;
  provider?: WebSearchProviderRequestData;
  maxResults?: number;
  signal?: AbortSignal;
}

type SdkModel = Model<Api> & { api?: string; baseUrl?: string };

interface ModelSearchProvider {
  provider: ModelWebSearchProviderData;
  model: SdkModel;
  apiKey?: string;
  headers: Record<string, string>;
  baseUrl?: string;
}

class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

const DEDICATED_WEB_SEARCH_PROVIDERS: DedicatedWebSearchProviderData[] = ['tavily', 'brave', 'exa'];
const MODEL_WEB_SEARCH_PROVIDERS: ModelWebSearchProviderData[] = ['zai', 'openai'];
const WEB_SEARCH_PROVIDERS: WebSearchProviderData[] = [...DEDICATED_WEB_SEARCH_PROVIDERS, ...MODEL_WEB_SEARCH_PROVIDERS];
const DEFAULT_WEB_SEARCH_TIMEOUT_MS = 12_000;
const DEFAULT_MODEL_WEB_SEARCH_TIMEOUT_MS = 24_000;

export async function handleWebSearchRequest(req: IncomingMessage): Promise<WebSearchHttpResponse | null> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/api/web-search/status' && req.method === 'GET') {
    return { status: 200, body: await getWebSearchStatus() };
  }

  if (url.pathname === '/api/web-search/search' && req.method === 'POST') {
    const body = await readJsonBody<Partial<WebSearchInput>>(req);
    const results = await searchWeb({
      query: normalizeString(body.query),
      provider: normalizeProvider(body.provider),
      maxResults: clampMaxResults(body.maxResults),
    });
    return { status: 200, body: { results, status: await getWebSearchStatus() } };
  }

  return null;
}

export async function getWebSearchStatus(): Promise<WebSearchStatusData> {
  if (webSearchDisabled()) {
    return {
      enabled: false,
      configuredProviders: [],
      message: 'Web search is disabled by PI_AGENT_WEB_SEARCH_DISABLED.',
    };
  }

  const configuredProviders = await configuredWebSearchProviders();
  const candidates = await selectProviderCandidates();
  const provider = candidates[0];
  return {
    enabled: Boolean(provider),
    provider,
    configuredProviders,
    message: provider
      ? `Web search is configured with ${provider}.`
      : configuredProviders.length > 0
        ? 'Configured web search providers exist, but PI_AGENT_WEB_SEARCH_PROVIDER selects an unavailable provider.'
        : 'Configure Tavily/Brave/Exa search keys, or configure Zhipu/OpenAI model credentials to use provider-native web search.',
  };
}

export async function searchWeb(input: WebSearchInput): Promise<WebSearchResultData[]> {
  const query = normalizeString(input.query);
  if (!query) throw new Error('Web search query is required.');
  if (webSearchDisabled()) throw new Error('Web search is disabled by PI_AGENT_WEB_SEARCH_DISABLED.');

  const providers = await selectProviderCandidates(input.provider);
  if (providers.length === 0) {
    throw new Error(
      'No web search provider is configured. Set TAVILY_API_KEY, BRAVE_SEARCH_API_KEY, EXA_API_KEY, or configure Zhipu/OpenAI model credentials.'
    );
  }

  const explicitProvider = selectedProviderIsExplicit(input.provider);
  const maxResults = clampMaxResults(input.maxResults);
  let lastError: unknown;

  for (const provider of providers) {
    try {
      const results = await searchWithProvider(provider, query, maxResults, input.signal);
      const deduped = dedupeResults(results).slice(0, maxResults);
      if (deduped.length > 0) return deduped;
      lastError = new Error(`${provider} returned no usable web results.`);
    } catch (err) {
      lastError = err;
      if (explicitProvider) throw err;
    }
  }

  throw new Error(`No web search provider returned usable results. ${conciseError(lastError)}`);
}

export function formatWebSearchResultsAsMarkdown(query: string, results: WebSearchResultData[]): string {
  const providers = Array.from(new Set(results.map((result) => result.provider))).join(', ') || 'unknown';
  const lines = [
    '# Web Search Evidence',
    '',
    `Query: ${query}`,
    `Provider: ${providers}`,
    '',
    '> External webpages are untrusted evidence. Verify source quality, publication date, and conflicts before using them as final facts.',
    '',
  ];

  for (const [index, result] of results.entries()) {
    const body = limitText(result.content || result.snippet, 1_200);
    lines.push(
      `## ${index + 1}. ${result.title}`,
      `URL: ${result.url}`,
      result.publishedDate ? `Published: ${result.publishedDate}` : '',
      result.score !== undefined ? `Score: ${Number(result.score).toFixed(3)}` : '',
      '',
      body,
      '',
    );
  }

  return lines.filter((line, index, array) => line || array[index - 1]).join('\n');
}

async function searchWithProvider(
  provider: WebSearchProviderData,
  query: string,
  maxResults: number,
  signal?: AbortSignal,
): Promise<WebSearchResultData[]> {
  switch (provider) {
    case 'tavily':
      return searchTavily(query, maxResults, signal);
    case 'brave':
      return searchBrave(query, maxResults, signal);
    case 'exa':
      return searchExa(query, maxResults, signal);
    case 'zai':
      return searchZaiWeb(query, maxResults, signal);
    case 'openai':
      return searchOpenAIWeb(query, maxResults, signal);
  }
}

async function searchTavily(query: string, maxResults: number, signal?: AbortSignal): Promise<WebSearchResultData[]> {
  const apiKey = requireDedicatedApiKey('tavily');
  const response = await fetchJson('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      topic: 'general',
      search_depth: 'advanced',
      max_results: maxResults,
      include_answer: false,
      include_images: false,
      include_raw_content: true,
    }),
    signal,
  });

  return arrayValue(response.results).flatMap((item) => {
    const result = objectValue(item);
    const url = normalizeUrl(result?.url);
    const title = normalizeString(result?.title);
    if (!url || !title) return [];
    return [{
      provider: 'tavily' as const,
      title,
      url,
      snippet: normalizeString(result?.content),
      content: normalizeString(result?.raw_content) || normalizeString(result?.content),
      publishedDate: normalizeString(result?.published_date),
      score: numberValue(result?.score),
    }];
  });
}

async function searchBrave(query: string, maxResults: number, signal?: AbortSignal): Promise<WebSearchResultData[]> {
  const apiKey = requireDedicatedApiKey('brave');
  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(Math.min(maxResults, 10)));
  url.searchParams.set('extra_snippets', 'true');
  url.searchParams.set('safesearch', 'moderate');

  const response = await fetchJson(url.toString(), {
    headers: {
      Accept: 'application/json',
      'X-Subscription-Token': apiKey,
    },
    signal,
  });

  const web = objectValue(response.web);
  return arrayValue(web?.results).flatMap((item) => {
    const result = objectValue(item);
    const url = normalizeUrl(result?.url);
    const title = normalizeString(result?.title);
    if (!url || !title) return [];
    const snippets = [normalizeString(result?.description), ...arrayValue(result?.extra_snippets).map(normalizeString)]
      .filter(Boolean);
    return [{
      provider: 'brave' as const,
      title,
      url,
      snippet: snippets.join('\n'),
      content: snippets.join('\n'),
      publishedDate: normalizeString(result?.age),
    }];
  });
}

async function searchExa(query: string, maxResults: number, signal?: AbortSignal): Promise<WebSearchResultData[]> {
  const apiKey = requireDedicatedApiKey('exa');
  const response = await fetchJson('https://api.exa.ai/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    body: JSON.stringify({
      query,
      numResults: maxResults,
      contents: {
        text: true,
        highlights: true,
      },
    }),
    signal,
  });

  return arrayValue(response.results).flatMap((item) => {
    const result = objectValue(item);
    const url = normalizeUrl(result?.url);
    const title = normalizeString(result?.title);
    if (!url || !title) return [];
    const highlights = arrayValue(result?.highlights).map(normalizeString).filter(Boolean).join('\n');
    const text = normalizeString(result?.text);
    return [{
      provider: 'exa' as const,
      title,
      url,
      snippet: highlights || text,
      content: text || highlights,
      publishedDate: normalizeString(result?.publishedDate),
      score: numberValue(result?.score),
    }];
  });
}

async function searchZaiWeb(query: string, maxResults: number, signal?: AbortSignal): Promise<WebSearchResultData[]> {
  const modelProvider = await resolveModelSearchProvider('zai');
  if (!modelProvider) throw new Error('Zhipu AI model credentials are not configured.');

  const body = {
    search_engine: process.env.PI_AGENT_ZAI_WEB_SEARCH_ENGINE?.trim() || 'search_std',
    search_query: query,
    count: maxResults,
    search_recency_filter: process.env.PI_AGENT_ZAI_WEB_SEARCH_RECENCY?.trim() || 'noLimit',
    content_size: process.env.PI_AGENT_ZAI_WEB_SEARCH_CONTENT_SIZE?.trim() || 'medium',
  };

  const endpoints = zaiWebSearchEndpoints(modelProvider.baseUrl);
  let lastError: unknown;
  for (const endpoint of endpoints) {
    try {
      const response = await fetchJson(endpoint, {
        method: 'POST',
        headers: jsonAuthHeaders(modelProvider),
        body: JSON.stringify(body),
        signal,
      }, modelSearchTimeoutMs());
      return extractZaiWebResults(response, maxResults);
    } catch (err) {
      lastError = err;
      if (!shouldTryNextZaiEndpoint(err)) throw err;
    }
  }

  try {
    return await searchZaiChatTool(query, maxResults, modelProvider, signal);
  } catch (err) {
    throw new Error(`Zhipu AI web search failed. ${conciseError(err)} ${conciseError(lastError)}`.trim());
  }
}

async function searchZaiChatTool(
  query: string,
  maxResults: number,
  modelProvider: ModelSearchProvider,
  signal?: AbortSignal,
): Promise<WebSearchResultData[]> {
  const endpoint = `${normalizeEndpointBaseUrl(modelProvider.baseUrl || getProviderDefaultBaseUrl('zai') || 'https://open.bigmodel.cn/api/coding/paas/v4')}/chat/completions`;
  const response = await fetchJson(endpoint, {
    method: 'POST',
    headers: jsonAuthHeaders(modelProvider),
    body: JSON.stringify({
      model: normalizeProviderModelId('zai', String(modelProvider.model.id ?? 'glm-4.5-air')),
      messages: [
        {
          role: 'system',
          content: 'Use web search to collect current external evidence. Return concise findings with source URLs.',
        },
        {
          role: 'user',
          content: buildSearchPrompt(query, maxResults),
        },
      ],
      tools: [{
        type: 'web_search',
        web_search: {
          search_engine: process.env.PI_AGENT_ZAI_WEB_SEARCH_ENGINE?.trim() || 'search_std',
          search_result: true,
        },
      }],
      temperature: 0.1,
      max_tokens: 1800,
    }),
    signal,
  }, modelSearchTimeoutMs());

  const structured = extractZaiWebResults(response, maxResults);
  if (structured.length > 0) return structured;

  const text = extractChatCompletionText(response);
  const urls = extractUrls(text);
  return urls.slice(0, maxResults).map((url, index) => ({
    provider: 'zai' as const,
    title: titleFromUrl(url, `Zhipu web result ${index + 1}`),
    url,
    snippet: snippetAroundUrl(text, url),
    content: text,
  }));
}

async function searchOpenAIWeb(query: string, maxResults: number, signal?: AbortSignal): Promise<WebSearchResultData[]> {
  const modelProvider = await resolveModelSearchProvider('openai');
  if (!modelProvider) throw new Error('OpenAI model credentials are not configured.');

  const endpoint = `${normalizeEndpointBaseUrl(modelProvider.baseUrl || 'https://api.openai.com/v1')}/responses`;
  const toolTypes = Array.from(new Set([
    process.env.PI_AGENT_OPENAI_WEB_SEARCH_TOOL?.trim() || 'web_search',
    'web_search_preview',
  ].filter(Boolean)));
  let lastError: unknown;

  for (const toolType of toolTypes) {
    try {
      const response = await fetchJson(endpoint, {
        method: 'POST',
        headers: jsonAuthHeaders(modelProvider),
        body: JSON.stringify({
          model: String(modelProvider.model.id ?? process.env.PI_AGENT_OPENAI_WEB_SEARCH_MODEL ?? 'gpt-4.1-mini'),
          input: buildSearchPrompt(query, maxResults),
          tools: [{ type: toolType }],
          max_output_tokens: 1800,
        }),
        signal,
      }, modelSearchTimeoutMs());
      return extractOpenAIWebResults(response, maxResults);
    } catch (err) {
      lastError = err;
      if (!(err instanceof HttpError) || err.status !== 400) throw err;
    }
  }

  throw new Error(`OpenAI web search failed. ${conciseError(lastError)}`);
}

async function fetchJson(
  url: string,
  init: RequestInit & { signal?: AbortSignal },
  timeoutMs = DEFAULT_WEB_SEARCH_TIMEOUT_MS,
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();

  if (init.signal?.aborted) controller.abort();
  init.signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new HttpError(response.status, `HTTP ${response.status}: ${limitText(text, 300)}`);
    }
    const parsed = text ? JSON.parse(text) : {};
    return objectValue(parsed) ?? {};
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', abort);
  }
}

async function configuredWebSearchProviders(): Promise<WebSearchProviderData[]> {
  return [
    ...DEDICATED_WEB_SEARCH_PROVIDERS.filter((provider) => Boolean(dedicatedApiKeyFor(provider))),
    ...await configuredModelWebSearchProviders(),
  ];
}

async function configuredModelWebSearchProviders(): Promise<ModelWebSearchProviderData[]> {
  const providers: ModelWebSearchProviderData[] = [];
  for (const provider of MODEL_WEB_SEARCH_PROVIDERS) {
    if (await resolveModelSearchProvider(provider).catch(() => null)) providers.push(provider);
  }
  return providers;
}

async function selectProviderCandidates(requested?: WebSearchProviderRequestData): Promise<WebSearchProviderData[]> {
  const preferred = normalizeProvider(requested) ?? normalizeProvider(process.env.PI_AGENT_WEB_SEARCH_PROVIDER);
  const configured = await configuredWebSearchProviders();

  if (preferred && preferred !== 'auto') {
    return configured.includes(preferred) ? [preferred] : [];
  }

  return configured;
}

function selectedProviderIsExplicit(requested?: WebSearchProviderRequestData): boolean {
  const provider = normalizeProvider(requested) ?? normalizeProvider(process.env.PI_AGENT_WEB_SEARCH_PROVIDER);
  return Boolean(provider && provider !== 'auto');
}

async function resolveModelSearchProvider(provider: ModelWebSearchProviderData): Promise<ModelSearchProvider | null> {
  const { AuthStorage, ModelRegistry } = await import('@earendil-works/pi-coding-agent');
  const authStorage = AuthStorage.create(getAuthPath());
  const modelRegistry = ModelRegistry.create(authStorage, getModelsPath());
  await Promise.resolve(modelRegistry.refresh?.());

  const models = (modelRegistry.getAvailable() as SdkModel[]).filter((model) => modelSupportsText(model));
  const model = provider === 'zai' ? selectZaiModel(models) : selectOpenAIModel(models);
  if (!model) return null;

  const auth = await modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok || (!auth.apiKey && !auth.headers)) return null;

  const headers = normalizeHeaders(auth.headers);
  if (typeof auth.apiKey === 'string' && auth.apiKey.trim() && !hasAuthorizationHeader(headers)) {
    headers.Authorization = `Bearer ${stripBearerPrefix(auth.apiKey)}`;
  }

  return {
    provider,
    model,
    apiKey: typeof auth.apiKey === 'string' ? auth.apiKey : undefined,
    headers,
    baseUrl: normalizeString(model.baseUrl),
  };
}

function selectZaiModel(models: SdkModel[]): SdkModel | null {
  return selectModelByEnv(models, 'zai', process.env.PI_AGENT_WEB_SEARCH_ZAI_MODEL ?? process.env.PI_AGENT_WEB_SEARCH_MODEL)
    ?? models
      .filter((model) => normalizeProviderAlias(String(model.provider ?? '')) === 'zai')
      .sort((a, b) => scoreZaiModel(b) - scoreZaiModel(a))[0]
    ?? null;
}

function selectOpenAIModel(models: SdkModel[]): SdkModel | null {
  const explicit = selectModelByEnv(models, 'openai', process.env.PI_AGENT_WEB_SEARCH_OPENAI_MODEL ?? process.env.PI_AGENT_WEB_SEARCH_MODEL);
  if (explicit) return explicit;

  return models
    .filter((model) => isOfficialOpenAIModel(model))
    .sort((a, b) => scoreOpenAIModel(b) - scoreOpenAIModel(a))[0]
    ?? null;
}

function selectModelByEnv(models: SdkModel[], provider: string, value: string | undefined): SdkModel | null {
  const raw = value?.trim();
  if (!raw) return null;

  const slashIndex = raw.indexOf('/');
  const envProvider = slashIndex > 0 ? normalizeProviderAlias(raw.slice(0, slashIndex)) : provider;
  const envModel = slashIndex > 0 ? raw.slice(slashIndex + 1) : raw;
  const target = normalizeProviderModelId(envProvider, envModel).toLowerCase();

  return models.find((model) => {
    const modelProvider = normalizeProviderAlias(String(model.provider ?? ''));
    const modelId = normalizeProviderModelId(modelProvider, String(model.id ?? '')).toLowerCase();
    return modelProvider === envProvider && modelId === target;
  }) ?? null;
}

function modelSupportsText(model: SdkModel): boolean {
  return arrayValue(model.input).map(normalizeString).includes('text');
}

function isOfficialOpenAIModel(model: SdkModel): boolean {
  const provider = normalizeProviderAlias(String(model.provider ?? ''));
  const baseUrl = normalizeString(model.baseUrl).toLowerCase();
  return provider === 'openai' || baseUrl.includes('api.openai.com');
}

function scoreZaiModel(model: SdkModel): number {
  const label = `${String(model.id ?? '')} ${String(model.name ?? '')}`.toLowerCase();
  if (label.includes('glm-5.1')) return 100;
  if (label.includes('glm-5')) return 90;
  if (label.includes('glm-4.7')) return 80;
  if (label.includes('glm-4.5-air')) return 70;
  return 10;
}

function scoreOpenAIModel(model: SdkModel): number {
  const label = `${String(model.id ?? '')} ${String(model.name ?? '')}`.toLowerCase();
  if (label.includes('gpt-5')) return 100;
  if (label.includes('gpt-4.1')) return 90;
  if (label.includes('gpt-4o')) return 75;
  if (label.includes('mini')) return 8;
  return 10;
}

function requireDedicatedApiKey(provider: DedicatedWebSearchProviderData): string {
  const key = dedicatedApiKeyFor(provider);
  if (!key) throw new Error(`${provider} web search API key is not configured.`);
  return key;
}

function dedicatedApiKeyFor(provider: DedicatedWebSearchProviderData): string {
  const candidates = provider === 'tavily'
    ? ['PI_AGENT_TAVILY_API_KEY', 'TAVILY_API_KEY']
    : provider === 'brave'
      ? ['PI_AGENT_BRAVE_SEARCH_API_KEY', 'BRAVE_SEARCH_API_KEY']
      : ['PI_AGENT_EXA_API_KEY', 'EXA_API_KEY'];
  for (const name of candidates) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return '';
}

function normalizeProvider(value: unknown): WebSearchProviderRequestData | undefined {
  const provider = normalizeString(value).toLowerCase();
  if (provider === 'auto') return 'auto';
  if (provider === 'zhipu' || provider === 'zhipuai' || provider === 'bigmodel' || provider === 'glm') return 'zai';
  if (provider === 'openai-responses') return 'openai';
  return WEB_SEARCH_PROVIDERS.includes(provider as WebSearchProviderData) ? provider as WebSearchProviderData : undefined;
}

function extractZaiWebResults(response: Record<string, unknown>, maxResults: number): WebSearchResultData[] {
  const candidates = [
    response.search_result,
    response.search_results,
    response.results,
    objectValue(response.data)?.search_result,
    objectValue(response.data)?.search_results,
    objectValue(response.data)?.results,
  ];

  return candidates
    .flatMap(arrayValue)
    .flatMap((item) => {
      const result = objectValue(item);
      const url = normalizeUrl(result?.url) || normalizeUrl(result?.link);
      const title = normalizeString(result?.title) || titleFromUrl(url, 'Zhipu web result');
      const snippet = normalizeString(result?.content)
        || normalizeString(result?.snippet)
        || normalizeString(result?.summary)
        || normalizeString(result?.description);
      if (!url || !title) return [];
      return [{
        provider: 'zai' as const,
        title,
        url,
        snippet,
        content: snippet,
        publishedDate: normalizeString(result?.publish_date) || normalizeString(result?.published_date),
        score: numberValue(result?.score),
      }];
    })
    .slice(0, maxResults);
}

function extractOpenAIWebResults(response: Record<string, unknown>, maxResults: number): WebSearchResultData[] {
  const outputText = normalizeString(response.output_text) || extractDeepText(response);
  const citations = collectUrlObjects(response);
  return citations.slice(0, maxResults).flatMap((citation, index) => {
    const url = normalizeUrl(citation.url);
    if (!url) return [];
    return [{
      provider: 'openai' as const,
      title: citation.title || titleFromUrl(url, `OpenAI web result ${index + 1}`),
      url,
      snippet: citation.snippet || snippetAroundUrl(outputText, url) || limitText(outputText, 700),
      content: outputText || citation.snippet,
    }];
  });
}

function collectUrlObjects(value: unknown): Array<{ url: string; title?: string; snippet?: string }> {
  const output: Array<{ url: string; title?: string; snippet?: string }> = [];
  const seen = new Set<string>();

  const visit = (item: unknown) => {
    if (!item || typeof item !== 'object') return;
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
      return;
    }

    const record = item as Record<string, unknown>;
    const url = normalizeUrl(record.url) || normalizeUrl(record.uri);
    if (url && !seen.has(canonicalUrlKey(url))) {
      seen.add(canonicalUrlKey(url));
      output.push({
        url,
        title: normalizeString(record.title) || normalizeString(record.name),
        snippet: normalizeString(record.snippet)
          || normalizeString(record.description)
          || normalizeString(record.text),
      });
    }

    for (const child of Object.values(record)) visit(child);
  };

  visit(value);
  return output;
}

function extractChatCompletionText(response: Record<string, unknown>): string {
  return arrayValue(response.choices)
    .map(objectValue)
    .map((choice) => objectValue(choice?.message))
    .map((message) => normalizeString(message?.content))
    .filter(Boolean)
    .join('\n\n');
}

function extractDeepText(value: unknown): string {
  const parts: string[] = [];
  const visit = (item: unknown) => {
    if (!item || typeof item !== 'object') return;
    if (Array.isArray(item)) {
      for (const child of item) visit(child);
      return;
    }
    const record = item as Record<string, unknown>;
    const type = normalizeString(record.type);
    if (type === 'output_text' || type === 'text') {
      const text = normalizeString(record.text);
      if (text) parts.push(text);
    }
    for (const child of Object.values(record)) visit(child);
  };
  visit(value);
  return parts.join('\n\n').trim();
}

function zaiWebSearchEndpoints(baseUrl: string | undefined): string[] {
  return Array.from(new Set([
    baseUrl ? `${normalizeEndpointBaseUrl(baseUrl)}/web_search` : '',
    'https://open.bigmodel.cn/api/coding/paas/v4/web_search',
    'https://open.bigmodel.cn/api/paas/v4/web_search',
    'https://api.z.ai/api/paas/v4/web_search',
  ].filter(Boolean)));
}

function shouldTryNextZaiEndpoint(err: unknown): boolean {
  return err instanceof HttpError && (err.status === 400 || err.status === 404 || err.status === 405);
}

function jsonAuthHeaders(provider: ModelSearchProvider): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...provider.headers,
  };
}

function normalizeHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const headers: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string' && raw.trim()) headers[key] = raw;
  }
  return headers;
}

function hasAuthorizationHeader(headers: Record<string, string>): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === 'authorization');
}

function stripBearerPrefix(value: string): string {
  return value.replace(/^Bearer\s+/i, '').trim();
}

function normalizeEndpointBaseUrl(value: string): string {
  return value
    .trim()
    .replace(/\/+$/g, '')
    .replace(/\/(?:chat\/completions|responses)$/i, '');
}

function buildSearchPrompt(query: string, maxResults: number): string {
  return [
    `Search the web for: ${query}`,
    '',
    `Return up to ${maxResults} high-quality sources. Prefer official documentation, primary sources, reputable publications, and recent pages when freshness matters.`,
    'For each source, preserve the title, URL, publication date if available, and a concise evidence summary.',
  ].join('\n');
}

function modelSearchTimeoutMs(): number {
  const parsed = Number(process.env.PI_AGENT_MODEL_WEB_SEARCH_TIMEOUT_MS ?? process.env.PI_AGENT_WEB_SEARCH_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.max(5_000, Math.min(60_000, Math.round(parsed)))
    : DEFAULT_MODEL_WEB_SEARCH_TIMEOUT_MS;
}

function webSearchDisabled(): boolean {
  return /^(1|true|yes)$/i.test(process.env.PI_AGENT_WEB_SEARCH_DISABLED ?? '');
}

function clampMaxResults(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(10, Math.floor(parsed))) : 6;
}

function dedupeResults(results: WebSearchResultData[]): WebSearchResultData[] {
  const seen = new Set<string>();
  const output: WebSearchResultData[] = [];
  for (const result of results) {
    const key = canonicalUrlKey(result.url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(result);
  }
  return output;
}

function canonicalUrlKey(value: string): string {
  try {
    const url = new URL(value);
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return value;
  }
}

function normalizeUrl(value: unknown): string {
  const raw = normalizeString(value);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function extractUrls(value: string): string[] {
  return Array.from(new Set((value.match(/https?:\/\/[^\s)>\]]+/g) ?? []).map((url) => normalizeUrl(url)).filter(Boolean)));
}

function snippetAroundUrl(text: string, url: string): string {
  const index = text.indexOf(url);
  if (index < 0) return limitText(text, 700);
  return limitText(text.slice(Math.max(0, index - 260), Math.min(text.length, index + url.length + 360)).trim(), 700);
}

function titleFromUrl(url: string, fallback: string): string {
  try {
    const parsed = new URL(url);
    const name = parsed.pathname.split('/').filter(Boolean).pop();
    return name ? `${parsed.hostname} / ${name}` : parsed.hostname;
  } catch {
    return fallback;
  }
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberValue(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(number) ? number : undefined;
}

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function limitText(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars).trimEnd()}...` : value;
}

function conciseError(err: unknown): string {
  return err instanceof Error ? err.message : String(err ?? '');
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  return raw ? JSON.parse(raw) as T : {} as T;
}
