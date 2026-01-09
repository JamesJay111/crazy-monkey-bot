# X OAuth 授权错误排查指南

## ❌ 错误信息
"Something went wrong. You weren't able to give access to the App."

## 🔍 常见原因和解决方案

### 1. Callback URI 不匹配（最常见）

**问题：** Twitter Developer Portal 中设置的 Callback URI 与代码中的不一致

**解决步骤：**

1. 访问 https://developer.twitter.com/en/portal/dashboard
2. 选择你的 App
3. 进入 **Settings** → **User authentication settings**
4. 检查 **Callback URI / Redirect URL** 设置
5. 确保添加了：`http://localhost:8787/x/callback`
6. 点击 **Save** 保存

**重要：**
- Callback URI 必须**完全匹配**（包括协议、端口、路径）
- 如果有多个 Callback URI，用换行分隔
- 保存后可能需要等待几分钟生效

### 2. App 类型设置不正确

**检查：**
1. 在 **Settings** → **User authentication settings**
2. 确认 **Type of App** 设置为：
   - ✅ **Web App, Automated App or Bot**
   - ❌ 不要选择 "Native App" 或 "Single Page App"

### 3. App Permissions 设置不正确

**检查：**
1. 在 **Settings** → **User authentication settings**
2. 确认 **App permissions** 设置为：
   - ✅ **Read and write**（需要 `tweet.write` scope）
   - ❌ 如果只是 "Read"，无法发送推文

### 4. OAuth 2.0 未启用

**检查：**
1. 在 **Settings** → **User authentication settings**
2. 确认 **OAuth 2.0** 已启用
3. 如果未启用，点击启用并保存

### 5. Client ID 或 Secret 错误

**检查：**
1. 确认 `.env` 文件中的 `X_CLIENT_ID` 和 `X_CLIENT_SECRET` 正确
2. 在 Portal 中重新生成 Client ID 和 Secret（如果需要）

## 🛠️ 快速修复检查清单

- [ ] Callback URI 在 Portal 中设置为：`http://localhost:8787/x/callback`
- [ ] App 类型设置为：**Web App, Automated App or Bot**
- [ ] App permissions 设置为：**Read and write**
- [ ] OAuth 2.0 已启用
- [ ] Client ID 和 Secret 正确配置在 `.env` 文件中
- [ ] 保存设置后等待 2-3 分钟让更改生效

## 📝 验证步骤

1. 确认 Portal 设置后，重新生成授权链接：
   ```bash
   node scripts/generateAuthUrl.js
   ```

2. 使用新的授权链接重试

3. 如果仍然失败，检查浏览器控制台的错误信息

## 🔗 相关链接

- Twitter Developer Portal: https://developer.twitter.com/en/portal/dashboard
- OAuth 2.0 文档: https://developer.twitter.com/en/docs/authentication/oauth-2-0

