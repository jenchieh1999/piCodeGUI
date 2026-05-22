# Pi Agent Desktop 正式发布安全手动步骤

更新时间：2026-05-20

本文列出无法只靠代码自动完成、需要项目维护者准备账号/证书/凭据/托管资源的发布安全事项。完成这些步骤后，再将项目从 beta/内测推进到公开正式版。

## 1. Windows 代码签名

目标：让 `Pi Agent Desktop.exe`、安装包、卸载程序和自动更新包具备可信发布者身份，降低篡改风险和 SmartScreen 拦截概率。

### 需要准备

- 一个 OV 或 EV Code Signing 证书。
- 证书文件或云签名服务访问权限。
- 安全保存证书密码或签名服务 token 的 CI Secret。

### 推荐做法

1. 购买或申请代码签名证书。

   可选渠道包括 DigiCert、Sectigo、GlobalSign、SSL.com 等。EV 证书通常需要硬件 token 或云 HSM，OV 证书流程相对简单。

2. 确认证书主体名称。

   发布者名称应与项目或公司主体一致。后续安装包的 Publisher 会显示该名称。

3. 配置 CI Secret。

   不要把 `.pfx`、密码、API token 写进仓库。建议使用 GitHub Actions Secrets 或你的 CI Secret Vault。

4. 修改 `electron-builder.yml`。

   当前配置：

   ```yaml
   win:
     signAndEditExecutable: false
   ```

   正式发布时应改为启用签名。具体字段取决于证书方案：

   ```yaml
   win:
     icon: desktop/assets/pi-icon.ico
     signAndEditExecutable: true
   ```

   如果使用本地 pfx，常见环境变量为：

   ```powershell
   $env:CSC_LINK="C:\secure\cert.pfx"
   $env:CSC_KEY_PASSWORD="证书密码"
   ```

   如果使用云签名服务，按服务商提供的 electron-builder / signtool 集成方式配置。

5. 打包后验证签名。

   ```powershell
   Get-AuthenticodeSignature ".\release\Pi-Agent-Desktop-*.exe"
   ```

   结果应为 `Status: Valid`。

6. 验证自动更新包。

   发布后从 update feed 下载最新安装包，重复执行签名校验。不要只校验本地构建产物。

## 2. 正式 update feed 托管

目标：确保自动更新只从稳定、HTTPS、可审计的位置下载。

### 需要准备

- 一个 HTTPS update feed URL。
- 上传 release asset 的凭据。
- 最小权限发布 token。
- 回滚策略。

### GitHub Releases 推荐流程

1. 确认仓库。

   ```powershell
   $env:PI_DESKTOP_GITHUB_REPOSITORY="owner/repo"
   ```

2. 配置 update feed。

   ```powershell
   $env:PI_DESKTOP_UPDATE_URL="https://github.com/owner/repo/releases/latest/download"
   ```

3. 配置发布 token。

   ```powershell
   $env:GH_TOKEN="github_pat_xxx"
   ```

   token 权限应尽量小，只允许创建/更新 release 和上传 asset。

4. 发包前检查。

   ```powershell
   node scripts\require-update-feed.cjs
   npm.cmd run quality:release
   ```

5. 发布。

   ```powershell
   npm.cmd run desktop:release
   ```

6. 发布后验证。

   打开：

   ```text
   https://github.com/owner/repo/releases/latest/download/latest.yml
   ```

   确认 `latest.yml` 能下载，里面的安装包 URL、sha512、版本号正确。

### 禁止事项

- 不要用 HTTP update feed。
- 不要用临时网盘、个人云盘、内网穿透地址做正式更新源。
- 不要把 `GH_TOKEN`、证书密码、上传凭据写入 `.env` 后提交。

## 3. 系统级密钥存储

目标：API Key、App Secret、access token 不再以明文长期保存在 JSON 文件里。

### 需要决策

- Windows：Credential Manager。
- macOS：Keychain。
- Linux：Secret Service / libsecret。
- 是否引入 `keytar`、`safeStorage` 桥接，或自研平台适配层。

