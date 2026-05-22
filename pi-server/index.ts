// ============================================================
// Pi Agent Server - Main Entry Point
// ============================================================

import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  ModelData,
  PermissionAction,
  PermissionModeData,
  PermissionRequestData,
  ProviderData,
  SessionData,
  WsClientMsg,
  WsServerMsg,
} from './types.js';
import {
  createSession, getAllSessions, deleteSession, renameSession, getSession,
  getCurrentModel, getProviders, getThinkingLevel, setThinkingLevel, setModel,
  getPackages, getExtensions, getThemes,
  forkSession, setSessionStatus, setSessionModel, getSessionModel, setSessionThinkingLevel, getSessionThinkingLevel,
  maybeAutoTitleSession, autoTitleDefaultSessions,
} from './mock-agent.js';
import { PermissionBroker } from './permission-broker.js';
import { handleAuthRequest } from './auth-service.js';
import { handlePermissionRequest } from './permission-service.js';
import { deleteMessages, getDataDir, loadMessagesBySession } from './persistence.js';
import { createAgentRuntime } from './runtime-factory.js';
import { TranscriptRecorder } from './transcript-recorder.js';
import { handleWorkspaceRequest } from './workspace-service.js';
import { handleRepositoryRequest, prepareSessionProject } from './repository-service.js';
import {
  configuredDefaultModelInProviders,
  findModelInProviders,
  firstModelInProviders,
  getAvailableSdkProviders,
} from './model-catalog.js';
import { getSlashCommands } from './slash-commands.js';
import { createChannelService } from './channel-service.js';
import { handleAgentRequest, listAgents } from './agent-service.js';
import { createAgentRoomService } from './agent-room-service.js';
import { handleWebSearchRequest } from './web-search-service.js';
import { captureRuntimeFailureLearning, maybeCaptureUserLearning, prepareAgentOrchestrationPrompt } from './agent-orchestration-service.js';
import { loadPermissionAudit, loadPermissionRules } from './permission-store.js';
import { TerminalService } from './terminal-service.js';
import { extensionService, handleExtensionRequest } from './extension-service.js';
import { handlePromptOptimizerRequest } from './prompt-optimizer-service.js';
import type { ExtensionResourceSnapshotData, ThemeData } from './types.js';

const PORT = parseInt(process.env.PORT ?? '1421', 10);
const HOST = process.env.HOST ?? '127.0.0.1';
const DEFAULT_PERMISSION_MODE = normalizePermissionMode(process.env.PI_AGENT_PERMISSION_MODE);
const AUTH_TOKEN = process.env.PI_DESKTOP_AUTH_TOKEN?.trim() || '';

const wsClients = new Set<WebSocket>();
const broadcastToClients = (message: WsServerMsg) => {
  const raw = JSON.stringify(message);
  for (const client of wsClients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(raw);
    }
  }
};
extensionService.onProgress((progress) => {
  broadcastToClients({ type: 'package_progress', progress });
});
const channelService = createChannelService({ broadcast: broadcastToClients });
const terminalService = new TerminalService(broadcastToClients);
const agentRoomService = createAgentRoomService({ broadcast: broadcastToClients });

