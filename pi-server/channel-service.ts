import { createDecipheriv, createHash, createHmac, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import type {
  AgentConfigData,
  ChannelConfigData,
  ChannelInboundEventData,
  ChannelProviderData,
  ChatMessageData,
  ModelData,
  PermissionAction,
  PermissionRequestData,
  WsServerMsg,
} from './types.js';
import { createAgentRuntime } from './runtime-factory.js';
import { PermissionBroker } from './permission-broker.js';
import { appendMessage, getDataDir } from './persistence.js';
import { TranscriptRecorder } from './transcript-recorder.js';
import { resolveAgentForChannel } from './agent-service.js';
import {
  createSession,
  getAllSessions,
  getProviders,
  getSession,
  maybeAutoTitleSession,
  setSessionModel,
  setSessionStatus,
} from './mock-agent.js';

export interface ChannelHttpResponse {
  status: number;
  body?: unknown;
  text?: string;
  headers?: Record<string, string>;
}

type Broadcast = (message: WsServerMsg) => void;

interface ChannelServiceOptions {
  broadcast: Broadcast;
}

interface ChannelStore {
  channels: ChannelConfigData[];
}

interface ChannelUpsertInput {
  provider?: ChannelProviderData;
  name?: string;
  enabled?: boolean;
  webhookUrl?: string;
  verificationToken?: string;
  signingSecret?: string;
  encryptionKey?: string;
  appId?: string;
  appSecret?: string;
  defaultRecipientId?: string;
  defaultProjectPath?: string;
  defaultSessionId?: string;
  autoCreateSession?: boolean;
}

interface WechatAccessTokenCacheEntry {
  token: string;
  expiresAt: number;
}

interface FeishuTenantAccessTokenCacheEntry {
  token: string;
  expiresAt: number;
}

interface WechatQrLoginSession {
  channelId: string;
  sessionKey: string;
  qrcode: string;
  qrcodeUrl: string;
  startedAt: number;
  currentApiBaseUrl: string;
}

interface PendingChannelPermission {
  approvalId: string;
  channelId: string;
  sessionId: string;
  requestId: string;
  createdAt: number;
}

let serviceInstance: ChannelService | null = null;
const wechatAccessTokenCache = new Map<string, WechatAccessTokenCacheEntry>();
const feishuTenantAccessTokenCache = new Map<string, FeishuTenantAccessTokenCacheEntry>();
const wechatQrLoginSessions = new Map<string, WechatQrLoginSession>();

export function createChannelService(options: ChannelServiceOptions): ChannelService {
  serviceInstance = new ChannelService(options);
  return serviceInstance;
}

export function getChannelService(): ChannelService | null {
  return serviceInstance;
}

export class ChannelService {
  private readonly channelsPath = path.join(getDataDir(), 'channels.json');
  private readonly runtime = createAgentRuntime();
  private readonly recorder = new TranscriptRecorder();
  private readonly permissionBroker = new PermissionBroker();
  private readonly pendingPermissions = new Map<string, PendingChannelPermission>();
  private readonly activeResponses = new Map<string, AbortController>();
  private readonly wechatMonitors = new Map<string, AbortController>();

  constructor(private readonly options: ChannelServiceOptions) {
    setTimeout(() => this.syncWechatMonitors(), 0);
  }

  async handleRequest(req: IncomingMessage): Promise<ChannelHttpResponse | null> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'api' || parts[1] !== 'channels') return null;

    if (req.method === 'OPTIONS') {
      return {
        status: 204,
        headers: corsHeaders(),
      };
    }

    try {
      if (parts.length === 2 && req.method === 'GET') {
        return this.json(200, { channels: this.listChannels() });
      }

      if (parts.length === 2 && req.method === 'POST') {
        const input = await readJsonBody<ChannelUpsertInput>(req);
        return this.json(201, { channel: this.createChannel(input) });
      }

      if (parts.length === 3 && req.method === 'PATCH') {
        const channel = this.updateChannel(parts[2]!, await readJsonBody<ChannelUpsertInput>(req));
        return channel ? this.json(200, { channel }) : this.json(404, { error: 'Channel not found' });
      }

      if (parts.length === 3 && req.method === 'DELETE') {
        return this.json(200, { deleted: this.deleteChannel(parts[2]!) });
      }

      if (parts.length === 4 && parts[3] === 'test' && req.method === 'POST') {
        return this.json(200, await this.testChannel(parts[2]!));
      }

      if (parts.length === 4 && parts[3] === 'pairing' && req.method === 'POST') {
        return this.json(200, this.createPairing(parts[2]!));
      }

      if (parts.length === 5 && parts[3] === 'wechat-qr' && parts[4] === 'start' && req.method === 'POST') {
        return this.json(200, await this.startWechatQrLogin(parts[2]!));
      }

      if (parts.length === 5 && parts[3] === 'wechat-qr' && parts[4] === 'status' && req.method === 'POST') {
        const input = await readJsonBody<{ sessionKey?: string; verifyCode?: string }>(req);
        return this.json(200, await this.pollWechatQrLogin(parts[2]!, input));
      }

      if (parts.length === 4 && parts[3] === 'inbound' && req.method === 'POST') {
        const channel = this.getChannel(parts[2]!);
        if (!channel) return this.json(404, { error: 'Channel not found' });
        const body = await readJsonBody<Record<string, unknown>>(req);
        return this.json(202, await this.acceptInbound(channel, normalizeGenericInbound(channel, body)));
      }

      if (parts.length === 5 && parts[2] === 'feishu' && parts[4] === 'events' && req.method === 'POST') {
        const channel = this.getChannel(parts[3]!);
        if (!channel) return this.json(404, { error: 'Channel not found' });
        if (channel.provider !== 'feishu') return this.json(400, { error: 'Channel provider mismatch' });
        return this.handleFeishuEvent(channel, await readJsonBody<Record<string, unknown>>(req));
      }

      if (parts.length === 5 && parts[2] === 'wechat' && parts[4] === 'events') {
        const channel = this.getChannel(parts[3]!);
        if (!channel) return this.json(404, { error: 'Channel not found' });
        if (channel.provider !== 'wechat') return this.json(400, { error: 'Channel provider mismatch' });
        if (req.method === 'GET') return this.handleWechatVerify(channel, url);
        if (req.method === 'POST') return this.handleWechatEvent(channel, url, await readRawBody(req));
      }

      return this.json(404, { error: 'Channel endpoint not found' });
    } catch (err) {
      return this.json(500, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  listChannels(): ChannelConfigData[] {
    return this.readStore().channels.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private createChannel(input: ChannelUpsertInput): ChannelConfigData {
    const now = Date.now();
    const provider = normalizeProvider(input.provider);
    const channel: ChannelConfigData = {
      id: `channel-${now}-${Math.random().toString(36).slice(2, 8)}`,
      provider,
      name: normalizeString(input.name) || defaultChannelName(provider),
      enabled: input.enabled ?? true,
      webhookUrl: normalizeString(input.webhookUrl),
      verificationToken: normalizeString(input.verificationToken),
      signingSecret: normalizeString(input.signingSecret),
      encryptionKey: normalizeString(input.encryptionKey),
      appId: normalizeString(input.appId),
      appSecret: normalizeString(input.appSecret),
      defaultRecipientId: normalizeRecipientId(input.defaultRecipientId),
      defaultProjectPath: normalizeString(input.defaultProjectPath),
      defaultSessionId: normalizeString(input.defaultSessionId),
      autoCreateSession: input.autoCreateSession ?? true,
      createdAt: now,
      updatedAt: now,
    };

    this.writeChannels([...this.readStore().channels, channel]);
    return channel;
  }

  private updateChannel(id: string, input: ChannelUpsertInput): ChannelConfigData | null {
    let updated: ChannelConfigData | null = null;
    const channels = this.readStore().channels.map((channel) => {
      if (channel.id !== id) return channel;
      const provider = input.provider !== undefined ? normalizeProvider(input.provider) : channel.provider;
      const next: ChannelConfigData = {
        ...channel,
        provider,
        name: input.name !== undefined ? normalizeString(input.name) || channel.name : channel.name,
        enabled: input.enabled !== undefined ? Boolean(input.enabled) : channel.enabled,
        webhookUrl: input.webhookUrl !== undefined ? normalizeString(input.webhookUrl) : channel.webhookUrl,
        verificationToken: input.verificationToken !== undefined ? normalizeString(input.verificationToken) : channel.verificationToken,
        signingSecret: input.signingSecret !== undefined ? normalizeString(input.signingSecret) : channel.signingSecret,
        encryptionKey: input.encryptionKey !== undefined ? normalizeString(input.encryptionKey) : channel.encryptionKey,
        appId: input.appId !== undefined ? normalizeString(input.appId) : channel.appId,
        appSecret: input.appSecret !== undefined ? normalizeString(input.appSecret) : channel.appSecret,
        defaultRecipientId: input.defaultRecipientId !== undefined ? normalizeRecipientId(input.defaultRecipientId) : channel.defaultRecipientId,
        defaultProjectPath: input.defaultProjectPath !== undefined ? normalizeString(input.defaultProjectPath) : channel.defaultProjectPath,
        defaultSessionId: input.defaultSessionId !== undefined ? normalizeString(input.defaultSessionId) : channel.defaultSessionId,
        autoCreateSession: input.autoCreateSession !== undefined ? Boolean(input.autoCreateSession) : channel.autoCreateSession,
        updatedAt: Date.now(),
      };
      updated = next;
      return next;
    });
    if (!updated) return null;
    this.writeChannels(channels);
    return updated;
  }

  private deleteChannel(id: string): boolean {
    const channels = this.readStore().channels;
    const next = channels.filter((channel) => channel.id !== id);
    if (next.length === channels.length) return false;
    this.writeChannels(next);
    return true;
  }

  private getChannel(id: string): ChannelConfigData | undefined {
    return this.readStore().channels.find((channel) => channel.id === id);
  }

  private async testChannel(id: string): Promise<{ ok: boolean; message: string; channel?: ChannelConfigData }> {
    const channel = this.getChannel(id);
    if (!channel) return { ok: false, message: 'Channel not found' };

    try {
      if (
        channel.provider === 'feishu'
        && channel.appId
        && channel.appSecret
        && !channel.defaultRecipientId
        && !channel.lastRecipientId
        && !channel.webhookUrl
      ) {
        await getFeishuTenantAccessToken(channel.appId, channel.appSecret);
        const updated = this.patchChannelRuntimeState(channel.id, {
          lastTestAt: Date.now(),
          lastError: undefined,
        });
        return { ok: true, message: 'Feishu credentials verified.', channel: updated ?? channel };
      }

      await this.sendChannelMessage(channel, `Pi Agent channel test: ${channel.name}`);
      const updated = this.patchChannelRuntimeState(channel.id, {
        lastTestAt: Date.now(),
        lastError: undefined,
      });
      return { ok: true, message: 'Test message sent.', channel: updated ?? channel };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const updated = this.patchChannelRuntimeState(channel.id, {
        lastTestAt: Date.now(),
        lastError: message,
      });
      return { ok: false, message, channel: updated ?? channel };
    }
  }

  private createPairing(
    id: string,
  ): { ok: boolean; message: string; channel?: ChannelConfigData; pairingCode?: string; expiresAt?: number } {
    const channel = this.getChannel(id);
    if (!channel) return { ok: false, message: 'Channel not found' };

    const pairingCode = randomInt(100000, 1000000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000;
    const updated = this.patchChannelRuntimeState(channel.id, {
      pairingCode,
      pairingExpiresAt: expiresAt,
      lastError: undefined,
    });

    return {
      ok: true,
      message: 'Pairing code generated. Send it to the bot from Feishu/WeChat to bind the recipient.',
      channel: updated ?? { ...channel, pairingCode, pairingExpiresAt: expiresAt, lastError: undefined },
      pairingCode,
      expiresAt,
    };
  }

  private async startWechatQrLogin(
    id: string,
  ): Promise<{ ok: boolean; message: string; channel?: ChannelConfigData; sessionKey?: string; qrcodeUrl?: string; expiresAt?: number }> {
    const channel = this.getChannel(id);
    if (!channel) return { ok: false, message: 'Channel not found' };
    if (channel.provider !== 'wechat') return { ok: false, message: 'Channel provider mismatch' };

    try {
      purgeExpiredWechatQrSessions();
      const qr = await fetchWechatQrCode(this.readStore().channels);
      const sessionKey = randomUUID();
      const expiresAt = Date.now() + WECHAT_QR_LOGIN_TTL_MS;
      wechatQrLoginSessions.set(sessionKey, {
        channelId: channel.id,
        sessionKey,
        qrcode: qr.qrcode,
        qrcodeUrl: qr.qrcodeUrl,
        startedAt: Date.now(),
        currentApiBaseUrl: WECHAT_ILINK_BASE_URL,
      });
      const updated = this.patchChannelRuntimeState(channel.id, { lastError: undefined });
      return {
        ok: true,
        message: 'WeChat QR code generated. Scan it with WeChat and confirm on the phone.',
        channel: updated ?? channel,
        sessionKey,
        qrcodeUrl: qr.qrcodeUrl,
        expiresAt,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const updated = this.patchChannelRuntimeState(channel.id, { lastError: message });
      return { ok: false, message, channel: updated ?? channel };
    }
  }

  private async pollWechatQrLogin(
    id: string,
    input: { sessionKey?: string; verifyCode?: string },
  ): Promise<{
    ok: boolean;
    message: string;
    channel?: ChannelConfigData;
    status?: string;
    connected?: boolean;
    alreadyConnected?: boolean;
    sessionKey?: string;
    needsVerifyCode?: boolean;
  }> {
    const channel = this.getChannel(id);
    if (!channel) return { ok: false, message: 'Channel not found' };
    if (channel.provider !== 'wechat') return { ok: false, message: 'Channel provider mismatch' };

    purgeExpiredWechatQrSessions();
    const sessionKey = normalizeString(input.sessionKey);
    const session = sessionKey ? wechatQrLoginSessions.get(sessionKey) : undefined;
    if (!session || session.channelId !== channel.id) {
      return { ok: false, message: 'WeChat QR login session expired. Generate a new QR code.' };
    }
    const activeSessionKey = session.sessionKey;

    try {
      const status = await pollWechatQrStatus(session.currentApiBaseUrl, session.qrcode, normalizeString(input.verifyCode));
      if (status.status === 'scaned_but_redirect' && status.redirect_host) {
        session.currentApiBaseUrl = `https://${status.redirect_host}`;
      }

      if (status.status === 'need_verifycode') {
        return {
          ok: true,
          message: 'Enter the verification code shown on your phone.',
          status: status.status,
          sessionKey: activeSessionKey,
          needsVerifyCode: true,
        };
      }

      if (status.status === 'binded_redirect') {
        wechatQrLoginSessions.delete(activeSessionKey);
        return {
          ok: true,
          message: 'This WeChat account is already connected.',
          status: status.status,
          sessionKey: activeSessionKey,
          connected: Boolean(channel.wechatBotToken),
          alreadyConnected: true,
          channel,
        };
      }

      if (status.status === 'confirmed') {
        if (!status.bot_token || !status.ilink_bot_id) {
          wechatQrLoginSessions.delete(activeSessionKey);
          const updated = this.patchChannelRuntimeState(channel.id, { lastError: 'WeChat login confirmed but token was missing.' });
          return { ok: false, message: 'WeChat login confirmed but token was missing.', channel: updated ?? channel, status: status.status };
        }

        wechatQrLoginSessions.delete(activeSessionKey);
        const updated = this.patchChannelRuntimeState(channel.id, {
          wechatBotToken: status.bot_token,
          wechatBotId: status.ilink_bot_id,
          wechatUserId: status.ilink_user_id,
          wechatBaseUrl: status.baseurl || session.currentApiBaseUrl || WECHAT_ILINK_BASE_URL,
          defaultRecipientId: status.ilink_user_id,
          lastRecipientId: status.ilink_user_id,
          wechatSyncCursor: undefined,
          lastError: undefined,
          lastTestAt: Date.now(),
        });
        this.syncWechatMonitors();
        return {
          ok: true,
          message: 'WeChat connected. Pi Agent is now listening for WeChat messages.',
          status: status.status,
          sessionKey: activeSessionKey,
          connected: true,
          channel: updated ?? channel,
        };
      }

      if (status.status === 'expired' || status.status === 'verify_code_blocked') {
        wechatQrLoginSessions.delete(activeSessionKey);
      }

      return {
        ok: true,
        message: wechatQrStatusMessage(status.status),
        status: status.status,
        sessionKey: activeSessionKey,
        connected: false,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const updated = this.patchChannelRuntimeState(channel.id, { lastError: message });
      return { ok: false, message, channel: updated ?? channel, sessionKey: activeSessionKey };
    }
  }

  private async handleFeishuEvent(channel: ChannelConfigData, body: Record<string, unknown>): Promise<ChannelHttpResponse> {
    let eventBody: Record<string, unknown>;
    try {
      eventBody = decryptFeishuBodyIfNeeded(channel, body);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.patchChannelRuntimeState(channel.id, { lastError: message });
      return this.json(400, { error: message });
    }

    const verification = normalizeString(eventBody.challenge)
      || normalizeString((eventBody.event as Record<string, unknown> | undefined)?.challenge);
    if (eventBody.type === 'url_verification' || verification) {
      return this.json(200, { challenge: verification });
    }

    const token = normalizeString(eventBody.token)
      || normalizeString((eventBody.header as Record<string, unknown> | undefined)?.token);
    if (channel.verificationToken && token !== channel.verificationToken) {
      this.patchChannelRuntimeState(channel.id, { lastError: 'Feishu verification token mismatch.' });
      return this.json(401, { error: 'Invalid verification token' });
    }

    const inbound = normalizeFeishuInbound(channel, eventBody);
    if (!inbound.text) return this.json(200, { ok: true, ignored: true });
    return this.json(202, await this.acceptInbound(channel, inbound));
  }

  private handleWechatVerify(channel: ChannelConfigData, url: URL): ChannelHttpResponse {
    const echostr = url.searchParams.get('echostr') ?? '';
    if (!channel.verificationToken) {
      return { status: 200, text: echostr, headers: plainTextHeaders() };
    }

    const signature = url.searchParams.get('signature') ?? '';
    const timestamp = url.searchParams.get('timestamp') ?? '';
    const nonce = url.searchParams.get('nonce') ?? '';
    if (!verifyWechatSignature(channel.verificationToken, signature, timestamp, nonce)) {
      this.patchChannelRuntimeState(channel.id, { lastError: 'WeChat signature mismatch.' });
      return { status: 401, text: 'invalid signature', headers: plainTextHeaders() };
    }

    return { status: 200, text: echostr, headers: plainTextHeaders() };
  }

  private async handleWechatEvent(channel: ChannelConfigData, url: URL, rawBody: string): Promise<ChannelHttpResponse> {
    if (channel.verificationToken) {
      const signature = url.searchParams.get('signature') ?? '';
      const timestamp = url.searchParams.get('timestamp') ?? '';
      const nonce = url.searchParams.get('nonce') ?? '';
      if (!verifyWechatSignature(channel.verificationToken, signature, timestamp, nonce)) {
        this.patchChannelRuntimeState(channel.id, { lastError: 'WeChat signature mismatch.' });
        return { status: 401, text: 'invalid signature', headers: plainTextHeaders() };
      }
    }

    const inbound = normalizeWechatInbound(channel, rawBody);
    if (inbound.text) {
      void this.acceptInbound(channel, inbound);
    }

    return {
      status: 200,
      text: inbound.replyToUserId && inbound.replyFromUserId
        ? createWechatTextReply(inbound.replyFromUserId, inbound.replyToUserId, 'Pi Agent received the message and is processing it.')
        : 'success',
      headers: { ...corsHeaders(), 'Content-Type': 'application/xml; charset=utf-8' },
    };
  }

  private async acceptInbound(
    channel: ChannelConfigData,
    inbound: ChannelInboundEventData,
  ): Promise<{ ok: boolean; accepted: boolean; message: string; sessionId?: string }> {
    if (!channel.enabled) {
      return { ok: false, accepted: false, message: 'Channel is disabled.' };
    }

    const pairingResult = await this.tryResolvePairing(channel, inbound);
    if (pairingResult) return pairingResult;

    const commandResult = this.tryResolvePermissionCommand(channel, inbound.text);
    if (commandResult) {
      await this.sendChannelMessage(channel, commandResult.message, recipientForInbound(channel, inbound)).catch(() => undefined);
      return {
        ok: commandResult.ok,
        accepted: commandResult.ok,
        message: commandResult.message,
        sessionId: commandResult.sessionId,
      };
    }

    const agent = resolveAgentForChannel(channel.id);
    const session = this.resolveChannelSession(channel, agent);
    if (!session) {
      const message = 'No session is available for this channel.';
      this.patchChannelRuntimeState(channel.id, { lastError: message });
      return { ok: false, accepted: false, message };
    }

    this.patchChannelRuntimeState(channel.id, {
      lastEventAt: Date.now(),
      lastRecipientId: recipientForInbound(channel, inbound),
      lastContextToken: inbound.contextToken,
      lastError: undefined,
    });

    const displayText = formatInboundDisplay(channel, inbound, agent);
    const userMessage = createUserMessage(session.id, displayText);
    appendMessage(session.id, userMessage);
    const titledSession = maybeAutoTitleSession(session.id) ?? session;
    this.options.broadcast({ type: 'message_added', sessionId: session.id, message: userMessage });
    this.options.broadcast({ type: 'session_updated', session: titledSession });

    const promptText = formatAgentPrompt(agent, formatChannelPrompt(channel, inbound));
    const replyChannel = {
      ...channel,
      lastRecipientId: recipientForInbound(channel, inbound),
      lastContextToken: inbound.contextToken,
    };
    void this.runChannelPrompt(replyChannel, session.id, promptText, agent).catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      this.patchChannelRuntimeState(channel.id, { lastError: message });
      void this.sendChannelMessage(replyChannel, `Pi Agent channel error: ${message}`).catch(() => undefined);
    });

    return {
      ok: true,
      accepted: true,
      message: 'Message accepted.',
      sessionId: session.id,
    };
  }

  private async tryResolvePairing(
    channel: ChannelConfigData,
    inbound: ChannelInboundEventData,
  ): Promise<{ ok: boolean; accepted: boolean; message: string; sessionId?: string } | null> {
    const pairingCode = normalizeString(channel.pairingCode);
    if (!pairingCode) return null;

    const isExpired = Boolean(channel.pairingExpiresAt && channel.pairingExpiresAt <= Date.now());
    if (!matchesPairingCode(inbound.text, pairingCode)) {
      if (isExpired) {
        this.patchChannelRuntimeState(channel.id, {
          pairingCode: undefined,
          pairingExpiresAt: undefined,
        });
      }
      return null;
    }

    const liveRecipient = recipientForInbound(channel, inbound);
    if (isExpired) {
      this.patchChannelRuntimeState(channel.id, {
        pairingCode: undefined,
        pairingExpiresAt: undefined,
        lastError: 'Channel pairing code expired.',
      });
      if (liveRecipient) {
        await this.sendChannelMessage(channel, 'Pi Agent pairing code expired. Generate a new pairing code in the desktop app.', liveRecipient)
          .catch(() => undefined);
      }
      return { ok: false, accepted: false, message: 'Pairing code expired.' };
    }

    const defaultRecipient = defaultRecipientForInbound(channel, inbound);
    if (!defaultRecipient || !liveRecipient) {
      const message = 'Unable to bind channel recipient from this message.';
      this.patchChannelRuntimeState(channel.id, { lastError: message });
      return { ok: false, accepted: false, message };
    }

    const updated = this.patchChannelRuntimeState(channel.id, {
      defaultRecipientId: defaultRecipient,
      lastRecipientId: liveRecipient,
      lastContextToken: inbound.contextToken,
      pairingCode: undefined,
      pairingExpiresAt: undefined,
      lastEventAt: Date.now(),
      lastError: undefined,
    });
    const replyChannel = {
      ...channel,
      ...(updated ?? {}),
      defaultRecipientId: defaultRecipient,
      lastRecipientId: liveRecipient,
      lastContextToken: inbound.contextToken,
      pairingCode: undefined,
      pairingExpiresAt: undefined,
    };

    await this.sendChannelMessage(replyChannel, 'Pi Agent channel paired. You can now send messages to this bot from here.', liveRecipient)
      .catch((err) => {
        this.patchChannelRuntimeState(channel.id, {
          lastError: err instanceof Error ? err.message : String(err),
        });
      });

    return { ok: true, accepted: true, message: 'Channel paired.' };
  }

  private async runChannelPrompt(
    channel: ChannelConfigData,
    sessionId: string,
    promptText: string,
    agent: AgentConfigData | null,
  ): Promise<void> {
    const session = getSession(sessionId);
    if (!session) throw new Error('Session not found');

    await this.applyAgentRuntimeConfig(agent, sessionId);

    const previous = this.activeResponses.get(sessionId);
    if (previous && !previous.signal.aborted && this.runtime.followUp) {
      await this.runtime.followUp(sessionId, promptText);
      await this.sendChannelMessage(channel, 'Pi Agent received the message and queued it in the current session.').catch((err) => {
        this.patchChannelRuntimeState(channel.id, {
          lastError: err instanceof Error ? err.message : String(err),
        });
      });
      return;
    }

    if (previous) {
      previous.abort();
      this.recorder.completeInterrupted(sessionId);
    }

    const abortController = new AbortController();
    this.activeResponses.set(sessionId, abortController);
    let assistantText = '';

    try {
      await this.runtime.prompt({
        sessionId,
        message: promptText,
      }, {
        sendMessage: (message) => {
          if (abortController.signal.aborted) return;
          if (message.type === 'text_delta') assistantText += message.delta;
          this.recorder.recordServerMessage(message);
          this.options.broadcast(message);
        },
        requestPermission: (request) =>
          this.requestChannelPermission(channel, sessionId, request, (message) => {
            this.recorder.recordServerMessage(message);
            this.options.broadcast(message);
          }, abortController.signal),
      }, abortController.signal);

      if (assistantText.trim()) {
        await this.sendChannelMessage(channel, trimForChannel(assistantText));
      } else {
        await this.sendChannelMessage(channel, 'Pi Agent completed the task. See the desktop app for details.');
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setSessionStatus(sessionId, 'error');
        this.options.broadcast({ type: 'status', sessionId, status: 'error', detail: err.message });
        throw err;
      }
    } finally {
      if (this.activeResponses.get(sessionId) === abortController) {
        this.activeResponses.delete(sessionId);
      }
    }
  }

  private async requestChannelPermission(
    channel: ChannelConfigData,
    sessionId: string,
    request: PermissionRequestData,
    sendMessage: (message: WsServerMsg) => void,
    signal?: AbortSignal,
  ): Promise<PermissionAction> {
    const approvalId = createApprovalId();
    this.pendingPermissions.set(approvalId, {
      approvalId,
      channelId: channel.id,
      sessionId,
      requestId: request.requestId,
      createdAt: Date.now(),
    });

    const approvalText = [
      `Pi Agent needs approval (${approvalId})`,
      request.message,
      request.preview?.kind === 'bash' ? `Command: ${request.preview.command}` : undefined,
      request.preview?.kind === 'file' ? `File: ${request.preview.path}` : undefined,
      `Reply: allow ${approvalId} / deny ${approvalId}`,
    ].filter(Boolean).join('\n');

    await this.sendChannelMessage(channel, approvalText).catch((err) => {
      this.patchChannelRuntimeState(channel.id, {
        lastError: err instanceof Error ? err.message : String(err),
      });
    });

    try {
      return await this.permissionBroker.request(sessionId, request, sendMessage, signal);
    } finally {
      this.pendingPermissions.delete(approvalId);
    }
  }

  private tryResolvePermissionCommand(
    channel: ChannelConfigData,
    text: string,
  ): { ok: boolean; message: string; sessionId?: string } | null {
    const match = /^(allow|approve|yes|deny|reject|no|always)\s+([a-z0-9-]+)$/i.exec(text.trim());
    if (!match) return null;

    const actionWord = match[1]!.toLowerCase();
    const approvalId = match[2]!.toLowerCase();
    const pending = this.pendingPermissions.get(approvalId);
    if (!pending || pending.channelId !== channel.id) {
      return { ok: false, message: `No pending approval found for ${approvalId}.` };
    }

    const action: PermissionAction = actionWord === 'deny' || actionWord === 'reject' || actionWord === 'no'
      ? 'deny'
      : actionWord === 'always'
        ? 'always_allow'
        : 'allow';

    const resolved = this.permissionBroker.resolve(pending.sessionId, {
      action,
      requestId: pending.requestId,
      scope: action === 'always_allow' ? 'project' : undefined,
    });

    return {
      ok: resolved,
      sessionId: pending.sessionId,
      message: resolved
        ? `Approval ${approvalId} resolved as ${action}.`
        : `Approval ${approvalId} could not be resolved.`,
    };
  }

  private async sendChannelMessage(channel: ChannelConfigData, text: string, recipientId?: string): Promise<void> {
    if (channel.provider === 'feishu') {
      const feishuRecipient = recipientId
        || channel.lastRecipientId
        || channel.defaultRecipientId;
      if (channel.appId && channel.appSecret && feishuRecipient) {
        try {
          await sendFeishuAppText(channel, feishuRecipient, text);
          return;
        } catch (err) {
          if (!channel.webhookUrl) throw err;
          console.warn('[PiServer] Feishu app message failed, falling back to webhook:', err);
        }
      }
    }

    if (channel.provider === 'wechat') {
      const wechatRecipient = recipientId
        || channel.lastRecipientId
        || channel.defaultRecipientId;
      if (channel.wechatBotToken && wechatRecipient) {
        await sendWechatPersonalText(channel, wechatRecipient, text, channel.lastContextToken);
        return;
      }
      if (channel.appId && channel.appSecret && wechatRecipient) {
        try {
          await sendWechatOfficialText(channel, wechatRecipient, text);
          return;
        } catch (err) {
          if (!channel.webhookUrl) throw err;
          console.warn('[PiServer] WeChat official message failed, falling back to webhook:', err);
        }
      }
    }

    const webhookUrl = channel.webhookUrl?.trim();
    if (!webhookUrl) {
      throw new Error(channel.provider === 'wechat'
        ? 'WeChat appId/appSecret with recipient OpenID or webhook URL is not configured.'
        : 'Feishu App ID/App Secret with recipient chat/open ID or webhook URL is not configured.');
    }

    const payload = channel.provider === 'feishu'
      ? feishuWebhookPayload(text, channel.signingSecret)
      : wechatWebhookPayload(text);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(body || `Webhook request failed with ${response.status}`);
    }
  }

  private async applyAgentRuntimeConfig(agent: AgentConfigData | null, sessionId: string): Promise<void> {
    if (!agent?.modelProvider || !agent.modelId || !this.runtime.setModel) return;
    const model = findModel(agent.modelProvider, agent.modelId);
    if (model) {
      setSessionModel(sessionId, model);
    }
    await Promise.resolve(this.runtime.setModel(agent.modelProvider, agent.modelId));
  }

  private syncWechatMonitors(): void {
    const channels = this.readStore().channels;
    const activeIds = new Set(
      channels
        .filter((channel) => channel.provider === 'wechat' && channel.enabled && Boolean(channel.wechatBotToken))
        .map((channel) => channel.id),
    );

    for (const [channelId, controller] of this.wechatMonitors) {
      if (!activeIds.has(channelId)) {
        controller.abort();
        this.wechatMonitors.delete(channelId);
      }
    }

    for (const channel of channels) {
      if (!activeIds.has(channel.id) || this.wechatMonitors.has(channel.id)) continue;
      const controller = new AbortController();
      this.wechatMonitors.set(channel.id, controller);
      void this.runWechatMonitor(channel.id, controller.signal);
    }
  }

  private async runWechatMonitor(channelId: string, signal: AbortSignal): Promise<void> {
    let consecutiveFailures = 0;
    while (!signal.aborted) {
      const channel = this.getChannel(channelId);
      if (!channel || channel.provider !== 'wechat' || !channel.enabled || !channel.wechatBotToken) break;

      try {
        const response = await getWechatPersonalUpdates(channel, signal);
        const isError = (response.ret !== undefined && response.ret !== 0) || (response.errcode !== undefined && response.errcode !== 0);
        if (isError) {
          const message = response.errmsg || `WeChat getupdates failed: ret=${response.ret ?? response.errcode}`;
          this.patchChannelRuntimeState(channel.id, { lastError: message });
          consecutiveFailures += 1;
          await sleep(consecutiveFailures >= 3 ? 30_000 : 3000, signal);
          if (consecutiveFailures >= 3) consecutiveFailures = 0;
          continue;
        }

        consecutiveFailures = 0;
        if (response.get_updates_buf) {
          this.patchChannelRuntimeState(channel.id, {
            wechatSyncCursor: response.get_updates_buf,
            lastError: undefined,
          });
        }

        for (const message of response.msgs ?? []) {
          if (signal.aborted) break;
          const inbound = normalizeWechatPersonalInbound(channel, message);
          if (!inbound) continue;
          await this.acceptInbound(channel, inbound);
        }

        await sleep(500, signal);
      } catch (err: any) {
        if (signal.aborted || err?.name === 'AbortError') break;
        const message = err instanceof Error ? err.message : String(err);
        this.patchChannelRuntimeState(channelId, { lastError: message });
        consecutiveFailures += 1;
        await sleep(consecutiveFailures >= 3 ? 30_000 : 3000, signal);
        if (consecutiveFailures >= 3) consecutiveFailures = 0;
      }
    }
    this.wechatMonitors.delete(channelId);
  }

  private resolveChannelSession(channel: ChannelConfigData, agent: AgentConfigData | null) {
    const agentProjectPath = agent?.projectPath?.trim();

    if (channel.defaultSessionId && !agentProjectPath) {
      const session = getSession(channel.defaultSessionId);
      if (session) {
        maybeApplySessionAgentModel(session.id, agent);
        return session;
      }
    }

    const projectPath = agentProjectPath || channel.defaultProjectPath?.trim();
    if (projectPath) {
      const existing = getAllSessions().find((session) => pathEquals(session.projectPath, projectPath));
      if (existing) {
        maybeApplySessionAgentModel(existing.id, agent);
        return existing;
      }
      if (channel.autoCreateSession) {
        const session = createSession(projectPath, { projectName: agent?.name || basename(projectPath) });
        maybeApplySessionAgentModel(session.id, agent);
        return session;
      }
    }

    const existing = getAllSessions()[0];
    if (existing) {
      maybeApplySessionAgentModel(existing.id, agent);
      return existing;
    }
    if (!channel.autoCreateSession) return null;

    const session = createSession(process.cwd(), { projectName: agent?.name || basename(process.cwd()) });
    maybeApplySessionAgentModel(session.id, agent);
    return session;
  }

  private patchChannelRuntimeState(
    id: string,
    patch: Partial<Pick<
      ChannelConfigData,
      | 'lastEventAt'
      | 'lastError'
      | 'lastTestAt'
      | 'lastRecipientId'
      | 'lastContextToken'
      | 'defaultRecipientId'
      | 'pairingCode'
      | 'pairingExpiresAt'
      | 'wechatBotToken'
      | 'wechatBotId'
      | 'wechatUserId'
      | 'wechatBaseUrl'
      | 'wechatSyncCursor'
    >>,
  ): ChannelConfigData | null {
    let updated: ChannelConfigData | null = null;
    const channels = this.readStore().channels.map((channel) => {
      if (channel.id !== id) return channel;
      updated = { ...channel, ...patch, updatedAt: Date.now() };
      return updated;
    });
    if (updated) this.writeChannels(channels);
    return updated;
  }

  private readStore(): ChannelStore {
    if (!existsSync(this.channelsPath)) return { channels: [] };

    try {
      const parsed = JSON.parse(readFileSync(this.channelsPath, 'utf8')) as Partial<ChannelStore>;
      return {
        channels: Array.isArray(parsed.channels) ? parsed.channels.map(normalizeStoredChannel).filter(Boolean) : [],
      } as ChannelStore;
    } catch (err) {
      console.warn('[PiServer] Failed to read channel store:', err);
      return { channels: [] };
    }
  }

  private writeChannels(channels: ChannelConfigData[]): void {
    mkdirSync(path.dirname(this.channelsPath), { recursive: true });
    const tmp = `${this.channelsPath}.tmp`;
    writeFileSync(tmp, `${JSON.stringify({ channels }, null, 2)}\n`, 'utf8');
    renameSync(tmp, this.channelsPath);
    setTimeout(() => this.syncWechatMonitors(), 0);
  }

  private json(status: number, body: unknown): ChannelHttpResponse {
    return { status, body, headers: corsHeaders() };
  }
}

function normalizeStoredChannel(raw: unknown): ChannelConfigData | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Partial<ChannelConfigData>;
  if (!record.id || !record.provider) return null;
  const provider = normalizeProvider(record.provider);
  return {
    id: String(record.id),
    provider,
    name: normalizeString(record.name) || defaultChannelName(provider),
    enabled: record.enabled !== false,
    webhookUrl: normalizeString(record.webhookUrl),
    verificationToken: normalizeString(record.verificationToken),
    signingSecret: normalizeString(record.signingSecret),
    encryptionKey: normalizeString(record.encryptionKey),
    appId: normalizeString(record.appId),
    appSecret: normalizeString(record.appSecret),
    wechatBotToken: normalizeString(record.wechatBotToken),
    wechatBotId: normalizeString(record.wechatBotId),
    wechatUserId: normalizeString(record.wechatUserId),
    wechatBaseUrl: normalizeString(record.wechatBaseUrl),
    wechatSyncCursor: normalizeString(record.wechatSyncCursor),
    defaultRecipientId: normalizeRecipientId(record.defaultRecipientId),
    lastRecipientId: normalizeString(record.lastRecipientId),
    lastContextToken: normalizeString(record.lastContextToken),
    pairingCode: normalizeString(record.pairingCode),
    pairingExpiresAt: normalizeNumber(record.pairingExpiresAt),
    defaultProjectPath: normalizeString(record.defaultProjectPath),
    defaultSessionId: normalizeString(record.defaultSessionId),
    autoCreateSession: record.autoCreateSession !== false,
    createdAt: normalizeNumber(record.createdAt) ?? Date.now(),
    updatedAt: normalizeNumber(record.updatedAt) ?? Date.now(),
    lastEventAt: normalizeNumber(record.lastEventAt),
    lastError: normalizeString(record.lastError),
    lastTestAt: normalizeNumber(record.lastTestAt),
  };
}

function normalizeGenericInbound(channel: ChannelConfigData, body: Record<string, unknown>): ChannelInboundEventData {
  return {
    channelId: channel.id,
    provider: channel.provider,
    text: normalizeString(body.text) || normalizeString(body.message) || '',
    chatId: normalizeString(body.chatId) || normalizeString(body.conversationId),
    userId: normalizeString(body.userId) || normalizeString(body.openId),
    userName: normalizeString(body.userName) || normalizeString(body.senderName),
    raw: body,
  };
}

function normalizeFeishuInbound(channel: ChannelConfigData, body: Record<string, unknown>): ChannelInboundEventData {
  const event = normalizeRecord(body.event);
  const message = normalizeRecord(event.message);
  const sender = normalizeRecord(event.sender);
  const senderId = normalizeRecord(sender.sender_id);
  const content = parseMaybeJson(normalizeString(message.content));
  const text = normalizeString(content.text)
    || normalizeString(message.content)
    || normalizeString(event.text)
    || '';

  return {
    channelId: channel.id,
    provider: 'feishu',
    text,
    chatId: normalizeString(message.chat_id) || normalizeString(event.chat_id),
    userId: normalizeString(senderId.open_id) || normalizeString(sender.open_id),
    userName: normalizeString(sender.sender_name) || normalizeString(sender.name),
    messageId: normalizeString(message.message_id),
    raw: body,
  };
}

function normalizeWechatInbound(channel: ChannelConfigData, rawBody: string): ChannelInboundEventData {
  const content = decodeXml(getXmlValue(rawBody, 'Content'));
  const fromUser = decodeXml(getXmlValue(rawBody, 'FromUserName'));
  const toUser = decodeXml(getXmlValue(rawBody, 'ToUserName'));
  const msgType = decodeXml(getXmlValue(rawBody, 'MsgType'));

  return {
    channelId: channel.id,
    provider: 'wechat',
    text: msgType === 'text' ? content : '',
    chatId: fromUser,
    userId: fromUser,
    replyFromUserId: toUser,
    replyToUserId: fromUser,
    raw: rawBody,
  };
}

function normalizeWechatPersonalInbound(channel: ChannelConfigData, message: WechatPersonalMessage): ChannelInboundEventData | null {
  if (message.message_type !== undefined && message.message_type !== WECHAT_MESSAGE_TYPE_USER) return null;
  const text = extractWechatPersonalText(message);
  if (!text) return null;
  const fromUserId = normalizeString(message.from_user_id);
  if (!fromUserId) return null;

  return {
    channelId: channel.id,
    provider: 'wechat',
    text,
    chatId: normalizeString(message.session_id) || fromUserId,
    userId: fromUserId,
    messageId: message.message_id !== undefined ? String(message.message_id) : normalizeString(message.client_id),
    contextToken: normalizeString(message.context_token),
    raw: message,
  };
}

function extractWechatPersonalText(message: WechatPersonalMessage): string {
  for (const item of message.item_list ?? []) {
    if (item.type === WECHAT_MESSAGE_ITEM_TEXT && item.text_item?.text != null) {
      return String(item.text_item.text).trim();
    }
  }
  return '';
}

function recipientForInbound(channel: ChannelConfigData, inbound: ChannelInboundEventData): string | undefined {
  if (channel.provider === 'feishu') {
    return inbound.chatId || inbound.userId || channel.defaultRecipientId;
  }
  if (channel.provider !== 'wechat') return undefined;
  return inbound.replyToUserId || inbound.userId || inbound.chatId || channel.defaultRecipientId;
}

function defaultRecipientForInbound(channel: ChannelConfigData, inbound: ChannelInboundEventData): string | undefined {
  if (channel.provider === 'feishu') {
    if (inbound.chatId) return `chat_id:${inbound.chatId}`;
    if (inbound.userId) return `open_id:${inbound.userId}`;
    return normalizeRecipientId(channel.defaultRecipientId);
  }
  if (channel.provider === 'wechat') {
    return inbound.replyToUserId || inbound.userId || inbound.chatId || normalizeRecipientId(channel.defaultRecipientId);
  }
  return undefined;
}

function matchesPairingCode(text: string, pairingCode: string): boolean {
  const code = pairingCode.trim();
  if (!code) return false;
  const trimmed = text.trim();
  if (trimmed === code) return true;
  return new RegExp(`(^|\\D)${escapeRegExp(code)}(\\D|$)`).test(trimmed);
}

function formatInboundDisplay(
  channel: ChannelConfigData,
  inbound: ChannelInboundEventData,
  agent: AgentConfigData | null,
): string {
  const source = channel.provider === 'feishu' ? 'Feishu' : 'WeChat';
  const user = inbound.userName || inbound.userId || inbound.chatId || 'unknown';
  const route = agent ? ` -> ${agent.name}` : '';
  return `[${source}${route}] ${user}: ${inbound.text}`;
}

function formatChannelPrompt(channel: ChannelConfigData, inbound: ChannelInboundEventData): string {
  const attrs = [
    ['provider', channel.provider],
    ['channelId', channel.id],
    ['channelName', channel.name],
    ['chatId', inbound.chatId],
    ['userId', inbound.userId],
    ['userName', inbound.userName],
    ['messageId', inbound.messageId],
  ]
    .filter(([, value]) => Boolean(value))
    .map(([key, value]) => `${key}="${escapeXmlAttr(String(value))}"`)
    .join(' ');

  return `<channel ${attrs}>\n${inbound.text.trim()}\n</channel>`;
}

function formatAgentPrompt(agent: AgentConfigData | null, channelPrompt: string): string {
  if (!agent) return channelPrompt;

  return [
    `<agent id="${escapeXmlAttr(agent.id)}" name="${escapeXmlAttr(agent.name)}">`,
    agent.description ? `<description>${escapeXmlText(agent.description)}</description>` : undefined,
    agent.systemPrompt ? `<system_prompt>${escapeXmlText(agent.systemPrompt)}</system_prompt>` : undefined,
    channelPrompt,
    '</agent>',
  ].filter(Boolean).join('\n');
}

function createUserMessage(sessionId: string, text: string): ChatMessageData {
  return {
    id: `channel-user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    sessionId,
    role: 'user',
    content: [{ type: 'text', text }],
    timestamp: Date.now(),
  };
}

const WECHAT_ILINK_BASE_URL = 'https://ilinkai.weixin.qq.com';
const WECHAT_ILINK_APP_ID = 'bot';
const WECHAT_ILINK_CLIENT_VERSION = buildWechatClientVersion('2.4.3');
const WECHAT_QR_LOGIN_TTL_MS = 5 * 60 * 1000;
const WECHAT_MESSAGE_TYPE_USER = 1;
const WECHAT_MESSAGE_TYPE_BOT = 2;
const WECHAT_MESSAGE_STATE_FINISH = 2;
const WECHAT_MESSAGE_ITEM_TEXT = 1;

interface WechatQrCodeResponse {
  qrcode: string;
  qrcodeUrl: string;
}

interface WechatQrStatusResponse {
  status: 'wait' | 'scaned' | 'confirmed' | 'expired' | 'scaned_but_redirect' | 'need_verifycode' | 'verify_code_blocked' | 'binded_redirect';
  bot_token?: string;
  ilink_bot_id?: string;
  ilink_user_id?: string;
  baseurl?: string;
  redirect_host?: string;
}

interface WechatPersonalMessageItem {
  type?: number;
  text_item?: { text?: string };
}

interface WechatPersonalMessage {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  client_id?: string;
  session_id?: string;
  message_type?: number;
  message_state?: number;
  item_list?: WechatPersonalMessageItem[];
  context_token?: string;
}

interface WechatPersonalUpdatesResponse {
  ret?: number;
  errcode?: number;
  errmsg?: string;
  msgs?: WechatPersonalMessage[];
  get_updates_buf?: string;
  longpolling_timeout_ms?: number;
}

function purgeExpiredWechatQrSessions(): void {
  const now = Date.now();
  for (const [sessionKey, session] of wechatQrLoginSessions) {
    if (now - session.startedAt > WECHAT_QR_LOGIN_TTL_MS) {
      wechatQrLoginSessions.delete(sessionKey);
    }
  }
}

async function fetchWechatQrCode(channels: ChannelConfigData[]): Promise<WechatQrCodeResponse> {
  const body = JSON.stringify({
    local_token_list: channels
      .map((channel) => channel.wechatBotToken)
      .filter((token): token is string => Boolean(token))
      .slice(-10),
  });
  const rawText = await wechatApiPost({
    baseUrl: WECHAT_ILINK_BASE_URL,
    endpoint: 'ilink/bot/get_bot_qrcode?bot_type=3',
    body,
    label: 'wechatQrCode',
    timeoutMs: 15_000,
  });
  const result = JSON.parse(rawText) as Record<string, unknown>;
  const qrcode = normalizeString(result.qrcode);
  const qrcodeUrl = normalizeString(result.qrcode_img_content);
  if (!qrcode || !qrcodeUrl) {
    throw new Error(normalizeString(result.errmsg) || 'WeChat QR code response was incomplete.');
  }
  return { qrcode, qrcodeUrl };
}

async function pollWechatQrStatus(
  baseUrl: string,
  qrcode: string,
  verifyCode?: string,
): Promise<WechatQrStatusResponse> {
  let endpoint = `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`;
  if (verifyCode) endpoint += `&verify_code=${encodeURIComponent(verifyCode)}`;
  try {
    const rawText = await wechatApiGet({
      baseUrl,
      endpoint,
      label: 'wechatQrStatus',
      timeoutMs: 15_000,
    });
    const result = JSON.parse(rawText) as WechatQrStatusResponse;
    return result.status ? result : { status: 'wait' };
  } catch (err: any) {
    if (err?.name === 'AbortError') return { status: 'wait' };
    throw err;
  }
}

async function getWechatPersonalUpdates(
  channel: ChannelConfigData,
  signal?: AbortSignal,
): Promise<WechatPersonalUpdatesResponse> {
  if (!channel.wechatBotToken) throw new Error('WeChat personal bot token is not configured.');
  const rawText = await wechatApiPost({
    baseUrl: channel.wechatBaseUrl || WECHAT_ILINK_BASE_URL,
    endpoint: 'ilink/bot/getupdates',
    token: channel.wechatBotToken,
    body: JSON.stringify({
      get_updates_buf: channel.wechatSyncCursor || '',
      base_info: wechatBaseInfo(),
    }),
    label: 'wechatGetUpdates',
    timeoutMs: 35_000,
    signal,
  });
  return JSON.parse(rawText) as WechatPersonalUpdatesResponse;
}

async function sendWechatPersonalText(
  channel: ChannelConfigData,
  recipientId: string,
  text: string,
  contextToken?: string,
): Promise<void> {
  if (!channel.wechatBotToken) throw new Error('WeChat personal QR channel is not connected.');
  await wechatApiPost({
    baseUrl: channel.wechatBaseUrl || WECHAT_ILINK_BASE_URL,
    endpoint: 'ilink/bot/sendmessage',
    token: channel.wechatBotToken,
    timeoutMs: 15_000,
    label: 'wechatSendMessage',
    body: JSON.stringify({
      msg: {
        from_user_id: '',
        to_user_id: recipientId,
        client_id: `pi-agent-wechat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        message_type: WECHAT_MESSAGE_TYPE_BOT,
        message_state: WECHAT_MESSAGE_STATE_FINISH,
        item_list: text ? [{ type: WECHAT_MESSAGE_ITEM_TEXT, text_item: { text } }] : undefined,
        context_token: contextToken || undefined,
      },
      base_info: wechatBaseInfo(),
    }),
  });
}

