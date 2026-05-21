import { create } from 'zustand';
import type {
  ExtensionInfo,
  ExtensionResourceSnapshot,
  MarketplacePackageInfo,
  PackageInfo,
  PackageProgressInfo,
  PromptTemplateInfo,
  ResourceDiagnosticInfo,
  ResourceTrustRecord,
  SkillInfo,
  PiTheme,
} from '../types';

interface ExtensionState {
  extensions: ExtensionInfo[];
  skills: SkillInfo[];
  prompts: PromptTemplateInfo[];
  packages: PackageInfo[];
  themes: PiTheme[];
  customThemes: PiTheme[];
  hiddenThemeNames: string[];
  diagnostics: ResourceDiagnosticInfo[];
  marketplace: MarketplacePackageInfo[];
  trust: ResourceTrustRecord[];
  packageProgress: PackageProgressInfo[];
  
  setExtensions: (extensions: ExtensionInfo[]) => void;
  setSkills: (skills: SkillInfo[]) => void;
  setPrompts: (prompts: PromptTemplateInfo[]) => void;
  setPackages: (packages: PackageInfo[]) => void;
  setThemes: (themes: PiTheme[]) => void;
  setDiagnostics: (diagnostics: ResourceDiagnosticInfo[]) => void;
  setMarketplace: (marketplace: MarketplacePackageInfo[]) => void;
  setTrust: (trust: ResourceTrustRecord[]) => void;
  pushPackageProgress: (progress: PackageProgressInfo) => void;
  setResourceSnapshot: (snapshot: ExtensionResourceSnapshot) => void;
  reloadCustomThemes: () => void;
  createCustomTheme: (theme: PiTheme) => void;
  upsertCustomThemeColor: (name: string, baseTheme: PiTheme, token: string, color: string) => void;
  updateCustomThemeColor: (name: string, token: string, color: string) => void;
  deleteCustomTheme: (name: string) => void;
  hideThemeName: (name: string) => void;
  resetThemeState: () => void;
  
  toggleExtension: (name: string, enabled: boolean) => void;
  toggleSkill: (name: string, enabled: boolean) => void;
}

const CUSTOM_THEMES_KEY = 'pi-desktop-custom-themes';
const HIDDEN_THEMES_KEY = 'pi-desktop-hidden-themes';

