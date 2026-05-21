import { createAgentLearning, getRecentLearningContext } from './agent-learning-service.js';
import type { AgentConfigData, AgentLearningRecordData, AgentRoleData, SessionData } from './types.js';

interface AgentOrchestrationInput {
  session: SessionData;
  message: string;
  agents: AgentConfigData[];
}

export interface AgentOrchestrationResult {
  message: string;
  active: boolean;
  reason: string;
  selectedAgents: Array<{ id: string; name: string; role: AgentRoleData; virtual: boolean }>;
  learningCount: number;
}

interface AgentCandidate {
  id: string;
  name: string;
  role: AgentRoleData;
  description: string;
  systemPrompt?: string;
  triggers: string[];
  outputContract: string;
  reviewRequired: boolean;
  virtual: boolean;
}

const COMPLEXITY_PATTERNS = [
  /实现|开发|修复|重构|测试|审查|调试|发布|打包|迁移|架构|方案|计划|完善|补齐|拉平|对齐|性能|安全|多步骤/,
  /implement|build|develop|fix|debug|refactor|review|test|release|package|migrate|architecture|plan|design|security|performance/i,
];

const FAILURE_PATTERNS = [
  /失败|报错|错误|断连|黑屏|没生效|不对|不是这样|无法|不能|卡住/,
  /fail|failed|error|wrong|broken|black screen|disconnect|not working|cannot|can't/i,
];

const VIRTUAL_SUBAGENTS: AgentCandidate[] = [
  {
    id: 'virtual-planner',
    name: 'Planner',
    role: 'planner',
    description: 'Breaks ambiguous work into a compact implementation plan and dependency order.',
    triggers: ['plan', 'architecture', 'multi step', '方案', '架构', '多步骤'],
    outputContract: 'Return goals, assumptions, ordered steps, and risks.',
    reviewRequired: true,
    virtual: true,
  },
  {
    id: 'virtual-implementer',
    name: 'Implementer',
    role: 'implementer',
    description: 'Owns focused code changes and integration details.',
    triggers: ['implement', 'build', 'fix', '实现', '开发', '修复'],
    outputContract: 'Return changed areas, code-level approach, and verification commands.',
    reviewRequired: true,
    virtual: true,
  },
  {
    id: 'virtual-reviewer',
    name: 'Reviewer',
    role: 'reviewer',
    description: 'Finds regressions, missing tests, UX issues, and release blockers.',
    triggers: ['review', 'risk', 'quality', '审查', '风险', '质量'],
    outputContract: 'Return findings first, ordered by severity, with concrete files or behaviors.',
    reviewRequired: true,
    virtual: true,
  },
  {
    id: 'virtual-tester',
    name: 'Tester',
    role: 'tester',
    description: 'Designs smoke, typecheck, UI, and regression verification for the task.',
    triggers: ['test', 'verify', 'smoke', '测试', '验证', '回归'],
    outputContract: 'Return test matrix, commands, and remaining risk.',
    reviewRequired: false,
    virtual: true,
  },
  {
    id: 'virtual-documenter',
    name: 'Documenter',
    role: 'documenter',
    description: 'Keeps user-facing docs, README, release notes, and implementation notes coherent.',
    triggers: ['doc', 'readme', 'release note', '文档', '说明', '发布说明'],
    outputContract: 'Return doc updates and user-facing wording.',
    reviewRequired: false,
    virtual: true,
  },
];

export function prepareAgentOrchestrationPrompt(input: AgentOrchestrationInput): AgentOrchestrationResult {
  const original = input.message.trim();
  if (!original || original.startsWith('/')) {
    return { message: input.message, active: false, reason: 'empty-or-command', selectedAgents: [], learningCount: 0 };
  }

  const candidates = selectCandidates(input.agents, input.session.projectPath, original);
  const needsMultiAgent = shouldUseMultiAgent(original, candidates.length);
  const needsSelfImprovement = shouldUseSelfImprovement(original, input.agents, input.session.projectPath);
  const learnings = needsSelfImprovement ? getRecentLearningContext(input.session.projectPath, 5) : [];

  if (!needsMultiAgent && learnings.length === 0 && !isFailureOrCorrection(original)) {
    return { message: input.message, active: false, reason: 'simple-request', selectedAgents: [], learningCount: 0 };
  }

  const selected = needsMultiAgent
    ? selectRelevantCandidates(candidates.length > 0 ? candidates : VIRTUAL_SUBAGENTS, original).slice(0, maxParallel(input.agents))
    : [];

  const policy = buildPolicyBlock(input.session, selected, learnings, needsMultiAgent, original);
  return {
    message: `${policy}\n\n<user_request>\n${escapeXmlText(input.message)}\n</user_request>`,
    active: true,
    reason: needsMultiAgent ? 'complex-task' : 'self-improvement-context',
    selectedAgents: selected.map((agent) => ({ id: agent.id, name: agent.name, role: agent.role, virtual: agent.virtual })),
    learningCount: learnings.length,
  };
}

