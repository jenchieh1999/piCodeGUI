# Pi Agent Desktop

[English README](./README.md)

Pi Agent Desktop 是面向 `pi-agent` 的桌面端工作台。它把本地 Pi agent 服务、React 工作台界面和 Electron 桌面壳整合成一个 Windows 优先的桌面应用。

项目目标是把 Claude Code 类桌面工具的交互体验带到 Pi Agent，同时保留 pi-agent 运行时的可扩展性。目前项目已经具备会话工作台、项目切换、权限确认、Agents、频道、终端、Markdown/代码阅读器、自定义主题、独立工具窗口和 Windows 打包链路。

> 当前状态：私有预发布版本，版本号 `0.1.1`。主流程已经可以使用，但距离正式发布质量仍需要补齐签名安装包、稳定更新源、更多回归测试和真实跨版本升级验证。

## 核心能力

- Electron 桌面壳：原生窗口控制、托盘/菜单、动态启动本地服务、诊断信息、应用图标资源和自动更新主链路。
- 本地 `pi-server`：通过 HTTP API 和 WebSocket 事件承载会话、消息、运行时状态、权限、Agents、频道、工作区文件、Git 上下文和终端。
- React 19 + Vite 前端：使用 Zustand、Tailwind CSS 4、Radix primitives、lucide icons、xterm、Shiki、Mermaid、Marked、DOMPurify 和二维码渲染能力。
- 以聊天为中心的工作台：会话列表、根据内容自动生成标题、在每个 AI 回答处 fork、下拉到底部按钮、消息选中/复制、排队 follow-up、文件引用、slash commands、模型/thinking/权限控制和工作文件夹切换。
- 权限请求直接显示在对话区域中，支持规则、审计记录、命令/文件预览和运行时权限模式。
- Agents、Skills、Tasks、Packages、Extensions、Provider 设置、桌面诊断和频道配置等管理界面。
- 飞书和微信频道基础能力：飞书 App ID/App Secret 绑定、飞书加密事件解密、配对码、微信公众号 access token 发送链路、微信扫码绑定个人频道。
- 内置 xterm 终端：优先使用 PTY/ConPTY，不可用时自动降级 pipe，支持 resize、停靠、独立窗口和工作区感知启动。
- Markdown 阅读器/编辑器：预览/源码/split、同步滚动锁、跟随主题、编辑保存、搜索替换、撤销、Tab 缩进和独立窗口/标签页。
- 代码查看器：独立窗口、搜索替换、撤销和共享标签页管理。
- Markdown、代码和终端都可以放入独立工具窗口，支持多标签、拖出、合并和窗口拆分。
- 主题系统：20+ 内置主题、用户自建主题、内置主题本地覆盖、主题删除/重置、设置重置、对话背景图片、字体设置，以及 Claude Code、Codex、Trae、赛博朋克、星球大战等风格主题。
- Windows 打包链路：通过 `electron-builder` 输出 NSIS 安装包，当前配置同时支持 `x64` 和 `ia32`。

## 架构概览

仓库采用 npm workspaces，主要由三个包组成：

```text
piCodeGUI/
+-- desktop/       Electron 主进程/preload、桌面壳、更新桥接、独立窗口
+-- frontend/      React/Vite 桌面端界面
+-- pi-server/     本地 Node/TypeScript 服务，承载 Pi runtime、会话、频道、工作区和终端
+-- docs/          开发方案、cc-haha 差距分析和阶段进展
+-- scripts/       质量检查和图标生成脚本
+-- release/       electron-builder 输出目录
+-- package.json   workspace 脚本和桌面端构建入口
```

### 桌面壳

`desktop/main.cjs` 是 Electron 入口，负责：

- 创建主窗口和独立工具窗口；
- 为 renderer 和 server 生成本地认证 token；
- 在动态 loopback 端口启动 `pi-server`；
- 通过 `desktop/preload.cjs` 向前端暴露桌面环境；
- 管理 Markdown、代码、终端的独立标签页；
- 通过 `electron-updater` 暴露自动更新能力；
- 应用图标和原生窗口行为。