// Create HTTP server
const httpServer = createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    if (!isAllowedOrigin(req)) {
      writeJson(res, req, 403, { error: 'Origin is not allowed.' });
      return;
    }
    res.writeHead(204, securityHeaders(req));
    res.end();
    return;
  }

  if (!isAllowedOrigin(req)) {
    writeJson(res, req, 403, { error: 'Origin is not allowed.' });
    return;
  }

  if (requiresDesktopAuth(req) && !isAuthorizedHttp(req)) {
    writeJson(res, req, 401, { error: 'Unauthorized' });
    return;
  }

  const authResponse = await handleAuthRequest(req).catch((err) => ({
    status: 500,
    body: { error: err instanceof Error ? err.message : String(err) },
  }));
  if (authResponse) {
    writeJson(res, req, authResponse.status, authResponse.body);
    return;
  }

  const workspaceResponse = await handleWorkspaceRequest(req.url ?? '/', req.method ?? 'GET', req).catch((err) => ({
    status: 500,
    body: { state: 'error', error: err instanceof Error ? err.message : String(err) },
  }));
  if (workspaceResponse) {
    writeJson(res, req, workspaceResponse.status, workspaceResponse.body);
    return;
  }

  const repositoryResponse = handleRepositoryRequest(req.url ?? '/', req.method ?? 'GET');
  if (repositoryResponse) {
    writeJson(res, req, repositoryResponse.status, repositoryResponse.body);
    return;
  }

  const permissionResponse = handlePermissionRequest(req.url ?? '/', req.method ?? 'GET');
  if (permissionResponse) {
    writeJson(res, req, permissionResponse.status, permissionResponse.body);
    return;
  }

  const agentResponse = await handleAgentRequest(req);
  if (agentResponse) {
    res.writeHead(agentResponse.status, {
      ...(agentResponse.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...agentResponse.headers,
      ...securityHeaders(req),
    });
    res.end(agentResponse.body !== undefined ? JSON.stringify(agentResponse.body) : '');
    return;
  }

  const agentRoomResponse = await agentRoomService.handleRequest(req);
  if (agentRoomResponse) {
    writeJson(res, req, agentRoomResponse.status, agentRoomResponse.body);
    return;
  }

  const webSearchResponse = await handleWebSearchRequest(req).catch((err) => ({
    status: 500,
    body: { error: err instanceof Error ? err.message : String(err) },
  }));
  if (webSearchResponse) {
    writeJson(res, req, webSearchResponse.status, webSearchResponse.body);
    return;
  }

  const promptOptimizerResponse = await handlePromptOptimizerRequest(req).catch((err) => ({
    status: 500,
    body: { error: err instanceof Error ? err.message : String(err) },
  }));
  if (promptOptimizerResponse) {
    writeJson(res, req, promptOptimizerResponse.status, promptOptimizerResponse.body);
    return;
  }

  const extensionResponse = await handleExtensionRequest(req).catch((err) => ({
    status: 500,
    body: { error: err instanceof Error ? err.message : String(err) },
  }));
  if (extensionResponse) {
    writeJson(res, req, extensionResponse.status, extensionResponse.body);
    return;
  }

  const channelResponse = await channelService.handleRequest(req);
  if (channelResponse) {
    const headers = {
      ...(channelResponse.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...channelResponse.headers,
      ...securityHeaders(req),
    };
    res.writeHead(channelResponse.status, headers);
    res.end(channelResponse.text ?? (channelResponse.body !== undefined ? JSON.stringify(channelResponse.body) : ''));
    return;
  }

  // Basic health check
  if (req.url === '/health') {
    writeJson(res, req, 200, { status: 'ok', sessions: getAllSessions().length, auth: AUTH_TOKEN ? 'enabled' : 'disabled' });
    return;
  }

  if (req.url === '/api/diagnostics' && req.method === 'GET') {
    writeJson(res, req, 200, await getDiagnostics());
    return;
  }

  // Simple REST API for non-WebSocket clients
  if (req.url === '/api/sessions' && req.method === 'GET') {
    writeJson(res, req, 200, getAllSessions());
    return;
  }

  if (req.url === '/api/models' && req.method === 'GET') {
    writeJson(res, req, 200, { providers: getProviders(), current: getCurrentModel() });
    return;
  }

  writeJson(res, req, 404, { error: 'Not found' });
});

// Create WebSocket server
const wss = new WebSocketServer({
  server: httpServer,
  verifyClient: (info, done) => {
    if (!isAllowedOrigin(info.req)) {
      done(false, 403, 'Origin is not allowed.');
      return;
    }
    if (!isAuthorizedWs(info.req)) {
      done(false, 401, 'Unauthorized');
      return;
    }
    done(true);
  },
});

