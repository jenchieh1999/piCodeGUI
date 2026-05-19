import { useState } from 'react';
import { useExtensionStore } from '../../stores/extensionStore';
import { useUIStore } from '../../stores/uiStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { piApi } from '../../api/client';
import { useI18n } from '../../lib/i18n';
import { listRuntimeThemes, resolveRuntimeTheme, themeDisplayName } from '../../lib/runtimeSettings';
import { ArrowLeft, Lock, Palette, Plus, Download, Trash2, Upload } from 'lucide-react';
import { cn } from '../shared/utils';

export function ThemeEditor() {
  const themes = useExtensionStore((s) => s.themes);
  const customThemes = useExtensionStore((s) => s.customThemes);
  const createCustomTheme = useExtensionStore((s) => s.createCustomTheme);
  const updateCustomThemeColor = useExtensionStore((s) => s.updateCustomThemeColor);
  const deleteCustomTheme = useExtensionStore((s) => s.deleteCustomTheme);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const addToast = useUIStore((s) => s.addToast);
  const activeThemeName = useSettingsStore((s) => s.theme);
  const updateSetting = useSettingsStore((s) => s.updateSetting);
  const { t } = useI18n();
  const [isCreatingTheme, setIsCreatingTheme] = useState(false);
  const [newThemeName, setNewThemeName] = useState('');
  const allThemes = [...themes, ...customThemes];
  const runtimeThemes = listRuntimeThemes(allThemes);
  const activeTheme = resolveRuntimeTheme(activeThemeName, allThemes);
  const customThemeNames = new Set(customThemes.map((theme) => theme.name));
  const canEditActiveTheme = customThemeNames.has(activeThemeName);

  const createTheme = () => {
    const name = newThemeName.trim();
    if (!name) return;

    if (runtimeThemes.some((theme) => theme.name === name)) {
      addToast({ type: 'warning', message: t('themeEditor.duplicateName', { name }) });
      return;
    }

    const nextTheme = {
      name,
      colors: { ...activeTheme.colors },
    };
    createCustomTheme(nextTheme);
    updateSetting('theme', name);
    piApi.send({ type: 'theme_set', name });
    setNewThemeName('');
    setIsCreatingTheme(false);
    addToast({ type: 'success', message: t('themeEditor.created', { name }) });
  };

  const startCreateTheme = () => {
    setNewThemeName(uniqueThemeName(t('themeEditor.newTheme'), runtimeThemes.map((theme) => theme.name)));
    setIsCreatingTheme(true);
  };

  const deleteTheme = (name: string) => {
    deleteCustomTheme(name);
    if (activeThemeName === name) {
      updateSetting('theme', 'dark');
      piApi.send({ type: 'theme_set', name: 'dark' });
    }
    addToast({ type: 'success', message: `Deleted theme ${name}` });
  };

  // Hardcoded theme token categories for display
  const tokenCategories = [
    {
      name: t('themeEditor.category.core'),
      tokens: ['accent', 'border', 'borderAccent', 'borderMuted', 'success', 'error', 'warning', 'muted', 'dim', 'text', 'thinkingText'],
    },
    {
      name: t('themeEditor.category.background'),
      tokens: ['bg', 'bgSecondary', 'bgTertiary', 'bgHover', 'selectedBg', 'userMessageBg', 'userMessageText', 'customMessageBg', 'customMessageText', 'customMessageLabel', 'toolPendingBg', 'toolSuccessBg', 'toolErrorBg', 'toolTitle', 'toolOutput'],
    },
    {
      name: t('themeEditor.category.chrome'),
      tokens: ['titlebarBg', 'titlebarText', 'titlebarBorder', 'titlebarHover', 'titlebarActive'],
    },
    {
      name: t('themeEditor.category.markdown'),
      tokens: ['mdHeading', 'mdLink', 'mdLinkUrl', 'mdCode', 'mdCodeBlock', 'mdCodeBlockBorder', 'mdQuote', 'mdQuoteBorder', 'mdHr', 'mdListBullet'],
    },
    {
      name: t('themeEditor.category.syntax'),
      tokens: ['syntaxComment', 'syntaxKeyword', 'syntaxFunction', 'syntaxVariable', 'syntaxString', 'syntaxNumber', 'syntaxType', 'syntaxOperator', 'syntaxPunctuation'],
    },
    {
      name: t('themeEditor.category.thinking'),
      tokens: ['thinkingOff', 'thinkingMinimal', 'thinkingLow', 'thinkingMedium', 'thinkingHigh', 'thinkingXhigh'],
    },
  ];

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-pi-border">
        <button
          onClick={() => setActiveView('chat')}
          className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-pi-bg-hover text-pi-dim hover:text-pi-text transition-colors"
        >
          <ArrowLeft size={16} />
        </button>
        <h1 className="text-sm font-display font-semibold text-pi-text">{t('themeEditor.title')}</h1>
        <div className="flex-1" />
        <button
          className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs text-pi-muted hover:text-pi-text hover:bg-pi-bg-hover transition-colors border border-pi-border"
        >
          <Upload size={12} />
          {t('themeEditor.import')}
        </button>
        <button
          className="flex items-center gap-1.5 px-3 py-1 rounded-md text-xs text-pi-muted hover:text-pi-text hover:bg-pi-bg-hover transition-colors border border-pi-border"
        >
          <Download size={12} />
          {t('themeEditor.export')}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {/* Theme Swatches */}
        <div className="flex flex-wrap gap-2 mb-6">
          {runtimeThemes.map((theme) => {
            const isCustom = customThemeNames.has(theme.name);
            const isActive = theme.name === activeThemeName;

            return (
              <div
                key={theme.name}
                className={cn(
                  'flex items-center overflow-hidden rounded-md border text-xs font-medium transition-colors',
                  isActive
                    ? 'border-pi-accent bg-pi-accent/10 text-pi-accent'
                    : 'border-pi-border text-pi-muted hover:text-pi-text hover:border-pi-muted'
                )}
              >
                <button
                  onClick={() => {
                    updateSetting('theme', theme.name);
                    piApi.send({ type: 'theme_set', name: theme.name });
                    addToast({ type: 'success', message: t('themeEditor.toastSet', { name: theme.name }) });
                  }}
                  className="flex h-8 items-center gap-1.5 px-3"
                  title={theme.name}
                >
                  <Palette size={12} />
                  {themeDisplayName(theme.name)}
                  {isCustom && (
                    <span className="rounded bg-pi-accent/10 px-1.5 py-0.5 text-[9px] text-pi-accent">
                      {t('themeEditor.customBadge')}
                    </span>
                  )}
                </button>
                {isCustom && (
                  <button
                    onClick={() => deleteTheme(theme.name)}
                    className="flex h-8 w-8 items-center justify-center border-l border-pi-border text-pi-dim hover:bg-pi-error/10 hover:text-pi-error transition-colors"
                    title={t('themeEditor.deleteTheme')}
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            );
          })}
          {isCreatingTheme ? (
            <div className="flex items-center gap-1.5 rounded-md border border-pi-accent/40 bg-pi-bg-secondary px-2 py-1">
              <input
                value={newThemeName}
                onChange={(event) => setNewThemeName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') createTheme();
                  if (event.key === 'Escape') setIsCreatingTheme(false);
                }}
                autoFocus
                placeholder={t('themeEditor.newThemePrompt')}
                className="h-6 w-40 rounded bg-pi-bg-tertiary border border-pi-border px-2 text-xs text-pi-text placeholder:text-pi-dim focus:outline-none focus:border-pi-accent"
              />
              <button
                onClick={createTheme}
                disabled={!newThemeName.trim()}
                className="h-6 rounded bg-pi-accent px-2 text-[10px] font-semibold text-white disabled:opacity-40"
              >
                {t('settings.general.apply')}
              </button>
              <button
                onClick={() => setIsCreatingTheme(false)}
                className="h-6 rounded px-2 text-[10px] text-pi-dim hover:bg-pi-bg-hover hover:text-pi-text"
              >
                Esc
              </button>
            </div>
          ) : (
            <button
              onClick={startCreateTheme}
              className="px-3 py-1.5 rounded-md text-xs font-medium border border-dashed border-pi-border text-pi-dim hover:text-pi-muted transition-colors"
            >
              <Plus size={12} className="inline mr-1.5" />
              {t('themeEditor.newTheme')}
            </button>
          )}
        </div>

        {!canEditActiveTheme && (
          <div className="mb-5 flex items-center gap-2 rounded-md border border-pi-border bg-pi-bg-secondary px-3 py-2 text-xs text-pi-dim">
            <Lock size={13} />
            {t('themeEditor.readonly')}
          </div>
        )}

        {/* Token Categories */}
        <div className="space-y-6">
          {tokenCategories.map((cat) => (
            <div key={cat.name}>
              <h3 className="text-[10px] font-semibold text-pi-dim uppercase tracking-wider mb-2">
                {cat.name}
              </h3>
              <div className="grid grid-cols-3 gap-1.5">
                {cat.tokens.map((token) => {
                  const color = activeTheme.colors[token] ?? '#888';
                  
                  return (
                    <label
                      key={token}
                      className={cn(
                        'flex items-center gap-2 px-2 py-1.5 rounded-md bg-pi-bg-tertiary border border-pi-border group transition-colors',
                        canEditActiveTheme
                          ? 'hover:border-pi-accent/30 cursor-pointer'
                          : 'cursor-not-allowed opacity-70'
                      )}
                      title={canEditActiveTheme ? token : t('themeEditor.readonly')}
                    >
                      <input
                        type="color"
                        value={toColorInputValue(color)}
                        disabled={!canEditActiveTheme}
                        onChange={(event) => updateCustomThemeColor(activeTheme.name, token, event.target.value)}
                        className="h-5 w-5 flex-shrink-0 cursor-pointer rounded border border-pi-border bg-transparent p-0 disabled:cursor-not-allowed"
                      />
                      <span className="text-[10px] font-mono text-pi-dim truncate group-hover:text-pi-text transition-colors">
                        {token}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function uniqueThemeName(baseName: string, names: string[]): string {
  const used = new Set(names.map((name) => name.toLowerCase()));
  if (!used.has(baseName.toLowerCase())) return baseName;

  let index = 2;
  while (used.has(`${baseName} ${index}`.toLowerCase())) {
    index++;
  }
  return `${baseName} ${index}`;
}

function toColorInputValue(value: string): string {
  const color = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  if (/^#[0-9a-f]{3}$/i.test(color)) {
    return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
  }
  return '#888888';
}
