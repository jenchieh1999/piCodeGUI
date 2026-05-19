// ============================================================
// Pi Desktop - WebSocket API Client
// ============================================================

import type {
  AgentConfig,
  AgentInput,
  PermissionAuditEntry,
  PermissionRule,
  AuthProviderTestResult,
  ChannelConfig,
  ChannelInput,
  ChannelTestResult,
  WorkspaceDiffResult,
  WorkspaceReadFileResult,
  WorkspaceSearchResult,
  WorkspaceStatusResult,
  WorkspaceTreeResult,
  WorkspaceWriteFileResult,
  AuthStatusResult,
  RecentProject,
  RepositoryContextResult,
  ServerDiagnostics,
  WsClientMessage,
  WsServerMessage,
} from '../types';
import { useChatStore } from '../stores/chatStore';
import { useModelStore } from '../stores/modelStore';
import { useExtensionStore } from '../stores/extensionStore';
import { useUIStore } from '../stores/uiStore';
import { useConnectionStore } from '../stores/connectionStore';
import { useSettingsStore } from '../stores/settingsStore';

type MessageHandler = (msg: WsServerMessage) => void;

class PiApiClient {
  private ws: WebSocket | null = null;
  private url: string;
  private httpBaseUrl: string | null = null;
  private handlers: Set<MessageHandler> = new Set();
  private authToken: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private isConnected = false;
  private shouldReconnect = true;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(url?: string) {
    this.url = url ?? `ws://127.0.0.1:1421/ws`;
  }

  async configureFromDesktopShell(): Promise<void> {
    const bridge = typeof window !== 'undefined' ? window.piDesktop : undefined;
    if (!bridge) return;

    const [serverUrl, authToken] = await Promise.all([
      bridge.getServerUrl(),
      bridge.getServerAuthToken().catch(() => ''),
    ]);
    this.configureServerUrl(serverUrl);
    this.authToken = authToken || null;
  }

  configureServerUrl(serverUrl: string): void {
    const normalized = new URL(serverUrl);
    normalized.pathname = '';
    normalized.search = '';
    normalized.hash = '';
    this.httpBaseUrl = normalized.toString().replace(/\/$/, '');
    this.url = this.httpBaseUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:') + '/ws';
    console.log('[PiApi] Desktop server URL:', this.httpBaseUrl);
  }

  reconnectToServerUrl(serverUrl: string): void {
    this.configureServerUrl(serverUrl);
    this.shouldReconnect = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }

    const previous = this.ws;
    if (previous) {
      this.ws = null;
      previous.close();
    }

