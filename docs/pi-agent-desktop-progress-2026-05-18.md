# Pi Agent Desktop 进度自评 - 2026-05-18

## 最新实现记录：Per-session Thinking 与 Project Launcher

| 模块 | 新增进展 | 对齐效果 |
| --- | --- | --- |
| Per-session Thinking | `Session/SessionData` 增加 `thinkingLevel`，`set_thinking_level` 支持 `sessionId`，ChatInput/StatusBar/Usage Panel 均按当前 session 读取和写回 thinking。 | 补齐 per-session runtime config 的关键一块，多会话不再共享同一个 thinking 强度。 |
| Runtime 同步 | 服务端将 `applySessionRuntimeModel` 升级为 `applySessionRuntimeConfig`，在 `prompt/steer/follow_up` 前同时同步 session model 与 thinking。 | 避免 UI 已切换但真实 Pi runtime 仍沿用旧配置。 |
| 最近项目 API | 新增 `/api/projects/recent`，从历史 session 与当前工作区聚合项目、真实路径、分支、session 数、Git 状态。 | 向 cc-haha 的 recent projects / repository picker 靠齐。 |
| 仓库上下文 API | 新增 `/api/repository/context`，返回 repo root、当前分支、默认分支、dirty 状态、branches、worktrees。 | 为分支选择、dirty warning、worktree launch 提供真实数据源。 |
| ProjectLauncher UI | 空状态新增项目启动面板，支持最近项目、路径输入、原生目录选择、分支选择、dirty warning、隔离 worktree 开关和一键 Launch。 | 新会话入口从简单按钮升级为接近 cc-haha `RepositoryLaunchControls` 的启动体验。 |
| Branch/worktree session_create | `session_create` 支持 `branch/worktree`；启用 worktree 时服务端创建 `pi-desktop/...` 独立 worktree 并以该目录启动 session。 | 可以在不污染当前工作区的情况下从目标分支启动会话。 |

## 最新自评分（七次更新）

| 维度 | 上一评分 | 当前评分 | 说明 |
| --- | ---: | ---: | --- |
| 总体交互完成度 | 88 | 90 | 新会话项目/分支/worktree 启动体验补上后，cc-haha 的一个 P0 差距已明显缩小。 |
| 输入器与启动体验 | 86 | 90 | Composer 控制条、动态 slash、session draft、文件上下文、ProjectLauncher 已形成完整入口链路。 |
| Provider/模型/Thinking | 83 | 86 | model + thinking 均已 session 化；仍缺 baseURL/proxy/OAuth 与更完整 provider diagnostics。 |
| Workspace/Diff | 74 | 75 | 本轮主要补启动链路，Workspace 剩余 hunk accept/reject、Markdown/Shiki、line comment。 |
| 测试与发布质量 | 80 | 82 | smoke 新增 per-session thinking、recent projects、repository context；仍缺组件/Store/API 测试。 |

综合评分：**90/100**。

## 最新验证（七次更新）

| 命令 | 结果 |
| --- | --- |
| `npm.cmd run typecheck` | 通过 |
| `npm.cmd run build` | 通过，仍有 Vite 大 chunk warning |
| `npm.cmd run server:smoke` | 通过，覆盖 per-session model/thinking、recent projects、repository context、permissions |
| `npm.cmd run desktop:smoke` | 通过 |

