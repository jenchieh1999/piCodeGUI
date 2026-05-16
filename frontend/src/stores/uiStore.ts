import { create } from 'zustand';
import type { AppSettings, RightPanelType, ViewType } from '../types';

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
}

export interface Toast {
  id: string;
  type: 'info' | 'success' | 'error' | 'warning';
  message: string;
  duration?: number;
}

let toastId = 0;

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
  setRightPanelWidth: (w) => set({ rightPanelWidth: w }),
  
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
}));

// ---- Settings Store ----

interface SettingsState extends AppSettings {
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  loadSettings: () => void;
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  language: 'en',
  fontSize: 13,
  permissionMode: 'ask',
  sidebarWidth: 280,
  rightPanelWidth: 380,
  rightPanelType: null,
  showThinking: true,
  compactOnOverflow: true,
};

export const useSettingsStore = create<SettingsState>((set) => ({
  ...DEFAULT_SETTINGS,
  
  updateSetting: (key, value) => {
    set({ [key]: value } as Partial<AppSettings>);
    // Persist to localStorage
    const stored = loadStoredSettings();
    (stored as Record<string, unknown>)[key] = value;
    localStorage.setItem('pi-desktop-settings', JSON.stringify(stored));
    
    // Apply theme
    if (key === 'fontSize') {
      document.documentElement.style.fontSize = `${value}px`;
    }
  },
  
  loadSettings: () => {
    const stored = loadStoredSettings();
    set(stored);
    if (stored.fontSize) {
      document.documentElement.style.fontSize = `${stored.fontSize}px`;
    }
  },
}));

function loadStoredSettings(): Partial<AppSettings> {
  try {
    const raw = localStorage.getItem('pi-desktop-settings');
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
