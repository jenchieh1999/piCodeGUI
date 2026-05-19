import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  CheckCircle2,
  Clipboard,
  Loader2,
  MessageCircle,
  Plus,
  RefreshCw,
  Save,
  Send,
  Trash2,
} from 'lucide-react';
import { piApi } from '../../api/client';
import type { ChannelConfig, ChannelInput, ChannelProvider } from '../../types';
import { useChatStore } from '../../stores/chatStore';
import { useUIStore } from '../../stores/uiStore';
import { useI18n } from '../../lib/i18n';
import { cn } from '../shared/utils';

type Draft = Required<Pick<ChannelConfig, 'provider' | 'name' | 'enabled' | 'autoCreateSession'>>
  & Pick<
    ChannelConfig,
    | 'webhookUrl'
    | 'verificationToken'
    | 'signingSecret'
    | 'encryptionKey'
    | 'appId'
    | 'appSecret'
    | 'defaultRecipientId'
    | 'defaultProjectPath'
    | 'defaultSessionId'
  >;

const PROVIDERS: Array<{ id: ChannelProvider; label: string }> = [
  { id: 'feishu', label: 'Feishu' },
  { id: 'wechat', label: 'WeChat' },
];

const EMPTY_DRAFT: Draft = {
  provider: 'feishu',
  name: 'Feishu Channel',
  enabled: true,
  autoCreateSession: true,
  webhookUrl: '',
  verificationToken: '',
  signingSecret: '',
  encryptionKey: '',
  appId: '',
  appSecret: '',
  defaultRecipientId: '',
  defaultProjectPath: '',
  defaultSessionId: '',
};

