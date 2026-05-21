import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import path from 'node:path';
import { buildAgentRoomPrompts, type AgentRoomPromptKind } from './agent-room-prompts.js';
import { completeAgentRoomStep } from './agent-room-model-service.js';
import { getDataDir } from './persistence.js';
import { readWorkspaceFile, searchWorkspaceFiles } from './workspace-service.js';
import type {
  AgentRoomArtifactData,
  AgentRoomCitationData,
  AgentRoomConfigData,
  AgentRoomCreateInputData,
  AgentRoomData,
  AgentRoomGroupData,
  AgentRoomMessageData,
  AgentRoomModeData,
  AgentRoomRunData,
  AgentRoomSnapshotData,
  AgentRoomStageData,
  AgentRoomStatusData,
  AgentRoomTaskData,
  MessageContentData,
  ModelRefData,
  TokenUsageData,
  WsServerMsg,
} from './types.js';

interface AgentRoomStoreData {
  rooms: AgentRoomData[];
  runs: AgentRoomRunData[];
  messages: AgentRoomMessageData[];
  artifacts: AgentRoomArtifactData[];
  tasks: AgentRoomTaskData[];
}

interface AgentRoomServiceOptions {
  broadcast: (message: WsServerMsg) => void;
}

export interface AgentRoomHttpResponse {
  status: number;
  body?: unknown;
}

interface RunContext {
  usage: TokenUsageData;
  modelFailures: string[];
  modelSuccesses: number;
  fallbackSteps: string[];
  modelDisabledReason?: string;
}

interface GeneratedText {
  text: string;
  source: 'model' | 'fallback';
  provider?: string;
  modelId?: string;
  warning?: string;
}

type ArtifactSourceInfo = GeneratedText | {
  source: 'workspace';
  title: string;
  path?: string;
};

interface GenerateStepInput {
  room: AgentRoomData;
  runId: string;
  context: RunContext;
  kind: AgentRoomPromptKind;
  group?: 'left' | 'right' | 'neutral';
  agentRole?: string;
  round?: number;
  purpose: 'quick' | 'deep';
  fallback: string;
  signal: AbortSignal;
  maxTokens?: number;
}

const storePath = path.join(getDataDir(), 'agent-rooms.json');
const activeRuns = new Map<string, AbortController>();

const DEFAULT_CONFIG: AgentRoomConfigData = {
  debateRounds: 2,
  maxParallel: 3,
  useWebSearch: false,
  useWorkspaceSearch: true,
  persistMemory: true,
  tokenBudget: 32000,
  requirePermissionForExternalSearch: true,
  stopOnHighRiskTool: true,
};

const EMPTY_USAGE: TokenUsageData = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
};

const FALLBACK_FINAL_REPORT_LIMIT = 2;
const FALLBACK_FINAL_REPORT_RATIO = 0.35;
const TIMEOUT_DISABLE_AFTER = 2;
const DEFAULT_LEFT_LABEL = 'Perspective A Group';
const DEFAULT_RIGHT_LABEL = 'Perspective B Group';
const DEFAULT_REVIEW_LABEL = 'Review Group';

export function createAgentRoomService(options: AgentRoomServiceOptions) {
  return {
    handleRequest: (req: IncomingMessage) => handleAgentRoomRequest(req, options),
    getSnapshot,
  };
}

async function handleAgentRoomRequest(
  req: IncomingMessage,
  options: AgentRoomServiceOptions,
): Promise<AgentRoomHttpResponse | null> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api' || parts[1] !== 'agent-rooms') return null;

  try {
    if (parts.length === 2 && req.method === 'GET') {
      return json(200, getSnapshot());
    }

    if (parts.length === 2 && req.method === 'POST') {
      const room = createRoom(await readJsonBody<AgentRoomCreateInputData>(req));
      options.broadcast({ type: 'agent_room_created', room });
      return json(201, { room, snapshot: getSnapshot() });
    }

    const roomId = parts[2];
    if (!roomId) return json(404, { error: 'Agent room not found' });

    if (parts.length === 3 && req.method === 'GET') {
      const snapshot = getRoomSnapshot(roomId);
      return snapshot ? json(200, snapshot) : json(404, { error: 'Agent room not found' });
    }

    if (parts.length === 3 && req.method === 'PATCH') {
      const room = updateRoom(roomId, await readJsonBody<Partial<AgentRoomCreateInputData>>(req));
      if (!room) return json(404, { error: 'Agent room not found' });
      options.broadcast({ type: 'agent_room_updated', room });
      return json(200, { room });
    }

    if (parts.length === 3 && req.method === 'DELETE') {
      const deleted = deleteRoom(roomId);
      if (deleted) options.broadcast({ type: 'agent_room_deleted', roomId });
      return json(200, { deleted });
    }

    if (parts.length === 4 && parts[3] === 'messages' && req.method === 'GET') {
      return json(200, { messages: readStore().messages.filter((message) => message.roomId === roomId) });
    }

    if (parts.length === 4 && parts[3] === 'artifacts' && req.method === 'GET') {
      return json(200, { artifacts: readStore().artifacts.filter((artifact) => artifact.roomId === roomId) });
    }

    if (parts.length === 4 && parts[3] === 'tasks' && req.method === 'GET') {
      return json(200, { tasks: readStore().tasks.filter((task) => task.roomId === roomId) });
    }

    if (parts.length === 4 && parts[3] === 'runs' && req.method === 'POST') {
      const result = startRun(roomId, options);
      return result ? json(201, result) : json(404, { error: 'Agent room not found' });
    }

    if (parts.length === 6 && parts[3] === 'runs' && parts[5] === 'cancel' && req.method === 'POST') {
      const result = cancelRun(roomId, parts[4]!);
      if (!result) return json(404, { error: 'Agent room run not found' });
      options.broadcast({ type: 'agent_room_run_cancelled', room: result.room, run: result.run });
      return json(200, result);
    }

    return json(404, { error: 'Agent room endpoint not found' });
  } catch (err) {
    return json(500, { error: err instanceof Error ? err.message : String(err) });
  }
}

export function getSnapshot(): AgentRoomSnapshotData {
  const store = readStore();
  const rooms = [...store.rooms].sort((a, b) => b.updatedAt - a.updatedAt);
  return {
    rooms,
    runsByRoom: groupByRoom(store.runs, 'roomId'),
    messagesByRoom: groupByRoom(store.messages, 'roomId'),
    artifactsByRoom: groupByRoom(store.artifacts, 'roomId'),
    tasksByRoom: groupByRoom(store.tasks, 'roomId'),
  };
}

