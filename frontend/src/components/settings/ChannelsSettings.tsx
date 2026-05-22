import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { toDataURL } from 'qrcode';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Clipboard,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  MessageCircle,
  Plus,
  QrCode,
  RefreshCw,
  Save,
  Send,
  Smartphone,
  Trash2,
  X,
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
  const [pairing, setPairing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showAppSecret, setShowAppSecret] = useState(false);
  const [wechatQrOpen, setWechatQrOpen] = useState(false);
  const [wechatQrStarting, setWechatQrStarting] = useState(false);
  const [wechatQrPolling, setWechatQrPolling] = useState(false);
  const [wechatQrSessionKey, setWechatQrSessionKey] = useState('');
  const [wechatQrImageUrl, setWechatQrImageUrl] = useState('');
  const [wechatQrRawUrl, setWechatQrRawUrl] = useState('');
  const [wechatQrStatus, setWechatQrStatus] = useState('');
  const [wechatQrConnected, setWechatQrConnected] = useState(false);
  const [wechatQrNeedsVerify, setWechatQrNeedsVerify] = useState(false);
  const [wechatVerifyCode, setWechatVerifyCode] = useState('');

  const selected = channels.find((channel) => channel.id === selectedId) ?? null;
  const callbackUrl = useMemo(() => {
    if (!selected) return '';
    return `${piApi.getServerBaseUrl()}/api/channels/${selected.provider}/${selected.id}/events`;
  }, [selected]);

  useEffect(() => {
    if (!wechatQrOpen || !selected || selected.provider !== 'wechat' || !wechatQrSessionKey || wechatQrConnected || wechatQrNeedsVerify) {
      return undefined;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      setWechatQrPolling(true);
      try {
        const result = await piApi.getWechatQrLoginStatus(selected.id, wechatQrSessionKey);
        if (cancelled) return;
        if (result.channel) {
          setChannels((current) => current.map((channel) => channel.id === result.channel!.id ? result.channel! : channel));
        }
        setWechatQrStatus(result.message);
        setWechatQrConnected(Boolean(result.connected));
        setWechatQrNeedsVerify(Boolean(result.needsVerifyCode));
        if (!result.connected && result.status !== 'expired' && result.status !== 'verify_code_blocked' && !result.needsVerifyCode) {
          timer = setTimeout(poll, 2500);
        }
      } catch (err) {
        if (!cancelled) setWechatQrStatus(errorMessage(t('channels.wechatQrPollFailed'), err));
      } finally {
        if (!cancelled) setWechatQrPolling(false);
      }
    };

    timer = setTimeout(poll, 1000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [selected, t, wechatQrConnected, wechatQrNeedsVerify, wechatQrOpen, wechatQrSessionKey]);
  const genericInboundUrl = useMemo(() => {
    if (!selected) return '';
    return `${piApi.getServerBaseUrl()}/api/channels/${selected.id}/inbound`;
  }, [selected]);
  const activePairingCode = selected?.pairingCode && (!selected.pairingExpiresAt || selected.pairingExpiresAt > Date.now())
    ? selected.pairingCode
    : '';
  const feishuDiagnostics = useMemo(() => {
    if (!selected || draft.provider !== 'feishu') return [];
    const items: string[] = [];
    if (isLocalCallbackUrl(callbackUrl)) {
      items.push(t('channels.localCallbackWarning'));
    }
    if (!(draft.defaultRecipientId?.trim() || selected.lastRecipientId)) {
      items.push(t('channels.missingRecipientWarning'));
    }
    if (!draft.appId?.trim() || !draft.appSecret?.trim()) {
      items.push(t('channels.missingFeishuCredentialWarning'));
    }
    return items;
  }, [callbackUrl, draft.appId, draft.appSecret, draft.defaultRecipientId, draft.provider, selected, t]);

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

  const saveChannel = async (connectAfterSave = false) => {
    if (!selected) return;
    setSaving(true);
    try {
      const result = await piApi.updateChannel(selected.id, draftToInput(draft));
      setChannels((current) => current.map((channel) => channel.id === result.channel.id ? result.channel : channel));
      if (connectAfterSave && result.channel.provider === 'feishu') {
        setTesting(true);
        try {
          const testResult = await piApi.testChannel(result.channel.id);
          if (testResult.channel) {
            setChannels((current) => current.map((channel) => channel.id === testResult.channel!.id ? testResult.channel! : channel));
          }
          addToast({ type: testResult.ok ? 'success' : 'warning', message: testResult.message, duration: 6000 });
        } finally {
          setTesting(false);
        }
      } else {
        addToast({ type: 'success', message: t('channels.saved') });
      }
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

  const createPairing = async () => {
    if (!selected) return;
    setPairing(true);
    try {
      const saved = await piApi.updateChannel(selected.id, draftToInput(draft));
      setChannels((current) => current.map((channel) => channel.id === saved.channel.id ? saved.channel : channel));
      const result = await piApi.createChannelPairing(saved.channel.id);
      if (result.channel) {
        setChannels((current) => current.map((channel) => channel.id === result.channel!.id ? result.channel! : channel));
      }
      addToast({
        type: result.ok ? 'success' : 'warning',
        message: result.ok && result.pairingCode
          ? t('channels.pairingGeneratedToast', { code: result.pairingCode })
          : result.message,
        duration: 8000,
      });
    } catch (err) {
      addToast({ type: 'error', message: errorMessage(t('channels.pairingFailed'), err) });
    } finally {
      setPairing(false);
    }
  };

  const startWechatQrLogin = async () => {
    if (!selected) return;
    setWechatQrOpen(true);
    setWechatQrStarting(true);
    setWechatQrConnected(false);
    setWechatQrNeedsVerify(false);
    setWechatVerifyCode('');
    setWechatQrStatus(t('channels.wechatQrStarting'));
    try {
      const saved = await piApi.updateChannel(selected.id, draftToInput(draft));
      setChannels((current) => current.map((channel) => channel.id === saved.channel.id ? saved.channel : channel));
      const result = await piApi.startWechatQrLogin(saved.channel.id);
      if (result.channel) {
        setChannels((current) => current.map((channel) => channel.id === result.channel!.id ? result.channel! : channel));
      }
      if (!result.ok || !result.sessionKey || !result.qrcodeUrl) {
        setWechatQrStatus(result.message);
        return;
      }
      const imageUrl = await toDataURL(result.qrcodeUrl, {
        width: 240,
        margin: 2,
        color: { dark: '#111111', light: '#ffffff' },
      });
      setWechatQrSessionKey(result.sessionKey);
      setWechatQrRawUrl(result.qrcodeUrl);
      setWechatQrImageUrl(imageUrl);
      setWechatQrStatus(result.message);
    } catch (err) {
      setWechatQrStatus(errorMessage(t('channels.wechatQrStartFailed'), err));
    } finally {
      setWechatQrStarting(false);
    }
  };

  const submitWechatVerifyCode = async () => {
    if (!selected || !wechatQrSessionKey) return;
    setWechatQrPolling(true);
    try {
      const result = await piApi.getWechatQrLoginStatus(selected.id, wechatQrSessionKey, wechatVerifyCode.trim());
      if (result.channel) {
        setChannels((current) => current.map((channel) => channel.id === result.channel!.id ? result.channel! : channel));
      }
      setWechatQrStatus(result.message);
      setWechatQrConnected(Boolean(result.connected));
      setWechatQrNeedsVerify(Boolean(result.needsVerifyCode));
      if (!result.needsVerifyCode) setWechatVerifyCode('');
    } catch (err) {
      setWechatQrStatus(errorMessage(t('channels.wechatQrPollFailed'), err));
    } finally {
      setWechatQrPolling(false);
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
    <div className="max-w-6xl space-y-4">
      <div className="rounded-2xl border border-pi-border/70 bg-pi-bg-secondary/65 px-4 py-3 shadow-sm shadow-black/10 backdrop-blur-xl">
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
            className="flex h-8 w-8 items-center justify-center rounded-full border border-pi-border/70 bg-pi-bg/45 text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text disabled:opacity-50"
            title={t('channels.refresh')}
          >
            <RefreshCw size={14} className={cn(loading && 'animate-spin')} />
          </button>
          <button
            onClick={() => void createChannel('feishu')}
            disabled={saving}
            className="flex h-8 items-center gap-1.5 rounded-full bg-pi-accent px-3 text-xs font-medium text-white shadow-sm shadow-pi-accent/20 transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Plus size={13} />
            Feishu
          </button>
          <button
            onClick={() => void createChannel('wechat')}
            disabled={saving}
            className="flex h-8 items-center gap-1.5 rounded-full border border-pi-border/70 bg-pi-bg/45 px-3 text-xs text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text disabled:opacity-50"
          >
            <Plus size={13} />
            WeChat
          </button>
        </div>
      </div>
      </div>

      <div className="grid min-h-[520px] gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="rounded-2xl border border-pi-border/70 bg-pi-bg-secondary/45 p-2 shadow-sm shadow-black/10 backdrop-blur-xl">
        <div className="space-y-2">
          {channels.map((channel) => (
            <button
              key={channel.id}
              onClick={() => setSelectedId(channel.id)}
              className={cn(
                'w-full rounded-xl border p-3 text-left transition-all',
                selected?.id === channel.id
                  ? 'border-pi-accent/80 bg-pi-accent/10 shadow-sm shadow-pi-accent/10'
                  : 'border-transparent bg-pi-bg/35 hover:border-pi-border hover:bg-pi-bg-hover/70'
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
                    'rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase',
                    channel.enabled ? 'bg-pi-success/15 text-pi-success' : 'bg-pi-bg-tertiary text-pi-dim'
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
            <div className="rounded-xl border border-pi-border/70 bg-pi-bg/35 px-4 py-8 text-center text-xs text-pi-dim">
              {t('channels.empty')}
            </div>
          )}

          {loading && channels.length === 0 && (
            <div className="flex items-center justify-center gap-2 rounded-xl border border-pi-border/70 bg-pi-bg/35 px-4 py-8 text-xs text-pi-dim">
              <Loader2 size={14} className="animate-spin" />
              {t('channels.loading')}
            </div>
          )}
        </div>
        </div>

        {selected ? (
          <div className="overflow-hidden rounded-2xl border border-pi-border/70 bg-pi-bg-secondary/65 shadow-sm shadow-black/10 backdrop-blur-xl">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-pi-border/70 bg-pi-bg/20 px-4 py-3">
              <div className="flex items-center gap-2">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-pi-accent/10 text-pi-accent">
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
                  disabled={testing || saving || pairing}
                  className="flex h-8 items-center gap-1.5 rounded-full border border-pi-border/70 bg-pi-bg/45 px-3 text-xs text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text disabled:opacity-50"
                >
                  {testing ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                  {t('common.test')}
                </button>
                <button
                  onClick={() => void saveChannel(draft.provider === 'feishu')}
                  disabled={saving || testing || pairing}
                  className="flex h-8 items-center gap-1.5 rounded-full bg-pi-accent px-3 text-xs font-medium text-white shadow-sm shadow-pi-accent/20 transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {saving || testing ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                  {draft.provider === 'feishu' ? t('channels.saveAndConnect') : t('common.save')}
                </button>
                <button
                  onClick={deleteChannel}
                  disabled={deleting}
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-pi-border/70 bg-pi-bg/45 text-pi-muted transition-colors hover:border-pi-error/40 hover:text-pi-error disabled:opacity-50"
                  title={t('channels.delete')}
                >
                  {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                </button>
              </div>
            </div>

            <div className="grid gap-3 px-4 py-4 xl:grid-cols-2">
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

              {draft.provider === 'feishu' && (
                <>
                  <div className="xl:col-span-2">
                    <div className="rounded-2xl border border-pi-border/70 bg-pi-bg/45 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-xs font-semibold text-pi-text">{t('channels.feishuGuideTitle')}</div>
                          <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-pi-muted">
                            {t('channels.feishuGuideSummary')}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => window.open('https://open.feishu.cn/', '_blank', 'noopener,noreferrer')}
                          className="flex h-8 items-center gap-1.5 rounded-full border border-pi-border/70 bg-pi-bg/45 px-3 text-[11px] text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
                        >
                          <BookOpen size={13} />
                          {t('channels.viewDocs')}
                          <ExternalLink size={11} />
                        </button>
                      </div>
                      <ol className="mt-3 space-y-1.5 pl-4 text-[11px] leading-relaxed text-pi-muted">
                        <li>{t('channels.feishuStep1')}</li>
                        <li>{t('channels.feishuStep2')}</li>
                        <li>{t('channels.feishuStep3')}</li>
                        <li>{t('channels.feishuStep4')}</li>
                      </ol>
                      {feishuDiagnostics.length > 0 && (
                        <div className="mt-3 space-y-2 rounded-xl border border-pi-warning/30 bg-pi-warning/10 p-3 text-[11px] leading-relaxed text-pi-muted">
                          {feishuDiagnostics.map((item) => (
                            <div key={item} className="flex gap-2">
                              <AlertTriangle size={13} className="mt-0.5 flex-shrink-0 text-pi-warning" />
                              <span>{item}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <Field label={t('channels.accountId')} description={t('channels.accountIdHint')}>
                    <input value={feishuAccountId(selected)} readOnly className={inputClass} />
                  </Field>

                  <Field label={t('channels.feishuAppId')} required description={t('channels.envFeishuAppId')}>
                    <input
                      value={draft.appId ?? ''}
                      onChange={(event) => setDraft((current) => ({ ...current, appId: event.target.value }))}
                      placeholder="cli_xxxxxx"
                      className={inputClass}
                    />
                  </Field>

                  <Field label={t('channels.feishuAppSecret')} required description={t('channels.envFeishuAppSecret')}>
                    <div className="flex gap-2">
                      <input
                        value={draft.appSecret ?? ''}
                        onChange={(event) => setDraft((current) => ({ ...current, appSecret: event.target.value }))}
                        type={showAppSecret ? 'text' : 'password'}
                        placeholder={t('channels.appSecretPlaceholder')}
                        className={cn(inputClass, 'min-w-0 flex-1')}
                      />
                      <button
                        type="button"
                        onClick={() => setShowAppSecret((value) => !value)}
                        className="flex h-9 w-11 items-center justify-center rounded-xl border border-pi-border/70 bg-pi-bg/45 text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
                        title={showAppSecret ? t('channels.hideSecret') : t('channels.showSecret')}
                      >
                        {showAppSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </Field>

                  <Field label={t('channels.defaultRecipient')} description={t('channels.feishuRecipientHint')}>
                    <input
                      value={draft.defaultRecipientId ?? ''}
                      onChange={(event) => setDraft((current) => ({ ...current, defaultRecipientId: event.target.value }))}
                      placeholder="chat_id:oc_xxx / open_id:ou_xxx"
                      className={inputClass}
                    />
                  </Field>

                  <div className="xl:col-span-2 rounded-2xl border border-pi-border/70 bg-pi-bg/35 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-xs font-semibold text-pi-text">
                          <KeyRound size={14} className="text-pi-accent" />
                          {t('channels.pairingTitle')}
                        </div>
                        <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-pi-muted">
                          {t('channels.pairingHint')}
                        </p>
                        <div className="mt-2 text-[10px] text-pi-dim">
                          {t('channels.currentRecipient')}: {draft.defaultRecipientId?.trim() || selected.lastRecipientId || t('channels.notBound')}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void createPairing()}
                        disabled={pairing || saving || testing}
                        className="flex h-8 items-center gap-1.5 rounded-full border border-pi-border/70 bg-pi-bg/45 px-3 text-[11px] text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text disabled:opacity-50"
                      >
                        {pairing ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />}
                        {t('channels.generatePairing')}
                      </button>
                    </div>
                    {activePairingCode && (
                      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-pi-accent/30 bg-pi-accent/10 px-3 py-2">
                        <span className="text-[10px] font-semibold uppercase text-pi-dim">{t('channels.pairingCode')}</span>
                        <span className="font-mono text-base font-semibold tracking-[0.18em] text-pi-text">{activePairingCode}</span>
                        {selected.pairingExpiresAt && (
                          <span className="text-[10px] text-pi-dim">
                            {t('channels.pairingExpires', { time: formatTime(selected.pairingExpiresAt) })}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => void copy(activePairingCode, t('channels.pairingCode'))}
                          className="ml-auto flex h-7 items-center gap-1.5 rounded-full border border-pi-border/70 bg-pi-bg/45 px-2.5 text-[10px] text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
                        >
                          <Clipboard size={12} />
                          {t('common.copy')}
                        </button>
                      </div>
                    )}
                  </div>

                  <details className="xl:col-span-2 rounded-2xl border border-pi-border/70 bg-pi-bg/35">
                    <summary className="cursor-pointer px-4 py-3 text-xs font-medium text-pi-muted transition-colors hover:text-pi-text">
                      {t('channels.advancedFeishu')}
                    </summary>
                    <div className="grid gap-3 border-t border-pi-border/70 px-4 py-4 xl:grid-cols-2">
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
                    </div>
                  </details>
                </>
              )}

              {draft.provider === 'wechat' && (
                <>
                  <div className="xl:col-span-2 rounded-2xl border border-pi-border/70 bg-pi-bg/45 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-xs font-semibold text-pi-text">
                          <QrCode size={14} className="text-pi-accent" />
                          {t('channels.wechatQrTitle')}
                        </div>
                        <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-pi-muted">
                          {t('channels.wechatQrSummary')}
                        </p>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-pi-dim">
                          <span>{t('channels.wechatQrAccount')}: {selected.wechatBotId || t('channels.notBound')}</span>
                          {selected.wechatUserId && <span>{t('channels.wechatQrUser')}: {selected.wechatUserId}</span>}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void startWechatQrLogin()}
                        disabled={wechatQrStarting || saving || testing || pairing}
                        className="flex h-8 items-center gap-1.5 rounded-full bg-pi-accent px-3 text-[11px] font-medium text-white shadow-sm shadow-pi-accent/20 transition-opacity hover:opacity-90 disabled:opacity-50"
                      >
                        {wechatQrStarting ? <Loader2 size={13} className="animate-spin" /> : <QrCode size={13} />}
                        {t('channels.wechatQrGenerate')}
                      </button>
                    </div>
                    <ol className="mt-3 space-y-1.5 pl-4 text-[11px] leading-relaxed text-pi-muted">
                      <li>{t('channels.wechatQrStep1')}</li>
                      <li>{t('channels.wechatQrStep2')}</li>
                      <li>{t('channels.wechatQrStep3')}</li>
                      <li>{t('channels.wechatQrStep4')}</li>
                    </ol>
                  </div>

                  <details className="xl:col-span-2 rounded-2xl border border-pi-border/70 bg-pi-bg/35">
                    <summary className="cursor-pointer px-4 py-3 text-xs font-medium text-pi-muted transition-colors hover:text-pi-text">
                      {t('channels.advancedWechat')}
                    </summary>
                    <div className="grid gap-3 border-t border-pi-border/70 px-4 py-4 xl:grid-cols-2">
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
                    </div>
                  </details>
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

              <div className="grid gap-2 sm:grid-cols-2 xl:col-span-2">
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

            <div className="flex flex-wrap items-center gap-2 border-t border-pi-border/70 bg-pi-bg/20 px-4 py-3 text-[10px] text-pi-dim">
              <CheckCircle2 size={12} className="text-pi-success" />
              <span>{t('channels.permissionHint')}</span>
              {selected.lastTestAt && <span>{t('channels.lastTest', { time: formatTime(selected.lastTestAt) })}</span>}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-pi-border/70 bg-pi-bg-secondary/55 p-8 text-center text-xs text-pi-dim shadow-sm shadow-black/10 backdrop-blur-xl">
            {t('channels.selectOrCreate')}
          </div>
        )}
      </div>

      {wechatQrOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-pi-border/70 bg-pi-bg-secondary/95 shadow-2xl shadow-black/35">
            <div className="flex items-start justify-between gap-4 border-b border-pi-border/70 px-5 py-4">
              <div>
                <div className="text-base font-semibold text-pi-text">{t('channels.wechatQrDialogTitle')}</div>
                <p className="mt-1 text-xs leading-relaxed text-pi-muted">{t('channels.wechatQrDialogSummary')}</p>
              </div>
              <button
                type="button"
                onClick={() => setWechatQrOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-pi-border/70 bg-pi-bg/45 text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
                title={t('common.close')}
              >
                <X size={14} />
              </button>
            </div>

            <div className="grid gap-4 p-5 md:grid-cols-[260px_minmax(0,1fr)]">
              <div className="flex min-h-[260px] items-center justify-center rounded-2xl border border-pi-border/70 bg-white p-4">
                {wechatQrStarting ? (
                  <Loader2 size={30} className="animate-spin text-neutral-900" />
                ) : wechatQrImageUrl ? (
                  <img src={wechatQrImageUrl} alt={t('channels.wechatQrAlt')} className="h-56 w-56" />
                ) : (
                  <QrCode size={80} className="text-neutral-300" />
                )}
              </div>

              <div className="space-y-4">
                <div className="rounded-2xl border border-pi-border/70 bg-pi-bg/45 p-4">
                  <div className="flex items-center gap-2 text-xs font-semibold text-pi-text">
                    <Smartphone size={14} className="text-pi-accent" />
                    {t('channels.wechatQrHowTitle')}
                  </div>
                  <ol className="mt-3 space-y-2 pl-4 text-xs leading-relaxed text-pi-muted">
                    <li>{t('channels.wechatQrDialogStep1')}</li>
                    <li>{t('channels.wechatQrDialogStep2')}</li>
                    <li>{t('channels.wechatQrDialogStep3')}</li>
                  </ol>
                </div>

                <div className="rounded-2xl border border-pi-border/70 bg-pi-bg/35 p-3 text-xs leading-relaxed text-pi-muted">
                  <div className="flex items-center gap-2">
                    {wechatQrPolling && <Loader2 size={13} className="animate-spin" />}
                    <span className={cn(wechatQrConnected && 'text-pi-success')}>{wechatQrStatus || t('channels.wechatQrIdle')}</span>
                  </div>
                </div>

                {wechatQrNeedsVerify && (
                  <div className="flex gap-2">
                    <input
                      value={wechatVerifyCode}
                      onChange={(event) => setWechatVerifyCode(event.target.value)}
                      placeholder={t('channels.wechatVerifyCodePlaceholder')}
                      className={cn(inputClass, 'min-w-0 flex-1')}
                    />
                    <button
                      type="button"
                      onClick={() => void submitWechatVerifyCode()}
                      disabled={!wechatVerifyCode.trim() || wechatQrPolling}
                      className="flex h-9 items-center gap-1.5 rounded-full bg-pi-accent px-3 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {wechatQrPolling ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                      {t('channels.wechatSubmitVerifyCode')}
                    </button>
                  </div>
                )}

                {wechatQrRawUrl && (
                  <button
                    type="button"
                    onClick={() => void copy(wechatQrRawUrl, t('channels.wechatQrLink'))}
                    className="flex h-8 items-center gap-1.5 rounded-full border border-pi-border/70 bg-pi-bg/45 px-3 text-[11px] text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
                  >
                    <Clipboard size={12} />
                    {t('channels.wechatQrCopyLink')}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  wide,
  required,
  description,
  children,
}: {
  label: string;
  wide?: boolean;
  required?: boolean;
  description?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn('block space-y-1.5', wide && 'xl:col-span-2')}>
      <span className="px-1 text-[10px] font-semibold uppercase text-pi-dim">
        {label}
        {required && <span className="ml-1 text-pi-error">*</span>}
      </span>
      {children}
      {description && <span className="block px-1 text-[10px] leading-relaxed text-pi-dim">{description}</span>}
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
    <div className="flex min-h-[46px] items-center justify-between gap-3 rounded-xl border border-pi-border/70 bg-pi-bg/45 px-3 py-2 shadow-inner shadow-black/5">
      <span className="min-w-0 truncate text-xs font-medium text-pi-text">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-6 w-11 flex-shrink-0 rounded-full p-0.5 transition-colors',
          checked ? 'bg-pi-accent shadow-sm shadow-pi-accent/20' : 'bg-pi-border/80'
        )}
      >
        <span
          className={cn(
            'block h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0'
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
        className="h-9 min-w-0 flex-1 rounded-xl border border-pi-border/70 bg-pi-bg/50 px-3 text-xs text-pi-text outline-none"
      />
      <button
        type="button"
        onClick={onCopy}
        className="flex h-9 w-9 items-center justify-center rounded-xl border border-pi-border/70 bg-pi-bg/45 text-pi-muted transition-colors hover:bg-pi-bg-hover hover:text-pi-text"
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

function feishuAccountId(channel: ChannelConfig): string {
  const suffix = channel.id.split('-').slice(-2).join('-') || channel.id;
  return `feishu-${suffix}`;
}

function isLocalCallbackUrl(value: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  } catch {
    return value.includes('127.0.0.1') || value.includes('localhost');
  }
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

function errorMessage(prefix: string, err: unknown): string {
  return `${prefix}: ${err instanceof Error ? err.message : String(err)}`;
}

const inputClass = 'h-9 w-full rounded-xl border border-pi-border/70 bg-pi-bg/50 px-3 text-xs text-pi-text shadow-inner shadow-black/5 placeholder:text-pi-dim focus:border-pi-accent/80 focus:bg-pi-bg focus:outline-none focus:ring-2 focus:ring-pi-accent/15';
