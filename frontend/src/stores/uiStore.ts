import { create } from 'zustand';
import type { RightPanelType, SlashCommandInfo, ViewType } from '../types';

export interface WorkspaceOpenRequest {
  id: number;
  sessionId: string;
  path: string;
}

export interface ChatScrollPosition {
  topItemIndex: number;
  atBottom: boolean;
  itemCount: number;
  updatedAt: number;
}

interface UIState {
  // View
  activeView: ViewType;
  setActiveView: (view: ViewType) => void;
  
  // Sidebar
  sidebarOpen: boolean;
  sidebarWidth: number;
  toggleSidebar: () => void;
  setSidebarWidth: (w: number) => void;
  
  // Right panel
  rightPanelType: RightPanelType;
  rightPanelWidth: number;
  workspaceOpenRequest: WorkspaceOpenRequest | null;
  setRightPanel: (type: RightPanelType) => void;
  toggleRightPanel: (type: RightPanelType) => void;
  setRightPanelWidth: (w: number) => void;
  requestWorkspaceOpen: (sessionId: string, path: string) => void;

  // Docked terminal under the chat composer
  terminalDockOpen: boolean;
  terminalDockHeight: number;
  setTerminalDockOpen: (open: boolean) => void;
  toggleTerminalDock: () => void;
  setTerminalDockHeight: (height: number) => void;
  
  // Toast
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
  
  // Settings page tab
  settingsTab: string;
  setSettingsTab: (tab: string) => void;

  // Runtime composer commands
  slashCommands: SlashCommandInfo[];
  setSlashCommands: (commands: SlashCommandInfo[]) => void;

  // Chat scroll memory
  chatScrollPositions: Record<string, ChatScrollPosition>;
  setChatScrollPosition: (sessionId: string, position: ChatScrollPosition) => void;
  clearChatScrollPosition: (sessionId: string) => void;
}

export interface Toast {
  id: string;
  type: 'info' | 'success' | 'error' | 'warning';
  message: string;
  duration?: number;
}

let toastId = 0;
let workspaceOpenRequestId = 0;
const CHAT_SCROLL_POSITIONS_KEY = 'pi-desktop-chat-scroll-positions';
const MAX_CHAT_SCROLL_POSITIONS = 120;

const clampPanelWidth = (width: number, min: number, max: number) =>
  Math.min(Math.max(Math.round(width), min), max);

const clampTerminalDockHeight = (height: number) =>
  Math.min(Math.max(Math.round(height), 140), 520);

const normalizeChatScrollPosition = (value: unknown): ChatScrollPosition | null => {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<ChatScrollPosition>;
  const topItemIndex = Number(candidate.topItemIndex);
  const itemCount = Number(candidate.itemCount);
  const updatedAt = Number(candidate.updatedAt);
  if (!Number.isFinite(topItemIndex) || !Number.isFinite(itemCount)) return null;
  return {
    topItemIndex: Math.max(0, Math.round(topItemIndex)),
    atBottom: Boolean(candidate.atBottom),
    itemCount: Math.max(0, Math.round(itemCount)),
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
  };
};

const loadChatScrollPositions = (): Record<string, ChatScrollPosition> => {
  if (typeof localStorage === 'undefined') return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(CHAT_SCROLL_POSITIONS_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .map(([sessionId, value]) => [sessionId, normalizeChatScrollPosition(value)] as const)
        .filter((entry): entry is readonly [string, ChatScrollPosition] => Boolean(entry[1]))
    );
  } catch {
    return {};
  }
};

const trimChatScrollPositions = (positions: Record<string, ChatScrollPosition>) =>
  Object.fromEntries(
    Object.entries(positions)
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt)
      .slice(0, MAX_CHAT_SCROLL_POSITIONS)
  );

const saveChatScrollPositions = (positions: Record<string, ChatScrollPosition>) => {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(CHAT_SCROLL_POSITIONS_KEY, JSON.stringify(positions));
  } catch {
    // Scroll memory is helpful but should never block the chat UI.
  }
};

export const useUIStore = create<UIState>((set) => ({
  activeView: 'chat',
  setActiveView: (view) => set({ activeView: view }),
  
  sidebarOpen: true,
  sidebarWidth: 280,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarWidth: (w) => set({ sidebarWidth: w }),
  
  rightPanelType: null,
  rightPanelWidth: 380,
  workspaceOpenRequest: null,
  setRightPanel: (type) => set({ rightPanelType: type }),
  toggleRightPanel: (type) =>
    set((s) => ({ rightPanelType: s.rightPanelType === type ? null : type })),
  setRightPanelWidth: (w) => set({ rightPanelWidth: clampPanelWidth(w, 300, 760) }),
  requestWorkspaceOpen: (sessionId, path) =>
    set({
      rightPanelType: 'files',
      workspaceOpenRequest: { id: ++workspaceOpenRequestId, sessionId, path },
    }),

  terminalDockOpen: false,
  terminalDockHeight: 260,
  setTerminalDockOpen: (open) => set({ terminalDockOpen: open }),
  toggleTerminalDock: () => set((s) => ({ terminalDockOpen: !s.terminalDockOpen })),
  setTerminalDockHeight: (height) => set({ terminalDockHeight: clampTerminalDockHeight(height) }),
  
  toasts: [],
  addToast: (toast) => {
    const id = `toast-${++toastId}`;
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }));
    const duration = toast.duration ?? 4000;
    if (duration > 0) {
      setTimeout(() => {
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      }, duration);
    }
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  
  settingsTab: 'general',
  setSettingsTab: (tab) => set({ settingsTab: tab }),

  slashCommands: [],
  setSlashCommands: (commands) => set({ slashCommands: commands }),

  chatScrollPositions: loadChatScrollPositions(),
  setChatScrollPosition: (sessionId, position) =>
    set((s) => {
      if (!sessionId) return s;
      const normalized = normalizeChatScrollPosition(position);
      if (!normalized) return s;
      const next = trimChatScrollPositions({
        ...s.chatScrollPositions,
        [sessionId]: normalized,
      });
      saveChatScrollPositions(next);
      return { chatScrollPositions: next };
    }),
  clearChatScrollPosition: (sessionId) =>
    set((s) => {
      const next = { ...s.chatScrollPositions };
      delete next[sessionId];
      saveChatScrollPositions(next);
      return { chatScrollPositions: next };
    }),
}));
