# Pi Agent Desktop 扩展、包、技能能力落地方案

更新时间：2026-05-20

## 0.1 2026-05-20 Multi-Agent Skill 方向补充

在扩展、包、技能体系已能加载真实 `SKILL.md` 后，本轮把技能能力继续向 Agent 编排靠拢，参考 ClawHub `subagent-driven-development` 与 `self-improving-agent` 两类 skill 的思路，新增桌面端多 Agent 能力落地项：

- Agents 数据模型新增 `role`、`parentAgentId`、`subAgent`、`selfImprovement`，后续技能可直接声明自己适合的 Agent 角色与委派策略。
- Runtime prompt 前置新增启发式编排层：复杂任务自动进入 Planner / Implementer / Reviewer / Tester / Documenter 工作流；简单任务不额外包装，避免增加轻量任务成本。
- 自我进步记录新增项目级 `.pi/learnings` 持久化，既能通过 UI 手动记录，也能从用户纠正和 runtime failure 自动捕捉。
- Agents 页面新增 SubAgent 编排配置与 self-improvement learning 面板，形成“配置 Agent -> 复杂任务自动编排 -> 失败/纠正沉淀经验 -> 后续 prompt 注入经验”的第一版闭环。

后续 P1：把当前 prompt-level 编排升级为真实并行子会话执行，并将 learning 记录审核后提升为项目 skill 或 package 内置 skill。

## 1. 目标

本阶段目标是把 Pi Agent Desktop 的“扩展、包、技能”从展示型 UI 补齐为真正可用的 pi-agent 原生扩展中心，并在交互体验上向 cc-haha / ClawX 一类桌面化项目靠齐。

- 包：支持 npm、git、本地路径来源的真实安装、卸载、更新、重载、禁用、过滤和诊断。
- 技能：真实发现 `SKILL.md`，进入系统提示词和 `/skill:name` 命令体系，并能在桌面端查看、搜索、创建和调用。
- 扩展：真实加载 pi-agent extension，展示其 tools、commands、shortcuts、flags 和错误状态。
- Prompt 模板：进入 slash command 列表，支持从桌面端发现和调用。
- 主题：继续沿用当前主题 UI，同时纳入 SDK resource loader 的主题来源。
- 信任与安全：增加资源信任中心，避免第三方包和扩展在桌面端成为不可见风险。
- 运行时：`PiAgentRuntime` 创建会话时接入 `DefaultResourceLoader`，资源变化后能重新加载并影响 agent 行为。

## 2. 当前状态

### 2.1 已完成能力

- 新增 `pi-server/extension-service.ts`，统一管理 `SettingsManager`、`DefaultPackageManager`、`DefaultResourceLoader`。
- `PiAgentRuntime` 已接入 resource loader，下一轮 prompt 可使用更新后的 skills/prompts/extensions。
- HTTP API 已覆盖资源快照、重载、包安装/卸载/更新、包启停、包过滤、技能读取、技能创建、包创建、资源信任决策。
- WebSocket 已覆盖 `packages_updated`、`extensions_updated`、`skills_updated`、`prompts_updated`、`themes_updated`、`resource_diagnostics_updated`、`package_progress`、`marketplace_updated`、`resource_trust_updated`。
- `PackagesView` 已支持安装来源、scope、市场模板、本地包创建、包详情、资源拆分、进度、诊断、持久化启停和 SDK filter 编辑。
- `SkillsView` 已支持真实技能列表、搜索过滤、`SKILL.md` 预览、可视化技能创建和 `/skill:name` 命令复制。
- `ExtensionsView` 已支持扩展能力展示、诊断面板、信任中心、与 Agents / Channels / Tasks / Packages 的入口联动。
- `extensionStore` 已持久接收 packages/extensions/skills/prompts/themes/diagnostics/marketplace/trust 快照。
- 中文、英文关键 UI 文案已补齐，避免 P1/P2 新 UI 出现硬编码英文。

