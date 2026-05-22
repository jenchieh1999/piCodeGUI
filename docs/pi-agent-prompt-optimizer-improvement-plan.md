# Pi Agent Desktop 提示词优化能力提升方案

更新时间：2026-05-22

## 1. 背景与目标

当前 Pi Agent Desktop 已经在对话输入框中提供了「优化提示词」按钮，后端也有 `POST /api/prompt/optimize` 能力：优先调用快速模型改写，失败时回退到本地规则模板。这已经形成了第一版闭环，但整体能力仍偏向“单次文本润色”，距离 Trae IDE 类的「根据上下文、任务类型、模型能力和项目状态生成可执行高质量提示词」还有明显空间。

本方案目标是把提示词优化从按钮级功能升级为桌面端核心生产力能力：

- 让用户输入的模糊需求自动转成清晰、可执行、可验证的任务提示词。
- 支持快速模型、当前模型、用户指定模型三种优化路径。
- 能识别代码任务、UI 任务、调试任务、文档任务、研究任务、多 Agent 任务等场景。
- 能利用当前会话、工作区、文件引用、图片引用、选中文本、Git 状态、已启用 skill 等上下文。
- 支持对优化结果进行预览、对比、接受、回滚和再次优化。
- 接入 `prompt-engineering-expert` 类 skill，使第三方或内置 skill 可以参与提示词优化策略。

## 2. 当前实现梳理

### 2.1 前端入口

相关文件：

- `frontend/src/components/chat/ChatInput.tsx`
- `frontend/src/api/client.ts`
- `frontend/src/types/index.ts`
- `frontend/src/lib/i18n.ts`

当前行为：

- 输入框右侧有优化按钮。
- 当用户选中文本时，只优化选区；否则优化整段输入。
- 请求后端 `piApi.optimizePrompt()`。
- 请求统一交给后端 `piApi.optimizePrompt()`；前端不再维护第二套本地 fallback 模板。
- 优化完成后先显示预览卡片，用户接受后才替换输入框；接受后保留最近一次优化快照，支持按钮或 `Ctrl/Cmd+Z` 撤销。
- 请求上下文包含：
  - `text`
  - `projectName`
  - `projectPath`
  - `language`
  - `hasFileReferences`
  - `hasImages`
  - `selectionOnly`
  - `sessionId`
  - `currentModel`
  - `preferredOptimizerModel`

### 2.2 后端能力

相关文件：

- `pi-server/prompt-optimizer-service.ts`
- `pi-server/index.ts`
- `pi-server/types.ts`

当前行为：

- 暴露 `POST /api/prompt/optimize`。
- 限制单次优化输入最大 `12,000` 字符。
- 优先从模型注册表选择快速模型。
- 支持通过环境变量指定快速模型：
  - `PI_AGENT_FAST_PROVIDER`
  - `PI_AGENT_FAST_MODEL`
  - `ANTHROPIC_DEFAULT_HAIKU_MODEL`
- 快速模型默认 `6s` 超时，失败后返回本地规则生成的 fallback prompt；可用 `PI_AGENT_PROMPT_OPTIMIZER_TIMEOUT_MS` 在 `1000ms - 30000ms` 范围内调整。
- 返回结构包含：
  - `optimized`
  - `source: model | local`
  - `durationMs`
  - `provider`
  - `modelId`
  - `warning`
  - `mode`
  - `qualityScore`
  - `changedIntentRisk`
  - `warnings`
  - `fallbackReason`

### 2.3 快速模型选择逻辑

当前通过模型名称关键词打分：

- 加分：`nano`、`mini`、`haiku`、`flash`、`air`、`lite`、`turbo`、`small` 等。
- 减分：`opus`、`max`、`pro`、`sonnet`、`reason`、`thinking` 等。
- 特别加分：
  - `glm-4.5-air`
  - `gpt-4o-mini`
  - `gpt-4.1-mini`
  - `gemini-2.5-flash`
  - `claude-3-5-haiku`
  - `deepseek-chat`

### 2.4 当前优势

- 已有端到端闭环，用户可以直接在输入框内使用。
- 已有快速模型优先和本地 fallback，可靠性较高。
- 支持选区优化，适合局部改写。
- 支持基础上下文参数，后续扩展成本低。
- 已和模型注册表、Provider 配置链路打通。

