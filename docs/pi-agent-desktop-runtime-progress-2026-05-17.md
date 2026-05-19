# Pi Agent Desktop Runtime Progress - 2026-05-17

本轮目标是继续缩小与 cc-haha 的核心交互差距，优先处理“桌面端能否驱动真实 Agent 能力”而不是继续停留在 mock 体验层。

## 新增落地能力

| 模块 | 本轮进展 |
| --- | --- |
| AgentRuntime 抽象 | 新增 `AgentRuntime` 接口，将 mock 与 pi-agent SDK 运行时解耦，server 主链路不再直接依赖 `simulateAgentResponse()` |
| 真实 PiAgentRuntime | 新增 `PiAgentRuntime`，通过 `@earendil-works/pi-coding-agent` SDK 创建会话，映射 text/thinking/tool/result/queue/compaction/status 事件到现有 WebSocket 协议 |
| 自动回退 | 新增 `PI_AGENT_RUNTIME=mock/pi/auto`，默认 `auto`；SDK 不可用或未完成鉴权时自动回退 mock，避免桌面壳不可演示 |
| 打包真实运行时 | server bundle 不再 external 掉 pi SDK 主依赖，`pi-server/dist/server.cjs` 已包含 SDK 运行时代码 |
| 流式 follow-up | 前端流式中保留 Stop，同时允许继续输入并排队 follow-up；server 支持 `follow_up` / `steer` 转发，mock runtime 也实现了基础队列 |
| 模型/思考同步 | `set_model`、`set_thinking_level` 会同步到已创建的 PiAgentRuntime session，减少 UI 状态与真实 SDK session 脱节 |
| 协议 smoke | 新增 `npm run server:smoke`，自动启动构建后的 server、创建会话、完成流式 prompt，并验证 permission deny 链路 |

## 重新评分

| 维度 | 新评分 | 变化 |
| --- | ---: | --- |
| 总体交互完成度 | 62/100 | 从桌面 MVP 进入“可接真实 runtime”的阶段 |
| 桌面壳与启动恢复 | 76/100 | 打包、动态端口、诊断、托盘、菜单、窗口状态均可用 |
| 真实 PiAgentRuntime | 48/100 | SDK 已接入并可打包，但真实模型鉴权、权限拦截、长期会话恢复还未完整闭环 |
| 聊天主链路 | 70/100 | streaming/thinking/tool/permission/stop/follow-up/persistence 基础齐备 |
| 工作区 Changes/Files | 55/100 | 可浏览、预览、diff、引用到聊天，但缺少 cc-haha 级别的多标签 diff 和逐块采纳 |
| 输入器体验 | 66/100 | @ 文件、图片、slash 菜单、session draft、流式 follow-up 已有；还缺完整快捷键体系 |
| 测试与发布质量 | 64/100 | typecheck/build/server protocol smoke/desktop smoke/packaged smoke 已跑通 |
| 安全与权限体系 | 38/100 | mock permission 可用；真实 SDK 工具执行前的桌面权限拦截仍是 P0 |

## 验证结果

| 命令 | 结果 |
| --- | --- |
| `npm.cmd run typecheck` | 通过 |
| `npm.cmd run build` | 通过，仍有 Vite 大 chunk warning |
| `npm.cmd run server:smoke` | 通过，覆盖 WebSocket prompt 与 permission deny |
| `npm.cmd --workspace desktop run smoke` | 通过 |
| `npm.cmd run desktop:pack` | 通过，生成 `release/win-unpacked` |
| `npm.cmd run desktop:smoke:packaged` | 通过 |

## 仍需补齐

| 优先级 | 缺口 | 下一步 |
| --- | --- | --- |
| P0 | 真实 SDK 工具权限拦截 | 通过 pi SDK extension/tool hook 或自定义 tool wrapper，在 bash/write/edit 前弹出桌面权限确认 |
| P0 | SDK 鉴权 UI | 在 Settings 增加 provider/API key/OAuth 状态页，避免只能依赖 CLI/环境配置 |
| P0 | 会话恢复一致性 | 将桌面 session 与 pi SDK session file/runtime session 对齐，支持 resume/fork/tree |
| P1 | Diff 交互 | 右侧 Changes 增加多文件 tabs、逐块查看/采纳、编辑后自动刷新 |
| P1 | 性能 | 对 Shiki 语言包和 Mermaid 做更细粒度懒加载，消除主要大 chunk warning |
| P1 | cc-haha 高阶能力 | Worktree/多项目并行、任务调度、Computer Use、远程入口、用量统计仍未达到同级 |

参考项目仍以 <https://github.com/NanmiCoder/cc-haha> 的当前公开说明为对齐对象；本轮追近的是核心桌面 Agent 工作流，尚未覆盖 cc-haha 的远程访问、Computer Use、定时任务等高阶体验。
