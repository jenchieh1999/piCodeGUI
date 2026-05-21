// ============================================================
// Pi Desktop - Core Type Definitions
// ============================================================

// ---- Session & Messages ----

export interface Session {
  id: string;
  title: string;
  titleSource?: SessionTitleSource;
  projectPath: string;
  projectName: string;
  branch?: string;
  parentSessionId?: string;
  forkedFromMessageId?: string;
  forkedAt?: number;
  modelProvider?: string;
  modelId: string;
  thinkingLevel?: ThinkingLevel;
  createdAt: number;
  updatedAt: number;
  status: SessionStatus;
  messageCount: number;
}

export type SessionTitleSource = 'default' | 'auto' | 'manual';

export type SessionStatus = 'idle' | 'running' | 'error';

export interface SessionGroup {
  label: string;
  sessions: Session[];
}

// ---- Messages ----

export type MessageRole = 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: MessageContent[];
  timestamp: number;
  usage?: TokenUsage;
  thinking?: ThinkingBlock;
  toolCalls?: ToolCall[];
  isStreaming?: boolean;
}

export interface MessageContent {
  type: 'text' | 'image' | 'tool_use' | 'tool_result' | 'thinking' | 'permission_request';
  text?: string;
  image?: ImageAttachment;
  toolUse?: ToolUse;
  toolResult?: ToolResult;
  thinking?: ThinkingBlock;
  permissionRequest?: PermissionRequest;
}

export interface ThinkingBlock {
  content: string;
  isExpanded?: boolean;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: 'pending' | 'running' | 'success' | 'error';
  result?: ToolResult;
}

export interface ToolUse {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError: boolean;
  details?: Record<string, unknown>;
}

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  args: Record<string, unknown>;
  message: string;
  risk: 'low' | 'medium' | 'high';
  preview?: PermissionPreview;
}

export type PermissionPreview =
  | {
      kind: 'bash';
      command: string;
      cwd?: string;
    }
  | {
      kind: 'file';
      path: string;
      operation: 'edit' | 'write';
      diff?: string;
      summary?: string;
      truncated?: boolean;
    };

export type PermissionScope = 'session' | 'project' | 'global';

export interface PermissionRule {
  id: string;
  toolName: string;
  scope: PermissionScope;
  sessionId?: string;
  projectPath?: string;
  commandPrefix?: string;
  pathPattern?: string;
  riskMax: PermissionRequest['risk'];
  description: string;
  createdAt: number;
  updatedAt: number;
  useCount: number;
  lastUsedAt?: number;
}

export interface PermissionAuditEntry {
  id: string;
  timestamp: number;
  sessionId: string;
  projectPath?: string;
  toolName: string;
  action: PermissionResponse['action'];
  scope?: PermissionScope;
  risk: PermissionRequest['risk'];
  command?: string;
  path?: string;
  ruleId?: string;
  reason?: string;
  message?: string;
}

export type PermissionResponse = 
  | { action: 'allow'; requestId: string }
  | { action: 'always_allow'; requestId: string; scope?: PermissionScope }
  | { action: 'deny'; requestId: string };

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

export interface RuntimeInfo {
  mode: 'mock' | 'pi' | 'auto';
  active: 'mock' | 'pi';
  fallback: boolean;
  detail?: string;
}

