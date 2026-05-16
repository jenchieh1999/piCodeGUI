import { useSettingsStore } from '../../stores/settingsStore';
import { useModelStore } from '../../stores/modelStore';
import { useExtensionStore } from '../../stores/extensionStore';
import { useUIStore } from '../../stores/uiStore';
import { piApi } from '../../api/client';
import type { ThinkingLevel } from '../../types';
import {
  Monitor,
  Shield,
  Zap,
  Type,
  Globe,
  ArrowLeft,
  Palette,
  Trash2,
} from 'lucide-react';
import { cn } from '../shared/utils';

const SETTINGS_TABS = [
  { id: 'general', label: 'General', icon: Monitor },
  { id: 'permissions', label: 'Permissions', icon: Shield },
  { id: 'model', label: 'Model', icon: Zap },
  { id: 'appearance', label: 'Appearance', icon: Palette },
];

export function SettingsView() {
  const settings = useSettingsStore();
  const settingsTab = useUIStore((s) => s.settingsTab);
  const setSettingsTab = useUIStore((s) => s.setSettingsTab);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const currentModel = useModelStore((s) => s.currentModel);
  const thinkingLevel = useModelStore((s) => s.thinkingLevel);
  const availableModels = useModelStore((s) => s.availableModels);
  const themes = useExtensionStore((s) => s.themes);

  const renderTab = () => {
    switch (settingsTab) {
      case 'general':
        return <GeneralSettings />;
      case 'permissions':
        return <PermissionsSettings />;
      case 'model':
        return (
          <ModelSettings
            currentModel={currentModel}
            thinkingLevel={thinkingLevel}
            availableModels={availableModels}
          />
        );
      case 'appearance':
        return <AppearanceSettings themes={themes} />;
      default:
        return <GeneralSettings />;
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-pi-border">
        <button
          onClick={() => setActiveView('chat')}
          className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-pi-bg-hover text-pi-dim hover:text-pi-text transition-colors"
        >
          <ArrowLeft size={16} />
        </button>
        <h1 className="text-sm font-display font-semibold text-pi-text">Settings</h1>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Tab sidebar */}
        <div className="w-48 border-r border-pi-border p-2 space-y-0.5">
          {SETTINGS_TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setSettingsTab(tab.id)}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                  settingsTab === tab.id
                    ? 'bg-pi-selected-bg text-pi-accent'
                    : 'text-pi-muted hover:text-pi-text hover:bg-pi-bg-hover'
                )}
              >
                <Icon size={14} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto p-6">
          {renderTab()}
        </div>
      </div>
    </div>
  );
}

