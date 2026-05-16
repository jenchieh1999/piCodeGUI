// ============================================================
// Pi Agent Server - Types (shared with frontend)
// ============================================================

export interface SessionData {
  id: string;
  title: string;
  projectPath: string;
  projectName: string;
  branch?: string;
  modelId: string;
  createdAt: number;
  updatedAt: number;
  status: 'idle' | 'running' | 'error';
  messageCount: number;
}

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
  installedAt: number;
  extensions: string[];
  skills: string[];
  prompts: string[];
  themes: string[];
}

export interface ExtensionData {
  name: string;
  path: string;
  enabled: boolean;
  scope: 'user' | 'project';
  source: 'package' | 'local';
  description?: string;
}

export interface ThemeData {
  name: string;
  vars?: Record<string, string>;
  colors: Record<string, string>;
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
}

export interface TokenUsageData {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

// WebSocket protocol messages
export type WsClientMsg =
  | { type: 'prompt'; sessionId: string; message: string; images?: Array<{ data: string; mimeType: string }> }
  | { type: 'steer'; sessionId: string; message: string }
  | { type: 'follow_up'; sessionId: string; message: string }
  | { type: 'permission_response'; sessionId: string; response: { action: 'allow' | 'always_allow' | 'deny'; requestId: string } }
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

export type WsServerMsg =
  | { type: 'connected'; sessions: SessionData[]; currentModel: ModelData; thinkingLevel: ThinkingLevel }
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
  | { type: 'session_updated'; session: SessionData }
  | { type: 'session_created'; session: SessionData }
  | { type: 'session_deleted'; sessionId: string }
  | { type: 'queue_update'; sessionId: string; steering: number; followUp: number }
  | { type: 'compaction_start'; sessionId: string }
  | { type: 'compaction_end'; sessionId: string }
  | { type: 'error'; sessionId?: string; message: string; code?: string }
  | { type: 'pong' }
  | { type: 'model_updated'; model: ModelData; thinkingLevel: ThinkingLevel }
  | { type: 'providers_updated'; providers: ProviderData[] }
  | { type: 'themes_updated'; themes: ThemeData[] }
  | { type: 'packages_updated'; packages: PackageData[] }
  | { type: 'extensions_updated'; extensions: ExtensionData[] }
  | { type: 'file_changes'; sessionId: string; changes: FileChangeData[] }
  | { type: 'git_info'; sessionId: string; git: GitData };
