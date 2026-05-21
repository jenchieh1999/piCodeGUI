# Pi Agent Desktop AI 开发接手手册

更新时间：2026-05-21  
适用对象：后续接入本仓库的 AI 编程助手、协作开发者、维护者  
定位：说明 Pi Agent Desktop 当前模块职责、数据流、开发流程、常见问题处理方式、验证和发布步骤，让新的 AI 不需要翻完整历史对话也能继续推进。

## 1. 项目目标和开发原则

Pi Agent Desktop 是面向 `pi-agent` 的桌面端工作台。项目参考了 `NanmiCoder/cc-haha`、ClawX、OpenClaw 一类桌面化 coding agent 的交互体验，同时保留 Pi Agent 的扩展、包、技能和本地运行时能力。

当前目标不是做一个简单 WebView，而是形成一个可长期使用的本地 AI 编程桌面工作台：

- 桌面壳负责窗口、托盘、自动更新、本地服务启动、独立工具窗口。
- 前端负责聊天工作台、文件区、终端、Markdown/代码阅读器、设置、频道、Agents、包和技能。
- `pi-server` 负责会话、Pi SDK runtime、权限、工作区文件、Git、终端、频道、扩展资源、发布诊断。
- 功能实现优先贴近 cc-haha/ClawX 级别的交互，而不是只追求极致轻量。
- 新能力必须考虑桌面端稳定性，尤其避免黑屏、白屏、断连和用户数据破坏。
- 开发时必须尊重现有用户改动，不要回滚不相关文件。

## 2. 仓库结构总览

```text
piCodeGUI/
├── desktop/                 Electron 主进程、preload、桌面窗口、更新、图标
├── frontend/                React + Vite 桌面 UI
├── pi-server/               本地 Node/TypeScript 服务和 Pi runtime 适配
├── docs/                    开发方案、差距分析、进度、自查和本手册
├── scripts/                 打包、发布、质量门禁、图标生成脚本
├── release/                 electron-builder 输出目录，不应作为源码入口
├── electron-builder.yml     常规打包配置
├── electron-builder.release.yml  发布/更新配置模板
└── package.json             workspace 脚本入口
```

不要把 `frontend/dist/`、`release/`、`node_modules/` 当作源码修改入口。若看到构建产物中有 bug，应回到对应源码文件修复。

## 3. 技术栈

| 层级 | 技术 | 主要用途 |
| --- | --- | --- |
| 桌面壳 | Electron 42 | 主窗口、独立工具窗口、托盘、菜单、自动更新、本地服务启动 |
| 前端 | React 19 + Vite | 桌面工作台 UI |
| 状态管理 | Zustand | chat/settings/model/extension/terminal/task/agent 等 store |
| 样式 | Tailwind CSS 4 + 自定义 CSS 变量 | 主题、Apple 风格材质、响应式布局 |
| 图标 | lucide-react | 工具栏、按钮、导航图标 |
| Markdown | marked + DOMPurify + Shiki + Mermaid | 对话和 Markdown 阅读器渲染 |
| 终端 | xterm + addon-fit | 内置/独立终端 |
| PTY | `@homebridge/node-pty-prebuilt-multiarch` | Windows ConPTY/PTY 后端，失败时降级 pipe |
| 后端 | Node.js + TypeScript | 本地 API、WebSocket、Pi SDK runtime |
| Pi SDK | `@earendil-works/pi-coding-agent` | Pi runtime、extensions、skills、packages、resource loader |
| 打包 | electron-builder + NSIS | Windows x64/ia32 安装包和更新包 |
| 更新 | electron-updater | packaged app 自动更新 |

## 4. 运行和验证命令

常用开发命令：

```powershell
npm install
npm run desktop:dev
npm run dev
npm run build
npm run desktop:preview
```

常用验证命令：

```powershell
npm.cmd run typecheck:frontend
npm.cmd run typecheck:server
npm.cmd run typecheck
npm.cmd run build
npm.cmd run server:smoke
npm.cmd run desktop:smoke
npm.cmd run quality
```

打包和发布命令：

```powershell
npm.cmd run desktop:pack
npm.cmd run desktop:dist
npm.cmd run desktop:dist:release
npm.cmd run desktop:publish
npm.cmd run desktop:release
```

