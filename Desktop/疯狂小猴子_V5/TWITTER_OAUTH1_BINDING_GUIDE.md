# Twitter OAuth 1.0 绑定流程说明文档

## 📋 概述

本文档详细说明 Twitter OAuth 1.0a 的绑定流程，包括如何生成授权链接、如何完成授权，以及如何为多个账户进行绑定。

---

## 🔑 前置条件

### 1. 环境变量配置

在 `.env` 文件中需要配置以下 OAuth 1.0 相关变量：

```
X_CONSUMER_KEY=你的Consumer Key
X_CONSUMER_SECRET=你的Consumer Secret
X_OAUTH1_TOKEN_STORE=./data/x_oauth1_tokens.json
```

**Consumer Key 和 Consumer Secret 获取方式：**
- 访问 Twitter Developer Portal: https://developer.twitter.com/en/portal/dashboard
- 登录你的 Twitter 开发者账号
- 进入你的 App 详情页
- 在 "Keys and tokens" 选项卡中找到：
  - **API Key** (这就是 Consumer Key)
  - **API Secret Key** (这就是 Consumer Secret)

### 2. 账户标识说明

系统支持多账户绑定，使用以下标识：
- **accountA** (或默认): 主账户，Token 存储在 `./data/x_oauth1_tokens.json`
- **accountB**: 账户B，Token 存储在 `./data/x_oauth1_tokens_accountB.json`
- **accountC**: 账户C，Token 存储在 `./data/x_oauth1_tokens_accountC.json`

---

## 🔄 OAuth 1.0a 授权流程（3步）

### 流程概览

OAuth 1.0a 使用 "oob" (out-of-band) 模式，不需要配置 Callback URL。整个流程分为3步：

1. **获取 Request Token** → 生成授权链接
2. **用户授权** → 获取 PIN 码（Verifier）
3. **交换 Access Token** → 使用 PIN 码换取永久 Token

---

## 📝 详细步骤

### 方法一：使用脚本生成授权链接（推荐）

#### 步骤 1: 生成授权链接

运行脚本为账户B和账户C生成授权链接：

```bash
node -r ts-node/register scripts/generateOAuth1AuthLinks.ts
```

**脚本功能：**
- 为账户B生成授权链接
- 为账户C生成授权链接
- 保存 Request Token 到临时文件：
  - `./data/oauth1_request_tokens_accountB.json`
  - `./data/oauth1_request_tokens_accountC.json`
- 在 Mac 桌面生成说明文档：`Twitter_OAuth1_授权链接_账户B和C.txt`

**生成的内容：**
1. **授权链接**：每个账户一个唯一的授权 URL
2. **Request Token**：临时 Token，有效期 5 分钟
3. **说明文档**：包含完整的使用说明

#### 步骤 2: 用户授权并获取 PIN 码

1. **打开授权链接**
   - 确保已登录对应的 Twitter 账户（账户B或账户C）
   - 在浏览器中打开生成的授权链接
   - 授权链接格式：`https://api.twitter.com/oauth/authorize?oauth_token=xxx`

2. **完成授权**
   - 点击 "Authorize app" 按钮
   - Twitter 会显示一个 **PIN 码**（Verifier）
   - 例如：`1234567`
   - **重要：** 复制并保存这个 PIN 码

3. **注意事项**
   - Request Token 有效期为 5 分钟，请尽快完成授权
   - 每个账户需要单独授权
   - PIN 码只能使用一次

#### 步骤 3: 使用 PIN 码完成授权

运行脚本使用 PIN 码交换 Access Token：

```bash
# 账户B
node -r ts-node/register scripts/completeOAuth1Auth.ts accountB <PIN码>

# 账户C
node -r ts-node/register scripts/completeOAuth1Auth.ts accountC <PIN码>
```

**脚本功能：**
- 读取保存的 Request Token
- 使用 PIN 码交换 Access Token
- 保存 Access Token 到对应文件：
  - 账户B: `./data/x_oauth1_tokens_accountB.json`
  - 账户C: `./data/x_oauth1_tokens_accountC.json`
- 删除已使用的 Request Token 文件

**Token 存储结构：**
```json
{
  "accessToken": "xxx",
  "accessTokenSecret": "yyy",
  "userId": "123456789",
  "screenName": "username",
  "obtainedAt": 1234567890123,
  "accountLabel": "accountB"
}
```

---

### 方法二：使用 OAuth Server Web 界面

#### 步骤 1: 启动 OAuth Server

```bash
npm run oauth
# 或
node -r ts-node/register src/server/index.ts
```

Server 会在 `http://localhost:8787` 启动

#### 步骤 2: 访问授权页面

在浏览器中访问：
```
http://localhost:8787/x/oauth1/auth
```

**页面功能：**
- 自动生成授权链接
- 显示授权步骤说明
- 提供 PIN 码输入表单

#### 步骤 3: 完成授权

1. 点击页面上的授权链接
2. 在 Twitter 授权页面完成授权
3. 复制显示的 PIN 码
4. 在 Web 页面的表单中输入 PIN 码
5. 点击 "完成授权" 按钮

