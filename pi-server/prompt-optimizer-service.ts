import type { IncomingMessage } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Api, Model, TextContent, UserMessage } from '@earendil-works/pi-ai';
import { getAuthPath, getModelsPath } from './agent-paths.js';
import { normalizeProviderModelId } from './model-catalog.js';
import { normalizeProviderAlias } from './provider-metadata.js';
import type { PromptOptimizeInputData, PromptOptimizeResultData } from './types.js';

type PromptOptimizerHttpResponse = {
  status: number;
  body: PromptOptimizeResultData | { error: string };
};

type SdkModel = Model<Api>;
type PromptOptimizeMode = NonNullable<PromptOptimizeResultData['mode']>;
type PromptRisk = NonNullable<PromptOptimizeResultData['changedIntentRisk']>;

type PromptQualityAssessment = {
  score: number;
  risk: PromptRisk;
  warnings: string[];
};

type PromptOptimizerSkill = {
  name: string;
  instructions: string;
  sourcePath?: string;
};

const MAX_PROMPT_OPTIMIZE_CHARS = 12_000;
const MAX_PROMPT_OPTIMIZE_BODY_CHARS = 80_000;
const MAX_PROMPT_OPTIMIZER_SKILL_CHARS = 6_000;
const DEFAULT_FAST_MODEL_TIMEOUT_MS = 6_000;
const MIN_FAST_MODEL_TIMEOUT_MS = 1_000;
const MAX_FAST_MODEL_TIMEOUT_MS = 30_000;
const FAST_MODEL_TIMEOUT_MS = readPromptOptimizerTimeoutMs(process.env.PI_AGENT_PROMPT_OPTIMIZER_TIMEOUT_MS);
const FAST_MODEL_MAX_TOKENS = 1_400;
const PROMPT_ENGINEERING_SKILL_NAME = 'prompt-engineering-expert';
const BUILTIN_PROMPT_ENGINEERING_EXPERT = [
  'Optimize prompts for AI agents without answering the underlying task.',
  'Preserve user intent, language, file paths, selected text boundaries, versions, constraints, and sensitive redaction boundaries.',
  'Turn vague requests into executable instructions with context, constraints, expected output, and verification steps when helpful.',
  'For code work, make the task safe for an editing agent: inspect first, keep changes scoped, protect user edits, and require validation.',
  'For research or multi-agent work, require evidence quality, explicit assumptions, comparison dimensions, and a neutral synthesis.',
  'Keep simple prompts concise; only expand when the task needs structure.',
].join('\n');

const FAST_MODEL_KEYWORDS = [
  ['nano', 130],
  ['mini', 120],
  ['haiku', 115],
  ['flash', 110],
  ['air', 105],
  ['lite', 95],
  ['light', 90],
  ['turbo', 85],
  ['instant', 80],
  ['small', 70],
  ['speed', 65],
] as const;

const SLOW_MODEL_KEYWORDS = [
  ['opus', -120],
  ['max', -70],
  ['pro', -45],
  ['sonnet', -35],
  ['reason', -30],
  ['thinking', -30],
] as const;

const MODEL_SYSTEM_PROMPT = [
  'You are a fast prompt optimization engine embedded in Pi Agent Desktop.',
  'Rewrite the user prompt so another coding agent can act on it more reliably.',
  'Preserve the original intent, language, concrete names, file paths, versions, constraints, and user tone.',
  'Do not answer the task. Do not claim work has been completed.',
  'Add structure only when it improves execution: goal, context, constraints, steps, expected output, and verification.',
  'Avoid over-expanding simple prompts. Keep the result concise, direct, and ready to send.',
  'Return only the optimized prompt text. No explanation, no markdown fence, no prefix.',
].join('\n');

const CODE_TASK_RE = /(代码|实现|修复|调试|报错|错误|bug|测试|前端|后端|接口|仓库|项目|重构|编译|构建|发布|打包|终端|文件|code|implement|fix|debug|error|bug|test|frontend|backend|api|repo|refactor|build|release|terminal|file)/i;
const WRITING_TASK_RE = /(文档|报告|总结|翻译|润色|README|说明|doc|report|summary|translate|rewrite|polish|document)/i;
const DATA_TASK_RE = /(数据|表格|CSV|分析|统计|可视化|图表|data|analysis|chart|visuali[sz]e|statistics|table)/i;
const PRODUCT_TASK_RE = /(产品|交互|UI|UX|界面|设计|体验|视觉|布局|按钮|苹果风格|样式|product|design|interface|layout|style)/i;
const DEBUG_TASK_RE = /(报错|错误|失败|不可用|断连|崩溃|异常|日志|复现|bug|error|failed|failure|crash|exception|log|reproduce|disconnect)/i;
const REVIEW_TASK_RE = /(审查|检查|代码审查|安全问题|风险|review|audit|security|risk)/i;
const RESEARCH_TASK_RE = /(调研|研究|分析|比较|对比|差距|评估|是否|方案|必要性|research|compare|contrast|gap|evaluate|assessment|whether)/i;
const AGENT_ROOM_TASK_RE = /(智能体聊天室|多智能体|多 agents|subagents|辩论|讨论|评审组|agent room|multi-agent|debate|agents room)/i;

function readPromptOptimizerTimeoutMs(rawValue: string | undefined): number {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_FAST_MODEL_TIMEOUT_MS;
  return Math.max(MIN_FAST_MODEL_TIMEOUT_MS, Math.min(MAX_FAST_MODEL_TIMEOUT_MS, Math.round(parsed)));
}

function loadPromptOptimizerSkill(input: PromptOptimizeInputData): PromptOptimizerSkill | undefined {
  if (process.env.PI_AGENT_PROMPT_OPTIMIZER_DISABLE_SKILL === '1') return undefined;

  const explicitName = process.env.PI_AGENT_PROMPT_OPTIMIZER_SKILL?.trim();
  const explicitPath = process.env.PI_AGENT_PROMPT_OPTIMIZER_SKILL_PATH?.trim();
  const skillExplicitlyEnabled = Boolean(explicitPath) || normalizeSkillName(explicitName ?? '') === PROMPT_ENGINEERING_SKILL_NAME;
  if (!skillExplicitlyEnabled) return undefined;

  const candidates: string[] = [];
  if (explicitPath) candidates.push(explicitPath);
  if (input.projectPath) {
    candidates.push(
      path.join(input.projectPath, '.pi', 'skills', PROMPT_ENGINEERING_SKILL_NAME, 'SKILL.md'),
      path.join(input.projectPath, '.agents', 'skills', PROMPT_ENGINEERING_SKILL_NAME, 'SKILL.md')
    );
  }
  if (process.env.CODEX_HOME) {
    candidates.push(path.join(process.env.CODEX_HOME, 'skills', PROMPT_ENGINEERING_SKILL_NAME, 'SKILL.md'));
  }

  for (const candidate of candidates) {
    const skill = readPromptOptimizerSkill(candidate);
    if (skill) return skill;
  }

  if (explicitName && normalizeSkillName(explicitName) === PROMPT_ENGINEERING_SKILL_NAME) {
    return {
      name: PROMPT_ENGINEERING_SKILL_NAME,
      instructions: BUILTIN_PROMPT_ENGINEERING_EXPERT,
    };
  }

  return undefined;
}

