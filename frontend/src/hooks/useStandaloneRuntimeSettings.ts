import { useEffect } from 'react';
import { applyRuntimeSettings } from '../lib/runtimeSettings';
import { useExtensionStore, useSettingsStore } from '../stores';
import { SETTINGS_BROADCAST_CHANNEL, SETTINGS_STORAGE_KEY } from '../stores/settingsStore';

const CUSTOM_THEMES_STORAGE_KEY = 'pi-desktop-custom-themes';

export function useStandaloneRuntimeSettings(): void {
  const theme = useSettingsStore((s) => s.theme);
  const language = useSettingsStore((s) => s.language);
  const fontSize = useSettingsStore((s) => s.fontSize);
  const fontFamily = useSettingsStore((s) => s.fontFamily);
  const monoFontFamily = useSettingsStore((s) => s.monoFontFamily);
  const themes = useExtensionStore((s) => s.themes);
  const customThemes = useExtensionStore((s) => s.customThemes);

  useEffect(() => {
    useSettingsStore.getState().loadSettings();
  }, []);

  useEffect(() => {
    const reloadRuntimePreferences = () => {
      useSettingsStore.getState().loadSettings();
      useExtensionStore.getState().reloadCustomThemes();
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key === SETTINGS_STORAGE_KEY || event.key === CUSTOM_THEMES_STORAGE_KEY) {
        reloadRuntimePreferences();
      }
    };

    const handleSettingsEvent = () => reloadRuntimePreferences();
    let channel: BroadcastChannel | null = null;

    try {
      channel = new BroadcastChannel(SETTINGS_BROADCAST_CHANNEL);
      channel.onmessage = (event) => {
        if (event.data?.type === 'settings-changed') {
          reloadRuntimePreferences();
        }
      };
    } catch {
      channel = null;
    }

    window.addEventListener('storage', handleStorage);
    window.addEventListener('pi:settings-changed', handleSettingsEvent);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('pi:settings-changed', handleSettingsEvent);
      channel?.close();
    };
  }, []);

  useEffect(() => {
    applyRuntimeSettings({ theme, language, fontSize, fontFamily, monoFontFamily }, [...themes, ...customThemes]);
  }, [theme, language, fontSize, fontFamily, monoFontFamily, themes, customThemes]);
}