**注意：** 使用 Web 界面时，Token 会保存到默认路径（账户A），如需绑定其他账户，请使用方法一。

---

## 🔐 Token 存储机制

### 文件路径规则

系统根据 `accountKey` 参数决定 Token 存储位置：

1. **默认账户（accountA 或未指定）**
   - 路径：`./data/x_oauth1_tokens.json`
   - 配置：`X_OAUTH1_TOKEN_STORE` 环境变量

2. **多账户（accountB, accountC 等）**
   - 路径：`./data/x_oauth1_tokens_${accountKey}.json`
   - 例如：
     - accountB: `./data/x_oauth1_tokens_accountB.json`
     - accountC: `./data/x_oauth1_tokens_accountC.json`

### Token 读取逻辑

代码中的 `readOAuth1TokenStore(accountKey?)` 函数：

```typescript
// 如果 accountKey 是 'accountB' 或 'accountC'
if (accountKey && accountKey !== 'accountA' && accountKey !== 'default') {
  // 从多账户文件读取
  storePath = `./data/x_oauth1_tokens_${accountKey}.json`
} else {
  // 从默认文件读取（账户A）
  storePath = xConfig.X_OAUTH1_TOKEN_STORE
}
```

### Token 验证

使用 `hasValidOAuth1Token(accountKey?)` 函数检查 Token 是否存在：

```typescript
// 检查账户A
hasValidOAuth1Token() // 或 hasValidOAuth1Token('accountA')

// 检查账户B
hasValidOAuth1Token('accountB')

// 检查账户C
hasValidOAuth1Token('accountC')
```

---

## 📤 生成给其他账户的绑定信息

### 为账户B生成绑定信息

**生成授权链接：**
```bash
node -r ts-node/register scripts/generateOAuth1AuthLinks.ts
```

**生成的文件：**
1. `./data/oauth1_request_tokens_accountB.json` - Request Token（临时）
2. `~/Desktop/Twitter_OAuth1_授权链接_账户B和C.txt` - 说明文档

**说明文档包含：**
- 账户B的授权链接
- OAuth Token（用于识别）
- 使用说明
- 完成授权的方法

**提供给账户B操作者的信息：**
1. 授权链接（URL）
2. 操作步骤说明
3. 完成授权后需要提供 PIN 码

### 为账户C生成绑定信息

**生成授权链接：**
```bash
node -r ts-node/register scripts/generateOAuth1AuthLinks.ts
```

**生成的文件：**
1. `./data/oauth1_request_tokens_accountC.json` - Request Token（临时）
2. `~/Desktop/Twitter_OAuth1_授权链接_账户B和C.txt` - 说明文档

**说明文档包含：**
- 账户C的授权链接
- OAuth Token（用于识别）
- 使用说明
- 完成授权的方法

**提供给账户C操作者的信息：**
1. 授权链接（URL）
2. 操作步骤说明
3. 完成授权后需要提供 PIN 码

---

## 🔧 技术实现细节

### 1. OAuth 1.0a 签名生成

系统使用 HMAC-SHA1 算法生成 OAuth 签名：

```typescript
// 签名步骤：
1. 参数排序并编码
2. 构建签名基础字符串：method + url + params
3. 构建签名密钥：consumerSecret + "&" + tokenSecret
4. HMAC-SHA1 签名
5. Base64 编码
```

### 2. Request Token 获取

**API 端点：** `https://api.twitter.com/oauth/request_token`

**请求方式：** POST

**参数：**
- `oauth_callback`: "oob" (out-of-band 模式)

**响应格式：**
```
oauth_token=xxx&oauth_token_secret=yyy&oauth_callback_confirmed=true
```

### 3. 授权 URL 生成

**格式：**
```
https://api.twitter.com/oauth/authorize?oauth_token={oauthToken}
```

### 4. Access Token 交换

**API 端点：** `https://api.twitter.com/oauth/access_token`

**请求方式：** POST

**参数：**
- `oauth_verifier`: PIN 码

**响应格式：**
```
oauth_token=xxx&oauth_token_secret=yyy&user_id=123&screen_name=username
```

### 5. 多账户支持

系统通过文件路径区分不同账户的 Token：

- **账户A（默认）**: `./data/x_oauth1_tokens.json`
- **账户B**: `./data/x_oauth1_tokens_accountB.json`
- **账户C**: `./data/x_oauth1_tokens_accountC.json`

在调用 API 时，通过 `accountKey` 参数指定使用哪个账户的 Token。

---

## 📋 完整绑定流程示例

### 为账户B绑定（完整流程）

**步骤 1: 生成授权链接**
```bash
node -r ts-node/register scripts/generateOAuth1AuthLinks.ts
```

**输出：**
- 授权链接已生成
- Request Token 已保存到 `./data/oauth1_request_tokens_accountB.json`
- 说明文档已保存到桌面

**步骤 2: 提供给账户B操作者**
- 授权链接：`https://api.twitter.com/oauth/authorize?oauth_token=xxx`
- 操作说明：
  1. 确保已登录 Twitter 账户B
  2. 在浏览器中打开授权链接
  3. 点击 "Authorize app"
  4. 复制显示的 PIN 码
  5. 将 PIN 码发送给你