function readPromptOptimizerSkill(filePath: string): PromptOptimizerSkill | undefined {
  try {
    const resolved = path.resolve(filePath);
    if (!existsSync(resolved)) return undefined;
    const stat = statSync(resolved);
    if (!stat.isFile() || stat.size > 128 * 1024) return undefined;
    const content = readFileSync(resolved, 'utf8');
    const instructions = truncateContext(content, MAX_PROMPT_OPTIMIZER_SKILL_CHARS);
    if (!instructions.trim()) return undefined;
    return {
      name: PROMPT_ENGINEERING_SKILL_NAME,
      instructions,
      sourcePath: resolved,
    };
  } catch {
    return undefined;
  }
}

function normalizeSkillName(value: string): string {
  return value.trim().toLowerCase().replace(/^@+/, '');
}

export async function handlePromptOptimizerRequest(req: IncomingMessage): Promise<PromptOptimizerHttpResponse | null> {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname !== '/api/prompt/optimize') return null;

  if (req.method !== 'POST') {
    return { status: 405, body: { error: 'Method not allowed.' } };
  }

  const startedAt = Date.now();
  const input = normalizePromptOptimizeInput(await readJsonBody(req));
  if (!input.text) {
    return { status: 400, body: { error: 'Expected JSON body with a non-empty text field.' } };
  }
  if (input.text.length > MAX_PROMPT_OPTIMIZE_CHARS) {
    return { status: 413, body: { error: `Prompt is too large. Maximum length is ${MAX_PROMPT_OPTIMIZE_CHARS} characters.` } };
  }

  try {
    const skill = loadPromptOptimizerSkill(input);
    const modelResult = await optimizeWithFastModel(input, startedAt, skill);
    const result = finalizePromptOptimization(input, modelResult.optimized, skill ? 'skill' : 'model', startedAt, {
      provider: modelResult.provider,
      modelId: modelResult.modelId,
      skillName: skill?.name,
    });
    if (result.changedIntentRisk === 'high') {
      throw new Error(result.warning ?? 'Optimized prompt dropped important original constraints.');
    }
    return { status: 200, body: result };
  } catch (err) {
    return { status: 200, body: buildLocalOptimizationResult(input, startedAt, conciseError(err)) };
  }
}