PowerShell 中优先使用 `npm.cmd`，避免 `npm.ps1` 执行策略阻塞。

## 5. 整体数据流

```text
Electron main
  ├─ 启动 pi-server 子进程
  ├─ 注入 PI_DESKTOP_AUTH_TOKEN / PI_DESKTOP_DATA_DIR / PORT
  ├─ 创建主窗口和独立工具窗口
  └─ preload 暴露 desktop API

React frontend
  ├─ 通过 preload 获取 server URL/token/desktop 状态
  ├─ api/client.ts 建立 HTTP + WebSocket
  ├─ stores 接收 connected 和 *_updated 消息
  └─ 组件读取 store 并调用 piApi

pi-server
  ├─ index.ts 提供 HTTP/WS 入口
  ├─ mock-agent / pi-agent-runtime 维护会话和 runtime
  ├─ workspace-service 处理文件/Git/search/diff
  ├─ terminal-service 处理 PTY/pipe terminal
  ├─ extension-service 处理 packages/extensions/skills/prompts/themes
  ├─ channel-service 处理飞书/微信
  └─ persistence / permission / auth 等服务持久化状态
```

任何新功能都要先判断它属于哪一条流：

- UI 纯交互：优先改 `frontend/src/components` 和相关 store。
- 需要本地文件、Git、终端、频道、包管理：必须走 `pi-server` API。
- 需要原生窗口、系统菜单、自动更新、图标、独立窗口：改 `desktop/main.cjs` 和 `desktop/preload.cjs`。
- 需要跨主窗口和独立窗口同步：需要 preload 事件、BroadcastChannel、localStorage 或 WebSocket store 联动。

## 6. Electron 桌面壳模块

核心文件：

- `desktop/main.cjs`
- `desktop/preload.cjs`
- `desktop/run-electron.cjs`
- `desktop/smoke-packaged.cjs`
- `desktop/assets/pi-icon.ico`

主要职责：

- 创建主窗口。
- 启动和重启本地 `pi-server`。
- 为 renderer 注入服务地址、auth token、桌面环境信息。
- 管理应用菜单、托盘、窗口控制、任务栏图标。
- 管理 Markdown、代码、终端等独立工具窗口。
- 支持多个独立窗口中的 tab 拆分、合并、拖出、拖回。
- 接入 `electron-updater` 实现检查、下载、安装更新。

开发注意：

- 黑屏通常先查 `desktop/main.cjs` 加载 URL、preload 注入和 `pi-server` 启动日志。
- 桌面端断连通常查 server 子进程、端口、token、WebSocket URL。
- 任务栏图标问题查 `electron-builder.yml` 的 `icon`、`BrowserWindow.icon`、安装包缓存和 Windows 任务栏缓存。
- 修改 preload API 时，需要同时更新 `frontend/src/desktop-env.d.ts`。
- 任何窗口 IPC 都要保持参数可序列化，不要传 DOM、函数或复杂类实例。

## 7. 前端入口和状态模块

核心文件：

- `frontend/src/App.tsx`
- `frontend/src/main.tsx`
- `frontend/src/api/client.ts`
- `frontend/src/types/index.ts`
- `frontend/src/index.css`

主要 store：

| Store | 文件 | 负责内容 |
| --- | --- | --- |
| chatStore | `stores/chatStore.ts` | 会话、消息、输入草稿、队列、标题、fork |
| connectionStore | `stores/connectionStore.ts` | server 连接、状态、错误 |
| settingsStore | `stores/settingsStore.ts` | 主题、语言、字号、字体、背景图等设置 |
| modelStore | `stores/modelStore.ts` | provider、model、thinking level |
| extensionStore | `stores/extensionStore.ts` | packages/extensions/skills/prompts/themes/trust/marketplace |
| terminalStore | `stores/terminalStore.ts` | 终端实例、输出、后端状态 |
| agentStore | `stores/agentStore.ts` | Agents、多 Agent、频道绑定、学习记录 |
| taskStore | `stores/taskStore.ts` | 定时任务和任务运行状态 |
| uiStore | `stores/uiStore.ts` | 当前视图、面板状态、toast、布局偏好 |

开发模式：