## 3. 当前状态与剩余优化点

### 3.1 已解决项

截至 2026-05-22，提示词优化能力已经完成以下闭环：

- 前端不再维护第二套本地 fallback 模板，统一由后端 `prompt-optimizer-service.ts` 负责规则化 fallback。
- 中文、英文、日文模板已经按 UTF-8 清理，后端 guard 会拦截明显 mojibake。
- 前端已支持 `auto / polish / execute / debug / review / research / ui / agent_room` 模式菜单。
- 请求已携带文件引用、图片引用、会话摘要和 Git 工作区状态。
- 后端已返回 `mode`、`qualityScore`、`changedIntentRisk`、`warnings`、`fallbackReason`。
- 快速模型默认 6 秒超时，减少网络较慢或首次请求时误触发 fallback 的概率。
- Vite 大 chunk 警告已通过懒加载和 CodeMirror 分包处理。

### 3.2 本轮新增项

本轮继续补齐了用户可见的确认闭环和 skill 扩展入口：

- 优化完成后不再立即覆盖输入框，而是在输入框上方显示轻量预览卡片。
- 预览卡片展示优化前、优化后、模式、来源、质量评分、意图变更风险和最多三条警告。
- 用户可以在预览卡片里接受、复制、重新优化或关闭。
- 接受后才替换输入框内容，并继续保留最近一次优化的撤销能力。
- `PromptOptimizeResult.source` 已扩展为 `model | local | skill`，并增加 `skillName`。
- 后端新增显式启用的 `prompt-engineering-expert` skill 读取入口：
  - 如果设置 `PI_AGENT_PROMPT_OPTIMIZER_SKILL_PATH`，优先读取该文件。
  - 如果设置 `PI_AGENT_PROMPT_OPTIMIZER_SKILL=prompt-engineering-expert`，则依次查找项目内 `.pi/skills/prompt-engineering-expert/SKILL.md`、项目内 `.agents/skills/prompt-engineering-expert/SKILL.md`、`CODEX_HOME/skills/prompt-engineering-expert/SKILL.md`。
  - 如果显式启用但未找到文件，则使用内置 `prompt-engineering-expert` 策略。
  - 默认不自动读取项目 skill，避免未信任项目悄悄影响优化器并把 skill 内容发送给模型。
- 如果 skill 被加载，模型优化会把 skill 指令加入 system/user prompt，并在结果里返回 `source: skill` 与 `skillName`。

### 3.3 仍需继续优化

当前剩余的高价值优化点：

- 设置页已支持“提示词优化模型”显式选择；后续还需要在预览卡片里更明确展示“本次为什么选择该模型”的诊断信息。
- `prompt-engineering-expert` 已有读取入口，但还没有和 Skill Hub 的启用/禁用状态、Trust Center 完整联动。
- 缺少提示词优化单元测试和快照测试，尤其是中文无乱码、路径/版本保留、模式输出差异、模型超时 fallback。
- 预览卡片目前是轻量双栏对比，不是逐词/逐行 diff；长提示词的差异定位还可以继续增强。
- 质量分、风险和用户接受/撤销行为尚未进入本地 telemetry，无法形成偏好学习。

## 4. 目标能力分层

### 4.1 P0：稳定、可信、可恢复

目标：保证现有优化按钮稳定好用，不产生乱码、不可恢复或误替换。

任务：

- 修复并测试中文模板编码。
- 移除前后端重复 fallback，后端成为主规则引擎。
- 增加优化前内容快照，支持 `Ctrl+Z` 或按钮撤销。
- 后端返回更多元信息：
  - `mode`
  - `qualityScore`
  - `changedIntentRisk`
  - `warnings`
  - `fallbackReason`
- 前端 toast 展示具体来源：快速模型 / 本地模板 / skill。
- 对模型输出做基本校验：
  - 不允许空输出。
  - 不允许明显回答任务本身。
  - 不允许删除全部路径、文件名、版本号。
  - 不允许比原文短到丢失关键信息，除非用户选择精简模式。

验收标准：