async function optimizeWithFastModel(
  input: PromptOptimizeInputData,
  startedAt: number,
  skill?: PromptOptimizerSkill
): Promise<PromptOptimizeResultData> {
  const { AuthStorage, ModelRegistry } = await import('@earendil-works/pi-coding-agent');
  const { complete } = await import('@earendil-works/pi-ai');
  const authStorage = AuthStorage.create(getAuthPath());
  const modelRegistry = ModelRegistry.create(authStorage, getModelsPath());
  await Promise.resolve(modelRegistry.refresh?.());

  const models = (modelRegistry.getAvailable() as SdkModel[]).filter((model) => model.input?.includes('text'));
  const model = selectFastModel(models, input);
  if (!model) throw new Error('No configured text model is available.');

  const auth = await modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) throw new Error(auth.error || `No auth for ${model.provider}.`);
  if (!auth.apiKey && !auth.headers) throw new Error(`No API key or request headers configured for ${model.provider}.`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FAST_MODEL_TIMEOUT_MS);
  try {
    const userMessage: UserMessage = {
      role: 'user',
      content: [{ type: 'text', text: buildOptimizationUserPrompt(input, skill) }],
      timestamp: Date.now(),
    };

    const response = await complete(
      model,
      { systemPrompt: buildModelSystemPrompt(skill), messages: [userMessage] },
      {
        apiKey: auth.apiKey,
        headers: auth.headers,
        signal: controller.signal,
        temperature: 0.2,
        maxTokens: FAST_MODEL_MAX_TOKENS,
        timeoutMs: FAST_MODEL_TIMEOUT_MS,
        maxRetries: 0,
      }
    );

    if (response.stopReason === 'aborted') throw new Error('Fast model request timed out.');
    if (response.stopReason === 'error') throw new Error(response.errorMessage || 'Fast model request failed.');

    const optimized = sanitizeModelPromptOutput(
      response.content
        .filter((part): part is TextContent => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
    );
    if (!optimized) throw new Error('Fast model returned empty text.');

    return {
      optimized,
      source: 'model',
      durationMs: Date.now() - startedAt,
      provider: model.provider,
      modelId: normalizeProviderModelId(model.provider, model.id),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildLocalOptimizationResult(
  input: PromptOptimizeInputData,
  startedAt: number,
  fallbackReason: string
): PromptOptimizeResultData {
  return finalizePromptOptimization(input, optimizePromptDraft(input.text, input), 'local', startedAt, {
    fallbackReason,
  });
}

function finalizePromptOptimization(
  input: PromptOptimizeInputData,
  optimized: string,
  source: PromptOptimizeResultData['source'],
  startedAt: number,
  meta: { provider?: string; modelId?: string; skillName?: string; fallbackReason?: string } = {}
): PromptOptimizeResultData {
  const normalized = sanitizeModelPromptOutput(optimized);
  const assessment = assessPromptOptimization(input.text, normalized);
  const warnings = [...assessment.warnings];
  if (meta.fallbackReason) warnings.unshift(meta.fallbackReason);

  return {
    optimized: normalized,
    source,
    durationMs: Date.now() - startedAt,
    provider: meta.provider,
    modelId: meta.modelId,
    skillName: meta.skillName,
    warning: warnings[0],
    mode: resolvePromptOptimizeMode(input),
    qualityScore: assessment.score,
    changedIntentRisk: assessment.risk,
    warnings: warnings.length > 0 ? Array.from(new Set(warnings)) : undefined,
    fallbackReason: meta.fallbackReason,
  };
}

function selectFastModel(models: SdkModel[], input: PromptOptimizeInputData): SdkModel | null {
  if (models.length === 0) return null;

  const preferred = input.preferredOptimizerModel
    ? findSdkModel(models, input.preferredOptimizerModel.provider, input.preferredOptimizerModel.id)
    : null;
  if (preferred) return preferred;

  const explicit = selectExplicitFastModel(models);
  if (explicit) return explicit;

  const current = input.currentModel
    ? findSdkModel(models, input.currentModel.provider, input.currentModel.id)
    : null;

  const ranked = [...models].sort((a, b) => scoreFastModel(b) - scoreFastModel(a));
  const best = ranked[0] ?? null;
  if (!best) return current ?? models[0] ?? null;

  if (scoreFastModel(best) > 0) return best;
  return current ?? best;
}

function selectExplicitFastModel(models: SdkModel[]): SdkModel | null {
  const provider = process.env.PI_AGENT_FAST_PROVIDER?.trim();
  const rawModel = process.env.PI_AGENT_FAST_MODEL?.trim()
    ?? process.env.ANTHROPIC_DEFAULT_HAIKU_MODEL?.trim()
    ?? '';
  if (!rawModel) return null;

  const parsed = parseProviderModel(rawModel, provider);
  if (parsed.provider) {
    return findSdkModel(models, parsed.provider, parsed.modelId);
  }

  const normalizedTarget = parsed.modelId.toLowerCase();
  return models.find((model) => {
    const modelId = normalizeProviderModelId(model.provider, model.id).toLowerCase();
    return modelId === normalizedTarget || `${normalizeProviderAlias(model.provider)}/${modelId}` === normalizedTarget;
  }) ?? null;
}

function parseProviderModel(rawModel: string, rawProvider?: string): { provider?: string; modelId: string } {
  const provider = rawProvider ? normalizeProviderAlias(rawProvider) : undefined;
  const slashIndex = rawModel.indexOf('/');
  if (!provider && slashIndex > 0) {
    const maybeProvider = rawModel.slice(0, slashIndex);
    const maybeModel = rawModel.slice(slashIndex + 1);
    return {
      provider: normalizeProviderAlias(maybeProvider),
      modelId: normalizeProviderModelId(maybeProvider, maybeModel),
    };
  }
  return {
    provider,
    modelId: normalizeProviderModelId(provider ?? '', rawModel),
  };
}

function findSdkModel(models: SdkModel[], provider: string, modelId: string): SdkModel | null {
  const targetProvider = normalizeProviderAlias(provider);
  const targetModel = normalizeProviderModelId(targetProvider, modelId);
  return models.find((model) => {
    const candidateProvider = normalizeProviderAlias(model.provider);
    const candidateModel = normalizeProviderModelId(candidateProvider, model.id);
    return candidateProvider === targetProvider && candidateModel === targetModel;
  }) ?? null;
}

function scoreFastModel(model: SdkModel): number {
  const label = `${model.provider} ${model.id} ${model.name}`.toLowerCase();
  let score = model.reasoning ? -20 : 20;

  for (const [keyword, weight] of FAST_MODEL_KEYWORDS) {
    if (label.includes(keyword)) score += weight;
  }
  for (const [keyword, weight] of SLOW_MODEL_KEYWORDS) {
    if (label.includes(keyword)) score += weight;
  }

  if (label.includes('glm-4.5-air') || label.includes('glm-4-flash')) score += 60;
  if (label.includes('gpt-4o-mini') || label.includes('gpt-4.1-mini')) score += 55;
  if (label.includes('gemini-2.5-flash') || label.includes('gemini-2.0-flash')) score += 55;
  if (label.includes('claude-3-5-haiku') || label.includes('claude-3-haiku')) score += 55;
  if (label.includes('deepseek-chat')) score += 30;

  const inputCost = Number(model.cost?.input ?? 0);
  if (Number.isFinite(inputCost) && inputCost > 0) score -= Math.min(35, inputCost * 2);

  return score;
}

function buildModelSystemPrompt(skill?: PromptOptimizerSkill): string {
  if (!skill) return MODEL_SYSTEM_PROMPT;
  return [
    MODEL_SYSTEM_PROMPT,
    '',
    '<prompt_optimization_skill>',
    `name: ${skill.name}`,
    skill.instructions,
    '</prompt_optimization_skill>',
  ].join('\n');
}

function buildOptimizationUserPrompt(input: PromptOptimizeInputData, skill?: PromptOptimizerSkill): string {
  const language = input.language ?? detectPromptLanguage(input.text);
  const mode = resolvePromptOptimizeMode(input);
  const headline =
    language === 'zh'
      ? '请优化下面的用户提示词。'
      : language === 'ja'
        ? '次のユーザープロンプトを最適化してください。'
        : 'Optimize the user prompt below.';

  const lines = [
    headline,
    '',
    '<rules>',
    language === 'zh'
      ? '只返回优化后的提示词，不要回答用户任务。保留原始语言、意图、路径、版本、约束和关键细节。'
      : language === 'ja'
        ? '最適化後のプロンプトだけを返してください。タスク自体には回答せず、元の言語、意図、パス、バージョン、制約、重要な詳細を保持してください。'
        : 'Return only the optimized prompt. Do not answer the task. Preserve language, intent, paths, versions, constraints, and key details.',
    buildModeInstruction(mode, language),
    '</rules>',
    '',
    '<context>',
    ...buildOptimizationContextLines(input, mode),
    '</context>',
  ];

  if (skill) {
    lines.push(
      '',
      '<active_skill>',
      `name: ${skill.name}`,
      skill.sourcePath ? `source_path: ${skill.sourcePath}` : 'source_path: builtin',
      truncateContext(skill.instructions, 1800),
      '</active_skill>'
    );
  }

  lines.push(
    '',
    '<user_prompt>',
    normalizePromptInput(input.text),
    '</user_prompt>'
  );

  return lines.join('\n');
}

function buildModeInstruction(mode: PromptOptimizeMode, language: 'zh' | 'en' | 'ja'): string {
  const byMode: Record<PromptOptimizeMode, Record<'zh' | 'en' | 'ja', string>> = {
    auto: {
      zh: '自动判断最合适的优化模式，并让输出直接可发送给 AI agent。',
      en: 'Automatically choose the best optimization mode and make the result ready to send to an AI agent.',
      ja: '最適な最適化モードを自動判定し、AI agent にそのまま送れる形にしてください。',
    },
    polish: {
      zh: '按精简润色模式处理：减少歧义和废话，保持原意、语气和长度克制。',
      en: 'Use polish mode: reduce ambiguity and noise while preserving intent, tone, and a restrained length.',
      ja: '推敲モードで処理し、意図と語調を保ちながら曖昧さと冗長さを減らしてください。',
    },
    execute: {
      zh: '按执行模式处理：补齐目标、上下文、约束、步骤、验收标准和验证方式。',
      en: 'Use execution mode: add goal, context, constraints, steps, acceptance criteria, and verification.',
      ja: '実行モードで処理し、目的、文脈、制約、手順、受け入れ条件、検証方法を補ってください。',
    },
    debug: {
      zh: '按调试模式处理：突出问题现象、复现方式、日志/错误、预期行为、排查路径和修复验证。',
      en: 'Use debug mode: emphasize symptoms, reproduction, logs/errors, expected behavior, investigation path, and fix verification.',
      ja: 'デバッグモードで処理し、症状、再現手順、ログ/エラー、期待動作、調査経路、修正検証を明確にしてください。',
    },
    review: {
      zh: '按审查模式处理：明确审查范围、风险优先级、测试缺口、输出格式，并要求发现优先。',
      en: 'Use review mode: clarify scope, risk priorities, test gaps, output format, and ask for findings first.',
      ja: 'レビュー モードで処理し、範囲、リスク優先度、テスト不足、出力形式を明確にし、指摘を先に出すようにしてください。',
    },
    research: {
      zh: '按研究模式处理：要求来源、证据等级、对比维度、结论边界和可执行建议。',
      en: 'Use research mode: require sources, evidence quality, comparison dimensions, conclusion boundaries, and actionable recommendations.',
      ja: '調査モードで処理し、情報源、証拠品質、比較軸、結論の限界、実行可能な提案を求めてください。',
    },
    ui: {
      zh: '按 UI/体验模式处理：补齐目标用户、视觉风格、交互状态、响应式/主题适配和验收截图要求。',
      en: 'Use UI/UX mode: add target users, visual style, interaction states, responsive/theme behavior, and screenshot acceptance criteria.',
      ja: 'UI/UX モードで処理し、対象ユーザー、視覚スタイル、操作状態、レスポンシブ/テーマ対応、スクリーンショットでの検証条件を補ってください。',
    },
    agent_room: {
      zh: '按多智能体讨论模式处理：定义议题、对立/备选视角、资料收集、交叉质询和中立总结标准。',
      en: 'Use multi-agent discussion mode: define the topic, opposing or alternative viewpoints, evidence gathering, cross-questioning, and neutral summary criteria.',
      ja: 'マルチエージェント討論モードで処理し、議題、対立または代替視点、証拠収集、相互質問、中立的な要約基準を定義してください。',
    },
  };

  return byMode[mode][language];
}

function buildOptimizationContextLines(input: PromptOptimizeInputData, mode: PromptOptimizeMode): string[] {
  const lines = [
    `mode: ${mode}`,
    input.projectName ? `project_name: ${input.projectName}` : 'project_name: active workspace',
    input.projectPath ? `project_path: ${input.projectPath}` : 'project_path: active session workspace',
    `selection_only: ${input.selectionOnly ? 'true' : 'false'}`,
  ];

  if (input.currentModel) {
    lines.push(`current_model: ${input.currentModel.provider}/${input.currentModel.id}`);
  }
  if (input.preferredOptimizerModel) {
    lines.push(`preferred_optimizer_model: ${input.preferredOptimizerModel.provider}/${input.preferredOptimizerModel.id}`);
  }

  if (input.sessionContext) {
    lines.push('<session>');
    if (input.sessionContext.title) lines.push(`title: ${input.sessionContext.title}`);
    if (input.sessionContext.lastUserMessage) lines.push(`last_user_message: ${input.sessionContext.lastUserMessage}`);
    if (input.sessionContext.lastAssistantSummary) lines.push(`last_assistant_summary: ${input.sessionContext.lastAssistantSummary}`);
    lines.push('</session>');
  }

  if (input.workspaceContext) {
    lines.push('<workspace>');
    if (input.workspaceContext.branch) lines.push(`branch: ${input.workspaceContext.branch}`);
    if (typeof input.workspaceContext.dirty === 'boolean') lines.push(`dirty: ${input.workspaceContext.dirty ? 'true' : 'false'}`);
    if (input.workspaceContext.changedFiles?.length) {
      lines.push('changed_files:');
      for (const file of input.workspaceContext.changedFiles.slice(0, 12)) {
        lines.push(`- ${file.status}: ${file.path}`);
      }
    }
    lines.push('</workspace>');
  }

  if (input.fileReferences?.length) {
    lines.push('<file_references>');
    for (const reference of input.fileReferences.slice(0, 10)) {
      const range = reference.lineStart ? `:${reference.lineStart}${reference.lineEnd ? `-${reference.lineEnd}` : ''}` : '';
      lines.push(`- ${reference.path}${range}`);
      if (reference.excerpt) lines.push(`  excerpt: ${truncateContext(reference.excerpt, 700).replace(/\n/g, '\n  ')}`);
    }
    lines.push('</file_references>');
  } else {
    lines.push(`has_file_references: ${input.hasFileReferences ? 'true' : 'false'}`);
  }

  if (input.imageReferences?.length) {
    lines.push('<image_references>');
    for (const image of input.imageReferences.slice(0, 6)) {
      lines.push(`- ${image.fileName ?? 'image'}${image.mimeType ? ` (${image.mimeType})` : ''}${image.note ? `: ${image.note}` : ''}`);
    }
    lines.push('</image_references>');
  } else {
    lines.push(`has_images: ${input.hasImages ? 'true' : 'false'}`);
  }

  return lines;
}

function sanitizeModelPromptOutput(output: string): string {
  let text = normalizePromptInput(output);
  text = text.replace(/^```(?:markdown|md|text)?\s*/i, '').replace(/\s*```$/i, '').trim();
  text = text.replace(/^(?:优化后的提示词|优化提示词|改写后的提示词|提示词|Optimized prompt|Rewritten prompt|Prompt|最適化後のプロンプト)\s*[:：]\s*/i, '').trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1).trim();
  }
  return text;
}

function normalizePromptOptimizeInput(value: unknown): PromptOptimizeInputData {
  const object = isRecord(value) ? value : {};
  const text = stringValue(object.text);
  const mode = isPromptOptimizeMode(object.mode) ? object.mode : undefined;
  const language = object.language === 'zh' || object.language === 'en' || object.language === 'ja'
    ? object.language
    : undefined;
  const currentModel = isRecord(object.currentModel)
    && typeof object.currentModel.provider === 'string'
    && typeof object.currentModel.id === 'string'
      ? {
          provider: object.currentModel.provider,
          id: object.currentModel.id,
        }
      : undefined;
  const preferredOptimizerModel = isRecord(object.preferredOptimizerModel)
    && typeof object.preferredOptimizerModel.provider === 'string'
    && typeof object.preferredOptimizerModel.id === 'string'
      ? {
          provider: object.preferredOptimizerModel.provider,
          id: object.preferredOptimizerModel.id,
        }
      : undefined;
  const fileReferences = normalizePromptFileReferences(object.fileReferences);
  const imageReferences = normalizePromptImageReferences(object.imageReferences);
  const sessionContext = normalizePromptSessionContext(object.sessionContext);
  const workspaceContext = normalizePromptWorkspaceContext(object.workspaceContext);

  return {
    text: text ? normalizePromptInput(text) : '',
    mode,
    projectName: stringValue(object.projectName) ?? undefined,
    projectPath: stringValue(object.projectPath) ?? undefined,
    language,
    hasFileReferences: object.hasFileReferences === true || (fileReferences?.length ?? 0) > 0,
    hasImages: object.hasImages === true || (imageReferences?.length ?? 0) > 0,
    fileReferences,
    imageReferences,
    sessionContext,
    workspaceContext,
    selectionOnly: object.selectionOnly === true,
    sessionId: stringValue(object.sessionId) ?? undefined,
    currentModel,
    preferredOptimizerModel,
  };
}

function isPromptOptimizeMode(value: unknown): value is PromptOptimizeMode {
  return value === 'auto'
    || value === 'polish'
    || value === 'execute'
    || value === 'debug'
    || value === 'review'
    || value === 'research'
    || value === 'ui'
    || value === 'agent_room';
}

function normalizePromptFileReferences(value: unknown): PromptOptimizeInputData['fileReferences'] {
  if (!Array.isArray(value)) return undefined;
  const references: NonNullable<PromptOptimizeInputData['fileReferences']> = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const path = stringValue(item.path);
    if (!path) continue;
    references.push({
      path,
      name: stringValue(item.name) ?? undefined,
      language: stringValue(item.language) ?? undefined,
      lineStart: numberValue(item.lineStart),
      lineEnd: numberValue(item.lineEnd),
      excerpt: truncateContext(stringValue(item.excerpt) ?? '', 2_000) || undefined,
    });
  }
  return references.length > 0 ? references.slice(0, 20) : undefined;
}