export interface AuthProviderStatus {
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

export interface AuthStatusResult {
  providers: AuthProviderStatus[];
  modelsJsonPath?: string;
  modelsJsonError?: string;
}

export interface AuthProviderTestResult {
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

export interface SlashCommandInfo {
  name: string;
  description: string;
  category?: string;
  source?: 'runtime' | 'extension' | 'builtin' | 'skill' | 'prompt';
  insertText?: string;
}

export interface RecentProject {
  projectPath: string;
  realPath: string;
  projectName: string;
  branch: string | null;
  updatedAt: number;
  sessionCount: number;
  lastSessionId?: string;
  isGitRepo: boolean;
  missing?: boolean;
}

export interface RepositoryBranchInfo {
  name: string;
  current: boolean;
  local: boolean;
  remote: boolean;
  remoteRef?: string;
  checkedOut: boolean;
  worktreePath?: string;
}

export interface RepositoryWorktreeInfo {
  path: string;
  branch: string | null;
  current: boolean;
}

export interface RepositoryContextResult {
  state: 'ok' | 'not_git_repo' | 'missing_workdir' | 'error';
  workDir: string;
  repoRoot: string | null;
  repoName: string | null;
  currentBranch: string | null;
  defaultBranch: string | null;
  dirty: boolean;
  branches: RepositoryBranchInfo[];
  worktrees: RepositoryWorktreeInfo[];
  error?: string;
}

// ---- Model & Provider ----

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
}

export interface ProviderInfo {
  id: string;
  name: string;
  models: ModelInfo[];
}

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export type PermissionMode = 'ask' | 'acceptEdits' | 'plan' | 'bypassPermissions';

// ---- Theme ----

export interface PiTheme {
  name: string;
  vars?: Record<string, string>;
  colors: Record<string, string>;
  export?: {
    pageBg?: string;
    cardBg?: string;
    infoBg?: string;
  };
}

export type ChannelProvider = 'feishu' | 'wechat';

export interface ChannelConfig {
  id: string;
  provider: ChannelProvider;
  name: string;
  enabled: boolean;
  webhookUrl?: string;
  verificationToken?: string;
  signingSecret?: string;
  encryptionKey?: string;
  appId?: string;
  appSecret?: string;
  wechatBotToken?: string;
  wechatBotId?: string;
  wechatUserId?: string;
  wechatBaseUrl?: string;
  wechatSyncCursor?: string;
  defaultRecipientId?: string;
  lastRecipientId?: string;
  lastContextToken?: string;
  pairingCode?: string;
  pairingExpiresAt?: number;
  defaultProjectPath?: string;
  defaultSessionId?: string;
  sessionBindings?: Record<string, string>;
  autoCreateSession: boolean;
  createdAt: number;
  updatedAt: number;
  lastEventAt?: number;
  lastError?: string;
  lastTestAt?: number;
}

export interface ChannelInput {
  provider?: ChannelProvider;
  name?: string;
  enabled?: boolean;
  webhookUrl?: string;
  verificationToken?: string;
  signingSecret?: string;
  encryptionKey?: string;
  appId?: string;
  appSecret?: string;
  defaultRecipientId?: string;
  defaultProjectPath?: string;
  defaultSessionId?: string;
  autoCreateSession?: boolean;
}

export interface ChannelTestResult {
  ok: boolean;
  message: string;
  channel?: ChannelConfig;
}

export interface ChannelPairingResult {
  ok: boolean;
  message: string;
  channel?: ChannelConfig;
  pairingCode?: string;
  expiresAt?: number;
}

export interface ChannelWechatQrStartResult {
  ok: boolean;
  message: string;
  channel?: ChannelConfig;
  sessionKey?: string;
  qrcodeUrl?: string;
  expiresAt?: number;
}

export interface ChannelWechatQrStatusResult {
  ok: boolean;
  message: string;
  channel?: ChannelConfig;
  status?: string;
  connected?: boolean;
  alreadyConnected?: boolean;
  sessionKey?: string;
  needsVerifyCode?: boolean;
}

// ---- Agents ----

export type AgentRole =
  | 'main'
  | 'subagent'
  | 'planner'
  | 'implementer'
  | 'reviewer'
  | 'tester'
  | 'documenter'
  | 'researcher'
  | 'custom';

export interface AgentSubAgentConfig {
  enabled: boolean;
  autoDelegate: boolean;
  triggers: string[];
  maxParallel: number;
  reviewRequired: boolean;
  outputContract: string;
}

export interface AgentSelfImprovementConfig {
  enabled: boolean;
  captureCorrections: boolean;
  captureFailures: boolean;
  projectMemory: boolean;
  includeRecentLearnings: boolean;
}

export interface AgentLearningRecord {
  id: string;
  type: 'correction' | 'failure' | 'preference' | 'workflow' | 'insight';
  title: string;
  content: string;
  projectPath?: string;
  agentId?: string;
  tags: string[];
  createdAt: number;
  source: 'manual' | 'auto';
}

export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  enabled: boolean;
  role: AgentRole;
  parentAgentId?: string;
  subAgent: AgentSubAgentConfig;
  selfImprovement: AgentSelfImprovementConfig;
  modelProvider?: string;
  modelId?: string;
  projectPath?: string;
  channelIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface AgentInput {
  name?: string;
  description?: string;
  systemPrompt?: string;
  enabled?: boolean;
  role?: AgentRole;
  parentAgentId?: string;
  subAgent?: Partial<AgentSubAgentConfig>;
  selfImprovement?: Partial<AgentSelfImprovementConfig>;
  modelProvider?: string;
  modelId?: string;
  projectPath?: string;
  channelIds?: string[];
}

export type AgentRoomMode = 'balanced' | 'technical_decision' | 'research' | 'code_review' | 'custom';
export type AgentRoomStatus = 'idle' | 'planning' | 'researching' | 'debating' | 'reviewing' | 'completed' | 'failed' | 'cancelled';
export type AgentRoomRunStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type AgentRoomStage =
  | 'intake'
  | 'planning'
  | 'left_research'
  | 'right_research'
  | 'left_synthesis'
  | 'right_synthesis'
  | 'debate'
  | 'neutral_review'
  | 'final_report'
  | 'memory';
export type AgentRoomGroup = 'moderator' | 'left' | 'right' | 'neutral' | 'system';

export interface ModelRef {
  provider: string;
  id: string;
}

export interface AgentRoomConfig {
  debateRounds: number;
  maxParallel: number;
  quickModel?: ModelRef;
  deepModel?: ModelRef;
  useWebSearch: boolean;
  useWorkspaceSearch: boolean;
  persistMemory: boolean;
  tokenBudget: number;
  requirePermissionForExternalSearch: boolean;
  stopOnHighRiskTool: boolean;
}

export interface AgentRoom {
  id: string;
  title: string;
  sessionId?: string;
  projectPath?: string;
  question: string;
  mode: AgentRoomMode;
  status: AgentRoomStatus;
  leftLabel: string;
  rightLabel: string;
  neutralLabel: string;
  config: AgentRoomConfig;
  createdAt: number;
  updatedAt: number;
}

export interface AgentRoomRun {
  id: string;
  roomId: string;
  status: AgentRoomRunStatus;
  currentStage: AgentRoomStage;
  currentRound: number;
  startedAt: number;
  completedAt?: number;
  error?: string;
  tokenUsage?: TokenUsage;
}

export interface AgentRoomMessage {
  id: string;
  roomId: string;
  runId: string;
  group: AgentRoomGroup;
  agentId: string;
  agentName: string;
  role: string;
  stage: AgentRoomStage;
  round?: number;
  content: MessageContent[];
  artifactIds: string[];
  timestamp: number;
  isStreaming?: boolean;
}

export interface AgentRoomCitation {
  id: string;
  title: string;
  source: string;
  kind: 'web' | 'workspace' | 'memory' | 'user' | 'mock' | 'model';
}

export interface AgentRoomArtifact {
  id: string;
  roomId: string;
  runId: string;
  group: Exclude<AgentRoomGroup, 'system' | 'moderator'>;
  agentId: string;
  type: 'evidence' | 'claim' | 'counterclaim' | 'risk' | 'summary' | 'final_report';
  title: string;
  content: string;
  citations: AgentRoomCitation[];
  confidence: number;
  createdAt: number;
}

export interface AgentRoomTask {
  id: string;
  roomId: string;
  runId: string;
  group: Exclude<AgentRoomGroup, 'system' | 'moderator'>;
  agentRole: string;
  title: string;
  prompt: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'skipped' | 'cancelled';
  dependencies: string[];
  outputArtifactIds: string[];
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface AgentRoomSnapshot {
  rooms: AgentRoom[];
  runsByRoom: Record<string, AgentRoomRun[]>;
  messagesByRoom: Record<string, AgentRoomMessage[]>;
  artifactsByRoom: Record<string, AgentRoomArtifact[]>;
  tasksByRoom: Record<string, AgentRoomTask[]>;
}

export interface AgentRoomCreateInput {
  sessionId?: string;
  projectPath?: string;
  title?: string;
  question: string;
  mode?: AgentRoomMode;
  leftLabel?: string;
  rightLabel?: string;
  neutralLabel?: string;
  debateRounds?: number;
  maxParallel?: number;
  quickModel?: ModelRef;
  deepModel?: ModelRef;
  useWebSearch?: boolean;
  useWorkspaceSearch?: boolean;
  persistMemory?: boolean;
}

export interface ServerDiagnostics {
  ok: boolean;
  server: {
    pid: number;
    host: string;
    port: number;
    uptimeSec: number;
    node: string;
    platform: string;
    dataDir: string;
  };
  security: {
    authEnabled: boolean;
    cors: string;
    publicEndpoints: string[];
  };
  runtime: {
    mode: string;
    permissionMode: string;
  };
  sdk: {
    available: boolean;
    exports?: {
      AuthStorage: boolean;
      ModelRegistry: boolean;
    };
    error?: string;
  };
  counts: {
    sessions: number;
    channels: number;
    agents: number;
    permissionRules: number;
    permissionAuditEntries: number;
    packages: number;
    extensions: number;
    skills?: number;
    prompts?: number;
    resourceDiagnostics?: number;
    themes: number;
  };
  providers: Array<{
    id: string;
    name: string;
    models: number;
  }>;
}

// ---- Extensions & Packages ----

export interface ExtensionInfo {
  name: string;
  path: string;
  enabled: boolean;
  scope: 'user' | 'project' | 'temporary';
  source: 'package' | 'local';
  sourceName?: string;
  origin?: 'package' | 'top-level';
  description?: string;
  tools?: string[];
  commands?: string[];
  flags?: string[];
  shortcuts?: string[];
  errors?: string[];
}

export interface SkillInfo {
  name: string;
  description: string;
  filePath: string;
  baseDir?: string;
  enabled: boolean;
  scope: 'user' | 'project' | 'temporary';
  source: 'package' | 'local';
  sourceName?: string;
  origin?: 'package' | 'top-level';
  disableModelInvocation?: boolean;
  command?: string;
}

export interface PackageInfo {
  name: string;
  version: string;
  source: string;
  scope?: 'user' | 'project' | 'temporary';
  installedPath?: string;
  filtered?: boolean;
  filter?: PackageResourceFilter;
  disabled?: boolean;
  installedAt: number;
  extensions: string[];
  skills: string[];
  prompts: string[];
  themes: string[];
}

export interface PackageResourceFilter {
  extensions?: string[];
  skills?: string[];
  prompts?: string[];
  themes?: string[];
}

export interface PromptTemplateInfo {
  name: string;
  description: string;
  argumentHint?: string;
  filePath: string;
  enabled: boolean;
  scope: 'user' | 'project' | 'temporary';
  source: 'package' | 'local';
  sourceName?: string;
  origin?: 'package' | 'top-level';
  command: string;
}

export interface ResourceDiagnosticInfo {
  type: 'info' | 'warning' | 'error' | 'collision';
  resourceType?: 'extension' | 'skill' | 'prompt' | 'theme' | 'package';
  message: string;
  path?: string;
  source?: string;
  name?: string;
  winnerPath?: string;
  loserPath?: string;
}

export interface PackageProgressInfo {
  type: 'start' | 'progress' | 'complete' | 'error';
  action: 'install' | 'remove' | 'update' | 'clone' | 'pull' | 'reload';
  source: string;
  message?: string;
  timestamp: number;
}

export interface ExtensionResourceSnapshot {
  projectPath: string;
  packages: PackageInfo[];
  extensions: ExtensionInfo[];
  skills: SkillInfo[];
  prompts: PromptTemplateInfo[];
  themes: PiTheme[];
  diagnostics: ResourceDiagnosticInfo[];
  slashCommands: SlashCommandInfo[];
  marketplace: MarketplacePackageInfo[];
  trust: ResourceTrustRecord[];
}

export type ResourceTrustDecision = 'trusted' | 'untrusted' | 'blocked';
export type ResourceTrustKind = 'package' | 'extension' | 'skill' | 'prompt' | 'theme';

export interface ResourceTrustRecord {
  id: string;
  kind: ResourceTrustKind;
  name: string;
  source?: string;
  path?: string;
  decision: ResourceTrustDecision;
  scope?: 'user' | 'project' | 'temporary';
  updatedAt: number;
  reason?: string;
}

export interface MarketplacePackageInfo {
  id: string;
  name: string;
  source: string;
  description: string;
  tags: string[];
  recommendedScope: 'user' | 'project';
  trustLevel: 'official' | 'community' | 'local';
  installed: boolean;
  available?: boolean;
  unavailableReason?: string;
}

export interface SkillHubItem {
  id: string;
  provider: 'clawhub' | 'skillhub' | 'curated';
  name: string;
  displayName: string;
  description: string;
  author?: string;
  url?: string;
  version?: string;
  tags: string[];
  downloads?: number;
  installs?: number;
  stars?: number;
  updatedAt?: number;
  score?: number;
  installSource?: string;
  installed?: boolean;
  sourceLabel?: string;
}

export interface SkillHubSearchResult {
  query: string;
  items: SkillHubItem[];
  source: 'clawhub' | 'skillhub' | 'curated' | 'mixed';
  usedFallback: boolean;
  message?: string;
}

export interface SkillHubStatus {
  endpoint: string;
  apiKeyConfigured: boolean;
  defaultProvider: 'clawhub' | 'skillhub';
  curatedCount: number;
}

// ---- Scheduled Tasks ----

export interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  cronExpression: string;
  daysOfWeek: number[];
  modelId: string;
  permissionMode: PermissionMode;
  enabled: boolean;
  lastRunAt?: number;
  nextRunAt?: number;
}

export interface TaskRun {
  id: string;
  taskId: string;
  startedAt: number;
  finishedAt?: number;
  status: 'running' | 'success' | 'error';
  error?: string;
}

// ---- File & Git ----

export interface FileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  oldPath?: string;
}