1. 先在 `types/index.ts` 补协议类型。
2. 在 `api/client.ts` 补 HTTP/WS 方法和消息处理。
3. 在对应 store 中补 state/action。
4. 在组件中读取 store，尽量避免跨组件手动传深层状态。
5. 需要持久化的前端偏好，优先放 `settingsStore` 或明确的 localStorage key。

## 8. 聊天工作台

核心文件：

- `components/chat/ChatView.tsx`
- `components/chat/ChatInput.tsx`
- `components/chat/MessageList.tsx`
- `components/chat/MessageBubble.tsx`
- `components/chat/PermissionDialog.tsx`
- `components/chat/ToolCallCard.tsx`
- `components/chat/ThinkingBlock.tsx`
- `components/chat/WorkspaceSwitcher.tsx`

已有能力：

- 会话列表、创建、删除、重命名、自动标题。
- 消息流式输出、thinking block、工具卡片。
- 每个 AI 回答后 fork。
- 不在底部时显示一键滚动到底部按钮。
- 消息文本可选中、复制、右键。
- `/projects`、`/new`、`/clear` 等 slash 操作。
- 文件引用、图片输入、普通文本文件加入上下文。
- Composer 内模型、权限、thinking 控件。
- 权限请求内嵌在对话框区域，而不是外部游离弹窗。

开发注意：

- 任何输入框附近弹层都要检查 z-index，避免被对话栏覆盖。
- Ctrl 快捷键不要吞掉系统复制、粘贴、选择文本行为。
- 消息区容器应允许 `user-select: text`，不要在父层设置禁止选择。
- 新增 slash command 时要同时考虑本地 fallback 和服务端下发的 runtime commands。
- 和文件区联动时，尽量通过统一的 “add to chat/context” action，避免多处拼 prompt。

## 9. 工作区、文件搜索和 Git

核心文件：

- `pi-server/workspace-service.ts`
- `frontend/src/components/layout/RightPanel.tsx`
- `frontend/src/components/workspace/WorkspaceQuickOpen.tsx`
- `frontend/src/components/workspace/CodeFileViewer.tsx`
- `frontend/src/components/workspace/WorkspaceFileStandaloneView.tsx`
- `frontend/src/lib/workspaceDrag.ts`

已有能力：

- 工作区文件树。
- Ctrl+P 快速搜索文件。
- 搜索结果可加入文件区。
- 文件预览 tab。
- 文件拖拽到文件夹迁移。
- 文件拖拽到对话框加入上下文。
- 文件拖出桌面端生成独立工作窗口。
- 右键文件操作：加入对话、删除、复制路径、在资源管理器中显示等。
- Git changed files、diff、file-level accept/stage、discard。
- 文件读取支持文本和图片预览。

重要修复规则：

- 文件搜索不能因为一个目录无权限而失败。
- `workspace-service.ts` 中扫描目录时要跳过 `EACCES`、`EPERM`、`EBUSY`、`ENOENT`、`ENOTDIR`。
- `.edge_tmp_manual`、`.edge_tmp`、`.cache` 等临时目录应忽略。
- 文件树滚动不能因为选中文件自动 scrollIntoView 而抢走用户滚轮位置。
- 文件拖拽要区分：移动到文件夹、加入对话、打开独立窗口、拖到独立窗口 tab group。

新增文件能力时的处理步骤：

1. 先补 `workspace-service.ts` 的安全路径解析和 API。
2. 所有路径必须经过 workspace 内部路径校验。
3. 删除、移动、覆盖类操作必须考虑目标冲突和越界路径。
4. 前端右键菜单、拖拽、快捷键都应复用同一 API。
5. 运行 `typecheck:server`、`typecheck:frontend`、`server:smoke`。

## 10. Markdown 阅读器和代码阅读器

核心文件：

- `components/markdown/MarkdownFileReader.tsx`
- `components/markdown/MarkdownStandaloneView.tsx`
- `components/markdown/MarkdownRenderer.tsx`
- `components/workspace/CodeFileViewer.tsx`
- `components/shared/SearchReplaceBar.tsx`
- `components/standalone/StandaloneTabsView.tsx`

已有能力：

