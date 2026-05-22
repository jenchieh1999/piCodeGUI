import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useModelStore } from '../../stores/modelStore';
import { useExtensionStore } from '../../stores/extensionStore';
import { useUIStore } from '../../stores/uiStore';
import { useChatStore } from '../../stores/chatStore';
import { piApi } from '../../api/client';
import { ChannelsSettings } from './ChannelsSettings';
import type {
  AuthProviderStatus,
  AuthProviderTestResult,
  AuthStatusResult,
  ModelInfo,
  PermissionAuditEntry,
  PermissionRule,
  PiTheme,
  Session,
  ThinkingLevel,
} from '../../types';
import { useI18n, type TranslationKey } from '../../lib/i18n';
import { groupRuntimeThemesBySeries, listRuntimeThemes, themeDisplayName } from '../../lib/runtimeSettings';
import {
  Monitor,
  Shield,
  Zap,
  Type,
  Globe,
  ArrowLeft,
  Eraser,
  ImagePlus,
  Link,
  Palette,
  Trash2,
  KeyRound,
  Search,
  RefreshCw,
  Save,
  XCircle,
  CheckCircle2,
  Download,
  Loader2,
  History,
  Power,
  ShieldCheck,
  PlugZap,
  RadioTower,
  ExternalLink,
} from 'lucide-react';
import { cn } from '../shared/utils';

const SETTINGS_TABS = [
  { id: 'general', labelKey: 'settings.tabs.general', icon: Monitor },
  { id: 'permissions', labelKey: 'settings.tabs.permissions', icon: Shield },
  { id: 'model', labelKey: 'settings.tabs.model', icon: Zap },
  { id: 'credentials', labelKey: 'settings.tabs.credentials', icon: KeyRound },
  { id: 'channels', labelKey: 'settings.tabs.channels', icon: RadioTower },
  { id: 'appearance', labelKey: 'settings.tabs.appearance', icon: Palette },
  { id: 'desktop', labelKey: 'settings.tabs.desktop', icon: Download },
] as const;