export interface GitInfo {
  repoName: string;
  branch: string;
  remoteUrl?: string;
  changes: FileChange[];
}

// ---- Workspace Browser ----

export type WorkspaceFileStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'copied'
  | 'type_changed'
  | 'unknown';

export interface WorkspaceChangedFile {
  path: string;
  oldPath?: string;
  status: WorkspaceFileStatus;
  additions: number;
  deletions: number;
  staged?: boolean;
  unstaged?: boolean;
}

export interface WorkspaceStatusResult {
  state: 'ok' | 'not_git_repo' | 'missing_workdir' | 'error';
  workDir: string;
  repoName: string | null;
  branch: string | null;
  upstream?: string | null;
  ahead?: number;
  behind?: number;
  hasStagedChanges?: boolean;
  hasUnstagedChanges?: boolean;
  isGitRepo: boolean;
  changedFiles: WorkspaceChangedFile[];
  error?: string;
}

export type WorkspaceChangeAction = 'accept' | 'discard' | 'unstage';

export interface WorkspaceChangeOperationResult {
  state: 'ok' | 'not_git_repo' | 'missing_workdir' | 'error';
  action: WorkspaceChangeAction;
  path: string;
  status?: WorkspaceFileStatus;
  statusResult?: WorkspaceStatusResult;
  error?: string;
}

