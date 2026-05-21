import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import { getAgentDir } from './agent-paths.js';
import type {
  PackageManager,
  ProgressEvent,
  PromptTemplate,
  ResourceDiagnostic,
  ResourceLoader,
  SettingsManager as SettingsManagerType,
  Skill,
} from '@earendil-works/pi-coding-agent';
import type {
  ExtensionData,
  ExtensionResourceSnapshotData,
  MarketplacePackageData,
  PackageData,
  PackageProgressData,
  PackageResourceFilterData,
  PromptTemplateData,
  ResourceDiagnosticData,
  ResourceTrustDecisionData,
  ResourceTrustKindData,
  ResourceTrustRecordData,
  SkillData,
  SkillHubItemData,
  SkillHubSearchResultData,
  SkillHubStatusData,
  SlashCommandData,
  ThemeData,
} from './types.js';
import { getSlashCommands } from './slash-commands.js';

type PiSdk = typeof import('@earendil-works/pi-coding-agent');
type PackageScope = 'user' | 'project';

interface ResourceContext {
  cwd: string;
  projectPath: string;
  agentDir: string;
  settingsManager: SettingsManagerType;
  packageManager: PackageManager;
  resourceLoader: ResourceLoader;
  revision: number;
  loaded: boolean;
  snapshot?: ExtensionResourceSnapshotData;
}

interface PackageOperationOptions {
  projectPath?: string;
  scope?: PackageScope;
  trustConfirmed?: boolean;
}

interface CreateSkillInput {
  name: string;
  description?: string;
  body?: string;
  scope?: PackageScope;
  projectPath?: string;
}

interface CreatePackageInput {
  name: string;
  description?: string;
  skillName?: string;
  skillDescription?: string;
  scope?: PackageScope;
  projectPath?: string;
}

interface SkillHubConfig {
  endpoint: string;
  apiKey?: string;
  defaultProvider: 'clawhub' | 'skillhub';
}

interface InstallSkillHubInput {
  item: SkillHubItemData;
  scope?: PackageScope;
  projectPath?: string;
}

interface ExtensionHttpResponse {
  status: number;
  body: unknown;
}

type ProgressListener = (progress: PackageProgressData) => void;

const MAX_JSON_BODY_BYTES = 256 * 1024;
const TRUST_FILE = 'desktop-resource-trust.json';
const SKILLHUB_CONFIG_FILE = 'desktop-skillhub.json';
const DEFAULT_CLAWHUB_BASE_URL = 'https://clawhub.ai';
const DEFAULT_SKILLHUB_ENDPOINT = 'https://www.skillhub.club/api/v1';
const RESOURCE_TYPES = ['extensions', 'skills', 'prompts', 'themes'] as const;
const CURATED_SKILLHUB_ITEMS: SkillHubItemData[] = [
  {
    id: 'clawhub:zlc000190/subagent-driven-development',
    provider: 'clawhub',
    name: 'subagent-driven-development',
    displayName: 'Subagent Driven Development',
    description: 'Execute implementation plans with independent subagents and two-stage review.',
    author: 'zlc000190',
    url: 'https://clawhub.ai/zlc000190/subagent-driven-development',
    version: '0.1.0',
    tags: ['subagent', 'workflow', 'review'],
    sourceLabel: 'ClawHub',
  },
  {
    id: 'clawhub:pskoett/self-improving-agent',
    provider: 'clawhub',
    name: 'self-improving-agent',
    displayName: 'Self Improving Agent',
    description: 'Capture learnings, failures, and improvements so agents can refine future behavior.',
    author: 'pskoett',
    url: 'https://clawhub.ai/pskoett/self-improving-agent',
    tags: ['learning', 'memory', 'improvement'],
    sourceLabel: 'ClawHub',
  },
  {
    id: 'curated:code-reviewer',
    provider: 'curated',
    name: 'code-reviewer',
    displayName: 'Code Reviewer',
    description: 'Review code changes for correctness, security, regressions, and missing tests.',
    tags: ['review', 'quality', 'security'],
    sourceLabel: 'Built-in',
  },
  {
    id: 'curated:release-checklist',
    provider: 'curated',
    name: 'release-checklist',
    displayName: 'Release Checklist',
    description: 'Run a release readiness pass covering build, packaging, update feed, and rollback notes.',
    tags: ['release', 'desktop', 'quality'],
    sourceLabel: 'Built-in',
  },
];
const MARKETPLACE_TEMPLATES = [
  {
    id: 'example-dynamic-resources',
    name: 'Dynamic Resources',
    relativePath: ['node_modules', '@earendil-works', 'pi-coding-agent', 'examples', 'extensions', 'dynamic-resources'],
    description: 'Example package that demonstrates dynamic skills, prompts, and resources.',
    tags: ['skill', 'prompt', 'example'],
    recommendedScope: 'project',
    trustLevel: 'official',
  },
  {
    id: 'example-plan-mode',
    name: 'Plan Mode',
    relativePath: ['node_modules', '@earendil-works', 'pi-coding-agent', 'examples', 'extensions', 'plan-mode'],
    description: 'Adds a planning workflow and safer read-only execution phase.',
    tags: ['workflow', 'safety', 'planning'],
    recommendedScope: 'project',
    trustLevel: 'official',
  },
  {
    id: 'example-tools',
    name: 'Tools Switcher',
    relativePath: ['node_modules', '@earendil-works', 'pi-coding-agent', 'examples', 'extensions', 'tools.ts'],
    description: 'Example extension for enabling and disabling tools interactively.',
    tags: ['tools', 'runtime', 'example'],
    recommendedScope: 'user',
    trustLevel: 'official',
  },
  {
    id: 'example-todo',
    name: 'Todo Extension',
    relativePath: ['node_modules', '@earendil-works', 'pi-coding-agent', 'examples', 'extensions', 'todo.ts'],
    description: 'Small extension showing command and UI event patterns for task-like workflows.',
    tags: ['tasks', 'commands', 'example'],
    recommendedScope: 'project',
    trustLevel: 'official',
  },
] satisfies Array<Omit<MarketplacePackageData, 'source' | 'installed'> & { relativePath: string[] }>;

class ExtensionResourceService {
  private contexts = new Map<string, ResourceContext>();
  private progressListeners = new Set<ProgressListener>();
  private sdkPromise?: Promise<PiSdk>;

  onProgress(listener: ProgressListener): () => void {
    this.progressListeners.add(listener);
    return () => this.progressListeners.delete(listener);
  }

  async getSnapshot(projectPath?: string): Promise<ExtensionResourceSnapshotData> {
    const context = await this.getContext(projectPath);
    if (!context.loaded) {
      await this.reload(projectPath);
    }
    return context.snapshot ?? this.buildSnapshot(context);
  }

  getCachedSnapshot(projectPath?: string): ExtensionResourceSnapshotData | null {
    const cwd = resolveProjectPath(projectPath);
    return this.contexts.get(cwd)?.snapshot ?? null;
  }

  async reload(projectPath?: string): Promise<ExtensionResourceSnapshotData> {
    const context = await this.getContext(projectPath);
    this.emitProgress({
      type: 'start',
      action: 'reload',
      source: context.projectPath,
      message: 'Reloading pi resources.',
      timestamp: Date.now(),
    });

    await context.settingsManager.reload();
    await context.resourceLoader.reload();
    context.loaded = true;
    context.revision += 1;
    context.snapshot = this.buildSnapshot(context);

    this.emitProgress({
      type: 'complete',
      action: 'reload',
      source: context.projectPath,
      message: 'Pi resources reloaded.',
      timestamp: Date.now(),
    });

    return context.snapshot;
  }

  async installPackage(source: string, options: PackageOperationOptions = {}): Promise<ExtensionResourceSnapshotData> {
    const normalizedSource = normalizeSource(source);
    if (!normalizedSource) throw new Error('Package source is required.');

    const context = await this.getContext(options.projectPath);
    enforcePackageInstallTrust(context, normalizedSource, options);
    if (options.trustConfirmed) {
      markPackageSourceTrusted(context.agentDir, normalizedSource, options.scope);
    }

    await this.withPackageProgress(context, async () => {
      await context.packageManager.installAndPersist(normalizedSource, { local: options.scope === 'project' });
      await context.settingsManager.flush();
    });

    return this.reload(context.projectPath);
  }

