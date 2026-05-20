# Pi Agent Desktop Electron 到 Tauri 迁移必要性评估

更新日期：2026-05-20

## 1. 结论

当前不建议立即从 Electron 迁移到 Tauri。更稳妥的路线是：

1. 继续以 Electron 壳推进发布质量和 cc-haha 交互差距补齐。
2. 单独开一个 Tauri feasibility spike，只验证最小闭环，不阻塞主线。
3. 只有当安装包体积、内存、安全合规或品牌层面的原生化要求成为硬指标时，再进入正式迁移。

原因是当前 Electron 壳已经不是临时壳。它已经承载了 server sidecar、动态端口与鉴权、托盘、菜单、窗口状态、独立 Markdown/代码/Terminal 窗口、多标签拆分/合并、自动更新、packaged smoke 等关键桌面能力。迁移到 Tauri 会重做这些桌面运行时能力，而不是简单替换 WebView。

## 2. 当前 Electron 壳能力盘点

当前 `desktop/main.cjs` 和 `desktop/preload.cjs` 已经覆盖：

- Pi server sidecar 生命周期：动态端口、启动等待、日志收集、重启、退出清理。
- 安全边界：一次性 `PI_DESKTOP_AUTH_TOKEN`、HTTP Bearer token、WebSocket token、loopback/file origin 限制。
- 窗口体系：主窗口、独立 Markdown 窗口、独立代码窗口、独立 Terminal 窗口、工具多标签窗口。
- 标签能力：独立窗口内多标签、拖出拆分、拖回合并、关闭/激活状态同步。
- 系统集成：托盘、Windows AppUserModelID、应用图标、macOS 菜单框架。
- 自动更新：`electron-updater` 状态机、检查/下载/安装 IPC、设置页展示。
- 打包与验证：NSIS x64/ia32、asar/unpack、`desktop:smoke`、`desktop:smoke:packaged`。

这些能力都和 cc-haha 级桌面体验强相关。短期重写会把主要精力从“补功能差距”转移到“重建壳能力”。

## 3. Tauri 的真实收益

Tauri 的优势是明确存在的：

- 更小的桌面壳体积。Tauri 官方文档也强调默认二进制较小，并提供 release profile、LTO、strip、移除未使用命令等体积优化方向。
- 更强的权限与能力模型。Tauri v2 的 sidecar、shell、updater 等能力需要显式 capability/permission 配置。
- 可用系统 WebView，理论上减少随包携带 Chromium 的成本。
- Updater 强制签名校验，安全发布链路更硬。

但这些收益对 Pi Agent Desktop 不是“无成本收益”。Pi Agent 的核心 runtime 仍是 Node/TypeScript/ESM SDK，并且 package/extension/skill 体系需要 npm/git/local package 能力。迁移 Tauri 后仍然要带一个 Node sidecar，或者把 Node server 编译为自包含二进制。

## 4. 迁移成本与风险

### 4.1 Node sidecar 仍然不可避免

Tauri 官方 sidecar 文档说明外部二进制需要通过 `externalBin` 打包，并且每个目标架构需要对应 target triple 后缀。Node sidecar 指南也建议把 Node 应用打包为自包含二进制，或内嵌 Node runtime。对本项目来说，这意味着：

- 需要为 Windows x64/ia32、macOS、Linux 分别验证 server sidecar。
- `node-pty` / ConPTY 原生依赖仍需要单独验证。
- `@earendil-works/pi-coding-agent` 以及动态 package 安装链路需要确保在 sidecar 模式下可用。
- 当前 `electron-as-node` 复用 Electron runtime 的方式需要替换。

### 4.2 桌面 IPC 与窗口系统需要重写

Electron 当前直接使用 `BrowserWindow`、`ipcMain`、`Tray`、`Menu`。Electron 官方文档中 BrowserWindow 用于创建和控制窗口，ipcMain 负责主进程和渲染进程通信，Tray 负责系统通知区域菜单。这些在项目里已经深度使用。

迁移 Tauri 后需要重做：

- preload bridge 到 Tauri command/event bridge。
- 主窗口、独立工具窗口、多标签窗口的创建与状态同步。
- 拖拽拆分/合并标签的跨窗口消息。
- 托盘菜单、系统菜单、窗口状态保存。
- 目录选择、日志目录打开、更新状态推送。