export function maybeCaptureUserLearning(session: SessionData, message: string, agents: AgentConfigData[]): void {
  const text = message.trim();
  if (!text || text.startsWith('/') || !isFailureOrCorrection(text)) return;
  if (!agents.some((agent) => agent.enabled && agent.selfImprovement.enabled && agent.selfImprovement.captureCorrections)) return;

  try {
    createAgentLearning({
      type: text.length > 80 || /失败|报错|错误|断连|黑屏|failed|error|broken/i.test(text) ? 'failure' : 'correction',
      title: `User feedback in ${session.projectName}`,
      content: text,
      projectPath: session.projectPath,
      tags: ['auto-captured', 'user-feedback'],
      source: 'auto',
    });
  } catch (err) {
    console.warn('[PiServer] Failed to capture agent learning:', err);
  }
}

export function captureRuntimeFailureLearning(session: SessionData, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.trim()) return;
  try {
    createAgentLearning({
      type: 'failure',
      title: `Runtime failure in ${session.projectName}`,
      content: message,
      projectPath: session.projectPath,
      tags: ['auto-captured', 'runtime-failure'],
      source: 'auto',
    });
  } catch (err) {
    console.warn('[PiServer] Failed to capture runtime failure learning:', err);
  }
}

function selectCandidates(agents: AgentConfigData[], projectPath: string, message: string): AgentCandidate[] {
  const normalizedMessage = message.toLowerCase();
  return agents
    .filter((agent) => agent.enabled && agent.subAgent.enabled && agent.subAgent.autoDelegate)
    .filter((agent) => !agent.projectPath || agent.projectPath === projectPath)
    .map<AgentCandidate>((agent) => ({
      id: agent.id,
      name: agent.name,
      role: agent.role === 'custom' ? 'subagent' : agent.role,
      description: agent.description,
      systemPrompt: agent.systemPrompt,
      triggers: agent.subAgent.triggers,
      outputContract: agent.subAgent.outputContract,
      reviewRequired: agent.subAgent.reviewRequired,
      virtual: false,
    }))
    .sort((a, b) => scoreCandidate(b, normalizedMessage) - scoreCandidate(a, normalizedMessage));
}

function selectRelevantCandidates(candidates: AgentCandidate[], message: string): AgentCandidate[] {
  const normalizedMessage = message.toLowerCase();
  const scored = candidates
    .map((agent) => ({ agent, score: scoreCandidate(agent, normalizedMessage) }))
    .sort((a, b) => b.score - a.score);
  const positive = scored.filter((item) => item.score > 0).map((item) => item.agent);
  return positive.length > 0 ? positive : scored.slice(0, 3).map((item) => item.agent);
}

function shouldUseMultiAgent(message: string, configuredCandidates: number): boolean {
  if (configuredCandidates >= 2) return COMPLEXITY_PATTERNS.some((pattern) => pattern.test(message)) || message.length > 240;
  return COMPLEXITY_PATTERNS.some((pattern) => pattern.test(message)) || message.length > 520;
}

function shouldUseSelfImprovement(message: string, agents: AgentConfigData[], projectPath: string): boolean {
  if (isFailureOrCorrection(message)) return true;
  return agents.some((agent) =>
    agent.enabled
    && agent.selfImprovement.enabled
    && agent.selfImprovement.includeRecentLearnings
    && (!agent.projectPath || agent.projectPath === projectPath)
  );
}