- Markdown 预览、源码、split 三种模式。
- split 模式左右滚动同步锁，默认锁定，可解锁。
- 编辑保存 Markdown。
- Ctrl+F 搜索和替换。
- 选中文本后 Ctrl+F 自动填入查找词。
- Ctrl+Z 撤销。
- Tab 缩进。
- 跟随桌面主题实时切换。
- 可独立窗口打开。
- 多 tab 独立窗口可合并、拆分、拖出、拖回。
- 代码阅读器也支持独立窗口、搜索、替换、撤销。

常见问题：

- 保存失败 `failed to fetch`：先查 `piApi.writeWorkspaceFile`、server URL/token、路径是否在当前 workspace 内。
- split 后不能滚动：查容器高度、overflow、左右 pane 是否被外层 flex 挤压。
- 滚动同步抖动：需要同步时防止 A 触发 B 后 B 反向触发 A 的循环。
- 主题未同步：查 `useStandaloneRuntimeSettings` 和 `applyRuntimeSettings` 是否同时收到 themes/customThemes/settings。

## 11. 终端模块

核心文件：

- `pi-server/terminal-service.ts`
- `frontend/src/components/terminal/TerminalStandaloneView.tsx`
- `frontend/src/components/layout/RightPanel.tsx`
- `frontend/src/stores/terminalStore.ts`

已有能力：

- xterm 渲染。
- PTY/ConPTY 优先，失败时 pipe 降级。
- `terminal_start`、`terminal_input`、`terminal_resize`、`terminal_stop` 协议。
- 终端跟随当前 workspace cwd。
- 切换页面不应导致终端退出。
- 可显示/隐藏在消息输入框下方。
- 可上下拖动调整高度。
- 可独立窗口打开。

开发注意：

- 终端实例生命周期要和 session/window/tab 区分，不要因为 React 组件卸载就停止 server terminal。
- xterm mount/unmount 只能处理前端视图，不能默认调用 `terminal_stop`。
- resize 要节流，避免窗口拖动时刷爆 WebSocket。
- packaged app 中原生 PTY 模块必须在 `asarUnpack` 可访问。
- pipe fallback 不是完整 TTY，只能保证基础命令交互。

## 12. 主题、语言、外观和字体

核心文件：

- `frontend/src/lib/runtimeSettings.ts`
- `frontend/src/stores/settingsStore.ts`
- `frontend/src/stores/extensionStore.ts`
- `components/settings/SettingsView.tsx`
- `components/settings/ThemeEditor.tsx`
- `frontend/src/lib/i18n.ts`

已有能力：

- 20+ 内置主题。
- Claude Code、Codex、Trae、Cyberpunk、Star Wars 等风格主题。
- 用户自建主题、编辑、删除。
- 内置主题允许通过本地 override 修改，也允许通过本地 hidden record 删除。
- 支持“重置主题”清除自定义主题/本地覆盖/隐藏记录，并恢复随包内置主题。
- 支持“重置设置”恢复 `settingsStore` 默认值，不删除频道凭据、会话、包或 `.pi` 数据。
- 字号修改通过确认按钮应用。
- UI 字体和等宽字体设置。
- 对话背景图片和 URL。
- 主题应用到主窗口、独立窗口、Markdown 阅读器、代码阅读器。
- 中文、英文、日文基本 i18n。

重要修复规则：

- 不要把 Shiki/VS Code/TextMate 语法主题直接当作桌面 UI 主题展示。
- server 侧资源主题必须能解析出有效 `colors`，前端也要过滤空颜色主题。
- 覆盖安装不会清理用户数据，所以任何迁移都要兼容旧 localStorage 和 `.pi` 配置。
- 新 UI 文案必须进 `i18n.ts`，不要硬编码英文。
- 主题色必须映射到 CSS variables，不要局部写死颜色。
- 不要重新引入远程字体 CDN；桌面端应优先使用系统字体和本地可用字体，避免打包后网络依赖和隐私泄露。
- 修改内置主题时不要改写 bundled theme；应写入 `pi-desktop-custom-themes` 的同名本地覆盖。
- 删除内置主题时不要删除源码中的主题定义；应写入 `pi-desktop-hidden-themes`，通过重置主题恢复。

新增主题时：

