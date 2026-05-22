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
        roleFocusInstruction(input.agentRole, language),
        'Build the strongest useful case for your assigned side.',
        'Separate claims, assumptions, risks, and evidence gaps.',
        'If no external evidence is available, explicitly mark items as hypotheses.',
      ].join('\n');
    case 'synthesis':
      return [
        ...base,
        `Role: ${input.group === 'left' ? room.leftLabel : room.rightLabel} ${input.agentRole ?? 'Lead'}.`,
        roleFocusInstruction(input.agentRole, language),
        'Synthesize your group position into a crisp, defensible argument.',
        'Prepare rebuttals to the other side. Do not ignore weaknesses in your own side.',
      ].join('\n');
    case 'debate':
      return [
        ...base,
        `Role: ${input.group === 'left' ? room.leftLabel : room.rightLabel} ${input.agentRole ?? 'Debater'}.`,
        roleFocusInstruction(input.agentRole, language),
        'Respond to the opposing side in this round.',
        'Add at least one new useful point, acknowledge valid common ground, and ask one sharp question.',
      ].join('\n');
    case 'neutral_review':
      return [
        ...base,
        `Role: ${room.neutralLabel} ${input.agentRole ?? 'Review Judge'}.`,
        roleFocusInstruction(input.agentRole, language),
        'Evaluate both sides for factual support, logic, execution risk, user impact, and reversibility.',
        'Do not force a 50/50 compromise. Prefer the conclusion supported by stronger reasoning.',
      ].join('\n');
    case 'final_report':
      return [
        ...base,
        `Role: ${room.neutralLabel} ${input.agentRole ?? 'Neutral synthesizer'}.`,
        roleFocusInstruction(input.agentRole, language),
        'Write the final decision report with clear recommendation, strongest arguments, risks, next actions, and confidence.',
        'Use markdown headings. Be practical and decision-oriented.',
      ].join('\n');
  }
}

function roleFocusInstruction(agentRole: string | undefined, language: 'zh' | 'en'): string {
  const role = (agentRole ?? '').toLowerCase();
  const zh = language === 'zh';
  if (role.includes('searcher')) {
    return zh
      ? '角色重点：寻找可用资料、假设、证据缺口和需要继续验证的问题，不要急着下结论。'
      : 'Role focus: find usable material, assumptions, evidence gaps, and questions that need more validation. Do not conclude too early.';
  }
  if (role.includes('reader')) {
    return zh
      ? '角色重点：阅读并压缩已有资料，区分事实、推断、风险和未知项。'
      : 'Role focus: read and compress existing material, separating facts, inferences, risks, and unknowns.';
  }
  if (role.includes('organizer')) {
    return zh
      ? '角色重点：去重、归类、整理证据卡，指出哪些材料最值得进入后续讨论。'
      : 'Role focus: deduplicate and organize evidence cards, then identify which material deserves later discussion.';
  }
  if (role.includes('argument')) {
    return zh
      ? '角色重点：构造本组最强论证，给出可执行理由、边界条件和可验证指标。'
      : 'Role focus: build the strongest argument for this group, including actionable reasoning, boundaries, and validation metrics.';
  }
  if (role.includes('counterargument')) {
    return zh
      ? '角色重点：提前准备对反方质疑的回应，也指出本组最脆弱的地方。'
      : 'Role focus: prepare responses to opposing objections and identify this group’s weakest points.';
  }
  if (role.includes('fact')) {
    return zh
      ? '角色重点：判断证据可靠性、缺失事实和可能被误读的数据。'
      : 'Role focus: judge evidence reliability, missing facts, and data that may be misread.';
  }
  if (role.includes('logic')) {
    return zh
      ? '角色重点：检查推理链条、矛盾、偷换概念和没有证据支撑的跳跃。'
      : 'Role focus: check reasoning chains, contradictions, equivocation, and unsupported leaps.';
  }
  if (role.includes('risk')) {
    return zh
      ? '角色重点：评估成本、失败模式、可逆性、发布风险和回滚策略。'
      : 'Role focus: evaluate cost, failure modes, reversibility, release risk, and rollback strategy.';
  }
  if (role.includes('product')) {
    return zh
      ? '角色重点：评估用户体验、采用阻力、学习成本和长期产品影响。'
      : 'Role focus: evaluate user experience, adoption friction, learning cost, and long-term product impact.';
  }
  if (role.includes('synthesizer')) {
    return zh
      ? '角色重点：综合所有节点，给出非折中的清晰建议和可执行下一步。'
      : 'Role focus: synthesize all nodes into a clear, non-performative recommendation and actionable next steps.';
  }
  return zh
    ? '角色重点：输出结构化、可验证、可执行的内容。'
    : 'Role focus: produce structured, verifiable, actionable output.';
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
  const promptLabels = language === 'zh'
    ? {
        question: '问题',
        context: '上下文',
        transcript: '已有讨论',
        artifacts: '资料卡',
        task: '任务',
      }
    : labels;

  const common = [
    `# ${promptLabels.question}`,
    room.question,
    '',
    `# ${promptLabels.context}`,
    `- Project path: ${room.projectPath ?? 'not provided'}`,
    `- Debate rounds: ${room.config.debateRounds}`,
    `- Workspace search enabled: ${room.config.useWorkspaceSearch ? 'yes' : 'no'}`,
    `- Web search enabled: ${room.config.useWebSearch ? 'yes' : 'no'}`,
  ];

  const transcript = input.transcript?.trim()
    ? ['', `# ${promptLabels.transcript}`, input.transcript.trim()]
    : [];
  const artifacts = input.artifacts?.trim()
    ? ['', `# ${promptLabels.artifacts}`, input.artifacts.trim()]
    : [];

  return [
    ...common,
    ...transcript,
    ...artifacts,
    '',
    `# ${promptLabels.task}`,
    buildTaskInstruction(input, language),
  ].join('\n');
}