const UI_FONT_PRESETS = [
  { label: 'Inter', value: "'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
  { label: 'System UI', value: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
  { label: 'Segoe UI', value: "'Segoe UI', system-ui, sans-serif" },
  { label: 'PingFang / Microsoft YaHei', value: "'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif" },
  { label: 'Arial', value: "Arial, Helvetica, sans-serif" },
  { label: 'Manrope', value: "'Manrope', 'Inter', system-ui, sans-serif" },
] as const;

const MONO_FONT_PRESETS = [
  { label: 'SF Mono / Cascadia', value: "'SF Mono', 'SFMono-Regular', ui-monospace, 'Cascadia Code', 'Cascadia Mono', Menlo, Monaco, Consolas, monospace" },
  { label: 'JetBrains Mono', value: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace" },
  { label: 'Cascadia Code', value: "'Cascadia Code', 'Cascadia Mono', Consolas, monospace" },
  { label: 'Fira Code', value: "'Fira Code', 'JetBrains Mono', Consolas, monospace" },
  { label: 'Consolas', value: "Consolas, 'Courier New', monospace" },
  { label: 'SF Mono / Menlo', value: "'SFMono-Regular', Menlo, Monaco, Consolas, monospace" },
] as const;

export function SettingsView() {
  const settings = useSettingsStore();
  const { t } = useI18n();
  const settingsTab = useUIStore((s) => s.settingsTab);
  const setSettingsTab = useUIStore((s) => s.setSettingsTab);
  const setActiveView = useUIStore((s) => s.setActiveView);
  const currentModel = useModelStore((s) => s.currentModel);
  const thinkingLevel = useModelStore((s) => s.thinkingLevel);
  const availableModels = useModelStore((s) => s.availableModels);
  const activeSessionId = useChatStore((s) => s.activeSessionId);
  const activeSession = useChatStore((s) => s.sessions.find((session) => session.id === activeSessionId));
  const effectiveCurrentModel = useMemo(
    () => activeSession ? modelForSession(activeSession, availableModels, currentModel) : currentModel,
    [activeSession, availableModels, currentModel]
  );
  const themes = useExtensionStore((s) => s.themes);
  const customThemes = useExtensionStore((s) => s.customThemes);

  const renderTab = () => {
    switch (settingsTab) {
      case 'general':
        return <GeneralSettings />;
      case 'permissions':
        return <PermissionsSettings />;
      case 'model':
        return (
          <ModelSettings
            currentModel={effectiveCurrentModel}
            thinkingLevel={activeSession?.thinkingLevel ?? thinkingLevel}
            availableModels={availableModels}
            activeSessionId={activeSessionId}
          />
        );
      case 'credentials':
        return <CredentialsSettings />;
      case 'channels':
        return <ChannelsSettings />;
      case 'appearance':
        return <AppearanceSettings themes={[...themes, ...customThemes]} />;
      case 'desktop':
        return <DesktopSettings />;
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
        <h1 className="text-sm font-display font-semibold text-pi-text">{t('settings.title')}</h1>
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
                {t(tab.labelKey)}
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
  const addToast = useUIStore((s) => s.addToast);
  const { t } = useI18n();
  const [fontSizeDraft, setFontSizeDraft] = useState(settings.fontSize);
  const [fontFamilyDraft, setFontFamilyDraft] = useState(settings.fontFamily);
  const [monoFontFamilyDraft, setMonoFontFamilyDraft] = useState(settings.monoFontFamily);

  useEffect(() => {
    setFontSizeDraft(settings.fontSize);
  }, [settings.fontSize]);

  useEffect(() => {
    setFontFamilyDraft(settings.fontFamily);
    setMonoFontFamilyDraft(settings.monoFontFamily);
  }, [settings.fontFamily, settings.monoFontFamily]);

  const fontSizeChanged = fontSizeDraft !== settings.fontSize;
  const fontFamilyChanged = fontFamilyDraft !== settings.fontFamily || monoFontFamilyDraft !== settings.monoFontFamily;

  const applyFontFamily = () => {
    settings.updateSetting('fontFamily', cleanFontStack(fontFamilyDraft, settings.fontFamily));
    settings.updateSetting('monoFontFamily', cleanFontStack(monoFontFamilyDraft, settings.monoFontFamily));
  };

  return (
    <div className="max-w-md space-y-6">
      <h2 className="text-sm font-semibold text-pi-text mb-4">{t('settings.general.title')}</h2>

      <div className="space-y-4">
        {/* Language */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe size={14} className="text-pi-dim" />
            <span className="text-xs text-pi-text">{t('settings.general.language')}</span>
          </div>
          <select
            value={settings.language}
            onChange={(e) => settings.updateSetting('language', e.target.value as 'en' | 'zh' | 'ja')}
            className="px-2 py-1 rounded-md bg-pi-bg-tertiary border border-pi-border text-xs text-pi-text"
          >
            <option value="en">{t('settings.language.en')}</option>
            <option value="zh">{t('settings.language.zh')}</option>
            <option value="ja">{t('settings.language.ja')}</option>
          </select>
        </div>

        {/* Font Size */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Type size={14} className="text-pi-dim" />
            <span className="text-xs text-pi-text">{t('settings.general.fontSize')}</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min="10"
              max="20"
              value={fontSizeDraft}
              onChange={(e) => setFontSizeDraft(Number(e.target.value))}
              className="w-24"
            />
            <span className="text-xs text-pi-dim w-8">{fontSizeDraft}px</span>
            <button
              onClick={() => settings.updateSetting('fontSize', fontSizeDraft)}
              disabled={!fontSizeChanged}
              className="h-7 px-2.5 rounded-md bg-pi-accent text-white text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-pi-accent/90 transition-colors"
            >
              {t('settings.general.apply')}
            </button>
          </div>
        </div>

        {/* Font Family */}
        <div className="space-y-3 rounded-lg border border-pi-border bg-pi-bg-secondary p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Type size={14} className="text-pi-dim" />
              <span className="text-xs text-pi-text">{t('settings.general.fontFamily')}</span>
            </div>
            <button
              onClick={applyFontFamily}
              disabled={!fontFamilyChanged}
              className="h-7 px-2.5 rounded-md bg-pi-accent text-white text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed hover:bg-pi-accent/90 transition-colors"
            >
              {t('settings.general.apply')}
            </button>
          </div>

          <FontStackPicker
            label={t('settings.general.interfaceFont')}
            value={fontFamilyDraft}
            presets={UI_FONT_PRESETS}
            onChange={setFontFamilyDraft}
          />
          <FontStackPicker
            label={t('settings.general.codeFont')}
            value={monoFontFamilyDraft}
            presets={MONO_FONT_PRESETS}
            onChange={setMonoFontFamilyDraft}
          />

          <div className="rounded-md border border-pi-border bg-pi-bg-tertiary px-3 py-2">
            <div className="text-xs text-pi-text" style={{ fontFamily: fontFamilyDraft }}>
              {t('settings.general.fontPreview')}
            </div>
            <div className="mt-1 text-[10px] text-pi-dim" style={{ fontFamily: monoFontFamilyDraft }}>
              const piAgent = 'desktop';
            </div>
          </div>
        </div>

        {/* Show Thinking */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-pi-text">{t('settings.general.showThinking')}</span>
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
          <span className="text-xs text-pi-text">{t('settings.general.compactOverflow')}</span>
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
              if (confirm(t('settings.general.resetConfirm'))) {
                settings.resetSettings();
                piApi.send({ type: 'theme_set', name: 'dark' });
                addToast({ type: 'success', message: t('settings.appearance.settingsReset') });
              }
            }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs text-pi-error
                       hover:bg-pi-error/10 transition-colors"
          >
            <Trash2 size={13} />
            {t('settings.general.reset')}
          </button>
        </div>
      </div>
    </div>
  );
}

function DesktopSettings() {
  const { t } = useI18n();
  const addToast = useUIStore((s) => s.addToast);
  const [status, setStatus] = useState<DesktopUpdateStatus | null>(null);
  const [busyAction, setBusyAction] = useState<'check' | 'download' | 'install' | null>(null);
  const desktopApi = typeof window !== 'undefined' ? window.piDesktop : undefined;
  const desktopAvailable = Boolean(desktopApi?.getUpdateStatus);

  useEffect(() => {
    let disposed = false;
    if (!desktopApi?.getUpdateStatus) return undefined;

    desktopApi.getUpdateStatus()
      .then((next) => {
        if (!disposed) setStatus(next);
      })
      .catch((err) => {
        if (!disposed) {
          setStatus(createUnsupportedUpdateStatus(err instanceof Error ? err.message : String(err)));
        }
      });

    const unsubscribe = desktopApi.onUpdateStatus?.((next) => {
      if (!disposed) setStatus(next);
    });

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [desktopApi]);

  const updateState = status?.state ?? 'unsupported';
  const updateVersion = status?.version && status.version !== status.currentVersion ? status.version : null;
  const canCheck = desktopAvailable && status?.supported && updateState !== 'checking' && updateState !== 'downloading' && updateState !== 'installing';
  const canDownload = desktopAvailable && updateState === 'available' && busyAction !== 'download';
  const canInstall = desktopAvailable && updateState === 'downloaded' && busyAction !== 'install';
  const progress = status?.progress;
  const progressPercent = Math.max(0, Math.min(100, Math.round(progress?.percent ?? 0)));
  const stateLabel = updateStatusLabel(updateState, t);

  const runUpdateAction = async (
    action: 'check' | 'download' | 'install',
    runner: () => Promise<DesktopUpdateStatus>,
    failureKey: TranslationKey
  ) => {
    setBusyAction(action);
    try {
      const next = await runner();
      setStatus(next);
      if (action === 'check') {
        addToast({
          type: next.state === 'available' ? 'success' : next.state === 'error' ? 'error' : 'info',
          message: next.state === 'available'
            ? t('settings.desktop.updateAvailableToast', { version: next.version ?? '' })
            : next.state === 'not-available'
              ? t('settings.desktop.noUpdateToast')
              : updateStatusLabel(next.state, t),
        });
      } else if (action === 'download') {
        addToast({ type: 'info', message: t('settings.desktop.downloadStarted') });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addToast({ type: 'error', message: t(failureKey, { message }) });
    } finally {
      setBusyAction(null);
    }
  };

  const handleCheck = () => {
    if (!desktopApi?.checkForUpdates) return;
    runUpdateAction('check', () => desktopApi.checkForUpdates(), 'settings.desktop.checkFailed');
  };

  const handleDownload = () => {
    if (!desktopApi?.downloadUpdate) return;
    runUpdateAction('download', () => desktopApi.downloadUpdate(), 'settings.desktop.downloadFailed');
  };

  const handleInstall = () => {
    if (!desktopApi?.installUpdate) return;
    if (!confirm(t('settings.desktop.installConfirm'))) return;
    runUpdateAction('install', () => desktopApi.installUpdate(), 'settings.desktop.installFailed');
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-pi-text">{t('settings.desktop.title')}</h2>
        <p className="mt-1 text-xs leading-relaxed text-pi-dim">{t('settings.desktop.subtitle')}</p>
      </div>

      <section className="rounded-lg border border-pi-border bg-pi-bg-secondary p-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 space-y-3">
            <div className="flex items-center gap-2">
              {updateState === 'checking' || updateState === 'downloading' || updateState === 'installing' ? (
                <Loader2 size={16} className="animate-spin text-pi-accent" />
              ) : updateState === 'error' || updateState === 'unsupported' ? (
                <XCircle size={16} className="text-pi-error" />
              ) : updateState === 'downloaded' || updateState === 'not-available' ? (
                <CheckCircle2 size={16} className="text-pi-success" />
              ) : (
                <RefreshCw size={16} className="text-pi-accent" />
              )}
              <div>
                <div className="text-xs font-semibold text-pi-text">{t('settings.desktop.status')}</div>
                <div className="text-[10px] text-pi-dim">{stateLabel}</div>
              </div>
            </div>

            <div className="grid gap-2 text-xs text-pi-muted sm:grid-cols-2">
              <MetaLine label={t('settings.desktop.currentVersion')} value={status?.currentVersion ?? '-'} />
              <MetaLine label={t('settings.desktop.latestVersion')} value={updateVersion ?? status?.version ?? '-'} />
              <MetaLine label={t('settings.desktop.channel')} value={status?.channel ?? '-'} />
              <MetaLine label={t('settings.desktop.lastChecked')} value={formatUpdateDate(status?.lastCheckedAt, t)} />
              <MetaLine
                label={t('settings.desktop.updateFeed')}
                value={status?.feedUrl ?? t('settings.desktop.defaultFeed')}
                wide
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2 md:justify-end">
            <button
              onClick={handleCheck}
              disabled={!canCheck || busyAction !== null}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-pi-border px-3 text-xs font-medium text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busyAction === 'check' || updateState === 'checking' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              {busyAction === 'check' || updateState === 'checking' ? t('settings.desktop.checking') : t('settings.desktop.check')}
            </button>

            <button
              onClick={handleDownload}
              disabled={!canDownload || busyAction !== null}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-pi-border px-3 text-xs font-medium text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busyAction === 'download' || updateState === 'downloading' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
              {busyAction === 'download' || updateState === 'downloading' ? t('settings.desktop.downloading') : t('settings.desktop.download')}
            </button>

            <button
              onClick={handleInstall}
              disabled={!canInstall || busyAction !== null}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-pi-accent px-3 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Power size={13} />
              {t('settings.desktop.install')}
            </button>
          </div>
        </div>

        {progress && (
          <div className="mt-4 space-y-1.5">
            <div className="flex items-center justify-between text-[10px] text-pi-dim">
              <span>{t('settings.desktop.progress')}</span>
              <span>{progressPercent}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-pi-bg-tertiary">
              <div className="h-full rounded-full bg-pi-accent transition-all" style={{ width: `${progressPercent}%` }} />
            </div>
          </div>
        )}

        {!desktopAvailable && (
          <div className="mt-4 rounded-md border border-pi-warning/30 bg-pi-warning/10 px-3 py-2 text-xs text-pi-warning">
            {t('settings.desktop.desktopOnly')}
          </div>
        )}

        {status?.error && (
          <div className="mt-4 rounded-md border border-pi-error/30 bg-pi-error/10 px-3 py-2 text-xs leading-relaxed text-pi-error">
            {status.error}
          </div>
        )}

        {status?.state === 'unsupported' && !status.error && (
          <div className="mt-4 rounded-md border border-pi-border bg-pi-bg-tertiary px-3 py-2 text-xs text-pi-dim">
            {t('settings.desktop.unsupportedHint')}
          </div>
        )}
      </section>

      {(status?.releaseNotes || status?.releaseDate || updateVersion) && (
        <section className="rounded-lg border border-pi-border bg-pi-bg-secondary p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-xs font-semibold text-pi-text">{t('settings.desktop.releaseNotes')}</h3>
            {status?.releaseDate && <span className="text-[10px] text-pi-dim">{new Date(status.releaseDate).toLocaleString()}</span>}
          </div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-pi-bg-tertiary p-3 text-xs leading-relaxed text-pi-muted">
            {status?.releaseNotes || t('settings.desktop.noReleaseNotes')}
          </pre>
        </section>
      )}
    </div>
  );
}

function MetaLine({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={cn('min-w-0', wide && 'sm:col-span-2')}>
      <div className="text-[10px] font-semibold uppercase text-pi-dim">{label}</div>
      <div className="mt-0.5 truncate text-xs text-pi-text" title={value}>{value}</div>
    </div>
  );
}

function createUnsupportedUpdateStatus(error: string): DesktopUpdateStatus {
  return {
    supported: false,
    enabled: false,
    state: 'unsupported',
    currentVersion: '-',
    version: null,
    releaseName: null,
    releaseDate: null,
    releaseNotes: null,
    progress: null,
    error,
    feedUrl: null,
    channel: 'latest',
    lastCheckedAt: null,
    downloadedFile: null,
    source: null,
  };
}

function updateStatusLabel(state: DesktopUpdateState, t: (key: TranslationKey, values?: Record<string, string | number>) => string) {
  return t(`settings.desktop.update.state.${state}` as TranslationKey);
}

function formatUpdateDate(timestamp: number | null | undefined, t: (key: TranslationKey) => string) {
  return timestamp ? new Date(timestamp).toLocaleString() : t('settings.desktop.neverChecked');
}

function FontStackPicker({
  label,
  value,
  presets,
  onChange,
}: {
  label: string;
  value: string;
  presets: readonly { label: string; value: string }[];
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const isPreset = presets.some((preset) => preset.value === value);

  return (
    <label className="block space-y-1.5">
      <span className="text-[10px] font-semibold uppercase text-pi-dim">{label}</span>
      <div className="flex flex-col gap-2 sm:flex-row">
        <select
          value={isPreset ? value : '__custom__'}
          onChange={(event) => {
            if (event.target.value !== '__custom__') {
              onChange(event.target.value);
            }
          }}
          className="h-8 rounded-md bg-pi-bg-tertiary border border-pi-border px-2 text-xs text-pi-text"
        >
          {presets.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
          <option value="__custom__">{t('themeEditor.customBadge')}</option>
        </select>
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 min-w-0 flex-1 rounded-md bg-pi-bg-tertiary border border-pi-border px-2 text-xs text-pi-text placeholder:text-pi-dim focus:border-pi-accent focus:outline-none"
          placeholder="'Inter', system-ui, sans-serif"
        />
      </div>
    </label>
  );
}

function cleanFontStack(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (!trimmed || /[;{}]/.test(trimmed)) return fallback;
  return trimmed;
}

function PermissionsSettings() {
  const { t } = useI18n();
  const settings = useSettingsStore();
  const addToast = useUIStore((s) => s.addToast);
  const [rules, setRules] = useState<PermissionRule[]>([]);
  const [audit, setAudit] = useState<PermissionAuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyRule, setBusyRule] = useState<string | null>(null);
  const modes = [
    { value: 'ask', labelKey: 'chat.permission.ask.label', descKey: 'chat.permission.ask.description' },
    { value: 'acceptEdits', labelKey: 'chat.permission.acceptEdits.label', descKey: 'chat.permission.acceptEdits.description' },
    { value: 'plan', labelKey: 'chat.permission.plan.label', descKey: 'chat.permission.plan.description' },
    { value: 'bypassPermissions', labelKey: 'chat.permission.bypassPermissions.label', descKey: 'chat.permission.bypassPermissions.description' },
  ] as const;

  const loadPermissions = useCallback(async () => {
    setLoading(true);
    try {
      const [rulesResult, auditResult] = await Promise.all([
        piApi.getPermissionRules(),
        piApi.getPermissionAudit(8),
      ]);
      setRules(rulesResult.rules);
      setAudit(auditResult.entries);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addToast({ type: 'error', message: t('settings.permissions.loadFailed', { message }) });
    } finally {
      setLoading(false);
    }
  }, [addToast, t]);

  useEffect(() => {
    void loadPermissions();
  }, [loadPermissions]);

  const deleteRule = async (rule: PermissionRule) => {
    setBusyRule(rule.id);
    try {
      await piApi.deletePermissionRule(rule.id);
      setRules((current) => current.filter((item) => item.id !== rule.id));
      addToast({ type: 'success', message: t('settings.permissions.ruleRemoved') });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addToast({ type: 'error', message: t('settings.permissions.ruleRemoveFailed', { message }) });
    } finally {
      setBusyRule(null);
    }
  };

  const clearRules = async () => {
    if (!confirm(t('settings.permissions.clearConfirm'))) return;
    setLoading(true);
    try {
      await piApi.clearPermissionRules();
      setRules([]);
      addToast({ type: 'success', message: t('settings.permissions.rulesCleared') });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addToast({ type: 'error', message: t('settings.permissions.clearFailed', { message }) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-pi-text">{t('settings.permissions.title')}</h2>
          <div className="mt-1 text-[10px] text-pi-dim">
            {t('settings.permissions.summary', { rules: rules.length, decisions: audit.length })}
          </div>
        </div>
        <button
          onClick={() => void loadPermissions()}
          disabled={loading}
          className="w-8 h-8 rounded-md border border-pi-border text-pi-muted hover:text-pi-text hover:bg-pi-bg-hover disabled:opacity-50 flex items-center justify-center transition-colors"
          title={t('settings.permissions.refresh')}
        >
          <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
        </button>
      </div>

      <section className="space-y-2">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase text-pi-dim">
          <Shield size={12} />
          {t('settings.permissions.mode')}
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {modes.map((mode) => (
            <button
              key={mode.value}
              onClick={() => {
                settings.updateSetting('permissionMode', mode.value);
                piApi.send({ type: 'set_permission_mode', mode: mode.value });
              }}
              className={cn(
                'text-left p-3 rounded-lg border transition-colors',
                settings.permissionMode === mode.value
                  ? 'border-pi-accent bg-pi-accent/5'
                  : 'border-pi-border hover:border-pi-muted'
              )}
            >
              <div className="text-xs font-medium text-pi-text">{t(mode.labelKey)}</div>
              <div className="text-[10px] text-pi-dim mt-0.5">{t(mode.descKey)}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase text-pi-dim">
            <ShieldCheck size={12} />
            {t('settings.permissions.savedRules')}
          </div>
          {rules.length > 0 && (
            <button
              onClick={() => void clearRules()}
              disabled={loading}
              className="text-[10px] text-pi-error hover:underline disabled:opacity-50"
            >
              {t('settings.permissions.clearAll')}
            </button>
          )}
        </div>

        <div className="space-y-2">
          {rules.map((rule) => (
            <PermissionRuleRow
              key={rule.id}
              rule={rule}
              busy={busyRule === rule.id}
              onDelete={() => void deleteRule(rule)}
            />
          ))}

          {!loading && rules.length === 0 && (
            <div className="rounded-md border border-pi-border bg-pi-bg-secondary px-4 py-5 text-center text-xs text-pi-dim">
              {t('settings.permissions.noRules')}
            </div>
          )}

          {loading && rules.length === 0 && (
            <div className="rounded-md border border-pi-border bg-pi-bg-secondary px-4 py-5 flex items-center justify-center gap-2 text-xs text-pi-dim">
              <Loader2 size={14} className="animate-spin" />
              {t('settings.permissions.loadingRules')}
            </div>
          )}
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase text-pi-dim">
          <History size={12} />
          {t('settings.permissions.recentDecisions')}
        </div>
        <div className="rounded-lg border border-pi-border bg-pi-bg-secondary overflow-hidden">
          {audit.map((entry) => (
            <PermissionAuditRow key={entry.id} entry={entry} />
          ))}
          {!loading && audit.length === 0 && (
            <div className="px-4 py-5 text-center text-xs text-pi-dim">
              {t('settings.permissions.noDecisions')}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function PermissionRuleRow({
  rule,
  busy,
  onDelete,
}: {
  rule: PermissionRule;
  busy: boolean;
  onDelete: () => void;
}) {
  const { t } = useI18n();

  return (
    <div className="rounded-lg border border-pi-border bg-pi-bg-secondary p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-pi-text">{rule.description}</span>
            <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase', scopeClass(rule.scope))}>
              {rule.scope}
            </span>
            <span className="rounded px-1.5 py-0.5 text-[9px] font-mono bg-pi-bg-tertiary text-pi-dim">
              {rule.toolName}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-pi-dim">
            {rule.commandPrefix && <span className="font-mono truncate max-w-[360px]">{rule.commandPrefix}</span>}
            {rule.pathPattern && <span className="font-mono truncate max-w-[360px]">{rule.pathPattern}</span>}
            <span>{t('settings.permissions.uses', { count: rule.useCount })}</span>
            {rule.projectPath && <span className="truncate max-w-[360px]">{rule.projectPath}</span>}
          </div>
        </div>
        <button
          onClick={onDelete}
          disabled={busy}
          className="w-7 h-7 rounded-md border border-pi-border text-pi-muted hover:text-pi-error hover:border-pi-error/40 disabled:opacity-50 flex items-center justify-center transition-colors"
          title={t('settings.permissions.removeRule')}
        >
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
        </button>
      </div>
    </div>
  );
}

function PermissionAuditRow({ entry }: { entry: PermissionAuditEntry }) {
  const { t } = useI18n();

  return (
    <div className="flex items-start gap-3 px-3 py-2 border-b border-pi-border last:border-b-0">
      <span className={cn('mt-0.5 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase', actionClass(entry.action))}>
        {entry.action === 'always_allow' ? t('settings.permissions.action.remember') : entry.action}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-xs text-pi-text">
          <span className="font-mono text-pi-accent">{entry.toolName}</span>
          {entry.scope && <span className="text-[10px] text-pi-dim">{scopeLabel(entry.scope, t)}</span>}
          <span className="text-[10px] text-pi-dim">{formatTime(entry.timestamp)}</span>
        </div>
        <div className="mt-0.5 text-[10px] text-pi-dim truncate">
          {entry.command ?? entry.path ?? entry.reason ?? entry.message ?? t('settings.permissions.recorded')}
        </div>
      </div>
    </div>
  );
}

function scopeClass(scope: PermissionRule['scope']): string {
  if (scope === 'global') return 'bg-pi-error/10 text-pi-error';
  if (scope === 'project') return 'bg-pi-accent/10 text-pi-accent';
  return 'bg-pi-success/10 text-pi-success';
}

function actionClass(action: PermissionAuditEntry['action']): string {
  if (action === 'deny') return 'bg-pi-error/10 text-pi-error';
  if (action === 'always_allow') return 'bg-pi-success/10 text-pi-success';
  return 'bg-pi-accent/10 text-pi-accent';
}

function scopeLabel(
  scope: PermissionRule['scope'],
  t: (key: TranslationKey, values?: Record<string, string | number>) => string
): string {
  if (scope === 'global') return t('settings.permissions.scope.global');
  if (scope === 'project') return t('settings.permissions.scope.project');
  return t('settings.permissions.scope.session');
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

interface ModelSettingsProps {
  currentModel: ModelInfo | null;
  thinkingLevel: ThinkingLevel;
  availableModels: ModelInfo[];
  activeSessionId: string | null;
}

function modelForSession(session: Session, models: ModelInfo[], fallback: ModelInfo | null): ModelInfo | null {
  const provider = session.modelProvider;
  return models.find((model) => model.id === session.modelId && (!provider || model.provider === provider))
    ?? models.find((model) => model.id === session.modelId)
    ?? fallback;
}

function ModelSettings({ currentModel, thinkingLevel, availableModels, activeSessionId }: ModelSettingsProps) {
  const { t } = useI18n();
  const addToast = useUIStore((s) => s.addToast);
  const setCurrentModel = useModelStore((s) => s.setCurrentModel);
  const setGlobalThinkingLevel = useModelStore((s) => s.setThinkingLevel);
  const activeSession = useChatStore((s) => s.sessions.find((session) => session.id === activeSessionId));
  const updateSession = useChatStore((s) => s.updateSession);
  const thinkingLevels: ThinkingLevel[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'];
  const scopeLabel = activeSession ? t('settings.model.thinkingSessionScope', { name: activeSession.title }) : t('settings.model.thinkingGlobalScope');

  const selectThinkingLevel = (level: ThinkingLevel) => {
    const sent = piApi.send({
      type: 'set_thinking_level',
      sessionId: activeSessionId ?? undefined,
      level,
    });
    if (!sent) {
      addToast({ type: 'error', message: t('chat.switchThinkingDisconnected') });
      return;
    }

    if (activeSession) {
      updateSession({ ...activeSession, thinkingLevel: level, updatedAt: Date.now() });
    } else {
      setGlobalThinkingLevel(level);
    }
  };

  const selectModel = (model: ModelInfo) => {
    const sent = piApi.send({
      type: 'set_model',
      sessionId: activeSessionId ?? undefined,
      modelId: model.id,
      provider: model.provider,
    });
    if (!sent) {
      addToast({ type: 'error', message: t('chat.switchModelDisconnected') });
      return;
    }

    if (activeSession) {
      updateSession({
        ...activeSession,
        modelProvider: model.provider,
        modelId: model.id,
        updatedAt: Date.now(),
      });
    } else {
      setCurrentModel(model);
    }
  };

  return (
    <div className="max-w-md space-y-6">
      <h2 className="text-sm font-semibold text-pi-text mb-4">{t('settings.model.title')}</h2>

      {/* Current model */}
      <div>
        <label className="text-[10px] font-semibold text-pi-dim uppercase">{t('settings.model.currentModel')}</label>
        <div className="mt-1 p-2 rounded-md bg-pi-bg-tertiary border border-pi-border text-xs text-pi-text">
          {currentModel ? `${currentModel.provider}/${currentModel.name}` : t('settings.model.notSelected')}
        </div>
      </div>

      {/* Thinking Level */}
      <div>
        <label className="text-[10px] font-semibold text-pi-dim uppercase">{t('settings.model.thinkingLevel')}</label>
        <div className="mt-1 text-[10px] text-pi-dim">{scopeLabel}</div>
        <div className="mt-1 flex gap-1">
          {thinkingLevels.map((level) => (
            <button
              key={level}
              onClick={() => selectThinkingLevel(level)}
              className={cn(
                'px-2.5 py-1 rounded-md text-[10px] font-medium transition-colors',
                thinkingLevel === level
                  ? 'bg-pi-accent text-white'
                  : 'bg-pi-bg-tertiary text-pi-dim hover:text-pi-text border border-pi-border'
              )}
            >
              {t(`chat.thinking.${level}` as TranslationKey)}
            </button>
          ))}
        </div>
      </div>

      {/* Available models */}
      <div>
        <label className="text-[10px] font-semibold text-pi-dim uppercase">
          {t('settings.model.availableModels', { count: availableModels.length })}
        </label>
        <div className="mt-1 space-y-1 max-h-[300px] overflow-y-auto">
          {availableModels.slice(0, 20).map((model) => (
            <button
              key={`${model.provider}/${model.id}`}
              onClick={() => selectModel(model)}
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

type CredentialFilter = 'all' | 'configured' | 'available';

function CredentialsSettings() {
  const { t } = useI18n();
  const addToast = useUIStore((s) => s.addToast);
  const [status, setStatus] = useState<AuthStatusResult | null>(null);
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [baseUrls, setBaseUrls] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<CredentialFilter>('all');
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [testingProvider, setTestingProvider] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, AuthProviderTestResult>>({});
  const [error, setError] = useState<string | null>(null);

  const applyAuthStatus = useCallback((next: AuthStatusResult) => {
    setStatus(next);
    setBaseUrls(Object.fromEntries(next.providers.map((provider) => [provider.id, provider.baseUrl ?? ''])));
  }, []);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      applyAuthStatus(await piApi.getAuthStatus());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      addToast({ type: 'error', message: t('settings.credentials.loadFailed', { message }) });
    } finally {
      setLoading(false);
    }
  }, [addToast, applyAuthStatus, t]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const providers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (status?.providers ?? [])
      .filter((provider) => {
        if (filter === 'configured' && !provider.configured) return false;
        if (filter === 'available' && provider.availableModels === 0) return false;
        if (!query) return true;
        return [
          provider.name,
          provider.id,
          provider.label,
          provider.baseUrl,
          provider.defaultBaseUrl,
          provider.docsUrl,
          ...(provider.aliases ?? []),
        ].filter(Boolean).join(' ').toLowerCase().includes(query);
      })
      .sort((a, b) => {
        const configuredDelta = Number(b.configured) - Number(a.configured);
        if (configuredDelta) return configuredDelta;
        const availableDelta = b.availableModels - a.availableModels;
        if (availableDelta) return availableDelta;
        return a.name.localeCompare(b.name);
      });
  }, [filter, search, status?.providers]);

  useEffect(() => {
    if (providers.length === 0) {
      setSelectedProviderId(null);
      return;
    }
    if (!selectedProviderId || !providers.some((provider) => provider.id === selectedProviderId)) {
      setSelectedProviderId(providers[0]!.id);
    }
  }, [providers, selectedProviderId]);

  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId) ?? providers[0] ?? null;
  const configuredCount = status?.providers.filter((provider) => provider.configured).length ?? 0;
  const availableCount = status?.providers.filter((provider) => provider.availableModels > 0).length ?? 0;
  const proxyCount = status?.providers.filter((provider) => provider.baseUrl).length ?? 0;

  const saveApiKey = async (provider: AuthProviderStatus) => {
    const apiKey = apiKeys[provider.id]?.trim() ?? '';
    if (!apiKey) {
      addToast({ type: 'warning', message: t('settings.credentials.enterApiKey', { provider: provider.name }) });
      return;
    }

    setBusyProvider(provider.id);
    try {
      const next = await piApi.saveProviderApiKey(provider.id, apiKey);
      applyAuthStatus(next);
      setApiKeys((current) => ({ ...current, [provider.id]: '' }));
      piApi.send({ type: 'auth_refresh' });
      addToast({ type: 'success', message: t('settings.credentials.saved', { provider: provider.name }) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addToast({ type: 'error', message: t('settings.credentials.saveFailed', { provider: provider.name, message }) });
    } finally {
      setBusyProvider(null);
    }
  };

  const removeApiKey = async (provider: AuthProviderStatus) => {
    setBusyProvider(provider.id);
    try {
      applyAuthStatus(await piApi.removeProviderApiKey(provider.id));
      setApiKeys((current) => ({ ...current, [provider.id]: '' }));
      piApi.send({ type: 'auth_refresh' });
      addToast({ type: 'success', message: t('settings.credentials.removed', { provider: provider.name }) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addToast({ type: 'error', message: t('settings.credentials.removeFailed', { provider: provider.name, message }) });
    } finally {
      setBusyProvider(null);
    }
  };

  const saveProviderEndpoint = async (provider: AuthProviderStatus) => {
    const baseUrl = baseUrls[provider.id]?.trim() ?? '';
    setBusyProvider(`config:${provider.id}`);
    try {
      applyAuthStatus(await piApi.saveProviderConfig(provider.id, baseUrl));
      piApi.send({ type: 'auth_refresh' });
      addToast({
        type: 'success',
        message: baseUrl
          ? t('settings.credentials.endpointSaved', { provider: provider.name })
          : t('settings.credentials.endpointCleared', { provider: provider.name }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addToast({ type: 'error', message: t('settings.credentials.endpointFailed', { provider: provider.name, message }) });
    } finally {
      setBusyProvider(null);
    }
  };

  const clearProviderEndpoint = async (provider: AuthProviderStatus) => {
    setBusyProvider(`config:${provider.id}`);
    try {
      applyAuthStatus(await piApi.removeProviderConfig(provider.id));
      piApi.send({ type: 'auth_refresh' });
      addToast({ type: 'success', message: t('settings.credentials.endpointCleared', { provider: provider.name }) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addToast({ type: 'error', message: t('settings.credentials.endpointFailed', { provider: provider.name, message }) });
    } finally {
      setBusyProvider(null);
    }
  };

  const testProvider = async (provider: AuthProviderStatus) => {
    setTestingProvider(provider.id);
    try {
      const result = await piApi.testProviderAuth(provider.id);
      setTestResults((current) => ({ ...current, [provider.id]: result }));
      addToast({
        type: result.ok ? 'success' : 'warning',
        message: result.message,
        duration: 6000,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addToast({ type: 'error', message: t('settings.credentials.testFailed', { provider: provider.name, message }) });
    } finally {
      setTestingProvider(null);
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-display font-semibold text-pi-text">{t('settings.credentials.title')}</h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-pi-dim">{t('settings.credentials.appleHint')}</p>
        </div>
        <button
          onClick={() => void loadStatus()}
          disabled={loading}
          className="flex h-8 items-center gap-1.5 rounded-full border border-pi-border bg-pi-bg-secondary px-3 text-xs font-medium text-pi-muted shadow-sm transition-colors hover:bg-pi-bg-hover hover:text-pi-text disabled:opacity-50"
          title={t('settings.credentials.refresh')}
        >
          <RefreshCw size={13} className={cn(loading && 'animate-spin')} />
          {loading ? t('settings.credentials.refreshing') : t('settings.credentials.refresh')}
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <CredentialMetric label={t('settings.credentials.configured', { count: configuredCount })} value={configuredCount} tone="success" />
        <CredentialMetric label={t('settings.credentials.available', { count: availableCount })} value={availableCount} tone="accent" />
        <CredentialMetric label={t('settings.credentials.proxies', { count: proxyCount })} value={proxyCount} tone="muted" />
      </div>

      {error && (
        <div className="rounded-xl border border-pi-error/30 bg-pi-error/10 px-3 py-2 text-xs text-pi-error">
          {error}
        </div>
      )}

      {status?.modelsJsonError && (
        <div className="rounded-xl border border-pi-warning/30 bg-pi-warning/10 px-3 py-2 text-xs text-pi-warning">
          {t('settings.credentials.modelsJsonError', { message: status.modelsJsonError })}
        </div>
      )}

      <div className="grid min-h-[560px] overflow-hidden rounded-2xl border border-pi-border bg-pi-bg-secondary shadow-[0_22px_80px_color-mix(in_srgb,var(--pi-bg)_60%,transparent)] lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="min-h-0 border-b border-pi-border bg-pi-bg-secondary/70 lg:border-b-0 lg:border-r">
          <div className="sticky top-0 z-10 space-y-3 border-b border-pi-border bg-pi-bg-secondary/95 p-3 backdrop-blur-xl">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-pi-dim" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('settings.credentials.search')}
                className="h-9 w-full rounded-full border border-pi-border bg-pi-bg-tertiary pl-8 pr-3 text-xs text-pi-text placeholder:text-pi-dim focus:border-pi-accent focus:outline-none"
              />
            </div>

            <div className="flex h-8 overflow-hidden rounded-full border border-pi-border bg-pi-bg-tertiary p-0.5">
              {(['all', 'configured', 'available'] as const).map((value) => (
                <button
                  key={value}
                  onClick={() => setFilter(value)}
                  className={cn(
                    'flex-1 rounded-full px-2 text-[10px] font-semibold transition-colors',
                    filter === value
                      ? 'bg-pi-bg-secondary text-pi-text shadow-sm'
                      : 'text-pi-muted hover:text-pi-text'
                  )}
                >
                  {t(`settings.credentials.filter.${value}` as TranslationKey)}
                </button>
              ))}
            </div>
          </div>

          <div className="max-h-[520px] space-y-1 overflow-y-auto p-2">
            {providers.map((provider) => (
              <ProviderListItem
                key={provider.id}
                provider={provider}
                active={selectedProvider?.id === provider.id}
                testResult={testResults[provider.id]}
                onClick={() => setSelectedProviderId(provider.id)}
              />
            ))}

            {!loading && providers.length === 0 && (
              <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-pi-border px-4 text-center text-xs text-pi-dim">
                {t('settings.credentials.noProviders')}
              </div>
            )}

            {loading && !status && (
              <div className="flex h-40 items-center justify-center gap-2 rounded-xl border border-pi-border bg-pi-bg-tertiary text-xs text-pi-dim">
                <Loader2 size={14} className="animate-spin" />
                {t('settings.credentials.loadingProviders')}
              </div>
            )}
          </div>
        </aside>

        <main className="min-h-0 overflow-y-auto bg-pi-bg/35 p-4 lg:p-5">
          {selectedProvider ? (
            <ProviderCredentialDetails
              provider={selectedProvider}
              apiKey={apiKeys[selectedProvider.id] ?? ''}
              baseUrl={baseUrls[selectedProvider.id] ?? ''}
              busy={busyProvider === selectedProvider.id}
              endpointBusy={busyProvider === `config:${selectedProvider.id}`}
              testing={testingProvider === selectedProvider.id}
              testResult={testResults[selectedProvider.id]}
              onApiKeyChange={(apiKey) => setApiKeys((current) => ({ ...current, [selectedProvider.id]: apiKey }))}
              onBaseUrlChange={(baseUrl) => setBaseUrls((current) => ({ ...current, [selectedProvider.id]: baseUrl }))}
              onSave={() => void saveApiKey(selectedProvider)}
              onRemove={() => void removeApiKey(selectedProvider)}
              onSaveEndpoint={() => void saveProviderEndpoint(selectedProvider)}
              onClearEndpoint={() => void clearProviderEndpoint(selectedProvider)}
              onTest={() => void testProvider(selectedProvider)}
            />
          ) : (
            <div className="flex h-full min-h-[420px] flex-col items-center justify-center gap-3 text-center text-pi-dim">
              <KeyRound size={30} strokeWidth={1.3} />
              <div className="max-w-xs text-xs leading-relaxed">{t('settings.credentials.noSelection')}</div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function CredentialMetric({ label, value, tone }: { label: string; value: number; tone: 'success' | 'accent' | 'muted' }) {
  return (
    <div className="rounded-2xl border border-pi-border bg-pi-bg-secondary px-4 py-3">
      <div className={cn(
        'text-xl font-semibold',
        tone === 'success' ? 'text-pi-success' : tone === 'accent' ? 'text-pi-accent' : 'text-pi-text'
      )}>
        {value}
      </div>
      <div className="mt-0.5 text-[10px] text-pi-dim">{label}</div>
    </div>
  );
}

function ProviderListItem({
  provider,
  active,
  testResult,
  onClick,
}: {
  provider: AuthProviderStatus;
  active: boolean;
  testResult?: AuthProviderTestResult;
  onClick: () => void;
}) {
  const { t } = useI18n();
  const statusTone = provider.configured ? 'text-pi-success' : testResult && !testResult.ok ? 'text-pi-warning' : 'text-pi-dim';

  return (
    <button
      onClick={onClick}
      className={cn(
        'group w-full rounded-xl px-3 py-2.5 text-left transition-colors',
        active ? 'bg-pi-selected-bg text-pi-text shadow-sm' : 'text-pi-muted hover:bg-pi-bg-hover hover:text-pi-text'
      )}
    >
      <div className="flex items-center gap-3">
        <div className={cn(
          'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border',
          provider.configured
            ? 'border-pi-success/25 bg-pi-success/10 text-pi-success'
            : 'border-pi-border bg-pi-bg-tertiary text-pi-dim'
        )}>
          <KeyRound size={14} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-xs font-semibold text-pi-text">{provider.name}</span>
            {provider.baseUrl && (
              <span className="rounded-full bg-pi-accent/10 px-1.5 py-0.5 text-[9px] font-semibold text-pi-accent">
                {t('settings.credentials.proxyBadge')}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-pi-dim">
            <span>{t('settings.credentials.models', { available: provider.availableModels, total: provider.models })}</span>
            <span className="h-1 w-1 rounded-full bg-pi-border" />
            <span className={statusTone}>
              {provider.configured ? t('settings.credentials.configuredBadge') : t('settings.credentials.missingBadge')}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

interface ProviderCredentialDetailsProps {
  provider: AuthProviderStatus;
  apiKey: string;
  baseUrl: string;
  busy: boolean;
  endpointBusy: boolean;
  testing: boolean;
  testResult?: AuthProviderTestResult;
  onApiKeyChange: (apiKey: string) => void;
  onBaseUrlChange: (baseUrl: string) => void;
  onSave: () => void;
  onRemove: () => void;
  onSaveEndpoint: () => void;
  onClearEndpoint: () => void;
  onTest: () => void;
}

function ProviderCredentialDetails({
  provider,
  apiKey,
  baseUrl,
  busy,
  endpointBusy,
  testing,
  testResult,
  onApiKeyChange,
  onBaseUrlChange,
  onSave,
  onRemove,
  onSaveEndpoint,
  onClearEndpoint,
  onTest,
}: ProviderCredentialDetailsProps) {
  const { t } = useI18n();
  const endpointChanged = baseUrl.trim() !== (provider.baseUrl ?? '');
  const endpointPlaceholder = provider.defaultBaseUrl ?? t('settings.credentials.baseUrlPlaceholder');
  const endpointDisplay = provider.baseUrl || provider.defaultBaseUrl || t('settings.credentials.noEndpoint');

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <section className="rounded-2xl border border-pi-border bg-pi-bg-secondary p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className={cn(
              'flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl border',
              provider.configured
                ? 'border-pi-success/25 bg-pi-success/10 text-pi-success'
                : 'border-pi-border bg-pi-bg-tertiary text-pi-dim'
            )}>
              <KeyRound size={18} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-base font-display font-semibold text-pi-text">{provider.name}</h3>
                <span className="rounded-full bg-pi-bg-tertiary px-2 py-0.5 font-mono text-[10px] text-pi-dim">
                  {provider.id}
                </span>
                {provider.baseUrl && (
                  <span className="rounded-full bg-pi-accent/10 px-2 py-0.5 text-[10px] font-semibold text-pi-accent">
                    {t('settings.credentials.proxyBadge')}
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] text-pi-dim">
                <span>{t('settings.credentials.modelsAvailable', { available: provider.availableModels, total: provider.models })}</span>
                {provider.source && <span>{provider.source}</span>}
                {provider.label && <span>{provider.label}</span>}
              </div>
            </div>
          </div>
          <div
            className={cn(
              'flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[10px] font-semibold',
              provider.configured
                ? 'bg-pi-success/10 text-pi-success'
                : 'bg-pi-bg-tertiary text-pi-muted'
            )}
          >
            {provider.configured ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
            {provider.configured ? t('settings.credentials.connected') : t('settings.credentials.notConnected')}
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <CredentialInfoRow label={t('settings.credentials.currentEndpoint')} value={endpointDisplay} mono />
          <CredentialInfoRow label={t('settings.credentials.modelsAvailable', { available: provider.availableModels, total: provider.models })} value={provider.label ?? provider.source ?? provider.id} />
        </div>

        {provider.docsUrl && (
          <a
            href={provider.docsUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex h-7 items-center gap-1.5 rounded-full border border-pi-border px-2.5 text-[10px] font-medium text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
          >
            <ExternalLink size={11} />
            {t('settings.credentials.docs')}
          </a>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border border-pi-border bg-pi-bg-secondary">
        <div className="border-b border-pi-border px-4 py-3">
          <div className="text-xs font-semibold text-pi-text">{t('settings.credentials.apiKeySection')}</div>
          <div className="mt-0.5 text-[10px] text-pi-dim">{t('settings.credentials.apiKeyHint')}</div>
        </div>
        <div className="grid gap-2 p-4 sm:grid-cols-[minmax(0,1fr)_auto]">
          <input
            value={apiKey}
            onChange={(event) => onApiKeyChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onSave();
            }}
            type="password"
            placeholder={t('settings.credentials.apiKeyPlaceholder')}
            disabled={busy}
            className="h-10 min-w-0 rounded-xl border border-pi-border bg-pi-bg-tertiary px-3 text-xs text-pi-text placeholder:text-pi-dim focus:border-pi-accent focus:outline-none disabled:opacity-50"
          />
          <div className="flex gap-2">
            <button
              onClick={onSave}
              disabled={busy}
              className="flex h-10 items-center gap-1.5 rounded-xl bg-pi-accent px-3 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              {t('common.save')}
            </button>
            <button
              onClick={onTest}
              disabled={busy || testing}
              className="flex h-10 items-center gap-1.5 rounded-xl border border-pi-border px-3 text-xs font-medium text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text disabled:opacity-50"
            >
              {testing ? <Loader2 size={13} className="animate-spin" /> : <PlugZap size={13} />}
              {t('common.test')}
            </button>
            <button
              onClick={onRemove}
              disabled={busy || !provider.configured}
              className="h-10 rounded-xl border border-pi-border px-3 text-xs font-medium text-pi-muted transition-colors hover:border-pi-error/40 hover:text-pi-error disabled:opacity-50 disabled:hover:border-pi-border disabled:hover:text-pi-muted"
            >
              {t('settings.credentials.remove')}
            </button>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-pi-border bg-pi-bg-secondary">
        <div className="border-b border-pi-border px-4 py-3">
          <div className="text-xs font-semibold text-pi-text">{t('settings.credentials.endpointSection')}</div>
          <div className="mt-0.5 text-[10px] text-pi-dim">{t('settings.credentials.endpointHint')}</div>
        </div>
        <div className="grid gap-2 p-4 sm:grid-cols-[minmax(0,1fr)_auto]">
          <input
            value={baseUrl}
            onChange={(event) => onBaseUrlChange(event.target.value)}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') onSaveEndpoint();
            }}
            placeholder={endpointPlaceholder}
            disabled={endpointBusy}
            className="h-10 min-w-0 rounded-xl border border-pi-border bg-pi-bg-tertiary px-3 font-mono text-[11px] text-pi-text placeholder:text-pi-dim focus:border-pi-accent focus:outline-none disabled:opacity-50"
          />
          <div className="flex gap-2">
            <button
              onClick={onSaveEndpoint}
              disabled={endpointBusy || !endpointChanged}
              className="flex h-10 items-center gap-1.5 rounded-xl border border-pi-border px-3 text-xs font-medium text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text disabled:opacity-50"
            >
              {endpointBusy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              {t('settings.credentials.endpointApply')}
            </button>
            <button
              onClick={onClearEndpoint}
              disabled={endpointBusy || !provider.baseUrl}
              className="h-10 rounded-xl border border-pi-border px-3 text-xs font-medium text-pi-muted transition-colors hover:border-pi-error/40 hover:text-pi-error disabled:opacity-50 disabled:hover:border-pi-border disabled:hover:text-pi-muted"
            >
              {t('settings.credentials.endpointClear')}
            </button>
          </div>
        </div>
      </section>

      {testResult && (
        <section
          className={cn(
            'rounded-2xl border px-4 py-3 text-xs',
            testResult.ok
              ? 'border-pi-success/30 bg-pi-success/10 text-pi-success'
              : 'border-pi-warning/30 bg-pi-warning/10 text-pi-warning'
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            {testResult.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
            <span className="font-medium">{testResult.message}</span>
            <span className="text-[10px] opacity-75">{testResult.durationMs}ms</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] opacity-80">
            <span>{t('settings.credentials.modelsAvailable', { available: testResult.availableModels, total: testResult.models })}</span>
            {testResult.source && <span>{testResult.source}</span>}
            {testResult.modelId && <span className="font-mono">{testResult.modelId}</span>}
            {testResult.endpoint && <span className="font-mono">{testResult.endpoint}</span>}
          </div>
        </section>
      )}
    </div>
  );
}

function CredentialInfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-pi-border bg-pi-bg-tertiary px-3 py-2">
      <div className="text-[10px] text-pi-dim">{label}</div>
      <div className={cn('mt-0.5 truncate text-xs text-pi-text', mono && 'font-mono')}>
        {value}
      </div>
    </div>
  );
}

function AppearanceSettings({ themes }: { themes: PiTheme[] }) {
  const settings = useSettingsStore();
  const addToast = useUIStore((s) => s.addToast);
  const hiddenThemeNames = useExtensionStore((s) => s.hiddenThemeNames);
  const resetThemeState = useExtensionStore((s) => s.resetThemeState);
  const { t } = useI18n();
  const [imageUrlDraft, setImageUrlDraft] = useState(
    settings.chatBackgroundImage.startsWith('http') ? settings.chatBackgroundImage : ''
  );
  const runtimeThemes = listRuntimeThemes(themes).filter((theme) => !hiddenThemeNames.includes(theme.name));
  const themeGroups = groupRuntimeThemesBySeries(runtimeThemes);

  useEffect(() => {
    if (settings.chatBackgroundImage.startsWith('http')) {
      setImageUrlDraft(settings.chatBackgroundImage);
    }
  }, [settings.chatBackgroundImage]);

  const handleBackgroundFile = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      addToast({ type: 'warning', message: t('settings.appearance.chooseImage') });
      return;
    }

    if (file.size > 4 * 1024 * 1024) {
      addToast({ type: 'warning', message: t('settings.appearance.backgroundTooLarge') });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      try {
        settings.updateSetting('chatBackgroundImage', String(reader.result ?? ''));
        addToast({ type: 'success', message: t('settings.appearance.backgroundUpdated') });
      } catch (err) {
        addToast({
          type: 'error',
          message: err instanceof Error ? err.message : t('settings.appearance.backgroundSaveFailed'),
        });
      }
    };
    reader.onerror = () => {
      addToast({ type: 'error', message: t('settings.appearance.backgroundReadFailed') });
    };
    reader.readAsDataURL(file);
  };

  const applyBackgroundUrl = () => {
    const value = imageUrlDraft.trim();
    settings.updateSetting('chatBackgroundImage', value);
    addToast({
      type: value ? 'success' : 'info',
      message: value ? t('settings.appearance.backgroundUpdated') : t('settings.appearance.backgroundCleared'),
    });
  };

  const resetThemes = () => {
    if (!confirm(t('settings.appearance.resetThemesConfirm'))) return;
    resetThemeState();
    settings.updateSetting('theme', 'dark');
    piApi.send({ type: 'theme_set', name: 'dark' });
    addToast({ type: 'success', message: t('settings.appearance.themesReset') });
  };

  const resetAllSettings = () => {
    if (!confirm(t('settings.appearance.resetSettingsConfirm'))) return;
    settings.resetSettings();
    setImageUrlDraft('');
    piApi.send({ type: 'theme_set', name: 'dark' });
    addToast({ type: 'success', message: t('settings.appearance.settingsReset') });
  };

  return (
    <div className="max-w-4xl space-y-6">
      <h2 className="text-sm font-semibold text-pi-text mb-4">{t('settings.appearance.title')}</h2>

      <div>
        <label className="text-[10px] font-semibold text-pi-dim uppercase">{t('settings.appearance.theme')}</label>
        <div className="mt-2 space-y-4">
          {(['dark', 'light'] as const).map((series) => {
            const seriesThemes = themeGroups[series];
            if (seriesThemes.length === 0) return null;

            return (
              <section key={series}>
                <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-pi-dim">
                  {t(`settings.appearance.themeSeries.${series}`)}
                </div>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-4">
                  {seriesThemes.map((theme) => (
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
                      <div className="mb-2 flex gap-1">
                        {['bg', 'bgSecondary', 'accent', 'text'].map((token) => (
                          <span
                            key={token}
                            className="h-3 flex-1 rounded-sm border border-pi-border"
                            style={{ backgroundColor: theme.colors[token] ?? theme.colors.bg }}
                          />
                        ))}
                      </div>
                      <div className="text-xs font-medium text-pi-text">{themeDisplayName(theme.name)}</div>
                      <div className="mt-0.5 text-[10px] text-pi-dim">{theme.name}</div>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      <section className="rounded-2xl border border-pi-border bg-pi-bg-secondary/70 p-4 shadow-sm shadow-black/5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs font-semibold text-pi-text">
              <RefreshCw size={14} />
              {t('settings.appearance.resetTitle')}
            </div>
            <p className="mt-1 text-xs leading-5 text-pi-dim">
              {t('settings.appearance.resetHint')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={resetThemes}
              className="h-8 rounded-full border border-pi-border bg-pi-bg-tertiary px-3 text-xs text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
            >
              {t('settings.appearance.resetThemes')}
            </button>
            <button
              onClick={resetAllSettings}
              className="h-8 rounded-full bg-pi-error/10 px-3 text-xs font-medium text-pi-error transition-colors hover:bg-pi-error/15"
            >
              {t('settings.appearance.resetSettings')}
            </button>
          </div>
        </div>
      </section>

      <section className="space-y-3 border-t border-pi-border pt-5">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase text-pi-dim">
            <ImagePlus size={13} />
            {t('settings.appearance.chatBackground')}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md bg-pi-accent px-3 text-xs font-medium text-white hover:bg-pi-accent/90 transition-colors">
                <ImagePlus size={13} />
                {t('settings.appearance.uploadImage')}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(event) => {
                    handleBackgroundFile(event.target.files?.[0]);
                    event.currentTarget.value = '';
                  }}
                />
              </label>
              <button
                onClick={() => {
                  settings.updateSetting('chatBackgroundImage', '');
                  setImageUrlDraft('');
                  addToast({ type: 'info', message: t('settings.appearance.backgroundCleared') });
                }}
                disabled={!settings.chatBackgroundImage}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-pi-border px-3 text-xs text-pi-muted hover:bg-pi-bg-hover hover:text-pi-text disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
              >
                <Eraser size={13} />
                {t('settings.appearance.clear')}
              </button>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative min-w-0 flex-1">
                <Link size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-pi-dim" />
                <input
                  value={imageUrlDraft}
                  onChange={(event) => setImageUrlDraft(event.target.value)}
                  placeholder={t('settings.appearance.backgroundUrlPlaceholder')}
                  className="h-8 w-full rounded-md border border-pi-border bg-pi-bg-tertiary pl-8 pr-3 text-xs text-pi-text placeholder:text-pi-dim focus:border-pi-accent focus:outline-none"
                />
              </div>
              <button
                onClick={applyBackgroundUrl}
                className="h-8 rounded-md border border-pi-border px-3 text-xs text-pi-muted hover:bg-pi-bg-hover hover:text-pi-text transition-colors"
              >
                {t('settings.appearance.applyUrl')}
              </button>
            </div>

            <div className="flex items-center gap-3">
              <span className="w-24 text-xs text-pi-muted">{t('settings.appearance.backgroundDim')}</span>
              <input
                type="range"
                min="0"
                max="90"
                value={settings.chatBackgroundDim}
                onChange={(event) => settings.updateSetting('chatBackgroundDim', Number(event.target.value))}
                className="w-40"
              />
              <span className="w-10 text-xs text-pi-dim">{settings.chatBackgroundDim}%</span>
            </div>
          </div>

          <div className="h-32 overflow-hidden rounded-lg border border-pi-border bg-pi-bg-secondary">
            {settings.chatBackgroundImage ? (
              <div
                className="h-full bg-cover bg-center"
                style={{ backgroundImage: `url(${JSON.stringify(settings.chatBackgroundImage)})` }}
              >
                <div
                  className="h-full bg-pi-bg"
                  style={{ opacity: settings.chatBackgroundDim / 100 }}
                />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-pi-dim">
                {t('settings.appearance.noImage')}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