wss.on('connection', async (ws: WebSocket) => {
  console.log('[PiServer] Client connected');
  wsClients.add(ws);

  // Track active agent responses per session
  const activeResponses = new Map<string, AbortController>();
  const permissionBroker = new PermissionBroker();
  const transcriptRecorder = new TranscriptRecorder();
  const runtime = createAgentRuntime();
  let permissionMode = DEFAULT_PERMISSION_MODE;
  let providerCatalog = await loadProviderCatalog();
  let selectedModel = getCurrentModelForCatalog(providerCatalog);

  // Send initial connection data
  autoTitleDefaultSessions();
  const sessions = getAllSessions();
  const initialResources = await safeResourceSnapshot(sessions[0]?.projectPath);
  const connectedMsg: WsServerMsg = {
    type: 'connected',
    sessions,
    currentModel: selectedModel,
    thinkingLevel: getThinkingLevel(),
    providers: providerCatalog,
    packages: initialResources?.packages ?? getPackages(),
    extensions: initialResources?.extensions ?? getExtensions(),
    skills: initialResources?.skills ?? [],
    prompts: initialResources?.prompts ?? [],
    themes: mergeThemes(getThemes(), initialResources?.themes ?? []),
    resourceDiagnostics: initialResources?.diagnostics ?? [],
    marketplace: initialResources?.marketplace ?? [],
    trust: initialResources?.trust ?? [],
    messagesBySession: loadMessagesBySession(sessions),
    agentRooms: agentRoomService.getSnapshot(),
    runtimeInfo: runtime.getInfo(),
    slashCommands: initialResources?.slashCommands ?? getSlashCommands(getPackages()),
  };
  ws.send(JSON.stringify(connectedMsg));

  const sendToClient = (message: WsServerMsg, guard?: AbortController) => {
    if (guard?.signal.aborted || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(message));
  };

  const recordAndSend = (message: WsServerMsg, guard?: AbortController) => {
    if (guard?.signal.aborted || ws.readyState !== WebSocket.OPEN) return;
    transcriptRecorder.recordServerMessage(message);
    ws.send(JSON.stringify(message));
  };

  const getActiveProjectPath = () => getAllSessions()[0]?.projectPath ?? process.cwd();

  // Handle messages
  ws.on('message', async (raw) => {
    let msg: WsClientMsg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      sendError(ws, 'Invalid JSON');
      return;
    }

    console.log('[PiServer] Received:', msg.type);

    switch (msg.type) {
      case 'ping': {
        ws.send(JSON.stringify({ type: 'pong' } satisfies WsServerMsg));
        break;
      }

      case 'session_create': {
        let preparedProject;
        try {
          preparedProject = prepareSessionProject(msg.projectPath, {
            branch: msg.branch,
            worktree: msg.worktree,
          });
        } catch (err) {
          sendError(ws, err instanceof Error ? err.message : String(err));
          break;
        }

        const createdSession = createSession(preparedProject.projectPath, {
          projectName: preparedProject.projectName,
          branch: preparedProject.branch,
        });
        setSessionModel(createdSession.id, selectedModel);
        const session = setSessionThinkingLevel(createdSession.id, getThinkingLevel()) ?? createdSession;
        ws.send(JSON.stringify({ type: 'session_created', session } satisfies WsServerMsg));
        break;
      }

      case 'session_delete': {
        const deleted = deleteSession(msg.sessionId);
        if (deleted) {
          // Abort any running agent
          const ctrl = activeResponses.get(msg.sessionId);
          if (ctrl) {
            ctrl.abort();
            activeResponses.delete(msg.sessionId);
          }
          await runtime.dispose(msg.sessionId);
          permissionBroker.abortSession(msg.sessionId);
          transcriptRecorder.clearSession(msg.sessionId);
          terminalService.stopSession(msg.sessionId);
          ws.send(JSON.stringify({ type: 'session_deleted', sessionId: msg.sessionId } satisfies WsServerMsg));
        }
        break;
      }

      case 'session_clear': {
        const session = getSession(msg.sessionId);
        if (!session) {
          sendError(ws, 'Session not found', msg.sessionId);
          break;
        }

        const ctrl = activeResponses.get(msg.sessionId);
        if (ctrl) {
          ctrl.abort();
          activeResponses.delete(msg.sessionId);
        }
        await Promise.resolve(runtime.abort(msg.sessionId)).catch(() => undefined);
        await runtime.dispose(msg.sessionId);
        permissionBroker.abortSession(msg.sessionId);
        transcriptRecorder.clearSession(msg.sessionId);
        deleteMessages(msg.sessionId);
        setSessionStatus(msg.sessionId, 'idle');
        ws.send(JSON.stringify({ type: 'session_cleared', sessionId: msg.sessionId } satisfies WsServerMsg));
        ws.send(JSON.stringify({ type: 'status', sessionId: msg.sessionId, status: 'idle' } satisfies WsServerMsg));
        break;
      }

      case 'session_rename': {
        const session = renameSession(msg.sessionId, msg.title);
        if (session) {
          ws.send(JSON.stringify({ type: 'session_updated', session } satisfies WsServerMsg));
        }
        break;
      }

      case 'session_fork': {
        const forked = forkSession(msg.sessionId, msg.entryId);
        if (!forked) {
          sendError(ws, 'Session not found', msg.sessionId);
          break;
        }
        ws.send(JSON.stringify({
          type: 'session_created',
          session: forked.session,
          messages: forked.messages,
        } satisfies WsServerMsg));
        break;
      }

      case 'session_tree_navigate': {
        const target = getSession(msg.targetId);
        if (!target) {
          sendError(ws, 'Target session not found', msg.sessionId);
        }
        break;
      }

      case 'session_compact': {
        sendToClient({ type: 'compaction_start', sessionId: msg.sessionId } satisfies WsServerMsg);
        sendToClient({ type: 'compaction_end', sessionId: msg.sessionId } satisfies WsServerMsg);
        break;
      }

      case 'prompt': {
        const session = getSession(msg.sessionId);
        if (!session) {
          sendError(ws, 'Session not found', msg.sessionId);
          break;
        }

        const prevCtrl = activeResponses.get(msg.sessionId);
        if (prevCtrl) {
          try {
            await applySessionRuntimeConfig(runtime, session, providerCatalog, selectedModel);
            transcriptRecorder.recordUserPrompt(msg.sessionId, msg.message, msg.images);
            maybeCaptureUserLearning(session, msg.message, listAgents());
            sendAutoTitleUpdate(msg.sessionId, sendToClient);
            const orchestration = prepareAgentOrchestrationPrompt({
              session,
              message: msg.message,
              agents: listAgents(),
            });
            if (!runtime.followUp) {
              throw new Error('Current runtime does not support queued follow-up prompts.');
            }
            await runtime.followUp(msg.sessionId, orchestration.message, msg.images);
          } catch (err: any) {
            captureRuntimeFailureLearning(session, err);
            sendError(ws, err.message, msg.sessionId);
          }
          break;
        }

        const abortController = new AbortController();
        activeResponses.set(msg.sessionId, abortController);
        transcriptRecorder.recordUserPrompt(msg.sessionId, msg.message, msg.images);
        maybeCaptureUserLearning(session, msg.message, listAgents());
        sendAutoTitleUpdate(msg.sessionId, sendToClient);

        try {
          await applySessionRuntimeConfig(runtime, session, providerCatalog, selectedModel);
          const orchestration = prepareAgentOrchestrationPrompt({
            session,
            message: msg.message,
            agents: listAgents(),
          });
          await runtime.prompt({
            sessionId: msg.sessionId,
            message: orchestration.message,
            images: msg.images,
          }, {
            sendMessage: (m) => {
              recordAndSend(m, abortController);
            },
            requestPermission: (request) =>
              resolvePermission(
                permissionBroker,
                permissionMode,
                msg.sessionId,
                request,
                (m) => recordAndSend(m, abortController),
                abortController.signal
              ),
          }, abortController.signal);
        } catch (err: any) {
          if (err.name !== 'AbortError') {
            captureRuntimeFailureLearning(session, err);
            setSessionStatus(msg.sessionId, 'error');
            sendToClient({ type: 'status', sessionId: msg.sessionId, status: 'error', detail: err.message } satisfies WsServerMsg);
            sendError(ws, err.message, msg.sessionId);
          }
        } finally {
          if (activeResponses.get(msg.sessionId) === abortController) {
            activeResponses.delete(msg.sessionId);
          }
        }
        break;
      }

      case 'set_permission_mode': {
        permissionMode = normalizePermissionMode(msg.mode);
        console.log('[PiServer] Permission mode:', permissionMode);
        break;
      }

      case 'steer': {
        try {
          const session = getSession(msg.sessionId);
          if (session) {
            await applySessionRuntimeConfig(runtime, session, providerCatalog, selectedModel);
          }
          transcriptRecorder.recordUserPrompt(msg.sessionId, msg.message, msg.images);
          if (session) {
            maybeCaptureUserLearning(session, msg.message, listAgents());
          }
          sendAutoTitleUpdate(msg.sessionId, sendToClient);
          const orchestration = session
            ? prepareAgentOrchestrationPrompt({ session, message: msg.message, agents: listAgents() })
            : { message: msg.message };
          await runtime.steer?.(msg.sessionId, orchestration.message, msg.images);
        } catch (err: any) {
          const session = getSession(msg.sessionId);
          if (session) captureRuntimeFailureLearning(session, err);
          sendError(ws, err.message, msg.sessionId);
        }
        break;
      }

      case 'follow_up': {
        try {
          const session = getSession(msg.sessionId);
          if (session) {
            await applySessionRuntimeConfig(runtime, session, providerCatalog, selectedModel);
          }
          transcriptRecorder.recordUserPrompt(msg.sessionId, msg.message, msg.images);
          if (session) {
            maybeCaptureUserLearning(session, msg.message, listAgents());
          }
          sendAutoTitleUpdate(msg.sessionId, sendToClient);
          const orchestration = session
            ? prepareAgentOrchestrationPrompt({ session, message: msg.message, agents: listAgents() })
            : { message: msg.message };
          await runtime.followUp?.(msg.sessionId, orchestration.message, msg.images);
        } catch (err: any) {
          const session = getSession(msg.sessionId);
          if (session) captureRuntimeFailureLearning(session, err);
          sendError(ws, err.message, msg.sessionId);
        }
        break;
      }

      case 'stop_generation': {
        const ctrl = activeResponses.get(msg.sessionId);
        if (ctrl) {
          ctrl.abort();
          activeResponses.delete(msg.sessionId);
        }
        await runtime.abort(msg.sessionId);
        permissionBroker.abortSession(msg.sessionId);
        transcriptRecorder.completeInterrupted(msg.sessionId);
        const session = getSession(msg.sessionId);
        if (session) {
          setSessionStatus(msg.sessionId, 'idle');
          sendToClient({ type: 'status', sessionId: msg.sessionId, status: 'idle' } satisfies WsServerMsg);
        }
        break;
      }

      case 'permission_response': {
        const handled = permissionBroker.resolve(msg.sessionId, msg.response);
        if (!handled) {
          console.log('[PiServer] Stale permission response:', msg.response.requestId);
        }
        break;
      }

      case 'set_thinking_level': {
        const level = msg.sessionId ? msg.level : setThinkingLevel(msg.level);
        if (msg.sessionId) {
          const updatedSession = setSessionThinkingLevel(msg.sessionId, level);
          if (!updatedSession) {
            sendError(ws, 'Session not found', msg.sessionId);
            break;
          }
          ws.send(JSON.stringify({
            type: 'session_updated',
            session: updatedSession,
          } satisfies WsServerMsg));
        } else {
          void Promise.resolve().then(() => runtime.setThinkingLevel?.(level)).catch((err: any) => {
            sendError(ws, err.message);
          });
        }
        ws.send(JSON.stringify({
          type: 'model_updated',
          model: selectedModel,
          thinkingLevel: level,
          sessionId: msg.sessionId,
        } satisfies WsServerMsg));
        break;
      }

      case 'set_model': {
        const model = findModelInProviders(providerCatalog, msg.provider, msg.modelId)
          ?? (!msg.sessionId ? setModel(msg.modelId, msg.provider) : null);
        if (model) {
          if (msg.sessionId) {
            const updatedSession = setSessionModel(msg.sessionId, model);
            if (!updatedSession) {
              sendError(ws, 'Session not found', msg.sessionId);
              break;
            }
            ws.send(JSON.stringify({
              type: 'session_updated',
              session: updatedSession,
            } satisfies WsServerMsg));
          } else {
            try {
              await Promise.resolve(runtime.setModel?.(model.provider, model.id));
            } catch (err: any) {
              sendError(ws, err.message);
              break;
            }
            selectedModel = model;
          }
          ws.send(JSON.stringify({
            type: 'model_updated',
            model,
            thinkingLevel: getThinkingLevel(),
            sessionId: msg.sessionId,
          } satisfies WsServerMsg));
        } else {
          sendError(ws, 'Model not found');
        }
        break;
      }

      case 'auth_refresh': {
        providerCatalog = await loadProviderCatalog();
        const refreshedSelectedModel = findModelInProviders(providerCatalog, selectedModel.provider, selectedModel.id)
          ?? getCurrentModelForCatalog(providerCatalog);
        const modelChanged = refreshedSelectedModel.id !== selectedModel.id
          || refreshedSelectedModel.provider !== selectedModel.provider;
        selectedModel = refreshedSelectedModel;

        ws.send(JSON.stringify({
          type: 'providers_updated',
          providers: providerCatalog,
        } satisfies WsServerMsg));

        if (modelChanged) {
          ws.send(JSON.stringify({
            type: 'model_updated',
            model: selectedModel,
            thinkingLevel: getThinkingLevel(),
          } satisfies WsServerMsg));
        }
        break;
      }

      case 'package_install': {
        try {
          const snapshot = await extensionService.installPackage(msg.source, {
            scope: msg.scope,
            projectPath: msg.projectPath ?? getActiveProjectPath(),
            trustConfirmed: msg.trustConfirmed === true,
          });
          await runtime.dispose();
          sendResourceSnapshot(ws, snapshot);
        } catch (err) {
          sendError(ws, err instanceof Error ? err.message : String(err));
        }
        break;
      }

      case 'package_remove': {
        try {
          const snapshot = await extensionService.removePackage(msg.source, {
            scope: msg.scope,
            projectPath: msg.projectPath ?? getActiveProjectPath(),
          });
          await runtime.dispose();
          sendResourceSnapshot(ws, snapshot);
        } catch (err) {
          sendError(ws, err instanceof Error ? err.message : String(err));
        }
        break;
      }

      case 'package_update': {
        try {
          const snapshot = await extensionService.updatePackage(msg.source, {
            projectPath: msg.projectPath ?? getActiveProjectPath(),
          });
          await runtime.dispose();
          sendResourceSnapshot(ws, snapshot);
        } catch (err) {
          sendError(ws, err instanceof Error ? err.message : String(err));
        }
        break;
      }

      case 'resources_reload': {
        try {
          const snapshot = await extensionService.reload(msg.projectPath ?? getActiveProjectPath());
          await runtime.dispose();
          sendResourceSnapshot(ws, snapshot);
        } catch (err) {
          sendError(ws, err instanceof Error ? err.message : String(err));
        }
        break;
      }

      case 'theme_set': {
        console.log('[PiServer] Theme set:', msg.name);
        // In mock mode, just acknowledge
        break;
      }

      case 'terminal_start': {
        void terminalService.start(msg.sessionId, msg.terminalId, { cols: msg.cols, rows: msg.rows }, msg.replay !== false, sendToClient);
        break;
      }

      case 'terminal_input': {
        terminalService.input(msg.terminalId, msg.data);
        break;
      }

      case 'terminal_resize': {
        terminalService.resize(msg.terminalId, msg.cols, msg.rows);
        break;
      }

      case 'terminal_stop': {
        terminalService.stop(msg.terminalId);
        break;
      }

      default: {
        console.log('[PiServer] Unknown message type:', (msg as any).type);
      }
    }
  });

  ws.on('close', () => {
    console.log('[PiServer] Client disconnected');
    wsClients.delete(ws);
    // Abort all running agents
    activeResponses.forEach((ctrl, sessionId) => {
      ctrl.abort();
      permissionBroker.abortSession(sessionId);
      transcriptRecorder.completeInterrupted(sessionId);
    });
    activeResponses.clear();
    void runtime.dispose();
  });

  ws.on('error', (err) => {
    console.error('[PiServer] WebSocket error:', err);
  });
});

