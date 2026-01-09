# X (Twitter) OAuth 2.0 PKCE 授权实现文档

## 📋 实现概览

实现了最小可用的 X (Twitter) OAuth 2.0 PKCE 授权闭环，用于让 Twitter B 授权 App，并获取 access_token/refresh_token。

## 🎯 核心特性

- ✅ OAuth 2.0 Authorization Code Flow with PKCE
- ✅ 独立的 HTTP Server（不影响 Telegram Bot）
- ✅ 自动 Token 刷新机制
- ✅ Token 持久化存储
- ✅ 测试接口（验证 token、发送测试推文）
- ✅ 安全日志（不打印完整 token）

## 📁 修改/新增文件清单

### 新增文件
1. **`src/config/x.ts`** - X OAuth 配置模块
2. **`src/services/xOAuth.service.ts`** - OAuth 核心服务（PKCE、Token 交换、刷新）
3. **`src/server/xOAuth.server.ts`** - OAuth HTTP Server 和路由
4. **`src/server/index.ts`** - OAuth Server 启动入口
5. **`.env.example`** - 环境变量示例（包含 X OAuth 配置）

### 修改文件
1. **`package.json`** - 新增依赖和脚本
   - 新增依赖：`express`, `@types/express`, `crypto-js`, `@types/crypto-js`
   - 新增脚本：`npm run oauth`, `npm run oauth:dev`

2. **`.gitignore`** - 新增 `data/` 目录和 `*.json`（排除 package.json 等）

3. **`src/config/env.ts`** - 新增 X OAuth 可选配置字段

## 🔧 环境变量配置

### 必填字段

```env
# X OAuth Client ID (必填)
X_CLIENT_ID=your_x_client_id_here

# X OAuth Redirect URI (必填，必须与 Twitter Developer Portal 中设置的一致)
X_REDIRECT_URI=http://localhost:8787/x/callback
```

### 可选字段

```env
# X OAuth Client Secret (可选，PKCE 通常不需要)
# 如果使用 Public Client (PKCE only)，可以不填
# 如果使用 Confidential Client，需要填写
X_CLIENT_SECRET=

# X OAuth Scopes (可选，默认: tweet.write users.read offline.access)
X_SCOPES=tweet.write users.read offline.access

# X OAuth Server Port (可选，默认: 8787)
X_OAUTH_PORT=8787

# X Token Store Path (可选，默认: ./data/x_tokens.json)
X_TOKEN_STORE=./data/x_tokens.json
```

## 🚀 启动方式

### 方式1：独立启动 OAuth Server（推荐）

```bash
npm run oauth
```

或开发模式（自动重启）：

```bash
npm run oauth:dev
```

### 方式2：与 Telegram Bot 同时运行

OAuth Server 是独立的，可以与 Telegram Bot 同时运行，互不影响。

## 📝 使用流程

### Step 1: 配置 Twitter Developer Portal

1. 访问 https://developer.twitter.com/en/portal/dashboard
2. 创建 App 或使用现有 App
3. 在 App Settings 中：
   - 设置 **App permissions**: `Read and write`（需要 `tweet.write`）
   - 设置 **Callback URI**: `http://localhost:8787/x/callback`
   - 获取 **Client ID** 和 **Client Secret**（如果使用 confidential client）
4. 启用 **OAuth 2.0** 并设置 **Type of App**: `Web App, Automated App or Bot`
5. 复制 **Client ID** 和 **Client Secret**（如果使用）

### Step 2: 配置 .env 文件

在 `.env` 文件中填写：

```env
X_CLIENT_ID=your_client_id_from_portal
X_REDIRECT_URI=http://localhost:8787/x/callback
X_SCOPES=tweet.write users.read offline.access
X_OAUTH_PORT=8787
X_TOKEN_STORE=./data/x_tokens.json
```

### Step 3: 启动 OAuth Server

```bash
npm run oauth
```

### Step 4: 授权 Twitter B

1. **访问授权页面**：
   ```
   http://localhost:8787/x/auth
   ```

2. **复制授权链接**（或直接点击页面上的按钮）

3. **在已登录 Twitter B 的浏览器中打开授权链接**

4. **授权后自动跳转**到 `http://localhost:8787/x/callback`

5. **查看成功页面**，显示 "✅ 授权成功"

### Step 5: 验证 Token

访问验证接口：

```bash
curl http://localhost:8787/x/me
```

或浏览器打开：
```
http://localhost:8787/x/me
```

**预期响应：**
```json
{
  "success": true,
  "user": {
    "id": "123456789",
    "name": "Twitter B",
    "username": "twitter_b_username",
    "createdAt": "2020-01-01T00:00:00.000Z"
  },
  "tokenPreview": "abc123...xyz9"
}
```

### Step 6: 测试发推（可选）

```bash
curl -X POST http://localhost:8787/x/test-tweet
```

或浏览器打开并发送 POST 请求到：
```
http://localhost:8787/x/test-tweet
```

**预期响应：**
```json
{
  "success": true,
  "tweet": {
    "id": "1234567890123456789",
    "text": "CrazyMonkeyPerpBot OAuth connected"
  },
  "url": "https://twitter.com/i/web/status/1234567890123456789"
}
```

