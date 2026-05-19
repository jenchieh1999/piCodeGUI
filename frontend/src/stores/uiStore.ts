import { create } from 'zustand';
import type { RightPanelType, SlashCommandInfo, ViewType } from '../types';

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
  setRightPanel: (type: RightPanelType) => void;
  toggleRightPanel: (type: RightPanelType) => void;
  setRightPanelWidth: (w: number) => void;
  
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
}

export interface Toast {
  id: string;
  type: 'info' | 'success' | 'error' | 'warning';
  message: string;
  duration?: number;
}

let toastId = 0;

const clampPanelWidth = (width: number, min: number, max: number) =>
  Math.min(Math.max(Math.round(width), min), max);

export const useUIStore = create<UIState>((set) => ({
  activeView: 'chat',
  setActiveView: (view) => set({ activeView: view }),
  
  sidebarOpen: true,
  sidebarWidth: 280,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarWidth: (w) => set({ sidebarWidth: w }),
  
  rightPanelType: null,
  rightPanelWidth: 380,
  setRightPanel: (type) => set({ rightPanelType: type }),
  toggleRightPanel: (type) =>
    set((s) => ({ rightPanelType: s.rightPanelType === type ? null : type })),
  setRightPanelWidth: (w) => set({ rightPanelWidth: clampPanelWidth(w, 300, 760) }),
  
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
}));
