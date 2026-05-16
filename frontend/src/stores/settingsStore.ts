import { create } from 'zustand';
import type { AppSettings } from '../types';

const DEFAULT: AppSettings = {
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

interface SettingsState extends AppSettings {
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => void;
  loadSettings: () => void;
  resetSettings: () => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  ...DEFAULT,

  updateSetting: (key, value) => {
    set({ [key]: value } as Partial<AppSettings>);
    const stored = loadStored();
    (stored as Record<string, unknown>)[key] = value;
    localStorage.setItem('pi-desktop-settings', JSON.stringify(stored));
    if (key === 'fontSize') {
      document.documentElement.style.fontSize = `${value}px`;
    }
  },

  loadSettings: () => {
    const stored = loadStored();
    set(stored);
    if (stored.fontSize) {
      document.documentElement.style.fontSize = `${stored.fontSize}px`;
    }
  },

  resetSettings: () => {
    set(DEFAULT);
    localStorage.removeItem('pi-desktop-settings');
  },
}));

function loadStored(): Partial<AppSettings> {
  try {
    return JSON.parse(localStorage.getItem('pi-desktop-settings') ?? '{}');
  } catch {
    return {};
  }
}