## 🔍 API 端点说明

### GET /x/auth
生成授权链接并返回 HTML 页面。

**响应：** HTML 页面，包含授权链接和操作说明。

### GET /x/callback
OAuth 回调处理端点。

**Query 参数：**
- `code`: Authorization code
- `state`: State 参数（用于验证）
- `error`: 错误信息（如果有）

**响应：** HTML 页面，显示授权结果。

### GET /x/me
验证当前 token 并获取用户信息。

**响应：** JSON
```json
{
  "success": true,
  "user": {
    "id": "...",
    "name": "...",
    "username": "...",
    "createdAt": "..."
  },
  "tokenPreview": "..."
}
```

### POST /x/test-tweet
发送测试推文。

**响应：** JSON
```json
{
  "success": true,
  "tweet": {
    "id": "...",
    "text": "CrazyMonkeyPerpBot OAuth connected"
  },
  "url": "..."
}
```

### GET /x/status
查看 token 状态。

**响应：** JSON
```json
{
  "authorized": true,
  "tokenPreview": "...",
  "hasRefreshToken": true,
  "expiresAt": "2025-12-23T12:00:00.000Z",
  "isExpired": false,
  "timeUntilExpiry": 3600,
  "scope": "tweet.write users.read offline.access",
  "obtainedAt": "2025-12-23T10:00:00.000Z"
}
```

## 💾 Token 存储格式

Token 保存在 `./data/x_tokens.json`（或 `X_TOKEN_STORE` 指定的路径）：

```json
{
  "access_token": "abc123...",
  "refresh_token": "xyz789...",
  "token_type": "bearer",
  "expires_in": 7200,
  "scope": "tweet.write users.read offline.access",
  "obtainedAt": 1703318400000,
  "expiresAt": 1703325600000
}
```

## 🔄 Token 刷新机制

系统会自动处理 token 刷新：

1. **自动刷新时机**：
   - Token 过期前 5 分钟自动刷新
   - API 调用返回 401 时自动刷新

2. **刷新流程**：
   - 使用 `refresh_token` 调用 Twitter API
   - 获取新的 `access_token`
   - 更新 token store

3. **使用方式**：
   - 调用 `getValidAccessToken()` 会自动处理刷新
   - 所有 API 调用都会自动使用刷新后的 token

## 🔒 安全要求

- ✅ `.env` 文件已在 `.gitignore` 中
- ✅ `data/` 目录已在 `.gitignore` 中
- ✅ Token 日志只显示前 6 位 + 后 4 位
- ✅ PKCE state 5 分钟自动过期
- ✅ 所有敏感信息通过环境变量配置

## 🧪 测试检查清单

- [ ] 配置 `.env` 文件
- [ ] 启动 OAuth Server (`npm run oauth`)
- [ ] 访问 `/x/auth` 生成授权链接
- [ ] 在 Twitter B 浏览器中打开授权链接
- [ ] 授权成功后查看 token store 文件
- [ ] 调用 `/x/me` 验证 token
- [ ] 调用 `/x/test-tweet` 发送测试推文（可选）
- [ ] 检查日志中 token 是否被正确脱敏

## 📚 后续扩展

### 多账号支持
Token store 结构已预留 `accountLabel` 字段，未来可以扩展为：

```json
{
  "accounts": {
    "twitter_b": { ... },
    "twitter_c": { ... }
  }
}
```

### 集成到 Telegram Bot
可以在 Telegram Bot 中添加命令，调用 OAuth 服务：

```typescript
// 在 bot 路由中
bot.command('x_auth', async (ctx) => {
  await ctx.reply(`请访问 http://localhost:8787/x/auth 进行授权`);
});
```

## ⚠️ 注意事项

1. **Callback URI 必须完全匹配**：Twitter Developer Portal 中设置的 callback URI 必须与 `.env` 中的 `X_REDIRECT_URI` 完全一致。

2. **PKCE 与 Client Secret**：
   - 如果使用 Public Client（PKCE only），不需要 `X_CLIENT_SECRET`
   - 如果使用 Confidential Client，需要填写 `X_CLIENT_SECRET`

3. **Token 存储位置**：确保 `data/` 目录有写入权限。

4. **端口冲突**：如果 8787 端口被占用，修改 `X_OAUTH_PORT`。

5. **HTTPS 要求**：生产环境需要使用 HTTPS，需要配置反向代理（如 Nginx）。

## 🐛 故障排查

### 问题：授权后显示 "Invalid or expired state"
**解决**：PKCE state 已过期（5分钟），重新访问 `/x/auth` 生成新的授权链接。

### 问题：Token 交换失败
**检查**：
- Client ID 是否正确
- Redirect URI 是否与 Portal 设置一致
- Scopes 是否包含所需权限

### 问题：API 调用返回 401
**解决**：系统会自动尝试刷新 token，如果失败，需要重新授权。

### 问题：无法发送推文
**检查**：
- App permissions 是否设置为 "Read and write"
- Scopes 是否包含 `tweet.write`