**步骤 3: 收到 PIN 码后完成授权**
```bash
node -r ts-node/register scripts/completeOAuth1Auth.ts accountB <收到的PIN码>
```

**输出：**
- ✅ 授权成功
- Access Token 已保存到 `./data/x_oauth1_tokens_accountB.json`
- 用户 ID 和用户名已显示
- Request Token 文件已删除

**步骤 4: 验证绑定**
```bash
node -r ts-node/register scripts/verifyOAuth1Tokens.ts
```

**输出：**
- 显示所有已绑定的账户信息
- 验证 Token 是否有效

---

## ⚠️ 重要注意事项

### 1. Request Token 有效期
- Request Token 有效期为 **5 分钟**
- 必须在 5 分钟内完成授权并交换 Access Token
- 如果超时，需要重新生成授权链接

### 2. PIN 码使用
- PIN 码只能使用一次
- 使用后立即失效
- 如果输入错误，需要重新授权

### 3. Token 安全性
- Access Token 是永久的，不会过期
- 需要妥善保管 Token 文件
- 不要将 Token 提交到 Git 仓库
- Token 文件已在 `.gitignore` 中

### 4. 多账户隔离
- 每个账户的 Token 存储在独立文件
- 账户之间互不影响
- 可以随时为任意账户重新绑定

### 5. Consumer Key/Secret
- Consumer Key 和 Consumer Secret 是全局的
- 所有账户使用同一对 Consumer Key/Secret
- 不同账户通过不同的 Access Token 区分

---

## 🔍 故障排查

### 问题 1: 找不到 Request Token 文件

**错误信息：**
```
❌ 错误: 找不到 Request Token 文件: ./data/oauth1_request_tokens_accountB.json
```

**解决方法：**
1. 重新运行 `generateOAuth1AuthLinks.ts` 生成授权链接
2. 确保在 5 分钟内完成授权

### 问题 2: PIN 码无效

**错误信息：**
```
❌ 授权失败: Invalid verifier
```

**解决方法：**
1. 检查 PIN 码是否正确复制
2. 确保 PIN 码没有使用过
3. 如果已使用，需要重新授权

### 问题 3: Request Token 已过期

**错误信息：**
```
❌ 授权失败: Request token expired
```

**解决方法：**
1. Request Token 有效期为 5 分钟
2. 重新运行 `generateOAuth1AuthLinks.ts` 生成新的授权链接
3. 尽快完成授权

### 问题 4: Token 文件不存在

**错误信息：**
```
No OAuth 1.0a token found for account accountB. Please authorize first.
```

**解决方法：**
1. 检查 Token 文件是否存在：`./data/x_oauth1_tokens_accountB.json`
2. 如果不存在，需要完成授权流程
3. 如果存在但读取失败，检查文件格式是否正确

---

## 📚 相关文件说明

### 核心服务文件

1. **`src/services/xOAuth1.service.ts`**
   - OAuth 1.0a 核心服务
   - 包含 Token 读取、保存、签名生成等功能
   - 支持多账户 Token 管理

2. **`src/services/xTweetOAuth1.service.ts`**
   - 使用 OAuth 1.0a Token 发送推文
   - 支持多账户发推

3. **`src/server/xOAuth.server.ts`**
   - OAuth Server Web 界面
   - 提供授权页面和 PIN 码提交功能

### 脚本文件

1. **`scripts/generateOAuth1AuthLinks.ts`**
   - 为账户B和账户C生成授权链接
   - 保存 Request Token 到临时文件
   - 生成说明文档到桌面

2. **`scripts/completeOAuth1Auth.ts`**
   - 使用 PIN 码完成授权
   - 交换 Access Token
   - 保存 Token 到对应文件

3. **`scripts/verifyOAuth1Tokens.ts`**
   - 验证所有账户的 Token
   - 显示账户信息

### 配置文件

1. **`src/config/x.ts`**
   - OAuth 配置 Schema
   - 环境变量验证
   - 默认路径配置

---

## 🎯 总结

### 绑定流程核心步骤

1. **生成授权链接** → 获取 Request Token
2. **用户授权** → 获取 PIN 码
3. **交换 Token** → 使用 PIN 码换取 Access Token
4. **保存 Token** → 存储到对应账户文件

### 多账户支持

- 通过文件路径区分不同账户
- 每个账户独立绑定，互不影响
- 支持随时重新绑定任意账户

### 生成给其他账户的信息

**需要提供：**
1. 授权链接（URL）
2. 操作步骤说明
3. 完成授权后需要 PIN 码

**生成方式：**
- 运行 `generateOAuth1AuthLinks.ts` 脚本
- 脚本会自动生成说明文档到桌面
- 文档包含所有必要信息

---

## 📞 技术支持

如果遇到问题，请检查：
1. 环境变量是否正确配置
2. Consumer Key/Secret 是否有效
3. Request Token 是否在有效期内
4. PIN 码是否正确
5. Token 文件是否存在且格式正确

