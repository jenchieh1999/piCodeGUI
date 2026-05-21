import type { AgentRoomData } from './types.js';

export type AgentRoomPromptKind =
  | 'moderator'
  | 'research'
  | 'synthesis'
  | 'debate'
  | 'neutral_review'
  | 'final_report';

export interface AgentRoomPromptInput {
  room: AgentRoomData;
  kind: AgentRoomPromptKind;
  group?: 'left' | 'right' | 'neutral';
  agentRole?: string;
  round?: number;
  transcript?: string;
  artifacts?: string;
  previousRound?: string;
}

export interface AgentRoomPromptPair {
  systemPrompt: string;
  userPrompt: string;
}

export function buildAgentRoomPrompts(input: AgentRoomPromptInput): AgentRoomPromptPair {
  const language = detectLanguage(input.room.question);
  return {
    systemPrompt: buildSystemPrompt(input, language),
    userPrompt: buildUserPrompt(input, language),
  };
}

function buildSystemPrompt(input: AgentRoomPromptInput, language: 'zh' | 'en'): string {
  const { room } = input;
  const base = [
    'You are part of Pi Agent Desktop Agent Room, a structured multi-agent debate workflow.',
    'The room has three groups: Perspective A, Perspective B, and a review group.',
    'You must be rigorous, concrete, and useful. Avoid slogans and empty balance.',
    'When information is uncertain, state what evidence would change the conclusion.',
    'Do not claim external facts unless the prompt provides them. Treat workspace/user material as context, not absolute truth.',
    `Output language: ${language === 'zh' ? 'Simplified Chinese' : 'English'}.`,
    `Room mode: ${room.mode}.`,
    `Perspective A label: ${room.leftLabel}.`,
    `Perspective B label: ${room.rightLabel}.`,
    `Review group label: ${room.neutralLabel}.`,
  ];

  switch (input.kind) {
    case 'moderator':
      return [
        ...base,
        'Role: Moderator.',
        'Split the question into competing positions, success criteria, assumptions, and tasks.',
        'Return a concise plan with headings. Do not answer the final question yet.',
      ].join('\n');
    case 'research':
      return [
        ...base,
        `Role: ${input.group === 'left' ? room.leftLabel : room.rightLabel} ${input.agentRole ?? 'Researcher'}.`,
        'Build the strongest useful case for your assigned side.',
        'Separate claims, assumptions, risks, and evidence gaps.',
        'If no external evidence is available, explicitly mark items as hypotheses.',
      ].join('\n');
    case 'synthesis':
      return [
        ...base,
        `Role: ${input.group === 'left' ? room.leftLabel : room.rightLabel} Lead.`,
        'Synthesize your group position into a crisp, defensible argument.',
        'Prepare rebuttals to the other side. Do not ignore weaknesses in your own side.',
      ].join('\n');
    case 'debate':
      return [
        ...base,
        `Role: ${input.group === 'left' ? room.leftLabel : room.rightLabel} Debater.`,
        'Respond to the opposing side in this round.',
        'Add at least one new useful point, acknowledge valid common ground, and ask one sharp question.',
      ].join('\n');
    case 'neutral_review':
      return [
        ...base,
        'Role: Neutral fact and risk judge.',
        'Evaluate both sides for factual support, logic, execution risk, user impact, and reversibility.',
        'Do not force a 50/50 compromise. Prefer the conclusion supported by stronger reasoning.',
      ].join('\n');
    case 'final_report':
      return [
        ...base,
        'Role: Neutral synthesizer.',
        'Write the final decision report with clear recommendation, strongest arguments, risks, next actions, and confidence.',
        'Use markdown headings. Be practical and decision-oriented.',
      ].join('\n');
  }
}