function getRoomSnapshot(roomId: string) {
  const store = readStore();
  const room = store.rooms.find((item) => item.id === roomId);
  if (!room) return null;
  return {
    room,
    runs: store.runs.filter((run) => run.roomId === roomId),
    messages: store.messages.filter((message) => message.roomId === roomId),
    artifacts: store.artifacts.filter((artifact) => artifact.roomId === roomId),
    tasks: store.tasks.filter((task) => task.roomId === roomId),
  };
}

function createRoom(input: AgentRoomCreateInputData): AgentRoomData {
  const now = Date.now();
  const question = normalizeString(input.question);
  if (!question) throw new Error('Question is required.');
  const room: AgentRoomData = {
    id: createId('room'),
    title: normalizeString(input.title) || inferRoomTitle(question),
    sessionId: normalizeString(input.sessionId),
    projectPath: normalizeString(input.projectPath),
    question,
    mode: normalizeMode(input.mode),
    status: 'idle',
    leftLabel: normalizeString(input.leftLabel) || DEFAULT_LEFT_LABEL,
    rightLabel: normalizeString(input.rightLabel) || DEFAULT_RIGHT_LABEL,
    neutralLabel: normalizeString(input.neutralLabel) || DEFAULT_REVIEW_LABEL,
    config: normalizeConfig(input),
    createdAt: now,
    updatedAt: now,
  };
  const store = readStore();
  store.rooms = [room, ...store.rooms];
  writeStore(store);
  return room;
}

function updateRoom(roomId: string, input: Partial<AgentRoomCreateInputData>): AgentRoomData | null {
  const store = readStore();
  let updated: AgentRoomData | null = null;
  store.rooms = store.rooms.map((room) => {
    if (room.id !== roomId) return room;
    updated = {
      ...room,
      title: input.title !== undefined ? normalizeString(input.title) || room.title : room.title,
      question: input.question !== undefined ? normalizeString(input.question) || room.question : room.question,
      mode: input.mode !== undefined ? normalizeMode(input.mode) : room.mode,
      leftLabel: input.leftLabel !== undefined ? normalizeString(input.leftLabel) || room.leftLabel : room.leftLabel,
      rightLabel: input.rightLabel !== undefined ? normalizeString(input.rightLabel) || room.rightLabel : room.rightLabel,
      neutralLabel: input.neutralLabel !== undefined ? normalizeString(input.neutralLabel) || room.neutralLabel : room.neutralLabel,
      config: normalizeConfig({ ...room.config, ...input }),
      updatedAt: Date.now(),
    };
    return updated;
  });
  if (!updated) return null;
  writeStore(store);
  return updated;
}

function deleteRoom(roomId: string): boolean {
  const store = readStore();
  const before = store.rooms.length;
  const runs = store.runs.filter((run) => run.roomId === roomId);
  for (const run of runs) {
    activeRuns.get(run.id)?.abort();
    activeRuns.delete(run.id);
  }
  store.rooms = store.rooms.filter((room) => room.id !== roomId);
  store.runs = store.runs.filter((run) => run.roomId !== roomId);
  store.messages = store.messages.filter((message) => message.roomId !== roomId);
  store.artifacts = store.artifacts.filter((artifact) => artifact.roomId !== roomId);
  store.tasks = store.tasks.filter((task) => task.roomId !== roomId);
  writeStore(store);
  return store.rooms.length !== before;
}

function startRun(roomId: string, options: AgentRoomServiceOptions): { room: AgentRoomData; run: AgentRoomRunData } | null {
  const store = readStore();
  const room = store.rooms.find((item) => item.id === roomId);
  if (!room) return null;

  for (const run of store.runs.filter((item) => item.roomId === roomId && item.status === 'running')) {
    activeRuns.get(run.id)?.abort();
    run.status = 'cancelled';
    run.completedAt = Date.now();
  }

  const now = Date.now();
  const run: AgentRoomRunData = {
    id: createId('run'),
    roomId,
    status: 'running',
    currentStage: 'intake',
    currentRound: 0,
    startedAt: now,
  };
  room.status = 'planning';
  room.updatedAt = now;
  store.runs = [run, ...store.runs];
  writeStore(store);

  const abortController = new AbortController();
  activeRuns.set(run.id, abortController);
  options.broadcast({ type: 'agent_room_run_started', room, run });
  void runAgentRoom(room.id, run.id, options, abortController.signal)
    .catch((err) => {
      if ((err as Error).name === 'AbortError') return;
      failRun(room.id, run.id, err instanceof Error ? err.message : String(err), options);
    })
    .finally(() => {
      activeRuns.delete(run.id);
    });

  return { room, run };
}

function cancelRun(roomId: string, runId: string): { room: AgentRoomData; run: AgentRoomRunData } | null {
  activeRuns.get(runId)?.abort();
  activeRuns.delete(runId);
  const store = readStore();
  const room = store.rooms.find((item) => item.id === roomId);
  const run = store.runs.find((item) => item.id === runId && item.roomId === roomId);
  if (!room || !run) return null;
  run.status = 'cancelled';
  run.completedAt = Date.now();
  room.status = 'cancelled';
  room.updatedAt = Date.now();
  writeStore(store);
  return { room, run };
}

