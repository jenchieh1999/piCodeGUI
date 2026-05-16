// ============================================================
// Pi Desktop - WebSocket API Client
// ============================================================

import type { WsClientMessage, WsServerMessage } from '../types';
import { useChatStore } from '../stores/chatStore';
import { useModelStore } from '../stores/modelStore';
import { useExtensionStore } from '../stores/extensionStore';
import { useUIStore } from '../stores/uiStore';

type MessageHandler = (msg: WsServerMessage) => void;

class PiApiClient {
  private ws: WebSocket | null = null;
  private url: string;
  private handlers: Set<MessageHandler> = new Set();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private isConnected = false;

  constructor(url?: string) {
    this.url = url ?? `ws://127.0.0.1:1421/ws`;
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    try {
      this.ws = new WebSocket(this.url);
    } catch (err) {
      console.error('WebSocket connection error:', err);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      console.log('[PiApi] WebSocket connected');
      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.startPing();
    };

    this.ws.onmessage = (event) => {
      try {
        const msg: WsServerMessage = JSON.parse(event.data);
        this.handleMessage(msg);
      } catch (err) {
        console.error('[PiApi] Failed to parse message:', err, event.data.slice(0, 200));
      }
    };

    this.ws.onclose = () => {
      console.log('[PiApi] WebSocket closed');
      this.isConnected = false;
      this.stopPing();
      this.scheduleReconnect();
    };

    this.ws.onerror = (err) => {
      console.error('[PiApi] WebSocket error:', err);
    };
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[PiApi] Max reconnect attempts reached');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;
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
        if (msg.currentModel) {
          modelStore.setCurrentModel(msg.currentModel);
        }
        modelStore.setThinkingLevel(msg.thinkingLevel);
        break;
      }
      case 'session_created': {
        useChatStore.getState().addSession(msg.session);
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
        useChatStore.getState().setSessionStatus(msg.sessionId, msg.status);
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
      case 'model_updated': {
        const modelStore = useModelStore.getState();
        modelStore.setCurrentModel(msg.model);
        modelStore.setThinkingLevel(msg.thinkingLevel);
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

  send(msg: WsClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      console.warn('[PiApi] Cannot send, WebSocket not connected:', msg.type);
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  disconnect() {
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.reconnectAttempts = this.maxReconnectAttempts; // prevent reconnect
  }

  get connected() {
    return this.isConnected;
  }
}

// Singleton
export const piApi = new PiApiClient();
export default piApi;
