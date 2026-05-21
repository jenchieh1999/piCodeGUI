# Pi Agent Desktop 发布前网络安全审计

审计日期：2026-05-21

参考基线：
- Electron Security Checklist: https://www.electronjs.org/docs/latest/tutorial/security
- Electron Code Signing: https://www.electronjs.org/docs/latest/tutorial/code-signing

## 总体结论

当前版本已具备内测版发布的基础网络安全边界：桌面端默认只监听 `127.0.0.1`，本地 HTTP/WebSocket 服务由每次启动随机生成的 desktop token 保护，Electron 窗口关闭了 Node 集成，并启用了 preload 隔离。

本轮继续补齐了可由代码直接处理的安全问题：生产 CSP、远程模型端点 HTTPS 限制、扩展包安装的服务端信任确认、自动更新 URL 限制、窗口导航/外链拦截、IPC 来源校验、频道公网回调鉴权与请求体限制、远程字体依赖移除、SkillHub 远程端点 HTTPS 限制和远程响应大小限制。

建议评级：可以发布 beta/内测版；公开正式版仍需完成代码签名、系统级密钥存储、可信更新托管与扩展包签名/哈希策略。

## 已完成加固

| 模块 | 加固内容 | 状态 |
| --- | --- | --- |
| Electron 窗口 | 所有窗口统一拦截 `window.open` 和顶层导航，仅允许安全外链协议 | 已完成 |
| IPC | `desktop:*` handler 校验调用方 URL，远程页面无法调用 preload 暴露的敏感能力 | 已完成 |
| CSP | 打包生产环境通过 Electron session 注入 `Content-Security-Policy` | 已完成 |
| 本地 HTTP | 鉴权只接受 `Authorization` / `X-Pi-Desktop-Token`，不再接受 URL query token | 已完成 |
| WebSocket | 前端优先通过 `Sec-WebSocket-Protocol` 传 desktop token，减少 URL 泄漏 | 已完成 |
| 自动更新 | 运行时和发包脚本拒绝生产非 HTTPS update feed | 已完成 |
| 自定义模型端点 | 远程端点必须 HTTPS；HTTP 仅允许 localhost/127.0.0.1，除非显式打开不安全开关 | 已完成 |
| 外部字体 | 移除 Google Fonts 远程加载，打包 UI 不再依赖字体 CDN | 已完成 |
| 外链打开 | Electron 只允许 `https:`、`mailto:` 和 loopback `http:` 外链，阻止远程非 HTTPS 外链 | 已完成 |
| SkillHub | 自定义远程 endpoint 必须 HTTPS；HTTP 仅允许 loopback 或显式私有测试开关 | 已完成 |
| SkillHub/ClawHub | 远程响应增加 15 秒超时和 2 MB 大小限制 | 已完成 |
| Markdown 渲染 | code block 临时状态从全局 Map 改为单次渲染局部状态，降低并发渲染错位风险 | 已完成 |
| 飞书回调 | 未加密事件必须校验 verification token；加密事件要求 encryption key 可解密 | 已完成 |
| 微信回调 | 官方回调必须配置 verification token 并通过签名校验 | 已完成 |
| 通用频道 inbound | 必须携带频道 token；支持 `Authorization`、`X-Pi-Channel-Token`、query 或 body token | 已完成 |
| 频道请求体 | 公网回调 body 限制为 1 MB | 已完成 |
| 扩展包安装 | 服务端要求显式 trust confirmation；blocked package 不能安装 | 已完成 |

## 当前网络入口清单

| 入口 | 暴露面 | 当前保护 |
| --- | --- | --- |
| `http://127.0.0.1:<port>` | 本地 REST API | Origin 校验 + desktop token |
| `ws://127.0.0.1:<port>/ws` | 本地实时协议 | Origin 校验 + desktop token |
| `/health` | 本地健康检查 | 无 token，仅返回状态 |
| `/api/channels/feishu/:id/events` | 飞书公网回调 | verification token 或加密事件证明 |
| `/api/channels/wechat/:id/events` | 微信公网回调 | 微信 token 签名校验 |
| `/api/channels/:id/inbound` | 通用频道 webhook | 频道 token 校验 |
| Electron preload | 桌面能力桥 | 可信 renderer URL 校验 |
| 自动更新 feed | 更新元数据与安装包下载 | HTTPS 限制，仍需代码签名 |
| SkillHub / ClawHub | 技能搜索和安装素材下载 | HTTPS 优先、超时、响应大小限制、安装信任确认 |
| 远程图片 URL | 对话背景图片 URL | 用户显式配置后由 renderer 加载；正式版建议增加隐私提示或本地化导入优先 |

## 剩余风险

### P0：正式公开发布前必须完成

1. Windows 代码签名

   `electron-builder.yml` 仍是 `win.signAndEditExecutable: false`。正式版必须接入 OV/EV 代码签名证书或可信签名服务，否则安装包和更新包缺少发布者身份保护，也更容易触发 SmartScreen。

2. 系统级密钥存储

   模型 API Key、飞书 App Secret、微信 token 等仍会落在用户目录配置文件中。正式版应接入 Windows Credential Manager、macOS Keychain、Linux Secret Service。

3. 可信更新托管与发布凭据

   代码已要求 HTTPS，但正式发版还需要确定稳定 update feed URL、最小权限上传凭据、CI 发布流程、资产 hash 校验与回滚流程。

4. 扩展包签名/哈希

   当前已要求安装前显式确认，但还没有包签名、hash pinning、权限声明与远程 marketplace 索引校验。公开市场上线前必须补齐。

### P1：发布候选版前建议完成

1. Electron sandbox

   当前窗口仍为 `sandbox: false`。需要在完整回归 preload、终端、独立窗口后评估开启。

2. 频道 replay 防护

   微信签名已验证，但还未对 timestamp 窗口和 nonce 做缓存；飞书也建议按 event_id/message_id 做幂等去重。

3. 日志脱敏专项

   继续检查 renderer/server/updater/channel 日志，确保不会输出 API Key、access token、channel token、带凭据 URL。

4. 自动化安全用例

   建议新增测试覆盖恶意 Origin、无 token HTTP/WS、危险外部协议、远程页面 IPC、频道大 body、未配置 token 的回调。

5. 远程图片隐私提示

   当前对话背景 URL 属于用户显式配置能力。远程图片会向图片服务器暴露请求来源和网络信息。正式版建议在 UI 中增加隐私提示，并鼓励使用本地上传/内嵌 data URL。

## 验证命令

本次已执行并通过：

```powershell
npm.cmd run typecheck:server
npm.cmd run typecheck:frontend
npm.cmd run build
npm.cmd run server:smoke
npm.cmd audit --omit=dev --audit-level=moderate
npm.cmd audit --audit-level=high
node --check desktop/main.cjs
node --check desktop/preload.cjs
node scripts\require-update-feed.cjs
```

后续每次发包前都应固定执行以上命令。