  async removePackage(source: string, options: PackageOperationOptions = {}): Promise<ExtensionResourceSnapshotData> {
    const normalizedSource = normalizeSource(source);
    if (!normalizedSource) throw new Error('Package source is required.');

    const context = await this.getContext(options.projectPath);
    const scope = options.scope ?? inferConfiguredPackageScope(context, normalizedSource);
    await this.withPackageProgress(context, async () => {
      await context.packageManager.removeAndPersist(normalizedSource, { local: scope === 'project' });
      await context.settingsManager.flush();
    });

    return this.reload(context.projectPath);
  }

  async updatePackage(source: string | undefined, options: PackageOperationOptions = {}): Promise<ExtensionResourceSnapshotData> {
    const context = await this.getContext(options.projectPath);
    await this.withPackageProgress(context, async () => {
      await context.packageManager.update(source ? normalizeSource(source) : undefined);
      await context.settingsManager.flush();
    });

    return this.reload(context.projectPath);
  }

  async setPackageFilter(
    source: string,
    filter: PackageResourceFilterData | undefined,
    options: PackageOperationOptions = {},
  ): Promise<ExtensionResourceSnapshotData> {
    const normalizedSource = normalizeSource(source);
    if (!normalizedSource) throw new Error('Package source is required.');

    const context = await this.getContext(options.projectPath);
    const scope = options.scope ?? inferConfiguredPackageScope(context, normalizedSource);
    updateConfiguredPackage(context, normalizedSource, scope, (pkg) => {
      const cleanFilter = normalizePackageFilter(filter);
      if (!cleanFilter) return sourceOfPackageSetting(pkg);
      return {
        source: sourceOfPackageSetting(pkg),
        ...cleanFilter,
      };
    });
    await context.settingsManager.flush();
    return this.reload(context.projectPath);
  }

  async setPackageEnabled(source: string, enabled: boolean, options: PackageOperationOptions = {}): Promise<ExtensionResourceSnapshotData> {
    return this.setPackageFilter(source, enabled ? undefined : {
      extensions: [],
      skills: [],
      prompts: [],
      themes: [],
    }, options);
  }

  async createSkill(input: CreateSkillInput): Promise<ExtensionResourceSnapshotData> {
    const context = await this.getContext(input.projectPath);
    const scope = input.scope === 'user' ? 'user' : 'project';
    const name = normalizeResourceName(input.name);
    if (!name) throw new Error('Skill name is required.');

    const baseDir = scope === 'project'
      ? path.join(context.cwd, '.pi', 'skills', name)
      : path.join(context.agentDir, 'skills', name);
    const skillFile = path.join(baseDir, 'SKILL.md');
    if (existsSync(skillFile)) throw new Error(`Skill already exists: ${skillFile}`);

    mkdirSync(baseDir, { recursive: true });
    const description = String(input.description ?? '').trim() || `Project skill: ${name}`;
    const body = String(input.body ?? '').trim() || `Describe how Pi Agent should use the ${name} skill.`;
    writeFileSync(skillFile, [
      '---',
      `name: ${name}`,
      `description: ${yamlSingleLine(description)}`,
      '---',
      '',
      `# ${name}`,
      '',
      body,
      '',
    ].join('\n'), 'utf8');

    return this.reload(context.projectPath);
  }

  async createPackage(input: CreatePackageInput): Promise<ExtensionResourceSnapshotData> {
    const context = await this.getContext(input.projectPath);
    const scope = input.scope === 'user' ? 'user' : 'project';
    const name = normalizeResourceName(input.name);
    if (!name) throw new Error('Package name is required.');

    const packageDir = scope === 'project'
      ? path.join(context.cwd, '.pi', 'packages', name)
      : path.join(context.agentDir, 'packages', name);
    if (existsSync(path.join(packageDir, 'package.json'))) {
      throw new Error(`Package already exists: ${packageDir}`);
    }

    const skillName = normalizeResourceName(input.skillName ?? name);
    const description = String(input.description ?? '').trim() || `Local Pi package: ${name}`;
    mkdirSync(path.join(packageDir, 'skills', skillName), { recursive: true });
    writeFileSync(path.join(packageDir, 'package.json'), `${JSON.stringify({
      name: `pi-package-${name}`,
      version: '0.1.0',
      description,
      pi: {
        skills: ['skills/*'],
      },
    }, null, 2)}\n`, 'utf8');
    writeFileSync(path.join(packageDir, 'skills', skillName, 'SKILL.md'), [
      '---',
      `name: ${skillName}`,
      `description: ${yamlSingleLine(input.skillDescription ?? description)}`,
      '---',
      '',
      `# ${skillName}`,
      '',
      'Add package-specific instructions here.',
      '',
    ].join('\n'), 'utf8');
    writeFileSync(path.join(packageDir, 'README.md'), `# ${name}\n\n${description}\n`, 'utf8');

    await context.packageManager.installAndPersist(packageDir, { local: scope === 'project' });
    await context.settingsManager.flush();
    return this.reload(context.projectPath);
  }

  async getSkillHubStatus(): Promise<SkillHubStatusData> {
    const config = readSkillHubConfig(getAgentDir());
    return {
      endpoint: config.endpoint,
      apiKeyConfigured: Boolean(config.apiKey),
      defaultProvider: config.defaultProvider,
      curatedCount: CURATED_SKILLHUB_ITEMS.length,
    };
  }

  async saveSkillHubConfig(input: {
    endpoint?: string;
    apiKey?: string;
    clearApiKey?: boolean;
    defaultProvider?: 'clawhub' | 'skillhub';
  }): Promise<SkillHubStatusData> {
    const agentDir = getAgentDir();
    const current = readSkillHubConfig(agentDir);
    const endpoint = normalizeSkillHubEndpoint(input.endpoint) ?? current.endpoint;
    const next: SkillHubConfig = {
      endpoint,
      defaultProvider: input.defaultProvider ?? current.defaultProvider,
      apiKey: input.clearApiKey ? undefined : (typeof input.apiKey === 'string' && input.apiKey.trim() ? input.apiKey.trim() : current.apiKey),
    };
    writeSkillHubConfig(agentDir, next);
    return this.getSkillHubStatus();
  }

  async searchSkillHub(query: string | undefined, options: {
    projectPath?: string;
    limit?: number;
    provider?: string;
  } = {}): Promise<SkillHubSearchResultData> {
    const normalizedQuery = String(query ?? '').trim();
    const limit = clampInteger(options.limit, 1, 50, 12);
    const provider = options.provider === 'skillhub' ? 'skillhub' : options.provider === 'clawhub' ? 'clawhub' : undefined;
    const config = readSkillHubConfig(getAgentDir());
    const preferred = provider ?? config.defaultProvider;
    const installed = await this.getInstalledSkillNames(options.projectPath);
    const errors: string[] = [];

    const remoteItems = preferred === 'skillhub'
      ? await searchSkillHubApi(config, normalizedQuery, limit).catch((err) => {
          errors.push(err instanceof Error ? err.message : String(err));
          return [];
        })
      : await searchClawHub(normalizedQuery, limit).catch((err) => {
          errors.push(err instanceof Error ? err.message : String(err));
          return [];
        });

    const curated = filterCuratedSkillHubItems(normalizedQuery, limit);
    const deduped = markSkillHubInstalled(dedupeSkillHubItems([...remoteItems, ...curated]).slice(0, limit), installed);

    return {
      query: normalizedQuery,
      items: deduped,
      source: remoteItems.length > 0 && curated.length > 0 ? 'mixed' : remoteItems.length > 0 ? preferred : 'curated',
      usedFallback: remoteItems.length === 0,
      message: remoteItems.length === 0 && errors.length > 0 ? errors[0] : undefined,
    };
  }

  async installSkillHubItem(input: InstallSkillHubInput): Promise<ExtensionResourceSnapshotData> {
    if (!input.item || typeof input.item !== 'object') throw new Error('SkillHub item is required.');
    const context = await this.getContext(input.projectPath);
    const scope = input.scope === 'user' ? 'user' : 'project';
    const item = normalizeSkillHubItem(input.item);
    if (!item) throw new Error('Invalid SkillHub item.');

    const installed = await installSkillHubItemToDisk(context, item, scope);
    markSkillHubItemTrusted(context.agentDir, installed.name, installed.filePath, scope, item);
    return this.reload(context.projectPath);
  }