// Start server
httpServer.listen(PORT, HOST, () => {
  console.log(`[PiServer] Pi Agent Server running at http://${HOST}:${PORT}`);
  console.log(`[PiServer] WebSocket endpoint: ws://${HOST}:${PORT}/ws`);
  console.log(`[PiServer] Desktop auth: ${AUTH_TOKEN ? 'enabled' : 'disabled'}`);
  console.log(`[PiServer] Providers: ${getProviders().map((p) => p.id).join(', ')}`);
  console.log(`[PiServer] Current model: ${getCurrentModel().provider}/${getCurrentModel().name}`);
});

function writeJson(
  res: ServerResponse,
  req: IncomingMessage,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
    ...securityHeaders(req),
  });
  res.end(JSON.stringify(body));
}

function securityHeaders(req: IncomingMessage): Record<string, string> {
  const origin = normalizeOrigin(req.headers.origin);
  return {
    'Access-Control-Allow-Origin': AUTH_TOKEN ? (origin ?? 'null') : '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Pi-Desktop-Token, X-Pi-Channel-Token',
    'Access-Control-Max-Age': '600',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff',
  };
}

function requiresDesktopAuth(req: IncomingMessage): boolean {
  if (!AUTH_TOKEN) return false;
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (pathname === '/health') return false;
  if (/^\/api\/channels\/(?:feishu|wechat)\/[^/]+\/events$/.test(pathname)) return false;
  if (/^\/api\/channels\/[^/]+\/inbound$/.test(pathname)) return false;
  return true;
}