1. 在 `runtimeSettings.ts` 的 `BUILTIN_THEMES` 添加主题。
2. 在 `THEME_DISPLAY_NAMES` 添加显示名。
3. 确保核心 token 有值：`accent`、`bg`、`bgSecondary`、`text`、`border`、`selectedBg`、`success`、`error`、`warning`。
4. 检查浅色主题的 `colorScheme`。
5. 检查主界面、设置页、Markdown/代码独立窗口。

## 13. 设置、包、扩展、技能

核心文件：

- `pi-server/extension-service.ts`
- `components/settings/PackagesView.tsx`
- `components/settings/ExtensionsView.tsx`
- `components/skills/SkillsView.tsx`
- `stores/extensionStore.ts`
- `docs/pi-agent-extension-package-skill-implementation-plan.md`

已有能力：

- 真实接入 Pi SDK `SettingsManager`、`DefaultPackageManager`、`DefaultResourceLoader`。
- 包安装、卸载、更新、启用/停用、filter。
- 本地 package scaffold 创建。
- 技能创建、列表、搜索、读取 `SKILL.md`、复制 `/skill:name`。
- 扩展 tools/commands/shortcuts/flags 展示。
- prompts 和 slash commands 下发。
- resource diagnostics 展示。
- trust center：trusted/untrusted/blocked。
- marketplace list 展示可选包数量和安装入口。

开发注意：

- `extension-service.ts` 是扩展/包/技能的服务端主入口，不要在前端伪造资源状态。
- 包 filter 写入 Pi settings 后必须 reload resource snapshot。
- 资源变更后要广播：packages/extensions/skills/prompts/themes/diagnostics/marketplace/trust/slashCommands。
- 安装第三方包涉及安全风险，UI 必须能显示来源、路径、scope、trust。
- 阻塞扩展黑屏时，优先查 `extensionStore` 快照 shape、组件空数组保护和 resource diagnostics。
- SkillHub 自定义远程端点必须使用 HTTPS；HTTP 只允许 localhost/127.0.0.1，私有测试需显式设置 `PI_AGENT_ALLOW_INSECURE_SKILLHUB_ENDPOINTS=1`。
- SkillHub/ClawHub 请求必须有超时和响应大小限制，避免远程接口异常导致本地服务占用过高内存。
- 包安装必须保留 trust confirmation / blocked package 拦截；不要为了“安装方便”绕过 `enforcePackageInstallTrust`。

## 14. Agents、多 Agent 和自我进步

核心文件：

- `pi-server/agent-service.ts`
- `pi-server/agent-orchestration-service.ts`
- `pi-server/agent-learning-service.ts`
- `components/agents/AgentsView.tsx`
- `stores/agentStore.ts`

已有能力：

- Agent profile。
- 频道绑定。
- role、parentAgentId、subAgent、自我进步配置。
- 复杂任务的 prompt-level orchestration。
- Planner / Implementer / Reviewer / Tester / Documenter / Researcher 等角色配置。
- 项目级 learning 持久化到 `.pi/learnings`。
- UI 手动记录学习经验。
- runtime failure 和用户纠正可形成 learning。

当前边界：

- 当前更多是 prompt-level 多 Agent 编排，不是完全真实的并行子会话 runtime。
- 后续若实现真实 subAgents，需要明确每个子会话的 workspace、权限、日志、取消、结果合并和失败回收。
- 学习记录升级为 skill/package 前，应有审核流程，避免把错误经验永久注入。

新增多 Agent 能力时：

1. 先定义 AgentConfig 字段和持久化结构。
2. 在 orchestration service 中定义触发条件和输出契约。
3. UI 必须显示为什么触发多 Agent，以及每个角色做什么。
4. 如果真正启动并行任务，必须支持取消、超时、权限隔离、日志查看。
5. 运行失败要写入可审计 learning，不要静默吞掉。

## 15. 频道：飞书和微信

核心文件：

- `pi-server/channel-service.ts`
- `components/settings/ChannelsSettings.tsx`
- `stores/agentStore.ts` 或相关频道状态

已有能力：

- 飞书通过 App ID/App Secret 绑定。
- 飞书 verification token、signing secret、encryption key。
- 飞书加密事件解密。
- 飞书配对码和默认接收人。
- 微信公众号 App ID/App Secret 和 access token 发送链路。
- 微信客服/公众号主动消息基础链路。
- 微信扫码绑定个人频道，参考 OpenClaw/ClawX 风格。
- 二维码渲染、轮询、验证码输入、token 持久化。