`desktop/preload.cjs` 提供受控桥接能力，例如服务环境发现、更新状态、窗口状态事件和独立标签页操作。

### 前端工作台

`frontend/src` 是 React 应用主体，关键目录包括：

- `App.tsx`：根据 URL 参数选择主工作台或独立窗口视图。
- `api/client.ts`：本地服务的 HTTP 和 WebSocket 客户端。
- `stores/`：聊天、设置、模型、UI、连接、终端、任务、Agents 和扩展相关 Zustand store。
- `components/chat/`：会话视图、输入框、消息列表、权限弹窗、thinking、工具卡片、工作区切换器。
- `components/layout/`：应用壳、左侧栏、右侧面板、状态栏和标签栏。
- `components/markdown/`：Markdown 渲染、阅读器/编辑器和独立窗口。
- `components/workspace/`：代码/文件独立查看器。
- `components/terminal/`：终端独立窗口。
- `components/settings/`：设置、主题、频道、包和扩展管理。
- `components/agents/`、`components/skills/`、`components/tasks/`：更高层的工作流面板。

整体 UI 不是落地页，而是桌面工作台：左侧栏负责主要导航，中间负责对话，右侧/底部负责工作区工具，深度阅读和编辑通过可拆出的独立窗口完成。

### 本地 Pi Server

`pi-server/index.ts` 启动本地 HTTP/WebSocket 服务，提供：

- health 和 diagnostics；
- 会话和消息生命周期；
- Pi runtime adapter 与 mock fallback；
- 模型、provider 和认证 API；
- 权限 broker、权限规则和审计记录；
- 工作区文件树、文件读写、diff/search 和 Git 仓库上下文；
- 终端 start/input/resize/stop 协议；
- 飞书和微信频道 API；
- Agent 配置 API；
- 桌面数据目录下的持久化。

桌面应用会自动启动该服务；开发时也可以单独运行。

## 环境要求

- Windows 是当前主要打包和验证目标。
- 需要与当前依赖兼容的 Node.js。
- 需要 npm workspaces 支持。
- 原生 PTY 是可选能力；如果原生 PTY 加载失败，终端会降级到 pipe 后端。
- 外部频道需要公网 webhook 或隧道。飞书/微信云端服务无法直接访问本机 localhost 回调。

## 快速开始

安装依赖：

```bash
npm install
```

运行桌面端开发环境：

```bash
npm run desktop:dev
```

只运行前端和服务，不启动 Electron：

```bash
npm run dev
```

构建前端和服务：

```bash
npm run build
```

使用构建产物预览桌面端：

```bash
npm run desktop:preview
```

## 开发脚本

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 同时运行 Vite 前端和 `pi-server`。 |
| `npm run desktop:dev` | 运行 Vite 前端和 Electron 桌面壳，Electron 会启动本地服务。 |
| `npm run dev:frontend` | 只运行 Vite 前端。 |
| `npm run dev:server` | 只以 watch 模式运行 `pi-server`。 |
| `npm run build` | 构建前端和服务。 |
| `npm run typecheck` | 对前端和服务进行类型检查。 |
| `npm run server:smoke` | 构建并运行服务协议 smoke 检查。 |
| `npm run desktop:smoke` | 构建服务并运行 Electron smoke 检查。 |
| `npm run quality` | 运行类型检查、构建、smoke 和仓库质量检查。 |
| `npm run quality:release` | 运行面向发布的质量门禁，包含打包检查。 |
| `npm run desktop:pack` | 构建未压缩的 Electron 目录产物。 |
| `npm run desktop:dist` | 构建可分发 Electron 安装包。 |

## 打包发布

Windows 打包配置位于 `electron-builder.yml`。

当前配置：

- 产品名：`Pi Agent Desktop`；
- app id：`works.pi-agent.desktop`；
- 输出目录：`release`；
- 目标格式：NSIS；
- 架构：`x64` 和 `ia32`；
- 图标：`desktop/assets/pi-icon.ico`；
- 启用 `asar`；
- `pi-server/dist` 和 `node_modules` 会被 unpack，保证服务文件和原生模块运行时可访问。