function GeneralSettings() {
  const settings = useSettingsStore();

  return (
    <div className="max-w-md space-y-6">
      <h2 className="text-sm font-semibold text-pi-text mb-4">General</h2>

      <div className="space-y-4">
        {/* Language */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe size={14} className="text-pi-dim" />
            <span className="text-xs text-pi-text">Language</span>
          </div>
          <select
            value={settings.language}
            onChange={(e) => settings.updateSetting('language', e.target.value as 'en' | 'zh' | 'ja')}
            className="px-2 py-1 rounded-md bg-pi-bg-tertiary border border-pi-border text-xs text-pi-text"
          >
            <option value="en">English</option>
            <option value="zh">中文</option>
            <option value="ja">日本語</option>
          </select>
        </div>

        {/* Font Size */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Type size={14} className="text-pi-dim" />
            <span className="text-xs text-pi-text">Font Size</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min="10"
              max="20"
              value={settings.fontSize}
              onChange={(e) => settings.updateSetting('fontSize', Number(e.target.value))}
              className="w-24"
            />
            <span className="text-xs text-pi-dim w-6">{settings.fontSize}px</span>
          </div>
        </div>

        {/* Show Thinking */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-pi-text">Show AI thinking</span>
          <button
            onClick={() => settings.updateSetting('showThinking', !settings.showThinking)}
            className={cn(
              'w-9 h-5 rounded-full transition-colors relative',
              settings.showThinking ? 'bg-pi-accent' : 'bg-pi-border'
            )}
          >
            <div
              className={cn(
                'w-3.5 h-3.5 rounded-full bg-white absolute top-0.5 transition-transform',
                settings.showThinking ? 'left-5' : 'left-0.5'
              )}
            />
          </button>
        </div>

        {/* Compact on overflow */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-pi-text">Auto-compact on overflow</span>
          <button
            onClick={() => settings.updateSetting('compactOnOverflow', !settings.compactOnOverflow)}
            className={cn(
              'w-9 h-5 rounded-full transition-colors relative',
              settings.compactOnOverflow ? 'bg-pi-accent' : 'bg-pi-border'
            )}
          >
            <div
              className={cn(
                'w-3.5 h-3.5 rounded-full bg-white absolute top-0.5 transition-transform',
                settings.compactOnOverflow ? 'left-5' : 'left-0.5'
              )}
            />
          </button>
        </div>

        {/* Reset */}
        <div className="pt-4 border-t border-pi-border">
          <button
            onClick={() => {
              if (confirm('Reset all settings to defaults?')) {
                settings.resetSettings();
              }
            }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs text-pi-error
                       hover:bg-pi-error/10 transition-colors"
          >
            <Trash2 size={13} />
            Reset to defaults
          </button>
        </div>
      </div>
    </div>
  );
}

function PermissionsSettings() {
  const settings = useSettingsStore();
  const modes = [
    { value: 'ask', label: 'Ask for permission', desc: 'Confirm each action' },
    { value: 'acceptEdits', label: 'Auto-accept edits', desc: 'Allow file changes, ask for commands' },
    { value: 'plan', label: 'Plan mode', desc: 'Only show plans, don\'t execute' },
    { value: 'bypassPermissions', label: 'Bypass all', desc: 'Full auto (use with caution)' },
  ] as const;

  return (
    <div className="max-w-md space-y-6">
      <h2 className="text-sm font-semibold text-pi-text mb-4">Permissions</h2>
      <div className="space-y-2">
        {modes.map((mode) => (
          <button
            key={mode.value}
            onClick={() => settings.updateSetting('permissionMode', mode.value)}
            className={cn(
              'w-full text-left p-3 rounded-lg border transition-colors',
              settings.permissionMode === mode.value
                ? 'border-pi-accent bg-pi-accent/5'
                : 'border-pi-border hover:border-pi-muted'
            )}
          >
            <div className="text-xs font-medium text-pi-text">{mode.label}</div>
            <div className="text-[10px] text-pi-dim mt-0.5">{mode.desc}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

interface ModelSettingsProps {
  currentModel: { id: string; name: string; provider: string } | null;
  thinkingLevel: ThinkingLevel;
  availableModels: Array<{ id: string; name: string; provider: string }>;
}

function ModelSettings({ currentModel, thinkingLevel, availableModels }: ModelSettingsProps) {
  const thinkingLevels: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];

  return (
    <div className="max-w-md space-y-6">
      <h2 className="text-sm font-semibold text-pi-text mb-4">Model</h2>

      {/* Current model */}
      <div>
        <label className="text-[10px] font-semibold text-pi-dim uppercase">Current Model</label>
        <div className="mt-1 p-2 rounded-md bg-pi-bg-tertiary border border-pi-border text-xs text-pi-text">
          {currentModel ? `${currentModel.provider}/${currentModel.name}` : 'Not selected'}
        </div>
      </div>

      {/* Thinking Level */}
      <div>
        <label className="text-[10px] font-semibold text-pi-dim uppercase">Thinking Level</label>
        <div className="mt-1 flex gap-1">
          {thinkingLevels.map((level) => (
            <button
              key={level}
              onClick={() => piApi.send({ type: 'set_thinking_level', level })}
              className={cn(
                'px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors capitalize',
                thinkingLevel === level
                  ? 'bg-pi-accent text-white'
                  : 'bg-pi-bg-tertiary text-pi-dim hover:text-pi-text border border-pi-border'
              )}
            >
              {level}
            </button>
          ))}
        </div>
      </div>

      {/* Available models */}
      <div>
        <label className="text-[10px] font-semibold text-pi-dim uppercase">
          Available Models ({availableModels.length})
        </label>
        <div className="mt-1 space-y-1 max-h-[300px] overflow-y-auto">
          {availableModels.slice(0, 20).map((model) => (
            <button
              key={`${model.provider}/${model.id}`}
              className={cn(
                'w-full text-left px-2.5 py-1.5 rounded-md text-xs transition-colors',
                currentModel?.id === model.id && currentModel?.provider === model.provider
                  ? 'bg-pi-accent/10 text-pi-accent'
                  : 'text-pi-muted hover:bg-pi-bg-hover hover:text-pi-text'
              )}
            >
              <span className="text-pi-dim font-mono text-[10px]">{model.provider}/</span>
              {model.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function AppearanceSettings({ themes }: { themes: Array<{ name: string }> }) {
  const settings = useSettingsStore();

  return (
    <div className="max-w-md space-y-6">
      <h2 className="text-sm font-semibold text-pi-text mb-4">Appearance</h2>

      <div>
        <label className="text-[10px] font-semibold text-pi-dim uppercase">Theme</label>
        <div className="mt-1 grid grid-cols-2 gap-2">
          {themes.map((theme) => (
            <button
              key={theme.name}
              onClick={() => {
                settings.updateSetting('theme', theme.name);
                piApi.send({ type: 'theme_set', name: theme.name });
              }}
              className={cn(
                'text-left px-3 py-2 rounded-lg border transition-colors',
                settings.theme === theme.name
                  ? 'border-pi-accent bg-pi-accent/5'
                  : 'border-pi-border hover:border-pi-muted'
              )}
            >
              <div className="text-xs font-medium text-pi-text capitalize">{theme.name}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