async function wechatApiGet(params: {
  baseUrl: string;
  endpoint: string;
  label: string;
  timeoutMs?: number;
}): Promise<string> {
  const url = new URL(params.endpoint, ensureTrailingSlash(params.baseUrl));
  const controller = params.timeoutMs ? new AbortController() : undefined;
  const timer = controller && params.timeoutMs ? setTimeout(() => controller.abort(), params.timeoutMs) : undefined;
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: wechatCommonHeaders(),
      signal: controller?.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${params.label} ${response.status}: ${text}`);
    return text;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function wechatApiPost(params: {
  baseUrl: string;
  endpoint: string;
  body: string;
  label: string;
  token?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<string> {
  const url = new URL(params.endpoint, ensureTrailingSlash(params.baseUrl));
  const controller = params.timeoutMs ? new AbortController() : undefined;
  const timer = controller && params.timeoutMs ? setTimeout(() => controller.abort(), params.timeoutMs) : undefined;
  const signal = anySignal([params.signal, controller?.signal].filter(Boolean) as AbortSignal[]);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: wechatHeaders(params.token),
      body: params.body,
      signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${params.label} ${response.status}: ${text}`);
    return text;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function wechatHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'AuthorizationType': 'ilink_bot_token',
    'X-WECHAT-UIN': Buffer.from(String(randomBytes(4).readUInt32BE(0)), 'utf8').toString('base64'),
    ...wechatCommonHeaders(),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function wechatCommonHeaders(): Record<string, string> {
  return {
    'iLink-App-Id': WECHAT_ILINK_APP_ID,
    'iLink-App-ClientVersion': String(WECHAT_ILINK_CLIENT_VERSION),
  };
}

