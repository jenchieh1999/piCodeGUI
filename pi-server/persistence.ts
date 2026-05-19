import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ChatMessageData, SessionData } from './types.js';

const DATA_DIR = resolveDataDir();
const SESSIONS_PATH = path.join(DATA_DIR, 'sessions.json');
const MESSAGES_DIR = path.join(DATA_DIR, 'messages');

export function getDataDir(): string {
  return DATA_DIR;
}

export function loadSessions(): SessionData[] {
  ensureDataDir();
  return readJsonFile<SessionData[]>(SESSIONS_PATH, []);
}

export function saveSessions(sessions: SessionData[]): void {
  ensureDataDir();
  atomicWriteJson(SESSIONS_PATH, sessions);
}

export function loadMessages(sessionId: string): ChatMessageData[] {
  ensureDataDir();
  return readJsonFile<ChatMessageData[]>(messagePath(sessionId), []);
}

export function loadMessagesBySession(sessions: SessionData[]): Record<string, ChatMessageData[]> {
  return sessions.reduce<Record<string, ChatMessageData[]>>((acc, session) => {
    const messages = loadMessages(session.id);
    if (messages.length > 0) {
      acc[session.id] = messages;
    }
    return acc;
  }, {});
}

export function appendMessage(sessionId: string, message: ChatMessageData): void {
  const messages = loadMessages(sessionId);
  messages.push(message);
  saveMessages(sessionId, messages);
}

export function replaceMessage(sessionId: string, message: ChatMessageData): void {
  const messages = loadMessages(sessionId);
  const index = messages.findIndex((m) => m.id === message.id);
  if (index >= 0) {
    messages[index] = message;
  } else {
    messages.push(message);
  }
  saveMessages(sessionId, messages);
}

export function deleteMessages(sessionId: string): void {
  const file = messagePath(sessionId);
  if (existsSync(file)) {
    rmSync(file, { force: true });
  }
}

export function saveMessages(sessionId: string, messages: ChatMessageData[]): void {
  ensureDataDir();
  atomicWriteJson(messagePath(sessionId), messages);
}

function ensureDataDir(): void {
  mkdirSync(MESSAGES_DIR, { recursive: true });
}

function readJsonFile<T>(file: string, fallback: T): T {
  if (!existsSync(file)) return fallback;

  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch (err) {
    console.warn(`[PiServer] Failed to read ${file}:`, err);
    return fallback;
  }
}

function atomicWriteJson(file: string, value: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(tmp, file);
}

function messagePath(sessionId: string): string {
  return path.join(MESSAGES_DIR, `${safeFileName(sessionId)}.json`);
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function resolveDataDir(): string {
  if (process.env.PI_DESKTOP_DATA_DIR) {
    return path.resolve(process.env.PI_DESKTOP_DATA_DIR);
  }

  const cwd = process.cwd();
  const projectRoot = path.basename(cwd).toLowerCase() === 'pi-server' ? path.dirname(cwd) : cwd;
  return path.join(projectRoot, '.pi-agent-desktop');
}