开发注意：

- 飞书/微信云端无法直接访问 localhost，真实回调需要公网 HTTPS 或隧道。
- 配置 UI 生效问题通常查：配置是否保存、server 是否 reload、默认 project/session 是否绑定、pairing code 是否完成。
- 出站消息失败要显示明确错误：token 过期、recipient 缺失、app secret 错误、接口权限不足。
- 入站消息进入 agent 前要做签名/解密/去重/路由。

## 16. 权限系统

核心文件：

- `pi-server/permission-broker.ts`
- `pi-server/permission-service.ts`
- `pi-server/permission-store.ts`
- `frontend/src/components/chat/PermissionDialog.tsx`

已有能力：

- 权限请求显示在对话框区域。
- 支持 command、file、diff preview。
- 支持 allow/deny 和记住规则。
- 支持权限模式：ask、acceptEdits、plan、bypassPermissions。
- 支持审计记录。

开发注意：

- 权限请求必须能关联 session/message/tool。
- 高风险操作不能只靠前端拦截，server/runtime 也要检查。
- “记住规则”必须有 scope，避免全局误放权。
- 未来如果允许用户编辑命令再批准，要把批准内容和实际执行内容都写审计。

## 17. 会话、持久化和标题

核心文件：

- `pi-server/mock-agent.ts`
- `pi-server/persistence.ts`
- `pi-server/session-title.ts`
- `frontend/src/lib/sessionActions.ts`

已有能力：

- 会话持久化。
- 消息持久化。
- 自动标题。
- fork 会话。
- `/new`、`/clear`、`/projects`。

开发注意：

- 用户手动改过标题后，不应被自动标题覆盖。
- fork 要复制截至目标 message 的消息，并标记 parentSessionId/forkedFromMessageId。
- clear 应清空当前会话上下文，但不要误删其他会话。
- SDK 原生 session resume 仍是后续重点，不要误称完全等价于 cc-haha 的 runtime resume。

## 18. 发布、打包和自动更新

核心文件：

- `electron-builder.yml`
- `electron-builder.release.yml`
- `scripts/release-windows.cjs`
- `scripts/publish-release.cjs`
- `scripts/release-utils.cjs`
- `scripts/require-update-feed.cjs`
- `desktop/main.cjs`

已有能力：

- Windows NSIS 安装包。
- x64 和 ia32。
- app icon：`desktop/assets/pi-icon.ico`。
- `asar` 打包。
- `pi-server/dist` 和生产依赖进入 unpack。
- 自动更新状态机：checking、available、downloading、downloaded、installing、error、unsupported。
- generic/GitHub/local 发布路径。

关键环境变量：

| 变量 | 用途 |
| --- | --- |
| `PI_DESKTOP_UPDATE_URL` | generic 更新源 |
| `PI_DESKTOP_GITHUB_REPOSITORY` | GitHub release 仓库，格式 `owner/repo` |
| `GH_TOKEN` / `GITHUB_TOKEN` | GitHub Release 上传凭据 |
| `PI_DESKTOP_PUBLISH_PROVIDER` | `github` 或 `local` |
| `PI_DESKTOP_PUBLISH_DIR` | local 发布目录 |
| `PI_DESKTOP_UPDATE_CHANNEL` | 更新通道 |
| `PI_DESKTOP_DISABLE_AUTO_UPDATE=1` | 禁用自动更新 |
| `PI_DESKTOP_UPDATE_PRERELEASE=1` | 允许预发布更新 |

开发注意：

- 自动更新只在 packaged app 中真正有意义。
- 发布源目录必须包含 `latest.yml`、安装包 exe、blockmap。
- 覆盖安装不会清理旧用户数据，涉及数据迁移时必须写兼容逻辑。
- 正式发布仍需要签名、跨版本升级回归和真实更新源验证。

## 19. UI 布局和设计规范

当前布局：

- 顶部：Electron 标题栏/菜单。
- 左侧：主功能栏、会话列表、项目筛选、设置入口。
- 中间：对话主区域和 composer。
- 右侧：文件、变更、预览、终端等工作区工具。
- 底部：状态栏，显示模型、thinking、权限、SDK、连接状态。
- 独立窗口：Markdown/代码/终端/工作区 tab group。