function normalizePromptImageReferences(value: unknown): PromptOptimizeInputData['imageReferences'] {
  if (!Array.isArray(value)) return undefined;
  const references: NonNullable<PromptOptimizeInputData['imageReferences']> = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const reference = {
      fileName: stringValue(item.fileName) ?? undefined,
      mimeType: stringValue(item.mimeType) ?? undefined,
      note: truncateContext(stringValue(item.note) ?? '', 400) || undefined,
    };
    if (reference.fileName || reference.mimeType || reference.note) references.push(reference);
  }
  return references.length > 0 ? references.slice(0, 10) : undefined;
}

function normalizePromptSessionContext(value: unknown): PromptOptimizeInputData['sessionContext'] {
  if (!isRecord(value)) return undefined;
  const context = {
    title: truncateContext(stringValue(value.title) ?? '', 160) || undefined,
    lastUserMessage: truncateContext(stringValue(value.lastUserMessage) ?? '', 1_000) || undefined,
    lastAssistantSummary: truncateContext(stringValue(value.lastAssistantSummary) ?? '', 1_000) || undefined,
  };
  return context.title || context.lastUserMessage || context.lastAssistantSummary ? context : undefined;
}

function normalizePromptWorkspaceContext(value: unknown): PromptOptimizeInputData['workspaceContext'] {
  if (!isRecord(value)) return undefined;
  const changedFiles = Array.isArray(value.changedFiles)
    ? value.changedFiles
        .map((item) => {
          if (!isRecord(item)) return null;
          const path = stringValue(item.path);
          const status = stringValue(item.status);
          if (!path || !status) return null;
          return { path, status };
        })
        .filter((item): item is { path: string; status: string } => Boolean(item))
        .slice(0, 40)
    : undefined;
  const context = {
    branch: stringValue(value.branch) ?? undefined,
    dirty: typeof value.dirty === 'boolean' ? value.dirty : undefined,
    changedFiles: changedFiles && changedFiles.length > 0 ? changedFiles : undefined,
  };
  return context.branch || typeof context.dirty === 'boolean' || context.changedFiles ? context : undefined;
}

