import { create } from 'zustand';
import type { ChatMessage, PermissionRequest, Session, TokenUsage, ToolResult, ToolUse } from '../types';

let localMessageCounter = 0;

function nextMessageId(prefix: string) {
  localMessageCounter += 1;
  return `${prefix}-${Date.now()}-${localMessageCounter}`;
}

function createAssistantMessage(sessionId: string, id = nextMessageId('assistant')): ChatMessage {
  return {
    id,
    sessionId,
    role: 'assistant',
    content: [],
    timestamp: Date.now(),
    toolCalls: [],
    isStreaming: true,
  };
}

function appendText(message: ChatMessage, delta: string): ChatMessage {
  const content = [...message.content];
  const last = content[content.length - 1];

  if (last?.type === 'text') {
    content[content.length - 1] = { ...last, text: `${last.text ?? ''}${delta}` };
  } else {
    content.push({ type: 'text', text: delta });
  }

  return { ...message, content };
}

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
  setMessagesBySession: (messagesBySession: Record<string, ChatMessage[]>) => void;
  getMessages: (sessionId: string) => ChatMessage[];
  addMessage: (sessionId: string, message: ChatMessage) => void;
  updateMessage: (sessionId: string, messageId: string, updates: Partial<ChatMessage>) => void;
  clearMessages: (sessionId: string) => void;
  addUserMessage: (sessionId: string, text: string) => void;
  startAssistantMessage: (sessionId: string, messageId: string) => void;
  appendAssistantText: (sessionId: string, delta: string) => void;
  startThinking: (sessionId: string) => void;
  appendThinking: (sessionId: string, delta: string) => void;
  endThinking: (sessionId: string) => void;
  addToolUse: (sessionId: string, toolUse: ToolUse) => void;
  addToolResult: (sessionId: string, result: ToolResult) => void;
  completeAssistantMessage: (sessionId: string, messageId: string, usage: TokenUsage) => void;
  stopStreaming: (sessionId: string) => void;
  
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
      sessions: s.sessions.some((ss) => ss.id === session.id)
        ? s.sessions.map((ss) => (ss.id === session.id ? session : ss))
        : [session, ...s.sessions],
    })),
  removeSession: (sessionId) =>
    set((s) => ({
      sessions: s.sessions.filter((ss) => ss.id !== sessionId),
      activeSessionId:
        s.activeSessionId === sessionId
          ? s.sessions.find((ss) => ss.id !== sessionId)?.id ?? null
          : s.activeSessionId,
      messagesBySession: (() => {
        const copy = { ...s.messagesBySession };
        delete copy[sessionId];
        return copy;
      })(),
    })),
  setActiveSession: (id) => set({ activeSessionId: id }),
  
  messagesBySession: {},
  setMessagesBySession: (messagesBySession) => set({ messagesBySession }),
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
  addUserMessage: (sessionId, text) =>
    set((s) => ({
      messagesBySession: {
        ...s.messagesBySession,
        [sessionId]: [
          ...(s.messagesBySession[sessionId] ?? []),
          {
            id: nextMessageId('user'),
            sessionId,
            role: 'user',
            content: [{ type: 'text', text }],
            timestamp: Date.now(),
          },
        ],
      },
    })),
  startAssistantMessage: (sessionId, messageId) =>
    set((s) => {
      const currentId = s.streamingSessionId === sessionId ? s.streamingMessageId : null;
      const messages = s.messagesBySession[sessionId] ?? [];
      let nextMessages = messages;

      if (currentId && currentId !== messageId && messages.some((m) => m.id === currentId)) {
        nextMessages = messages.map((m) => (m.id === currentId ? { ...m, id: messageId, isStreaming: true } : m));
      } else if (messages.some((m) => m.id === messageId)) {
        nextMessages = messages.map((m) => (m.id === messageId ? { ...m, isStreaming: true } : m));
      } else {
        nextMessages = [...messages, createAssistantMessage(sessionId, messageId)];
      }

      return {
        messagesBySession: { ...s.messagesBySession, [sessionId]: nextMessages },
        streamingSessionId: sessionId,
        streamingMessageId: messageId,
        isStreaming: true,
      };
    }),
  appendAssistantText: (sessionId, delta) =>
    set((s) => {
      const messages = s.messagesBySession[sessionId] ?? [];
      let messageId = s.streamingSessionId === sessionId ? s.streamingMessageId : null;
      let nextMessages = messages;

      if (!messageId || !messages.some((m) => m.id === messageId)) {
        const message = createAssistantMessage(sessionId);
        messageId = message.id;
        nextMessages = [...messages, message];
      }

      nextMessages = nextMessages.map((m) => (m.id === messageId ? appendText({ ...m, isStreaming: true }, delta) : m));

      return {
        messagesBySession: { ...s.messagesBySession, [sessionId]: nextMessages },
        streamingSessionId: sessionId,
        streamingMessageId: messageId,
        isStreaming: true,
      };
    }),
  startThinking: (sessionId) =>
    set((s) => {
      const messages = s.messagesBySession[sessionId] ?? [];
      let messageId = s.streamingSessionId === sessionId ? s.streamingMessageId : null;
      let nextMessages = messages;

      if (!messageId || !messages.some((m) => m.id === messageId)) {
        const message = createAssistantMessage(sessionId);
        messageId = message.id;
        nextMessages = [...messages, message];
      }

      nextMessages = nextMessages.map((m) =>
        m.id === messageId ? { ...m, thinking: { content: '', isExpanded: false }, isStreaming: true } : m
      );

      return {
        messagesBySession: { ...s.messagesBySession, [sessionId]: nextMessages },
        streamingSessionId: sessionId,
        streamingMessageId: messageId,
        isStreaming: true,
      };
    }),
  appendThinking: (sessionId, delta) =>
    set((s) => {
      const messages = s.messagesBySession[sessionId] ?? [];
      let messageId = s.streamingSessionId === sessionId ? s.streamingMessageId : null;
      let nextMessages = messages;

      if (!messageId || !messages.some((m) => m.id === messageId)) {
        const message = createAssistantMessage(sessionId);
        message.thinking = { content: '', isExpanded: false };
        messageId = message.id;
        nextMessages = [...messages, message];
      }

      nextMessages = nextMessages.map((m) =>
        m.id === messageId
          ? {
              ...m,
              thinking: {
                content: `${m.thinking?.content ?? ''}${delta}`,
                isExpanded: m.thinking?.isExpanded ?? false,
              },
              isStreaming: true,
            }
          : m
      );

      return {
        messagesBySession: { ...s.messagesBySession, [sessionId]: nextMessages },
        streamingSessionId: sessionId,
        streamingMessageId: messageId,
        isStreaming: true,
      };
    }),
  endThinking: (sessionId) =>
    set((s) => {
      if (s.streamingSessionId !== sessionId || !s.streamingMessageId) return s;
      const messages = s.messagesBySession[sessionId] ?? [];
      return {
        messagesBySession: {
          ...s.messagesBySession,
          [sessionId]: messages.map((m) =>
            m.id === s.streamingMessageId && m.thinking
              ? { ...m, thinking: { ...m.thinking, isExpanded: false } }
              : m
          ),
        },
      };
    }),
  addToolUse: (sessionId, toolUse) =>
    set((s) => {
      const messages = s.messagesBySession[sessionId] ?? [];
      let messageId = s.streamingSessionId === sessionId ? s.streamingMessageId : null;
      let nextMessages = messages;

      if (!messageId || !messages.some((m) => m.id === messageId)) {
        const message = createAssistantMessage(sessionId);
        messageId = message.id;
        nextMessages = [...messages, message];
      }

      nextMessages = nextMessages.map((m) =>
        m.id === messageId
          ? {
              ...m,
              content: [...m.content, { type: 'tool_use', toolUse }],
              toolCalls: [
                ...(m.toolCalls ?? []).filter((tool) => tool.id !== toolUse.id),
                { ...toolUse, status: 'running' },
              ],
              isStreaming: true,
            }
          : m
      );

      return {
        messagesBySession: { ...s.messagesBySession, [sessionId]: nextMessages },
        streamingSessionId: sessionId,
        streamingMessageId: messageId,
        isStreaming: true,
      };
    }),
  addToolResult: (sessionId, result) =>
    set((s) => {
      const messages = s.messagesBySession[sessionId] ?? [];
      let messageId = s.streamingSessionId === sessionId ? s.streamingMessageId : null;

      if (!messageId || !messages.some((m) => m.id === messageId)) {
        const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
        messageId = lastAssistant?.id ?? null;
      }

      if (!messageId) return s;

      return {
        messagesBySession: {
          ...s.messagesBySession,
          [sessionId]: messages.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  content: [...m.content, { type: 'tool_result', toolResult: result }],
                  toolCalls: (m.toolCalls ?? []).map((tool) =>
                    tool.id === result.toolCallId
                      ? { ...tool, status: result.isError ? 'error' : 'success', result }
                      : tool
                  ),
                  isStreaming: true,
                }
              : m
          ),
        },
        streamingSessionId: sessionId,
        streamingMessageId: messageId,
        isStreaming: true,
      };
    }),
  completeAssistantMessage: (sessionId, messageId, usage) =>
    set((s) => {
      const messages = s.messagesBySession[sessionId] ?? [];
      return {
        messagesBySession: {
          ...s.messagesBySession,
          [sessionId]: messages.map((m) =>
            m.id === messageId
              ? { ...m, usage, isStreaming: false }
              : m
          ),
        },
        streamingSessionId: s.streamingSessionId === sessionId ? null : s.streamingSessionId,
        streamingMessageId: s.streamingSessionId === sessionId ? null : s.streamingMessageId,
        isStreaming: s.streamingSessionId === sessionId ? false : s.isStreaming,
      };
    }),
  stopStreaming: (sessionId) =>
    set((s) => {
      const messages = s.messagesBySession[sessionId] ?? [];
      const messageId = s.streamingSessionId === sessionId ? s.streamingMessageId : null;

      return {
        messagesBySession: {
          ...s.messagesBySession,
          [sessionId]: messageId
            ? messages.map((m) => (m.id === messageId ? { ...m, isStreaming: false } : m))
            : messages,
        },
        streamingSessionId: s.streamingSessionId === sessionId ? null : s.streamingSessionId,
        streamingMessageId: s.streamingSessionId === sessionId ? null : s.streamingMessageId,
        isStreaming: s.streamingSessionId === sessionId ? false : s.isStreaming,
        pendingPermission: s.pendingPermission?.sessionId === sessionId ? null : s.pendingPermission,
      };
    }),
  
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
