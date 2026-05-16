import { create } from 'zustand';
import type { ChatMessage, PermissionRequest, PermissionResponse, Session, TokenUsage, ToolCall, ToolResult } from '../types';

interface ChatState {
  // Sessions
  sessions: Session[];
  activeSessionId: string | null;
  setSessions: (sessions: Session[]) => void;
  addSession: (session: Session) => void;
  updateSession: (session: Session) => void;
  removeSession: (sessionId: string) => void;
  setActiveSession: (id: string | null) => void;
  
  // Messages per session: sessionId -> messages[]
  messagesBySession: Record<string, ChatMessage[]>;
  getMessages: (sessionId: string) => ChatMessage[];
  addMessage: (sessionId: string, message: ChatMessage) => void;
  updateMessage: (sessionId: string, messageId: string, updates: Partial<ChatMessage>) => void;
  clearMessages: (sessionId: string) => void;
  
  // Streaming state
  streamingSessionId: string | null;
  streamingMessageId: string | null;
  isStreaming: boolean;
  setStreaming: (sessionId: string | null, messageId: string | null) => void;
  
  // Permission
  pendingPermission: (PermissionRequest & { sessionId: string }) | null;
  setPendingPermission: (req: (PermissionRequest & { sessionId: string }) | null) => void;
  
  // Queue
  queueBySession: Record<string, { steering: number; followUp: number }>;
  setQueue: (sessionId: string, steering: number, followUp: number) => void;
  
  // Session statuses
  sessionStatuses: Record<string, 'idle' | 'running' | 'error'>;
  setSessionStatus: (sessionId: string, status: 'idle' | 'running' | 'error') => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  setSessions: (sessions) => set({ sessions }),
  addSession: (session) =>
    set((s) => ({ sessions: [session, ...s.sessions] })),
  updateSession: (session) =>
    set((s) => ({
      sessions: s.sessions.map((ss) => (ss.id === session.id ? session : ss)),
    })),
  removeSession: (sessionId) =>
    set((s) => ({
      sessions: s.sessions.filter((ss) => ss.id !== sessionId),
      messagesBySession: (() => {
        const copy = { ...s.messagesBySession };
        delete copy[sessionId];
        return copy;
      })(),
    })),
  setActiveSession: (id) => set({ activeSessionId: id }),
  
  messagesBySession: {},
  getMessages: (sessionId) => get().messagesBySession[sessionId] ?? [],
  addMessage: (sessionId, message) =>
    set((s) => ({
      messagesBySession: {
        ...s.messagesBySession,
        [sessionId]: [...(s.messagesBySession[sessionId] ?? []), message],
      },
    })),
  updateMessage: (sessionId, messageId, updates) =>
    set((s) => {
      const msgs = s.messagesBySession[sessionId];
      if (!msgs) return s;
      return {
        messagesBySession: {
          ...s.messagesBySession,
          [sessionId]: msgs.map((m) => (m.id === messageId ? { ...m, ...updates } : m)),
        },
      };
    }),
  clearMessages: (sessionId) =>
    set((s) => ({
      messagesBySession: { ...s.messagesBySession, [sessionId]: [] },
    })),
  
  streamingSessionId: null,
  streamingMessageId: null,
  isStreaming: false,
  setStreaming: (sessionId, messageId) =>
    set({
      streamingSessionId: sessionId,
      streamingMessageId: messageId,
      isStreaming: sessionId !== null,
    }),
  
  pendingPermission: null,
  setPendingPermission: (req) => set({ pendingPermission: req }),
  
  queueBySession: {},
  setQueue: (sessionId, steering, followUp) =>
    set((s) => ({
      queueBySession: { ...s.queueBySession, [sessionId]: { steering, followUp } },
    })),
  
  sessionStatuses: {},
  setSessionStatus: (sessionId, status) =>
    set((s) => ({
      sessionStatuses: { ...s.sessionStatuses, [sessionId]: status },
    })),
}));