async function runAgentRoom(
  roomId: string,
  runId: string,
  options: AgentRoomServiceOptions,
  signal: AbortSignal,
): Promise<void> {
  const room = currentRoom(roomId);
  if (!room) return;
  const context: RunContext = { usage: { ...EMPTY_USAGE }, modelFailures: [], modelSuccesses: 0, fallbackSteps: [] };

  await setStage(roomId, runId, 'planning', 'planning', options, signal);
  const moderator = await generateStep({
    room,
    runId,
    context,
    kind: 'moderator',
    purpose: 'quick',
    fallback: fallbackModeratorPlan(room),
    signal,
    maxTokens: 1800,
  });
  addMessage(roomId, runId, 'moderator', 'Moderator', '主持人', 'planning', withFallbackNote(moderator), options);
  collectWorkspaceEvidence(room, runId, options);

  await sleep(160, signal);
  await setStage(roomId, runId, 'left_research', 'researching', options, signal);
  await completeResearchTask(room, runId, 'left', 'Searcher', '机会视角资料与假设梳理', context, options, signal);

  await setStage(roomId, runId, 'right_research', 'researching', options, signal);
  await completeResearchTask(room, runId, 'right', 'Searcher', '风险视角资料与假设梳理', context, options, signal);

  await setStage(roomId, runId, 'left_synthesis', 'researching', options, signal);
  const leftSynthesis = await generateStep({
    room,
    runId,
    context,
    kind: 'synthesis',
    group: 'left',
    purpose: 'deep',
    fallback: fallbackSynthesis(room, 'left'),
    signal,
  });
  const leftArtifact = addArtifact(
    roomId,
    runId,
    'left',
    'left-lead',
    'claim',
    `${room.leftLabel} 立场总结`,
    leftSynthesis.text,
    confidenceFor(leftSynthesis, 0.76),
    options,
    leftSynthesis,
  );
  addMessage(roomId, runId, 'left', `${room.leftLabel} Lead`, '小组负责人', 'left_synthesis', withFallbackNote(leftSynthesis), options);

  await sleep(160, signal);
  await setStage(roomId, runId, 'right_synthesis', 'researching', options, signal);
  const rightSynthesis = await generateStep({
    room,
    runId,
    context,
    kind: 'synthesis',
    group: 'right',
    purpose: 'deep',
    fallback: fallbackSynthesis(room, 'right'),
    signal,
  });
  const rightArtifact = addArtifact(
    roomId,
    runId,
    'right',
    'right-lead',
    'counterclaim',
    `${room.rightLabel} 立场总结`,
    rightSynthesis.text,
    confidenceFor(rightSynthesis, 0.76),
    options,
    rightSynthesis,
  );
  addMessage(roomId, runId, 'right', `${room.rightLabel} Lead`, '小组负责人', 'right_synthesis', withFallbackNote(rightSynthesis), options);

  const rounds = Math.max(1, Math.min(5, room.config.debateRounds));
  for (let round = 1; round <= rounds; round++) {
    await sleep(120, signal);
    await setStage(roomId, runId, 'debate', 'debating', options, signal, round);
    const leftDebate = await generateStep({
      room,
      runId,
      context,
      kind: 'debate',
      group: 'left',
      round,
      purpose: 'deep',
      fallback: fallbackDebate(room, 'left', round),
      signal,
      maxTokens: 1800,
    });
    addMessage(roomId, runId, 'left', `${room.leftLabel} Debater`, '辩论 Agent', 'debate', withFallbackNote(leftDebate), options, round);

    await sleep(120, signal);
    const rightDebate = await generateStep({
      room,
      runId,
      context,
      kind: 'debate',
      group: 'right',
      round,
      purpose: 'deep',
      fallback: fallbackDebate(room, 'right', round),
      signal,
      maxTokens: 1800,
    });
    addMessage(roomId, runId, 'right', `${room.rightLabel} Debater`, '辩论 Agent', 'debate', withFallbackNote(rightDebate), options, round);
    options.broadcast({ type: 'agent_room_debate_round_completed', roomId, runId, round });
  }

  await sleep(160, signal);
  await setStage(roomId, runId, 'neutral_review', 'reviewing', options, signal);
  const neutralReview = await generateStep({
    room,
    runId,
    context,
    kind: 'neutral_review',
    group: 'neutral',
    purpose: 'deep',
    fallback: fallbackNeutralReview(room),
    signal,
  });
  const riskArtifact = addArtifact(
    roomId,
    runId,
    'neutral',
    'neutral-risk',
    'risk',
    '综合风险评估',
    neutralReview.text,
    confidenceFor(neutralReview, 0.82),
    options,
    neutralReview,
  );
  addMessage(roomId, runId, 'neutral', `${room.neutralLabel} Fact Judge`, '综合评审', 'neutral_review', withFallbackNote(neutralReview), options);

  await sleep(160, signal);
  await setStage(roomId, runId, 'final_report', 'reviewing', options, signal);
  const shouldDegradeFinal = shouldUseReliabilityReport(context);
  const generatedFinalReport = shouldDegradeFinal
    ? {
        text: fallbackReliabilityReport(room, context),
        source: 'fallback' as const,
        warning: reliabilityWarning(context),
      }
    : await generateStep({
        room,
        runId,
        context,
        kind: 'final_report',
        group: 'neutral',
        purpose: 'deep',
        fallback: fallbackFinalReport(room, context),
        signal,
        maxTokens: 4200,
      });
  const finalReport = withReliabilityNotice(generatedFinalReport, context, shouldDegradeFinal);
  const final = addArtifact(
    roomId,
    runId,
    'neutral',
    'neutral-final',
    'final_report',
    'Agents 聊天室最终报告',
    finalReport.text,
    confidenceFor(finalReport, shouldDegradeFinal ? 0.4 : 0.84),
    options,
    finalReport,
  );
  addMessage(roomId, runId, 'neutral', `${room.neutralLabel} Synthesizer`, '最终总结', 'final_report', withFallbackNote(finalReport), options);
  options.broadcast({ type: 'agent_room_final_report_ready', roomId, runId, artifact: final });

  completeRun(roomId, runId, options, context.usage, reliabilityWarning(context), final.id, riskArtifact.id, leftArtifact.id, rightArtifact.id);
}

async function completeResearchTask(
  room: AgentRoomData,
  runId: string,
  group: 'left' | 'right',
  agentRole: string,
  title: string,
  context: RunContext,
  options: AgentRoomServiceOptions,
  signal: AbortSignal,
): Promise<void> {
  const prompt = `${title}\n\n问题：${room.question}`;
  const task = addTask(room.id, runId, group, agentRole, title, prompt, options);
  await sleep(120, signal);
  const generated = await generateStep({
    room,
    runId,
    context,
    kind: 'research',
    group,
    agentRole,
    purpose: 'quick',
    fallback: fallbackResearch(room, group),
    signal,
    maxTokens: 1800,
  });
  const artifact = addArtifact(
    room.id,
    runId,
    group,
    `${group}-${agentRole.toLowerCase()}`,
    'evidence',
    title,
    generated.text,
    confidenceFor(generated, 0.72),
    options,
    generated,
  );
  addMessage(
    room.id,
    runId,
    group,
    `${group === 'left' ? room.leftLabel : room.rightLabel} ${agentRole}`,
    agentRole,
    group === 'left' ? 'left_research' : 'right_research',
    withFallbackNote(generated),
    options,
  );
  finishTask(task.id, [artifact.id], options);
  await sleep(120, signal);
}