function wechatBaseInfo(): Record<string, string> {
  return {
    channel_version: '2.4.3',
    bot_agent: 'PiAgent/0.1.0 OpenClaw/2.4.3',
  };
}

function wechatQrStatusMessage(status: string | undefined): string {
  switch (status) {
    case 'wait':
      return 'Waiting for WeChat scan.';
    case 'scaned':
      return 'QR code scanned. Confirm on your phone.';
    case 'scaned_but_redirect':
      return 'QR code scanned. Switching WeChat login region.';
    case 'need_verifycode':
      return 'Enter the verification code shown on your phone.';
    case 'expired':
      return 'QR code expired. Generate a new one.';
    case 'verify_code_blocked':
      return 'Too many wrong verification codes. Generate a new QR code later.';
    default:
      return 'Waiting for WeChat login.';
  }
}

function buildWechatClientVersion(version: string): number {
  const parts = version.split('.').map((part) => parseInt(part, 10));
  const major = parts[0] ?? 0;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;
  return ((major & 0xff) << 16) | ((minor & 0xff) << 8) | (patch & 0xff);
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function anySignal(signals: AbortSignal[]): AbortSignal | undefined {
  const activeSignals = signals.filter(Boolean);
  if (activeSignals.length === 0) return undefined;
  if (activeSignals.length === 1) return activeSignals[0];
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of activeSignals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener('abort', abort, { once: true });
  }
  return controller.signal;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

function decryptFeishuBodyIfNeeded(channel: ChannelConfigData, body: Record<string, unknown>): Record<string, unknown> {
  const encrypted = normalizeString(body.encrypt);
  if (!encrypted) return body;

  if (!channel.encryptionKey) {
    throw new Error('Feishu encrypted event received, but encryption key is not configured.');
  }

  return normalizeRecord(JSON.parse(decryptFeishuEncrypt(encrypted, channel.encryptionKey)));
}

function decryptFeishuEncrypt(encrypted: string, encryptionKey: string): string {
  const key = createHash('sha256').update(encryptionKey).digest();
  const iv = key.subarray(0, 16);
  const decipher = createDecipheriv('aes-256-cbc', key, iv);
  decipher.setAutoPadding(true);
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

function feishuWebhookPayload(text: string, signingSecret?: string) {
  const payload: Record<string, unknown> = {
    msg_type: 'text',
    content: { text },
  };

  if (signingSecret) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    payload.timestamp = timestamp;
    payload.sign = createHmac('sha256', `${timestamp}\n${signingSecret}`).update('').digest('base64');
  }

  return payload;
}

function wechatWebhookPayload(text: string) {
  return {
    msgtype: 'text',
    text: { content: text },
  };
}

async function sendFeishuAppText(
  channel: ChannelConfigData,
  recipientId: string,
  text: string,
): Promise<void> {
  if (!channel.appId || !channel.appSecret) {
    throw new Error('Feishu App ID/App Secret is not configured.');
  }

  const accessToken = await getFeishuTenantAccessToken(channel.appId, channel.appSecret);
  const recipient = parseFeishuRecipientId(recipientId);
  const url = new URL('https://open.feishu.cn/open-apis/im/v1/messages');
  url.searchParams.set('receive_id_type', recipient.type);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify({
      receive_id: recipient.id,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    }),
  });

  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  const code = typeof result.code === 'number' ? result.code : undefined;
  if (!response.ok || (code !== undefined && code !== 0)) {
    throw new Error(normalizeString(result.msg) || normalizeString(result.error) || `Feishu message failed with ${response.status}`);
  }
}

