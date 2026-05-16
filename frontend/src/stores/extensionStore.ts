import { create } from 'zustand';
import type { ExtensionInfo, PackageInfo, SkillInfo, PiTheme } from '../types';

interface ExtensionState {
  extensions: ExtensionInfo[];
  skills: SkillInfo[];
  packages: PackageInfo[];
  themes: PiTheme[];
  
  setExtensions: (extensions: ExtensionInfo[]) => void;
  setSkills: (skills: SkillInfo[]) => void;
  setPackages: (packages: PackageInfo[]) => void;
  setThemes: (themes: PiTheme[]) => void;
  
  toggleExtension: (name: string, enabled: boolean) => void;
  toggleSkill: (name: string, enabled: boolean) => void;
}

export const useExtensionStore = create<ExtensionState>((set) => ({
  extensions: [],
  skills: [],
  packages: [],
  themes: [],
  
  setExtensions: (extensions) => set({ extensions }),
  setSkills: (skills) => set({ skills }),
  setPackages: (packages) => set({ packages }),
  setThemes: (themes) => set({ themes }),
  
  toggleExtension: (name, enabled) =>
    set((s) => ({
      extensions: s.extensions.map((e) => (e.name === name ? { ...e, enabled } : e)),
    })),
  toggleSkill: (name, enabled) =>
    set((s) => ({
      skills: s.skills.map((sk) => (sk.name === name ? { ...sk, enabled } : sk)),
    })),
}));