- 中文输入优化后无乱码。
- 后端断网、无 key、模型超时都能在配置的超时窗口内 fallback，默认不超过 6 秒。
- 用户可以撤销最近一次优化。
- 优化结果不丢失 `@文件`、路径、版本号、错误信息。

当前进度（2026-05-22）：

- 已完成中文/日文/英文后端模板 UTF-8 清理，并统一由 `pi-server/prompt-optimizer-service.ts` 负责本地 fallback。
- 已移除前端 `ChatInput.tsx` 的重复本地模板，前端只负责发送优化请求、展示结果和撤销。
- 已增加优化快照、撤销按钮与 `Ctrl/Cmd+Z` 撤销最近一次优化。
- 已为返回结果补齐 `mode`、`qualityScore`、`changedIntentRisk`、`warnings`、`fallbackReason` 元信息。
- 已增加模型输出 guard：空输出、疑似回答任务、乱码、路径/版本/文件名丢失时降级或告警。
- 已补齐中英日文案，并在 toast 中区分“快速模型”和“本地模板”来源。
- 已将快速模型默认超时调整为 `6s`，并支持 `PI_AGENT_PROMPT_OPTIMIZER_TIMEOUT_MS` 在 `1000ms - 30000ms` 内配置。
- 已通过 `npm run typecheck:server`、`npm run typecheck:frontend` 和 `npm run build`。

### 4.2 P1：上下文增强与模式化优化

目标：让优化结果理解当前任务场景。

新增 PromptOptimizeInput 字段：

```ts
interface PromptOptimizeInput {
  text: string;
  mode?: 'auto' | 'polish' | 'execute' | 'debug' | 'review' | 'research' | 'ui' | 'agent_room';
  projectName?: string;
  projectPath?: string;
  language?: 'zh' | 'en' | 'ja';
  selectionOnly?: boolean;
  currentModel?: { provider: string; id: string };
  preferredOptimizerModel?: { provider: string; id: string };
  fileReferences?: Array<{
    path: string;
    name?: string;
    language?: string;
    lineStart?: number;
    lineEnd?: number;
    excerpt?: string;
  }>;
  imageReferences?: Array<{
    fileName?: string;
    mimeType?: string;
    note?: string;
  }>;
  sessionContext?: {
    title?: string;
    lastUserMessage?: string;
    lastAssistantSummary?: string;
  };
  workspaceContext?: {
    branch?: string;
    dirty?: boolean;
    changedFiles?: Array<{ path: string; status: string }>;
  };
}
```

优化模式：

| 模式 | 使用场景 | 输出特点 |
| --- | --- | --- |
| `polish` | 普通措辞优化 | 保持简短，减少啰嗦 |
| `execute` | 交给 coding agent 执行 | 目标、上下文、约束、步骤、验证 |
| `debug` | 报错/不可用/异常 | 现象、复现、日志、预期、排查优先级 |
| `review` | 代码审查 | 审查范围、关注风险、输出格式 |
| `research` | 搜索/分析/调研 | 资料来源、证据等级、结论格式 |
| `ui` | UI/体验优化 | 目标用户、视觉风格、交互状态、验收截图 |
| `agent_room` | 多 Agents 聊天室 | 议题、双方视角、证据要求、中立总结标准 |

前端交互：

- 优化按钮旁增加下拉菜单。
- 默认“智能优化”，由系统自动判断模式。
- 可固定选择模式。
- 支持“只优化选中内容”。
- 支持“优化并发送”作为高级选项，但默认不自动发送。

验收标准：

- 同一输入在调试/执行/研究模式下输出结构明显不同。
- 文件引用能进入优化结果，而不是只写“有文件上下文”。
- 当前 Git 变更能提示模型注意不要覆盖用户改动。

当前进度（2026-05-22）：