function isFailureOrCorrection(message: string): boolean {
  return FAILURE_PATTERNS.some((pattern) => pattern.test(message));
}

function maxParallel(agents: AgentConfigData[]): number {
  const configured = agents
    .filter((agent) => agent.enabled && agent.subAgent.enabled && agent.subAgent.autoDelegate)
    .map((agent) => agent.subAgent.maxParallel);
  return Math.max(2, Math.min(5, configured.length > 0 ? Math.max(...configured) : 4));
}

function scoreCandidate(agent: AgentCandidate, normalizedMessage: string): number {
  const roleScore = normalizedMessage.includes(agent.role) ? 2 : 0;
  const triggerScore = agent.triggers.reduce((score, trigger) => {
    const normalizedTrigger = trigger.trim().toLowerCase();
    return normalizedTrigger && normalizedMessage.includes(normalizedTrigger) ? score + 2 : score;
  }, 0);
  const nameScore = normalizedMessage.includes(agent.name.toLowerCase()) ? 2 : 0;
  const descriptionScore = agent.description
    .split(/\s+/)
    .slice(0, 12)
    .reduce((score, token) => token.length > 3 && normalizedMessage.includes(token.toLowerCase()) ? score + 1 : score, 0);
  return roleScore + triggerScore + nameScore + descriptionScore;
}

function buildPolicyBlock(
  session: SessionData,
  selected: AgentCandidate[],
  learnings: AgentLearningRecordData[],
  needsMultiAgent: boolean,
  originalMessage: string,
): string {
  const lines = [
    '<multi_agent_orchestration version="1">',
    `<session project="${escapeXmlAttr(session.projectName)}" path="${escapeXmlAttr(session.projectPath)}" />`,
    `<decision needed="${needsMultiAgent ? 'true' : 'false'}" reason="${escapeXmlAttr(inferReason(originalMessage, needsMultiAgent))}" />`,
  ];

  if (selected.length > 0) {
    lines.push('<available_subagents>');
    for (const agent of selected) {
      lines.push(`  <subagent id="${escapeXmlAttr(agent.id)}" name="${escapeXmlAttr(agent.name)}" role="${agent.role}" virtual="${agent.virtual ? 'true' : 'false'}">`);
      lines.push(`    <description>${escapeXmlText(agent.description)}</description>`);
      if (agent.systemPrompt) lines.push(`    <system_prompt>${escapeXmlText(agent.systemPrompt)}</system_prompt>`);
      lines.push(`    <output_contract>${escapeXmlText(agent.outputContract)}</output_contract>`);
      lines.push(`    <review_required>${agent.reviewRequired ? 'true' : 'false'}</review_required>`);
      lines.push('  </subagent>');
    }
    lines.push('</available_subagents>');
  }

  lines.push('<workflow>');
  lines.push('  <step>Analyze whether the request benefits from independent subagent work.</step>');
  lines.push('  <step>If useful, assign bounded subtasks to the most relevant subagents, avoiding duplicate work.</step>');
  lines.push('  <step>Synthesize the results into one coherent answer or implementation path.</step>');
  lines.push('  <step>Run a reviewer pass for risks, missing tests, and user-visible regressions before finalizing.</step>');
  lines.push('</workflow>');

  if (learnings.length > 0) {
    lines.push('<recent_self_improvement_learnings>');
    for (const learning of learnings) {
      lines.push(`  <learning type="${learning.type}" title="${escapeXmlAttr(learning.title)}">${escapeXmlText(learning.content)}</learning>`);
    }
    lines.push('</recent_self_improvement_learnings>');
  }

  lines.push('<self_improvement_policy>When the user corrects behavior or a failure occurs, extract a concise reusable lesson and prefer the newer lesson over older habits.</self_improvement_policy>');
  lines.push('</multi_agent_orchestration>');
  return lines.join('\n');
}

function inferReason(message: string, needsMultiAgent: boolean): string {
  if (needsMultiAgent) return 'complex request detected';
  if (isFailureOrCorrection(message)) return 'feedback or failure pattern detected';
  return 'recent learning context available';
}

function escapeXmlText(value: string | undefined): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeXmlAttr(value: string | undefined): string {
  return escapeXmlText(value).replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