async function getFeishuTenantAccessToken(appId: string, appSecret: string): Promise<string> {
  const cacheKey = appId;
  const cached = feishuTenantAccessTokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 30_000) {
    return cached.token;
  }

  const response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      app_id: appId,
      app_secret: appSecret,
    }),
  });

  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  const accessToken = normalizeString(result.tenant_access_token);
  const expire = typeof result.expire === 'number' ? result.expire : 7200;
  const code = typeof result.code === 'number' ? result.code : undefined;
  if (!response.ok || !accessToken || (code !== undefined && code !== 0)) {
    throw new Error(normalizeString(result.msg) || normalizeString(result.error) || `Feishu tenant_access_token request failed with ${response.status}`);
  }

  feishuTenantAccessTokenCache.set(cacheKey, {
    token: accessToken,
    expiresAt: Date.now() + Math.max(60, expire - 300) * 1000,
  });
  return accessToken;
}

function parseFeishuRecipientId(value: string): { type: 'open_id' | 'user_id' | 'union_id' | 'chat_id'; id: string } {
  const trimmed = value.trim();
  if (!trimmed || /_xxx\b/i.test(trimmed) || /\s\/\s/.test(trimmed)) {
    throw new Error('Feishu recipient is not configured. Use chat_id:oc_xxx or open_id:ou_xxx, or bind with a pairing code.');
  }
  const explicit = /^(open_id|user_id|union_id|chat_id):(.+)$/i.exec(trimmed);
  if (explicit) {
    const id = explicit[2]!.trim();
    if (!id || /_xxx\b/i.test(id)) {
      throw new Error('Feishu recipient is not configured. Use chat_id:oc_xxx or open_id:ou_xxx, or bind with a pairing code.');
    }
    return {
      type: explicit[1]!.toLowerCase() as 'open_id' | 'user_id' | 'union_id' | 'chat_id',
      id,
    };
  }

  if (trimmed.startsWith('oc_')) return { type: 'chat_id', id: trimmed };
  if (trimmed.startsWith('ou_')) return { type: 'open_id', id: trimmed };
  if (trimmed.startsWith('on_')) return { type: 'union_id', id: trimmed };
  return { type: 'chat_id', id: trimmed };
}

