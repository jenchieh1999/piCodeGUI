import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import { createAgentLearning, listAgentLearnings, type AgentLearningInput } from './agent-learning-service.js';
import { getDataDir } from './persistence.js';
import type { AgentConfigData, AgentRoleData, AgentSelfImprovementConfigData, AgentSubAgentConfigData } from './types.js';

interface AgentStore {
  agents: AgentConfigData[];
}

interface AgentUpsertInput {
  name?: string;
  description?: string;
  systemPrompt?: string;
  enabled?: boolean;
  role?: AgentRoleData;
  parentAgentId?: string;
  subAgent?: Partial<AgentSubAgentConfigData>;
  selfImprovement?: Partial<AgentSelfImprovementConfigData>;
  modelProvider?: string;
  modelId?: string;
  projectPath?: string;
  channelIds?: string[];
}

export interface AgentHttpResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

const agentsPath = path.join(getDataDir(), 'agents.json');

export async function handleAgentRequest(req: IncomingMessage): Promise<AgentHttpResponse | null> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api' || parts[1] !== 'agents') return null;

  if (req.method === 'OPTIONS') {
    return { status: 204, headers: corsHeaders() };
  }

  try {
    if (parts.length === 2 && req.method === 'GET') {
      return json(200, { agents: listAgents() });
    }

    if (parts.length === 2 && req.method === 'POST') {
      const input = await readJsonBody<AgentUpsertInput>(req);
      return json(201, { agent: createAgent(input) });
    }

    if (parts.length === 3 && parts[2] === 'learnings' && req.method === 'GET') {
      return json(200, { learnings: listAgentLearnings(url.searchParams.get('projectPath') ?? undefined) });
    }

    if (parts.length === 3 && parts[2] === 'learnings' && req.method === 'POST') {
      const input = await readJsonBody<AgentLearningInput>(req);
      return json(201, { learning: createAgentLearning(input) });
    }

    if (parts.length === 3 && req.method === 'PATCH') {
      const agent = updateAgent(parts[2]!, await readJsonBody<AgentUpsertInput>(req));
      return agent ? json(200, { agent }) : json(404, { error: 'Agent not found' });
    }

    if (parts.length === 3 && req.method === 'DELETE') {
      return json(200, { deleted: deleteAgent(parts[2]!) });
    }

    return json(404, { error: 'Agent endpoint not found' });
  } catch (err) {
    return json(500, { error: err instanceof Error ? err.message : String(err) });
  }
}

