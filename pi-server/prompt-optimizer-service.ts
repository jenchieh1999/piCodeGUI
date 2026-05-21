import type { IncomingMessage } from 'node:http';
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

const MAX_PROMPT_OPTIMIZE_CHARS = 12_000;
const MAX_PROMPT_OPTIMIZE_BODY_CHARS = 80_000;
const FAST_MODEL_TIMEOUT_MS = 12_000;
const FAST_MODEL_MAX_TOKENS = 1_400;

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
  'You are a fast prompt rewrite engine embedded in a desktop coding agent.',
  'Rewrite the user prompt so another coding agent can act on it more reliably.',
  'Preserve the user language. Do not answer the task.',
  'Keep concrete names, paths, versions, constraints, and intent unchanged.',
  'Add missing structure only when it helps: goal, context, constraints, steps, expected output, verification.',
  'Avoid over-expanding simple prompts. Keep it concise, direct, and ready to send.',
  'Return only the optimized prompt text. No explanation, no markdown fence, no prefix.',
].join('\n');

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
    const result = await optimizeWithFastModel(input, startedAt);
    if (result.optimized.trim()) return { status: 200, body: result };
  } catch (err) {
    const fallback = optimizePromptDraft(input.text, input);
    return {
      status: 200,
      body: {
        optimized: fallback,
        source: 'local',
        durationMs: Date.now() - startedAt,
        warning: conciseError(err),
      },
    };
  }

  return {
    status: 200,
    body: {
      optimized: optimizePromptDraft(input.text, input),
      source: 'local',
      durationMs: Date.now() - startedAt,
      warning: 'Fast model returned an empty optimization.',
    },
  };
}

async function optimizeWithFastModel(
  input: PromptOptimizeInputData,
  startedAt: number
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
      content: [{ type: 'text', text: buildOptimizationUserPrompt(input) }],
      timestamp: Date.now(),
    };

    const response = await complete(
      model,
      { systemPrompt: MODEL_SYSTEM_PROMPT, messages: [userMessage] },
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

function selectFastModel(models: SdkModel[], input: PromptOptimizeInputData): SdkModel | null {
  if (models.length === 0) return null;

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

  if (label.includes('glm-4.5-air')) score += 60;
  if (label.includes('gpt-4o-mini') || label.includes('gpt-4.1-mini')) score += 55;
  if (label.includes('gemini-2.5-flash') || label.includes('gemini-2.0-flash')) score += 55;
  if (label.includes('claude-3-5-haiku') || label.includes('claude-3-haiku')) score += 55;
  if (label.includes('deepseek-chat')) score += 30;

  const inputCost = Number(model.cost?.input ?? 0);
  if (Number.isFinite(inputCost) && inputCost > 0) score -= Math.min(35, inputCost * 2);

  return score;
}

function buildOptimizationUserPrompt(input: PromptOptimizeInputData): string {
  const language = input.language ?? detectPromptLanguage(input.text);
  const lines = [
    language === 'zh' ? '请优化下面的用户提示词。' : language === 'ja' ? '次のユーザープロンプトを最適化してください。' : 'Optimize the user prompt below.',
    '',
    '<context>',
    input.projectName ? `project_name: ${input.projectName}` : 'project_name: active workspace',
    input.projectPath ? `project_path: ${input.projectPath}` : 'project_path: active session workspace',
    `selection_only: ${input.selectionOnly ? 'true' : 'false'}`,
    `has_file_references: ${input.hasFileReferences ? 'true' : 'false'}`,
    `has_images: ${input.hasImages ? 'true' : 'false'}`,
    '</context>',
    '',
    '<user_prompt>',
    normalizePromptInput(input.text),
    '</user_prompt>',
  ];

  return lines.join('\n');
}

function sanitizeModelPromptOutput(output: string): string {
  let text = normalizePromptInput(output);
  text = text.replace(/^```(?:markdown|md|text)?\s*/i, '').replace(/\s*```$/i, '').trim();
  text = text.replace(/^(?:优化后(?:的提示词)?|改写后(?:的提示词)?|Optimized prompt|Rewritten prompt|Prompt)\s*[:：]\s*/i, '').trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1).trim();
  }
  return text;
}