  async setTrustDecision(input: {
    kind: ResourceTrustKindData;
    id?: string;
    name?: string;
    source?: string;
    path?: string;
    decision: ResourceTrustDecisionData;
    reason?: string;
    projectPath?: string;
  }): Promise<ExtensionResourceSnapshotData> {
    const context = await this.getContext(input.projectPath);
    const id = input.id || trustId(input.kind, input.source ?? input.path ?? input.name ?? '');
    if (!id) throw new Error('Trust target is required.');

    const trust = readTrustRecords(context.agentDir);
    const next: ResourceTrustRecordData = {
      id,
      kind: input.kind,
      name: input.name ?? input.source ?? input.path ?? id,
      source: input.source,
      path: input.path,
      decision: input.decision,
      updatedAt: Date.now(),
      reason: input.reason,
    };
    writeTrustRecords(context.agentDir, [next, ...trust.filter((item) => item.id !== id)]);

    if (input.kind === 'package' && input.source && input.decision === 'blocked') {
      return this.setPackageEnabled(input.source, false, { projectPath: context.projectPath });
    }
    return this.reload(context.projectPath);
  }

  async getRuntimeContext(projectPath?: string): Promise<{
    cwd: string;
    agentDir: string;
    settingsManager: SettingsManagerType;
    resourceLoader: ResourceLoader;
    revision: number;
  }> {
    const context = await this.getContext(projectPath);
    if (!context.loaded) {
      await this.reload(projectPath);
    }
    return {
      cwd: context.cwd,
      agentDir: context.agentDir,
      settingsManager: context.settingsManager,
      resourceLoader: context.resourceLoader,
      revision: context.revision,
    };
  }

  async readSkillContent(filePath: string, projectPath?: string): Promise<{ path: string; content: string }> {
    const normalizedPath = path.resolve(filePath);
    const snapshot = await this.getSnapshot(projectPath);
    const allowed = snapshot.skills.some((skill) => path.resolve(skill.filePath) === normalizedPath);
    if (!allowed) {
      throw new Error('Skill is not part of the loaded pi resources.');
    }

    const stat = statSync(normalizedPath);
    if (!stat.isFile()) throw new Error('Skill path is not a file.');
    if (stat.size > 1024 * 1024) throw new Error('Skill file is larger than 1 MB.');

    return { path: normalizedPath, content: readFileSync(normalizedPath, 'utf8') };
  }

  private async getInstalledSkillNames(projectPath?: string): Promise<Set<string>> {
    const snapshot = await this.getSnapshot(projectPath).catch(() => null);
    return new Set((snapshot?.skills ?? []).map((skill) => skill.name.toLowerCase()));
  }

  private async getContext(projectPath?: string): Promise<ResourceContext> {
    const cwd = resolveProjectPath(projectPath);
    const existing = this.contexts.get(cwd);
    if (existing) return existing;

    const sdk = await this.loadSdk();
    const agentDir = getAgentDir();
    const settingsManager = sdk.SettingsManager.create(cwd, agentDir);
    const packageManager = new sdk.DefaultPackageManager({ cwd, agentDir, settingsManager });
    const resourceLoader = new sdk.DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      eventBus: sdk.createEventBus(),
    });

    const context: ResourceContext = {
      cwd,
      projectPath: cwd,
      agentDir,
      settingsManager,
      packageManager,
      resourceLoader,
      revision: 0,
      loaded: false,
    };
    this.contexts.set(cwd, context);
    return context;
  }

  private async loadSdk(): Promise<PiSdk> {
    this.sdkPromise ??= import('@earendil-works/pi-coding-agent');
    return this.sdkPromise;
  }

  private buildSnapshot(context: ResourceContext): ExtensionResourceSnapshotData {
    const packages = mapPackages(context);
    const extensionResult = context.resourceLoader.getExtensions();
    const skillResult = context.resourceLoader.getSkills();
    const promptResult = context.resourceLoader.getPrompts();
    const themeResult = context.resourceLoader.getThemes();

    const extensions = mapExtensions(extensionResult);
    const skills = skillResult.skills.map(mapSkill);
    const prompts = promptResult.prompts.map(mapPromptTemplate);
    const themes = themeResult.themes.map(mapTheme).filter(isDefined);
    const diagnostics = [
      ...extensionResult.errors.map<ResourceDiagnosticData>((error) => ({
        type: 'error',
        resourceType: 'extension',
        message: error.error,
        path: error.path,
      })),
      ...mapDiagnostics('skill', skillResult.diagnostics),
      ...mapDiagnostics('prompt', promptResult.diagnostics),
      ...mapDiagnostics('theme', themeResult.diagnostics),
    ];
    const slashCommands = getSlashCommands(packages, buildResourceSlashCommands(extensions, skills, prompts));
    const marketplace = buildMarketplace(packages);
    const trust = buildTrustRecords(context.agentDir, { packages, extensions, skills, prompts, themes });

    return {
      projectPath: context.projectPath,
      packages: attachResourceCounts(packages, { extensions, skills, prompts, themes }),
      extensions,
      skills,
      prompts,
      themes,
      diagnostics,
      slashCommands,
      marketplace,
      trust,
    };
  }

  private async withPackageProgress<T>(context: ResourceContext, fn: () => Promise<T>): Promise<T> {
    context.packageManager.setProgressCallback((event) => this.emitProgress(mapProgressEvent(event)));
    try {
      return await fn();
    } finally {
      context.packageManager.setProgressCallback(undefined);
    }
  }

  private emitProgress(progress: PackageProgressData): void {
    for (const listener of this.progressListeners) {
      listener(progress);
    }
  }
}

export const extensionService = new ExtensionResourceService();

