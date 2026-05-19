# Pi Agent Desktop 落地方案

> 生成日期：2026-05-17  
> 目标：将当前 `pi-agent` GUI 原型落地为可发布的轻量桌面端软件，并在交互体验上达到或超越 `NanmiCoder/cc-haha`。

## 0. 当前执行状态

截至 2026-05-17，本方案已从纯 Web 原型推进到 **Electron 过渡桌面壳 MVP**：

- 根工程已启用 `desktop` workspace，并提供 `desktop:dev`、`desktop:preview`、`desktop:smoke` 脚本。
- Electron 主进程已具备动态端口、server 子进程生命周期、单实例、托盘、窗口状态保存、原生菜单、项目目录选择和启动诊断。
- 前端已能从桌面壳获取 serverUrl，启动失败时展示日志与重试入口，并提供 Desktop Diagnostics 弹层。
- 已补齐 Electron 目录级打包链路：`desktop:pack` 生成 `release/win-unpacked`，`desktop:smoke:packaged` 验证打包后 exe 可自启动内置 server。
- 本轮验证通过：`npm.cmd run typecheck`、`npm.cmd run build`、`npm.cmd --workspace desktop run smoke`、`npm.cmd run desktop:pack`、`npm.cmd run desktop:smoke:packaged`。

后续仍建议按原计划迁移/补齐 Tauri 或独立 sidecar 打包能力；在本机 Rust/Cargo 未就绪的情况下，Electron 壳先用于快速验证桌面交互闭环。当前 Electron 打包为 MVP 配置，尚未加入正式图标、签名、安装器验证与 asar 优化。

## 1. 调研范围

本方案基于以下材料：