async function sendWechatOfficialText(
  channel: ChannelConfigData,
  recipientId: string,
  text: string,
): Promise<void> {
  if (!channel.appId || !channel.appSecret) {
    throw new Error('WeChat appId/appSecret is not configured.');
  }

  const accessToken = await getWechatAccessToken(channel.appId, channel.appSecret);
  const response = await fetch(
    `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        touser: recipientId,
        msgtype: 'text',
        text: { content: text },
      }),
    },
  );

  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  const errcode = typeof result.errcode === 'number' ? result.errcode : undefined;
  if (!response.ok || (errcode !== undefined && errcode !== 0)) {
    throw new Error(normalizeString(result.errmsg) || `WeChat custom message failed with ${response.status}`);
  }
}

async function getWechatAccessToken(appId: string, appSecret: string): Promise<string> {
  const cacheKey = appId;
  const cached = wechatAccessTokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 30_000) {
    return cached.token;
  }

  const url = new URL('https://api.weixin.qq.com/cgi-bin/token');
  url.searchParams.set('grant_type', 'client_credential');
  url.searchParams.set('appid', appId);
  url.searchParams.set('secret', appSecret);

  const response = await fetch(url);
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  const accessToken = normalizeString(result.access_token);
  const expiresIn = typeof result.expires_in === 'number' ? result.expires_in : 7200;
  if (!response.ok || !accessToken) {
    throw new Error(normalizeString(result.errmsg) || `WeChat access_token request failed with ${response.status}`);
  }

  wechatAccessTokenCache.set(cacheKey, {
    token: accessToken,
    expiresAt: Date.now() + Math.max(60, expiresIn - 300) * 1000,
  });
  return accessToken;
}

function verifyWechatSignature(token: string, signature: string, timestamp: string, nonce: string): boolean {
  const expected = createHash('sha1').update([token, timestamp, nonce].sort().join('')).digest('hex');
  return expected === signature;
}

function createWechatTextReply(toUser: string, fromUser: string, content: string): string {
  return [
    '<xml>',
    `<ToUserName><![CDATA[${toUser}]]></ToUserName>`,
    `<FromUserName><![CDATA[${fromUser}]]></FromUserName>`,
    `<CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime>`,
    '<MsgType><![CDATA[text]]></MsgType>',
    `<Content><![CDATA[${content}]]></Content>`,
    '</xml>',
  ].join('');
}

function createApprovalId(): string {
  return Math.random().toString(36).slice(2, 8);
}

function trimForChannel(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 3800 ? `${trimmed.slice(0, 3800)}\n\n...[truncated]` : trimmed;
}

function normalizeProvider(value: unknown): ChannelProviderData {
  return value === 'wechat' ? 'wechat' : 'feishu';
}

function defaultChannelName(provider: ChannelProviderData): string {
  return provider === 'feishu' ? 'Feishu Channel' : 'WeChat Channel';
}

function maybeApplySessionAgentModel(sessionId: string, agent: AgentConfigData | null): void {
  if (!agent?.modelProvider || !agent.modelId) return;
  const model = findModel(agent.modelProvider, agent.modelId);
  if (model) setSessionModel(sessionId, model);
}

function findModel(provider: string, modelId: string): ModelData | null {
  return getProviders().find((item) => item.id === provider)?.models.find((model) => model.id === modelId)
    ?? getProviders().flatMap((item) => item.models).find((model) => model.id === modelId)
    ?? null;
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeRecipientId(value: unknown): string | undefined {
  const recipientId = normalizeString(value);
  if (!recipientId) return undefined;
  const lower = recipientId.toLowerCase();
  if (
    lower === 'chat_id:oc_xxx / open_id:ou_xxx'
    || lower.includes('oc_xxx')
    || lower.includes('ou_xxx')
  ) {
    return undefined;
  }
  return recipientId;
}

function normalizeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function parseMaybeJson(value: string | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    return normalizeRecord(JSON.parse(value));
  } catch {
    return {};
  }
}

function pathEquals(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}

function basename(value: string): string {
  return path.basename(path.resolve(value)) || value;
}

function getXmlValue(xml: string, tag: string): string {
  const match = new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>|<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml);
  return match?.[1] ?? match?.[2] ?? '';
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const raw = await readRawBody(req);
  if (!raw) return {} as T;
  return JSON.parse(raw) as T;
}

async function readRawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function plainTextHeaders(): Record<string, string> {
  return { ...corsHeaders(), 'Content-Type': 'text/plain; charset=utf-8' };
}