export type WorkspaceGitOperationAction = 'stage_all' | 'unstage_all' | 'commit' | 'pull' | 'push';

export interface WorkspaceGitOperationResult {
  state: 'ok' | 'not_git_repo' | 'missing_workdir' | 'error';
  action: WorkspaceGitOperationAction;
  output?: string;
  statusResult?: WorkspaceStatusResult;
  error?: string;
}

export interface WorkspaceDeleteFileResult {
  state: 'ok' | 'missing' | 'error';
  path: string;
  error?: string;
}

export interface WorkspaceMoveFileResult {
  state: 'ok' | 'missing' | 'conflict' | 'error';
  sourcePath: string;
  targetPath: string;
  error?: string;
}

export interface WorkspaceTreeEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface WorkspaceTreeResult {
  state: 'ok' | 'missing' | 'error';
  path: string;
  entries: WorkspaceTreeEntry[];
  error?: string;
}

export interface WorkspaceReadFileResult {
  state: 'ok' | 'binary' | 'too_large' | 'missing' | 'error';
  path: string;
  previewType?: 'text' | 'image';
  content?: string;
  dataUrl?: string;
  mimeType?: string;
  language: string;
  size: number;
  truncated?: boolean;
  readBytes?: number;
  error?: string;
}

export interface WorkspaceWriteFileResult {
  state: 'ok' | 'missing' | 'error';
  path: string;
  size: number;
  updatedAt: number;
  error?: string;
}

