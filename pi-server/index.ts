// ============================================================
// Pi Agent Server - Main Entry Point
// ============================================================

import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { WsClientMsg, WsServerMsg } from './types.js';
import {
  createSession, getAllSessions, deleteSession, renameSession, getSession,
  getCurrentModel, getProviders, getThinkingLevel, setThinkingLevel, setModel,
  getPackages, installPackage, removePackage, getExtensions, getThemes,
  simulateAgentResponse,
} from './mock-agent.js';

const PORT = parseInt(process.env.PORT ?? '1421', 10);
const HOST = process.env.HOST ?? '127.0.0.1';

// Create HTTP server
const httpServer = createServer((req, res) => {
  // Basic health check
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', sessions: getAllSessions().length }));
    return;
  }

  // Simple REST API for non-WebSocket clients
  if (req.url === '/api/sessions' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(getAllSessions()));
    return;
  }

  if (req.url === '/api/models' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({ providers: getProviders(), current: getCurrentModel() }));
    return;
  }

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

// Create WebSocket server
const wss = new WebSocketServer({ server: httpServer });

wss.on('connection', (ws: WebSocket) => {
  console.log('[PiServer] Client connected');

  // Track active agent responses per session
  const activeResponses = new Map<string, AbortController>();

  // Send initial connection data
  const connectedMsg: WsServerMsg = {
    type: 'connected',
    sessions: getAllSessions(),
    currentModel: getCurrentModel(),
    thinkingLevel: getThinkingLevel(),
  };
  ws.send(JSON.stringify(connectedMsg));

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
        const session = createSession(msg.projectPath);
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
          ws.send(JSON.stringify({ type: 'session_deleted', sessionId: msg.sessionId } satisfies WsServerMsg));
        }
        break;
      }

      case 'session_rename': {
        const session = renameSession(msg.sessionId, msg.title);
        if (session) {
          ws.send(JSON.stringify({ type: 'session_updated', session } satisfies WsServerMsg));
        }
        break;
      }

      case 'prompt': {
        const session = getSession(msg.sessionId);
        if (!session) {
          sendError(ws, 'Session not found', msg.sessionId);
          break;
        }

        // Abort any previous response for this session
        const prevCtrl = activeResponses.get(msg.sessionId);
        if (prevCtrl) prevCtrl.abort();

        const abortController = new AbortController();
        activeResponses.set(msg.sessionId, abortController);

        try {
          await simulateAgentResponse(msg.sessionId, msg.message, {
            sendMessage: (m) => {
              if (!abortController.signal.aborted) {
                ws.send(JSON.stringify(m));
              }
            },
          });
        } catch (err: any) {
          if (err.name !== 'AbortError') {
            sendError(ws, err.message, msg.sessionId);
          }
        } finally {
          activeResponses.delete(msg.sessionId);
        }
        break;
      }

      case 'stop_generation': {
        const ctrl = activeResponses.get(msg.sessionId);
        if (ctrl) {
          ctrl.abort();
          activeResponses.delete(msg.sessionId);
        }
        const session = getSession(msg.sessionId);
        if (session) {
          session.status = 'idle';
          ws.send(JSON.stringify({ type: 'status', sessionId: msg.sessionId, status: 'idle' } satisfies WsServerMsg));
        }
        break;
      }

      case 'permission_response': {
        // In mock mode, permissions are auto-handled
        console.log('[PiServer] Permission response:', msg.response);
        break;
      }

      case 'set_thinking_level': {
        const level = setThinkingLevel(msg.level);
        ws.send(JSON.stringify({
          type: 'model_updated',
          model: getCurrentModel(),
          thinkingLevel: level,
        } satisfies WsServerMsg));
        break;
      }

      case 'set_model': {
        const model = setModel(msg.modelId, msg.provider);
        if (model) {
          ws.send(JSON.stringify({
            type: 'model_updated',
            model,
            thinkingLevel: getThinkingLevel(),
          } satisfies WsServerMsg));
        } else {
          sendError(ws, 'Model not found');
        }
        break;
      }

      case 'package_install': {
        const pkg = installPackage(msg.source);
        ws.send(JSON.stringify({
          type: 'packages_updated',
          packages: getPackages(),
        } satisfies WsServerMsg));
        break;
      }

      case 'package_remove': {
        removePackage(msg.source);
        ws.send(JSON.stringify({
          type: 'packages_updated',
          packages: getPackages(),
        } satisfies WsServerMsg));
        break;
      }

      case 'theme_set': {
        console.log('[PiServer] Theme set:', msg.name);
        // In mock mode, just acknowledge
        break;
      }

      default: {
        console.log('[PiServer] Unknown message type:', (msg as any).type);
      }
    }
  });

  ws.on('close', () => {
    console.log('[PiServer] Client disconnected');
    // Abort all running agents
    activeResponses.forEach((ctrl) => ctrl.abort());
    activeResponses.clear();
  });

  ws.on('error', (err) => {
    console.error('[PiServer] WebSocket error:', err);
  });
});

// Start server
httpServer.listen(PORT, HOST, () => {
  console.log(`[PiServer] Pi Agent Server running at http://${HOST}:${PORT}`);
  console.log(`[PiServer] WebSocket endpoint: ws://${HOST}:${PORT}/ws`);
  console.log(`[PiServer] Providers: ${getProviders().map((p) => p.id).join(', ')}`);
  console.log(`[PiServer] Current model: ${getCurrentModel().provider}/${getCurrentModel().name}`);
});

function sendError(ws: WebSocket, message: string, sessionId?: string) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'error', sessionId, message } satisfies WsServerMsg));
  }
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