function normalizePromptOptimizeInput(value: unknown): PromptOptimizeInputData {
  const object = isRecord(value) ? value : {};
  const text = stringValue(object.text);
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

  return {
    text: text ? normalizePromptInput(text) : '',
    projectName: stringValue(object.projectName) ?? undefined,
    projectPath: stringValue(object.projectPath) ?? undefined,
    language,
    hasFileReferences: object.hasFileReferences === true,
    hasImages: object.hasImages === true,
    selectionOnly: object.selectionOnly === true,
    sessionId: stringValue(object.sessionId) ?? undefined,
    currentModel,
  };
}

function optimizePromptDraft(input: string, context: PromptOptimizeInputData): string {
  const task = normalizePromptInput(input);
  const language = context.language ?? detectPromptLanguage(task);
  const role = inferPromptRole(task, language);
  const contextLines = buildPromptContextLines(context, language);
  const requirements = buildPromptRequirements(task, language);
  const outputFormat = buildPromptOutputFormat(task, language);

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
      '## 目標',
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

function inferPromptRole(input: string, language: 'zh' | 'en' | 'ja'): string {
  const lower = input.toLowerCase();
  const codeTask = /(代码|実装|修復|デバッグ|实现|修复|调试|报错|bug|测试|前端|后端|接口|仓库|项目|重构|code|implement|fix|debug|bug|test|frontend|backend|api|repo|refactor)/i.test(input);
  const writingTask = /(文档|ドキュメント|报告|总结|翻译|润色|readme|doc|report|summary|translate|rewrite|polish)/i.test(input);
  const dataTask = /(数据|データ|表格|csv|分析|统计|可视化|data|analysis|chart|visuali[sz]e|statistics)/i.test(input);
  const productTask = /(产品|プロダクト|交互|ui|ux|界面|设计|体验|product|design|interface)/i.test(input);

  if (language === 'zh') {
    if (codeTask) return '资深软件工程师';
    if (dataTask) return '严谨的数据分析专家';
    if (productTask || lower.includes('ui')) return '资深产品与交互设计专家';
    if (writingTask) return '专业技术写作专家';
    return '专业问题分析与执行专家';
  }
  if (language === 'ja') {
    if (codeTask) return 'シニアソフトウェアエンジニア';
    if (dataTask) return '厳密なデータ分析専門家';
    if (productTask || lower.includes('ui')) return 'シニアプロダクト・UXデザイナー';
    if (writingTask) return '技術文書の専門家';
    return '問題分析と実行の専門家';
  }
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
    if (context.hasFileReferences) lines.push('- 我已附加工作区文件作为上下文，请优先结合文件内容判断。');
    if (context.hasImages) lines.push('- 我已附加图片作为上下文，请结合图片信息判断。');
    return lines;
  }
  if (language === 'ja') {
    const lines = [
      context.projectName ? `- 現在のプロジェクト: ${context.projectName}` : '- 現在のプロジェクト: アクティブなワークスペースを基準にする',
      context.projectPath ? `- 作業ディレクトリ: ${context.projectPath}` : '- 作業ディレクトリ: 現在のセッションワークスペースを基準にする',
    ];
    if (context.hasFileReferences) lines.push('- ワークスペースファイルをコンテキストとして添付しているため、内容を優先して判断する。');
    if (context.hasImages) lines.push('- 画像をコンテキストとして添付しているため、視覚情報も考慮する。');
    return lines;
  }

  const lines = [
    context.projectName ? `- Current project: ${context.projectName}` : '- Current project: use the active workspace',
    context.projectPath ? `- Working directory: ${context.projectPath}` : '- Working directory: use the active session workspace',
  ];
  if (context.hasFileReferences) lines.push('- Workspace files are attached as context; prioritize their contents.');
  if (context.hasImages) lines.push('- Images are attached as context; use their visual information when relevant.');
  return lines;
}