function buildUserPrompt(input: AgentRoomPromptInput, language: 'zh' | 'en'): string {
  const { room } = input;
  const labels = language === 'zh'
    ? {
        question: '问题',
        context: '上下文',
        transcript: '已有讨论',
        artifacts: '资料卡',
        task: '任务',
      }
    : {
        question: 'Question',
        context: 'Context',
        transcript: 'Transcript So Far',
        artifacts: 'Artifacts',
        task: 'Task',
      };

  const common = [
    `# ${labels.question}`,
    room.question,
    '',
    `# ${labels.context}`,
    `- Project path: ${room.projectPath ?? 'not provided'}`,
    `- Debate rounds: ${room.config.debateRounds}`,
    `- Workspace search enabled: ${room.config.useWorkspaceSearch ? 'yes' : 'no'}`,
    `- Web search enabled: ${room.config.useWebSearch ? 'yes' : 'no'}`,
  ];

  const transcript = input.transcript?.trim()
    ? ['', `# ${labels.transcript}`, input.transcript.trim()]
    : [];
  const artifacts = input.artifacts?.trim()
    ? ['', `# ${labels.artifacts}`, input.artifacts.trim()]
    : [];

  return [
    ...common,
    ...transcript,
    ...artifacts,
    '',
    `# ${labels.task}`,
    buildTaskInstruction(input, language),
  ].join('\n');
}

function buildTaskInstruction(input: AgentRoomPromptInput, language: 'zh' | 'en'): string {
  const { room } = input;
  if (language === 'zh') {
    switch (input.kind) {
      case 'moderator':
        return [
          '请输出：',
          '1. 问题定义',
          `2. ${room.leftLabel} 应主张什么`,
          `3. ${room.rightLabel} 应主张什么`,
          '4. 判断标准',
          '5. 双方需要补齐的证据和风险清单',
        ].join('\n');
      case 'research':
        return [
          `请为 ${input.group === 'left' ? room.leftLabel : room.rightLabel} 生成研究卡。`,
          '包含：核心主张、支持理由、证据缺口、最大风险、下一步验证方式。',
        ].join('\n');
      case 'synthesis':
        return [
          `请为 ${input.group === 'left' ? room.leftLabel : room.rightLabel} 生成小组立场总结。`,
          '要求：观点明确、可执行、包含对对方可能反驳的回应。',
        ].join('\n');
      case 'debate':
        return [
          `这是第 ${input.round ?? 1} 轮辩论。请代表 ${input.group === 'left' ? room.leftLabel : room.rightLabel} 回应。`,
          '要求：回应对方、提出新信息、承认可成立的共同点、最后给对方一个尖锐问题。',
        ].join('\n');
      case 'neutral_review':
        return [
          '请作为综合评审组审查当前讨论。',
          '输出：事实可靠性、逻辑强弱、执行风险、可逆性、还缺哪些证据、临时倾向。',
        ].join('\n');
      case 'final_report':
        return [
          '请生成最终报告。',
          '必须包含：一句话建议、两个视角的最强论点、综合判断、行动计划、风险和回滚、置信度。',
        ].join('\n');
    }
  }

  switch (input.kind) {
    case 'moderator':
      return [
        'Return:',
        '1. Problem definition',
        `2. What ${room.leftLabel} should argue`,
        `3. What ${room.rightLabel} should argue`,
        '4. Decision criteria',
        '5. Evidence gaps and risk checklist for both sides',
      ].join('\n');
    case 'research':
      return [
        `Create a research card for ${input.group === 'left' ? room.leftLabel : room.rightLabel}.`,
        'Include core claim, supporting reasoning, evidence gaps, biggest risks, and next validation steps.',
      ].join('\n');
    case 'synthesis':
      return [
        `Create the group position summary for ${input.group === 'left' ? room.leftLabel : room.rightLabel}.`,
        'Be decisive, actionable, and include rebuttals to likely objections.',
      ].join('\n');
    case 'debate':
      return [
        `This is debate round ${input.round ?? 1}. Respond as ${input.group === 'left' ? room.leftLabel : room.rightLabel}.`,
        'Respond to the opposing side, add new information, acknowledge valid common ground, and end with one sharp question.',
      ].join('\n');
    case 'neutral_review':
      return [
        'Review the debate as the review group.',
        'Cover factual reliability, logic, execution risk, reversibility, missing evidence, and current leaning.',
      ].join('\n');
    case 'final_report':
      return [
        'Write the final report.',
        'Include recommendation, strongest arguments from both perspectives, review judgment, action plan, risks and rollback, and confidence.',
      ].join('\n');
  }
}

function detectLanguage(input: string): 'zh' | 'en' {
  return /[\u3400-\u9fff]/.test(input) ? 'zh' : 'en';
}