export const useExtensionStore = create<ExtensionState>((set) => ({
  extensions: [],
  skills: [],
  prompts: [],
  packages: [],
  themes: [],
  customThemes: loadCustomThemes(),
  hiddenThemeNames: loadHiddenThemeNames(),
  diagnostics: [],
  marketplace: [],
  trust: [],
  packageProgress: [],
  
  setExtensions: (extensions) => set({ extensions: asArray(extensions) }),
  setSkills: (skills) => set({ skills: asArray(skills) }),
  setPrompts: (prompts) => set({ prompts: asArray(prompts) }),
  setPackages: (packages) => set({ packages: normalizePackages(packages) }),
  setThemes: (themes) => set({ themes: asArray(themes) }),
  setDiagnostics: (diagnostics) => set({ diagnostics: asArray(diagnostics) }),
  setMarketplace: (marketplace) => set({ marketplace: normalizeMarketplace(marketplace) }),
  setTrust: (trust) => set({ trust: asArray(trust) }),
  pushPackageProgress: (progress) =>
    set((s) => ({ packageProgress: [progress, ...s.packageProgress].slice(0, 20) })),
  setResourceSnapshot: (snapshot) =>
    set({
      extensions: asArray(snapshot.extensions),
      skills: asArray(snapshot.skills),
      prompts: asArray(snapshot.prompts),
      packages: normalizePackages(snapshot.packages),
      themes: asArray(snapshot.themes),
      diagnostics: asArray(snapshot.diagnostics),
      marketplace: normalizeMarketplace(snapshot.marketplace),
      trust: asArray(snapshot.trust),
    }),
  reloadCustomThemes: () => set({ customThemes: loadCustomThemes(), hiddenThemeNames: loadHiddenThemeNames() }),
  createCustomTheme: (theme) =>
    set((s) => {
      const hiddenThemeNames = s.hiddenThemeNames.filter((name) => name !== theme.name);
      const next = [theme, ...s.customThemes.filter((item) => item.name !== theme.name)];
      saveCustomThemes(next);
      if (hiddenThemeNames.length !== s.hiddenThemeNames.length) {
        saveHiddenThemeNames(hiddenThemeNames);
      }
      return { customThemes: next, hiddenThemeNames };
    }),
  upsertCustomThemeColor: (name, baseTheme, token, color) =>
    set((s) => {
      const existingTheme = s.customThemes.find((theme) => theme.name === name);
      const nextTheme: PiTheme = {
        ...baseTheme,
        ...(existingTheme ?? {}),
        name,
        colors: {
          ...(baseTheme.colors ?? {}),
          ...(existingTheme?.colors ?? {}),
          [token]: color,
        },
      };
      const next = [nextTheme, ...s.customThemes.filter((theme) => theme.name !== name)];
      const hiddenThemeNames = s.hiddenThemeNames.filter((themeName) => themeName !== name);
      saveCustomThemes(next);
      if (hiddenThemeNames.length !== s.hiddenThemeNames.length) {
        saveHiddenThemeNames(hiddenThemeNames);
      }
      return { customThemes: next, hiddenThemeNames };
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
  hideThemeName: (name) =>
    set((s) => {
      const hiddenThemeNames = Array.from(new Set([...s.hiddenThemeNames, name])).filter(Boolean);
      const customThemes = s.customThemes.filter((theme) => theme.name !== name);
      saveCustomThemes(customThemes);
      saveHiddenThemeNames(hiddenThemeNames);
      return { customThemes, hiddenThemeNames };
    }),
  resetThemeState: () =>
    set(() => {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(CUSTOM_THEMES_KEY);
        localStorage.removeItem(HIDDEN_THEMES_KEY);
      }
      broadcastThemeChanged();
      return { customThemes: [], hiddenThemeNames: [] };
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

function loadHiddenThemeNames(): string[] {
  if (typeof localStorage === 'undefined') return [];

  try {
    return normalizeThemeNames(JSON.parse(localStorage.getItem(HIDDEN_THEMES_KEY) ?? '[]'));
  } catch {
    return [];
  }
}

function asArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function normalizePackages(packages: PackageInfo[] | null | undefined): PackageInfo[] {
  return asArray(packages)
    .filter((pkg): pkg is PackageInfo => Boolean(pkg && typeof pkg === 'object'))
    .map((pkg) => ({
      ...pkg,
      extensions: asArray(pkg.extensions),
      skills: asArray(pkg.skills),
      prompts: asArray(pkg.prompts),
      themes: asArray(pkg.themes),
    }));
}

function normalizeMarketplace(marketplace: MarketplacePackageInfo[] | null | undefined): MarketplacePackageInfo[] {
  return asArray(marketplace)
    .filter((item): item is MarketplacePackageInfo => Boolean(item && typeof item === 'object'))
    .map((item) => ({
      ...item,
      tags: asArray(item.tags),
    }));
}

function saveCustomThemes(themes: PiTheme[]): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(themes));
  broadcastThemeChanged();
}

function saveHiddenThemeNames(names: string[]): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(HIDDEN_THEMES_KEY, JSON.stringify(normalizeThemeNames(names)));
  broadcastThemeChanged();
}

function isThemeLike(value: unknown): value is PiTheme {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<PiTheme>;
  return typeof item.name === 'string' && Boolean(item.name.trim()) && typeof item.colors === 'object' && Boolean(item.colors);
}

function normalizeThemeNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((name): name is string => typeof name === 'string')
        .map((name) => name.trim())
        .filter(Boolean)
    )
  );
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