### 推荐落地步骤

1. 设计统一接口。

   建议新增 `SecretStorage` 抽象：

   ```ts
   interface SecretStorage {
     get(service: string, account: string): Promise<string | null>;
     set(service: string, account: string, value: string): Promise<void>;
     delete(service: string, account: string): Promise<void>;
   }
   ```

2. 修改模型凭据存储。

   当前 `auth-service.ts` 写入 SDK `AuthStorage`。正式版应改为：

   - JSON 中只保存 provider、credentialRef、metadata。
   - 真正 API Key 放入系统密钥库。

3. 修改频道密钥存储。

   飞书 App Secret、微信 App Secret、微信 bot token 同样只在 `channels.json` 保存引用 ID。

4. 增加迁移逻辑。

   首次启动正式版时：

   - 读取旧明文配置。
   - 写入系统密钥库。
   - 配置文件改为引用 ID。
   - 迁移成功后删除明文字段。

5. 增加导出/备份提示。

   系统密钥库通常不随项目目录迁移。用户换电脑时需要重新配置 API Key 或使用受保护导入流程。

## 4. 扩展包签名与权限声明

目标：从“用户确认安装”升级为“可验证来源 + 可审计权限 + 可回滚”。

### 需要准备

- 官方 marketplace 索引地址。
- 每个包的 hash 或签名。
- 包权限声明 schema。
- 包审核流程。

### 推荐 marketplace 索引格式

```json
{
  "version": 1,
  "packages": [
    {
      "id": "official.plan-mode",
      "name": "Plan Mode",
      "source": "https://example.com/packages/plan-mode-1.0.0.tgz",
      "version": "1.0.0",
      "sha256": "hex...",
      "signature": "base64...",
      "permissions": ["filesystem.read", "agent.prompt"],
      "publisher": "Pi Agent",
      "verified": true
    }
  ]
}
```

### 服务端校验策略

1. 安装前必须解析 marketplace 元数据。
2. 下载后校验 sha256。
3. 有签名时校验签名。
4. 权限声明必须展示给用户确认。
5. blocked 包和 hash 不匹配包一律拒绝安装。
6. 已安装包升级时，版本、hash、publisher 必须可追踪。

## 5. 频道公网回调部署

目标：飞书/微信回调对公网暴露时仍然可控。

### 飞书

1. 在桌面端频道配置中填写：

   - App ID
   - App Secret
   - Verification Token
   - Encrypt Key，如果开启加密事件

2. 飞书开放平台事件订阅 URL 使用：

   ```text
   https://你的公网域名/api/channels/feishu/<channelId>/events
   ```

3. 开启事件加密时，确认 Encrypt Key 与桌面端一致。

4. 生产环境建议在反向代理层限制 body 大小为 1 MB。

### 微信公众号

1. 在微信公众平台配置 Token。
2. 桌面端频道配置同一个 verification token。
3. 回调 URL 使用：

   ```text
   https://你的公网域名/api/channels/wechat/<channelId>/events
   ```

4. 不要把微信 App Secret 写进截图、日志或公开 issue。

## 6. 发版前固定检查清单

每次正式发包前执行：

```powershell
npm.cmd run typecheck:server
npm.cmd run typecheck:frontend
npm.cmd run build
npm.cmd run server:smoke
npm.cmd audit --omit=dev --audit-level=moderate
npm.cmd audit --audit-level=high
node scripts\require-update-feed.cjs
```

然后人工确认：

- 安装包签名有效。
- `latest.yml` 可通过 HTTPS 下载。
- 安装包、blockmap、latest.yml 均已上传。
- GitHub Release 或更新源没有暴露 token。
- 新版本能从旧版本自动更新。
- 新版本第一次启动后能连接本地 server。
- 设置页不会显示明文 secret。
- 频道回调未配置 token 时会被拒绝。
- 扩展包 blocked 后不能安装或启用。