function optimizePromptDraft(input: string, context: PromptOptimizeInputData): string {
  const task = normalizePromptInput(input);
  const language = context.language ?? detectPromptLanguage(task);
  const mode = resolvePromptOptimizeMode(context);
  const role = inferPromptRole(task, language, mode);
  const contextLines = buildPromptContextLines(context, language);
  const requirements = buildPromptRequirements(task, language, mode);
  const outputFormat = buildPromptOutputFormat(task, language, mode);

  if (language === 'zh') {
    return [
      `请你作为${role}，帮助我完成下面的任务。`,
      '',
      '## 目标',
      task,
      '',
      '## 上下文',
      ...contextLines,
      '',
      '## 要求',
      ...requirements.map((item, index) => `${index + 1}. ${item}`),
      '',
      '## 输出格式',
      ...outputFormat.map((item) => `- ${item}`),
    ].join('\n');
  }

  if (language === 'ja') {
    return [
      `${role}として、次のタスクを完了してください。`,
      '',
      '## 目的',
      task,
      '',
      '## コンテキスト',
      ...contextLines,
      '',
      '## 要件',
      ...requirements.map((item, index) => `${index + 1}. ${item}`),
      '',
      '## 出力形式',
      ...outputFormat.map((item) => `- ${item}`),
    ].join('\n');
  }

  return [
    `Act as ${role} and help me complete the task below.`,
    '',
    '## Goal',
    task,
    '',
    '## Context',
    ...contextLines,
    '',
    '## Requirements',
    ...requirements.map((item, index) => `${index + 1}. ${item}`),
    '',
    '## Output Format',
    ...outputFormat.map((item) => `- ${item}`),
  ].join('\n');
}

