import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getDataDir } from './persistence.js';
import type { AgentLearningRecordData } from './types.js';

type AgentLearningType = AgentLearningRecordData['type'];

export interface AgentLearningInput {
  type?: AgentLearningType;
  title?: string;
  content?: string;
  projectPath?: string;
  agentId?: string;
  tags?: string[];
  source?: AgentLearningRecordData['source'];
}

export function listAgentLearnings(projectPath?: string): AgentLearningRecordData[] {
  return readRecords(projectPath)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 100);
}

export function createAgentLearning(input: AgentLearningInput): AgentLearningRecordData {
  const projectPath = normalizeString(input.projectPath);
  const record: AgentLearningRecordData = {
    id: `learning-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: normalizeType(input.type),
    title: normalizeString(input.title) ?? 'Untitled learning',
    content: normalizeString(input.content) ?? '',
    projectPath,
    agentId: normalizeString(input.agentId),
    tags: normalizeTags(input.tags),
    createdAt: Date.now(),
    source: input.source === 'auto' ? 'auto' : 'manual',
  };

  if (!record.content) {
    throw new Error('Learning content is required.');
  }

  const records = [record, ...readRecords(projectPath)].slice(0, 500);
  writeRecords(projectPath, records);
  appendLearningMarkdown(projectPath, record);
  return record;
}

export function getRecentLearningContext(projectPath?: string, limit = 5): AgentLearningRecordData[] {
  return listAgentLearnings(projectPath).slice(0, Math.max(0, Math.min(12, limit)));
}

function readRecords(projectPath?: string): AgentLearningRecordData[] {
  const filePath = recordsPath(projectPath);
  if (!existsSync(filePath)) return [];

  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeRecord).filter((item): item is AgentLearningRecordData => Boolean(item));
  } catch (err) {
    console.warn('[PiServer] Failed to read agent learnings:', err);
    return [];
  }
}

function writeRecords(projectPath: string | undefined, records: AgentLearningRecordData[]): void {
  const filePath = recordsPath(projectPath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
  renameSync(tmp, filePath);
}

function appendLearningMarkdown(projectPath: string | undefined, record: AgentLearningRecordData): void {
  const dir = learningDir(projectPath);
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, 'agent-learnings.md');
  if (!existsSync(filePath)) {
    writeFileSync(filePath, '# Pi Agent Learnings\n\n', 'utf8');
  }
  const date = new Date(record.createdAt).toISOString();
  const tags = record.tags.length > 0 ? `\nTags: ${record.tags.join(', ')}` : '';
  appendFileSync(
    filePath,
    `## ${record.title}\n\nType: ${record.type}\nSource: ${record.source}\nCreated: ${date}${tags}\n\n${record.content}\n\n`,
    'utf8',
  );
}

function normalizeRecord(raw: unknown): AgentLearningRecordData | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Partial<AgentLearningRecordData>;
  const id = normalizeString(record.id);
  const title = normalizeString(record.title);
  const content = normalizeString(record.content);
  if (!id || !title || !content) return null;
  return {
    id,
    type: normalizeType(record.type),
    title,
    content,
    projectPath: normalizeString(record.projectPath),
    agentId: normalizeString(record.agentId),
    tags: normalizeTags(record.tags),
    createdAt: typeof record.createdAt === 'number' && Number.isFinite(record.createdAt) ? record.createdAt : Date.now(),
    source: record.source === 'auto' ? 'auto' : 'manual',
  };
}

function recordsPath(projectPath?: string): string {
  return path.join(learningDir(projectPath), 'agent-learnings.json');
}

function learningDir(projectPath?: string): string {
  const normalizedProject = normalizeString(projectPath);
  return normalizedProject
    ? path.join(path.resolve(normalizedProject), '.pi', 'learnings')
    : path.join(getDataDir(), 'learnings');
}

function normalizeType(value: unknown): AgentLearningType {
  switch (value) {
    case 'correction':
    case 'failure':
    case 'preference':
    case 'workflow':
    case 'insight':
      return value;
    default:
      return 'insight';
  }
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => normalizeString(item)).filter((item): item is string => Boolean(item)))).slice(0, 12);
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const next = value.trim();
  return next || undefined;
}