export async function handleExtensionRequest(req: IncomingMessage): Promise<ExtensionHttpResponse | null> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/extensions')) return null;

  if (url.pathname === '/api/extensions/resources' && req.method === 'GET') {
    return json(200, await extensionService.getSnapshot(url.searchParams.get('projectPath') ?? undefined));
  }

  if (url.pathname === '/api/extensions/reload' && req.method === 'POST') {
    const body = await readJsonBody(req);
    return json(200, await extensionService.reload(stringValue(body.projectPath)));
  }

  if (url.pathname === '/api/extensions/packages/install' && req.method === 'POST') {
    const body = await readJsonBody(req);
    return json(200, await extensionService.installPackage(requireString(body.source, 'source'), {
      projectPath: stringValue(body.projectPath),
      scope: packageScopeValue(body.scope),
      trustConfirmed: body.trustConfirmed === true,
    }));
  }

  if (url.pathname === '/api/extensions/packages/remove' && req.method === 'POST') {
    const body = await readJsonBody(req);
    return json(200, await extensionService.removePackage(requireString(body.source, 'source'), {
      projectPath: stringValue(body.projectPath),
      scope: packageScopeValue(body.scope),
    }));
  }

  if (url.pathname === '/api/extensions/packages/update' && req.method === 'POST') {
    const body = await readJsonBody(req);
    return json(200, await extensionService.updatePackage(stringValue(body.source), {
      projectPath: stringValue(body.projectPath),
      scope: packageScopeValue(body.scope),
    }));
  }

  if (url.pathname === '/api/extensions/packages/filter' && req.method === 'POST') {
    const body = await readJsonBody(req);
    return json(200, await extensionService.setPackageFilter(requireString(body.source, 'source'), packageFilterValue(body.filter), {
      projectPath: stringValue(body.projectPath),
      scope: packageScopeValue(body.scope),
    }));
  }

  if (url.pathname === '/api/extensions/packages/enabled' && req.method === 'POST') {
    const body = await readJsonBody(req);
    return json(200, await extensionService.setPackageEnabled(requireString(body.source, 'source'), Boolean(body.enabled), {
      projectPath: stringValue(body.projectPath),
      scope: packageScopeValue(body.scope),
    }));
  }

  if (url.pathname === '/api/extensions/skills/create' && req.method === 'POST') {
    const body = await readJsonBody(req);
    return json(200, await extensionService.createSkill({
      name: requireString(body.name, 'name'),
      description: stringValue(body.description),
      body: stringValue(body.body),
      scope: packageScopeValue(body.scope),
      projectPath: stringValue(body.projectPath),
    }));
  }

  if (url.pathname === '/api/extensions/skillhub/status' && req.method === 'GET') {
    return json(200, await extensionService.getSkillHubStatus());
  }

  if (url.pathname === '/api/extensions/skillhub/config' && req.method === 'POST') {
    const body = await readJsonBody(req);
    return json(200, await extensionService.saveSkillHubConfig({
      endpoint: stringValue(body.endpoint),
      apiKey: stringValue(body.apiKey),
      clearApiKey: body.clearApiKey === true,
      defaultProvider: body.defaultProvider === 'skillhub' ? 'skillhub' : body.defaultProvider === 'clawhub' ? 'clawhub' : undefined,
    }));
  }

  if (url.pathname === '/api/extensions/skillhub/search' && req.method === 'GET') {
    return json(200, await extensionService.searchSkillHub(url.searchParams.get('q') ?? undefined, {
      projectPath: url.searchParams.get('projectPath') ?? undefined,
      provider: url.searchParams.get('provider') ?? undefined,
      limit: parseInteger(url.searchParams.get('limit')),
    }));
  }

  if (url.pathname === '/api/extensions/skillhub/install' && req.method === 'POST') {
    const body = await readJsonBody(req);
    return json(200, await extensionService.installSkillHubItem({
      item: skillHubItemValue(body.item),
      scope: packageScopeValue(body.scope),
      projectPath: stringValue(body.projectPath),
    }));
  }

  if (url.pathname === '/api/extensions/packages/create' && req.method === 'POST') {
    const body = await readJsonBody(req);
    return json(200, await extensionService.createPackage({
      name: requireString(body.name, 'name'),
      description: stringValue(body.description),
      skillName: stringValue(body.skillName),
      skillDescription: stringValue(body.skillDescription),
      scope: packageScopeValue(body.scope),
      projectPath: stringValue(body.projectPath),
    }));
  }

  if (url.pathname === '/api/extensions/trust' && req.method === 'POST') {
    const body = await readJsonBody(req);
    return json(200, await extensionService.setTrustDecision({
      id: stringValue(body.id),
      kind: resourceTrustKindValue(body.kind),
      name: stringValue(body.name),
      source: stringValue(body.source),
      path: stringValue(body.path),
      decision: resourceTrustDecisionValue(body.decision),
      reason: stringValue(body.reason),
      projectPath: stringValue(body.projectPath),
    }));
  }

  if (url.pathname === '/api/extensions/skills/content' && req.method === 'GET') {
    return json(200, await extensionService.readSkillContent(
      requireString(url.searchParams.get('path'), 'path'),
      url.searchParams.get('projectPath') ?? undefined,
    ));
  }

  return json(404, { error: 'Extension endpoint not found.' });
}

async function searchClawHub(query: string, limit: number): Promise<SkillHubItemData[]> {
  const url = new URL('/api/v1/search', DEFAULT_CLAWHUB_BASE_URL);
  url.searchParams.set('q', query || 'agent');
  url.searchParams.set('nonSuspiciousOnly', 'true');

  const data = await fetchJson(url.toString());
  const rawItems = Array.isArray((data as { results?: unknown }).results)
    ? (data as { results: unknown[] }).results
    : Array.isArray(data)
      ? data
      : [];

  return rawItems
    .map(normalizeClawHubSearchItem)
    .filter(isDefined)
    .slice(0, limit);
}

async function searchSkillHubApi(config: SkillHubConfig, query: string, limit: number): Promise<SkillHubItemData[]> {
  if (!config.apiKey) {
    throw new Error('SkillHub API key is not configured.');
  }

  const endpoint = normalizeSkillHubEndpoint(config.endpoint) ?? DEFAULT_SKILLHUB_ENDPOINT;
  const data = await fetchJson(`${endpoint}/skills/search`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: query || 'agent', limit }),
  });
  const rawItems = extractSkillHubArray(data);

  return rawItems
    .map(normalizeSkillHubApiItem)
    .filter(isDefined)
    .slice(0, limit);
}

function normalizeClawHubSearchItem(value: unknown): SkillHubItemData | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const slug = stringFrom(item.slug) || stringFrom(item.name);
  if (!slug) return null;

  const owner = item.owner && typeof item.owner === 'object' ? item.owner as Record<string, unknown> : undefined;
  const author = stringFrom(item.ownerHandle) || stringFrom(owner?.handle) || stringFrom(owner?.displayName);
  const displayName = stringFrom(item.displayName) || titleFromSlug(slug);
  const version = stringFrom(item.version) || stringFrom((item.tags && typeof item.tags === 'object' ? (item.tags as Record<string, unknown>).latest : undefined));

  return {
    id: author ? `clawhub:${author}/${slug}` : `clawhub:${slug}`,
    provider: 'clawhub',
    name: normalizeResourceName(slug) || slug,
    displayName,
    description: stringFrom(item.summary) || stringFrom(item.description) || displayName,
    author,
    url: author ? `${DEFAULT_CLAWHUB_BASE_URL}/${encodeURIComponent(author)}/${encodeURIComponent(slug)}` : `${DEFAULT_CLAWHUB_BASE_URL}/skills/${encodeURIComponent(slug)}`,
    version,
    tags: ['clawhub'],
    updatedAt: numberFrom(item.updatedAt),
    score: numberFrom(item.score),
    sourceLabel: 'ClawHub',
  };
}

function normalizeSkillHubApiItem(value: unknown): SkillHubItemData | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  const name = normalizeResourceName(stringFrom(item.name) || stringFrom(item.slug) || stringFrom(item.id) || stringFrom(item.title) || '');
  if (!name) return null;
  const displayName = stringFrom(item.displayName) || stringFrom(item.title) || titleFromSlug(name);
  const description = stringFrom(item.description) || stringFrom(item.summary) || displayName;
  const author = stringFrom(item.author) || stringFrom(item.owner) || stringFrom(item.publisher);
  const tags = arrayOfStrings(item.tags);

  return {
    id: stringFrom(item.id) || `skillhub:${author ? `${author}/` : ''}${name}`,
    provider: 'skillhub',
    name,
    displayName,
    description,
    author,
    url: stringFrom(item.url) || stringFrom(item.homepage),
    version: stringFrom(item.version),
    tags: tags.length > 0 ? tags : ['skillhub'],
    downloads: numberFrom(item.downloads),
    installs: numberFrom(item.installs),
    stars: numberFrom(item.stars),
    updatedAt: numberFrom(item.updatedAt),
    score: numberFrom(item.score),
    installSource: stringFrom(item.installSource) || stringFrom(item.source),
    sourceLabel: 'SkillHub',
  };
}

function extractSkillHubArray(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  const value = data as Record<string, unknown>;
  for (const key of ['items', 'results', 'skills', 'data']) {
    if (Array.isArray(value[key])) return value[key] as unknown[];
  }
  return [];
}

function filterCuratedSkillHubItems(query: string, limit: number): SkillHubItemData[] {
  const needle = query.trim().toLowerCase();
  const items = !needle
    ? CURATED_SKILLHUB_ITEMS
    : CURATED_SKILLHUB_ITEMS.filter((item) =>
        `${item.name} ${item.displayName} ${item.description} ${item.author ?? ''} ${item.tags.join(' ')}`.toLowerCase().includes(needle)
      );
  return items.slice(0, limit).map((item) => ({ ...item, tags: [...item.tags] }));
}