export function ChannelsSettings() {
  const { t } = useI18n();
  const addToast = useUIStore((s) => s.addToast);
  const sessions = useChatStore((s) => s.sessions);
  const [channels, setChannels] = useState<ChannelConfig[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const selected = channels.find((channel) => channel.id === selectedId) ?? null;
  const callbackUrl = useMemo(() => {
    if (!selected) return '';
    return `${piApi.getServerBaseUrl()}/api/channels/${selected.provider}/${selected.id}/events`;
  }, [selected]);
  const genericInboundUrl = useMemo(() => {
    if (!selected) return '';
    return `${piApi.getServerBaseUrl()}/api/channels/${selected.id}/inbound`;
  }, [selected]);

  const loadChannels = useCallback(async () => {
    setLoading(true);
    try {
      const result = await piApi.getChannels();
      setChannels(result.channels);
      setSelectedId((current) => current ?? result.channels[0]?.id ?? null);
    } catch (err) {
      addToast({ type: 'error', message: errorMessage(t('channels.loadFailed'), err) });
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    void loadChannels();
  }, [loadChannels]);

  useEffect(() => {
    setDraft(selected ? channelToDraft(selected) : EMPTY_DRAFT);
  }, [selected]);

  const createChannel = async (provider: ChannelProvider) => {
    setSaving(true);
    try {
      const result = await piApi.createChannel({
        provider,
        name: provider === 'feishu' ? 'Feishu Channel' : 'WeChat Channel',
        enabled: true,
        autoCreateSession: true,
      });
      setChannels((current) => [result.channel, ...current]);
      setSelectedId(result.channel.id);
      addToast({ type: 'success', message: t('channels.created', { provider: providerLabel(provider) }) });
    } catch (err) {
      addToast({ type: 'error', message: errorMessage(t('channels.createFailed'), err) });
    } finally {
      setSaving(false);
    }
  };

  const saveChannel = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const result = await piApi.updateChannel(selected.id, draftToInput(draft));
      setChannels((current) => current.map((channel) => channel.id === result.channel.id ? result.channel : channel));
      addToast({ type: 'success', message: t('channels.saved') });
    } catch (err) {
      addToast({ type: 'error', message: errorMessage(t('channels.saveFailed'), err) });
    } finally {
      setSaving(false);
    }
  };

  const deleteChannel = async () => {
    if (!selected || !confirm(t('channels.deleteConfirm', { name: selected.name }))) return;
    setDeleting(true);
    try {
      await piApi.deleteChannel(selected.id);
      const next = channels.filter((channel) => channel.id !== selected.id);
      setChannels(next);
      setSelectedId(next[0]?.id ?? null);
      addToast({ type: 'success', message: t('channels.deleted') });
    } catch (err) {
      addToast({ type: 'error', message: errorMessage(t('channels.deleteFailed'), err) });
    } finally {
      setDeleting(false);
    }
  };

  const testChannel = async () => {
    if (!selected) return;
    setTesting(true);
    try {
      const result = await piApi.testChannel(selected.id);
      if (result.channel) {
        setChannels((current) => current.map((channel) => channel.id === result.channel!.id ? result.channel! : channel));
      }
      addToast({ type: result.ok ? 'success' : 'warning', message: result.message, duration: 6000 });
    } catch (err) {
      addToast({ type: 'error', message: errorMessage(t('channels.testFailed'), err) });
    } finally {
      setTesting(false);
    }
  };

  const copy = async (value: string, label: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      addToast({ type: 'success', message: t('channels.copySuccess', { label }) });
    } catch {
      addToast({ type: 'warning', message: t('channels.copyFailed', { label, value }), duration: 8000 });
    }
  };

  return (
    <div className="max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-pi-text">{t('channels.title')}</h2>
          <div className="mt-1 text-[10px] text-pi-dim">
            {t('channels.summary', { total: channels.length, enabled: channels.filter((channel) => channel.enabled).length })}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void loadChannels()}
            disabled={loading}
            className="w-8 h-8 rounded-md border border-pi-border text-pi-muted hover:text-pi-text hover:bg-pi-bg-hover disabled:opacity-50 flex items-center justify-center transition-colors"
            title={t('channels.refresh')}
          >
            <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
          </button>
          <button
            onClick={() => void createChannel('feishu')}
            disabled={saving}
            className="h-8 px-3 rounded-md bg-pi-accent text-white text-xs font-medium flex items-center gap-1.5 hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            <Plus size={13} />
            Feishu
          </button>
          <button
            onClick={() => void createChannel('wechat')}
            disabled={saving}
            className="h-8 px-3 rounded-md border border-pi-border text-xs text-pi-muted hover:text-pi-text hover:bg-pi-bg-hover disabled:opacity-50 transition-colors flex items-center gap-1.5"
          >
            <Plus size={13} />
            WeChat
          </button>
        </div>
      </div>

      <div className="grid min-h-[520px] gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="space-y-2">
          {channels.map((channel) => (
            <button
              key={channel.id}
              onClick={() => setSelectedId(channel.id)}
              className={cn(
                'w-full rounded-lg border p-3 text-left transition-colors',
                selected?.id === channel.id
                  ? 'border-pi-accent bg-pi-accent/5'
                  : 'border-pi-border bg-pi-bg-secondary hover:border-pi-muted'
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-pi-text">{channel.name}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-pi-dim">
                    <span className="rounded bg-pi-bg-tertiary px-1.5 py-0.5 font-mono">{providerLabel(channel.provider)}</span>
                    {channel.lastEventAt && <span>{formatTime(channel.lastEventAt)}</span>}
                  </div>
                </div>
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase',
                    channel.enabled ? 'bg-pi-success/10 text-pi-success' : 'bg-pi-bg-tertiary text-pi-dim'
                  )}
                >
                  {channel.enabled ? t('common.on') : t('common.off')}
                </span>
              </div>
              {channel.lastError && (
                <div className="mt-2 truncate rounded bg-pi-error/10 px-2 py-1 text-[10px] text-pi-error">
                  {channel.lastError}
                </div>
              )}
            </button>
          ))}

          {!loading && channels.length === 0 && (
            <div className="rounded-lg border border-pi-border bg-pi-bg-secondary px-4 py-8 text-center text-xs text-pi-dim">
              {t('channels.empty')}
            </div>
          )}

          {loading && channels.length === 0 && (
            <div className="rounded-lg border border-pi-border bg-pi-bg-secondary px-4 py-8 flex items-center justify-center gap-2 text-xs text-pi-dim">
              <Loader2 size={14} className="animate-spin" />
              {t('channels.loading')}
            </div>
          )}
        </div>

        {selected ? (
          <div className="rounded-lg border border-pi-border bg-pi-bg-secondary p-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-pi-border pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-md bg-pi-accent/10 text-pi-accent flex items-center justify-center">
                  <MessageCircle size={15} />
                </div>
                <div>
                  <div className="text-sm font-semibold text-pi-text">{draft.name || selected.name}</div>
                  <div className="text-[10px] text-pi-dim">{providerLabel(selected.provider)}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={testChannel}
                  disabled={testing || saving}
                  className="h-8 px-3 rounded-md border border-pi-border text-xs text-pi-muted hover:text-pi-text hover:bg-pi-bg-hover disabled:opacity-50 transition-colors flex items-center gap-1.5"
                >
                  {testing ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                  {t('common.test')}
                </button>
                <button
                  onClick={saveChannel}
                  disabled={saving}
                  className="h-8 px-3 rounded-md bg-pi-accent text-white text-xs font-medium flex items-center gap-1.5 hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                  {t('common.save')}
                </button>
                <button
                  onClick={deleteChannel}
                  disabled={deleting}
                  className="w-8 h-8 rounded-md border border-pi-border text-pi-muted hover:text-pi-error hover:border-pi-error/40 disabled:opacity-50 flex items-center justify-center transition-colors"
                  title={t('channels.delete')}
                >
                  {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                </button>
              </div>
            </div>

            <div className="grid gap-4 pt-4 xl:grid-cols-2">
              <Field label={t('common.name')}>
                <input
                  value={draft.name}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                  className={inputClass}
                />
              </Field>

              <Field label={t('common.provider')}>
                <select
                  value={draft.provider}
                  onChange={(event) => setDraft((current) => ({ ...current, provider: event.target.value as ChannelProvider }))}
                  className={inputClass}
                >
                  {PROVIDERS.map((provider) => (
                    <option key={provider.id} value={provider.id}>{provider.label}</option>
                  ))}
                </select>
              </Field>

              <Field label={t('channels.webhookUrl')}>
                <input
                  value={draft.webhookUrl ?? ''}
                  onChange={(event) => setDraft((current) => ({ ...current, webhookUrl: event.target.value }))}
                  placeholder="https://..."
                  className={inputClass}
                />
              </Field>

              <Field label={t('channels.verificationToken')}>
                <input
                  value={draft.verificationToken ?? ''}
                  onChange={(event) => setDraft((current) => ({ ...current, verificationToken: event.target.value }))}
                  className={inputClass}
                />
              </Field>

              {draft.provider === 'feishu' && (
                <>
                  <Field label={t('channels.signingSecret')}>
                    <input
                      value={draft.signingSecret ?? ''}
                      onChange={(event) => setDraft((current) => ({ ...current, signingSecret: event.target.value }))}
                      type="password"
                      className={inputClass}
                    />
                  </Field>

                  <Field label={t('channels.encryptKey')}>
                    <input
                      value={draft.encryptionKey ?? ''}
                      onChange={(event) => setDraft((current) => ({ ...current, encryptionKey: event.target.value }))}
                      type="password"
                      className={inputClass}
                    />
                  </Field>
                </>
              )}

              {draft.provider === 'wechat' && (
                <>
                  <Field label={t('channels.officialAppId')}>
                    <input
                      value={draft.appId ?? ''}
                      onChange={(event) => setDraft((current) => ({ ...current, appId: event.target.value }))}
                      className={inputClass}
                    />
                  </Field>

                  <Field label={t('channels.officialAppSecret')}>
                    <input
                      value={draft.appSecret ?? ''}
                      onChange={(event) => setDraft((current) => ({ ...current, appSecret: event.target.value }))}
                      type="password"
                      className={inputClass}
                    />
                  </Field>

                  <Field label={t('channels.defaultRecipient')}>
                    <input
                      value={draft.defaultRecipientId ?? ''}
                      onChange={(event) => setDraft((current) => ({ ...current, defaultRecipientId: event.target.value }))}
                      className={inputClass}
                    />
                  </Field>
                </>
              )}

              <Field label={t('channels.projectPath')}>
                <input
                  value={draft.defaultProjectPath ?? ''}
                  onChange={(event) => setDraft((current) => ({ ...current, defaultProjectPath: event.target.value }))}
                  placeholder="D:\\project"
                  className={inputClass}
                />
              </Field>

              <Field label={t('channels.defaultSession')}>
                <select
                  value={draft.defaultSessionId ?? ''}
                  onChange={(event) => setDraft((current) => ({ ...current, defaultSessionId: event.target.value }))}
                  className={inputClass}
                >
                  <option value="">{t('channels.latestSession')}</option>
                  {sessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {session.title} · {session.projectName}
                    </option>
                  ))}
                </select>
              </Field>

              <div className="space-y-3 xl:col-span-2">
                <ToggleRow
                  label={t('common.enabled')}
                  checked={draft.enabled}
                  onChange={(checked) => setDraft((current) => ({ ...current, enabled: checked }))}
                />
                <ToggleRow
                  label={t('channels.autoCreateSession')}
                  checked={draft.autoCreateSession}
                  onChange={(checked) => setDraft((current) => ({ ...current, autoCreateSession: checked }))}
                />
              </div>

              <Field label={t('channels.callbackUrl')} wide>
                <CopyField value={callbackUrl} onCopy={() => void copy(callbackUrl, t('channels.callbackUrl'))} />
              </Field>

              <Field label={t('channels.bridgeInboundUrl')} wide>
                <CopyField value={genericInboundUrl} onCopy={() => void copy(genericInboundUrl, t('channels.bridgeInboundUrl'))} />
              </Field>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2 text-[10px] text-pi-dim">
              <CheckCircle2 size={12} className="text-pi-success" />
              <span>{t('channels.permissionHint')}</span>
              {selected.lastTestAt && <span>{t('channels.lastTest', { time: formatTime(selected.lastTestAt) })}</span>}
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-pi-border bg-pi-bg-secondary p-8 text-center text-xs text-pi-dim">
            {t('channels.selectOrCreate')}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <label className={cn('block space-y-1.5', wide && 'xl:col-span-2')}>
      <span className="text-[10px] font-semibold uppercase text-pi-dim">{label}</span>
      {children}
    </label>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-md border border-pi-border bg-pi-bg-tertiary px-3 py-2">
      <span className="text-xs text-pi-text">{label}</span>
      <button
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-5 w-9 rounded-full transition-colors',
          checked ? 'bg-pi-accent' : 'bg-pi-border'
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform',
            checked ? 'translate-x-4' : 'translate-x-0.5'
          )}
        />
      </button>
    </div>
  );
}