### 2.2 P1 完成情况

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| 资源详情页 | 已完成 | 包详情侧栏展示来源、安装路径、资源数量、诊断和活动记录。 |
| skill 内容预览 | 已完成 | `SkillsView` 可读取并预览真实 `SKILL.md`。 |
| package progress UI | 已完成 | 服务端 package progress 通过 WebSocket 推送，包详情和顶部活动区可查看。 |
| diagnostics 面板 | 已完成 | 包页和扩展页都能显示 SDK resource diagnostics。 |
| enable/disable 持久化 | 已完成 | 通过写入 package filter 的空资源数组实现持久停用，再启用时恢复默认过滤。 |
| package filtering | 已完成 | 支持 extensions/skills/prompts/themes 四类资源的自动、停用、模式过滤。 |

### 2.3 P2 完成情况

| 能力 | 状态 | 说明 |
| --- | --- | --- |
| package marketplace | 已完成第一版 | 内置 SDK 示例市场模板，可一键安装到 user/project scope。后续可接远程市场源。 |
| skill/package 可视化创建器 | 已完成第一版 | 可从桌面端创建本地 skill 和 local package scaffold，并自动 reload。 |
| 扩展权限信任中心 | 已完成第一版 | 所有 package/extension/skill/prompt/theme 生成 trust record，可标记 trusted/untrusted/blocked。 |
| extension UI widget 桌面端适配 | 已完成基础层 | 已将 commands/tools/shortcuts/flags/skills/prompts 以桌面端可读资源呈现，后续可映射为 widget。 |
| 与频道、任务、agent profiles 联动 | 已完成入口联动 | 扩展页提供 Agents、Channels、Tasks、Packages 快捷入口，后续可做资源级绑定。 |

## 3. 技术选型

| 层级 | 选型 | 原因 |
| --- | --- | --- |
| 包管理 | `DefaultPackageManager` | pi-agent 原生支持 npm/git/local、全局/项目 settings、update/remove/filtering。 |
| 资源发现 | `DefaultResourceLoader` | 原生发现 extensions、skills、prompts、themes、context files。 |
| 设置持久化 | `SettingsManager.create(cwd, agentDir)` | 与 pi CLI 行为一致，支持全局 `~/.pi/agent` 和项目 `.pi`。 |
| 桌面通信 | 现有 HTTP + WebSocket | 保持轻量，不引入额外 IPC 层。 |
| 前端状态 | Zustand `extensionStore` | 与现有 store 架构一致，便于 WebSocket 快照更新。 |
| 信任数据 | `desktop-resource-trust.json` | 放在 agentDir，便于跨项目复用桌面端资源信任决策。 |

## 4. 服务端 API

| API | 方法 | 说明 |
| --- | --- | --- |
| `/api/extensions/resources?projectPath=` | GET | 获取当前项目资源快照。 |
| `/api/extensions/reload` | POST | 重新扫描资源。 |
| `/api/extensions/packages/install` | POST | 安装包，body: `{ source, scope, projectPath }`。 |
| `/api/extensions/packages/remove` | POST | 卸载包，body: `{ source, scope, projectPath }`。 |
| `/api/extensions/packages/update` | POST | 更新包，body: `{ source?, scope?, projectPath }`。 |
| `/api/extensions/packages/enabled` | POST | 持久启停包资源，body: `{ source, enabled, scope, projectPath }`。 |
| `/api/extensions/packages/filter` | POST | 设置 SDK package filter。 |
| `/api/extensions/packages/create` | POST | 创建本地 package scaffold 并安装。 |
| `/api/extensions/skills/create` | POST | 创建本地 `SKILL.md`。 |
| `/api/extensions/skills/content?path=` | GET | 读取技能文件内容。 |
| `/api/extensions/trust` | POST | 保存资源信任决策。 |

## 5. WebSocket 协议

连接时首包会下发真实资源快照字段：

- `packages`
- `extensions`
- `skills`
- `prompts`
- `themes`
- `resourceDiagnostics`
- `marketplace`
- `trust`
- `slashCommands`