function dedupeSkillHubItems(items: SkillHubItemData[]): SkillHubItemData[] {
  const seen = new Set<string>();
  const result: SkillHubItemData[] = [];
  for (const item of items) {
    const key = `${item.provider}:${item.author ?? ''}:${item.name}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function markSkillHubInstalled(items: SkillHubItemData[], installed: Set<string>): SkillHubItemData[] {
  return items.map((item) => ({
    ...item,
    installed: installed.has(item.name.toLowerCase()),
  }));
}

function normalizeSkillHubItem(value: SkillHubItemData): SkillHubItemData | null {
  const name = normalizeResourceName(value.name || value.displayName || value.id);
  if (!name) return null;
  return {
    ...value,
    id: String(value.id || `${value.provider}:${name}`),
    provider: value.provider === 'clawhub' || value.provider === 'skillhub' || value.provider === 'curated' ? value.provider : 'curated',
    name,
    displayName: String(value.displayName || titleFromSlug(name)),
    description: String(value.description || value.displayName || name),
    tags: Array.isArray(value.tags) ? value.tags.map(String).filter(Boolean).slice(0, 12) : [],
  };
}

async function installSkillHubItemToDisk(
  context: ResourceContext,
  item: SkillHubItemData,
  scope: PackageScope,
): Promise<{ name: string; filePath: string }> {
  const name = normalizeResourceName(item.name);
  if (!name) throw new Error('Skill name is required.');

  const baseDir = scope === 'project'
    ? path.join(context.cwd, '.pi', 'skills', name)
    : path.join(context.agentDir, 'skills', name);
  const skillFile = path.join(baseDir, 'SKILL.md');
  if (existsSync(skillFile) && !isSkillHubManagedSkill(skillFile)) {
    throw new Error(`A local skill named "${name}" already exists. Rename it or remove it before installing from SkillHub.`);
  }

  mkdirSync(baseDir, { recursive: true });

  if (isClawHubSkill(item)) {
    try {
      await installClawHubSkillFiles(baseDir, item);
      return { name, filePath: skillFile };
    } catch {
      writeFileSync(skillFile, buildSkillHubWrapperContent(item), 'utf8');
      return { name, filePath: skillFile };
    }
  }

  writeFileSync(skillFile, buildSkillHubWrapperContent(item), 'utf8');
  return { name, filePath: skillFile };
}

async function installClawHubSkillFiles(baseDir: string, item: SkillHubItemData): Promise<void> {
  const slug = parseClawHubSlug(item);
  if (!slug) throw new Error('ClawHub skill slug is missing.');

  const detail = await fetchJson(`${DEFAULT_CLAWHUB_BASE_URL}/api/v1/skills/${encodeURIComponent(slug)}`);
  const detailObject = detail && typeof detail === 'object' ? detail as Record<string, unknown> : {};
  const latestVersion = detailObject.latestVersion && typeof detailObject.latestVersion === 'object'
    ? detailObject.latestVersion as Record<string, unknown>
    : {};
  const version = item.version || stringFrom(latestVersion.version);
  if (!version) throw new Error('ClawHub skill version is missing.');

  const versionData = await fetchJson(`${DEFAULT_CLAWHUB_BASE_URL}/api/v1/skills/${encodeURIComponent(slug)}/versions/${encodeURIComponent(version)}`);
  const versionObject = versionData && typeof versionData === 'object' ? versionData as Record<string, unknown> : {};
  const versionInfo = versionObject.version && typeof versionObject.version === 'object'
    ? versionObject.version as Record<string, unknown>
    : {};
  const files = Array.isArray(versionInfo.files)
    ? versionInfo.files as Array<Record<string, unknown>>
    : [{ path: 'SKILL.md', size: 0 }];

  for (const file of files.slice(0, 64)) {
    const relativePath = safeRelativeSkillHubPath(stringFrom(file.path));
    if (!relativePath) continue;
    const size = numberFrom(file.size) ?? 0;
    if (size > 512 * 1024) continue;

    const content = await fetchText(`${DEFAULT_CLAWHUB_BASE_URL}/api/v1/skills/${encodeURIComponent(slug)}/file?path=${encodeURIComponent(relativePath)}`);
    const targetPath = path.join(baseDir, relativePath);
    if (!isPathInsideOrEqual(baseDir, targetPath)) continue;
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(
      targetPath,
      relativePath === 'SKILL.md' ? injectSkillHubMetadata(content, item) : content,
      'utf8',
    );
  }

  const skillFile = path.join(baseDir, 'SKILL.md');
  if (!existsSync(skillFile)) {
    writeFileSync(skillFile, buildSkillHubWrapperContent(item), 'utf8');
  }
}

function isClawHubSkill(item: SkillHubItemData): boolean {
  return item.provider === 'clawhub' || item.id.startsWith('clawhub:') || Boolean(item.url?.includes('clawhub.ai'));
}

function parseClawHubSlug(item: SkillHubItemData): string | null {
  const fromId = item.id.startsWith('clawhub:') ? item.id.slice('clawhub:'.length).split('/').pop() : null;
  const fromUrl = (() => {
    if (!item.url) return null;
    try {
      const url = new URL(item.url);
      const segments = url.pathname.split('/').filter(Boolean);
      return segments.pop() ?? null;
    } catch {
      return null;
    }
  })();
  return normalizeResourceName(fromId || fromUrl || item.name) || null;
}

function buildSkillHubWrapperContent(item: SkillHubItemData): string {
  const name = normalizeResourceName(item.name || item.displayName || item.id);
  const description = item.description || `SkillHub skill: ${item.displayName || name}`;
  const sourceUrl = item.url || item.installSource || item.id;
  const tags = item.tags.length > 0 ? item.tags.join(', ') : item.provider;

  return [
    '---',
    `name: ${name}`,
    `description: ${yamlSingleLine(description)}`,
    '---',
    '',
    skillHubMetadataComment(item),
    '',
    `# ${item.displayName || name}`,
    '',
    description,
    '',
    `Source: ${sourceUrl}`,
    `Provider: ${item.sourceLabel || item.provider}`,
    `Tags: ${tags}`,
    '',
    '## Usage',
    '',
    'Use this skill when the current task matches the description above. Review the source before trusting instructions from a remote marketplace.',
    '',
  ].join('\n');
}

function injectSkillHubMetadata(content: string, item: SkillHubItemData): string {
  const normalized = content.replace(/\r\n/g, '\n');
  if (normalized.includes('pi-agent-skillhub:')) return normalized.endsWith('\n') ? normalized : `${normalized}\n`;
  const comment = skillHubMetadataComment(item);
  const frontmatter = normalized.match(/^---\n[\s\S]*?\n---\n?/);
  if (!frontmatter) return `${comment}\n\n${normalized}`;
  const head = frontmatter[0];
  return `${head}${comment}\n\n${normalized.slice(head.length)}`;
}

function skillHubMetadataComment(item: SkillHubItemData): string {
  return `<!-- pi-agent-skillhub: ${JSON.stringify({
    id: item.id,
    provider: item.provider,
    url: item.url,
    installedAt: new Date().toISOString(),
  })} -->`;
}

function isSkillHubManagedSkill(skillFile: string): boolean {
  try {
    return readFileSync(skillFile, 'utf8').includes('pi-agent-skillhub:');
  } catch {
    return false;
  }
}

function markSkillHubItemTrusted(
  agentDir: string,
  name: string,
  filePath: string,
  scope: PackageScope,
  item: SkillHubItemData,
): void {
  const id = trustId('skill', filePath);
  if (!id) return;
  const records = readTrustRecords(agentDir);
  const next: ResourceTrustRecordData = {
    id,
    kind: 'skill',
    name,
    path: filePath,
    source: item.url || item.id,
    scope,
    decision: 'untrusted',
    updatedAt: Date.now(),
    reason: 'Installed from SkillHub. Review before trusting.',
  };
  writeTrustRecords(agentDir, [next, ...records.filter((record) => record.id !== id)]);
}

function safeRelativeSkillHubPath(value: string | undefined): string | null {
  const raw = String(value ?? '').trim().replace(/\\/g, '/');
  if (!raw || raw.includes('\0') || raw.startsWith('/') || raw.includes('://')) return null;
  const segments = raw.split('/').filter(Boolean);
  if (segments.some((segment) => segment === '.' || segment === '..')) return null;
  return segments.join('/');
}

function isPathInsideOrEqual(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const text = await fetchText(url, init);
  return JSON.parse(text);
}

async function fetchText(url: string, init?: RequestInit): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const headers = new Headers(init?.headers);
    if (!headers.has('Accept')) headers.set('Accept', 'application/json, text/plain;q=0.9, */*;q=0.8');
    const response = await fetch(url, { ...init, headers, signal: controller.signal });
    const contentLength = response.headers.get('content-length');
    if (contentLength && Number(contentLength) > 2 * 1024 * 1024) {
      throw new Error('SkillHub response is too large.');
    }
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`SkillHub request failed with ${response.status}${body ? `: ${body.slice(0, 180)}` : ''}`);
    }
    const text = await response.text();
    if (text.length > 2 * 1024 * 1024) {
      throw new Error('SkillHub response is too large.');
    }
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