构建安装包：

```bash
npm run desktop:dist
```

构建未压缩目录产物：

```bash
npm run desktop:pack
```

## 自动更新

桌面壳已经接入 `electron-updater`。前端可以查询更新状态、检查更新、下载更新和安装已下载更新。

支持的环境变量：

| 变量 | 用途 |
| --- | --- |
| `PI_DESKTOP_UPDATE_URL` | generic 更新源 URL。 |
| `PI_DESKTOP_GITHUB_REPOSITORY` | GitHub 发布仓库，格式为 `owner/repo`；未设置时会从 `origin` 推导。 |
| `GH_TOKEN` / `GITHUB_TOKEN` | GitHub Release 上传凭据，只从环境变量读取。 |
| `PI_DESKTOP_PUBLISH_PROVIDER` | 发布方式：`github` 或 `local`。 |
| `PI_DESKTOP_PUBLISH_DIR` | `local` 发布方式的目标目录。 |
| `PI_DESKTOP_UPDATE_CHANNEL` | 更新通道，默认 `latest`。 |
| `PI_DESKTOP_DISABLE_AUTO_UPDATE=1` | 禁用自动检查更新。 |
| `PI_DESKTOP_UPDATE_PRERELEASE=1` | 允许预发布版本更新。 |

正式 Windows 发包推荐使用 release 专用脚本。如果当前仓库有 GitHub `origin`，脚本会自动推导更新源为 `https://github.com/<owner>/<repo>/releases/latest/download`：

```powershell
npm run desktop:dist:release
```

发布到 GitHub Release：

```powershell
$env:GH_TOKEN="ghp_xxx"
npm run desktop:publish
```

或者一条命令完成打包和上传：

```powershell
$env:GH_TOKEN="ghp_xxx"
npm run desktop:release
```

发布到静态目录：

```powershell
$env:PI_DESKTOP_PUBLISH_PROVIDER="local"
$env:PI_DESKTOP_PUBLISH_DIR="D:\static\pi-agent-desktop\latest"
npm run desktop:publish
```

无论使用哪种方式，最终更新源目录都必须包含 `latest.yml`、对应 `.exe` 和 `.blockmap`。

注意事项：

- 自动更新只在打包后的应用中有实际意义。
- 正式发布前必须配置真实更新源。
- 正式分发仍需要代码签名和跨版本升级回归测试。

## 运行时和数据目录

Electron 会使用生成的 auth token 和桌面数据目录启动 `pi-server`。服务会持久化会话、消息、设置相关记录、频道配置和其他本地状态。

常用环境变量：

| 变量 | 用途 |
| --- | --- |
| `PI_DESKTOP_FRONTEND_URL` | 开发时覆盖 Electron 加载的前端 URL。 |
| `PI_DESKTOP_NODE` | 覆盖用于启动服务的 Node 可执行文件。 |
| `PI_DESKTOP_DATA_DIR` | 覆盖桌面数据目录，Electron 会自动设置。 |
| `PI_DESKTOP_AUTH_TOKEN` | HTTP 和 WebSocket API 使用的 bearer token，Electron 会自动生成。 |
| `PI_DESKTOP_SHELL` | 运行壳标记，桌面端设置为 `electron`。 |
| `PORT` | 直接运行 `pi-server` 时的服务端口。 |
| `HOST` | 服务 host，默认 loopback。 |
| `PI_AGENT_PERMISSION_MODE` | 运行时动作的默认权限模式。 |

## 安全模型