function CopyField({ value, onCopy }: { value: string; onCopy: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex gap-2">
      <input
        value={value}
        readOnly
        className="h-8 min-w-0 flex-1 rounded-md bg-pi-bg-tertiary border border-pi-border px-3 text-xs text-pi-text"
      />
      <button
        onClick={onCopy}
        className="w-8 h-8 rounded-md border border-pi-border text-pi-muted hover:text-pi-text hover:bg-pi-bg-hover flex items-center justify-center transition-colors"
        title={t('common.copy')}
      >
        <Clipboard size={13} />
      </button>
    </div>
  );
}

function channelToDraft(channel: ChannelConfig): Draft {
  return {
    provider: channel.provider,
    name: channel.name,
    enabled: channel.enabled,
    autoCreateSession: channel.autoCreateSession,
    webhookUrl: channel.webhookUrl ?? '',
    verificationToken: channel.verificationToken ?? '',
    signingSecret: channel.signingSecret ?? '',
    encryptionKey: channel.encryptionKey ?? '',
    appId: channel.appId ?? '',
    appSecret: channel.appSecret ?? '',
    defaultRecipientId: channel.defaultRecipientId ?? '',
    defaultProjectPath: channel.defaultProjectPath ?? '',
    defaultSessionId: channel.defaultSessionId ?? '',
  };
}

function draftToInput(draft: Draft): ChannelInput {
  return {
    provider: draft.provider,
    name: draft.name.trim(),
    enabled: draft.enabled,
    autoCreateSession: draft.autoCreateSession,
    webhookUrl: draft.webhookUrl?.trim(),
    verificationToken: draft.verificationToken?.trim(),
    signingSecret: draft.signingSecret?.trim(),
    encryptionKey: draft.encryptionKey?.trim(),
    appId: draft.appId?.trim(),
    appSecret: draft.appSecret?.trim(),
    defaultRecipientId: draft.defaultRecipientId?.trim(),
    defaultProjectPath: draft.defaultProjectPath?.trim(),
    defaultSessionId: draft.defaultSessionId?.trim(),
  };
}

function providerLabel(provider: ChannelProvider): string {
  return provider === 'feishu' ? 'Feishu' : 'WeChat';
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

function errorMessage(prefix: string, err: unknown): string {
  return `${prefix}: ${err instanceof Error ? err.message : String(err)}`;
}

const inputClass = 'h-8 w-full rounded-md bg-pi-bg-tertiary border border-pi-border px-3 text-xs text-pi-text placeholder:text-pi-dim focus:border-pi-accent focus:outline-none';