function isAuthorizedHttp(req: IncomingMessage): boolean {
  if (!AUTH_TOKEN) return true;
  return hasValidToken(extractBearer(req.headers.authorization))
    || hasValidToken(firstHeader(req.headers['x-pi-desktop-token']));
}

function isAuthorizedWs(req: IncomingMessage): boolean {
  if (!AUTH_TOKEN) return true;
  const url = new URL(req.url ?? '/', 'http://localhost');
  return hasValidToken(url.searchParams.get('token'))
    || hasValidToken(extractWebSocketProtocolToken(req.headers['sec-websocket-protocol']))
    || hasValidToken(extractBearer(req.headers.authorization))
    || hasValidToken(firstHeader(req.headers['x-pi-desktop-token']));
}

function hasValidToken(value: string | null | undefined): boolean {
  if (!AUTH_TOKEN) return true;
  if (!value) return false;
  const expected = Buffer.from(AUTH_TOKEN);
  const actual = Buffer.from(value);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function extractBearer(value: string | string[] | undefined): string | null {
  const header = firstHeader(value);
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || null;
}

function firstHeader(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function extractWebSocketProtocolToken(value: string | string[] | undefined): string | null {
  const header = firstHeader(value);
  if (!header) return null;
  const prefix = 'pi-agent-token.';
  for (const protocol of header.split(',')) {
    const trimmed = protocol.trim();
    if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length);
  }
  return null;
}

function isAllowedOrigin(req: IncomingMessage): boolean {
  const origin = normalizeOrigin(req.headers.origin);
  if (!origin || origin === 'null') return true;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'file:'
      || parsed.hostname === 'localhost'
      || parsed.hostname === '127.0.0.1'
      || parsed.hostname === '::1';
  } catch {
    return false;
  }
}

