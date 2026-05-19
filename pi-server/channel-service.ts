import { createDecipheriv, createHash, createHmac } from 'node:crypto';
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

interface PendingChannelPermission {
  approvalId: string;
  channelId: string;
  sessionId: string;
  requestId: string;
  createdAt: number;
}

let serviceInstance: ChannelService | null = null;
const wechatAccessTokenCache = new Map<string, WechatAccessTokenCacheEntry>();

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

  constructor(private readonly options: ChannelServiceOptions) {}

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
      defaultRecipientId: normalizeString(input.defaultRecipientId),
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
        defaultRecipientId: input.defaultRecipientId !== undefined ? normalizeString(input.defaultRecipientId) : channel.defaultRecipientId,
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
    if (channel.provider === 'wechat') {
      const officialRecipient = recipientId
        || channel.lastRecipientId
        || channel.defaultRecipientId;
      if (channel.appId && channel.appSecret && officialRecipient) {
        try {
          await sendWechatOfficialText(channel, officialRecipient, text);
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
        : 'Webhook URL is not configured.');
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
    patch: Partial<Pick<ChannelConfigData, 'lastEventAt' | 'lastError' | 'lastTestAt' | 'lastRecipientId'>>,
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
    defaultRecipientId: normalizeString(record.defaultRecipientId),
    lastRecipientId: normalizeString(record.lastRecipientId),
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

function recipientForInbound(channel: ChannelConfigData, inbound: ChannelInboundEventData): string | undefined {
  if (channel.provider !== 'wechat') return undefined;
  return inbound.replyToUserId || inbound.userId || inbound.chatId || channel.defaultRecipientId;
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