- 已扩展 `PromptOptimizeInput/Result` 类型，支持 `mode`、`fileReferences`、`imageReferences`、`sessionContext`、`workspaceContext`。
- 输入框已增加提示词优化模式菜单，支持智能、润色、执行、调试、审查、研究、UI、多智能体模式。
- 前端请求会携带已加入对话的文件路径/行号/摘录、图片信息、最近会话上下文和 Git 分支/变更文件。
- 设置页模型 Tab 已增加“提示词优化模型”配置，可单独指定 Mini/Flash/Air/Haiku 类快速模型。
- 前端会把 `preferredOptimizerModel` 随优化请求发送给后端。
- 后端会优先使用显式模式；智能模式下继续自动识别任务类型。
- 后端模型提示和本地 fallback 已按模式生成不同的要求和输出结构。
- 优化结果已改为输入框上方的轻量预览卡片，支持接受、复制、重新优化和关闭。
- 预览卡片已展示来源、模式、质量评分、意图变更风险和警告信息。

### 4.3 P2：Skill 驱动的提示词工程工作台

目标：接入 `prompt-engineering-expert` 类 skill，让提示词优化策略可扩展。

能力设计：

- 新增内置 skill：`prompt-engineering-expert`。
- skill 可以声明：
  - 适用任务类型。
  - 优化原则。
  - 输出模板。
  - 质量检查规则。
  - 示例 few-shot。
- 后端 prompt optimizer 读取当前启用 skills。
- 如果存在匹配的 prompt optimization skill，则优先使用 skill 指令生成优化 prompt。
- skill 输出仍经过系统 guardrail。

建议 skill 文件结构：

```text
.pi/skills/prompt-engineering-expert/SKILL.md
```

核心内容：

- 不回答用户任务，只改写用户给 AI 的任务说明。
- 保留原始意图、路径、约束、语言。
- 根据任务类型输出结构化 prompt。
- 对不清楚的问题添加“需要澄清的问题”，但不要阻塞可执行部分。
- 为 coding agent 明确验证步骤。

前端能力：

- 设置页显示当前用于提示词优化的 skill。
- 优化结果显示来源：`skill + model` / `skill + local` / `builtin`。
- 允许用户打开 skill 文档查看和编辑。

验收标准：

- 安装或启用 `prompt-engineering-expert` 后，优化风格可被 skill 改变。
- 禁用 skill 后回到内置策略。
- skill 本身出错时不会阻塞优化按钮。

当前进度（2026-05-22）：

- `PromptOptimizeResult.source` 已扩展为 `model | local | skill`，并增加 `skillName`。
- 后端已新增显式启用的 `prompt-engineering-expert` 读取入口，可从环境变量指定路径、项目 `.pi/.agents` 目录或 `CODEX_HOME` 读取。
- 设置 `PI_AGENT_PROMPT_OPTIMIZER_SKILL=prompt-engineering-expert` 时可启用文件或内置提示词工程策略。
- 已加载的 skill 会进入模型优化 system/user prompt；模型成功返回时，前端可看到 skill 来源。
- 下一步仍需把这个入口和 Skill Hub/Trust Center 的启用状态完整打通。

### 4.4 P3：质量闭环与自我进步

目标：让优化能力根据用户行为自我改进。

记录数据：

- 用户是否接受优化结果。
- 用户是否撤销。
- 用户是否重新优化。
- 优化后是否成功发送。
- 优化后任务是否完成。
- 用户是否手动编辑了优化结果。

本地学习：

- 不上传用户提示词。
- 只记录匿名质量指标和可选的用户主动保存样例。
- 支持“把这次优化作为好例子保存到项目 skill”。

质量评估：

- 引入轻量 rule score：
  - 清晰度
  - 上下文完整性
  - 约束保留
  - 可执行性
  - 验证明确度
- 长期可加入 judge model，但默认关闭。

验收标准：

- 用户可以在优化结果里点“更短 / 更详细 / 更像执行任务 / 更像研究任务”。
- 系统能把用户偏好持久化到项目或全局设置。

## 5. 推荐架构

### 5.1 后端模块拆分

当前 `prompt-optimizer-service.ts` 建议拆分：

```text
pi-server/prompt-optimizer/
├── index.ts                  HTTP 入口
├── types.ts                  输入输出类型
├── context-builder.ts        构建工作区/会话/引用上下文
├── mode-detector.ts          自动识别优化模式
├── model-selector.ts         快速模型选择
├── builtin-templates.ts      内置模板
├── skill-strategy.ts         skill 接入
├── quality-guard.ts          输出质量检查
└── telemetry.ts              本地质量事件
```

### 5.2 单一优化流水线