function normalizeOrigin(value: string | string[] | undefined): string | null {
  return firstHeader(value)?.trim() || null;
}

async function getDiagnostics() {
  const resourceSnapshot = extensionService.getCachedSnapshot(getAllSessions()[0]?.projectPath);
  return {
    ok: true,
    server: {
      pid: process.pid,
      host: HOST,
      port: PORT,
      uptimeSec: Math.round(process.uptime()),
      node: process.version,
      platform: process.platform,
      dataDir: getDataDir(),
    },
    security: {
      authEnabled: Boolean(AUTH_TOKEN),
      cors: AUTH_TOKEN ? 'loopback/file origins only' : 'development wildcard',
      publicEndpoints: [
        '/health',
        '/api/channels/feishu/:id/events',
        '/api/channels/wechat/:id/events',
        '/api/channels/:id/inbound',
      ],
    },
    runtime: {
      mode: process.env.PI_AGENT_RUNTIME || 'auto',
      permissionMode: DEFAULT_PERMISSION_MODE,
    },
    sdk: await getSdkDiagnostics(),
    counts: {
      sessions: getAllSessions().length,
      channels: channelService.listChannels().length,
      agents: listAgents().length,
      permissionRules: loadPermissionRules().length,
      permissionAuditEntries: loadPermissionAudit(500).length,
      packages: resourceSnapshot?.packages.length ?? getPackages().length,
      extensions: resourceSnapshot?.extensions.length ?? getExtensions().length,
      skills: resourceSnapshot?.skills.length ?? 0,
      prompts: resourceSnapshot?.prompts.length ?? 0,
      resourceDiagnostics: resourceSnapshot?.diagnostics.length ?? 0,
      themes: getThemes().length,
    },
    providers: getProviders().map((provider) => ({
      id: provider.id,
      name: provider.name,
      models: provider.models.length,
    })),
  };
}