- 桌面端默认把 `pi-server` 绑定在 loopback。
- Electron 生成 auth token，并传给 server 和 renderer。
- 启用 token 后，HTTP 管理 API 需要 `Authorization: Bearer ...`。
- WebSocket 连接通过 query 携带 token。
- 启用认证后，CORS 限制为 loopback、`file` 和 null origin。
- `/health` 和公开频道 webhook 在需要时保持可访问。
- 打包后的 UI 资源不依赖远程字体 CDN。
- Electron 会阻止远程非 HTTPS 外链；本机 loopback HTTP 仍可用于本地工具。
- 自定义 SkillHub 端点的远程地址必须使用 HTTPS。HTTP 只允许 localhost/127.0.0.1 开发场景，除非显式设置 `PI_AGENT_ALLOW_INSECURE_SKILLHUB_ENDPOINTS=1`。
- 不要在没有额外安全边界的情况下把本地服务暴露到更大网络。

## 对话工作台

中间主工作区围绕“对话驱动开发”设计：

- 创建、恢复、重命名、删除和 fork 会话；
- 根据会话内容自动生成标题；
- 在对话区域选择工作文件夹；
- 发送排队 follow-up；
- 把工作区文件或选中文本加入上下文；
- 使用 slash commands 和文件搜索；
- 切换模型、thinking level 和权限模式；
- 在对话中审阅权限请求；
- 选择和复制用户/AI 消息；
- 当不在底部时显示“一键下拉到底部”按钮。

AI 回答后会提供 fork 按钮，用户可以从某个回答分叉继续探索，不影响原时间线。

## 工作区、Markdown、代码和终端

工作区工具可以在右侧面板、输入框下方或独立窗口中使用。

Markdown 阅读器/编辑器：

- 预览、源码和 split 模式；
- split 模式下支持同步滚动锁；
- 跟随桌面主题变化；
- 支持编辑和保存；
- Ctrl+F 搜索和替换；
- Ctrl+Z 撤销；
- Tab 缩进；
- 独立窗口和可拆分标签页。

代码查看器：

- 独立窗口查看；
- 搜索和替换；
- 撤销；
- 可与其他独立工具共享标签组。

终端：

- xterm 前端；
- 优先使用 PTY/ConPTY 后端；
- 原生 PTY 不可用时降级为 pipe；
- 支持 resize 协议；
- 支持停靠和独立窗口；
- 按当前会话/工作区启动。

独立窗口可以容纳多个标签页。标签页可以拖出成为新窗口，也可以合并回已有窗口组。

## Agents、Skills、Tasks 和 Extensions

应用包含以下专门视图：

- Agent 配置和频道绑定；
- Skills 与扩展式能力；
- 计划任务；
- 已安装包和扩展管理；
- 桌面诊断和运行时设置。

Agents 体验参考了 ClawX/OpenClaw 一类桌面 agent 工作台的布局方式，但仍保持在当前 Pi Agent runtime 的边界内。

## 频道能力

频道用于把外部消息入口连接到 Pi Agent 会话和 Agent。

### 飞书

已实现基础：

- 通过 App ID 和 App Secret 绑定频道；
- 保存 webhook、verification token、signing secret、encryption key、默认接收人、默认项目和默认会话；
- 配置 encryption key 后可解密飞书加密事件；
- 生成配对码用于接收人绑定；
- 通过配置凭证发送出站消息；
- 将入站频道消息路由到会话或 Agent。

注意事项：

- 飞书事件回调需要公网 HTTPS URL 或隧道。
- 本地桌面回调 URL 可用于配置展示，但飞书云端不能直接访问 localhost。
- 如果事件没有到达，需要同时检查 App ID、App Secret、回调 URL、verification token、signing secret 和 encryption key。

### 微信

已实现基础：

- 微信公众号配置，包含 App ID/App Secret 和默认接收人；
- 基于 access token 的出站发送链路；
- 入站 webhook 处理；
- 基于 OpenClaw/iLink 风格方案的个人微信扫码登录；
- 桌面 UI 渲染二维码；
- 轮询登录状态、可输入验证码、持久化 bot token。

注意事项：

- 公众号主动消息需要有效凭证和有效接收人/OpenID。
- 个人扫码绑定依赖外部 iLink 兼容服务和手机端确认。
- 扫码流程轮询期间需要保持桌面端打开。