设计要求：

- 偏 Apple 风格：半透明材质、细边框、轻阴影、克制高亮。
- 不要做营销式 landing page。
- 工具按钮优先图标，必要时 tooltip。
- 不要把 card 套 card。
- 页面区域不要大面积空白，尤其左侧功能栏和设置页。
- 所有文本要在中英日语言下不溢出。
- 新增 UI 文案必须接入 i18n。
- 弹层必须检查 z-index，不得被 composer 或右侧 panel 覆盖。

## 20. 常见故障和排查路径

### 20.1 打开黑屏

优先检查：

1. Electron 加载的是 Vite URL 还是构建产物。
2. `desktop/preload.cjs` 是否报错。
3. `pi-server` 是否成功启动。
4. renderer 控制台是否有 React runtime error。
5. 最近改动的 store snapshot 是否字段缺失。
6. lazy import 组件是否有默认导出/命名导出不匹配。

### 20.2 显示 `pi server is not connected`

优先检查：

1. server 子进程是否还活着。
2. 端口是否被占用。
3. WebSocket URL 是否带 token。
4. `PI_DESKTOP_AUTH_TOKEN` 是否前后端一致。
5. CORS/token 是否拒绝。
6. 最近 server import 是否因为 ESM/CJS、native module 或路径错误崩溃。

### 20.3 Ctrl+P 搜索文件失败

典型原因：

- 工作区里存在不可读目录，如 `.edge_tmp_manual/edge_scan_*`。
- `readdirSync` 抛出 `EPERM` 后未跳过。

处理标准：

- 服务端扫描应跳过不可读目录，而不是让整个搜索失败。
- 继续返回可访问文件结果。

### 20.4 覆盖安装后多出无意义主题

原因：

- 覆盖安装保留用户目录和 `.pi` 配置。
- Pi resource loader 可能发现 Shiki/VS Code/TextMate 语法主题。
- 空颜色主题不能进入桌面外观列表。

处理标准：

- server 只发送能解析出有效 UI colors 的主题。
- frontend 过滤 `colors` 为空的主题。
- 当前主题不存在时回退到 `dark`。

### 20.5 Markdown 保存失败 `failed to fetch`

优先检查：

1. `piApi.writeWorkspaceFile` 请求 URL。
2. token。
3. 文件路径是否在当前 workspace。
4. server 是否仍连接。
5. `workspace-service.writeWorkspaceFile` 是否返回 error。

### 20.6 终端切换页面后退出

根因通常是前端组件卸载时误调用 `terminal_stop`。  
标准做法：组件卸载只 detach xterm 视图，server terminal 生命周期由用户 stop 或窗口关闭策略管理。

### 20.7 i18n 未生效

处理步骤：

1. 搜索硬编码英文。
2. 在 `frontend/src/lib/i18n.ts` 补 en/zh/ja。
3. 组件使用 `t(key)`。
4. 检查按钮宽度和长文本换行。

## 21. 新功能标准开发流程

每个新功能按以下顺序处理：

1. 明确功能属于桌面壳、前端、server、runtime、扩展资源还是发布工程。
2. 查现有相似模块，沿用数据结构和 UI 风格。
3. 先补类型：`pi-server/types.ts` 和 `frontend/src/types/index.ts`。
4. server 需要新增 API 时，先实现安全边界和错误返回。
5. WebSocket 事件需要同步时，补 `api/client.ts` 和对应 store。
6. UI 组件实现时，先保证空状态、错误状态、加载状态。
7. 文案接 i18n。
8. 需要独立窗口时，补 desktop preload/main 和 standalone view。
9. 跑最小相关验证。
10. 更新相关 docs 或自评分文档。

## 22. 修改已有功能的注意事项

- 不要直接删除用户自建主题、会话、settings、`.pi` 文件。
- 不要把覆盖安装当作全新安装。
- 不要让一个资源加载失败导致整个设置页黑屏。
- 不要让一个目录权限错误导致整个文件搜索失败。
- 不要把 server 错误吞掉，UI 应给出简明错误。
- 不要让前端组件卸载误停止长期运行的 server 资源。
- 不要把第三方包/扩展视为可信，必须显示来源和 trust。
- 不要破坏 `server:smoke`，它是当前最重要的后端回归保护。

