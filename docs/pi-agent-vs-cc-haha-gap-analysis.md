# Pi Agent Desktop 与 cc-haha 差距分析

## 0.6 2026-05-19 发布工程更新：自动更新主链路落地

本轮补齐桌面端正式发布体验里最关键的“自动更新”主链路，使 Pi Agent Desktop 不再停留在“能打包”阶段，而是具备接近 cc-haha/updater 体验的检查、下载、安装闭环：

- 根 `package.json` 新增 `electron-updater` 生产依赖，确保打包后的 Electron 主进程能直接加载更新模块。
- `desktop/main.cjs` 新增自动更新状态机，支持 `idle/checking/available/not-available/downloading/downloaded/installing/error/unsupported` 全生命周期。
- 主进程已接入 `autoUpdater.checkForUpdates()`、`downloadUpdate()`、`quitAndInstall()`，并监听 update available、not available、download progress、downloaded、error 等事件。
- 新增启动后延迟自动检查：正式打包环境会在窗口启动后自动检查更新；开发、smoke、禁用更新或未打包环境会明确返回 unsupported，不影响本地开发。
- 新增环境变量控制：`PI_DESKTOP_UPDATE_URL` 可覆盖 generic 更新源，`PI_DESKTOP_UPDATE_CHANNEL` 控制更新通道，`PI_DESKTOP_DISABLE_AUTO_UPDATE=1` 可关闭自动更新，`PI_DESKTOP_UPDATE_PRERELEASE=1` 可允许预发布版本。
- `desktop/preload.cjs` 暴露 `getUpdateStatus/checkForUpdates/downloadUpdate/installUpdate/onUpdateStatus`，前端可以实时接收下载进度与状态变化。
- 设置页新增“桌面端”页签，提供当前版本、最新版本、通道、更新源、上次检查、下载进度、发布说明、检查更新、下载更新、重启安装等交互，并完成中/英/日三语言文案。

验证结果：

- `npm.cmd run typecheck:frontend` 通过。
- `npm.cmd run typecheck:server` 通过。
- `node --check desktop/main.cjs` 与 `node --check desktop/preload.cjs` 通过。
- `npm.cmd run build:frontend` 通过。
- `npm.cmd run desktop:smoke` 通过，smoke 模式下更新状态会正确返回 `unsupported`，不影响 Pi server 启动与诊断。

本轮后自动更新能力从 **1/10** 提升到 **7/10**：应用内主链路已经可用，剩余差距集中在正式发布源、代码签名、增量发布流水线、真实旧版本升级回归测试。桌面发布工程自评分从 **96/100** 提升到 **97/100**。

## 0.5 2026-05-19 Terminal 修复更新：从命令面板升级为 xterm + PTY

用户反馈“里面的终端看起来不可用”后，本轮定位到根因：上一版右侧 Terminal 虽然能通过 smoke 执行简单命令，但前端只是 `textarea + input`，后端也主要依赖 `child_process` 管道，不具备真正终端需要的 TTY/resize/ANSI 交互能力，因此视觉和手感都会像“命令执行框”，不够接近 cc-haha。

本轮已完成关键修复：

- 前端引入 `@xterm/xterm` 与 `@xterm/addon-fit`，右侧 Terminal 面板改为真实 xterm 视图，支持直接键入、ANSI 输出、滚动缓冲、Ctrl+C 中断、Ctrl+Shift+C/V 复制粘贴、容器 resize 后自动 fit。
- WebSocket 协议新增 `terminal_resize`，`terminal_start` 支持初始 `cols/rows`，`terminal_started` 会返回 `backend: 'pty' | 'pipe'`，用户能看到当前是否是真 PTY。
- 服务端新增 `@homebridge/node-pty-prebuilt-multiarch`，优先启动原生 PTY/ConPTY；如果原生模块在某台机器或 Electron ABI 下加载失败，会自动降级到旧 pipe 模式，并在终端内提示 fallback，不再造成服务断连或黑屏。
- `pi-server/build.ts` 将 PTY 原生模块外置，避免 esbuild 错误打包 `.node` 原生文件；Electron 打包时仍通过 `asarUnpack node_modules` 保留原生依赖。
- `protocol-smoke` 增加 terminal backend 与 `terminal_resize` 校验，防止后续回归成“假终端”。
- 前端构建将 xterm 拆入独立 `vendor-terminal` chunk，避免终端能力把主入口包撑大；主入口维持约 215KB。

验证结果：

- `npm.cmd run quality` 通过。
- `npm.cmd run server:smoke` 在新增 backend/resize 校验后通过。

本轮后 Terminal 差距从“轻量 shell 面板”收敛为“可用的内置终端基础线”。剩余差距主要是更细的终端体验：多终端 tab、shell profile 选择、搜索、复制选区菜单、命令历史辅助、终端主题与字体设置联动。

