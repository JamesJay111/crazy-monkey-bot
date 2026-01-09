# Twitter OAuth 1.0a 授权完整指南

## 🎯 OAuth 1.0a 的优势

- ✅ **不需要配置 Callback URL**：使用 "oob" (out-of-band) 模式
- ✅ **更简单**：授权流程更直接
- ✅ **永久 Token**：Access Token 不会过期
- ✅ **避免 OAuth 2.0 的配置问题**：不需要在 Twitter Developer Portal 中设置回调地址

## 📋 授权链接

### 账户B（英文推文）

```
https://api.twitter.com/oauth/authorize?oauth_token=3IAhkAAAAAAB6X-cAAABm2mmGQk
```

### 账户C（韩语推文）

```
https://api.twitter.com/oauth/authorize?oauth_token=mD3AlgAAAAAB6X-cAAABm2mmGjo
```

## 🔄 OAuth 1.0a 授权流程（3步）

### 步骤 1: 获取授权链接（已完成 ✅）

- ✅ 授权链接已生成
- ✅ Request Token 已保存到 `./data/oauth1_request_tokens_accountB.json` 和 `accountC.json`
- ✅ Request Token 有效期为 5 分钟

### 步骤 2: 用户授权并获取 PIN 码

1. **在浏览器中打开授权链接**
   - 账户B：使用账户B的授权链接
   - 账户C：使用账户C的授权链接

2. **登录 Twitter 账户**（如果未登录）

3. **点击 "Authorize app" 或 "授权" 按钮**

4. **获取 PIN 码**
   - 授权成功后会显示一个 PIN 码（例如：`1234567`）
   - **重要：** 必须复制并保存这个 PIN 码
   - PIN 码用于下一步交换 Access Token

### 步骤 3: 使用 PIN 码交换 Access Token

有两种方法完成授权：

#### 方法 1: 使用 OAuth Server Web 界面（推荐）

1. **确保 OAuth Server 正在运行**
   ```bash
   npm run oauth
   ```

2. **访问 OAuth 1.0a 授权页面**
   ```
   http://localhost:8787/x/oauth1/auth
   ```

3. **点击授权链接**（或使用上面提供的授权链接）

4. **授权后输入 PIN 码**
   - 在授权页面下方的表单中输入 PIN 码
   - 点击 "完成授权" 按钮

5. **授权成功**
   - 会显示成功页面
   - Token 已保存到 `./data/x_oauth1_tokens.json`

#### 方法 2: 使用命令行工具

1. **获取 PIN 码**（从步骤 2）

2. **运行完成授权脚本**
   
   账户B:
   ```bash
   node -r ts-node/register scripts/completeOAuth1Auth.ts accountB <PIN码>
   ```
   
   账户C:
   ```bash
   node -r ts-node/register scripts/completeOAuth1Auth.ts accountC <PIN码>
   ```

3. **授权成功**
   - 会显示成功消息
   - Token 已保存到对应的文件

## 📝 详细操作步骤

### 为账户B授权（英文推文）

1. **打开授权链接**
   ```
   https://api.twitter.com/oauth/authorize?oauth_token=3IAhkAAAAAAB6X-cAAABm2mmGQk
   ```

2. **确保已登录 Twitter 账户B**

3. **点击授权**

4. **复制 PIN 码**（例如：`1234567`）

5. **完成授权**（选择以下方法之一）：
   
   **方法 A: Web 界面**
   - 访问：http://localhost:8787/x/oauth1/auth
   - 输入 PIN 码并提交
   
   **方法 B: 命令行**
   ```bash
   node -r ts-node/register scripts/completeOAuth1Auth.ts accountB 1234567
   ```

### 为账户C授权（韩语推文）

1. **打开授权链接**
   ```
   https://api.twitter.com/oauth/authorize?oauth_token=mD3AlgAAAAAB6X-cAAABm2mmGjo
   ```

2. **确保已登录 Twitter 账户C**

3. **点击授权**

4. **复制 PIN 码**

5. **完成授权**（同上）

## ✅ 验证授权是否成功

授权成功后，检查 Token 文件：

```bash
# 账户B
cat ./data/x_oauth1_tokens_accountB.json

# 账户C
cat ./data/x_oauth1_tokens_accountC.json
```

应该看到类似内容：
```json
{
  "accessToken": "xxx",
  "accessTokenSecret": "yyy",
  "userId": "123456789",
  "screenName": "your_username",
  "obtainedAt": 1234567890123,
  "accountLabel": "accountB"
}
```

## 🔍 常见问题

### Q1: Request Token 过期了怎么办？

**A:** Request Token 有效期为 5 分钟。如果过期，重新生成授权链接：
```bash
node -r ts-node/register scripts/generateOAuth1AuthLinks.ts
```

### Q2: 授权后没有显示 PIN 码？

**A:** 可能的原因：
1. 授权未成功（检查是否点击了 "Authorize"）
2. Twitter 账户权限问题
3. 尝试刷新页面或重新授权

### Q3: 输入 PIN 码后提示 "Invalid or expired request token"？

**A:** Request Token 已过期。重新生成授权链接并尽快完成授权（5 分钟内）。

### Q4: OAuth Server 未运行？

**A:** 启动 OAuth Server：
```bash
npm run oauth
```

## 💡 重要提示

1. **OAuth 1.0a 不需要配置 Callback URL**
   - 使用 "oob" 模式
   - 不需要在 Twitter Developer Portal 中设置回调地址

2. **Request Token 有效期**
   - 有效期为 5 分钟
   - 请尽快完成授权流程

3. **PIN 码必须保存**
   - 授权后显示的 PIN 码必须输入才能完成授权
   - 如果丢失，需要重新授权

4. **Token 是永久的**
   - OAuth 1.0a 的 Access Token 不会过期
   - 除非用户撤销授权，否则可以一直使用

5. **每个账户需要单独授权**
   - 账户B 和 账户C 需要分别授权
   - 使用不同的授权链接和 PIN 码

## 📚 相关文件

- 授权链接文件：`~/Desktop/Twitter_OAuth1_授权链接_账户B和C.txt`
- Request Token 文件：`./data/oauth1_request_tokens_accountB.json` / `accountC.json`
- Access Token 文件：`./data/x_oauth1_tokens_accountB.json` / `accountC.json`
- 生成脚本：`scripts/generateOAuth1AuthLinks.ts`
- 完成脚本：`scripts/completeOAuth1Auth.ts`