```text
ChatInput
  -> collect composer context
  -> POST /api/prompt/optimize
  -> normalize input
  -> detect mode
  -> build context
  -> load prompt-engineering skill if available
  -> choose fast model
  -> model rewrite
  -> sanitize output
  -> quality guard
  -> fallback if needed
  -> return optimized + metadata
  -> preview diff / accept / undo
```

### 5.3 前端状态

建议新增：

```ts
type PromptOptimizationPreview = {
  id: string;
  original: string;
  optimized: string;
  mode: PromptOptimizeMode;
  source: 'model' | 'local' | 'skill';
  provider?: string;
  modelId?: string;
  warnings: string[];
  createdAt: number;
};
```

UI 放置建议：

- 输入框工具栏保留一个魔法棒按钮。
- 点击直接执行默认智能优化。
- 长按或右侧小箭头打开模式菜单。
- 优化完成后在输入框上方显示轻量 Apple 风格浮层：
  - 左侧：优化结果预览。
  - 右侧：差异摘要和来源。
  - 底部：接受、替换选区、复制、重新优化、撤销。

## 6. 模型策略

### 6.1 快速模型优先级

推荐顺序：

1. 用户在设置中指定的“提示词优化模型”。
2. 环境变量 `PI_AGENT_FAST_PROVIDER` + `PI_AGENT_FAST_MODEL`。
3. Agent Room quick model。
4. 当前会话模型中的轻量同族模型。
5. 模型注册表自动打分最高的快速模型。
6. 本地模板 fallback。

### 6.2 超时与降级

建议：

- 默认超时：`6s`，在输入框即时反馈和真实网络延迟之间取平衡；允许通过 `PI_AGENT_PROMPT_OPTIMIZER_TIMEOUT_MS` 调整到 `1000ms - 30000ms`。
- 最大 tokens：
  - polish: 600
  - execute/debug/review/ui: 1200
  - research/agent_room: 1600
- 失败立即 fallback，并在结果 metadata 里记录 `fallbackReason`。

### 6.3 智谱 GLM 注意事项

由于用户已接入智谱 `glm-5.1`，模型规范需要明确：

- provider/model 标准化时保留小写 `glm`。
- 模型选择 UI 中显示真实 provider 和 model id。
- 快速模型若选择 GLM，应优先选 `glm-4.5-air`、`glm-4-flash` 等轻量模型；`glm-5.1` 可作为当前会话模型，不一定适合提示词优化的快速路径。

当前实现补充（2026-05-22）：

- `PromptOptimizeInput` 已支持 `preferredOptimizerModel`。
- 后端 `selectFastModel()` 的优先级已调整为：设置页指定模型 > 环境变量快速模型 > 自动评分出的轻量快速模型 > 当前会话模型兜底。
- 模型提示上下文会记录 `preferred_optimizer_model`，方便排查“为什么优化器使用这个模型”。

## 7. 安全与隐私

提示词优化会读取用户输入和上下文，需要明确边界：

- 默认只发送用户输入文本和轻量上下文，不自动读取完整文件内容。
- 文件引用只发送路径、行号、用户已加入对话的 excerpt。
- 图片默认只发送“有图片”标记；除非未来模型支持视觉优化且用户确认。
- 不把 API Key、凭据、`.env` 内容加入优化上下文。
- telemetry 默认本地保存，不联网。
- skill 参与优化时要经过 Trust Center 判断。

## 8. API 设计草案

### 8.1 Request

```ts
type PromptOptimizeMode =
  | 'auto'
  | 'polish'
  | 'execute'
  | 'debug'
  | 'review'
  | 'research'
  | 'ui'
  | 'agent_room';

interface PromptOptimizeInput {
  text: string;
  mode?: PromptOptimizeMode;
  language?: 'zh' | 'en' | 'ja';
  selectionOnly?: boolean;
  sessionId?: string;
  projectName?: string;
  projectPath?: string;
  currentModel?: { provider: string; id: string };
  preferredOptimizerModel?: { provider: string; id: string };
  fileReferences?: PromptFileReference[];
  imageReferences?: PromptImageReference[];
  sessionContext?: PromptSessionContext;
  workspaceContext?: PromptWorkspaceContext;
  options?: {
    concise?: boolean;
    includeVerification?: boolean;
    preserveTone?: boolean;
    previewOnly?: boolean;
  };
}
```

