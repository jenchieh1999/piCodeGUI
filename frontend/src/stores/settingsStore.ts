import { create } from 'zustand';
import type { AppSettings } from '../types';
import { DEFAULT_THEME_NAME } from '../lib/runtimeSettings';

export const SETTINGS_STORAGE_KEY = 'pi-desktop-settings';
export const SETTINGS_BROADCAST_CHANNEL = 'pi-desktop-settings';

const DEFAULT: AppSettings = {
  theme: DEFAULT_THEME_NAME,
  language: 'en',
  fontSize: 13,
  fontFamily: "'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  monoFontFamily: "'SF Mono', 'SFMono-Regular', ui-monospace, 'Cascadia Code', 'Cascadia Mono', Menlo, Monaco, Consolas, monospace",
  permissionMode: 'ask',
  sidebarWidth: 280,
  rightPanelWidth: 380,
  rightPanelType: null,
  showThinking: true,
  compactOnOverflow: true,
  promptOptimizerModel: null,
  chatBackgroundImage: '',
  chatBackgroundDim: 58,
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
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(stored));
    broadcastSettingsChanged();
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
    localStorage.removeItem(SETTINGS_STORAGE_KEY);
    document.documentElement.style.fontSize = `${DEFAULT.fontSize}px`;
    broadcastSettingsChanged();
  },
}));

function loadStored(): Partial<AppSettings> {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

function broadcastSettingsChanged(): void {
  window.dispatchEvent(new Event('pi:settings-changed'));
  try {
    const channel = new BroadcastChannel(SETTINGS_BROADCAST_CHANNEL);
    channel.postMessage({ type: 'settings-changed' });
    channel.close();
  } catch {
    // localStorage still propagates settings to other desktop windows.
  }
}