### 4.3 自动更新链路需要重新建设

Tauri updater 支持静态 JSON 或动态更新服务，但需要签名，并要求配置 `pubkey`、更新 endpoint、artifact 生成。当前 Electron 已经接入 `electron-updater`，虽然还需要正式发布源和签名，但应用内状态机、UI、IPC 已经成型。

迁移会使自动更新从“补齐发布源与签名”变成“重做 updater 插件集成、签名、manifest、回归测试”。

## 5. 决策矩阵

| 维度 | 继续 Electron | 迁移 Tauri |
| --- | --- | --- |
| 短期交付速度 | 高，当前壳能力可继续复用 | 低，需要重建桌面运行时 |
| cc-haha 交互追平 | 更直接，可继续补功能 | 会被壳迁移稀释 |
| 安装包体积 | 较大 | 更有优势，但 Node sidecar 会抵消一部分 |
| 内存占用 | 较高 | 有机会降低 |
| 安全能力模型 | 依赖 Electron 安全配置与本地 token | Tauri capability 模型更细 |
| 自动更新 | 主链路已接入 | 需要重建签名和 manifest 链路 |
| Node SDK 适配 | 原生适配，成本低 | 仍需 sidecar/自包含二进制 |
| 原生窗口能力 | 已完成较多 | 可实现，但要重写 |
| 迁移风险 | 低 | 中高 |

## 6. 推荐路线

### Phase A：Electron 发布质量继续推进

目标：尽快达到 cc-haha 级可发布质量。

- 继续补齐 Provider baseURL/proxy、workspace hunk accept/reject、工具结果 diff block。
- 增强 component/store/API 测试。
- 完成正式签名、更新源、跨版本升级回归。
- 保持桌面壳 smoke 和 packaged smoke 为必过门禁。

### Phase B：Tauri feasibility spike

目标：只验证必要性，不影响主线。

验收项：

- Tauri 主窗口能加载当前 Vite 前端。
- 能通过 Tauri sidecar 启动 `pi-server/dist/server.cjs` 或自包含 server binary。
- 能完成 server URL/token 注入、WebSocket 连接、发送一条消息。
- 能打开一个独立 Markdown 或代码窗口。
- 能在 Windows x64/ia32 至少完成一次打包验证。
- 能证明 node-pty/ConPTY 在 sidecar 打包后可用或有可接受替代方案。

不在 spike 阶段重做完整托盘、自动更新、多标签拖拽、渠道、主题、阅读器。

### Phase C：迁移触发条件

满足任一条件再进入正式迁移：

- Windows 安装包体积或运行内存成为明确发布阻塞。
- 需要 Tauri capability 模型满足安全审计或企业部署要求。
- Electron 壳维护成本明显高于 Tauri 重建成本。
- 主线核心能力已经接近稳定，迁移不会影响 cc-haha 体验追平。

## 7. 本轮同步补齐的差距

本轮除迁移评估外，已补齐 Provider baseURL/proxy 配置主链路：

- 后端新增 Pi agent 路径统一工具，`auth.json` 与 `models.json` 使用同一 `PI_AGENT_DIR`。
- `/api/auth/provider-config` 支持保存/清除 provider baseURL。
- SDK provider catalog、runtime session、auth status 均读取同一个 `models.json`。
- 设置页凭据模块新增 API endpoint/proxy 输入、保存、清除、状态展示。
- `server:smoke` 增加 provider endpoint 保存/清除回归，并避免写入用户真实 `~/.pi/agent`。

这项能力直接缩小了与 cc-haha 在复杂网络、企业网关、OpenAI/Anthropic 兼容代理场景上的差距。

## 8. 参考资料

- Tauri sidecar：<https://v2.tauri.app/develop/sidecar/>
- Tauri Node.js sidecar：<https://v2.tauri.app/learn/sidecar-nodejs/>
- Tauri updater：<https://v2.tauri.app/plugin/updater/>
- Tauri app size：<https://v2.tauri.app/concept/size/>
- Electron BrowserWindow：<https://www.electronjs.org/docs/latest/api/browser-window>
- Electron ipcMain：<https://www.electronjs.org/docs/latest/api/ipc-main>
- Electron Tray：<https://www.electronjs.org/docs/latest/api/tray>
- Electron autoUpdater：<https://www.electronjs.org/docs/latest/api/auto-updater>
