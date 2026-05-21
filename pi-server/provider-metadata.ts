export interface ProviderMetadata {
  displayName?: string;
  aliases?: string[];
  docsUrl?: string;
  defaultBaseUrl?: string;
}

const PROVIDER_METADATA: Record<string, ProviderMetadata> = {
  zai: {
    displayName: 'Zhipu AI / Z.ai / BigModel',
    aliases: ['z.ai', 'z-ai', 'zhipu', 'zhipuai', 'zhipu-ai', 'bigmodel', 'bigmodel.cn', 'glm', '智谱', '智谱ai'],
    docsUrl: 'https://docs.bigmodel.cn/cn/api/introduction',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
  },
};

const PROVIDER_ALIAS_TO_ID = new Map<string, string>();

for (const [provider, metadata] of Object.entries(PROVIDER_METADATA)) {
  PROVIDER_ALIAS_TO_ID.set(provider.toLowerCase(), provider);
  for (const alias of metadata.aliases ?? []) {
    PROVIDER_ALIAS_TO_ID.set(alias.toLowerCase(), provider);
  }
}

export function normalizeProviderAlias(provider: string): string {
  const key = provider.trim().toLowerCase();
  return PROVIDER_ALIAS_TO_ID.get(key) ?? provider.trim();
}

export function getProviderMetadata(provider: string): ProviderMetadata | undefined {
  return PROVIDER_METADATA[normalizeProviderAlias(provider)];
}

export function getProviderDisplayName(provider: string, fallback: string): string {
  return getProviderMetadata(provider)?.displayName ?? fallback;
}

export function getProviderAliases(provider: string): string[] | undefined {
  const aliases = getProviderMetadata(provider)?.aliases;
  return aliases && aliases.length > 0 ? aliases : undefined;
}

export function getProviderDocsUrl(provider: string): string | undefined {
  return getProviderMetadata(provider)?.docsUrl;
}

export function getProviderDefaultBaseUrl(provider: string, fallback?: string): string | undefined {
  return getProviderMetadata(provider)?.defaultBaseUrl ?? fallback;
}

export function getProviderCredentialIds(provider: string): string[] {
  const canonical = normalizeProviderAlias(provider);
  const aliases = getProviderMetadata(canonical)?.aliases ?? [];
  return Array.from(new Set([canonical, ...aliases]));
}