export function listAgents(): AgentConfigData[] {
  return readStore().agents.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function resolveAgentForChannel(channelId: string): AgentConfigData | null {
  return listAgents()
    .filter((agent) => agent.enabled && agent.channelIds.includes(channelId))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
}

function createAgent(input: AgentUpsertInput): AgentConfigData {
  const now = Date.now();
  const agent: AgentConfigData = {
    id: `agent-${now}-${Math.random().toString(36).slice(2, 8)}`,
    name: normalizeString(input.name) || 'New Agent',
    description: normalizeString(input.description) || 'Custom routing and persona for Pi Agent.',
    systemPrompt: normalizeString(input.systemPrompt) || '',
    enabled: input.enabled !== false,
    role: normalizeRole(input.role),
    parentAgentId: normalizeString(input.parentAgentId),
    subAgent: normalizeSubAgentConfig(input.subAgent),
    selfImprovement: normalizeSelfImprovementConfig(input.selfImprovement),
    modelProvider: normalizeString(input.modelProvider),
    modelId: normalizeString(input.modelId),
    projectPath: normalizeString(input.projectPath),
    channelIds: normalizeChannelIds(input.channelIds),
    createdAt: now,
    updatedAt: now,
  };

  const agents = withExclusiveChannelAssignments([agent, ...readStore().agents], agent.id, agent.channelIds);
  writeAgents(agents);
  return agent;
}

function updateAgent(id: string, input: AgentUpsertInput): AgentConfigData | null {
  let updated: AgentConfigData | null = null;
  const now = Date.now();
  const agents = readStore().agents.map((agent) => {
    if (agent.id !== id) return agent;
    updated = {
      ...agent,
      name: input.name !== undefined ? normalizeString(input.name) || agent.name : agent.name,
      description: input.description !== undefined ? normalizeString(input.description) || '' : agent.description,
      systemPrompt: input.systemPrompt !== undefined ? normalizeString(input.systemPrompt) || '' : agent.systemPrompt,
      enabled: input.enabled !== undefined ? Boolean(input.enabled) : agent.enabled,
      role: input.role !== undefined ? normalizeRole(input.role) : agent.role,
      parentAgentId: input.parentAgentId !== undefined ? normalizeString(input.parentAgentId) : agent.parentAgentId,
      subAgent: input.subAgent !== undefined ? normalizeSubAgentConfig(input.subAgent, agent.subAgent) : agent.subAgent,
      selfImprovement: input.selfImprovement !== undefined
        ? normalizeSelfImprovementConfig(input.selfImprovement, agent.selfImprovement)
        : agent.selfImprovement,
      modelProvider: input.modelProvider !== undefined ? normalizeString(input.modelProvider) : agent.modelProvider,
      modelId: input.modelId !== undefined ? normalizeString(input.modelId) : agent.modelId,
      projectPath: input.projectPath !== undefined ? normalizeString(input.projectPath) : agent.projectPath,
      channelIds: input.channelIds !== undefined ? normalizeChannelIds(input.channelIds) : agent.channelIds,
      updatedAt: now,
    };
    return updated;
  });

  if (!updated) return null;
  const updatedAgent = updated as AgentConfigData;
  const next = input.channelIds !== undefined
    ? withExclusiveChannelAssignments(agents, id, updatedAgent.channelIds)
    : agents;
  writeAgents(next);
  return updatedAgent;
}

function deleteAgent(id: string): boolean {
  const agents = readStore().agents;
  const next = agents.filter((agent) => agent.id !== id);
  if (next.length === agents.length) return false;
  writeAgents(next);
  return true;
}

function withExclusiveChannelAssignments(
  agents: AgentConfigData[],
  ownerId: string,
  ownedChannelIds: string[],
): AgentConfigData[] {
  const owned = new Set(ownedChannelIds);
  if (owned.size === 0) return agents;

  return agents.map((agent) => {
    if (agent.id === ownerId) return agent;
    const channelIds = agent.channelIds.filter((id) => !owned.has(id));
    return channelIds.length === agent.channelIds.length
      ? agent
      : { ...agent, channelIds, updatedAt: Date.now() };
  });
}

function readStore(): AgentStore {
  if (!existsSync(agentsPath)) return { agents: [] };

  try {
    const parsed = JSON.parse(readFileSync(agentsPath, 'utf8')) as Partial<AgentStore>;
    return {
      agents: Array.isArray(parsed.agents) ? parsed.agents.map(normalizeStoredAgent).filter(Boolean) : [],
    } as AgentStore;
  } catch (err) {
    console.warn('[PiServer] Failed to read agent store:', err);
    return { agents: [] };
  }
}

function writeAgents(agents: AgentConfigData[]): void {
  mkdirSync(path.dirname(agentsPath), { recursive: true });
  const tmp = `${agentsPath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify({ agents }, null, 2)}\n`, 'utf8');
  renameSync(tmp, agentsPath);
}