## 主题和外观

设置页支持：

- 内置主题选择；
- 至少 20 种颜色风格；
- 创建、编辑、删除和重置自定义主题；
- 通过本地覆盖/隐藏记录修改或删除内置主题，重置主题可恢复随包内置默认主题；
- 一键重置设置到默认值，但不删除频道凭据、会话或包数据；
- 设置对话背景图片；
- 设置字体和字号；
- Claude Code、Codex、Trae、赛博朋克、星球大战等风格主题；
- 主题实时同步到桌面壳、Markdown 阅读器、代码查看器和独立窗口。

## 质量检查

提交或打包前建议运行：

```bash
npm run typecheck
npm run build
npm run server:smoke
npm run desktop:smoke
npm run quality
```

网络安全相关检查：

```bash
npm audit --omit=dev --audit-level=moderate
npm audit --audit-level=high
node --check desktop/main.cjs
node --check desktop/preload.cjs
```

面向发布的验证：

```bash
npm run quality:release
```

当前自动化覆盖主要集中在类型检查、构建产物、服务 smoke、桌面 smoke、auth/token 行为和打包 smoke 路径。随着 UI 复杂度提高，组件级、store/API 级回归测试还需要继续补强。

## 常见问题

### 桌面窗口黑屏

- 先运行 `npm run build`，再重启桌面端。
- 开发模式下确认 Vite 正在 Electron 加载的 URL 上运行。
- 查看桌面诊断和本地日志目录。
- 确认前端能够访问 `pi-server` health。

### 发送消息时显示 `Pi server is not connected`

- 重启桌面壳，让 Electron 重新启动 `pi-server`。
- 确认没有旧服务进程占用端口。
- 查看连接状态和诊断面板。
- 如果不通过 Electron 运行，确认前端指向正确的 server base URL。

### 终端降级或切换页面后退出

- 某些 Electron/Node/原生模块组合下原生 PTY 可能加载失败。
- 应用会降级到 pipe 后端，而不是直接崩溃。
- 如果必须使用 PTY，重新安装或重建依赖。
- 通过应用内停靠/独立窗口控制终端状态，避免依赖页面切换来保存终端。

### Markdown 保存时报 `failed to fetch`

- 确认本地服务仍然连接。
- 确认文件属于当前工作区并且可写。
- 如果 server token 或 base URL 已变化，重启桌面端。

### 飞书或微信配置后没有生效

- 先保存频道，再执行测试/绑定操作。
- 检查凭证、接收人、回调 URL 和配对码。
- 云端事件需要公网 HTTPS 回调或隧道。
- 查看频道 `lastError`、桌面诊断和服务日志。

### 自动更新显示 unsupported

- 开发或 smoke 模式下自动更新会显示不可用。
- 需要打包应用并配置 `PI_DESKTOP_UPDATE_URL`。
- 正式可用还需要签名和更新源元数据。

## 后续路线

优先事项：

- 发布签名、稳定更新源和跨版本升级回归；
- 补强组件、store 和 API 测试；
- 更深度对齐 SDK 原生 session resume/fork；
- Provider `baseURL` 和代理配置；
- 更完整的 workspace diff accept/reject 工作流；
- 强化频道、provider、runtime 和 terminal 的诊断能力；
- 提升飞书和微信生产部署可靠性；
- 持续把 UI 打磨成更接近原生、安静、Apple 风格的桌面工作台。

## 参考文档

- `docs/pi-agent-desktop-implementation-plan.md`
- `docs/pi-agent-vs-cc-haha-gap-analysis.md`
- `docs/pi-agent-desktop-self-review-2026-05-17.md`
- `docs/pi-agent-desktop-runtime-progress-2026-05-17.md`
- `docs/pi-agent-desktop-progress-2026-05-18.md`
- `docs/pi-agent-desktop-ai-development-handoff.md`
- `docs/pi-agent-desktop-release-security-audit-2026-05-20.md`
- `docs/pi-agent-desktop-release-security-manual-steps.md`