function buildTaskInstruction(input: AgentRoomPromptInput, language: 'zh' | 'en'): string {
  const { room } = input;
  if (language === 'zh') {
    return buildChineseTaskInstruction(input);
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

function buildChineseTaskInstruction(input: AgentRoomPromptInput): string {
  const { room } = input;
  const groupLabel = input.group === 'left' ? room.leftLabel : input.group === 'right' ? room.rightLabel : room.neutralLabel;
  switch (input.kind) {
    case 'moderator':
      return [
        '请输出：',
        '1. 问题定义',
        `2. ${room.leftLabel} 应该主张什么`,
        `3. ${room.rightLabel} 应该主张什么`,
        '4. 判断标准',
        '5. 双方需要补齐的证据和风险清单',
      ].join('\n');
    case 'research':
      return [
        `请作为 ${groupLabel} 的 ${input.agentRole ?? 'Researcher'} 生成资料卡。`,
        '必须包含：核心发现、可用证据、关键假设、证据缺口、最大风险、下一步验证方式。',
        '如果只能基于已有工作区材料或当前对话推断，请明确标为“假设”。',
      ].join('\n');
    case 'synthesis':
      return [
        `请作为 ${groupLabel} 的 ${input.agentRole ?? 'Lead'} 生成结构化输出。`,
        '要求：观点明确、可执行、能回应反方质疑，并说明本方最脆弱的前提。',
      ].join('\n');
    case 'debate':
      return [
        `这是第 ${input.round ?? 1} 轮讨论。请代表 ${groupLabel} 回应。`,
        '要求：回应对方、提出新信息、承认可成立的共同点，最后给对方一个尖锐但具体的问题。',
      ].join('\n');
    case 'neutral_review':
      return [
        `请作为 ${room.neutralLabel} 的 ${input.agentRole ?? 'Review Judge'} 审查当前讨论。`,
        '输出必须覆盖：事实可靠性、逻辑强弱、执行风险、用户影响、可逆性、仍缺少的证据、临时倾向。',
      ].join('\n');
    case 'final_report':
      return [
        '请生成最终 Markdown 报告。',
        '必须包含：一句话建议、两个视角的最强论点、综合判断、行动计划、风险和回滚、置信度。',
        '不要为了平衡而折中；结论应跟随证据和推理强度。',
      ].join('\n');
  }
}

function detectLanguage(input: string): 'zh' | 'en' {
  return /[\u3400-\u9fff]/.test(input) ? 'zh' : 'en';
}