export interface WorkspaceDiffResult {
  state: 'ok' | 'missing' | 'not_git_repo' | 'error';
  path: string;
  diff?: string;
  error?: string;
}

export interface WorkspaceSearchResult {
  state: 'ok' | 'missing' | 'error';
  query: string;
  files: WorkspaceTreeEntry[];
  error?: string;
}

export interface PromptOptimizeInput {
  text: string;
  projectName?: string;
  projectPath?: string;
  language?: 'zh' | 'en' | 'ja';
  hasFileReferences?: boolean;
  hasImages?: boolean;
  selectionOnly?: boolean;
  sessionId?: string;
  currentModel?: {
    provider: string;
    id: string;
  };
}

export interface PromptOptimizeResult {
  optimized: string;
  source: 'model' | 'local';
  durationMs: number;
  provider?: string;
  modelId?: string;
  warning?: string;
}

// ---- WebSocket Protocol ----

export type WsClientMessage =
  | { type: 'prompt'; sessionId: string; message: string; images?: ImageAttachment[] }
  | { type: 'steer'; sessionId: string; message: string; images?: ImageAttachment[] }
  | { type: 'follow_up'; sessionId: string; message: string; images?: ImageAttachment[] }
  | { type: 'permission_response'; sessionId: string; response: PermissionResponse }
  | { type: 'set_permission_mode'; mode: PermissionMode }
  | { type: 'stop_generation'; sessionId: string }
  | { type: 'set_model'; modelId: string; provider: string; sessionId?: string }
  | { type: 'auth_refresh' }
  | { type: 'set_thinking_level'; level: ThinkingLevel; sessionId?: string }
  | { type: 'session_create'; projectPath: string; branch?: string | null; worktree?: boolean }
  | { type: 'session_delete'; sessionId: string }
  | { type: 'session_clear'; sessionId: string }
  | { type: 'session_rename'; sessionId: string; title: string }
  | { type: 'session_tree_navigate'; sessionId: string; targetId: string }
  | { type: 'session_compact'; sessionId: string }
  | { type: 'session_fork'; sessionId: string; entryId: string }
  | { type: 'package_install'; source: string; scope?: 'user' | 'project'; projectPath?: string; trustConfirmed?: boolean }
  | { type: 'package_remove'; source: string; scope?: 'user' | 'project'; projectPath?: string }
  | { type: 'package_update'; source?: string; projectPath?: string }
  | { type: 'resources_reload'; projectPath?: string }
  | { type: 'theme_set'; name: string }
  | { type: 'terminal_start'; sessionId: string; terminalId?: string; cols?: number; rows?: number; replay?: boolean }
  | { type: 'terminal_input'; terminalId: string; data: string }
  | { type: 'terminal_resize'; terminalId: string; cols: number; rows: number }
  | { type: 'terminal_stop'; terminalId: string }
  | { type: 'ping' };