function collectWorkspaceEvidence(
  room: AgentRoomData,
  runId: string,
  options: AgentRoomServiceOptions,
): AgentRoomArtifactData | null {
  if (!room.config.useWorkspaceSearch || !room.sessionId) return null;

  const snippets = collectWorkspaceSnippets(room);
  if (snippets.length === 0) return null;

  const content = [
    '以下内容来自当前工作区的自动摘录，用作 Agent Room 的背景资料。它们只代表本地文件内容片段，不等于最终事实判断。',
    '',
    ...snippets.map((snippet) => [
      `## ${snippet.path}`,
      snippet.content,
      snippet.truncated ? '\n> 片段已截断。' : '',
    ].join('\n')),
  ].join('\n\n');

  const artifact = addArtifact(
    room.id,
    runId,
    'neutral',
    'workspace-reader',
    'evidence',
    '工作区证据摘录',
    content,
    0.7,
    options,
    {
      source: 'workspace',
      title: `Workspace snippets (${snippets.length})`,
      path: room.projectPath,
    },
  );
  addMessage(
    room.id,
    runId,
    'neutral',
    'Workspace Reader',
    '工作区资料整理',
    'planning',
    `已从当前工作区加入 ${snippets.length} 个文件片段作为证据背景。`,
    options,
  );
  return artifact;
}

function collectWorkspaceSnippets(room: AgentRoomData): Array<{ path: string; content: string; truncated: boolean }> {
  if (!room.sessionId) return [];
  const candidates = new Map<string, number>();
  const queries = buildWorkspaceEvidenceQueries(room.question);

  for (const [queryIndex, query] of queries.entries()) {
    const result = searchWorkspaceFiles(room.sessionId, query);
    if (result.state !== 'ok') continue;
    for (const [fileIndex, file] of result.files.slice(0, 18).entries()) {
      if (!isUsefulEvidencePath(file.path)) continue;
      const previous = candidates.get(file.path) ?? Number.POSITIVE_INFINITY;
      candidates.set(file.path, Math.min(previous, queryIndex * 20 + fileIndex));
    }
  }

  if (candidates.size === 0) {
    const result = searchWorkspaceFiles(room.sessionId, '');
    if (result.state === 'ok') {
      for (const [fileIndex, file] of result.files.slice(0, 18).entries()) {
        if (isUsefulEvidencePath(file.path)) candidates.set(file.path, fileIndex + 100);
      }
    }
  }

  return Array.from(candidates.entries())
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .flatMap(([filePath]) => {
      const file = readWorkspaceFile(room.sessionId!, filePath);
      if (file.state !== 'ok' || file.previewType !== 'text' || !file.content?.trim()) return [];
      const content = file.content.trim();
      return [{
        path: file.path,
        content: limitText(content, 2_200),
        truncated: Boolean(file.truncated || content.length > 2_200),
      }];
    });
}

async function generateStep(input: GenerateStepInput): Promise<GeneratedText> {
  if (input.context.modelDisabledReason) {
    input.context.fallbackSteps.push(stepLabel(input));
    return {
      text: input.fallback,
      source: 'fallback',
      warning: input.context.modelDisabledReason,
    };
  }

  const prompts = buildAgentRoomPrompts({
    room: input.room,
    kind: input.kind,
    group: input.group,
    agentRole: input.agentRole,
    round: input.round,
    transcript: transcriptForRun(input.room.id, input.runId),
    artifacts: artifactSummaryForRun(input.room.id, input.runId),
  });

  try {
    const result = await completeAgentRoomStep({
      ...prompts,
      purpose: input.purpose,
      preferredModel: preferredModelFor(input.room, input.purpose),
      signal: input.signal,
      maxTokens: input.maxTokens,
    });
    addUsage(input.context.usage, result.usage);
    input.context.modelSuccesses += 1;
    return {
      text: result.text,
      source: 'model',
      provider: result.provider,
      modelId: result.modelId,
    };
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    const warning = conciseError(err);
    const label = stepLabel(input);
    input.context.modelFailures.push(`${label}: ${warning}`);
    input.context.fallbackSteps.push(label);
    if (shouldDisableModelForRun(warning) || timeoutFailureCount(input.context) >= TIMEOUT_DISABLE_AFTER) {
      input.context.modelDisabledReason = timeoutFailureCount(input.context) >= TIMEOUT_DISABLE_AFTER
        ? `Model disabled for this run after repeated timeouts: ${warning}`
        : warning;
    }
    return {
      text: input.fallback,
      source: 'fallback',
      warning,
    };
  }
}

function preferredModelFor(room: AgentRoomData, purpose: 'quick' | 'deep'): ModelRefData | undefined {
  return purpose === 'quick' ? room.config.quickModel : room.config.deepModel ?? room.config.quickModel;
}

function stepLabel(input: Pick<GenerateStepInput, 'kind' | 'group' | 'agentRole' | 'round'>): string {
  const parts: string[] = [input.kind];
  if (input.group) parts.push(input.group);
  if (input.agentRole) parts.push(input.agentRole);
  if (input.round) parts.push(`R${input.round}`);
  return parts.join('/');
}

function timeoutFailureCount(context: RunContext): number {
  return context.modelFailures.filter((item) => /timed out|timeout|aborted/i.test(item)).length;
}

function shouldUseReliabilityReport(context: RunContext): boolean {
  const totalGenerated = context.modelSuccesses + context.fallbackSteps.length;
  if (context.modelSuccesses === 0 && context.fallbackSteps.length > 0) return true;
  if (context.fallbackSteps.length >= FALLBACK_FINAL_REPORT_LIMIT && timeoutFailureCount(context) > 0) return true;
  if (totalGenerated > 0 && context.fallbackSteps.length / totalGenerated >= FALLBACK_FINAL_REPORT_RATIO) return true;
  return false;
}

function reliabilityWarning(context: RunContext): string | undefined {
  if (context.modelFailures.length === 0 && context.fallbackSteps.length === 0) return undefined;
  const failures = context.modelFailures.slice(0, 4).join('；');
  const summary = `Agent Room reliability warning: ${context.fallbackSteps.length} fallback step(s), ${context.modelSuccesses} model-backed step(s).`;
  return failures ? `${summary} ${failures}` : summary;
}

function withReliabilityNotice(result: GeneratedText, context: RunContext, degraded: boolean): GeneratedText {
  const warning = reliabilityWarning(context);
  if (!warning) return result;
  const prefix = degraded
    ? [
        '> 可靠性警告：本次 Agent Room 多个关键步骤发生模型超时或调用失败，以下不是有效辩论结论，而是运行异常说明。',
        `> 失败摘要：${warning}`,
        '',
      ].join('\n')
    : [
        '> 可靠性提示：本次 Agent Room 有部分步骤使用本地兜底内容，最终结论应以低置信度阅读。',
        `> 失败摘要：${warning}`,
        '',
      ].join('\n');
  return {
    ...result,
    text: `${prefix}${result.text}`,
    warning: result.warning ?? warning,
  };
}