- 当前仓库：`pi-desktop` 根项目、`frontend`、`pi-server`。
- 参考项目：[`NanmiCoder/cc-haha`](https://github.com/NanmiCoder/cc-haha)，重点参考其 Tauri 2 + React + sidecar 的桌面端架构、动态端口、本地服务、WebSocket 通信、插件/Skills/设置/任务/权限等模块组织方式。
- 构建校验：本地已通过 `npm.cmd run typecheck`、`npm.cmd run build` 与 `npm.cmd --workspace desktop run smoke`。

## 2. 当前项目框架分析

### 2.1 顶层结构

```text
.
├── package.json
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── api/
│       ├── components/
│       ├── stores/
│       ├── types/
│       ├── App.tsx
│       └── index.css
└── pi-server/
    ├── package.json
    ├── index.ts
    ├── mock-agent.ts
    ├── types.ts
    └── build.ts
```

根项目目前只负责编排脚本，未启用 npm workspaces。`dev` 脚本依赖 `concurrently`，但根 `package.json` 未声明该依赖；`frontend` 与 `pi-server` 各自有独立 `package-lock.json`，依赖需要分别安装。

### 2.2 技术栈

| 层级 | 当前选型 | 作用 | 状态 |
| --- | --- | --- | --- |
| 前端 | React 19 + TypeScript + Vite 6 | 桌面 UI 原型 | 已搭建 |
| 状态管理 | Zustand 5 | 会话、UI、模型、扩展、设置 | 已搭建，存在重复 store |
| 样式 | Tailwind CSS 4 + CSS Variables | Pi 主题 token 与暗色 UI | 已搭建 |
| 消息渲染 | marked + DOMPurify + Shiki + react-virtuoso | Markdown、安全清洗、代码高亮、虚拟列表 | 已搭建 |
| 本地服务 | Node HTTP + `ws` | REST + WebSocket 网关 | mock 状态 |
| Agent SDK | `@earendil-works/pi-coding-agent` | pi-agent 核心能力 | 仅声明依赖，尚未接入 |
| 构建 | esbuild + Vite | server bundle + frontend bundle | 已通过 typecheck/build |
| 桌面壳 | Electron 过渡壳 | 原生窗口、动态端口、server 生命周期、托盘/菜单/诊断 | MVP 已实现，待 Tauri/打包 |

`pi-server/package-lock.json` 当前锁定 `@earendil-works/pi-coding-agent`、`pi-agent-core`、`pi-ai`、`pi-tui` 为 `0.74.0`，但 `pi-server/index.ts` 仍完全导入 `mock-agent.ts`，没有真实调用 pi SDK。

### 2.3 前端模块划分

| 模块 | 主要文件 | 现有能力 |
| --- | --- | --- |
| 应用入口 | `frontend/src/App.tsx` | 初始化设置、连接 WebSocket、根据视图切换渲染 Chat/Settings/Packages/Themes |
| 布局 | `components/layout/*` | 顶部 TabBar、左侧 Sidebar、右侧面板、底部 StatusBar、权限弹层、Toast |
| 聊天 | `components/chat/*` | 输入框、欢迎页、消息列表、消息气泡、工具调用卡、Thinking 折叠块、权限确认 |
| Markdown | `components/markdown/MarkdownRenderer.tsx` | marked 解析、DOMPurify 清洗、Shiki 异步高亮 |
| 设置 | `components/settings/*` | 通用设置、权限模式、模型列表、主题、包管理页面骨架 |
| 状态 | `stores/*` | chat/ui/settings/model/extension 多个 Zustand store |
| 类型 | `types/index.ts` | 会话、消息、模型、主题、扩展、任务、Git、WS 协议类型 |

界面层已经有较好的产品雏形：多会话列表、标签页、流式消息展示组件、工具卡片、权限弹窗、设置页、包/主题管理页、右侧 Changes/Files/Tree/Usage 面板等都已经有骨架。

### 2.4 服务端模块划分

| 模块 | 主要文件 | 现有能力 |
| --- | --- | --- |
| HTTP/WS 入口 | `pi-server/index.ts` | `/health`、`/api/sessions`、`/api/models`、WebSocket 消息分发 |
| Mock Agent | `pi-server/mock-agent.ts` | 内存会话、mock 模型、mock 包/主题、模拟 Thinking/Tool/Permission/Text 流 |
| 协议类型 | `pi-server/types.ts` | 与前端基本一致的 WS Client/Server 消息类型 |
| 构建脚本 | `pi-server/build.ts` | esbuild bundle 到 `dist/server.js`，外部化 pi 相关包 |

服务端采用单进程内存状态，没有持久化，没有真实 pi-agent 运行时，没有权限回传闭环，没有 per-session agent 进程隔离。当前 `AbortController` 被创建并存入 `activeResponses`，但 `simulateAgentResponse` 没有接收 signal，因此 stop/delete 对正在等待的 mock 流程不是完整中断。

### 2.5 WebSocket 协议现状

前后端类型都已经定义了较完整的协议：

- Client -> Server：`prompt`、`steer`、`follow_up`、`permission_response`、`stop_generation`、`set_model`、`set_thinking_level`、`session_create/delete/rename`、`session_compact/fork`、`package_install/remove`、`theme_set`。
- Server -> Client：`connected`、`status`、`text_start/delta/end`、`thinking_start/delta/end`、`tool_use`、`tool_result`、`permission_request`、`message_complete`、`queue_update`、`providers/themes/packages/extensions_updated`、`file_changes`、`git_info`。

但前端 `PiApiClient.handleMessage` 只处理连接、会话、状态、权限、模型、包/扩展/主题和错误；没有把 `text_start`、`text_delta`、`thinking_*`、`tool_use`、`tool_result`、`message_complete` 写入 `chatStore`。同时 `ChatView.handleSend` 只发送 prompt，没有先追加用户消息。因此当前聊天主路径尚未真正打通。

### 2.6 当前功能完成度

| 功能 | 当前状态 | 说明 |
| --- | --- | --- |
| 会话创建/删除/重命名 | 基础可用 | 支持项目目录选择、服务端会话和前端列表 |
| 聊天发送 | mock 闭环已打通 | 用户消息、展示文本与模型上下文已分离 |
| 流式回答 | mock 闭环已打通 | 前端已消费 text/thinking/tool/message_complete |
| Thinking 展示 | 基础可用 | 支持流式聚合和折叠展示 |
| 工具调用展示 | 基础可用 | tool_use/result 已能归并到消息，仍需专属工具视图 |
| 权限弹窗 | 基础可用 | `PermissionBroker` 可等待前端 allow/deny |
| 模型/Thinking level | 部分完成 | mock providers，真实 provider/runtime 尚未接入 |
| 包/扩展/主题 | 骨架完成 | mock install/remove；无真实插件系统 |
| 右侧 Changes/Files/Tree/Usage | Changes/Files 基础可用 | 已接 workspace status/tree/file/diff，Tree/Usage 待补齐 |
| 设置持久化 | 部分完成 | `localStorage`；存在 `uiStore` 内重复 settings store |
| 桌面化 | Electron MVP | 动态端口、托盘、菜单、窗口状态、诊断和目录选择已实现 |
| 构建 | 已验证通过 | `typecheck`、`build`、`desktop smoke` 已通过 |

### 2.7 主要风险与欠账

1. **工程启动链仍需产品化**：workspaces 和核心脚本已补齐，但 CI、安装包脚本、发布态验证仍待完善。
2. **桌面壳仍需发布化**：Electron 过渡壳已可运行，但仍缺 Tauri/Rust 壳、安装包、独立 sidecar 和自动更新。
3. **真实 pi-agent 未接入**：`pi-coding-agent` 只是依赖声明，核心运行时仍是 mock。
4. **消息流仍需真实 runtime 验证**：mock 流式闭环已打通，但真实 pi-agent 事件映射和长会话性能仍待验证。
5. **状态模型重复**：`uiStore.ts` 内定义了一个 `useSettingsStore`，同时又有独立 `settingsStore.ts`，后续会造成状态不一致。
6. **持久化仍不完整**：会话和消息已初步落盘，设置、包、主题、权限规则和审计日志仍需统一持久化。
7. **缺安全边界**：HTTP CORS 为 `*`，WS 无鉴权；桌面端需要 loopback 绑定、token、权限模式与工具白名单。
8. **打包依赖不明确**：生产 bundle 外部化 pi 包后还需明确如何随 sidecar 发布。
9. **体验细节仍是原型**：模型切换器、动态 Slash 命令、终端、全局快捷键、通知、preview tabs、选区加入聊天等尚未完成。

## 3. 参考项目 `cc-haha` 可借鉴点

`cc-haha` 当前桌面端采用 Tauri 2 + React + Bun sidecar 架构，核心经验如下：

| 参考点 | `cc-haha` 做法 | 对 pi-agent 的采用策略 |
| --- | --- | --- |
| 桌面框架 | Tauri 2，Rust 主进程管理窗口与 sidecar | 采用 Tauri 2，避免 Electron 体积和内存开销 |
| 本地服务 | Bun.serve 提供 HTTP/WS，Tauri 动态分配端口 | 采用本地 server sidecar，端口由 Tauri 分配并注入前端 |
| Sidecar | 单个 compiled sidecar 通过 mode 参数运行 server/cli/adapters | 借鉴单 sidecar 多模式，但先验证 pi SDK 在 Bun/Node SEA 下的兼容性 |
| 通信 | WebView -> HTTP/WS -> sidecar -> CLI/agent 子进程 | 保持前端与 agent 解耦，利于扩展和远程/H5 复用 |
| WS 管理 | per-session 连接、心跳、重连、pending queue | 当前可从单连接起步，后续升级为 per-session 连接 |
| 桌面能力 | shell/dialog/process/updater/notification/single-instance | 分阶段接入，首版至少需要 shell、dialog、process、single-instance |
| 安全能力 | Tauri capabilities 限制 sidecar 执行 | 必须做 sidecar 命令白名单、端口鉴权和工具权限映射 |
| UI 能力 | 多会话、右侧 Diff/Changes、任务、插件、Skills、Provider、H5 | 以 pi 的 extensibility 为中心裁剪，不照搬 IM/Computer Use 等重功能 |
| 字体资源 | 桌面端自带字体资源 | 当前 Google Fonts 应改为本地字体，提升离线和启动体验 |

核心结论：**应借鉴其三层架构和桌面工程方式，而不是照搬全部功能体量。** pi-agent 桌面端要保持“极致轻量”，首版应聚焦本地编码 Agent 工作台、扩展系统、权限与高质量交互，而把 IM、H5、Computer Use、团队任务等能力作为插件或后续模块。

## 4. 产品与架构原则

1. **轻量优先**：Tauri 替代 Electron；避免大型数据库和重型 UI 框架；Shiki/Mermaid/Diff 按需加载。
2. **扩展优先**：保持 pi-agent 原有 package/skill/prompt/theme/extension 能力，桌面端只提供管理和可视化，不把扩展协议写死在 UI。
3. **运行时解耦**：前端只依赖稳定 HTTP/WS 协议；真实 agent、mock agent、未来远程 agent 都走同一协议。
4. **可渐进发布**：先打通真实本地桌面工作流，再扩展任务、插件市场、远程入口。
5. **安全默认值**：默认绑定 `127.0.0.1`；非 loopback 必须 token；所有命令/文件修改必须可审计。
6. **体验不输参考项目**：会话、流式输出、权限、Diff、模型切换、快捷键、项目切换要做到顺滑、低延迟、可恢复。

## 5. 推荐目标架构

```text
Tauri 主进程
├── 窗口生命周期、单实例、托盘、菜单、更新
├── 动态端口分配与本地 server sidecar 启停
├── 原生能力：目录选择、通知、打开文件、终端/PTY 可选
└── capabilities 白名单

React WebView
├── Chat Workspace：会话、消息流、工具、权限、Diff
├── Project Workspace：最近项目、Git 状态、文件浏览
├── Settings：模型、Provider、权限、主题、扩展、快捷键
├── Extension Center：packages/skills/prompts/themes/extensions
└── WebSocket/REST client：统一协议、重连、pending queue

Pi Server Sidecar
├── HTTP REST API：sessions/models/settings/extensions/files/git
├── WebSocket Gateway：per-session 或 multiplexed streaming
├── Agent Runtime Adapter：mock / pi-coding-agent / remote
├── Permission Broker：工具审批、规则持久化、风险分级
├── Persistence：JSONL transcript + metadata JSON，必要时加 SQLite FTS
└── Extension Registry：扫描、安装、启停、热加载、主题 token 输出

Pi Agent Runtime
├── @earendil-works/pi-coding-agent
├── pi-agent-core / pi-ai
├── tools / skills / prompts / MCP-like integrations
└── task abort / permission / streaming event adapter
```

### 5.1 Tauri 主进程设计

首版新增 `src-tauri/`：

- `tauri.conf.json`：配置 frontend dist、devUrl、bundle icon、externalBin、CSP。
- `src/lib.rs`：实现 `get_server_url`、`restart_server`、`open_project_folder`、`show_item_in_folder` 等 command。
- `capabilities/default.json`：只允许执行受控 sidecar，不允许任意 shell。
- 动态端口：主进程启动时绑定 `127.0.0.1:0` 获取端口，启动 sidecar 后等待 `/health`。
- 生命周期：窗口关闭时优雅停止 sidecar；更新前杀进程；异常退出记录启动日志。

### 5.2 Sidecar 运行时选择

建议分两步：

1. **MVP 阶段使用 Node 20/22 兼容路径**：继续保留 `pi-server` 的 Node 生态，先把真实 pi SDK 接通，避免 Bun 兼容性成为首要风险。
2. **发布阶段评估单二进制**：参考 `cc-haha` 的 Bun compile 方式，验证 `@earendil-works/*`、原生依赖、文件系统、子进程、网络代理兼容性。通过后把 server/agent/extension 管理合并为一个 `pi-sidecar`。

若 Bun compile 不稳定，采用 Node SEA、`pkg`/`nexe` 或随安装包携带精简 Node runtime 作为 fallback。最终指标是 Windows/macOS 包体可控、启动快、无需用户另装 Node。

### 5.3 前端状态设计

建议重组 store：

| Store | 职责 |
| --- | --- |
| `connectionStore` | serverUrl、connected、latency、reconnect、startup error |
| `sessionStore` | sessions、activeSessionId、tabs、recent projects |
| `chatStore` | per-session messages、stream buffer、tool calls、queue |
| `agentStore` | running status、abort、permission request、token usage |
| `modelStore` | providers、models、current model、thinking level |
| `extensionStore` | packages、skills、prompts、themes、extensions、reload state |
| `settingsStore` | language、theme、font、permission mode、layout、shortcuts |
| `workspaceStore` | git info、file changes、file tree、selected diff |
| `uiStore` | panels、modals、toasts、command palette |

需要删除 `uiStore.ts` 中重复的 `useSettingsStore`，统一使用 `stores/settingsStore.ts`。

### 5.4 服务端模块设计

建议将 `pi-server` 拆分：

```text
pi-server/src/
├── index.ts                 # 启动入口
├── server.ts                # HTTP + WS server
├── router.ts                # REST 路由注册
├── ws/
│   ├── handler.ts           # 连接、心跳、协议分发
│   └── sessionChannel.ts    # per-session 流式事件
├── agent/
│   ├── AgentRuntime.ts      # 统一接口
│   ├── MockAgentRuntime.ts
│   ├── PiAgentRuntime.ts
│   └── eventMapper.ts       # pi SDK event -> WS event
├── services/
│   ├── sessionService.ts
│   ├── modelService.ts
│   ├── permissionService.ts
│   ├── extensionService.ts
│   ├── themeService.ts
│   ├── gitService.ts
│   └── fileService.ts
├── persistence/
│   ├── paths.ts
│   ├── metadataStore.ts
│   └── transcriptStore.ts
└── types/
    └── protocol.ts
```

### 5.5 协议建议

短期保留当前 WS 协议，但补齐语义：

- `prompt`：前端发送后本地立即追加用户消息，服务端返回 assistant 流。
- `text_start/delta/end`：前端按 `messageId` 聚合。
- `thinking_start/delta/end`：聚合到同一 assistant message 的 thinking block。
- `tool_use/tool_result`：按 `toolCall.id` 归并状态，支持展开、复制、跳转文件。
- `permission_request/permission_response`：服务端必须等待用户结果，而不是 mock 自动放行。
- `file_changes/git_info`：工具执行后增量推送右侧面板。
- `message_complete`：写 usage、落 transcript、更新会话标题/时间。

中期改进：

- per-session WebSocket：降低多会话并发时的状态耦合。
- pending message queue：断线重连后恢复发送。
- `protocolVersion`：连接时协商，避免前后端协议不一致。

## 6. 功能模块设计

### 6.1 Chat 工作台

必须完成：

- 用户消息即时上屏。
- assistant 流式输出低延迟渲染，delta 合批到 16ms 或 32ms flush。
- Thinking 可折叠、可全局关闭。
- 工具调用按组展示，支持 pending/running/success/error 状态。
- 权限弹窗支持 allow once、always allow、deny，并写入规则。
- Stop generation 真实中断 agent runtime。
- Slash 命令从服务端动态加载，前端只做展示和过滤。
- 图片粘贴/拖拽保留，增加大小限制和压缩策略。

体验增强：

- Command Palette：新会话、切模型、开设置、开扩展、开项目、跳转文件。
- 多会话 Tab 可固定、关闭、恢复，正在运行的会话有明确状态。
- 会话标题由 agent 或服务端 titleService 自动生成。

### 6.2 项目与文件模块

- 原生目录选择创建会话，不再固定 `projectPath: "."`。
- 最近项目列表、项目搜索、Git 分支展示。
- 文件树按需加载，尊重 `.gitignore`。
- 右侧 Changes 面板展示新增/修改/删除文件。
- Diff Viewer 支持 unified/split、跳转到文件、复制 patch。
- Git 状态定时或工具执行后刷新，避免高频扫描。

### 6.3 模型与 Provider 模块

- 从 pi SDK 或配置读取 providers/models，而不是 mock 静态数组。
- 支持当前模型、thinking level、上下文窗口、价格/usage 显示。
- 支持 provider 测试连接和错误提示。
- 模型切换在 status bar、settings、command palette 三处一致。

### 6.4 权限与安全模块

- 权限模式：`ask`、`acceptEdits`、`plan`、`bypassPermissions`。
- 风险分级：read/list 为 low，write/edit 为 medium，shell/delete/network 为 high。
- Always Allow 必须带 scope：当前会话、当前项目、全局、工具名、命令前缀。
- 所有工具审批写入 audit log。
- Tauri capabilities 限制 sidecar；server 默认只监听 loopback。
- 非 loopback/H5 模式必须启用 token。

### 6.5 扩展系统

保持 pi-agent 的高扩展性，桌面端只做“发现、管理、反馈”：

- Packages：安装源、版本、启用状态、包含能力统计。
- Skills：用户/项目/package 来源，启停与详情。
- Prompts：模板浏览、插入聊天输入框。
- Themes：读取 pi theme token，实时应用 CSS variables，支持导入/导出。
- Extensions：统一展示 hooks/tools/MCP-like integrations，支持 reload runtime。
- 插件错误要可见：解析失败、版本不兼容、权限不足。

### 6.6 设置与个性化

- 基础：语言、字体、缩放、主题、紧凑模式。
- Agent：默认模型、thinking、上下文压缩策略。
- 权限：默认模式、规则管理、审计记录。
- 扩展：包/技能/主题/插件管理。
- 快捷键：可查看、可导入导出，首版可先固定。
- 诊断：server 日志、sidecar 状态、版本信息、配置路径。

### 6.7 后续可选模块

- 计划任务：轻量 cron + prompt + project + permission mode。
- H5/远程入口：仅在本地工作流稳定后加入。
- IM 适配：作为 package/extension，不放入核心桌面端。
- Computer Use：高风险、高体积，建议插件化或实验开关。

## 7. 实现步骤

### 阶段 0：工程基线修复

1. 将根项目改为 npm workspaces 或明确 `frontend`、`pi-server` 的安装脚本。
2. 补充根 `devDependencies`：`concurrently`，或改用 workspace 脚本。
3. 在 `pi-server/package.json` 显式加入 `esbuild`。
4. 新增 `npm run install:all`、`npm run lint`、`npm run typecheck`。
5. 删除重复 settings store，修正 store 导出路径。
6. 建立最小 CI：frontend typecheck/build、server typecheck/build。

验收：`npm.cmd run build` 在全新机器上可复现通过。

### 阶段 1：打通 mock 聊天闭环

1. `ChatView.handleSend` 立即 `addMessage` 用户消息。
2. `PiApiClient.handleMessage` 支持 `text_*`、`thinking_*`、`tool_*`、`message_complete`。
3. 设计 `chatStore` 的 streaming reducer，按 `sessionId/messageId` 聚合。
4. Stop generation 接入真实 abort signal，mock 也必须可中断。
5. StatusBar 连接状态接入 `connectionStore`，移除硬编码 `isConnected = true`。
6. ThemeEditor 的 active theme 接入 settings。

验收：不接真实 pi SDK 时，mock 会话可完整显示用户消息、Thinking、工具、权限、回答、usage。

### 阶段 2：接入真实 pi-agent runtime

1. 定义 `AgentRuntime` 接口：`startSession`、`sendPrompt`、`abort`、`respondPermission`、`dispose`。
2. 实现 `MockAgentRuntime` 与 `PiAgentRuntime`，通过 env 或设置切换。
3. 梳理 `@earendil-works/pi-coding-agent` 的真实事件，编写 `eventMapper`。
4. 权限请求改为服务端 Promise/gate，等待前端审批。
5. 会话状态落盘：metadata JSON + transcript JSONL。
6. 接入 Git/file changes 采集。

验收：在一个真实代码仓库中，pi-agent 可读文件、编辑文件、运行命令，并在桌面 UI 中完整显示过程和权限。

### 阶段 3：Tauri 桌面壳

1. 新增 `src-tauri`，配置 Tauri 2。
2. 将 `frontend` dist 接入 Tauri WebView。
3. Tauri 启动 `pi-server` sidecar，动态端口注入前端。
4. 前端初始化从 `get_server_url` 获取 serverUrl，不再写死 `127.0.0.1:1421`。
5. 增加 capabilities：只允许执行 `pi-sidecar`。
6. 加入单实例、窗口状态保存、托盘/菜单、退出清理。

验收：`tauri dev` 可启动完整桌面端，关闭窗口不会残留 sidecar。

### 阶段 4：桌面核心体验补齐

1. 原生目录选择创建项目会话。
2. 多 tab 行为完善：关闭、恢复、运行中保护。
3. 右侧 Changes/Diff/File Tree/Usage 接真实数据。
4. 模型选择器和 provider 设置页完成。
5. Slash 命令面板改为动态命令源。
6. 全局快捷键：新会话、切模型、停止、命令面板、切侧栏。
7. 本地字体替换 Google Fonts，确保离线可用。

验收：常见编码工作流无需终端即可完成，主路径体验达到参考项目水平。

### 阶段 5：扩展与主题中心

1. 实现 extension registry 扫描 package/skill/prompt/theme。
2. 包安装/卸载接真实命令或 SDK，而不是 mock map。
3. 主题 token 实时写入 CSS variables，支持导入导出。
4. 插件 reload runtime，展示错误与健康状态。
5. 扩展详情页支持打开文件位置、复制诊断信息。

验收：pi-agent 的扩展能力可在桌面端被发现、启停、诊断，且不牺牲核心启动速度。

### 阶段 6：打包、发布与更新

1. 评估 sidecar 打包：Bun compile、Node SEA、或携带精简 Node runtime。
2. Windows/macOS 图标、签名、公证、安装器。
3. 自动更新：Tauri updater。
4. 崩溃/启动失败诊断页：展示 sidecar 最近日志。
5. 发布 smoke test：安装、启动、创建会话、发送 prompt、执行工具、退出清理。

验收：生成 Windows/macOS 可安装包，冷启动和内存达到预算。

## 8. 测试策略

### 8.1 单元测试

- Frontend：Vitest + Testing Library，覆盖 store reducer、消息聚合、权限弹窗、Slash 过滤、设置持久化。
- Server：Node test/Vitest，覆盖协议分发、sessionService、permissionService、extensionService、persistence。
- Protocol：前后端共享协议 schema，增加 fixture 防止消息类型漂移。

### 8.2 集成测试

- Mock runtime E2E：启动 server，WebSocket 发送 prompt，断言完整事件序列。
- Pi runtime smoke：在临时 fixture repo 中执行 read/edit/bash，断言文件变化和权限请求。
- Persistence：重启后会话、消息、设置恢复。
- Extension：安装/启用/禁用/卸载测试包，断言 registry 结果。

### 8.3 桌面测试

- Tauri dev smoke：sidecar 启动、healthcheck、窗口关闭清理。
- 打包 smoke：安装后首次启动、二次启动单实例、卸载/更新。
- Windows/macOS 各一套最小回归。
- Playwright 或 Tauri WebDriver：核心 UI 流程截图与交互。

### 8.4 性能测试

- 冷启动耗时：目标 P50 < 2.5s，P95 < 5s。
- 空闲内存：目标 < 180MB；运行中按 agent 能力另设预算。
- 10,000 条消息虚拟列表滚动无明显卡顿。
- 大 diff 按需渲染，单文件 > 2MB 自动降级为摘要。
- Shiki/Mermaid/Diff lazy load，不阻塞首屏。

## 9. 性能与轻量化方案

1. **Tauri 优先**：避免 Electron 主进程和 Chromium 打包膨胀。
2. **Sidecar 单入口**：生产阶段合并 server/agent/extension 管理，减少重复 runtime。
3. **按需加载**：Shiki、Mermaid、Diff、文件树、Usage 图表全部 lazy import。
4. **消息合批**：流式 delta 进入 buffer，按 animation frame flush，减少 React render。
5. **虚拟列表**：继续使用 `react-virtuoso`，消息块高度稳定，避免 layout shift。
6. **轻量持久化**：首版 JSONL + metadata JSON；搜索需求上来后再加 SQLite FTS。
7. **文件扫描节流**：Git/file tree 采用事件触发 + debounce，不持续轮询。
8. **字体本地化**：移除 Google Fonts 网络依赖，使用 `public/fonts`。
9. **CSP 收紧**：桌面端只允许本地资源、loopback server、必要 blob/data。
10. **日志限流**：sidecar 日志滚动窗口，避免长会话写爆磁盘。

## 10. 推荐时间表

| 周期 | 目标 | 关键产出 |
| --- | --- | --- |
| 第 1 周 | 工程基线 + mock 闭环 | workspaces/依赖修复、构建通过、mock 聊天完整显示 |
| 第 2 周 | pi runtime 接入 | `PiAgentRuntime`、权限 gate、真实读/写/命令 smoke |
| 第 3 周 | 持久化 + 会话恢复 | metadata/transcript、recent projects、标题与 usage |
| 第 4 周 | Tauri 壳 MVP | `tauri dev`、动态端口、sidecar 生命周期、目录选择 |
| 第 5 周 | 核心体验 | 模型切换、右侧 changes/diff、文件树、快捷键、连接状态 |
| 第 6 周 | 扩展中心 | packages/skills/prompts/themes registry、主题实时应用 |
| 第 7 周 | 安全与测试 | 权限规则、审计日志、协议测试、桌面 smoke |
| 第 8 周 | 打包发布 | Windows/macOS 安装包、更新策略、性能预算验收 |

若只做内部 alpha，可压缩到 4 周：第 1 周工程与 mock，第 2 周真实 pi，第 3 周 Tauri，第 4 周核心 UX 与打包 smoke。

## 11. 近期优先任务清单

1. 修复依赖和构建脚本，保证全新环境可一键启动。
2. 补齐前端 WS 消息聚合，让 mock agent 主链路可见。
3. 抽象 `AgentRuntime`，把 mock 与真实 pi SDK 解耦。
4. 接入真实权限 gate，先覆盖 shell/file edit 两类高频工具。
5. 新增 Tauri shell，完成动态 serverUrl 注入。
6. 把项目目录选择、右侧 Changes/Diff、模型切换做到可用。
7. 将扩展中心接到真实 package/skill/theme 数据源。

## 12. MVP 验收标准

桌面端 alpha 应满足：

- 用户可安装并启动桌面应用，无需手动启动 server。
- 可选择项目目录创建会话。
- 可与真实 pi-agent 对话，看到流式回答、Thinking、工具调用和结果。
- 文件修改、命令执行会触发权限审批，并可停止运行。
- 右侧面板能展示 Git changes 和 diff。
- 会话和消息重启后可恢复。
- 可切换模型/Thinking/权限模式/主题。
- 包体和内存保持轻量，主流程无明显卡顿。

最终目标不是复刻 `cc-haha` 的所有外围能力，而是把 pi-agent 的扩展性、轻量化和桌面交互融合成一个稳定的本地编码工作台：核心路径更快、更清晰，扩展能力更容易被发现和管理。
