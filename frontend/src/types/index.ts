// ============================================================
// Pi Desktop - Core Type Definitions
// ============================================================

// ---- Session & Messages ----

export interface Session {
  id: string;
  title: string;
  projectPath: string;
  projectName: string;
  branch?: string;
  modelId: string;
  createdAt: number;
  updatedAt: number;
  status: SessionStatus;
  messageCount: number;
}

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
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'permission_request';
  text?: string;
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
}

export type PermissionResponse = 
  | { action: 'allow'; requestId: string }
  | { action: 'always_allow'; requestId: string }
  | { action: 'deny'; requestId: string };

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
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

// ---- Extensions & Packages ----

export interface ExtensionInfo {
  name: string;
  path: string;
  enabled: boolean;
  scope: 'user' | 'project';
  source: 'package' | 'local';
  description?: string;
}

export interface SkillInfo {
  name: string;
  description: string;
  filePath: string;
  enabled: boolean;
  scope: 'user' | 'project';
}

export interface PackageInfo {
  name: string;
  version: string;
  source: string;
  installedAt: number;
  extensions: string[];
  skills: string[];
  prompts: string[];
  themes: string[];
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

// ---- WebSocket Protocol ----

export type WsClientMessage =
  | { type: 'prompt'; sessionId: string; message: string; images?: ImageAttachment[] }
  | { type: 'steer'; sessionId: string; message: string }
  | { type: 'follow_up'; sessionId: string; message: string }
  | { type: 'permission_response'; sessionId: string; response: PermissionResponse }
  | { type: 'stop_generation'; sessionId: string }
  | { type: 'set_model'; modelId: string; provider: string }
  | { type: 'set_thinking_level'; level: ThinkingLevel }
  | { type: 'session_create'; projectPath: string }
  | { type: 'session_delete'; sessionId: string }
  | { type: 'session_rename'; sessionId: string; title: string }
  | { type: 'session_tree_navigate'; sessionId: string; targetId: string }
  | { type: 'session_compact'; sessionId: string }
  | { type: 'session_fork'; sessionId: string; entryId: string }
  | { type: 'package_install'; source: string }
  | { type: 'package_remove'; source: string }
  | { type: 'theme_set'; name: string }
  | { type: 'ping' };

export type WsServerMessage =
  | { type: 'connected'; sessions: Session[]; currentModel: ModelInfo; thinkingLevel: ThinkingLevel }
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
  | { type: 'session_updated'; session: Session }
  | { type: 'session_created'; session: Session }
  | { type: 'session_deleted'; sessionId: string }
  | { type: 'queue_update'; sessionId: string; steering: number; followUp: number }
  | { type: 'compaction_start'; sessionId: string }
  | { type: 'compaction_end'; sessionId: string }
  | { type: 'error'; sessionId?: string; message: string; code?: string }
  | { type: 'pong' }
  | { type: 'model_updated'; model: ModelInfo; thinkingLevel: ThinkingLevel }
  | { type: 'providers_updated'; providers: ProviderInfo[] }
  | { type: 'themes_updated'; themes: PiTheme[] }
  | { type: 'packages_updated'; packages: PackageInfo[] }
  | { type: 'extensions_updated'; extensions: ExtensionInfo[] }
  | { type: 'file_changes'; sessionId: string; changes: FileChange[] }
  | { type: 'git_info'; sessionId: string; git: GitInfo };

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

export type ViewType = 'chat' | 'settings' | 'tasks' | 'packages' | 'themes' | 'extensions';

export type RightPanelType = 'changes' | 'files' | 'tree' | 'usage' | null;

export interface AppSettings {
  theme: string;
  language: 'en' | 'zh' | 'ja';
  fontSize: number;
  permissionMode: PermissionMode;
  sidebarWidth: number;
  rightPanelWidth: number;
  rightPanelType: RightPanelType;
  showThinking: boolean;
  compactOnOverflow: boolean;
}