export type WsServerMessage =
  | {
      type: 'connected';
      sessions: Session[];
      currentModel: ModelInfo;
      thinkingLevel: ThinkingLevel;
      providers?: ProviderInfo[];
      packages?: PackageInfo[];
      extensions?: ExtensionInfo[];
      skills?: SkillInfo[];
      prompts?: PromptTemplateInfo[];
      themes?: PiTheme[];
      resourceDiagnostics?: ResourceDiagnosticInfo[];
      marketplace?: MarketplacePackageInfo[];
      trust?: ResourceTrustRecord[];
      messagesBySession?: Record<string, ChatMessage[]>;
      agentRooms?: AgentRoomSnapshot;
      runtimeInfo?: RuntimeInfo;
      slashCommands?: SlashCommandInfo[];
    }
  | { type: 'status'; sessionId: string; status: SessionStatus; detail?: string }
  | { type: 'text_delta'; sessionId: string; delta: string }
  | { type: 'text_start'; sessionId: string; messageId: string }
  | { type: 'text_end'; sessionId: string; messageId: string }
  | { type: 'thinking_delta'; sessionId: string; delta: string }
  | { type: 'thinking_start'; sessionId: string }
  | { type: 'thinking_end'; sessionId: string }
  | { type: 'tool_use'; sessionId: string; toolCall: ToolUse }
  | { type: 'tool_result'; sessionId: string; result: ToolResult }
  | { type: 'permission_request'; sessionId: string; request: PermissionRequest }
  | { type: 'message_complete'; sessionId: string; messageId: string; usage: TokenUsage }
  | { type: 'message_added'; sessionId: string; message: ChatMessage }
  | { type: 'session_updated'; session: Session }
  | { type: 'session_created'; session: Session; messages?: ChatMessage[] }
  | { type: 'session_deleted'; sessionId: string }
  | { type: 'session_cleared'; sessionId: string }
  | { type: 'queue_update'; sessionId: string; steering: number; followUp: number }
  | { type: 'compaction_start'; sessionId: string }
  | { type: 'compaction_end'; sessionId: string }
  | { type: 'error'; sessionId?: string; message: string; code?: string }
  | { type: 'pong' }
  | { type: 'model_updated'; model: ModelInfo; thinkingLevel: ThinkingLevel; sessionId?: string }
  | { type: 'providers_updated'; providers: ProviderInfo[] }
  | { type: 'themes_updated'; themes: PiTheme[] }
  | { type: 'packages_updated'; packages: PackageInfo[] }
  | { type: 'extensions_updated'; extensions: ExtensionInfo[] }
  | { type: 'skills_updated'; skills: SkillInfo[] }
  | { type: 'prompts_updated'; prompts: PromptTemplateInfo[] }
  | { type: 'resource_diagnostics_updated'; diagnostics: ResourceDiagnosticInfo[] }
  | { type: 'marketplace_updated'; marketplace: MarketplacePackageInfo[] }
  | { type: 'resource_trust_updated'; trust: ResourceTrustRecord[] }
  | { type: 'package_progress'; progress: PackageProgressInfo }
  | { type: 'runtime_updated'; runtimeInfo: RuntimeInfo }
  | { type: 'slash_commands_updated'; commands: SlashCommandInfo[] }
  | { type: 'file_changes'; sessionId: string; changes: FileChange[] }
  | { type: 'git_info'; sessionId: string; git: GitInfo }
  | { type: 'terminal_started'; sessionId: string; terminalId: string; cwd: string; shell: string; backend: 'pty' | 'pipe' }
  | { type: 'terminal_output'; terminalId: string; data: string }
  | { type: 'terminal_exited'; terminalId: string; exitCode: number | null; signal: string | null }
  | { type: 'terminal_error'; sessionId?: string; terminalId?: string; message: string }
  | { type: 'agent_room_snapshot'; snapshot: AgentRoomSnapshot }
  | { type: 'agent_room_created'; room: AgentRoom }
  | { type: 'agent_room_updated'; room: AgentRoom }
  | { type: 'agent_room_deleted'; roomId: string }
  | { type: 'agent_room_run_started'; room: AgentRoom; run: AgentRoomRun }
  | { type: 'agent_room_run_updated'; room: AgentRoom; run: AgentRoomRun }
  | { type: 'agent_room_stage_changed'; roomId: string; runId: string; stage: AgentRoomStage; status: AgentRoomStatus; round?: number }
  | { type: 'agent_room_task_started'; task: AgentRoomTask }
  | { type: 'agent_room_task_completed'; task: AgentRoomTask }
  | { type: 'agent_room_message_added'; message: AgentRoomMessage }
  | { type: 'agent_room_artifact_added'; artifact: AgentRoomArtifact }
  | { type: 'agent_room_debate_round_completed'; roomId: string; runId: string; round: number }
  | { type: 'agent_room_final_report_ready'; roomId: string; runId: string; artifact: AgentRoomArtifact }
  | { type: 'agent_room_run_failed'; room: AgentRoom; run: AgentRoomRun; message: string }
  | { type: 'agent_room_run_cancelled'; room: AgentRoom; run: AgentRoomRun };

export interface ImageAttachment {
  data: string;
  mimeType: string;
  fileName?: string;
}

// ---- Utility ----

export interface AutocompleteItem {
  value: string;
  label: string;
  description?: string;
  icon?: string;
}

export type ViewType = 'chat' | 'settings' | 'tasks' | 'packages' | 'themes' | 'extensions' | 'agents' | 'agentRooms' | 'skills';

export type RightPanelType = 'changes' | 'files' | 'tree' | 'usage' | 'terminal' | null;

export interface AppSettings {
  theme: string;
  language: 'en' | 'zh' | 'ja';
  fontSize: number;
  fontFamily: string;
  monoFontFamily: string;
  permissionMode: PermissionMode;
  sidebarWidth: number;
  rightPanelWidth: number;
  rightPanelType: RightPanelType;
  showThinking: boolean;
  compactOnOverflow: boolean;
  chatBackgroundImage: string;
  chatBackgroundDim: number;
}