function fallbackReliabilityReport(room: AgentRoomData, context: RunContext): string {
  const failures = context.modelFailures.length > 0
    ? context.modelFailures.slice(0, 8).map((failure) => `- ${failure}`)
    : ['- 未记录具体模型错误，但存在本地兜底步骤。'];
  return [
    `# ${room.title}`,
    '',
    '## 运行结论',
    '本次智能体聊天室结果不可靠，不能作为正式分析结论使用。',
    '',
    '## 原因',
    `- 模型成功步骤：${context.modelSuccesses}`,
    `- 本地兜底步骤：${context.fallbackSteps.length}`,
    `- 超时/中断次数：${timeoutFailureCount(context)}`,
    ...failures,
    '',
    '## 为什么刚才的总结会看起来不对',
    '部分 Agent 没有拿到真实模型输出，系统为了不中断流程使用了本地兜底模板继续推进。若后续总结把这些兜底模板当作真实辩论材料，就会出现空泛、跑题或结论不稳的问题。',
    '',
    '## 建议操作',
    '1. 检查当前模型是否可用，尤其是 API Key、Endpoint、模型名和网络连通性。',
    '2. 对 glm-5.1 等慢模型提高超时时间，或为 Agent Room 配置更快的 quick/deep 模型组合。',
    '3. 点击重新运行，让视角 A、视角 B 和综合评审组重新生成模型支持的论证。',
    '4. 在没有足够模型输出前，不要把本次最终报告插入主对话作为结论。',
    '',
    '## 置信度',
    '0.24。本报告只说明运行状态，不给出业务/技术决策结论。',
  ].join('\n');
}

function setStage(
  roomId: string,
  runId: string,
  stage: AgentRoomStageData,
  status: AgentRoomStatusData,
  options: AgentRoomServiceOptions,
  signal: AbortSignal,
  round = 0,
): Promise<void> {
  if (signal.aborted) throw abortError();
  const store = readStore();
  const room = store.rooms.find((item) => item.id === roomId);
  const run = store.runs.find((item) => item.id === runId);
  if (!room || !run) return Promise.resolve();
  room.status = status;
  room.updatedAt = Date.now();
  run.status = 'running';
  run.currentStage = stage;
  run.currentRound = round;
  writeStore(store);
  options.broadcast({ type: 'agent_room_stage_changed', roomId, runId, stage, status, round });
  options.broadcast({ type: 'agent_room_run_updated', room, run });
  return Promise.resolve();
}

function addTask(
  roomId: string,
  runId: string,
  group: 'left' | 'right' | 'neutral',
  agentRole: string,
  title: string,
  prompt: string,
  options: AgentRoomServiceOptions,
): AgentRoomTaskData {
  const task: AgentRoomTaskData = {
    id: createId('task'),
    roomId,
    runId,
    group,
    agentRole,
    title,
    prompt,
    status: 'running',
    dependencies: [],
    outputArtifactIds: [],
    startedAt: Date.now(),
  };
  const store = readStore();
  store.tasks.push(task);
  writeStore(store);
  options.broadcast({ type: 'agent_room_task_started', task });
  return task;
}

function finishTask(taskId: string, outputArtifactIds: string[], options: AgentRoomServiceOptions): void {
  const store = readStore();
  const task = store.tasks.find((item) => item.id === taskId);
  if (!task) return;
  task.status = 'completed';
  task.outputArtifactIds = outputArtifactIds;
  task.completedAt = Date.now();
  writeStore(store);
  options.broadcast({ type: 'agent_room_task_completed', task });
}

function addMessage(
  roomId: string,
  runId: string,
  group: AgentRoomGroupData,
  agentName: string,
  role: string,
  stage: AgentRoomStageData,
  text: string,
  options: AgentRoomServiceOptions,
  round?: number,
): AgentRoomMessageData {
  const message: AgentRoomMessageData = {
    id: createId('msg'),
    roomId,
    runId,
    group,
    agentId: agentIdFromName(agentName),
    agentName,
    role,
    stage,
    round,
    content: textContent(text),
    artifactIds: [],
    timestamp: Date.now(),
  };
  const store = readStore();
  store.messages.push(message);
  writeStore(store);
  options.broadcast({ type: 'agent_room_message_added', message });
  return message;
}

function addArtifact(
  roomId: string,
  runId: string,
  group: 'left' | 'right' | 'neutral',
  agentId: string,
  type: AgentRoomArtifactData['type'],
  title: string,
  content: string,
  confidence: number,
  options: AgentRoomServiceOptions,
  source?: ArtifactSourceInfo,
): AgentRoomArtifactData {
  const artifact: AgentRoomArtifactData = {
    id: createId('artifact'),
    roomId,
    runId,
    group,
    agentId,
    type,
    title,
    content,
    citations: sourceCitation(source),
    confidence,
    createdAt: Date.now(),
  };
  const store = readStore();
  store.artifacts.push(artifact);
  writeStore(store);
  options.broadcast({ type: 'agent_room_artifact_added', artifact });
  return artifact;
}

function completeRun(
  roomId: string,
  runId: string,
  options: AgentRoomServiceOptions,
  usage: TokenUsageData,
  warning?: string,
  ...artifactIds: string[]
): void {
  const store = readStore();
  const room = store.rooms.find((item) => item.id === roomId);
  const run = store.runs.find((item) => item.id === runId);
  if (!room || !run) return;
  room.status = 'completed';
  room.updatedAt = Date.now();
  run.status = 'completed';
  run.currentStage = 'memory';
  run.completedAt = Date.now();
  run.tokenUsage = usage;
  run.error = warning || undefined;
  const message = store.messages.find((item) => item.roomId === roomId && item.runId === runId && item.stage === 'final_report');
  if (message) message.artifactIds = artifactIds.filter(Boolean);
  writeStore(store);
  options.broadcast({ type: 'agent_room_run_updated', room, run });
  options.broadcast({ type: 'agent_room_updated', room });
}

function failRun(roomId: string, runId: string, message: string, options: AgentRoomServiceOptions): void {
  const store = readStore();
  const room = store.rooms.find((item) => item.id === roomId);
  const run = store.runs.find((item) => item.id === runId);
  if (!room || !run) return;
  room.status = 'failed';
  room.updatedAt = Date.now();
  run.status = 'failed';
  run.error = message;
  run.completedAt = Date.now();
  writeStore(store);
  options.broadcast({ type: 'agent_room_run_failed', room, run, message });
}