## 0.4 2026-05-19 桌面壳视觉质量更新：Apple 风格材质层与 Composer 统一 polish

本轮继续缩小“桌面壳质感”差距，参考 Apple HIG 对 [Materials](https://developer.apple.com/design/human-interface-guidelines/materials)、[Windows](https://developer.apple.com/design/human-interface-guidelines/windows) 与导航层级的设计方向，将 Pi Agent Desktop 从硬色块工作台进一步调整为更接近 macOS 原生应用的轻材质界面：

- 新增 `pi-shell`、`pi-titlebar-material`、`pi-sidebar-material`、`pi-panel-material`、`pi-statusbar-material`、`pi-composer-material`、`pi-glass-control`、`pi-glass-menu` 等统一材质类，桌面壳的标题栏、侧栏、右面板、底栏、Composer 共用同一套半透明、模糊、细边线和轻投影规则。
- `AppShell` 已切换为真正的桌面 shell 布局：Electron 标题栏、左侧多功能栏、中心会话区、右侧 Workspace/Terminal 面板、状态栏都挂在同一视觉层级下，不再像网页拼接区域。
- `Sidebar` 继续向 ClawX/cc-haha 风格靠拢：主入口、Agent/频道/技能/任务/主题、底部设置/扩展/Terminal 入口统一为轻量导航按钮；会话行改成带细边框和高亮层级的列表项，搜索框和右键菜单改为 glass 控件。
- `RightPanel` 的面板 header、切换按钮和 Terminal 子面板完成轻量 polish，减少旧版硬背景与硬边框对主界面的割裂感。
- `StatusBar` 改为 macOS 风格的轻材质底栏，模型、thinking、权限、桌面诊断、runtime 与连接状态都以 pill 控件展示，信息密度保持但视觉噪声更低。
- `ChatInput` / Composer 改成半透明底部材质层，文件引用 chip、slash 菜单、模型/权限/thinking 菜单、文件搜索菜单、输入框和发送按钮统一为新控件体系；中心会话区背景也保留主题/背景图可见性。

本轮后桌面壳自评分从 **95/100** 提升到 **96/100**。和 cc-haha 的体验差距进一步收敛到：完整 PTY/xterm、Workspace hunk accept/reject、工具结果内联 diff block、Provider baseURL/proxy、更多组件/Store/API 回归测试、正式签名更新链路。视觉层面已经接近“可长期使用的桌面开发工作台”，后续重点应转向真实编辑工作流和发布工程的最后几块硬能力。

## 0.3 2026-05-19 Terminal 工作台能力更新：右侧内置终端与 workspace 绑定

本轮优先补齐 cc-haha 级体验里最影响“桌面开发工作台感”的 Terminal 缺口，采用轻量 shell 通道先打通端到端能力：

- 新增 `pi-server/terminal-service.ts`，通过 WebSocket 协议启动、输入、停止与回收终端进程；终端工作目录绑定当前 session 的 `projectPath`。
- 协议新增 `terminal_start`、`terminal_input`、`terminal_stop`、`terminal_started`、`terminal_output`、`terminal_exited`、`terminal_error`。
- 右侧多功能栏新增 `Terminal` 面板，支持启动状态、当前 cwd/shell 展示、命令输入、输出滚动、清屏、重启与停止。
- 左侧底部 `Terminal` 入口可直接打开/关闭右侧终端面板，终端与当前会话工作区联动。
- `server:smoke` 已扩展为真实启动终端并执行 `node -e` 命令，验证服务端 shell 通道和协议输出链路。

当前实现是“轻量内置 shell”，已经明显缩小 cc-haha 的 Terminal 体验差距；但它还不是 xterm + PTY：暂不支持完整 ANSI 终端交互、resize、全屏 curses/TUI 程序和高度拟真的终端键盘行为。后续应升级为 xterm 前端 + node-pty/ConPTY 或等价 PTY 后端。

当前自评分从 **94/100** 提升到 **95/100**。剩余核心差距收敛到：真正 PTY/xterm、Workspace hunk accept/reject、Provider baseURL/proxy、SDK 原生 session resume/fork、工具结果内联 diff block、组件/Store/API 测试、正式签名与自动更新。

## 0.2 2026-05-19 发布质量追赶更新：Asar、自包含 SDK 与首屏性能预算

本轮继续追赶 cc-haha 级别发布质量，重点补齐“打包版可真实运行 agent”和“发布构建干净可控”两条硬指标：

- `electron-builder` 已启用 `asar`，桌面主体进入 `app.asar`；外部进程需要访问的 `pi-server/dist` 与生产 `node_modules` 进入 `app.asar.unpacked`，不再使用完全裸目录发布。
- 根 `package.json` 新增 `@earendil-works/pi-coding-agent` 生产依赖，electron-builder 会收集 Pi SDK 及其运行时依赖，打包版不再依赖开发目录里的 `node_modules`。
- Electron 主进程现在会优先从 unpacked 区启动服务端，并在 `--smoke` 模式里调用 `/api/diagnostics`，验证 token/CORS 与 SDK 可导入状态。
- `/api/diagnostics` 新增 `sdk.available` 与关键导出检查；`server:smoke` 会断言 SDK 可用，避免“服务启动了但真实 agent SDK 缺失”的假阳性。
- 前端把设置、主题、扩展、Agents、Skills、Tasks、桌面诊断等非首屏视图改为 `React.lazy`；Markdown 高亮改为 Shiki fine-grained 按需加载，并使用 JS regex engine 避免 wasm 首包压力。
- Vite 构建已经消除 large chunk warning；主入口 chunk 从约 **795.93KB** 降到约 **206.97KB**，发布构建日志更接近可交付产品标准。

本轮验证：

- `npm.cmd run quality:release` 通过。
- 覆盖 typecheck、frontend/server build、tokenized server smoke、desktop smoke、LF 行尾检查、Electron asar 打包、packaged smoke。
- 打包后 smoke 输出 `smokeChecks.sdkAvailable: true`、`authEnabled: true`、`cors: loopback/file origins only`。

当前自评分从 **92/100** 提升到 **94/100**。和 cc-haha 相比，发布稳定性、打包自包含性、安全诊断和首屏性能预算已经明显接近；剩余核心差距继续集中在嵌入式 Terminal/PTY、Workspace hunk accept/reject、Provider baseURL/proxy、组件/Store/API 测试、正式签名与自动更新。

## 0.1 2026-05-19 发布质量追赶更新：Token 安全边界与 Quality Gate

本轮继续补齐 cc-haha 级别发布质量中最关键的“安全边界 + 质量门禁”能力：

- Electron 桌面壳启动 pi-server 时会生成一次性 `PI_DESKTOP_AUTH_TOKEN`，前端通过 preload 获取 token；HTTP API 使用 `Authorization: Bearer ...`，WebSocket 使用 `?token=...`。
- pi-server 在设置 token 后默认保护所有 UI/管理 API；`/health` 与飞书/微信入站 webhook 仍保持可访问，避免破坏外部事件回调。
- CORS 从无限制 `*` 收紧为 token 模式下仅允许 loopback、file/null origin，并统一返回 `X-Content-Type-Options: nosniff`。
- 新增 `/api/diagnostics`，聚合 server/runtime/security/counts/providers/dataDir 等信息；桌面诊断弹窗现在会展示 token/CORS/runtime/session/agent 状态。
- `server:smoke` 已进入鉴权模式：先验证未带 token 的管理 API 返回 401，再用 bearer token 跑 auth、permission、fork、project launch、diagnostics 与 WebSocket 主链路。
- 新增 `npm run quality` 与 `npm run quality:release`，串联 typecheck、build、server smoke、desktop smoke、LF 行尾检查；release 版本会额外执行桌面打包与 packaged smoke。

本轮验证：

- `npm.cmd run quality` 通过。
- 仍有 Vite large chunk warning，属于既有 Shiki/Mermaid/language bundles 体积问题，下一阶段应做按需加载与 chunk 拆分。

当前自评分从 **90/100** 提升到 **92/100**。和 cc-haha 相比，发布前稳定性和安全边界明显更接近；剩余核心差距仍集中在嵌入式 Terminal/PTY、Workspace hunk accept/reject、Provider baseURL/proxy、组件级测试、正式安装器签名/自动更新。

## 0. 2026-05-18 最新差距更新：Project Launch 与 Per-session Thinking

本轮继续缩小了 cc-haha 在“新会话启动体验”和“会话级运行时配置”上的领先：

- 已新增 `ProjectLauncher`，空状态不再只是一个“新建会话”按钮，而是可以直接查看最近项目、输入/选择工作区、读取 Git 仓库状态、选择分支，并选择是否创建隔离 worktree。
- 已新增 `/api/projects/recent` 与 `/api/repository/context`，服务端可返回最近项目、真实路径、Git 分支、dirty 状态、worktree 列表等元数据。
- `session_create` 已支持 `branch/worktree` 参数；选择隔离 worktree 时，服务端会通过 `git worktree add -b pi-desktop/...` 为会话准备独立工作目录。
- per-session runtime config 已从 `modelProvider/modelId` 扩展到 `thinkingLevel`，Composer 与状态栏切换 thinking 时只影响当前会话，服务端在 `prompt/steer/follow_up` 前按 session 同步 model + thinking。
- `server:smoke` 已覆盖 per-session model/thinking、recent projects、repository context；`desktop:smoke` 继续通过。

当前自评：**90/100**。主要剩余差距集中在：SDK 原生 session resume/fork 绑定、嵌入式 Terminal/PTY、Workspace hunk accept/reject、工具结果内联 diff block、Provider baseURL/proxy/OAuth，以及组件/Store/API 测试覆盖。

> 更新日期：2026-05-18  
> 当前项目：`d:\piCodeGUI` 当前工作区版本（含未提交改动）  
> 参考项目：`NanmiCoder/cc-haha`，本地参考副本已 `git fetch origin main`，对齐 `main` commit `cf7c448`（2026-05-17 00:56:16 +08:00）  
> 目标：持续拉平 Pi Agent Desktop 与 cc-haha 在桌面端开发工作台交互体验上的差距，同时保留 pi-agent 的运行时可扩展性。

## 1. 当前结论

当前版本已经从“可运行原型”推进到“桌面开发工作台雏形”：

- 有 Electron 过渡桌面壳：动态端口、托盘、窗口状态、原生菜单、启动诊断、日志/数据目录入口、desktop smoke。
- 有真实 Pi SDK runtime 接入：`PiAgentRuntime` 优先运行，失败时可 fallback 到 mock，并在状态栏/Toast 中暴露当前 runtime。
- 有权限闭环：`bash/edit/write` 前置拦截、专属预览、作用域规则、持久化规则、审计日志、设置页管理。
- 有 Provider/Credentials 基础闭环：保存/删除 API Key、枚举 SDK 模型目录、轻量 Test 诊断、模型列表刷新。
- 有 Workspace 右栏：Changes/Files、文件树、diff/file/image 预览、多 preview tab、行号范围选择、选区加入聊天、自动刷新、Usage 面板。
- 有输入器增强：`@` 工作区文件搜索、服务端 slash commands、图片附件、普通文本文件拖拽/选择为上下文、session draft、文件/选区 chip、queued follow-up、Composer 内模型/权限/thinking/context 控件。
- 有 per-session model 初版：每个 session 持久化 `modelProvider/modelId`，Composer 切模型只影响当前 session，服务端在 prompt/steer/follow-up 前按 session 模型同步 runtime。
- 有会话 fork/tree：可从 checkpoint/latest fork，会话保留 parent/child 关系，并在右栏展示时间线。

但 cc-haha 的完成度仍明显更高。它不仅是一个 UI 壳，而是具备 Tauri/Rust 原生能力、sidecar 发布、per-session runtime、完整 WorkspacePanel、嵌入式 Terminal、H5 远程入口、Provider/Proxy/Updater、Tasks/Teams/Computer Use、大量测试与质量门禁的成熟产品。

当前自评分：**88/100**。  
这代表主路径已经可用，但离“交互体验不分胜负”仍差 **桌面发布工程、会话恢复、Workspace 高级操作、运行中上下文/模型控制、Terminal、质量门禁** 这几块硬骨头。

## 2. 本轮继续推进内容

| 模块 | 本轮新增 | 对 cc-haha 差距的影响 |
| --- | --- | --- |
| Composer 文件拖拽 | `ChatInput` 现在支持拖拽/选择普通文本文件；非图片文本文件会作为 `<file_selection>` 上下文加入 prompt。 | 补齐 cc-haha Composer 文件拖拽的一部分，不再只支持图片。 |
| Composer 附件策略 | 图片仍走 base64 image attachment；文本文件走 inline excerpt，并限制 512KB，跳过二进制/不支持格式。 | 保持轻量，避免把大文件或二进制误塞进上下文。 |
| Workspace Preview Tabs | 预览 tab 新增右键菜单：Close、Close others、Close left/right、Close all。 | 对齐 cc-haha WorkspacePanel 的 tab 管理手感，多个文件/diff 查看更顺。 |
| Workspace Usage | 右栏 `Token Usage` 已从占位变为 session 用量、上下文估算、消息/工具统计和最近 usage 列表。 | 用户能看到上下文压力，开始接近 cc-haha Composer/Activity 的用量感知。 |
| Workspace 自动刷新 | Changes/Files 面板有 workspace summary、repo/branch/change count、auto/manual refresh。 | 更接近真实 Git 工作区，减少“右栏信息过期”的感觉。 |
| 服务端 Slash Commands | `connected` 协议下发 `slashCommands`，package 变更后可推送 `slash_commands_updated`；输入器不再只依赖本地硬编码。 | 向 cc-haha 的 runtime slash command 体验靠近，后续可接插件/运行时命令。 |
| Composer 内控制 | 输入器上方新增模型、权限、thinking 和 context usage 控件，可直接切换并同步到 runtime。 | 把模型/权限/上下文压力从状态栏/右栏前移到输入时刻，接近 cc-haha 的 Composer 操作密度。 |
| Per-session Model | `set_model` 支持 `sessionId`，当前会话模型落盘；运行前按会话模型同步 Pi runtime。 | 缩小 cc-haha per-session runtime config 差距，多会话可保留不同模型选择。 |

## 3. 规模与技术栈对比

| 项目 | 当前 Pi Agent Desktop | cc-haha |
| --- | ---: | ---: |
| 仓库文件数 | 75 | 3080 |
| 桌面/服务/前端主路径文件数 | 66 | 468 |
| 桌面壳 | Electron 过渡壳 | Tauri 2 + Rust |
| 后端/sidecar | Node `pi-server` 随 Electron 启动 | Bun 编译 sidecar + Tauri 启停 |
| 前端 | React 19 + Vite + Zustand | React 18 + Vite + Zustand |
| 实时代码执行 | Pi SDK runtime + mock fallback | Claude CLI/SDK/sidecar 完整链路 |
| Workspace | REST + Git + 文件树/预览/diff | 更完整 WorkspacePanel、tabs、行评论、Markdown、图片、选择浮层 |
| Terminal | 已升级为 xterm + PTY/ConPTY，失败时自动降级 pipe | xterm + Tauri PTY |
| 发布 | Electron builder/NSIS + smoke + electron-updater 主链路 | Tauri bundle、updater、capabilities、平台脚本 |
| 测试 | typecheck/build/server smoke/desktop smoke | 大量 server/store/API/desktop/quality gate 测试 |

规模不是目标，但它说明 cc-haha 的能力覆盖面远大于当前项目。我们不应机械复制所有重功能，但主路径的细节还要继续补。

## 4. 分模块差距清单

### 4.1 桌面壳与发布工程

| 对比项 | 当前 Pi Agent Desktop | cc-haha | 差距等级 |
| --- | --- | --- | --- |
| 原生壳 | Electron，可开发/打包目录版 | Tauri 2 + Rust 主进程 | P1 |
| sidecar | Electron 启动 Node `pi-server` | 独立 Bun sidecar 二进制 | P0 |
| 动态端口 | 已支持 | 已支持 | 基本拉平 |
| 启动诊断 | 已支持启动页、失败页、日志、restart | 更完整 Tauri runtime/H5 诊断 | P1 |
| 托盘/菜单 | 已支持核心菜单 | 更成熟跨平台菜单/托盘 | P1 |
| 安装器/签名/更新 | `electron-builder` NSIS + `electron-updater` 主链路；签名/发布源流水线待补 | Tauri bundle targets + updater | P1 |
| 安全边界 | HTTP/WS 本地可用，token/CORS 仍轻 | H5 token、Tauri capabilities、sidecar 白名单 | P0 |

结论：开发体验和自动更新主链路已经可用，但发布工程还差正式签名、稳定更新源、旧版本升级回归与平台分发策略。若坚持轻量，可继续 Electron；若追求 cc-haha 级别发布质量，需要把 sidecar、签名、更新发布、权限边界和质量门禁继续做成一条流水线。

### 4.2 Runtime 与会话执行

| 对比项 | 当前 Pi Agent Desktop | cc-haha | 差距等级 |
| --- | --- | --- | --- |
| 真实 runtime | 已接 Pi SDK，自动 fallback mock | Claude CLI/SDK 主链路成熟 | P1 |
| 会话生命周期 | 桌面 session 与 SDK session 仍未完全同源 | per-session runtime/session 文件绑定 | P0 |
| resume | 桌面消息可恢复，SDK 原生 resume 不完整 | transcript/session resume 成熟 | P0 |
| fork | 桌面层复制历史并建分支 | 更接近真实 runtime/session 分支 | P1 |
| stop/abort | 已调用 runtime abort | 子进程/turn 级中断成熟 | P1 |
| steer/follow-up | 协议已有，依赖 runtime 能力 | 成熟队列/并发处理 | P1 |
| runtime 配置 | 全局模型/思考级别为主 | per-session runtime config | P0 |

结论：当前已跨过“mock demo”门槛，但要达到 cc-haha 的可信长期工作流，必须把桌面 session、SDK session、transcript、resume/fork 绑定成同一套生命周期。

### 4.3 聊天输入器

| 对比项 | 当前 Pi Agent Desktop | cc-haha | 差距等级 |
| --- | --- | --- | --- |
| 文本输入/发送/停止 | 已支持 | 已支持 | 基本拉平 |
| queued follow-up | 已支持显示与发送 | 更成熟队列与状态反馈 | P1 |
| session draft | 已支持 | 已支持 | 基本拉平 |
| 图片附件 | 支持粘贴/拖拽/选择 | 支持更完整 attachment gallery | P1 |
| 普通文件附件 | 已支持文本文件 inline context | 支持更完整文件处理与 gallery | P1 |
| `@` 文件搜索 | 已支持 workspace search | 更成熟文件搜索与 reference store | P1 |
| Slash 命令 | 服务端下发 + fallback 合并，插件命令入口已留好 | runtime slash + fallback 合并 | P1 |
| 模型/权限控件 | Composer 内已支持模型、权限、thinking 切换 | Composer 内置 ModelSelector/PermissionModeSelector | 基本拉平 |
| Context usage | Composer 内估算 + 右栏 Usage 面板 | Composer 内 ContextUsageIndicator | P1 |
| 项目启动控件 | 顶部/菜单选择项目 | Composer 内 RepositoryLaunchControls、branch/worktree | P0 |

结论：输入器已经有“像工作台”的雏形；下一步最该补的是动态 slash、Composer 内模型/权限/上下文用量，以及项目/分支/worktree 启动控件。

### 4.4 Workspace 右侧面板

| 对比项 | 当前 Pi Agent Desktop | cc-haha | 差距等级 |
| --- | --- | --- | --- |
| Git changed files | 已支持 | 已支持 | 基本拉平 |
| Files tree | 已支持懒加载目录 | 已支持更完整 store/筛选 | P1 |
| diff/file preview | 已支持 | 已支持更细高亮/状态 | P1 |
| preview tabs | 已支持多 tab + 右键批量关闭 | 支持更完整 tab/context menu | P1 |
| 图片预览 | 已支持 | 已支持 | 基本拉平 |
| Markdown 预览 | 目前按文本预览 | 支持 Markdown preview | P1 |
| 代码高亮 | 当前预览是纯文本/diff 样式 | Shiki token 高亮 | P1 |
| 选区加入聊天 | 已支持行号选择范围加入聊天 | 支持选区浮层/行评论 | P1 |
| 行评论 | 尚无 inline comment editor | 支持 line comment to chat | P1 |
| 文件右键菜单 | 尚弱 | add to chat、copy path 等 | P1 |
| hunk accept/reject | 尚无 | 更接近完整 diff 工作流 | P0 |
| FS watch | 轮询/事件刷新 | 更实时的 workspace state | P1 |

结论：Workspace 已是当前最接近 cc-haha 的区域之一。剩余差距集中在“编辑型操作”：hunk 采纳/拒绝、Markdown/代码高亮、行评论、文件右键菜单、真实 watcher。

### 4.5 权限系统

| 对比项 | 当前 Pi Agent Desktop | cc-haha | 差距等级 |
| --- | --- | --- | --- |
| 权限弹窗 | 已支持 | 已支持 | 基本拉平 |
| Bash preview | command/cwd/risk 已支持 | 更成熟命令分类 | P1 |
| Edit/Write preview | 拟议 diff 已支持 | 更成熟 diff 与工具上下文 | P1 |
| Allow & Remember | session/project/global 规则 | scoped rules 更成熟 | P1 |
| 审计日志 | 已落盘并在设置页查看 | 更完整 activity/history | P1 |
| 权限模式 | ask/acceptEdits/plan/bypass 已影响 runtime | 与 CLI 参数/重启策略更紧密 | P1 |
| 命令编辑/updated input | 尚无 | 支持更细交互 | P0 |
| 执行后 diff reconciliation | 尚无 | 更完整 | P0 |

结论：权限体验已经进入可用阶段，甚至保留了 pi-agent 的轻量特点。要继续追平，需要让用户能在批准前编辑命令/参数，并在执行后看到实际 diff 与批准内容是否一致。

### 4.6 Provider、模型与设置

| 对比项 | 当前 Pi Agent Desktop | cc-haha | 差距等级 |
| --- | --- | --- | --- |
| API Key 管理 | 已支持保存/删除 | 已支持 provider presets/OAuth/代理 | P1 |
| Provider Test | 本地 auth/model registry 轻量测试 | 更完整 provider/proxy/live smoke | P1 |
| 模型目录 | 从 Pi SDK ModelRegistry 读取 | 更完整 provider/model role mapping | P1 |
| per-session model | 尚不完整 | 支持 runtimeKey/session 维度 | P0 |
| Proxy/baseURL | 尚无 UI | 支持 proxy/baseURL/provider presets | P0 |
| OAuth | 尚无 | 有相关入口/能力 | P1 |
| MCP/Memory/Skills/Plugins | 有扩展 UI 骨架 | cc-haha 更完整 | P1 |
| Diagnostics 聚合 | 分散在状态栏/桌面诊断/设置页 | 更系统 | P1 |

结论：Provider 基础闭环已成型，但离 cc-haha 的“复杂环境可配置”还有距离，尤其是 baseURL/proxy、per-session runtime config 和更强诊断。

### 4.7 消息、工具调用与可视化

| 对比项 | 当前 Pi Agent Desktop | cc-haha | 差距等级 |
| --- | --- | --- | --- |
| Markdown | 已有 marked/DOMPurify/Shiki/Mermaid 依赖和基础渲染 | 更成熟路径、表格、代码、Mermaid 处理 | P1 |
| Thinking | 已支持 | 已支持 | 基本拉平 |
| 工具卡片 | 单卡片参数/结果 | 分组、嵌套、专属渲染更多 | P1 |
| Bash 输出 | 基础文本结果 | 命令摘要、折叠、错误突出 | P1 |
| 文件编辑结果 | 右栏 diff 间接查看 | 工具结果与 diff 更强关联 | P0 |
| Agent/Task/Memory 事件 | 较少 | 多事件类型与 UI | P1/P2 |
| 用量统计 | 右栏 session usage | Composer indicator + Activity/usage | P1 |

结论：消息可读性还没有 cc-haha 那种“复杂任务也不淹没用户”的层次。下一步要做工具调用分组、bash 专属 UI、文件编辑 diff block。

### 4.8 Terminal、Tasks、Teams、H5 与高级能力

| 对比项 | 当前 Pi Agent Desktop | cc-haha | 差距等级 |
| --- | --- | --- | --- |
| 内置 Terminal | 已有轻量 shell Terminal；缺 true PTY/xterm/resize | xterm + PTY | P1 |
| Terminal settings | 无 | 有 | P1 |
| 计划任务 | 无 | 有 task/schedule 相关能力 | P2 |
| Teams/成员状态 | 无 | 有 team watcher/member transcripts | P2 |
| Computer Use | 无 | 有弹窗/状态入口 | P2 |
| H5/远程访问 | 无 | 有 token/CORS/远程页面 | P2 |
| IM/通知 | 基础 toast/桌面诊断 | 更完整 | P2 |

结论：如果目标是“开发工作台不输 cc-haha”，Terminal 是 P0；Teams、Computer Use、H5 可以后置，不应阻塞核心 coding agent 桌面体验。

### 4.9 测试与质量门禁

| 对比项 | 当前 Pi Agent Desktop | cc-haha | 差距等级 |
| --- | --- | --- | --- |
| Typecheck | 已有 frontend/server | 更完整 | P1 |
| Build | 已有 frontend/server | 更完整 | P1 |
| Server smoke | 已覆盖 auth/test/permissions/fork/prompt | 更大量 API/server 单测 | P1 |
| Desktop smoke | 已有 Electron smoke | 有 desktop smoke/quality gate | P1 |
| Component tests | 少 | 多 | P0 |
| Store/API tests | 少 | 多 | P0 |
| Packaged regression | 有基础脚本 | 更成熟平台构建 | P1 |
| 性能预算 | 尚无 | 有更多工程约束 | P1 |

结论：当前自动化足以防主链路断掉，但不足以支撑“放手补齐大量交互”。继续开发前应补关键组件/Store/API 测试，否则 UI 回归风险会升高。

## 5. P0/P1/P2 缺口总表

### P0：体验不分胜负前必须补

| 缺口 | 当前状态 | 补齐标准 |
| --- | --- | --- |
| SDK 原生会话恢复 | 桌面消息可恢复，runtime session 未完全同源 | 重启后能恢复 SDK session，并继续 steer/follow-up/abort |
| per-session model/runtime config | provider/model 已支持 session 级持久化；thinking 仍偏全局 | 每个 session 可独立 provider/model/thinking，运行中切换有明确策略 |
| 动态 slash command | 已由服务端下发并与 fallback 合并，仍未接真实 runtime 命令源 | 从 runtime/extensions 拉取 slash commands，并与 fallback 合并 |
| Composer 内模型/权限/上下文用量 | 已能直接切模型/权限/thinking 并查看 context pressure | 输入器内可直接切模型、切权限、看 context pressure |
| Repository/branch/worktree 启动控件 | 目录选择较基础 | 新会话可选最近项目、分支、是否创建 worktree |
| Workspace hunk/edit 操作 | 只能看 diff | 支持至少 file-level/hunk-level accept/reject 或等价工作流 |
| 工具结果 diff block | 文件编辑后靠右栏看 | edit/write 工具结果直接展示 changed files/diff summary |
| 嵌入式 Terminal | 已有右侧 xterm + PTY/ConPTY，可跟当前 workspace 绑定 | 右侧或底部有 PTY terminal，可跟当前 workspace 绑定 |
| Provider baseURL/proxy | 缺失 | provider 可配置 baseURL/proxy，并有测试/错误诊断 |
| 组件/Store/API 测试 | 很少 | ChatInput、RightPanel、Permission、Provider、workspace API 有回归测试 |

### P1：接近 cc-haha 质感需要补

| 缺口 | 当前状态 | 补齐标准 |
| --- | --- | --- |
| Workspace Markdown/代码高亮 | 纯文本为主 | Markdown preview、Shiki 代码高亮、表格/大文件处理 |
| 行评论/选区浮层 | 行号选择可加入聊天 | 支持选区浮层和 line comment editor |
| 文件右键菜单 | 弱 | copy path、add file/selection to chat、reveal 等 |
| 权限命令编辑 | 无 | 用户批准前可编辑 bash/update input |
| 权限执行后对照 | 无 | 执行后实际 diff 与预览 diff 可对照 |
| Usage/Activity | session usage | 全局 activity、项目/模型维度统计 |
| Diagnostics 聚合 | 分散 | 统一 runtime/provider/workspace/desktop diagnostics |
| 正式安装包/更新 | Electron NSIS + 图标 + 自动更新主链路已接入 | 补齐签名、正式更新源与跨版本升级回归 |
| 性能优化 | Vite large chunk warning 已消除，首屏 chunk 已降至约 206.97KB | 继续保持 Shiki/Mermaid 按需加载与体积预算 |

### P2：可后置的 cc-haha 重能力

| 缺口 | 说明 |
| --- | --- |
| H5 远程访问 | 对齐 cc-haha 会加分，但不是 pi-agent 桌面 MVP 的刚需。 |
| Teams/多 Agent 协作 | 可以保留插件化入口，等核心单人开发流稳定后做。 |
| Computer Use | 依赖 pi-agent 能力与安全策略，建议后置。 |
| 计划任务/定时任务 | 属于工作流增强，不阻塞当前交互追平。 |
| IM/团队通知 | 与核心 coding agent 桌面体验关联较弱，可后置。 |

## 6. 下一阶段推进顺序

| 顺序 | 工作项 | 目标产出 | 预计影响 |
| ---: | --- | --- | --- |
| 1 | per-session runtime config + SDK session resume | session 与 runtime 生命周期可信 | 总评分 +3 |
| 2 | Composer 内模型/权限/context usage + 动态 slash | 输入器体验接近 cc-haha | 总评分 +3 |
| 3 | RepositoryLaunchControls：最近项目、分支、worktree | 新会话启动体验接近 cc-haha | 总评分 +3 |
| 4 | 签名、更新源与跨版本升级回归 | 自动更新达到正式发布可信度 | 总评分 +2 |
| 5 | Workspace Markdown/Shiki/行评论/文件菜单 | 右栏交互继续拉平 | 总评分 +3 |
| 6 | 工具调用分组 + edit/write diff block | 长任务可读性提升 | 总评分 +3 |
| 7 | Provider baseURL/proxy + 统一 Diagnostics | 复杂环境可用性提升 | 总评分 +2 |
| 8 | 组件/Store/API 测试 + packaged smoke | 放手迭代的质量保障 | 总评分 +3 |

## 7. 验收口径

达到“和 cc-haha 交互体验不分胜负”，至少要满足：

- 用户双击桌面应用即可进入项目，不需要手动启动服务。
- 选项目、新建 session、选模型、选权限、加文件上下文都能在主工作台内完成。
- 发起真实开发任务后，用户能清楚看到 thinking、工具调用、权限请求、文件 diff、命令输出和最终状态。
- Agent 修改文件前有可读预览，修改后有可追踪 diff；用户能从右栏把文件/选区/行评论加入下一轮 prompt。
- 长会话能恢复、能 fork、能继续执行，不因为重启桌面壳丢失 runtime 语境。
- Provider 配错时能在设置/诊断里定位；模型切换和权限模式切换有明确行为。
- 至少有 Terminal、Workspace、Composer、Permission、Provider 五条主路径的自动化回归。

## 8. 当前剩余风险

- 当前 Electron 过渡壳可用，但如果后续决定迁移 Tauri，会产生一轮桌面层重构。
- `PiAgentRuntime` 的 SDK session resume/fork 尚未完全产品化，真实长会话仍可能退回桌面层模拟。
- Workspace 文件读取和文本附件 inline 仍需更强的安全/大小策略，避免误塞敏感或超大内容。
- 前端交互复杂度已经上升，但组件测试还没跟上。
- Vite 大 chunk warning 已消除；后续风险转为保持懒加载边界，避免新功能再次把 Shiki/Mermaid/大型语法包塞回首包。