## 23. 推荐验证矩阵

小改动：

```powershell
npm.cmd run typecheck:server
npm.cmd run typecheck:frontend
```

涉及 server API：

```powershell
npm.cmd run typecheck:server
npm.cmd run build:server
npm.cmd run server:smoke
```

涉及前端 UI：

```powershell
npm.cmd run typecheck:frontend
npm.cmd run build:frontend
```

涉及桌面壳：

```powershell
node --check desktop/main.cjs
node --check desktop/preload.cjs
npm.cmd run desktop:smoke
```

涉及网络安全或发布前安全：

```powershell
npm.cmd audit --omit=dev --audit-level=moderate
npm.cmd audit --audit-level=high
node --check desktop/main.cjs
node --check desktop/preload.cjs
node scripts\require-update-feed.cjs
```

安全相关改动的最低自查点：

- Electron 外链只允许 `https:`、`mailto:` 和 loopback `http:`。
- preload 新增 IPC 必须走 `requireTrustedIpc` 或等价可信 renderer 校验。
- 本地 HTTP/WS 新接口默认必须受 desktop token 保护，除非明确是 `/health` 或频道公网回调。
- 远程 endpoint 必须 HTTPS；loopback HTTP 只能用于本地开发。
- 外部响应要有超时和大小限制。
- 不要在日志、toast、错误响应中输出 API key、access token、channel token 或带凭据 URL。
- 不要引入远程字体、远程脚本或未经 DOMPurify 处理的 HTML。

涉及发布/更新：

```powershell
npm.cmd run quality:release
npm.cmd run desktop:dist:release
npm.cmd run desktop:smoke:packaged
```

## 24. 后续 AI 接手时的首要阅读顺序

1. `docs/pi-agent-desktop-ai-development-handoff.md`
2. `docs/pi-agent-vs-cc-haha-gap-analysis.md`
3. `docs/pi-agent-extension-package-skill-implementation-plan.md`
4. `docs/electron-to-tauri-migration-assessment.md`
5. `README.md` 和 `README.zh-CN.md`
6. `package.json`
7. 具体任务相关源码入口

如果任务是 UI 问题，先读：

- `frontend/src/App.tsx`
- `frontend/src/components/layout/AppShell.tsx`
- 对应组件文件
- 对应 store
- `frontend/src/lib/runtimeSettings.ts`
- `frontend/src/lib/i18n.ts`

如果任务是 server/runtime 问题，先读：

- `pi-server/index.ts`
- 对应 service 文件
- `pi-server/types.ts`
- `frontend/src/api/client.ts`

如果任务是桌面壳问题，先读：

- `desktop/main.cjs`
- `desktop/preload.cjs`
- `electron-builder.yml`

## 25. 当前主要风险和下一步方向

当前风险：

- Electron 仍是过渡壳，Tauri 迁移已评估但尚未执行。
- SDK 原生 resume/fork 与桌面 session 尚未完全同源。
- 真实并行 subAgents 还未完全落地。
- 远程 marketplace 仍缺签名、hash pinning、权限声明和索引校验。
- 组件级自动化测试不足。
- 正式发布仍缺签名和真实跨版本自动更新回归。

建议下一步：

1. 补关键组件和 store 测试，尤其 ChatInput、RightPanel、MarkdownReader、Workspace API、extensionStore。
2. 推进 SDK session resume/fork 同源化。
3. 完善 hunk-level accept/reject 和工具结果内联 diff。
4. 完善 terminal tabs/profile/search。
5. 将 package marketplace 从本地模板升级为远程索引。
6. 为 trust center 增加强制执行策略。
7. 建立正式签名和更新源流水线。

## 26. 给后续 AI 的工作提示

当你接手一个具体 bug 或功能时，请先回答这几个问题：

- 它属于哪个模块？
- 是否需要 server API？
- 是否影响 packaged app？
- 是否影响用户数据迁移？
- 是否需要同步主窗口和独立窗口？
- 是否需要 i18n？
- 是否需要更新 smoke 或 docs？

如果不确定，从 `rg` 搜索现有同类实现开始。这个项目已经有很多能力，不要重复造一套平行状态管理或平行 API。优先沿用现有 store、piApi、service 和组件模式。
