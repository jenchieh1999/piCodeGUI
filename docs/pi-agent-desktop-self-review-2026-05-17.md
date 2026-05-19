# Pi Agent Desktop 自查自修记录

> 日期：2026-05-17  
> 范围：Electron 桌面壳、前端连接状态、聊天输入/停止、mock transcript 持久化、打包 smoke。

## 1. 当前进度评分

评分以“达到 cc-haha 核心交互体验”为 100 分目标。

| 维度 | 评分 | 说明 |
| --- | ---: | --- |
| 总体交互完成度 | 46/100 | 已从 Web 原型推进到可打包桌面 MVP，但真实 pi-agent runtime 仍未接入 |
| 桌面壳与启动恢复 | 68/100 | 动态端口、托盘、菜单、窗口状态、诊断、目录级打包 smoke 已完成 |
| mock 聊天主链路 | 58/100 | 用户消息、streaming、thinking、tool、permission、stop、持久化基础可用 |
| 工作区 Changes/Files | 52/100 | Git status、tree、file preview、diff、加入聊天已可用，缺 preview tabs 与行级交互 |
| 输入器体验 | 57/100 | 支持 @ 文件引用、图片、session draft；缺动态 slash、通用文件拖拽、上下文用量 |
| 真实 PiAgentRuntime | 10/100 | 依赖存在但仍是 mock runtime，是当前最大 P0 缺口 |
| 测试与发布质量 | 38/100 | typecheck/build/desktop smoke 通过，但缺自动化协议/store/server 测试 |
| 安全与权限体系 | 30/100 | permission gate 可用，缺 scoped rules、token、CORS 收紧、审计日志 |

## 2. 本轮代码审查发现与修复

| 问题 | 风险 | 修复 |
| --- | --- | --- |
| Electron server 子进程退出后，UI 可能继续显示旧 `serverUrl` | server 已死但前端误以为可用，形成“假在线” | `desktop/main.cjs` 为子进程事件绑定进程身份，当前进程退出时清空 `serverUrl` 并发状态 |
| 菜单/诊断重启 server 后，前端可能仍连旧端口 | 重启后 WebSocket 挂在旧地址，交互失败 | `PiApiClient.reconnectToServerUrl()` 强制关闭旧 socket 并连接新地址；`App` 监听桌面状态后切端口 |
| 停止生成只发 server 消息，前端 streaming 状态可能不归零 | 输入栏一直显示 Stop，用户以为还在运行 | `chatStore.stopStreaming()` 在 status idle/error 时清理 streaming message 和 pending permission |
| 发送失败只写 console，输入器会清空内容 | 断线时用户 prompt 丢失 | `piApi.send()` 返回 boolean；`ChatView` 失败时 toast；`ChatInput` 仅成功后清空 |
| prompt 构建异常没有用户可见反馈 | 文件引用读取/网络异常时像“没反应” | `ChatInput` catch 异常并展示 toast |
| 中断生成后 partial assistant 不落盘 | 重启后上下文缺少被中断过程 | `TranscriptRecorder.completeInterrupted()` 将已有 partial assistant 标记为非 streaming 后保存 |
| abort 后仍可能录制前端未收到的事件 | transcript 与 UI 可见历史不一致 | `recordAndSend()` 先检查 abort/socket 状态，再写 transcript 和发送 |
| 欢迎页 quick start 图标乱码 | 首屏观感差，像编码损坏 | 改为 lucide 图标，移除乱码字符 |

## 3. 自查结论

本轮修复后，桌面壳从“能启动”推进到“状态更可信”：server 崩溃、重启、停止生成、断线发送这几条容易造成假死/误导的路径都被收紧了。

仍然需要优先推进的 P0：

1. 抽象 `AgentRuntime`，把 mock 与真实 `@earendil-works/pi-coding-agent` 解耦。
2. 接入真实 read/edit/bash 工具事件，并把 permission/diff/file_changes 映射到 UI。
3. 增加协议级自动化测试：prompt 完整流、permission allow/deny、stop generation、workspace diff。
4. 继续补桌面发布工程：正式图标、签名、安装器、asar 策略或 Tauri sidecar。
5. 收紧本地 server 安全边界：loopback token、CORS 白名单、权限审计。

## 4. 已验证命令

| 命令 | 结果 |
| --- | --- |
| `npm.cmd run typecheck` | 通过 |
| `npm.cmd run build` | 通过，Vite 仍有大 chunk warning |
| `npm.cmd --workspace desktop run smoke` | 通过，本地 Electron 可自启动 server |
| `npm.cmd run desktop:pack` | 通过，生成 `release/win-unpacked` |
| `npm.cmd run desktop:smoke:packaged` | 通过，打包后 exe 可自启动内置 server |

## 5. 当前风险

- 真实开发能力仍被 mock runtime 限制，不能宣称已达到 cc-haha 的真实 Agent 工作流。
- `electron-builder.yml` 当前为了绕过 Windows symlink/signing 限制关闭了 `asar` 和可执行文件签名编辑，只适合 MVP 验证。
- 前端 chunk 仍偏大，Shiki/Mermaid 语言包需要继续做按需切分。
- docs 在 Windows PowerShell 输出中可能出现编码显示问题，VS Code 内如发现实际乱码，应统一转 UTF-8。
