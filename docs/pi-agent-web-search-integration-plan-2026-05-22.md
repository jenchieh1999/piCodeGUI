# Pi Agent Desktop 网页搜索正式接入方案

更新时间：2026-05-22

## 1. 目标

让智能体聊天室中的「网页」开关从待接入变为可运行能力：

- 服务端通过正规搜索 API 获取网页结果，不抓取搜索引擎页面。
- 搜索结果进入证据板，并带 `web` citation。
- 外部网页内容明确标记为 untrusted evidence，后续总结必须二次判断来源质量。
- 没有配置 API Key 时，不静默失败，而是在证据板生成可见的配置说明。

## 2. 方案调研

### Tavily

官方文档：<https://docs.tavily.com/documentation/api-reference/endpoint/search>

特点：

- 面向 AI/RAG 场景，Search endpoint 可返回搜索结果和可用内容。
- 对智能体聊天室最友好，因为证据板需要的是「可直接阅读和总结的片段」。
- 适合作为默认 Provider。

### Brave Search API

官方文档：<https://api-dashboard.search.brave.com/app/documentation/web-search/query>

特点：

- 正规搜索索引 API，`/res/v1/web/search` 返回 Web results。
- 支持 freshness、country、language、extra snippets 等参数。
- 更像 SERP API，适合作为稳定、成本可控的备用 Provider。

### Exa

官方文档：<https://exa.ai/docs/reference/search>

特点：

- Search endpoint 可以搜索网页并抽取结果内容。
- 更偏语义检索和研究场景，适合后续做深度研究模式。
- 成本和排序特性需要单独评估，不建议第一阶段强绑定。

### Google Custom Search JSON API

官方文档：<https://developers.google.com/custom-search/v1/overview>

特点：

- 传统方案，需要 API Key 和 Programmable Search Engine ID。
- 对通用网页搜索需要额外配置搜索引擎范围，桌面端开箱体验不如 Tavily/Brave。
- 本轮不作为默认方案。

## 3. 当前落地选择

采用 Provider Adapter 架构，首批支持：

- `tavily`
- `brave`
- `exa`
- `auto`：默认，按 Tavily -> Brave -> Exa 的顺序选择已配置 Provider。

配置方式：

```powershell
$env:TAVILY_API_KEY="..."
$env:BRAVE_SEARCH_API_KEY="..."
$env:EXA_API_KEY="..."
$env:PI_AGENT_WEB_SEARCH_PROVIDER="auto"
```

也支持 Pi Agent 专用环境变量：

```powershell
$env:PI_AGENT_TAVILY_API_KEY="..."
$env:PI_AGENT_BRAVE_SEARCH_API_KEY="..."
$env:PI_AGENT_EXA_API_KEY="..."
```

禁用：

```powershell
$env:PI_AGENT_WEB_SEARCH_DISABLED="1"
```

## 4. 已落地能力

- 新增 `pi-server/web-search-service.ts`
  - `GET /api/web-search/status`
  - `POST /api/web-search/search`
  - `searchWeb()`
  - `formatWebSearchResultsAsMarkdown()`
- 智能体聊天室运行时：
  - 如果 `useWebSearch=true`，规划阶段会运行 `Web Searcher` 任务。
  - 搜索成功时生成 `Web search evidence` artifact。
  - 每条搜索结果会作为 `kind: web` citation 写入证据。
  - 搜索失败或未配置 Key 时生成 `Web search unavailable` artifact，告诉用户如何配置。
- 前端：
  - 创建聊天室时「网页」开关已解除禁用。
  - 房间头部不再显示「待接入」。
  - 文案改为说明会通过 Tavily/Brave/Exa 收集外部网页证据。

## 5. 后续优化

- 在「凭据」页面增加 Web Search Provider 独立配置，不再只依赖环境变量。
- 在运行前检查 `/api/web-search/status`，未配置时给出更友好的 UI 提示。
- 给 Agent Room 增加搜索预算：最大搜索次数、最大结果数、是否允许 raw content。
- 增加来源质量评分：官方文档、GitHub、论文、新闻、论坛等不同权重。
- 对网页内容做缓存，避免同一问题反复消耗搜索额度。

## 6. 2026-05-22 更新：模型供应商原生联网搜索兜底

已实现“无需额外搜索 Key”的兜底链路：

1. 优先使用专用搜索 Provider：`tavily`、`brave`、`exa`。
2. 如果没有配置专用搜索 Key，则自动复用已配置的大模型凭据：
   - `zai`：通过智谱 / Z.ai 原生 Web Search API 获取结构化搜索结果。
   - `openai`：通过 OpenAI Responses API 的内置 Web Search 工具获取带 URL citation 的结果。
3. `PI_AGENT_WEB_SEARCH_PROVIDER=auto` 时按 Tavily -> Brave -> Exa -> Zhipu/Z.ai -> OpenAI 选择。
4. 也可以显式指定：

```powershell
$env:PI_AGENT_WEB_SEARCH_PROVIDER="zai"
# 或
$env:PI_AGENT_WEB_SEARCH_PROVIDER="openai"
```

新增可选环境变量：

```powershell
$env:PI_AGENT_MODEL_WEB_SEARCH_TIMEOUT_MS="24000"
$env:PI_AGENT_WEB_SEARCH_ZAI_MODEL="glm-5.1"
$env:PI_AGENT_ZAI_WEB_SEARCH_ENGINE="search_std"
$env:PI_AGENT_ZAI_WEB_SEARCH_RECENCY="noLimit"
$env:PI_AGENT_ZAI_WEB_SEARCH_CONTENT_SIZE="medium"
$env:PI_AGENT_WEB_SEARCH_OPENAI_MODEL="gpt-5.1"
```

验收点：

- 未配置 `TAVILY_API_KEY` / `BRAVE_SEARCH_API_KEY` / `EXA_API_KEY` 时，如果凭据页已配置智谱 API Key，智能体聊天室“网页”开关仍应能生成 `Web search evidence`。
- 证据板中的 `Provider` 应显示 `zai` 或 `openai`。
- 结果必须包含真实 URL；如果供应商返回内容但没有 URL citation，应视为不可用，避免把无来源文本写入证据板。