async function safeResourceSnapshot(projectPath?: string): Promise<ExtensionResourceSnapshotData | null> {
  try {
    return await extensionService.getSnapshot(projectPath);
  } catch (err) {
    console.warn('[PiServer] Failed to load extension resources:', err instanceof Error ? err.message : err);
    return null;
  }
}

function sendResourceSnapshot(ws: WebSocket, snapshot: ExtensionResourceSnapshotData): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: 'packages_updated', packages: snapshot.packages } satisfies WsServerMsg));
  ws.send(JSON.stringify({ type: 'extensions_updated', extensions: snapshot.extensions } satisfies WsServerMsg));
  ws.send(JSON.stringify({ type: 'skills_updated', skills: snapshot.skills } satisfies WsServerMsg));
  ws.send(JSON.stringify({ type: 'prompts_updated', prompts: snapshot.prompts } satisfies WsServerMsg));
  ws.send(JSON.stringify({ type: 'themes_updated', themes: mergeThemes(getThemes(), snapshot.themes) } satisfies WsServerMsg));
  ws.send(JSON.stringify({ type: 'resource_diagnostics_updated', diagnostics: snapshot.diagnostics } satisfies WsServerMsg));
  ws.send(JSON.stringify({ type: 'marketplace_updated', marketplace: snapshot.marketplace } satisfies WsServerMsg));
  ws.send(JSON.stringify({ type: 'resource_trust_updated', trust: snapshot.trust } satisfies WsServerMsg));
  ws.send(JSON.stringify({ type: 'slash_commands_updated', commands: snapshot.slashCommands } satisfies WsServerMsg));
}