function readSkillHubConfig(agentDir: string): SkillHubConfig {
  const file = path.join(agentDir, SKILLHUB_CONFIG_FILE);
  const fallback: SkillHubConfig = {
    endpoint: process.env.SKILLHUB_ENDPOINT?.trim() || DEFAULT_SKILLHUB_ENDPOINT,
    apiKey: process.env.SKILLHUB_API_KEY?.trim() || undefined,
    defaultProvider: 'clawhub',
  };
  if (!existsSync(file)) return fallback;
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<SkillHubConfig>;
    return {
      endpoint: normalizeSkillHubEndpoint(parsed.endpoint) ?? fallback.endpoint,
      apiKey: typeof parsed.apiKey === 'string' && parsed.apiKey.trim() ? parsed.apiKey.trim() : fallback.apiKey,
      defaultProvider: parsed.defaultProvider === 'skillhub' ? 'skillhub' : 'clawhub',
    };
  } catch {
    return fallback;
  }
}

function writeSkillHubConfig(agentDir: string, config: SkillHubConfig): void {
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(path.join(agentDir, SKILLHUB_CONFIG_FILE), `${JSON.stringify({
    endpoint: config.endpoint,
    apiKey: config.apiKey,
    defaultProvider: config.defaultProvider,
  }, null, 2)}\n`, 'utf8');
}

function normalizeSkillHubEndpoint(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return undefined;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  if (
    url.protocol === 'http:'
    && !isLoopbackHostname(url.hostname)
    && process.env.PI_AGENT_ALLOW_INSECURE_SKILLHUB_ENDPOINTS !== '1'
  ) {
    throw new Error('SkillHub endpoint must use https for remote hosts. HTTP is allowed only for localhost/127.0.0.1 unless PI_AGENT_ALLOW_INSECURE_SKILLHUB_ENDPOINTS=1 is set.');
  }

  return url.toString().replace(/\/$/, '');
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

function skillHubItemValue(value: unknown): SkillHubItemData {
  if (!value || typeof value !== 'object') throw new Error('SkillHub item is required.');
  return value as SkillHubItemData;
}

function parseInteger(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function clampInteger(value: number | undefined, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value!)));
}

function stringFrom(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberFrom(value: unknown): number | undefined {
  const number = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) ? number : undefined;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? '').trim()).filter(Boolean)
    : [];
}