function currentRoom(roomId: string): AgentRoomData | undefined {
  return readStore().rooms.find((item) => item.id === roomId);
}

function readStore(): AgentRoomStoreData {
  if (!existsSync(storePath)) return emptyStore();
  try {
    const parsed = JSON.parse(readFileSync(storePath, 'utf8')) as Partial<AgentRoomStoreData>;
    return {
      rooms: Array.isArray(parsed.rooms) ? parsed.rooms.filter(isRoom).map(normalizeRoomLabels) : [],
      runs: Array.isArray(parsed.runs) ? parsed.runs.filter(isRun) : [],
      messages: Array.isArray(parsed.messages) ? parsed.messages.filter(isMessage) : [],
      artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts.filter(isArtifact) : [],
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks.filter(isTask) : [],
    };
  } catch (err) {
    console.warn('[PiServer] Failed to read agent rooms:', err);
    return emptyStore();
  }
}

function writeStore(store: AgentRoomStoreData): void {
  mkdirSync(path.dirname(storePath), { recursive: true });
  const tmp = `${storePath}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
  renameSync(tmp, storePath);
}

function emptyStore(): AgentRoomStoreData {
  return { rooms: [], runs: [], messages: [], artifacts: [], tasks: [] };
}

function normalizeRoomLabels(room: AgentRoomData): AgentRoomData {
  return {
    ...room,
    leftLabel: migrateDefaultGroupLabel(room.leftLabel, DEFAULT_LEFT_LABEL),
    rightLabel: migrateDefaultGroupLabel(room.rightLabel, DEFAULT_RIGHT_LABEL),
    neutralLabel: migrateDefaultGroupLabel(room.neutralLabel, DEFAULT_REVIEW_LABEL),
  };
}

function migrateDefaultGroupLabel(value: string, fallback: string): string {
  const label = normalizeString(value);
  if (!label) return fallback;
  const legacyDefaults = new Set([
    ['Left', 'Group'].join(' '),
    ['Right', 'Group'].join(' '),
    ['Neutral', 'Group'].join(' '),
    String.fromCharCode(0x5de6, 0x6d3e, 0x96c6, 0x56e2),
    String.fromCharCode(0x53f3, 0x6d3e, 0x96c6, 0x56e2),
    String.fromCharCode(0x4e2d, 0x7acb, 0x96c6, 0x56e2),
  ]);
  return legacyDefaults.has(label) ? fallback : label;
}

function normalizeConfig(input: Partial<AgentRoomCreateInputData & AgentRoomConfigData>): AgentRoomConfigData {
  return {
    ...DEFAULT_CONFIG,
    debateRounds: clampNumber(input.debateRounds, 1, 5, DEFAULT_CONFIG.debateRounds),
    maxParallel: clampNumber(input.maxParallel, 1, 8, DEFAULT_CONFIG.maxParallel),
    quickModel: normalizeModelRef(input.quickModel),
    deepModel: normalizeModelRef(input.deepModel),
    useWebSearch: input.useWebSearch !== undefined ? Boolean(input.useWebSearch) : DEFAULT_CONFIG.useWebSearch,
    useWorkspaceSearch: input.useWorkspaceSearch !== undefined ? Boolean(input.useWorkspaceSearch) : DEFAULT_CONFIG.useWorkspaceSearch,
    persistMemory: input.persistMemory !== undefined ? Boolean(input.persistMemory) : DEFAULT_CONFIG.persistMemory,
    tokenBudget: clampNumber(input.tokenBudget, 4_000, 200_000, DEFAULT_CONFIG.tokenBudget),
    requirePermissionForExternalSearch: input.requirePermissionForExternalSearch !== undefined
      ? Boolean(input.requirePermissionForExternalSearch)
      : DEFAULT_CONFIG.requirePermissionForExternalSearch,
    stopOnHighRiskTool: input.stopOnHighRiskTool !== undefined
      ? Boolean(input.stopOnHighRiskTool)
      : DEFAULT_CONFIG.stopOnHighRiskTool,
  };
}

function normalizeMode(value: unknown): AgentRoomModeData {
  switch (value) {
    case 'technical_decision':
    case 'research':
    case 'code_review':
    case 'custom':
    case 'balanced':
      return value;
    default:
      return 'balanced';
  }
}

function normalizeModelRef(value: unknown): ModelRefData | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<ModelRefData>;
  const provider = normalizeString(candidate.provider);
  const id = normalizeString(candidate.id);
  return provider && id ? { provider, id } : undefined;
}

function textContent(text: string): MessageContentData[] {
  return [{ type: 'text', text }];
}

function groupByRoom<T extends { roomId: string }>(items: T[], key: 'roomId'): Record<string, T[]> {
  const grouped: Record<string, T[]> = {};
  for (const item of items) {
    grouped[item[key]] = [...(grouped[item[key]] ?? []), item];
  }
  return grouped;
}

function inferRoomTitle(question: string): string {
  const compact = question.replace(/\s+/g, ' ').trim();
  return compact.length > 36 ? `${compact.slice(0, 36)}...` : compact;
}

function transcriptForRun(roomId: string, runId: string): string {
  const lines = readStore().messages
    .filter((message) => message.roomId === roomId && message.runId === runId)
    .map((message) => `[${message.stage}] ${message.agentName}: ${messageText(message)}`);
  return limitText(lines.join('\n\n'), 14_000);
}

function artifactSummaryForRun(roomId: string, runId: string): string {
  const lines = readStore().artifacts
    .filter((artifact) => artifact.roomId === roomId && artifact.runId === runId)
    .map((artifact) => {
      const source = artifactSourceSummary(artifact);
      const warning = artifact.citations.some((citation) => citation.kind === 'mock')
        ? '\n> 注意：此资料卡来自本地兜底，不应作为事实证据或高置信论据。'
        : '';
      return `## ${artifact.title}\n${source}${warning}\n\n${artifact.content}`;
    });
  return limitText(lines.join('\n\n'), 10_000);
}

function artifactSourceSummary(artifact: AgentRoomArtifactData): string {
  const citation = artifact.citations[0];
  const source = citation
    ? citation.kind === 'model'
      ? `model:${citation.title}`
      : citation.kind
    : 'unknown';
  return `Source: ${source}; confidence: ${Math.round(artifact.confidence * 100)}%`;
}

