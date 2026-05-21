// ============================================================
// Pi Agent Server - Types (shared with frontend)
// ============================================================

export interface SessionData {
  id: string;
  title: string;
  titleSource?: SessionTitleSourceData;
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
  status: 'idle' | 'running' | 'error';
  messageCount: number;
}

export type SessionTitleSourceData = 'default' | 'auto' | 'manual';

export interface ModelData {
  id: string;
  name: string;
  provider: string;
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

export interface ProviderData {
  id: string;
  name: string;
  models: ModelData[];
}

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface PackageData {
  name: string;
  version: string;
  source: string;
  scope?: 'user' | 'project' | 'temporary';
  installedPath?: string;
  filtered?: boolean;
  filter?: PackageResourceFilterData;
  disabled?: boolean;
  installedAt: number;
  extensions: string[];
  skills: string[];
  prompts: string[];
  themes: string[];
}

export interface PackageResourceFilterData {
  extensions?: string[];
  skills?: string[];
  prompts?: string[];
  themes?: string[];
}

export interface ExtensionData {
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

export interface SkillData {
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

export interface PromptTemplateData {
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

export interface ResourceDiagnosticData {
  type: 'info' | 'warning' | 'error' | 'collision';
  resourceType?: 'extension' | 'skill' | 'prompt' | 'theme' | 'package';
  message: string;
  path?: string;
  source?: string;
  name?: string;
  winnerPath?: string;
  loserPath?: string;
}

export interface PackageProgressData {
  type: 'start' | 'progress' | 'complete' | 'error';
  action: 'install' | 'remove' | 'update' | 'clone' | 'pull' | 'reload';
  source: string;
  message?: string;
  timestamp: number;
}

export interface ExtensionResourceSnapshotData {
  projectPath: string;
  packages: PackageData[];
  extensions: ExtensionData[];
  skills: SkillData[];
  prompts: PromptTemplateData[];
  themes: ThemeData[];
  diagnostics: ResourceDiagnosticData[];
  slashCommands: SlashCommandData[];
  marketplace: MarketplacePackageData[];
  trust: ResourceTrustRecordData[];
}

export type ResourceTrustDecisionData = 'trusted' | 'untrusted' | 'blocked';
export type ResourceTrustKindData = 'package' | 'extension' | 'skill' | 'prompt' | 'theme';

export interface ResourceTrustRecordData {
  id: string;
  kind: ResourceTrustKindData;
  name: string;
  source?: string;
  path?: string;
  decision: ResourceTrustDecisionData;
  scope?: 'user' | 'project' | 'temporary';
  updatedAt: number;
  reason?: string;
}

export interface MarketplacePackageData {
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

export interface SkillHubItemData {
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

export interface SkillHubSearchResultData {
  query: string;
  items: SkillHubItemData[];
  source: 'clawhub' | 'skillhub' | 'curated' | 'mixed';
  usedFallback: boolean;
  message?: string;
}

export interface SkillHubStatusData {
  endpoint: string;
  apiKeyConfigured: boolean;
  defaultProvider: 'clawhub' | 'skillhub';
  curatedCount: number;
}

export interface ThemeData {
  name: string;
  vars?: Record<string, string>;
  colors: Record<string, string>;
}

export type ChannelProviderData = 'feishu' | 'wechat';

export interface ChannelConfigData {
  id: string;
  provider: ChannelProviderData;
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

export interface ChannelInboundEventData {
  channelId: string;
  provider: ChannelProviderData;
  text: string;
  chatId?: string;
  userId?: string;
  userName?: string;
  messageId?: string;
  contextToken?: string;
  replyFromUserId?: string;
  replyToUserId?: string;
  raw?: unknown;
}

export type AgentRoleData =
  | 'main'
  | 'subagent'
  | 'planner'
  | 'implementer'
  | 'reviewer'
  | 'tester'
  | 'documenter'
  | 'researcher'
  | 'custom';

export interface AgentSubAgentConfigData {
  enabled: boolean;
  autoDelegate: boolean;
  triggers: string[];
  maxParallel: number;
  reviewRequired: boolean;
  outputContract: string;
}

export interface AgentSelfImprovementConfigData {
  enabled: boolean;
  captureCorrections: boolean;
  captureFailures: boolean;
  projectMemory: boolean;
  includeRecentLearnings: boolean;
}

export interface AgentLearningRecordData {
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

export interface AgentConfigData {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  enabled: boolean;
  role: AgentRoleData;
  parentAgentId?: string;
  subAgent: AgentSubAgentConfigData;
  selfImprovement: AgentSelfImprovementConfigData;
  modelProvider?: string;
  modelId?: string;
  projectPath?: string;
  channelIds: string[];
  createdAt: number;
  updatedAt: number;
}

export type AgentRoomModeData = 'balanced' | 'technical_decision' | 'research' | 'code_review' | 'custom';
export type AgentRoomStatusData = 'idle' | 'planning' | 'researching' | 'debating' | 'reviewing' | 'completed' | 'failed' | 'cancelled';
export type AgentRoomRunStatusData = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type AgentRoomStageData =
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
export type AgentRoomGroupData = 'moderator' | 'left' | 'right' | 'neutral' | 'system';

export interface ModelRefData {
  provider: string;
  id: string;
}

export interface AgentRoomConfigData {
  debateRounds: number;
  maxParallel: number;
  quickModel?: ModelRefData;
  deepModel?: ModelRefData;
  useWebSearch: boolean;
  useWorkspaceSearch: boolean;
  persistMemory: boolean;
  tokenBudget: number;
  requirePermissionForExternalSearch: boolean;
  stopOnHighRiskTool: boolean;
}

export interface AgentRoomData {
  id: string;
  title: string;
  sessionId?: string;
  projectPath?: string;
  question: string;
  mode: AgentRoomModeData;
  status: AgentRoomStatusData;
  leftLabel: string;
  rightLabel: string;
  neutralLabel: string;
  config: AgentRoomConfigData;
  createdAt: number;
  updatedAt: number;
}

export interface AgentRoomRunData {
  id: string;
  roomId: string;
  status: AgentRoomRunStatusData;
  currentStage: AgentRoomStageData;
  currentRound: number;
  startedAt: number;
  completedAt?: number;
  error?: string;
  tokenUsage?: TokenUsageData;
}

export interface AgentRoomMessageData {
  id: string;
  roomId: string;
  runId: string;
  group: AgentRoomGroupData;
  agentId: string;
  agentName: string;
  role: string;
  stage: AgentRoomStageData;
  round?: number;
  content: MessageContentData[];
  artifactIds: string[];
  timestamp: number;
  isStreaming?: boolean;
}

export interface AgentRoomCitationData {
  id: string;
  title: string;
  source: string;
  kind: 'web' | 'workspace' | 'memory' | 'user' | 'mock' | 'model';
}

export interface AgentRoomArtifactData {
  id: string;
  roomId: string;
  runId: string;
  group: Exclude<AgentRoomGroupData, 'system' | 'moderator'>;
  agentId: string;
  type: 'evidence' | 'claim' | 'counterclaim' | 'risk' | 'summary' | 'final_report';
  title: string;
  content: string;
  citations: AgentRoomCitationData[];
  confidence: number;
  createdAt: number;
}

export interface AgentRoomTaskData {
  id: string;
  roomId: string;
  runId: string;
  group: Exclude<AgentRoomGroupData, 'system' | 'moderator'>;
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

export interface AgentRoomSnapshotData {
  rooms: AgentRoomData[];
  runsByRoom: Record<string, AgentRoomRunData[]>;
  messagesByRoom: Record<string, AgentRoomMessageData[]>;
  artifactsByRoom: Record<string, AgentRoomArtifactData[]>;
  tasksByRoom: Record<string, AgentRoomTaskData[]>;
}

export interface AgentRoomCreateInputData {
  sessionId?: string;
  projectPath?: string;
  title?: string;
  question: string;
  mode?: AgentRoomModeData;
  leftLabel?: string;
  rightLabel?: string;
  neutralLabel?: string;
  debateRounds?: number;
  maxParallel?: number;
  quickModel?: ModelRefData;
  deepModel?: ModelRefData;
  useWebSearch?: boolean;
  useWorkspaceSearch?: boolean;
  persistMemory?: boolean;
}

export interface FileChangeData {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  oldPath?: string;
}

export interface GitData {
  repoName: string;
  branch: string;
  remoteUrl?: string;
  changes: FileChangeData[];
}

export interface ToolUseData {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResultData {
  toolCallId: string;
  content: string;
  isError: boolean;
  details?: Record<string, unknown>;
}

export interface PermissionRequestData {
  requestId: string;
  toolName: string;
  args: Record<string, unknown>;
  message: string;
  risk: 'low' | 'medium' | 'high';
  preview?: PermissionPreviewData;
}

export type PermissionPreviewData =
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

export type PermissionScopeData = 'session' | 'project' | 'global';

export interface PermissionRuleData {
  id: string;
  toolName: string;
  scope: PermissionScopeData;
  sessionId?: string;
  projectPath?: string;
  commandPrefix?: string;
  pathPattern?: string;
  riskMax: PermissionRequestData['risk'];
  description: string;
  createdAt: number;
  updatedAt: number;
  useCount: number;
  lastUsedAt?: number;
}

export interface PermissionAuditEntryData {
  id: string;
  timestamp: number;
  sessionId: string;
  projectPath?: string;
  toolName: string;
  action: PermissionAction;
  scope?: PermissionScopeData;
  risk: PermissionRequestData['risk'];
  command?: string;
  path?: string;
  ruleId?: string;
  reason?: string;
  message?: string;
}

export interface TokenUsageData {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

export type MessageRoleData = 'user' | 'assistant' | 'tool';

export interface ThinkingBlockData {
  content: string;
  isExpanded?: boolean;
}

export interface MessageContentData {
  type: 'text' | 'image' | 'tool_use' | 'tool_result' | 'thinking' | 'permission_request';
  text?: string;
  image?: ImageAttachmentData;
  toolUse?: ToolUseData;
  toolResult?: ToolResultData;
  thinking?: ThinkingBlockData;
  permissionRequest?: PermissionRequestData;
}

export interface ImageAttachmentData {
  data: string;
  mimeType: string;
  fileName?: string;
}

export interface ToolCallData extends ToolUseData {
  status: 'pending' | 'running' | 'success' | 'error';
  result?: ToolResultData;
}

export interface ChatMessageData {
  id: string;
  sessionId: string;
  role: MessageRoleData;
  content: MessageContentData[];
  timestamp: number;
  usage?: TokenUsageData;
  thinking?: ThinkingBlockData;
  toolCalls?: ToolCallData[];
  isStreaming?: boolean;
}

export type PermissionAction = 'allow' | 'always_allow' | 'deny';
export type PermissionModeData = 'ask' | 'acceptEdits' | 'plan' | 'bypassPermissions';

export interface RuntimeInfoData {
  mode: 'mock' | 'pi' | 'auto';
  active: 'mock' | 'pi';
  fallback: boolean;
  detail?: string;
}

export interface SlashCommandData {
  name: string;
  description: string;
  category?: string;
  source?: 'runtime' | 'extension' | 'builtin' | 'skill' | 'prompt';
  insertText?: string;
}

export interface RecentProjectData {
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

export interface RepositoryBranchInfoData {
  name: string;
  current: boolean;
  local: boolean;
  remote: boolean;
  remoteRef?: string;
  checkedOut: boolean;
  worktreePath?: string;
}

export interface RepositoryWorktreeInfoData {
  path: string;
  branch: string | null;
  current: boolean;
}

export interface RepositoryContextResultData {
  state: 'ok' | 'not_git_repo' | 'missing_workdir' | 'error';
  workDir: string;
  repoRoot: string | null;
  repoName: string | null;
  currentBranch: string | null;
  defaultBranch: string | null;
  dirty: boolean;
  branches: RepositoryBranchInfoData[];
  worktrees: RepositoryWorktreeInfoData[];
  error?: string;
}

export interface PromptOptimizeInputData {
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

export interface PromptOptimizeResultData {
  optimized: string;
  source: 'model' | 'local';
  durationMs: number;
  provider?: string;
  modelId?: string;
  warning?: string;
}

// WebSocket protocol messages
export type WsClientMsg =
  | { type: 'prompt'; sessionId: string; message: string; images?: ImageAttachmentData[] }
  | { type: 'steer'; sessionId: string; message: string; images?: ImageAttachmentData[] }
  | { type: 'follow_up'; sessionId: string; message: string; images?: ImageAttachmentData[] }
  | { type: 'permission_response'; sessionId: string; response: { action: PermissionAction; requestId: string; scope?: PermissionScopeData } }
  | { type: 'set_permission_mode'; mode: PermissionModeData }
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

export type WsServerMsg =
  | {
      type: 'connected';
      sessions: SessionData[];
      currentModel: ModelData;
      thinkingLevel: ThinkingLevel;
      providers?: ProviderData[];
      packages?: PackageData[];
      extensions?: ExtensionData[];
      skills?: SkillData[];
      prompts?: PromptTemplateData[];
      themes?: ThemeData[];
      resourceDiagnostics?: ResourceDiagnosticData[];
      marketplace?: MarketplacePackageData[];
      trust?: ResourceTrustRecordData[];
      messagesBySession?: Record<string, ChatMessageData[]>;
      agentRooms?: AgentRoomSnapshotData;
      runtimeInfo?: RuntimeInfoData;
      slashCommands?: SlashCommandData[];
    }
  | { type: 'status'; sessionId: string; status: 'idle' | 'running' | 'error'; detail?: string }
  | { type: 'text_delta'; sessionId: string; delta: string }
  | { type: 'text_start'; sessionId: string; messageId: string }
  | { type: 'text_end'; sessionId: string; messageId: string }
  | { type: 'thinking_delta'; sessionId: string; delta: string }
  | { type: 'thinking_start'; sessionId: string }
  | { type: 'thinking_end'; sessionId: string }
  | { type: 'tool_use'; sessionId: string; toolCall: ToolUseData }
  | { type: 'tool_result'; sessionId: string; result: ToolResultData }
  | { type: 'permission_request'; sessionId: string; request: PermissionRequestData }
  | { type: 'message_complete'; sessionId: string; messageId: string; usage: TokenUsageData }
  | { type: 'message_added'; sessionId: string; message: ChatMessageData }
  | { type: 'session_updated'; session: SessionData }
  | { type: 'session_created'; session: SessionData; messages?: ChatMessageData[] }
  | { type: 'session_deleted'; sessionId: string }
  | { type: 'session_cleared'; sessionId: string }
  | { type: 'queue_update'; sessionId: string; steering: number; followUp: number }
  | { type: 'compaction_start'; sessionId: string }
  | { type: 'compaction_end'; sessionId: string }
  | { type: 'error'; sessionId?: string; message: string; code?: string }
  | { type: 'pong' }
  | { type: 'model_updated'; model: ModelData; thinkingLevel: ThinkingLevel; sessionId?: string }
  | { type: 'providers_updated'; providers: ProviderData[] }
  | { type: 'themes_updated'; themes: ThemeData[] }
  | { type: 'packages_updated'; packages: PackageData[] }
  | { type: 'extensions_updated'; extensions: ExtensionData[] }
  | { type: 'skills_updated'; skills: SkillData[] }
  | { type: 'prompts_updated'; prompts: PromptTemplateData[] }
  | { type: 'resource_diagnostics_updated'; diagnostics: ResourceDiagnosticData[] }
  | { type: 'marketplace_updated'; marketplace: MarketplacePackageData[] }
  | { type: 'resource_trust_updated'; trust: ResourceTrustRecordData[] }
  | { type: 'package_progress'; progress: PackageProgressData }
  | { type: 'runtime_updated'; runtimeInfo: RuntimeInfoData }
  | { type: 'slash_commands_updated'; commands: SlashCommandData[] }
  | { type: 'file_changes'; sessionId: string; changes: FileChangeData[] }
  | { type: 'git_info'; sessionId: string; git: GitData }
  | { type: 'terminal_started'; sessionId: string; terminalId: string; cwd: string; shell: string; backend: 'pty' | 'pipe' }
  | { type: 'terminal_output'; terminalId: string; data: string }
  | { type: 'terminal_exited'; terminalId: string; exitCode: number | null; signal: string | null }
  | { type: 'terminal_error'; sessionId?: string; terminalId?: string; message: string }
  | { type: 'agent_room_snapshot'; snapshot: AgentRoomSnapshotData }
  | { type: 'agent_room_created'; room: AgentRoomData }
  | { type: 'agent_room_updated'; room: AgentRoomData }
  | { type: 'agent_room_deleted'; roomId: string }
  | { type: 'agent_room_run_started'; room: AgentRoomData; run: AgentRoomRunData }
  | { type: 'agent_room_run_updated'; room: AgentRoomData; run: AgentRoomRunData }
  | { type: 'agent_room_stage_changed'; roomId: string; runId: string; stage: AgentRoomStageData; status: AgentRoomStatusData; round?: number }
  | { type: 'agent_room_task_started'; task: AgentRoomTaskData }
  | { type: 'agent_room_task_completed'; task: AgentRoomTaskData }
  | { type: 'agent_room_message_added'; message: AgentRoomMessageData }
  | { type: 'agent_room_artifact_added'; artifact: AgentRoomArtifactData }
  | { type: 'agent_room_debate_round_completed'; roomId: string; runId: string; round: number }
  | { type: 'agent_room_final_report_ready'; roomId: string; runId: string; artifact: AgentRoomArtifactData }
  | { type: 'agent_room_run_failed'; room: AgentRoomData; run: AgentRoomRunData; message: string }
  | { type: 'agent_room_run_cancelled'; room: AgentRoomData; run: AgentRoomRunData };
