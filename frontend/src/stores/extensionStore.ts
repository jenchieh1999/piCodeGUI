import { create } from 'zustand';
import type { ExtensionInfo, PackageInfo, SkillInfo, PiTheme } from '../types';

interface ExtensionState {
  extensions: ExtensionInfo[];
  skills: SkillInfo[];
  packages: PackageInfo[];
  themes: PiTheme[];
  customThemes: PiTheme[];
  
  setExtensions: (extensions: ExtensionInfo[]) => void;
  setSkills: (skills: SkillInfo[]) => void;
  setPackages: (packages: PackageInfo[]) => void;
  setThemes: (themes: PiTheme[]) => void;
  reloadCustomThemes: () => void;
  createCustomTheme: (theme: PiTheme) => void;
  updateCustomThemeColor: (name: string, token: string, color: string) => void;
  deleteCustomTheme: (name: string) => void;
  
  toggleExtension: (name: string, enabled: boolean) => void;
  toggleSkill: (name: string, enabled: boolean) => void;
}

const CUSTOM_THEMES_KEY = 'pi-desktop-custom-themes';

export const useExtensionStore = create<ExtensionState>((set) => ({
  extensions: [],
  skills: [],
  packages: [],
  themes: [],
  customThemes: loadCustomThemes(),
  
  setExtensions: (extensions) => set({ extensions }),
  setSkills: (skills) => set({ skills }),
  setPackages: (packages) => set({ packages }),
  setThemes: (themes) => set({ themes }),
  reloadCustomThemes: () => set({ customThemes: loadCustomThemes() }),
  createCustomTheme: (theme) =>
    set((s) => {
      const next = [theme, ...s.customThemes.filter((item) => item.name !== theme.name)];
      saveCustomThemes(next);
      return { customThemes: next };
    }),
  updateCustomThemeColor: (name, token, color) =>
    set((s) => {
      const next = s.customThemes.map((theme) =>
        theme.name === name
          ? { ...theme, colors: { ...theme.colors, [token]: color } }
          : theme
      );
      saveCustomThemes(next);
      return { customThemes: next };
    }),
  deleteCustomTheme: (name) =>
    set((s) => {
      const next = s.customThemes.filter((theme) => theme.name !== name);
      saveCustomThemes(next);
      return { customThemes: next };
    }),
  
  toggleExtension: (name, enabled) =>
    set((s) => ({
      extensions: s.extensions.map((e) => (e.name === name ? { ...e, enabled } : e)),
    })),
  toggleSkill: (name, enabled) =>
    set((s) => ({
      skills: s.skills.map((sk) => (sk.name === name ? { ...sk, enabled } : sk)),
    })),
}));

function loadCustomThemes(): PiTheme[] {
  if (typeof localStorage === 'undefined') return [];

  try {
    const parsed = JSON.parse(localStorage.getItem(CUSTOM_THEMES_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isThemeLike);
  } catch {
    return [];
  }
}

function saveCustomThemes(themes: PiTheme[]): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(themes));
  broadcastThemeChanged();
}

function isThemeLike(value: unknown): value is PiTheme {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<PiTheme>;
  return typeof item.name === 'string' && Boolean(item.name.trim()) && typeof item.colors === 'object' && Boolean(item.colors);
}

function broadcastThemeChanged(): void {
  window.dispatchEvent(new Event('pi:settings-changed'));
  try {
    const channel = new BroadcastChannel('pi-desktop-settings');
    channel.postMessage({ type: 'settings-changed' });
    channel.close();
  } catch {
    // storage events still propagate custom theme updates to other windows.
  }
}