function messageText(message: AgentRoomMessageData): string {
  return message.content
    .map((part) => {
      if (part.type === 'text') return part.text ?? '';
      if (part.type === 'thinking') return part.thinking?.content ?? '';
      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function sourceCitation(source?: ArtifactSourceInfo): AgentRoomCitationData[] {
  if (source?.source === 'model') {
    return [{
      id: createId('cite'),
      title: `${source.provider ?? 'model'}/${source.modelId ?? 'unknown'}`,
      source: 'agent-room-model',
      kind: 'model',
    }];
  }
  if (source?.source === 'workspace') {
    return [{
      id: createId('cite'),
      title: source.title,
      source: source.path ?? 'workspace',
      kind: 'workspace',
    }];
  }
  return [{
    id: createId('cite'),
    title: 'Local fallback',
    source: 'agent-room-fallback',
    kind: 'mock',
  }];
}

function withFallbackNote(result: GeneratedText): string {
  if (result.source === 'model') return result.text;
  const note = result.warning ? `\n\n> 本段使用本地兜底生成：${result.warning}` : '\n\n> 本段使用本地兜底生成。';
  return `${result.text}${note}`;
}

function confidenceFor(result: GeneratedText, modelConfidence: number): number {
  return result.source === 'model' ? modelConfidence : Math.min(0.68, modelConfidence - 0.16);
}

function addUsage(total: TokenUsageData, usage: TokenUsageData | undefined): void {
  if (!usage) return;
  total.input += usage.input;
  total.output += usage.output;
  total.cacheRead += usage.cacheRead;
  total.cacheWrite += usage.cacheWrite;
  total.cost += usage.cost;
}

function shouldDisableModelForRun(message: string): boolean {
  return /No configured text model|No API key|No auth|request headers configured/i.test(message);
}

function conciseError(value: unknown): string {
  if (value instanceof Error) return value.message.slice(0, 240);
  return String(value).slice(0, 240);
}

function fallbackModeratorPlan(room: AgentRoomData): string {
  if (!isChinese(room.question)) {
    return [
      '## Problem Definition',
      `We need to analyze: ${room.question}`,
      '',
      `## ${room.leftLabel}`,
      'Argue for proactive change or adoption, emphasizing long-term upside, user experience, and maintainability.',
      '',
      `## ${room.rightLabel}`,
      'Argue for caution or alternatives, emphasizing execution risk, cost, stability, and evidence gaps.',
      '',
      '## Decision Criteria',
      '- Evidence quality',
      '- Execution cost and reversibility',
      '- User impact',
      '- Operational risk',
      '- Next measurable experiment',
    ].join('\n');
  }
  return [
    '## 问题定义',
    `需要围绕「${room.question}」做结构化分析，而不是直接给出单一路径。`,
    '',
    `## ${room.leftLabel}`,
    '主张主动推进，重点看长期收益、用户体验、架构演进和可维护性。',
    '',
    `## ${room.rightLabel}`,
    '主张谨慎推进或选择替代方案，重点看执行成本、稳定性、证据缺口和回滚风险。',
    '',
    '## 判断标准',
    '- 事实和证据是否可靠',
    '- 投入成本与可逆性',
    '- 对用户体验和交互质量的影响',
    '- 对发布稳定性和团队维护负担的影响',
    '- 下一步能否设计低成本验证',
  ].join('\n');
}

function fallbackResearch(room: AgentRoomData, group: 'left' | 'right'): string {
  if (!isChinese(room.question)) {
    const label = group === 'left' ? room.leftLabel : room.rightLabel;
    return [
      `## ${label} Research Card`,
      group === 'left'
        ? 'Core claim: moving forward is worthwhile if the upside can be validated with a small reversible experiment.'
        : 'Core claim: do not scale the change until the main uncertainty and rollback path are proven.',
      '',
      '## Evidence Gaps',
      '- Real workload data',
      '- User friction or quality metrics',
      '- Maintenance and release cost',
      '',
      '## Next Validation',
      'Run a narrow pilot, define success metrics, and compare before/after outcomes.',
    ].join('\n');
  }
  const label = group === 'left' ? room.leftLabel : room.rightLabel;
  return [
    `## ${label} 研究卡`,
    group === 'left'
      ? '核心主张：如果目标收益明确，应该主动推进，但先用小规模、可回滚的试点验证关键假设。'
      : '核心主张：在证据不足或迁移成本不清晰前，不应大规模推进，应先证明瓶颈真实存在且回滚路径可靠。',
    '',
    '## 证据缺口',
    '- 真实使用场景下的效率或质量数据',
    '- 用户交互体验的痛点指标',
    '- 发布稳定性、维护成本和回滚成本',
    '',
    '## 下一步验证',
    '设计一个低风险试点，明确成功指标、失败条件和回滚方案，再决定是否扩大投入。',
  ].join('\n');
}

function fallbackSynthesis(room: AgentRoomData, group: 'left' | 'right'): string {
  const label = group === 'left' ? room.leftLabel : room.rightLabel;
  const other = group === 'left' ? room.rightLabel : room.leftLabel;
  if (!isChinese(room.question)) {
    return [
      `## ${label} Position`,
      group === 'left'
        ? 'We should move forward through a controlled pilot because the potential long-term product and engineering benefits justify a bounded experiment.'
        : 'We should avoid broad rollout until the risk, cost, and actual bottleneck are proven with measurable evidence.',
      '',
      `## Response to ${other}`,
      'The opposing concerns are valid, so the answer should be a reversible test rather than an all-in decision.',
    ].join('\n');
  }
  return [
    `## ${label} 立场`,
    group === 'left'
      ? '我们倾向推进，但不是直接全面铺开，而是通过可回滚试点验证长期收益是否成立。'
      : '我们倾向谨慎，除非能用数据证明当前方案已经成为主要瓶颈，否则不应把风险扩大到全量用户。 ',
    '',
    `## 对 ${other} 的回应`,
    '对方的担忧有价值，因此更合理的路径不是二选一，而是把争议拆成可验证指标，用试点结果决定下一步。',
  ].join('\n');
}

function fallbackDebate(room: AgentRoomData, group: 'left' | 'right', round: number): string {
  const self = group === 'left' ? room.leftLabel : room.rightLabel;
  const other = group === 'left' ? room.rightLabel : room.leftLabel;
  if (!isChinese(room.question)) {
    return [
      `Round ${round}: ${self}`,
      group === 'left'
        ? 'The cost of waiting also matters: delayed improvements can compound into worse experience and higher future maintenance.'
        : 'The cost of premature rollout also matters: unclear evidence can turn a local improvement into a release and support burden.',
      '',
      `Question for ${other}:`,
      group === 'left'
        ? 'What measurable threshold would convince you that the change deserves a broader rollout?'
        : 'What rollback and ownership plan would make the experiment safe enough?',
    ].join('\n');
  }
  return [
    `第 ${round} 轮：${self}`,
    group === 'left'
      ? '我们认为等待本身也有成本：体验问题和维护负担会持续累积，后续再修复可能更贵。'
      : '我们认为过早铺开也有成本：证据不足时，局部改动可能变成发布风险和长期支持负担。',
    '',
    `给 ${other} 的问题：`,
    group === 'left'
      ? '什么样的可量化指标能让你认可继续扩大试点？'
      : '什么样的回滚方案和责任边界能让这个试点足够安全？',
  ].join('\n');
}

function fallbackNeutralReview(room: AgentRoomData): string {
  if (!isChinese(room.question)) {
    return [
      '## Neutral Review',
      `${room.leftLabel} is stronger on long-term upside and product quality. ${room.rightLabel} is stronger on execution risk and evidence requirements.`,
      '',
      '## Judgment',
      'The best path is a bounded experiment with explicit success metrics, rollback criteria, and owner assignment.',
      '',
      '## Missing Evidence',
      '- Baseline metrics',
      '- Pilot cost',
      '- User impact after rollout',
    ].join('\n');
  }
  return [
    '## 综合评审',
    `${room.leftLabel} 在长期收益和体验质量上更强，${room.rightLabel} 在执行风险、证据要求和回滚安全上更强。`,
    '',
    '## 临时判断',
    '最优路径不是直接全面推进，也不是无限期搁置，而是做一个边界清晰、可回滚、指标明确的小规模试点。',
    '',
    '## 仍缺的证据',
    '- 当前问题的基线数据',
    '- 试点成本和维护成本',
    '- 试点后用户体验或质量指标变化',
  ].join('\n');
}

function fallbackFinalReport(room: AgentRoomData, context: RunContext): string {
  const fallbackNotice = context.modelFailures.length > 0
    ? `\n\n> 注：本次运行部分或全部步骤使用本地兜底，因为模型调用失败：${context.modelFailures.slice(0, 3).join('；')}`
    : '';
  if (!isChinese(room.question)) {
    return [
      `# ${room.title}`,
      '',
      '## Recommendation',
      'Run a small, reversible pilot first. Use measured results to decide whether to expand.',
      '',
      `## Strongest ${room.leftLabel} Argument`,
      '- Long-term user experience and maintainability may justify proactive investment.',
      '',
      `## Strongest ${room.rightLabel} Argument`,
      '- Without evidence and rollback planning, broad changes can increase release and maintenance risk.',
      '',
      '## Action Plan',
      '1. Define success metrics and failure criteria.',
      '2. Run the pilot on a narrow scope.',
      '3. Review data with both sides.',
      '4. Expand, revise, or rollback based on evidence.',
      '',
      '## Confidence',
      '0.68 for fallback analysis. Use a configured model and real workspace evidence to raise confidence.',
      fallbackNotice,
    ].join('\n');
  }
  return [
    `# ${room.title}`,
    '',
    '## 一句话建议',
    '先做小规模、可回滚、指标明确的试点，再根据数据决定是否全面推进。',
    '',
    `## ${room.leftLabel} 最强论点`,
    '- 长期体验、可维护性和产品质量收益可能值得主动投入。',
    '',
    `## ${room.rightLabel} 最强论点`,
    '- 缺少证据和回滚计划时，全面推进会放大发布风险和维护成本。',
    '',
    '## 综合结论',
    '把争论转化为实验：明确基线、成功指标、失败条件、回滚方案和负责人。',
    '',
    '## 下一步行动',
    '1. 定义 2-3 个可验证指标。',
    '2. 选择低风险范围做试点。',
    '3. 记录试点前后数据和用户反馈。',
    '4. 复盘后决定扩大、调整或回滚。',
    '',
    '## 置信度',
    '0.68。当前为本地兜底分析；接入可用模型和真实工作区证据后，结论质量会进一步提升。',
    fallbackNotice,
  ].join('\n');
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function agentIdFromName(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || createId('agent');
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const next = value.trim();
  return next || undefined;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function limitText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `...[truncated]\n${text.slice(-maxChars)}`;
}

function buildWorkspaceEvidenceQueries(question: string): string[] {
  const normalized = question.toLowerCase();
  const latinTerms = Array.from(new Set(normalized.match(/[a-z][a-z0-9_-]{2,}/g) ?? []))
    .filter((term) => !COMMON_QUERY_WORDS.has(term))
    .slice(0, 8);
  const fixed = ['readme', 'docs', 'agent', 'desktop', 'server', 'frontend'];
  return Array.from(new Set([...latinTerms, ...fixed])).slice(0, 10);
}

const COMMON_QUERY_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'this',
  'that',
  'need',
  'please',
  'help',
  'what',
  'when',
  'where',
  'how',
  'why',
]);

function isUsefulEvidencePath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  if (/(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/.test(lower)) return false;
  if (/(^|\/)(dist|build|coverage|node_modules)\//.test(lower)) return false;
  return /\.(md|mdx|txt|json|jsonc|ts|tsx|js|jsx|mjs|cjs|css|scss|html|yml|yaml|toml|rs|go|py|java|kt|swift|cs|cpp|c|h)$/i.test(lower);
}

function isChinese(text: string): boolean {
  return /[\u3400-\u9fff]/.test(text);
}

function json(status: number, body: unknown): AgentRoomHttpResponse {
  return { status, body };
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const raw = await new Promise<string>((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) reject(new Error('Request body too large'));
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
  return raw ? JSON.parse(raw) as T : {} as T;
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(abortError());
    }, { once: true });
  });
}

function abortError(): Error {
  const err = new Error('Agent room run was cancelled.');
  err.name = 'AbortError';
  return err;
}

function isRoom(value: unknown): value is AgentRoomData {
  return Boolean(value && typeof value === 'object' && typeof (value as AgentRoomData).id === 'string');
}

function isRun(value: unknown): value is AgentRoomRunData {
  return Boolean(value && typeof value === 'object' && typeof (value as AgentRoomRunData).id === 'string');
}

function isMessage(value: unknown): value is AgentRoomMessageData {
  return Boolean(value && typeof value === 'object' && typeof (value as AgentRoomMessageData).id === 'string');
}

function isArtifact(value: unknown): value is AgentRoomArtifactData {
  return Boolean(value && typeof value === 'object' && typeof (value as AgentRoomArtifactData).id === 'string');
}

function isTask(value: unknown): value is AgentRoomTaskData {
  return Boolean(value && typeof value === 'object' && typeof (value as AgentRoomTaskData).id === 'string');
}