### 8.2 Response

```ts
interface PromptOptimizeResult {
  optimized: string;
  source: 'model' | 'local' | 'skill';
  mode: PromptOptimizeMode;
  durationMs: number;
  provider?: string;
  modelId?: string;
  skillName?: string;
  qualityScore?: number;
  changedIntentRisk?: 'low' | 'medium' | 'high';
  warnings?: string[];
  fallbackReason?: string;
}
```

## 9. 实施计划

### 阶段 A：P0 稳定化

- 检查并修复中文模板编码。
- 抽离前端 fallback，后端统一负责模板。
- 添加后端快照测试：
  - 中文输入。
  - 英文输入。
  - 带路径输入。
  - 带文件引用输入。
  - 模型超时 fallback。
- 前端增加撤销最近一次优化。
- 后端增加 output guard。

预估：0.5 - 1 天。

### 阶段 B：P1 模式化与上下文

- 扩展 PromptOptimizeInput/Result 类型。
- 前端收集 fileReferences、sessionContext、workspaceContext。
- 后端实现 mode-detector。
- 为每个 mode 增加模板。
- 输入框优化按钮增加模式菜单。
- 优化结果改为可预览 diff。

预估：1.5 - 2.5 天。

### 阶段 C：P2 Skill 集成

- 新增内置 `prompt-engineering-expert` skill。
- 后端读取当前启用 skill。
- Trust Center 判断 skill 是否允许参与优化。
- 优化结果 metadata 展示 skill 来源。
- Skills 页面增加“设为提示词优化 skill”入口。

预估：1 - 2 天。

### 阶段 D：P3 质量闭环

- 增加本地 telemetry。
- 优化结果支持“更短 / 更详细 / 更可执行 / 更适合研究”。
- 保存好例子到项目 skill。
- 增加质量 dashboard。

预估：2 - 3 天。

## 10. 测试计划

### 10.1 自动化测试

- `prompt-optimizer-service` 单元测试。
- 模型选择测试。
- 模板输出快照测试。
- 中文乱码检测测试。
- API schema 测试。
- 前端组件测试：选区替换、撤销、预览接受。

建议测试命令：

```powershell
npm.cmd run typecheck:server
npm.cmd run typecheck:frontend
npm.cmd run build
```

### 10.2 手工测试用例

| 场景 | 输入 | 期望 |
| --- | --- | --- |
| 简单中文任务 | “帮我修一下登录报错” | 输出可执行调试 prompt，无乱码 |
| 选区优化 | 只选中一句模糊描述 | 只替换选区 |
| 文件引用 | 输入带已加入对话的文件 | 输出包含文件路径和使用方式 |
| UI 任务 | “苹果风格优化这个页面” | 输出视觉、交互、验收截图要求 |
| 研究任务 | “分析 Electron 是否迁移 Tauri” | 输出资料来源、对比维度、结论格式 |
| 多 Agent 任务 | “让多个 agents 辩论这个方案” | 输出双方视角、中立评审、证据标准 |
| 无模型 | 未配置 API Key | 使用本地 fallback，且提示来源 |
| 模型超时 | 快速模型默认 6s 未返回 | fallback，不阻塞输入框 |

## 11. 发布验收标准

- 优化按钮响应稳定，模型失败不会卡死。
- 中文、英文、日文输出均正常。
- 用户可以预览、接受和撤销优化结果。
- 设置页能选择提示词优化模型。
- 能通过 skill 改变优化策略。
- 不会把敏感文件内容自动发送给模型。
- 优化结果能显著提高任务可执行性，特别是代码修改、调试、UI 优化、多 Agent 分析四类场景。

## 12. 建议优先级

近期优先做：

1. P0 编码修复和后端统一 fallback。
2. P1 模式菜单和上下文增强。
3. 设置页增加“提示词优化模型”。（已完成）
4. 优化结果预览与撤销。
5. 接入 `prompt-engineering-expert` skill。

这些能力完成后，提示词优化就会从“魔法棒润色”升级为 Pi Agent Desktop 的任务编排入口。