function normalizeStoredAgent(raw: unknown): AgentConfigData | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Partial<AgentConfigData>;
  if (!record.id || !record.name) return null;
  return {
    id: String(record.id),
    name: normalizeString(record.name) || 'New Agent',
    description: normalizeString(record.description) || 'Custom routing and persona for Pi Agent.',
    systemPrompt: normalizeString(record.systemPrompt) || '',
    enabled: record.enabled !== false,
    role: normalizeRole(record.role),
    parentAgentId: normalizeString(record.parentAgentId),
    subAgent: normalizeSubAgentConfig(record.subAgent),
    selfImprovement: normalizeSelfImprovementConfig(record.selfImprovement),
    modelProvider: normalizeString(record.modelProvider),
    modelId: normalizeString(record.modelId),
    projectPath: normalizeString(record.projectPath),
    channelIds: normalizeChannelIds(record.channelIds),
    createdAt: normalizeNumber(record.createdAt) ?? Date.now(),
    updatedAt: normalizeNumber(record.updatedAt) ?? Date.now(),
  };
}

function normalizeChannelIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => normalizeString(item)).filter((item): item is string => Boolean(item))));
}

function normalizeRole(value: unknown): AgentRoleData {
  const role = normalizeString(value);
  switch (role) {
    case 'main':
    case 'subagent':
    case 'planner':
    case 'implementer':
    case 'reviewer':
    case 'tester':
    case 'documenter':
    case 'researcher':
    case 'custom':
      return role;
    default:
      return 'custom';
  }
}

function normalizeSubAgentConfig(
  value: unknown,
  fallback?: AgentSubAgentConfigData,
): AgentSubAgentConfigData {
  const record = value && typeof value === 'object'
    ? value as Partial<AgentSubAgentConfigData>
    : {};
  const base = fallback ?? defaultSubAgentConfig();
  return {
    enabled: record.enabled !== undefined ? Boolean(record.enabled) : base.enabled,
    autoDelegate: record.autoDelegate !== undefined ? Boolean(record.autoDelegate) : base.autoDelegate,
    triggers: normalizeStringList(record.triggers, base.triggers),
    maxParallel: clampNumber(record.maxParallel, 1, 8, base.maxParallel),
    reviewRequired: record.reviewRequired !== undefined ? Boolean(record.reviewRequired) : base.reviewRequired,
    outputContract: normalizeString(record.outputContract) ?? base.outputContract,
  };
}

function defaultSubAgentConfig(): AgentSubAgentConfigData {
  return {
    enabled: false,
    autoDelegate: true,
    triggers: ['complex task', 'implementation', 'debug', 'review', 'test'],
    maxParallel: 3,
    reviewRequired: true,
    outputContract: 'Return concise findings, changed files, risks, and verification steps.',
  };
}

function normalizeSelfImprovementConfig(
  value: unknown,
  fallback?: AgentSelfImprovementConfigData,
): AgentSelfImprovementConfigData {
  const record = value && typeof value === 'object'
    ? value as Partial<AgentSelfImprovementConfigData>
    : {};
  const base = fallback ?? defaultSelfImprovementConfig();
  return {
    enabled: record.enabled !== undefined ? Boolean(record.enabled) : base.enabled,
    captureCorrections: record.captureCorrections !== undefined ? Boolean(record.captureCorrections) : base.captureCorrections,
    captureFailures: record.captureFailures !== undefined ? Boolean(record.captureFailures) : base.captureFailures,
    projectMemory: record.projectMemory !== undefined ? Boolean(record.projectMemory) : base.projectMemory,
    includeRecentLearnings: record.includeRecentLearnings !== undefined ? Boolean(record.includeRecentLearnings) : base.includeRecentLearnings,
  };
}

function defaultSelfImprovementConfig(): AgentSelfImprovementConfigData {
  return {
    enabled: true,
    captureCorrections: true,
    captureFailures: true,
    projectMemory: true,
    includeRecentLearnings: true,
  };
}

function normalizeStringList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const next = Array.from(new Set(value.map((item) => normalizeString(item)).filter((item): item is string => Boolean(item))));
  return next.length > 0 ? next : fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const next = value.trim();
  return next || undefined;
}

function normalizeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function json(status: number, body: unknown): AgentHttpResponse {
  return { status, body, headers: corsHeaders() };
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const raw = await new Promise<string>((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
  return raw ? JSON.parse(raw) as T : {} as T;
}