参考目标：持续对齐 [NanmiCoder/cc-haha](https://github.com/NanmiCoder/cc-haha) 的桌面端交互体验，同时保持 pi-agent 的可扩展运行时和插件生态入口。

## 本轮新增能力

| 模块 | 进展 | 对 cc-haha 差距的影响 |
| --- | --- | --- |
| 真实运行时权限 | `PiAgentRuntime` 在 SDK `beforeToolCall` 中拦截 `bash`、`write`、`edit`，并接入桌面权限弹窗；`acceptEdits`、`plan`、`bypassPermissions` 现在会影响真实 runtime。 | 权限不再只停留在 mock 层，已进入“真实工具执行前可控”的阶段。 |
| 运行时状态 | WebSocket `connected/runtime_updated` 返回 runtime 信息，状态栏展示 `Pi SDK` 或 `Mock Fallback`，fallback 会 toast 提醒。 | 解决用户不知道当前是否在跑真实 agent 的问题。 |
| 凭证配置 | 新增 `/api/auth/status`、`POST /api/auth/api-key`、`DELETE /api/auth/api-key`，Settings 新增 Credentials 页。 | 用户可在桌面端直接配置 provider API Key，不再依赖 CLI/环境变量。 |
| Provider 枚举 | Auth 状态从 Pi SDK `ModelRegistry` 枚举所有 provider，不再只列常见 provider。 | 自定义 provider 或当前环境可用 provider 不会在 UI 中隐身。 |
| 真实模型目录 | WebSocket 初始 `providers` 优先读取 Pi SDK 当前可用模型；保存/移除凭证后通过 `auth_refresh` 刷新前端模型列表。 | 模型选择开始从 mock 数据切到真实可用模型，向 cc-haha 的 provider/model 体验靠拢。 |
| SDK 打包方式 | 服务端 bundle 将 `@earendil-works/pi-coding-agent` external，避免 AuthStorage 在 CJS bundle 内路径推导失效。 | 桌面壳启动和凭证接口在构建产物中可用。 |
| 回归烟测 | `server:smoke` 增加 `/api/auth/status` 校验；保留 WS prompt 和 permission deny 链路验证。 | 后续改动更不容易悄悄破坏认证/运行时主链路。 |

## 当前自评分

| 维度 | 上轮估计 | 当前评分 | 说明 |
| --- | ---: | ---: | --- |
| 总体交互完成度 | 62 | 72 | 已从“桌面 MVP + mock 主链路”推进到“真实 runtime、真实权限、真实凭证、真实模型目录的可用闭环”。 |
| 桌面壳与启动恢复 | 76 | 78 | Electron 过渡壳、动态端口、诊断、托盘、烟测稳定；仍不是 Tauri/正式安装器路线。 |
| 真实 PiAgentRuntime | 48 | 66 | SDK 会话、事件映射、工具权限、模型/思考同步、auth refresh 均已接入；长会话 resume/fork 仍缺。 |
| Provider/模型体验 | 35 | 68 | 从 mock provider 提升到 SDK AuthStorage + ModelRegistry + Settings Credentials；OAuth、连接测试、per-session model 仍缺。 |
| 权限系统 | 38 | 64 | 真实 SDK 工具已拦截，权限模式已同步；还缺 scoped rule、diff 预览、审计日志。 |
| Workspace/Diff | 55 | 55 | 本轮未显著推进，仍需多文件 tabs、分块采纳、选择区域加入聊天。 |
| 测试与发布质量 | 64 | 70 | typecheck/build/server smoke/desktop smoke 均通过，auth endpoint 已纳入 smoke；仍缺 store/API 单测和 packaged 全量回归。 |

综合评分：**72/100**。

## 已验证命令

| 命令 | 结果 |
| --- | --- |
| `npm.cmd run typecheck` | 通过 |
| `npm.cmd run build` | 通过，仍有 Vite 大 chunk warning |
| `npm.cmd run server:smoke` | 通过 |
| `npm.cmd run desktop:smoke` | 通过 |

## 继续实现记录：Composer Runtime Controls 与动态 Slash Commands

| 模块 | 新增进展 | 对齐效果 |
| --- | --- | --- |
| 服务端 slash commands | 新增 `pi-server/slash-commands.ts`，`connected` 协议下发 `slashCommands`，package install/remove 后推送 `slash_commands_updated`。 | 输入器命令来源从本地硬编码升级为服务端能力清单，后续能接 runtime/extension 命令。 |
| Slash 回归 | `server:smoke` 增加 connected slash command 断言。 | 避免后续协议调整导致命令菜单静默失效。 |
| Composer 模型控件 | ChatInput 上方新增模型选择弹层，直接发送 `set_model`。 | 模型切换从 Settings/StatusBar 前移到输入器，接近 cc-haha 的操作路径。 |
| Composer 权限控件 | ChatInput 上方新增权限模式弹层，直接同步 `set_permission_mode`。 | 用户能在发消息前切换 Ask/Edits/Plan/Bypass，不再绕到设置页。 |
| Composer Thinking 控件 | ChatInput 上方新增 thinking level 弹层，直接发送 `set_thinking_level`。 | 思考强度成为每轮输入前可见的上下文，而不是隐藏状态。 |
| Composer Context Usage | ChatInput 内显示当前 session + 草稿 + 文件引用 + 图片附件的上下文估算，并可一键打开 Usage 面板。 | 上下文压力从右栏分析能力变成输入时的实时提示。 |

## 最新自评分（五次更新）

| 维度 | 上一评分 | 当前评分 | 说明 |
| --- | ---: | ---: | --- |
| 总体交互完成度 | 84 | 86 | Composer 已具备模型/权限/thinking/context/动态 slash 的核心操作密度。 |
| 输入器体验 | 80 | 86 | 已接近 cc-haha 主路径；剩余差距是 runtime 原生命令源、RepositoryLaunchControls、附件 gallery 细节。 |
| Provider/模型体验 | 74 | 78 | 模型选择入口前移到输入器；仍缺 per-session model config、baseURL/proxy、OAuth。 |
| 测试与发布质量 | 78 | 79 | server smoke 覆盖 slashCommands；仍需组件测试和 packaged 回归。 |

综合评分：**86/100**。

## 最新验证（五次更新）

| 命令 | 结果 |
| --- | --- |
| `npm.cmd run typecheck` | 通过 |
| `npm.cmd run build` | 通过，仍有 Vite 大 chunk warning |
| `npm.cmd run server:smoke` | 通过，覆盖 connected slashCommands |
| `npm.cmd run desktop:smoke` | 通过 |

## 继续实现记录：Per-session Model Config

| 模块 | 新增进展 | 对齐效果 |
| --- | --- | --- |
| Session 模型持久化 | `SessionData/Session` 增加 `modelProvider`，新建 session 会保存默认 provider/model，老 session 会按 `modelId` 兼容推断。 | 多会话不再只能共享一个全局模型状态。 |
| 当前会话模型切换 | `set_model` 协议支持 `sessionId`；ChatInput 模型选择只更新当前 session，并通过 `session_updated` 回写前端。 | 接近 cc-haha 的 per-session runtime config，用户可让不同会话保留不同模型。 |
| Runtime 同步 | 服务端在 `prompt/steer/follow_up` 前调用当前 session 的模型配置同步 runtime。 | 避免多会话切换后 runtime 仍使用上一个全局模型。 |
| Usage/Composer 估算 | ChatInput 与右侧 Usage 面板按当前 session 的模型 context window 估算上下文。 | 上下文压力提示与会话实际模型一致。 |
| Smoke 覆盖 | `server:smoke` 增加 session 级 `set_model` 与 `session_updated.modelProvider/modelId` 校验。 | per-session model 进入协议回归。 |

## 最新自评分（六次更新）

| 维度 | 上一评分 | 当前评分 | 说明 |
| --- | ---: | ---: | --- |
| 总体交互完成度 | 86 | 88 | per-session model 初版补上后，多会话工作台更接近 cc-haha。 |
| Provider/模型体验 | 78 | 83 | provider/model 已能按 session 持久化；仍缺 per-session thinking、baseURL/proxy、OAuth。 |
| 真实 PiAgentRuntime | 70 | 73 | prompt/steer/follow_up 前按 session 模型同步 runtime；SDK 原生 session resume/fork 仍待补。 |
| 测试与发布质量 | 79 | 80 | smoke 覆盖 per-session model；仍缺组件测试和 packaged 全量回归。 |

综合评分：**88/100**。

## 最新验证（六次更新）

| 命令 | 结果 |
| --- | --- |
| `npm.cmd run typecheck` | 通过 |
| `npm.cmd run build` | 通过，仍有 Vite 大 chunk warning |
| `npm.cmd run server:smoke` | 通过，覆盖 per-session model 与 slashCommands |
| `npm.cmd run desktop:smoke` | 通过 |
| `npm.cmd run build` | 通过，仍有 Vite 大 chunk warning |
| `npm.cmd run server:smoke` | 通过，覆盖 `/api/auth/status`、WS prompt、permission deny |
| `npm.cmd run desktop:smoke` | 通过，Electron shell 可启动内置 server |

## 仍然落后 cc-haha 的关键点

| 优先级 | 缺口 | 下一步 |
| --- | --- | --- |
| P0 | 会话 resume/fork/tree 仍是协议占位 | 对齐 Pi SDK session manager，把桌面 session 与 SDK session 文件绑定。 |
| P0 | 权限弹窗还没有 edit/write diff 预览 | 在工具调用前后读取 workspace diff，给 file edit/write 做专属确认 UI。 |
| P0 | Workspace Panel 还不具备 cc-haha 的高密度 diff tabs | 将 Changes/Files 右栏升级为多 tab preview、diff、文件树过滤和“加入聊天”操作。 |
| P1 | Provider 只有 API Key，缺 OAuth/连接测试/错误诊断 | 在 Credentials row 增加 test action、错误详情、OAuth provider 入口。 |
| P1 | 模型选择仍偏全局 | 引入 per-session model/thinking state，并处理运行中切换策略。 |
| P1 | 性能警告仍存在 | 继续拆 Shiki/语言包和 Mermaid，降低首屏 chunk。 |
| P2 | 远程入口、Computer Use、计划任务、Teams | 作为插件化或后续模块推进，不应阻塞核心开发工作流。 |

## 下一轮建议

1. 优先补 **会话恢复与 fork/tree**，这是从“可聊”到“可信长期工作台”的核心差距。
2. 然后补 **edit/write 权限 diff 预览**，让真实文件修改的信任感接近 cc-haha。
3. 同步推进 **Workspace Panel tabs + add-to-chat**，把右侧栏从查看器升级为开发工作流的一部分。
4. 最后做 **Provider 测试与诊断**，让 API Key 配错时用户能在设置页内定位，而不是等 prompt 失败。

## 继续实现记录

| 模块 | 新增进展 | 对齐效果 |
| --- | --- | --- |
| Session Tree | 右侧 `Session Tree` 不再是占位：展示当前会话 checkpoint 时间线、父会话链路和子 fork 列表。 | 从“只有会话列表”推进到可追踪会话分支，接近 cc-haha 的长会话工作台感。 |
| Session Fork | 服务端实现 `session_fork`，可从任意消息 checkpoint 或 latest fork；fork 会复制历史消息并创建新 session。 | 用户可在关键节点开分支尝试不同方案，不再只能线性聊天。 |
| Fork 持久化 | `SessionData` 增加 `parentSessionId`、`forkedFromMessageId`、`forkedAt`；fork 后消息写入 `.pi-agent-desktop/messages`。 | 重启后可保留 fork 关系与历史上下文。 |
| 权限预览 | `PermissionRequest` 增加 `preview`；真实 Pi SDK runtime 在 `bash/edit/write` 前生成动作专属 preview。 | 权限弹窗从 JSON 参数升级为“命令/文件变更”可读确认。 |
| Bash 权限 UI | 权限弹窗展示 shell command 与 cwd。 | 高风险命令确认更接近开发者预期。 |
| Edit/Write 权限 UI | 权限弹窗展示目标路径、操作摘要和拟议 diff 预览。 | 真实文件修改前有可视化信任锚点，是追平 cc-haha 的关键一步。 |
| Smoke 覆盖 | `server:smoke` 现在覆盖 auth status、fork 消息复制、permission preview、permission deny。 | 协议层回归更扎实。 |

## 更新后自评分

| 维度 | 上一评分 | 当前评分 | 说明 |
| --- | ---: | ---: | --- |
| 总体交互完成度 | 72 | 77 | 补上了 session fork/tree 与权限预览两个 P0 体验点。 |
| 真实 PiAgentRuntime | 66 | 70 | 工具权限前置预览已进入真实 runtime；仍待 SDK 原生 session resume/fork 绑定。 |
| 权限系统 | 64 | 74 | `bash/edit/write` 有专属 preview；仍缺 scoped allow rule、审计日志、真实 edit 后 diff 对照。 |
| 会话管理 | 55 | 68 | 有 timeline/fork/parent-child 关系；仍缺 rewind 到 checkpoint、SDK session 文件绑定、复杂树布局。 |
| Workspace/Diff | 55 | 60 | 权限弹窗已有拟议 diff，右栏还需要多 tab 与分块采纳。 |
| 测试与发布质量 | 70 | 72 | smoke 覆盖 fork 与 permission preview；仍缺前端组件单测和 packaged 全量回归。 |

综合评分：**77/100**。

## 本轮新增验证

| 命令 | 结果 |
| --- | --- |
| `npm.cmd run typecheck` | 通过 |
| `npm.cmd run server:smoke` | 通过，覆盖 fork 与 permission preview |
| `npm.cmd run build` | 通过，仍有 Vite 大 chunk warning |
| `npm.cmd run desktop:smoke` | 通过 |

## 继续实现记录：Scoped Permission Rules

| 模块 | 新增进展 | 对齐效果 |
| --- | --- | --- |
| 权限规则持久化 | 新增 `.pi-agent-desktop/permissions/rules.json` 与 `audit.json`，`Allow & Remember` 不再只是当前连接内存状态。 | 重启后仍能记住用户明确授权过的高频动作，接近 cc-haha 的连续开发体验。 |
| 权限作用域 | 权限弹窗新增 `Session / Project / Global` 记忆范围；服务端按 session、project path、global 分级匹配。 | 解决原先 “Always Allow = 当前 session 全工具名放行” 过粗的问题。 |
| 精细匹配 | Bash 规则记录命令前缀，文件规则记录目标路径，并受风险等级约束。 | 可以只记住 `npm run build` 或某个文件路径，而不是粗暴放开所有 shell/edit。 |
| 审计日志 | 每次 allow、deny、always allow、权限模式自动决策、规则命中都会写入 audit。 | 后续可在诊断页追踪“为什么这个工具被放行/拒绝”。 |
| REST 管理 | 新增 `/api/permissions/rules`、`/api/permissions/audit` 查询与删除能力。 | 规则可被设置页管理，不需要手动编辑本地数据文件。 |
| 设置页管理 | Settings > Permissions 增加 saved rules 列表、删除、清空、recent decisions。 | 用户能回收授权，权限体验从一次性弹窗升级为可维护的安全面板。 |
| Smoke 覆盖 | `server:smoke` 扩展为先 deny 一次，再 project scoped remember 一次，并校验规则与审计落盘。 | 权限规则链路进入自动化回归范围。 |

## 最新自评分

| 维度 | 上一评分 | 当前评分 | 说明 |
| --- | ---: | ---: | --- |
| 总体交互完成度 | 77 | 80 | 权限从“可预览确认”提升为“可记忆、可回收、可审计”，真实桌面工作流更连贯。 |
| 权限系统 | 74 | 82 | 已具备 preview、scope、持久化 rule、audit、设置页管理；仍缺命令参数编辑、规则模式更细粒度 UI、执行后 diff 对照。 |
| 设置与诊断 | 68 | 72 | Permissions 页开始承担真实安全管理职责；Provider test、runtime diagnostics 仍需继续补。 |
| 测试与发布质量 | 72 | 75 | 协议 smoke 覆盖权限规则持久化；仍缺前端组件测试和 packaged 安装包回归。 |

综合评分：**80/100**。

## 最新验证

| 命令 | 结果 |
| --- | --- |
| `npm.cmd run typecheck` | 通过 |
| `npm.cmd run server:smoke` | 通过，覆盖 permission deny、project scoped remember、规则与审计查询 |
| `npm.cmd run build` | 通过，仍有 Vite 大 chunk warning |
| `npm.cmd run desktop:smoke` | 通过 |

## 继续实现记录：Provider Test Diagnostics

| 模块 | 新增进展 | 对齐效果 |
| --- | --- | --- |
| Provider 测试 API | 新增 `POST /api/auth/test`，基于 Pi SDK `ModelRegistry` 验证 provider 是否有注册模型、是否配置凭证、是否能解析 API key/headers。 | 用户不用等到发 prompt 失败，能在设置页直接确认 provider 凭证链路是否可用。 |
| 轻量诊断策略 | Test 不向远程模型发请求，不消耗 token；只验证本地 auth/model registry 的可用性。 | 保持桌面端轻量，也避免测试按钮产生不可控费用。 |
| Credentials UI | 每个 provider 行新增 `Test` 按钮，显示成功/警告状态、耗时、可用模型数量、凭证来源和测试模型。 | Settings 从“保存 key”升级到“保存 + 诊断 + 反馈”的闭环。 |
| Smoke 覆盖 | `server:smoke` 增加 `/api/auth/test` 响应结构校验。 | Provider 诊断 API 进入自动化回归范围。 |

## 最新自评分（二次更新）

| 维度 | 上一评分 | 当前评分 | 说明 |
| --- | ---: | ---: | --- |
| 总体交互完成度 | 80 | 81 | Provider 测试补上设置页的反馈闭环，日常配置体验更接近成熟桌面端。 |
| Provider/模型体验 | 68 | 74 | 已有凭证保存、删除、刷新模型列表、Test 诊断；仍缺 OAuth 登录入口、真实远程 ping、per-session model。 |
| 设置与诊断 | 72 | 76 | Permissions 与 Credentials 都具备可操作诊断；还需要统一 Diagnostics 页面聚合 runtime/provider/workspace 信息。 |
| 测试与发布质量 | 75 | 76 | smoke 继续覆盖 auth test；仍缺组件级测试和安装包 smoke。 |

综合评分：**81/100**。

## 最新验证（二次更新）

| 命令 | 结果 |
| --- | --- |
| `npm.cmd run typecheck` | 通过 |
| `npm.cmd run server:smoke` | 通过，覆盖 auth status、auth test、permission rules/audit |
| `npm.cmd run build` | 通过，仍有 Vite 大 chunk warning |
| `npm.cmd run desktop:smoke` | 通过 |

## 继续实现记录：Workspace Preview Tabs 与选区上下文

| 模块 | 新增进展 | 对齐效果 |
| --- | --- | --- |
| Workspace 多预览 | RightPanel 的 Changes/Files 预览区从单一 preview 升级为多 tab，可同时打开多个文件和 diff，并支持关闭/切换。 | 更接近 cc-haha 的 workspace preview tabs，用户不用反复丢失当前查看位置。 |
| 行号选区 | 文件和 diff 预览支持点击行号选择单行，Shift+点击选择范围。 | 为“把具体代码片段加入下一轮 prompt”打下直接交互基础。 |
| 选区加入聊天 | 预览头部在选中行后显示 `Lx-Ly` 操作，可把当前选区作为 `<file_selection>` 上下文发送给 ChatInput。 | 从“添加整个文件”升级为“精准添加片段”，减少上下文浪费，体验明显靠近 cc-haha。 |
| 输入器引用增强 | ChatInput 的 workspace reference 支持 `lineStart/lineEnd/excerpt/sourceKind`，chip 和 display text 会显示 `@file:Lx-Ly`。 | 用户能看清下一条消息携带的是整文件还是具体行范围。 |
| Prompt 构造 | 有 excerpt 的引用直接以内联选区发送；普通文件引用仍按需读取 workspace 文件。 | 保持轻量，同时提升长文件场景的上下文效率。 |

## 最新自评分（三次更新）

| 维度 | 上一评分 | 当前评分 | 说明 |
| --- | ---: | ---: | --- |
| 总体交互完成度 | 81 | 83 | WorkspacePanel 补上多 tab 与选区上下文，真实开发流的操作密度提升明显。 |
| Workspace/Diff | 60 | 72 | 已有 Changes/Files、diff/file preview、多 tab、文件/选区加入聊天；仍缺 hunk accept/reject、图片/Markdown 更强预览、实时 git watch。 |
| 输入器体验 | 74 | 78 | 文件引用从整文件扩展到行范围/片段上下文；仍缺动态 slash command 和更完整拖拽非图片文件。 |
| 测试与发布质量 | 76 | 77 | typecheck/build/server smoke/desktop smoke 继续通过；前端交互仍主要靠构建检查，后续应补组件测试。 |

综合评分：**83/100**。

## 最新验证（三次更新）

| 命令 | 结果 |
| --- | --- |
| `npm.cmd run typecheck` | 通过 |
| `npm.cmd run build` | 通过，仍有 Vite 大 chunk warning |
| `npm.cmd run server:smoke` | 通过 |
| `npm.cmd run desktop:smoke` | 通过 |

## 继续实现记录：Composer 文件上下文与 Preview Tab 菜单

| 模块 | 新增进展 | 对齐效果 |
| --- | --- | --- |
| 文本文件拖拽 | ChatInput 支持拖拽/选择普通文本文件，并作为 inline `<file_selection>` 上下文发送。 | 补齐 cc-haha Composer 附件体验的一部分，不再只有图片和 workspace 文件引用。 |
| 附件安全边界 | 文本附件限制 512KB，跳过二进制和未知格式；图片仍按 base64 image attachment 处理。 | 在增强交互的同时保持轻量和可控。 |
| Preview Tab 右键菜单 | Workspace preview tabs 支持 Close、Close others、Close left/right、Close all。 | 多文件/diff 查看体验更接近 cc-haha。 |
| Usage 面板 | 右栏 Usage 面板展示 session token、cost、context 估算、最近 usage 和工具/消息计数。 | 用户开始具备上下文压力感知。 |

## 最新自评分（四次更新）

| 维度 | 上一评分 | 当前评分 | 说明 |
| --- | ---: | ---: | --- |
| 总体交互完成度 | 83 | 84 | 输入器普通文件上下文和 preview tab 管理补齐后，主工作台日常操作更顺。 |
| Workspace/Diff | 72 | 74 | 多 tab 管理继续接近 cc-haha；仍缺 hunk accept/reject、Markdown/Shiki 预览和行评论。 |
| 输入器体验 | 78 | 80 | 支持普通文本文件拖拽/选择为上下文；仍缺动态 slash、Composer 内模型/权限/context usage。 |
| 测试与发布质量 | 77 | 78 | typecheck/build/server smoke/desktop smoke 均通过；仍需组件测试和 packaged 回归。 |

综合评分：**84/100**。

## 最新验证（四次更新）

| 命令 | 结果 |
| --- | --- |
| `npm.cmd run typecheck` | 通过 |
| `npm.cmd run build` | 通过，仍有 Vite 大 chunk warning |
| `npm.cmd run server:smoke` | 通过 |
| `npm.cmd run desktop:smoke` | 通过 |