function normalizePromptInput(input: string): string {
  return input
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function detectPromptLanguage(input: string): 'zh' | 'en' | 'ja' {
  if (/[\u3040-\u30ff]/.test(input)) return 'ja';
  return /[\u3400-\u9fff]/.test(input) ? 'zh' : 'en';
}

function detectPromptOptimizeMode(input: string): PromptOptimizeMode {
  if (AGENT_ROOM_TASK_RE.test(input)) return 'agent_room';
  if (DEBUG_TASK_RE.test(input)) return 'debug';
  if (REVIEW_TASK_RE.test(input)) return 'review';
  if (PRODUCT_TASK_RE.test(input)) return 'ui';
  if (RESEARCH_TASK_RE.test(input)) return 'research';
  if (CODE_TASK_RE.test(input)) return 'execute';
  return 'polish';
}

function resolvePromptOptimizeMode(input: PromptOptimizeInputData): PromptOptimizeMode {
  if (input.mode && input.mode !== 'auto') return input.mode;
  return detectPromptOptimizeMode(input.text);
}

function inferPromptRole(input: string, language: 'zh' | 'en' | 'ja', mode: PromptOptimizeMode): string {
  const lower = input.toLowerCase();
  const codeTask = CODE_TASK_RE.test(input);
  const writingTask = WRITING_TASK_RE.test(input);
  const dataTask = DATA_TASK_RE.test(input);
  const productTask = PRODUCT_TASK_RE.test(input);

  if (language === 'zh') {
    if (mode === 'debug') return '资深故障排查工程师';
    if (mode === 'review') return '严谨的代码审查专家';
    if (mode === 'research') return '严谨的研究分析专家';
    if (mode === 'ui') return '资深产品与交互设计专家';
    if (mode === 'agent_room') return '多智能体讨论主持人';
    if (codeTask) return '资深软件工程师';
    if (dataTask) return '严谨的数据分析专家';
    if (productTask || lower.includes('ui')) return '资深产品与交互设计专家';
    if (writingTask) return '专业技术写作专家';
    return '专业问题分析与执行专家';
  }
  if (language === 'ja') {
    if (mode === 'debug') return 'シニア障害調査エンジニア';
    if (mode === 'review') return '厳密なコードレビュー専門家';
    if (mode === 'research') return '厳密なリサーチ分析専門家';
    if (mode === 'ui') return 'シニアプロダクト・UXデザイナー';
    if (mode === 'agent_room') return 'マルチエージェント討論の進行役';
    if (codeTask) return 'シニアソフトウェアエンジニア';
    if (dataTask) return '厳密なデータ分析専門家';
    if (productTask || lower.includes('ui')) return 'シニアプロダクト・UXデザイナー';
    if (writingTask) return '技術文書の専門家';
    return '問題分析と実行の専門家';
  }
  if (mode === 'debug') return 'a senior debugging engineer';
  if (mode === 'review') return 'a rigorous code reviewer';
  if (mode === 'research') return 'a rigorous research analyst';
  if (mode === 'ui') return 'a senior product and UX designer';
  if (mode === 'agent_room') return 'a multi-agent discussion moderator';
  if (codeTask) return 'a senior software engineer';
  if (dataTask) return 'a rigorous data analyst';
  if (productTask || lower.includes('ui')) return 'a senior product and UX designer';
  if (writingTask) return 'a technical writing expert';
  return 'an expert problem solver';
}

function buildPromptContextLines(context: PromptOptimizeInputData, language: 'zh' | 'en' | 'ja'): string[] {
  if (language === 'zh') {
    const lines = [
      context.projectName ? `- 当前项目：${context.projectName}` : '- 当前项目：以当前工作区为准',
      context.projectPath ? `- 工作目录：${context.projectPath}` : '- 工作目录：以当前会话工作区为准',
    ];
    if (context.fileReferences?.length) {
      lines.push('- 已加入对话的文件：');
      for (const reference of context.fileReferences.slice(0, 8)) {
        const range = reference.lineStart ? `:${reference.lineStart}${reference.lineEnd ? `-${reference.lineEnd}` : ''}` : '';
        lines.push(`  - ${reference.path}${range}`);
      }
    } else if (context.hasFileReferences) {
      lines.push('- 我已附加工作区文件作为上下文，请优先结合文件内容判断。');
    }
    if (context.imageReferences?.length) {
      lines.push(`- 已加入 ${context.imageReferences.length} 张图片作为上下文。`);
    } else if (context.hasImages) {
      lines.push('- 我已附加图片作为上下文，请结合图片信息判断。');
    }
    if (context.workspaceContext) {
      if (context.workspaceContext.branch) lines.push(`- 当前 Git 分支：${context.workspaceContext.branch}`);
      if (context.workspaceContext.dirty) lines.push('- 当前工作区有未提交改动，修改方案需要避免覆盖用户现有改动。');
      if (context.workspaceContext.changedFiles?.length) {
        lines.push(`- 近期变更文件：${context.workspaceContext.changedFiles.slice(0, 8).map((file) => `${file.status} ${file.path}`).join('；')}`);
      }
    }
    if (context.sessionContext?.lastUserMessage) lines.push(`- 上一条用户消息摘要：${context.sessionContext.lastUserMessage}`);
    if (context.selectionOnly) lines.push('- 当前只优化我选中的这段内容，不要改写未选中的上下文。');
    return lines;
  }
  if (language === 'ja') {
    const lines = [
      context.projectName ? `- 現在のプロジェクト: ${context.projectName}` : '- 現在のプロジェクト: アクティブなワークスペースを基準にする',
      context.projectPath ? `- 作業ディレクトリ: ${context.projectPath}` : '- 作業ディレクトリ: 現在のセッションワークスペースを基準にする',
    ];
    if (context.fileReferences?.length) {
      lines.push('- 会話に追加されたファイル:');
      for (const reference of context.fileReferences.slice(0, 8)) {
        const range = reference.lineStart ? `:${reference.lineStart}${reference.lineEnd ? `-${reference.lineEnd}` : ''}` : '';
        lines.push(`  - ${reference.path}${range}`);
      }
    } else if (context.hasFileReferences) {
      lines.push('- ワークスペースファイルがコンテキストとして添付されているため、その内容を優先して判断する。');
    }
    if (context.imageReferences?.length) {
      lines.push(`- ${context.imageReferences.length} 件の画像がコンテキストとして追加されている。`);
    } else if (context.hasImages) {
      lines.push('- 画像がコンテキストとして添付されているため、視覚情報も考慮する。');
    }
    if (context.workspaceContext) {
      if (context.workspaceContext.branch) lines.push(`- 現在の Git ブランチ: ${context.workspaceContext.branch}`);
      if (context.workspaceContext.dirty) lines.push('- 作業ツリーに未コミットの変更があるため、既存のユーザー変更を上書きしない。');
      if (context.workspaceContext.changedFiles?.length) {
        lines.push(`- 最近変更されたファイル: ${context.workspaceContext.changedFiles.slice(0, 8).map((file) => `${file.status} ${file.path}`).join('; ')}`);
      }
    }
    if (context.sessionContext?.lastUserMessage) lines.push(`- 直前のユーザーメッセージ要約: ${context.sessionContext.lastUserMessage}`);
    if (context.selectionOnly) lines.push('- 選択された部分だけを最適化し、未選択の文脈は変更しない。');
    return lines;
  }

  const lines = [
    context.projectName ? `- Current project: ${context.projectName}` : '- Current project: use the active workspace',
    context.projectPath ? `- Working directory: ${context.projectPath}` : '- Working directory: use the active session workspace',
  ];
  if (context.fileReferences?.length) {
    lines.push('- Files added to chat:');
    for (const reference of context.fileReferences.slice(0, 8)) {
      const range = reference.lineStart ? `:${reference.lineStart}${reference.lineEnd ? `-${reference.lineEnd}` : ''}` : '';
      lines.push(`  - ${reference.path}${range}`);
    }
  } else if (context.hasFileReferences) {
    lines.push('- Workspace files are attached as context; prioritize their contents.');
  }
  if (context.imageReferences?.length) {
    lines.push(`- ${context.imageReferences.length} image(s) are attached as context.`);
  } else if (context.hasImages) {
    lines.push('- Images are attached as context; use their visual information when relevant.');
  }
  if (context.workspaceContext) {
    if (context.workspaceContext.branch) lines.push(`- Current Git branch: ${context.workspaceContext.branch}`);
    if (context.workspaceContext.dirty) lines.push('- The workspace has uncommitted changes; avoid overwriting user edits.');
    if (context.workspaceContext.changedFiles?.length) {
      lines.push(`- Recently changed files: ${context.workspaceContext.changedFiles.slice(0, 8).map((file) => `${file.status} ${file.path}`).join('; ')}`);
    }
  }
  if (context.sessionContext?.lastUserMessage) lines.push(`- Previous user message summary: ${context.sessionContext.lastUserMessage}`);
  if (context.selectionOnly) lines.push('- Only optimize the selected text; do not rewrite unselected surrounding context.');
  return lines;
}

function buildPromptRequirements(input: string, language: 'zh' | 'en' | 'ja', mode: PromptOptimizeMode): string[] {
  const codeTask = CODE_TASK_RE.test(input);
  const compareTask = RESEARCH_TASK_RE.test(input);
  const debugTask = DEBUG_TASK_RE.test(input);
  const productTask = PRODUCT_TASK_RE.test(input);

  if (language === 'zh') {
    const requirements = [
      '先明确任务目标、关键约束和必要假设；不确定时说明判断依据。',
      '给出可执行步骤，优先处理最能推进目标的部分。',
      '保持回答简洁但完整，避免泛泛而谈。',
    ];
    if (mode === 'polish') requirements.push('只做必要的表达优化，不要把简单请求扩写成复杂方案。');
    if (mode === 'execute') requirements.push('把需求整理为可直接交给 coding agent 执行的任务，包含验收标准。');
    if (mode === 'debug') requirements.push('把问题整理为可复现、可定位、可验证的排查任务。');
    if (mode === 'review') requirements.push('以代码审查格式输出，优先列出高风险问题和缺失测试。');
    if (mode === 'research') requirements.push('要求给出资料来源、证据等级、对比维度和结论边界。');
    if (mode === 'ui') requirements.push('明确视觉风格、交互状态、响应式布局、主题适配和截图验收。');
    if (mode === 'agent_room') requirements.push('拆成多个智能体视角，定义资料收集、交叉质询和中立总结标准。');
    if (codeTask) {
      requirements.push('如果需要改代码，请先阅读相关文件，再做最小必要改动，并保持现有架构和风格一致。');
      requirements.push('完成后给出验证方式、测试结果和仍需注意的风险。');
    }
    if (debugTask) requirements.push('排查问题时请包含现象、复现方式、可能原因、验证步骤和修复建议。');
    if (productTask) requirements.push('涉及界面或体验时，请同时考虑布局、交互状态、视觉一致性和不同窗口尺寸下的表现。');
    if (compareTask) requirements.push('对比或分析时请列出维度、现状、差距、优先级和下一步建议。');
    return requirements;
  }

  if (language === 'ja') {
    const requirements = [
      'まず目的、制約、必要な前提を明確にし、不確実な点は判断根拠を示す。',
      '実行可能な手順を提示し、目標達成に最も効く作業を優先する。',
      '簡潔だが十分な回答にし、一般論で終わらせない。',
    ];
    if (mode === 'polish') requirements.push('必要な表現改善だけを行い、単純な依頼を過度に複雑化しない。');
    if (mode === 'execute') requirements.push('coding agent がそのまま実行できるタスクとして整理し、受け入れ条件を含める。');
    if (mode === 'debug') requirements.push('再現、定位、検証ができる調査タスクとして整理する。');
    if (mode === 'review') requirements.push('コードレビュー形式にし、高リスク問題と不足しているテストを優先する。');
    if (mode === 'research') requirements.push('情報源、証拠品質、比較軸、結論の限界を求める。');
    if (mode === 'ui') requirements.push('視覚スタイル、操作状態、レスポンシブ、テーマ対応、スクリーンショット検証を明確にする。');
    if (mode === 'agent_room') requirements.push('複数エージェントの視点に分け、証拠収集、相互質問、中立要約の基準を定義する。');
    if (codeTask) {
      requirements.push('コード変更が必要な場合は、関連ファイルを先に確認し、既存の構成とスタイルに合わせて最小限の有効な変更を行う。');
      requirements.push('最後に検証方法、テスト結果、残るリスクを示す。');
    }
    if (debugTask) requirements.push('問題調査では、現象、再現手順、考えられる原因、検証手順、修正案を含める。');
    if (productTask) requirements.push('UIや体験に関わる場合は、レイアウト、インタラクション状態、視覚的一貫性、各画面サイズでの表示を考慮する。');
    if (compareTask) requirements.push('比較や分析では、観点、現状、差分、優先度、次のアクションを含める。');
    return requirements;
  }

  const requirements = [
    'Clarify the goal, constraints, and necessary assumptions before acting.',
    'Provide actionable steps and prioritize the work that moves the goal forward fastest.',
    'Keep the answer concise but complete; avoid generic advice.',
  ];
  if (mode === 'polish') requirements.push('Only improve wording where needed; do not turn a simple request into a complex plan.');
  if (mode === 'execute') requirements.push('Turn the request into a task a coding agent can execute directly, including acceptance criteria.');
  if (mode === 'debug') requirements.push('Turn the issue into a reproducible, diagnosable, and verifiable debugging task.');
  if (mode === 'review') requirements.push('Use a code-review format and prioritize high-risk findings and missing tests.');
  if (mode === 'research') requirements.push('Require sources, evidence quality, comparison dimensions, and clear conclusion boundaries.');
  if (mode === 'ui') requirements.push('Specify visual style, interaction states, responsive layout, theme behavior, and screenshot acceptance checks.');
  if (mode === 'agent_room') requirements.push('Split the problem across multiple agent viewpoints with evidence gathering, cross-questioning, and neutral synthesis criteria.');
  if (codeTask) {
    requirements.push('If code changes are needed, inspect the relevant files first, make the smallest useful change, and follow existing architecture and style.');
    requirements.push('Finish with verification steps, test results, and remaining risks.');
  }
  if (debugTask) requirements.push('For debugging, include symptoms, reproduction steps, likely causes, verification steps, and proposed fixes.');
  if (productTask) requirements.push('For UI or UX work, consider layout, interaction states, visual consistency, and behavior across window sizes.');
  if (compareTask) requirements.push('For comparisons or research, include dimensions, current state, gaps, priorities, and recommended next steps.');
  return requirements;
}

function buildPromptOutputFormat(input: string, language: 'zh' | 'en' | 'ja', mode: PromptOptimizeMode): string[] {
  const codeTask = CODE_TASK_RE.test(input);
  const compareTask = RESEARCH_TASK_RE.test(input);
  const debugTask = DEBUG_TASK_RE.test(input);
  const productTask = PRODUCT_TASK_RE.test(input);

  if (language === 'zh') {
    if (mode === 'polish') return ['优化后的提示词'];
    if (mode === 'execute') return ['任务目标', '上下文', '执行要求', '验收与验证'];
    if (mode === 'debug') return ['问题现象', '复现信息', '排查路径', '修复与验证'];
    if (mode === 'review') return ['审查范围', '重点风险', '输出格式', '测试关注点'];
    if (mode === 'research') return ['研究问题', '资料来源要求', '对比维度', '结论格式'];
    if (mode === 'ui') return ['体验目标', '视觉与交互要求', '响应式与主题适配', '截图验收'];
    if (mode === 'agent_room') return ['议题', '对照视角', '证据要求', '中立总结标准'];
    if (debugTask) return ['问题摘要', '排查步骤', '修复方案', '验证结果'];
    if (compareTask) return ['结论摘要', '详细对比表', '优先级排序', '下一步行动'];
    if (productTask) return ['设计目标', '界面与交互改动', '响应式与主题适配', '验收方式'];
    if (codeTask) return ['改动摘要', '涉及文件', '验证结果', '后续建议'];
    return ['关键结论', '具体步骤', '注意事项'];
  }
  if (language === 'ja') {
    if (mode === 'polish') return ['最適化後のプロンプト'];
    if (mode === 'execute') return ['タスク目標', 'コンテキスト', '実行要件', '受け入れと検証'];
    if (mode === 'debug') return ['問題の症状', '再現情報', '調査経路', '修正と検証'];
    if (mode === 'review') return ['レビュー範囲', '重要リスク', '出力形式', 'テスト観点'];
    if (mode === 'research') return ['調査課題', '情報源要件', '比較軸', '結論形式'];
    if (mode === 'ui') return ['体験目標', '視覚と操作要件', 'レスポンシブとテーマ対応', 'スクリーンショット検証'];
    if (mode === 'agent_room') return ['議題', '対照視点', '証拠要件', '中立要約基準'];
    if (debugTask) return ['問題の要約', '調査手順', '修正案', '検証結果'];
    if (compareTask) return ['結論要約', '詳細比較表', '優先順位', '次のアクション'];
    if (productTask) return ['設計目標', 'UIとインタラクションの変更', 'レスポンシブとテーマ対応', '検証方法'];
    if (codeTask) return ['変更概要', '対象ファイル', '検証結果', '次の提案'];
    return ['主要な結論', '具体的な手順', '注意事項'];
  }

  if (mode === 'polish') return ['Optimized prompt'];
  if (mode === 'execute') return ['Task goal', 'Context', 'Execution requirements', 'Acceptance and verification'];
  if (mode === 'debug') return ['Symptoms', 'Reproduction details', 'Investigation path', 'Fix and verification'];
  if (mode === 'review') return ['Review scope', 'Priority risks', 'Output format', 'Testing focus'];
  if (mode === 'research') return ['Research question', 'Source requirements', 'Comparison dimensions', 'Conclusion format'];
  if (mode === 'ui') return ['Experience goal', 'Visual and interaction requirements', 'Responsive and theme behavior', 'Screenshot acceptance checks'];
  if (mode === 'agent_room') return ['Topic', 'Contrasting viewpoints', 'Evidence requirements', 'Neutral synthesis criteria'];
  if (debugTask) return ['Problem summary', 'Investigation steps', 'Fix plan', 'Verification results'];
  if (compareTask) return ['Executive summary', 'Detailed comparison table', 'Prioritized gaps', 'Next actions'];
  if (productTask) return ['Design goal', 'UI and interaction changes', 'Responsive and theme behavior', 'Verification'];
  if (codeTask) return ['Change summary', 'Files touched', 'Verification results', 'Follow-up suggestions'];
  return ['Key conclusion', 'Concrete steps', 'Important caveats'];
}

function assessPromptOptimization(original: string, optimized: string): PromptQualityAssessment {
  const warnings: string[] = [];
  let score = 100;

  if (!optimized.trim()) {
    return { score: 0, risk: 'high', warnings: ['Optimized prompt is empty.'] };
  }

  if (containsMojibake(optimized)) {
    warnings.push('Optimized prompt appears to contain mojibake or corrupted text.');
    score -= 45;
  }

  const protectedTokens = extractProtectedTokens(original);
  const optimizedLower = optimized.toLowerCase();
  const missingTokens = protectedTokens.filter((token) => !optimizedLower.includes(token.toLowerCase()));
  if (missingTokens.length > 0) {
    warnings.push(`Optimized prompt may have dropped key details: ${missingTokens.slice(0, 5).join(', ')}`);
    score -= Math.min(35, missingTokens.length * 8);
  }

  if (looksLikeAnswerInsteadOfPrompt(optimized)) {
    warnings.push('Optimized prompt looks like an answer instead of a task prompt.');
    score -= 30;
  }

  if (original.length > 120 && optimized.length < original.length * 0.45) {
    warnings.push('Optimized prompt is much shorter than the original; check whether constraints were lost.');
    score -= 15;
  }

  if (optimized.length > Math.max(1800, original.length * 5)) {
    warnings.push('Optimized prompt may be over-expanded for an input-box rewrite.');
    score -= 10;
  }

  const boundedScore = Math.max(0, Math.min(100, Math.round(score)));
  const risk: PromptRisk =
    warnings.some((item) => item.includes('mojibake') || item.includes('answer instead') || item.includes('dropped key details'))
      && (missingTokens.length >= 3 || containsMojibake(optimized) || looksLikeAnswerInsteadOfPrompt(optimized))
      ? 'high'
      : warnings.length > 0
        ? 'medium'
        : 'low';

  return { score: boundedScore, risk, warnings };
}

function extractProtectedTokens(value: string): string[] {
  const matches = value.match(/(?:@?[\w.-]+(?:[\\/][\w .@()[\]-]+)+|[\w.-]+\.(?:tsx?|jsx?|mjs|cjs|json|md|mdx|css|scss|html|yml|yaml|toml|py|go|rs|java|kt|swift|cpp|c|h|log)|v?\d+(?:\.\d+){1,3}|[A-Z][A-Z0-9_/-]{2,})/g) ?? [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const match of matches) {
    const token = match.trim().replace(/[),.;:，。；：]+$/g, '');
    if (token.length < 3) continue;
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(token);
  }
  return result.slice(0, 20);
}

function containsMojibake(value: string): boolean {
  return /�|璇|鎴|鐩|瑕|鍑|浼樺|鎻愮ず|涓嬮潰|銇|銈|銉|绲|瑭/.test(value);
}

function looksLikeAnswerInsteadOfPrompt(value: string): boolean {
  return /^(答案是|结论是|我已经|已经完成|无法直接|Here is the answer|The answer is|I have completed|I cannot directly|回答[:：])/i.test(value.trim());
}

function conciseError(value: unknown): string {
  if (value instanceof Error) {
    if (value.name === 'AbortError') return 'Fast model request timed out.';
    return value.message.slice(0, 240);
  }
  return String(value).slice(0, 240);
}

function truncateContext(value: string, maxLength: number): string {
  const normalized = normalizePromptInput(value);
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_PROMPT_OPTIMIZE_BODY_CHARS) {
        reject(new Error('Request body is too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON body.'));
      }
    });
    req.on('error', reject);
  });
}