资源变化后会分别广播：

- `packages_updated`
- `extensions_updated`
- `skills_updated`
- `prompts_updated`
- `themes_updated`
- `resource_diagnostics_updated`
- `marketplace_updated`
- `resource_trust_updated`
- `slash_commands_updated`
- `package_progress`

## 6. 前端模块设计

### 6.1 PackagesView

- 顶部安装区：输入 `npm:pkg`、`git:repo` 或本地路径，选择 user/project scope。
- 本地包创建器：填写包名、描述、初始 skill，服务端生成 package scaffold 并安装。
- Package marketplace：展示内置推荐包，标注 official/community/local 信任等级。
- 包列表：支持搜索、scope 过滤、停用过滤、已过滤包过滤。
- 包详情：展示资源拆分、活动进度、诊断、SDK filter 编辑器。

### 6.2 SkillsView

- 技能创建器：填写名称、描述、正文、scope，生成 `SKILL.md`。
- 技能列表：支持 enabled/disabled/project/user 过滤。
- 技能预览：读取真实文件内容，显示 `/skill:name` 调用命令。
- 调用辅助：可复制技能命令，便于回到对话框中使用。

### 6.3 ExtensionsView

- 信任中心：集中展示 package/extension/skill/prompt/theme 的信任状态。
- 运行时扩展：展示 path、source、scope、tools、commands、flags、shortcuts 和 errors。
- 资源诊断：显示 SDK collision/error/warning/info。
- 能力联动：提供 Agents、Channels、Tasks、Packages 的快捷入口。
- Widget 适配基础：将扩展能力整理为桌面端可读的能力面板，为后续 widget 做准备。

## 7. 测试策略

### 7.1 自动验证

- `npm.cmd run typecheck:server`
- `npm.cmd run typecheck:frontend`
- `npm.cmd run typecheck`
- `npm.cmd run build`

### 7.2 手工验证

- 打开 Packages/Extensions/Skills 页面无白屏、无控制台类型错误。
- 安装本地 package 后，packages、skills、prompts、themes、slash commands 刷新。
- 停用 package 后，对应 resources 从运行时加载链路中消失；重新启用后恢复。
- 在 package filter 中停用某类资源或填写模式过滤，reload 后生效。
- 创建 skill 后，列表出现新技能，预览可读取 `SKILL.md`。
- 信任中心中标记 blocked package 后，包被停用并刷新资源快照。

## 8. 剩余风险与后续强化

- Marketplace 目前是本地模板市场，尚未接远程索引、签名校验、评分、版本兼容矩阵。
- Trust Center 已能记录决策，但尚未在扩展执行前做强制沙箱或签名校验；blocked package 当前通过停用资源来降低风险。
- Package filter 依赖 SDK 语义，复杂 include/exclude 模式需要更多 fixture 测试。
- Skill 创建支持基础 `SKILL.md`，还未提供图形化 frontmatter 高级字段、依赖文件模板、导入 Claude/Codex skill 的迁移向导。
- Extension UI widget 目前是能力资源化展示，尚未提供独立 widget 插槽渲染协议。
- 与频道、任务、agent profiles 目前是入口级联动，下一步应支持资源级绑定，例如某 channel 默认启用某 agent profile 和某 skill set。

## 9. 当前自评分

- P0 真实资源闭环：9.0 / 10
- P1 可管理与可诊断：8.4 / 10
- P2 超越参考项目能力：6.8 / 10
- 与 cc-haha 发布质量差距：主要还在远程市场、签名/沙箱、资源级联动、扩展 widget 协议和系统化 smoke/e2e 覆盖。

## 10. 本轮验收结果

- `npm.cmd run typecheck:server`：已通过。
- `npm.cmd run typecheck:frontend`：已通过。
- 本轮完成 P1 全部核心项，并完成 P2 的第一版可用闭环。
- 下一步建议优先补：远程 marketplace 索引、trust 决策强制执行策略、package/skill fixture e2e、资源级 agent/channel/task 绑定。