function mergeThemes(baseThemes: ThemeData[], resourceThemes: ThemeData[]): ThemeData[] {
  const byName = new Map<string, ThemeData>();
  for (const theme of baseThemes) byName.set(theme.name, theme);
  for (const theme of resourceThemes) {
    if (!theme.name || byName.has(theme.name)) continue;
    byName.set(theme.name, theme);
  }
  return Array.from(byName.values());
}

async function getSdkDiagnostics() {
  try {
    const sdk = await import('@earendil-works/pi-coding-agent');
    return {
      available: true,
      exports: {
        AuthStorage: typeof sdk.AuthStorage === 'function',
        ModelRegistry: typeof sdk.ModelRegistry === 'function',
      },
    };
  } catch (err) {
    return {
      available: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function sendError(ws: WebSocket, message: string, sessionId?: string) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'error', sessionId, message } satisfies WsServerMsg));
  }
}

function sendAutoTitleUpdate(sessionId: string, sendMessage: (message: WsServerMsg) => void): void {
  const session = maybeAutoTitleSession(sessionId);
  if (session) {
    sendMessage({ type: 'session_updated', session } satisfies WsServerMsg);
  }
}

async function loadProviderCatalog(): Promise<ProviderData[]> {
  try {
    const sdkProviders = await getAvailableSdkProviders();
    return sdkProviders.length > 0 ? sdkProviders : getProviders();
  } catch (err) {
    console.warn('[PiServer] Failed to load SDK provider catalog:', err instanceof Error ? err.message : err);
    return getProviders();
  }
}

function getCurrentModelForCatalog(providers: ProviderData[]): ModelData {
  const current = getCurrentModel();
  return configuredDefaultModelInProviders(providers, getAllSessions()[0]?.projectPath)
    ?? findModelInProviders(providers, current.provider, current.id)
    ?? firstModelInProviders(providers)
    ?? current;
}

async function applySessionRuntimeConfig(
  runtime: ReturnType<typeof createAgentRuntime>,
  session: SessionData,
  providers: ProviderData[],
  fallback: ModelData
): Promise<ModelData> {
  const model = getSessionModel(session, providers, fallback);
  await Promise.resolve(runtime.setModel?.(model.provider, model.id));
  await Promise.resolve(runtime.setThinkingLevel?.(getSessionThinkingLevel(session)));
  return model;
}

function resolvePermission(
  broker: PermissionBroker,
  mode: PermissionModeData,
  sessionId: string,
  request: PermissionRequestData,
  sendMessage: (msg: WsServerMsg) => void,
  signal?: AbortSignal
): Promise<PermissionAction> {
  if (mode === 'bypassPermissions') {
    broker.recordModeDecision(sessionId, request, 'allow', 'Bypass permission mode');
    return Promise.resolve('allow');
  }

  if (mode === 'acceptEdits' && isEditTool(request.toolName)) {
    broker.recordModeDecision(sessionId, request, 'allow', 'Auto-accept edits permission mode');
    return Promise.resolve('allow');
  }

  if (mode === 'plan') {
    broker.recordModeDecision(sessionId, request, 'deny', 'Plan mode blocks tool execution');
    return Promise.resolve('deny');
  }

  return broker.request(sessionId, request, sendMessage, signal);
}

function normalizePermissionMode(value: unknown): PermissionModeData {
  return value === 'acceptEdits' || value === 'plan' || value === 'bypassPermissions' || value === 'ask'
    ? value
    : 'ask';
}

function isEditTool(toolName: string): boolean {
  const normalized = toolName.toLowerCase();
  return normalized === 'edit' || normalized === 'write';
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[PiServer] Shutting down...');
  wss.close();
  httpServer.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  wss.close();
  httpServer.close();
  process.exit(0);
});