function buildPromptRequirements(input: string, language: 'zh' | 'en' | 'ja'): string[] {
  const codeTask = /(代码|実装|修復|デバッグ|实现|修复|调试|报错|bug|测试|前端|后端|接口|仓库|项目|重构|code|implement|fix|debug|bug|test|frontend|backend|api|repo|refactor)/i.test(input);
  const compareTask = /(比较|比較|对比|差距|评估|compare|contrast|gap|evaluate|review)/i.test(input);

  if (language === 'zh') {
    const requirements = [
      '先明确任务目标、关键约束和必要假设；不确定时说明判断依据。',
      '给出可执行步骤，优先处理最能推进目标的部分。',
      '保持答案简洁但完整，避免泛泛而谈。',
    ];
    if (codeTask) {
      requirements.push('如果需要改代码，请先阅读相关文件，再做最小必要改动，并保持现有架构和风格一致。');
      requirements.push('完成后给出验证方式、测试结果和仍需注意的风险。');
    }
    if (compareTask) requirements.push('对比时请列出维度、现状、差距、优先级和下一步建议。');
    return requirements;
  }

  if (language === 'ja') {
    const requirements = [
      'まず目標、制約、必要な前提を明確にし、不確実な点は判断根拠を示す。',
      '実行可能な手順を提示し、目標達成に最も効く作業を優先する。',
      '簡潔だが十分な回答にし、一般論で終わらせない。',
    ];
    if (codeTask) {
      requirements.push('コード変更が必要な場合は、関連ファイルを先に確認し、既存の構成とスタイルに合わせて最小限の有効な変更を行う。');
      requirements.push('最後に検証方法、テスト結果、残るリスクを示す。');
    }
    if (compareTask) requirements.push('比較では、観点、現状、差分、優先度、次のアクションを含める。');
    return requirements;
  }

  const requirements = [
    'Clarify the goal, constraints, and necessary assumptions before acting.',
    'Provide actionable steps and prioritize the work that moves the goal forward fastest.',
    'Keep the answer concise but complete; avoid generic advice.',
  ];
  if (codeTask) {
    requirements.push('If code changes are needed, inspect the relevant files first, make the smallest useful change, and follow existing architecture and style.');
    requirements.push('Finish with verification steps, test results, and remaining risks.');
  }
  if (compareTask) requirements.push('For comparisons, include dimensions, current state, gaps, priorities, and recommended next steps.');
  return requirements;
}

function buildPromptOutputFormat(input: string, language: 'zh' | 'en' | 'ja'): string[] {
  const codeTask = /(代码|実装|修復|デバッグ|实现|修复|调试|bug|测试|code|implement|fix|debug|test)/i.test(input);
  const compareTask = /(比较|比較|对比|差距|评估|compare|contrast|gap|evaluate|review)/i.test(input);

  if (language === 'zh') {
    if (compareTask) return ['结论摘要', '详细对比表', '优先级排序', '下一步行动'];
    if (codeTask) return ['改动摘要', '涉及文件', '验证结果', '后续建议'];
    return ['关键结论', '具体步骤', '注意事项'];
  }
  if (language === 'ja') {
    if (compareTask) return ['結論要約', '詳細比較表', '優先順位', '次のアクション'];
    if (codeTask) return ['変更概要', '対象ファイル', '検証結果', '次の提案'];
    return ['主要な結論', '具体的な手順', '注意事項'];
  }

  if (compareTask) return ['Executive summary', 'Detailed comparison table', 'Prioritized gaps', 'Next actions'];
  if (codeTask) return ['Change summary', 'Files touched', 'Verification results', 'Follow-up suggestions'];
  return ['Key conclusion', 'Concrete steps', 'Important caveats'];
}

function conciseError(value: unknown): string {
  if (value instanceof Error) {
    if (value.name === 'AbortError') return 'Fast model request timed out.';
    return value.message.slice(0, 240);
  }
  return String(value).slice(0, 240);
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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