function titleFromSlug(value: string): string {
  return value
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function mapPackages(context: ResourceContext): PackageData[] {
  return context.packageManager.listConfiguredPackages().map((pkg: any) => {
    const source = String(pkg.source ?? '');
    const installedPath = typeof pkg.installedPath === 'string'
      ? pkg.installedPath
      : context.packageManager.getInstalledPath(source, pkg.scope === 'project' ? 'project' : 'user');
    const manifest = installedPath ? readPackageManifest(installedPath) : null;
    const filter = configuredPackageFilter(context, source, pkg.scope === 'project' ? 'project' : 'user');
    return {
      name: manifest?.name ?? displayNameFromSource(source),
      version: manifest?.version ?? 'unknown',
      source,
      scope: pkg.scope === 'project' ? 'project' : 'user',
      installedPath,
      filtered: Boolean(pkg.filtered),
      filter,
      disabled: isAllResourcesDisabled(filter),
      installedAt: 0,
      extensions: [],
      skills: [],
      prompts: [],
      themes: [],
    };
  });
}

function attachResourceCounts(
  packages: PackageData[],
  resources: {
    extensions: ExtensionData[];
    skills: SkillData[];
    prompts: PromptTemplateData[];
    themes: ThemeData[];
  },
): PackageData[] {
  return packages.map((pkg) => ({
    ...pkg,
    extensions: resources.extensions.filter((item) => item.sourceName === pkg.source).map((item) => item.name),
    skills: resources.skills.filter((item) => item.sourceName === pkg.source).map((item) => item.name),
    prompts: resources.prompts.filter((item) => item.sourceName === pkg.source).map((item) => item.name),
    themes: resources.themes.filter((item: ThemeData & { sourceName?: string }) => item.sourceName === pkg.source).map((item) => item.name),
  }));
}

function mapExtensions(extensionResult: ReturnType<ResourceLoader['getExtensions']>): ExtensionData[] {
  const errorsByPath = new Map<string, string[]>();
  for (const error of extensionResult.errors) {
    const key = path.resolve(error.path);
    errorsByPath.set(key, [...(errorsByPath.get(key) ?? []), error.error]);
  }

  return extensionResult.extensions.map((extension: any) => {
    const extensionPath = String(extension.resolvedPath ?? extension.path ?? '');
    const sourceInfo = extension.sourceInfo ?? {};
    const sourceName = typeof sourceInfo.source === 'string' ? sourceInfo.source : undefined;
    const baseName = path.basename(extension.path ?? extensionPath).replace(/\.[cm]?[jt]sx?$/i, '');
    const name = sourceInfo.origin === 'package' && sourceName
      ? `${displayNameFromSource(sourceName)}/${baseName}`
      : baseName;
    return {
      name,
      path: extensionPath,
      enabled: true,
      scope: sourceScope(sourceInfo.scope),
      source: sourceInfo.origin === 'package' ? 'package' : 'local',
      sourceName,
      origin: sourceInfo.origin === 'package' ? 'package' : 'top-level',
      tools: mapKeys(extension.tools),
      commands: mapKeys(extension.commands),
      flags: mapKeys(extension.flags),
      shortcuts: mapKeys(extension.shortcuts),
      errors: errorsByPath.get(path.resolve(extensionPath)),
    };
  });
}

function mapSkill(skill: Skill): SkillData {
  return {
    name: skill.name,
    description: skill.description,
    filePath: skill.filePath,
    baseDir: skill.baseDir,
    enabled: true,
    scope: sourceScope(skill.sourceInfo.scope),
    source: skill.sourceInfo.origin === 'package' ? 'package' : 'local',
    sourceName: skill.sourceInfo.source,
    origin: skill.sourceInfo.origin === 'package' ? 'package' : 'top-level',
    disableModelInvocation: skill.disableModelInvocation,
    command: `/skill:${skill.name}`,
  };
}

function mapPromptTemplate(prompt: PromptTemplate): PromptTemplateData {
  return {
    name: prompt.name,
    description: prompt.description,
    argumentHint: prompt.argumentHint,
    filePath: prompt.filePath,
    enabled: true,
    scope: sourceScope(prompt.sourceInfo.scope),
    source: prompt.sourceInfo.origin === 'package' ? 'package' : 'local',
    sourceName: prompt.sourceInfo.source,
    origin: prompt.sourceInfo.origin === 'package' ? 'package' : 'top-level',
    command: normalizeSlashName(prompt.name),
  };
}

function mapTheme(theme: any): (ThemeData & { sourceName?: string; sourcePath?: string }) | null {
  const sourceInfo = theme.sourceInfo ?? {};
  const sourcePath = typeof theme.sourcePath === 'string' ? theme.sourcePath : undefined;
  const fileTheme = sourcePath ? readDesktopThemeFromSource(sourcePath) : null;
  if (!fileTheme) return null;

  return {
    name: String(fileTheme.name ?? theme.name ?? path.basename(sourcePath!, path.extname(sourcePath!))),
    vars: fileTheme.vars,
    colors: fileTheme.colors,
    sourceName: typeof sourceInfo.source === 'string' ? sourceInfo.source : undefined,
    sourcePath,
  };
}

function readDesktopThemeFromSource(sourcePath: string): Pick<ThemeData, 'name' | 'vars' | 'colors'> | null {
  try {
    if (!sourcePath.toLowerCase().endsWith('.json') || !existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
      return null;
    }

    const parsed = JSON.parse(readFileSync(sourcePath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return null;

    const rawColors = (parsed as { colors?: unknown }).colors;
    if (!rawColors || typeof rawColors !== 'object' || Array.isArray(rawColors)) return null;

    const vars = normalizeThemeVars((parsed as { vars?: unknown }).vars);
    const colors = normalizeThemeColors(rawColors as Record<string, unknown>, vars);
    if (!hasUsableDesktopThemeColors(colors)) return null;

    const name = typeof (parsed as { name?: unknown }).name === 'string'
      ? (parsed as { name: string }).name
      : path.basename(sourcePath, path.extname(sourcePath));

    return {
      name,
      vars,
      colors,
    };
  } catch {
    return null;
  }
}

function normalizeThemeVars(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const vars: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string' && raw.trim()) vars[key] = raw.trim();
  }
  return Object.keys(vars).length > 0 ? vars : undefined;
}

function normalizeThemeColors(rawColors: Record<string, unknown>, vars: Record<string, string> | undefined): Record<string, string> {
  const colors: Record<string, string> = {};

  for (const [token, raw] of Object.entries(rawColors)) {
    const color = resolveThemeColor(raw, vars);
    if (color) colors[token] = color;
  }

  return colors;
}

function resolveThemeColor(raw: unknown, vars: Record<string, string> | undefined, seen = new Set<string>()): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return null;
  if (value.startsWith('#') || value.startsWith('rgb') || value.startsWith('hsl') || value.startsWith('var(')) return value;
  if (!vars || seen.has(value)) return null;

  const next = vars[value];
  if (!next) return null;
  seen.add(value);
  return resolveThemeColor(next, vars, seen);
}

function hasUsableDesktopThemeColors(colors: Record<string, string>): boolean {
  return Boolean(colors.accent) && Object.keys(colors).length >= 8;
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function buildResourceSlashCommands(
  extensions: ExtensionData[],
  skills: SkillData[],
  prompts: PromptTemplateData[],
): SlashCommandData[] {
  const extensionCommands = extensions.flatMap((extension) =>
    (extension.commands ?? []).map<SlashCommandData>((command) => ({
      name: normalizeSlashName(command),
      description: `Run extension command from ${extension.name}.`,
      category: 'Extension',
      source: 'extension',
    }))
  );
  const promptCommands = prompts.map<SlashCommandData>((prompt) => ({
    name: prompt.command,
    description: prompt.description,
    category: 'Prompt',
    source: 'prompt',
  }));
  const skillCommands = skills.map<SlashCommandData>((skill) => ({
    name: skill.command ?? `/skill:${skill.name}`,
    description: skill.description,
    category: 'Skill',
    source: 'skill',
  }));
  return [...extensionCommands, ...promptCommands, ...skillCommands];
}

function mapDiagnostics(resourceType: ResourceDiagnosticData['resourceType'], diagnostics: ResourceDiagnostic[]): ResourceDiagnosticData[] {
  return diagnostics.map((diagnostic) => ({
    type: diagnostic.type,
    resourceType,
    message: diagnostic.message,
    path: diagnostic.path,
    name: diagnostic.collision?.name,
    winnerPath: diagnostic.collision?.winnerPath,
    loserPath: diagnostic.collision?.loserPath,
    source: diagnostic.collision?.winnerSource ?? diagnostic.collision?.loserSource,
  }));
}

function mapProgressEvent(event: ProgressEvent): PackageProgressData {
  return {
    type: event.type,
    action: event.action,
    source: event.source,
    message: event.message,
    timestamp: Date.now(),
  };
}

function inferConfiguredPackageScope(context: ResourceContext, source: string): PackageScope {
  const configured = context.packageManager.listConfiguredPackages()
    .find((pkg: any) => String(pkg.source ?? '') === source);
  return configured?.scope === 'project' ? 'project' : 'user';
}

type PackageSetting = string | ({ source: string } & PackageResourceFilterData);

function updateConfiguredPackage(
  context: ResourceContext,
  source: string,
  scope: PackageScope,
  updater: (pkg: PackageSetting) => PackageSetting,
): void {
  const settings = scope === 'project'
    ? context.settingsManager.getProjectSettings()
    : context.settingsManager.getGlobalSettings();
  const packages = (settings.packages ?? []) as PackageSetting[];
  let changed = false;
  const next = packages.map((pkg) => {
    if (sourceOfPackageSetting(pkg) !== source) return pkg;
    changed = true;
    return updater(pkg);
  });

  if (!changed) {
    throw new Error(`Package is not configured in ${scope} settings: ${source}`);
  }

  if (scope === 'project') {
    context.settingsManager.setProjectPackages(next);
  } else {
    context.settingsManager.setPackages(next);
  }
}

function configuredPackageFilter(context: ResourceContext, source: string, scope: PackageScope): PackageResourceFilterData | undefined {
  const settings = scope === 'project'
    ? context.settingsManager.getProjectSettings()
    : context.settingsManager.getGlobalSettings();
  const pkg = ((settings.packages ?? []) as PackageSetting[])
    .find((item) => sourceOfPackageSetting(item) === source);
  if (!pkg || typeof pkg === 'string') return undefined;
  return normalizePackageFilter(pkg);
}

function sourceOfPackageSetting(pkg: PackageSetting): string {
  return typeof pkg === 'string' ? pkg : pkg.source;
}

function normalizePackageFilter(value: unknown): PackageResourceFilterData | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as Partial<Record<typeof RESOURCE_TYPES[number], unknown>>;
  const next: PackageResourceFilterData = {};
  for (const key of RESOURCE_TYPES) {
    const raw = input[key];
    if (!Array.isArray(raw)) continue;
    next[key] = raw
      .map((item) => String(item ?? '').trim())
      .filter(Boolean);
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function isAllResourcesDisabled(filter: PackageResourceFilterData | undefined): boolean {
  return Boolean(filter && RESOURCE_TYPES.every((key) => Array.isArray(filter[key]) && filter[key]!.length === 0));
}

function packageFilterValue(value: unknown): PackageResourceFilterData | undefined {
  return normalizePackageFilter(value);
}

function resourceTrustKindValue(value: unknown): ResourceTrustKindData {
  if (value === 'package' || value === 'extension' || value === 'skill' || value === 'prompt' || value === 'theme') return value;
  throw new Error('Invalid trust resource kind.');
}

function resourceTrustDecisionValue(value: unknown): ResourceTrustDecisionData {
  if (value === 'trusted' || value === 'untrusted' || value === 'blocked') return value;
  throw new Error('Invalid trust decision.');
}

function buildMarketplace(packages: PackageData[]): MarketplacePackageData[] {
  const repoRoot = getRepoRoot();
  return MARKETPLACE_TEMPLATES.map((item) => {
    const resolved = resolveMarketplaceTemplateSource(item.relativePath);
    const source = resolved.source;
    const installed = packages.some((pkg) =>
      pkg.source === source ||
      resolved.candidates.some((candidate) => pkg.source === candidate) ||
      path.resolve(repoRoot, pkg.source) === source ||
      resolved.candidates.some((candidate) => path.resolve(repoRoot, pkg.source) === candidate) ||
      (pkg.installedPath ? resolved.candidates.some((candidate) => path.resolve(pkg.installedPath!) === candidate) : false)
    );
    return {
      id: item.id,
      name: item.name,
      source,
      description: item.description,
      tags: item.tags,
      recommendedScope: item.recommendedScope,
      trustLevel: item.trustLevel,
      installed,
      available: resolved.available,
      unavailableReason: resolved.unavailableReason,
    };
  });
}

function resolveMarketplaceTemplateSource(relativePath: string[]): { source: string; candidates: string[]; available: boolean; unavailableReason?: string } {
  const roots = Array.from(new Set([
    getRepoRoot(),
    process.cwd(),
    path.resolve(getRepoRoot(), '..'),
  ]));

  const candidates = roots.map((root) => path.join(root, ...relativePath));
  const existing = candidates.find((candidate) => existsSync(candidate));
  if (existing) return { source: existing, candidates, available: true };

  return {
    source: candidates[0]!,
    candidates,
    available: false,
    unavailableReason: 'Packaged marketplace resource is missing. Rebuild the desktop package with SDK examples included.',
  };
}

function buildTrustRecords(
  agentDir: string,
  resources: {
    packages: PackageData[];
    extensions: ExtensionData[];
    skills: SkillData[];
    prompts: PromptTemplateData[];
    themes: Array<ThemeData & { sourcePath?: string }>;
  },
): ResourceTrustRecordData[] {
  const existing = readTrustRecords(agentDir);
  const byId = new Map(existing.map((record) => [record.id, record]));
  const records: ResourceTrustRecordData[] = [];

  const add = (record: Omit<ResourceTrustRecordData, 'id' | 'decision' | 'updatedAt'> & { fallbackDecision?: ResourceTrustDecisionData }) => {
    const id = trustId(record.kind, record.source ?? record.path ?? record.name);
    const stored = byId.get(id);
    records.push({
      id,
      kind: record.kind,
      name: record.name,
      source: record.source,
      path: record.path,
      scope: record.scope,
      decision: stored?.decision ?? record.fallbackDecision ?? 'untrusted',
      updatedAt: stored?.updatedAt ?? 0,
      reason: stored?.reason,
    });
  };

  for (const pkg of resources.packages) {
    add({
      kind: 'package',
      name: pkg.name,
      source: pkg.source,
      path: pkg.installedPath,
      scope: pkg.scope,
      fallbackDecision: pkg.source.startsWith('.') || pkg.source.includes(`${path.sep}.pi${path.sep}`) ? 'trusted' : 'untrusted',
    });
  }
  for (const extension of resources.extensions) {
    add({
      kind: 'extension',
      name: extension.name,
      source: extension.sourceName,
      path: extension.path,
      scope: extension.scope,
      fallbackDecision: extension.source === 'local' ? 'trusted' : 'untrusted',
    });
  }
  for (const skill of resources.skills) {
    add({
      kind: 'skill',
      name: skill.name,
      source: skill.sourceName,
      path: skill.filePath,
      scope: skill.scope,
      fallbackDecision: skill.source === 'local' ? 'trusted' : 'untrusted',
    });
  }
  for (const prompt of resources.prompts) {
    add({
      kind: 'prompt',
      name: prompt.name,
      source: prompt.sourceName,
      path: prompt.filePath,
      scope: prompt.scope,
      fallbackDecision: prompt.source === 'local' ? 'trusted' : 'untrusted',
    });
  }
  for (const theme of resources.themes) {
    add({
      kind: 'theme',
      name: theme.name,
      path: theme.sourcePath ?? theme.vars?.sourcePath,
      fallbackDecision: 'trusted',
    });
  }

  const knownIds = new Set(records.map((record) => record.id));
  for (const record of existing) {
    if (!knownIds.has(record.id) && record.decision !== 'untrusted') records.push(record);
  }

  return records.sort((a, b) => {
    const decisionRank = (value: ResourceTrustDecisionData) => value === 'blocked' ? 0 : value === 'untrusted' ? 1 : 2;
    return decisionRank(a.decision) - decisionRank(b.decision) || a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name);
  });
}

function trustId(kind: ResourceTrustKindData, key: string): string {
  const normalized = String(key ?? '').trim().replace(/\\/g, '/').toLowerCase();
  return normalized ? `${kind}:${normalized}` : '';
}

function trustPath(agentDir: string): string {
  return path.join(agentDir, TRUST_FILE);
}

function readTrustRecords(agentDir: string): ResourceTrustRecordData[] {
  const file = trustPath(agentDir);
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTrustRecord);
  } catch {
    return [];
  }
}