    this.stopPing();
    this.isConnected = false;
    useConnectionStore.getState().setConnected(false);
    this.connect();
  }

  connect() {
    this.shouldReconnect = true;
    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) return;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    try {
      const ws = new WebSocket(this.getWebSocketUrl());
      this.ws = ws;

      ws.onopen = () => {
        if (this.ws !== ws) return;
        console.log('[PiApi] WebSocket connected');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        useConnectionStore.getState().setConnected(true);
        useConnectionStore.getState().setReconnectAttempts(0);
        this.startPing();
      };

      ws.onmessage = (event) => {
        if (this.ws !== ws) return;
        try {
          const msg: WsServerMessage = JSON.parse(event.data);
          this.handleMessage(msg);
        } catch (err) {
          console.error('[PiApi] Failed to parse message:', err, event.data.slice(0, 200));
        }
      };

      ws.onclose = () => {
        if (this.ws !== ws) return;
        console.log('[PiApi] WebSocket closed');
        this.isConnected = false;
        this.ws = null;
        useConnectionStore.getState().setConnected(false);
        this.stopPing();
        if (this.shouldReconnect) {
          this.scheduleReconnect();
        }
      };

      ws.onerror = (err) => {
        if (this.ws !== ws) return;
        console.error('[PiApi] WebSocket error:', err);
      };
    } catch (err) {
      console.error('WebSocket connection error:', err);
      this.scheduleReconnect();
      return;
    }
  }

  private scheduleReconnect() {
    if (!this.shouldReconnect) return;

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[PiApi] Max reconnect attempts reached');
      useConnectionStore.getState().setLastError('Unable to reconnect to Pi server.');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
    useConnectionStore.getState().setReconnectAttempts(this.reconnectAttempts);
    console.log(`[PiApi] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private startPing() {
    this.pingTimer = setInterval(() => {
      this.send({ type: 'ping' });
    }, 30000);
  }

  private stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private handleMessage(msg: WsServerMessage) {
    // Dispatch to stores first for core state updates
    switch (msg.type) {
      case 'connected': {
        const chatStore = useChatStore.getState();
        const modelStore = useModelStore.getState();

        chatStore.setSessions(msg.sessions);
        if (msg.messagesBySession) {
          chatStore.setMessagesBySession(msg.messagesBySession);
        }
        if (!chatStore.activeSessionId && msg.sessions.length > 0) {
          chatStore.setActiveSession(msg.sessions[0]!.id);
        }
        if (msg.currentModel) {
          modelStore.setCurrentModel(msg.currentModel);
        }
        modelStore.setThinkingLevel(msg.thinkingLevel);
        if (msg.providers) {
          modelStore.setProviders(msg.providers);
        }
        if (msg.packages) {
          useExtensionStore.getState().setPackages(msg.packages);
        }
        if (msg.extensions) {
          useExtensionStore.getState().setExtensions(msg.extensions);
        }
        if (msg.themes) {
          useExtensionStore.getState().setThemes(msg.themes);
        }
        if (msg.runtimeInfo) {
          useConnectionStore.getState().setRuntimeInfo(msg.runtimeInfo);
        }
        if (msg.slashCommands) {
          useUIStore.getState().setSlashCommands(msg.slashCommands);
        }
        this.send({ type: 'set_permission_mode', mode: useSettingsStore.getState().permissionMode });
        break;
      }
      case 'session_created': {
        useChatStore.getState().addSession(msg.session);
        if (msg.messages) {
          const chatStore = useChatStore.getState();
          chatStore.setMessagesBySession({
            ...chatStore.messagesBySession,
            [msg.session.id]: msg.messages,
          });
        }
        useChatStore.getState().setActiveSession(msg.session.id);
        useUIStore.getState().setActiveView('chat');
        break;
      }
      case 'session_updated': {
        useChatStore.getState().updateSession(msg.session);
        break;
      }
      case 'session_deleted': {
        useChatStore.getState().removeSession(msg.sessionId);
        break;
      }
      case 'status': {
        const chatStore = useChatStore.getState();
        chatStore.setSessionStatus(msg.sessionId, msg.status);
        if (msg.status !== 'running') {
          chatStore.stopStreaming(msg.sessionId);
        }
        break;
      }
      case 'queue_update': {
        useChatStore.getState().setQueue(msg.sessionId, msg.steering, msg.followUp);
        break;
      }
      case 'permission_request': {
        useChatStore.getState().setPendingPermission({
          ...msg.request,
          sessionId: msg.sessionId,
        });
        break;
      }
      case 'thinking_start': {
        useChatStore.getState().startThinking(msg.sessionId);
        break;
      }
      case 'thinking_delta': {
        useChatStore.getState().appendThinking(msg.sessionId, msg.delta);
        break;
      }
      case 'thinking_end': {
        useChatStore.getState().endThinking(msg.sessionId);
        break;
      }
      case 'text_start': {
        useChatStore.getState().startAssistantMessage(msg.sessionId, msg.messageId);
        break;
      }
      case 'text_delta': {
        useChatStore.getState().appendAssistantText(msg.sessionId, msg.delta);
        break;
      }
      case 'tool_use': {
        useChatStore.getState().addToolUse(msg.sessionId, msg.toolCall);
        if (this.isWorkspaceMutationTool(msg.toolCall.name)) {
          useUIStore.getState().setRightPanel('changes');
        }
        break;
      }
      case 'tool_result': {
        useChatStore.getState().addToolResult(msg.sessionId, msg.result);
        break;
      }
      case 'message_complete': {
        useChatStore.getState().completeAssistantMessage(msg.sessionId, msg.messageId, msg.usage);
        break;
      }
      case 'message_added': {
        const chatStore = useChatStore.getState();
        const existing = chatStore.getMessages(msg.sessionId).some((message) => message.id === msg.message.id);
        if (!existing) {
          chatStore.addMessage(msg.sessionId, msg.message);
        }
        break;
      }
      case 'model_updated': {
        const modelStore = useModelStore.getState();
        if (!msg.sessionId) {
          modelStore.setCurrentModel(msg.model);
          modelStore.setThinkingLevel(msg.thinkingLevel);
        }
        break;
      }
      case 'providers_updated': {
        useModelStore.getState().setProviders(msg.providers);
        break;
      }
      case 'packages_updated': {
        useExtensionStore.getState().setPackages(msg.packages);
        break;
      }
      case 'extensions_updated': {
        useExtensionStore.getState().setExtensions(msg.extensions);
        break;
      }
      case 'themes_updated': {
        useExtensionStore.getState().setThemes(msg.themes);
        break;
      }
      case 'runtime_updated': {
        useConnectionStore.getState().setRuntimeInfo(msg.runtimeInfo);
        if (msg.runtimeInfo.fallback) {
          useUIStore.getState().addToast({
            type: 'warning',
            message: msg.runtimeInfo.detail ?? 'Pi SDK runtime fell back to mock.',
            duration: 7000,
          });
        }
        break;
      }
      case 'slash_commands_updated': {
        useUIStore.getState().setSlashCommands(msg.commands);
        break;
      }
      case 'file_changes': {
        useUIStore.getState().setRightPanel('changes');
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('pi:workspace-changed', {
            detail: { sessionId: msg.sessionId, changes: msg.changes },
          }));
        }
        break;
      }
      case 'error': {
        useUIStore.getState().addToast({
          type: 'error',
          message: msg.message,
          duration: 6000,
        });
        break;
      }
    }

    // Forward to all registered handlers
    this.handlers.forEach((handler) => handler(msg));
  }

  private isWorkspaceMutationTool(toolName: string): boolean {
    const normalized = toolName.toLowerCase();
    return ['edit', 'write', 'multi_edit', 'create', 'delete', 'move', 'rename'].some((name) =>
      normalized.includes(name)
    );
  }

  send(msg: WsClientMessage): boolean {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    } else {
      console.warn('[PiApi] Cannot send, WebSocket not connected:', msg.type);
      return false;
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  disconnect() {
    this.shouldReconnect = false;
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.disconnectTimer) {
      clearTimeout(this.disconnectTimer);
    }

    this.disconnectTimer = setTimeout(() => {
      if (this.shouldReconnect) return;
      if (this.ws) {
        this.ws.close();
        this.ws = null;
      }
      this.isConnected = false;
      useConnectionStore.getState().setConnected(false);
      this.disconnectTimer = null;
    }, 250);
  }

  get connected() {
    return this.isConnected;
  }

  async getWorkspaceStatus(sessionId: string) {
    return this.request<WorkspaceStatusResult>(`/api/sessions/${encodeURIComponent(sessionId)}/workspace/status`);
  }

  async getWorkspaceTree(sessionId: string, path = '') {
    const query = path ? `?path=${encodeURIComponent(path)}` : '';
    return this.request<WorkspaceTreeResult>(`/api/sessions/${encodeURIComponent(sessionId)}/workspace/tree${query}`);
  }

  async getWorkspaceFile(sessionId: string, path: string) {
    return this.request<WorkspaceReadFileResult>(
      `/api/sessions/${encodeURIComponent(sessionId)}/workspace/file?path=${encodeURIComponent(path)}`
    );
  }

  async writeWorkspaceFile(sessionId: string, path: string, content: string) {
    return this.request<WorkspaceWriteFileResult>(
      `/api/sessions/${encodeURIComponent(sessionId)}/workspace/file?path=${encodeURIComponent(path)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content }),
      }
    );
  }

  async getWorkspaceDiff(sessionId: string, path: string) {
    return this.request<WorkspaceDiffResult>(
      `/api/sessions/${encodeURIComponent(sessionId)}/workspace/diff?path=${encodeURIComponent(path)}`
    );
  }

  async searchWorkspaceFiles(sessionId: string, query: string) {
    return this.request<WorkspaceSearchResult>(
      `/api/sessions/${encodeURIComponent(sessionId)}/workspace/search?q=${encodeURIComponent(query)}`
    );
  }

  async getRecentProjects(limit = 12) {
    return this.request<{ projects: RecentProject[] }>(`/api/projects/recent?limit=${encodeURIComponent(String(limit))}`);
  }

  async getRepositoryContext(projectPath: string) {
    return this.request<RepositoryContextResult>(
      `/api/repository/context?path=${encodeURIComponent(projectPath)}`
    );
  }

  async getAuthStatus() {
    return this.request<AuthStatusResult>('/api/auth/status');
  }

  async saveProviderApiKey(provider: string, apiKey: string) {
    return this.request<AuthStatusResult>('/api/auth/api-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, apiKey }),
    });
  }

  async removeProviderApiKey(provider: string) {
    return this.request<AuthStatusResult>(`/api/auth/api-key?provider=${encodeURIComponent(provider)}`, {
      method: 'DELETE',
    });
  }

  async testProviderAuth(provider: string) {
    return this.request<AuthProviderTestResult>('/api/auth/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider }),
    });
  }

  async getPermissionRules() {
    return this.request<{ rules: PermissionRule[] }>('/api/permissions/rules');
  }

  async deletePermissionRule(ruleId: string) {
    return this.request<{ deleted: boolean }>(`/api/permissions/rules/${encodeURIComponent(ruleId)}`, {
      method: 'DELETE',
    });
  }

  async clearPermissionRules() {
    return this.request<{ rules: PermissionRule[] }>('/api/permissions/rules', {
      method: 'DELETE',
    });
  }

  async getPermissionAudit(limit = 50) {
    return this.request<{ entries: PermissionAuditEntry[] }>(`/api/permissions/audit?limit=${limit}`);
  }

  async getChannels() {
    return this.request<{ channels: ChannelConfig[] }>('/api/channels');
  }

  async createChannel(input: ChannelInput) {
    return this.request<{ channel: ChannelConfig }>('/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  async updateChannel(id: string, input: ChannelInput) {
    return this.request<{ channel: ChannelConfig }>(`/api/channels/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  async deleteChannel(id: string) {
    return this.request<{ deleted: boolean }>(`/api/channels/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async testChannel(id: string) {
    return this.request<ChannelTestResult>(`/api/channels/${encodeURIComponent(id)}/test`, {
      method: 'POST',
    });
  }

  async getDiagnostics() {
    return this.request<ServerDiagnostics>('/api/diagnostics');
  }

  async getAgents() {
    return this.request<{ agents: AgentConfig[] }>('/api/agents');
  }

  async createAgent(input: AgentInput) {
    return this.request<{ agent: AgentConfig }>('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  async updateAgent(id: string, input: AgentInput) {
    return this.request<{ agent: AgentConfig }>(`/api/agents/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }

  async deleteAgent(id: string) {
    return this.request<{ deleted: boolean }>(`/api/agents/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  getServerBaseUrl(): string {
    return this.getHttpBaseUrl();
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    if (this.authToken) {
      headers.set('Authorization', `Bearer ${this.authToken}`);
    }

    const res = await fetch(`${this.getHttpBaseUrl()}${path}`, { ...init, cache: 'no-store', headers });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(body || `Request failed with ${res.status}`);
    }
    return res.json() as Promise<T>;
  }

  private getHttpBaseUrl(): string {
    if (this.httpBaseUrl) return this.httpBaseUrl;

    const url = new URL(this.url);
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  }

  private getWebSocketUrl(): string {
    if (!this.authToken) return this.url;
    const url = new URL(this.url);
    url.searchParams.set('token', this.authToken);
    return url.toString();
  }
}

declare global {
  var __piDesktopApiClient: PiApiClient | undefined;
}

// Keep the WebSocket client stable across Vite hot updates. Without this,
// refreshed modules can import a fresh disconnected client while App still
// owns the connected one.
export const piApi = globalThis.__piDesktopApiClient ?? (globalThis.__piDesktopApiClient = new PiApiClient());
export default piApi;
