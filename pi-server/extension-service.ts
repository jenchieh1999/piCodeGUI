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

interface ExtensionHttpResponse {
  status: number;
  body: unknown;
}

type ProgressListener = (progress: PackageProgressData) => void;

const MAX_JSON_BODY_BYTES = 256 * 1024;
const TRUST_FILE = 'desktop-resource-trust.json';
const RESOURCE_TYPES = ['extensions', 'skills', 'prompts', 'themes'] as const;
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
    const themes = themeResult.themes.map(mapTheme);
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
    const name = path.basename(extension.path ?? extensionPath).replace(/\.[cm]?[jt]sx?$/i, '');
    return {
      name,
      path: extensionPath,
      enabled: true,
      scope: sourceScope(sourceInfo.scope),
      source: sourceInfo.origin === 'package' ? 'package' : 'local',
      sourceName: typeof sourceInfo.source === 'string' ? sourceInfo.source : undefined,
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

function mapTheme(theme: any): ThemeData & { sourceName?: string; sourcePath?: string } {
  const sourceInfo = theme.sourceInfo ?? {};
  return {
    name: String(theme.name ?? (theme.sourcePath ? path.basename(theme.sourcePath, path.extname(theme.sourcePath)) : 'unnamed')),
    vars: theme.sourcePath ? { sourcePath: String(theme.sourcePath) } : undefined,
    colors: {},
    sourceName: typeof sourceInfo.source === 'string' ? sourceInfo.source : undefined,
    sourcePath: typeof theme.sourcePath === 'string' ? theme.sourcePath : undefined,
  };
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
    const source = path.join(repoRoot, ...item.relativePath);
    const installed = packages.some((pkg) =>
      pkg.source === source ||
      path.resolve(repoRoot, pkg.source) === source ||
      (pkg.installedPath ? path.resolve(pkg.installedPath) === source : false)
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
    };
  });
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
    if (!knownIds.has(record.id)) records.push(record);
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
  const withoutRef = trimmed.includes('@') && !trimmed.startsWith('@') ? trimmed.split('@')[0]! : trimmed;
  return path.basename(withoutRef.replace(/[\\/]+$/, '')) || source || 'package';
}

function normalizeSource(source: string): string {
  return source.trim();
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