function writeTrustRecords(agentDir: string, records: ResourceTrustRecordData[]): void {
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(trustPath(agentDir), `${JSON.stringify(records.filter(isTrustRecord), null, 2)}\n`, 'utf8');
}

function isTrustRecord(value: unknown): value is ResourceTrustRecordData {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<ResourceTrustRecordData>;
  return typeof item.id === 'string' &&
    (item.kind === 'package' || item.kind === 'extension' || item.kind === 'skill' || item.kind === 'prompt' || item.kind === 'theme') &&
    (item.decision === 'trusted' || item.decision === 'untrusted' || item.decision === 'blocked') &&
    typeof item.name === 'string';
}

function readPackageManifest(installedPath: string): { name?: string; version?: string } | null {
  const manifestPath = existsSync(installedPath) && statSync(installedPath).isDirectory()
    ? path.join(installedPath, 'package.json')
    : path.join(path.dirname(installedPath), 'package.json');

  if (!existsSync(manifestPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: string; version?: string };
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function mapKeys(value: unknown): string[] {
  if (value instanceof Map) return Array.from(value.keys()).map(String).sort();
  if (value && typeof value === 'object') return Object.keys(value).sort();
  return [];
}

function sourceScope(value: unknown): 'user' | 'project' | 'temporary' {
  return value === 'project' || value === 'temporary' ? value : 'user';
}

function displayNameFromSource(source: string): string {
  const trimmed = source.replace(/^(npm:|git:)/, '').replace(/^https?:\/\//, '');
  const isPathLike = path.isAbsolute(trimmed) || /[\\/]/.test(trimmed);
  const withoutRef = !isPathLike && trimmed.includes('@') && !trimmed.startsWith('@') ? trimmed.split('@')[0]! : trimmed;
  return path.basename(withoutRef.replace(/[\\/]+$/, '')) || source || 'package';
}

function normalizeSource(source: string): string {
  return source.trim();
}

function enforcePackageInstallTrust(context: ResourceContext, source: string, options: PackageOperationOptions): void {
  const trust = readTrustRecords(context.agentDir).find((record) => record.id === trustId('package', source));
  if (trust?.decision === 'blocked') {
    throw new Error('Package source is blocked by the Trust Center.');
  }

  if (
    trust?.decision === 'trusted' ||
    options.trustConfirmed === true ||
    isBundledMarketplaceSource(source) ||
    isSafeLocalPackageSource(context, source)
  ) {
    return;
  }

  throw new Error('Package install requires an explicit trust confirmation.');
}

function markPackageSourceTrusted(agentDir: string, source: string, scope: PackageScope | undefined): void {
  const id = trustId('package', source);
  if (!id) return;

  const records = readTrustRecords(agentDir);
  const existing = records.find((record) => record.id === id);
  if (existing?.decision === 'blocked') return;

  const next: ResourceTrustRecordData = {
    id,
    kind: 'package',
    name: displayNameFromSource(source),
    source,
    scope,
    decision: 'trusted',
    updatedAt: Date.now(),
    reason: 'Confirmed during package installation.',
  };
  writeTrustRecords(agentDir, [next, ...records.filter((record) => record.id !== id)]);
}

function isBundledMarketplaceSource(source: string): boolean {
  const repoRoot = getRepoRoot();
  const resolvedSource = resolveMaybeLocalSource(source, repoRoot);
  return MARKETPLACE_TEMPLATES.some((item) => {
    const templateSource = path.resolve(repoRoot, ...item.relativePath);
    return pathEquals(resolvedSource, templateSource);
  });
}

function isSafeLocalPackageSource(context: ResourceContext, source: string): boolean {
  const resolvedSource = resolveMaybeLocalSource(source, context.cwd);
  return isPathInside(path.join(context.cwd, '.pi', 'packages'), resolvedSource)
    || isPathInside(path.join(context.agentDir, 'packages'), resolvedSource);
}

function resolveMaybeLocalSource(source: string, baseDir: string): string {
  if (/^[a-z][a-z\d+.-]*:/i.test(source)) return source;
  return path.isAbsolute(source) ? path.resolve(source) : path.resolve(baseDir, source);
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function pathEquals(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}

function normalizeResourceName(value: string): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function yamlSingleLine(value: string): string {
  return JSON.stringify(String(value ?? '').replace(/\r?\n/g, ' ').trim());
}

function normalizeSlashName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function getRepoRoot(): string {
  const cwd = process.cwd();
  return path.basename(cwd).toLowerCase() === 'pi-server' ? path.dirname(cwd) : cwd;
}

function resolveProjectPath(projectPath: string | null | undefined): string {
  if (projectPath && projectPath !== '.') {
    return path.isAbsolute(projectPath) ? path.resolve(projectPath) : path.resolve(process.cwd(), projectPath);
  }
  return getRepoRoot();
}

function packageScopeValue(value: unknown): PackageScope | undefined {
  return value === 'project' || value === 'user' ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${name} is required.`);
  }
  return value.trim();
}

function json(status: number, body: unknown): ExtensionHttpResponse {
  return { status, body };
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += String(chunk);
      if (body.length > MAX_JSON_BODY_BYTES) {
        reject(new Error('Request body is too large.'));
      }
    });
    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(body);
        resolve(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}
