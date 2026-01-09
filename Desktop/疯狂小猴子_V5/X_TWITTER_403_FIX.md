# Twitter API 403 Forbidden 错误解决方案

## ❌ 错误信息

```
Request failed with status code 403
title: "Forbidden"
detail: "Forbidden"
```

## 🔍 可能原因

### 1. Twitter App 权限设置不正确

**问题：** Twitter Developer Portal 中的 App 权限设置为 "Read only"

**解决：**
1. 访问 [Twitter Developer Portal](https://developer.twitter.com/en/portal/dashboard)
2. 进入你的 App 设置
3. 找到 "App permissions" 或 "User authentication settings"
4. 将权限从 "Read only" 改为 **"Read and write"**
5. 保存设置
6. **重要：** 修改权限后，需要重新授权（生成新的 token）

### 2. Token Scope 不包含 tweet.write

**检查当前 Token Scope：**
```bash
cat ./data/x_tokens.json | grep scope
```

**应该包含：** `tweet.write users.read offline.access`

**如果缺少 `tweet.write`：**
- 需要重新授权
- 确保授权时包含 `tweet.write` scope

### 3. Twitter API v2 权限要求

Twitter API v2 要求：
- App Type 必须是 "Web App, Automated App or Bot"
- App Permissions 必须是 "Read and write"
- OAuth 2.0 必须已启用

## ✅ 解决步骤

### 步骤 1: 检查 Twitter Developer Portal 设置

1. 访问：https://developer.twitter.com/en/portal/dashboard
2. 选择你的 App
3. 检查以下设置：

   **App permissions:**
   - ✅ 必须是 "Read and write"
   - ❌ 不能是 "Read only"

   **App Type:**
   - ✅ 必须是 "Web App, Automated App or Bot"
   - ❌ 不能是其他类型

   **OAuth 2.0:**
   - ✅ 必须已启用

### 步骤 2: 重新授权（如果修改了权限）

如果修改了 App 权限，必须重新授权：

1. **删除旧 Token：**
   ```bash
   rm ./data/x_tokens.json
   ```

2. **重新生成授权链接：**
   ```bash
   # 确保 OAuth Server 运行
   npm run oauth
   
   # 访问授权页面
   # http://localhost:8787/x/auth
   ```

3. **重新授权：**
   - 在浏览器中打开授权链接
   - 确保已登录 Twitter B 账号
   - 点击"授权"
   - 确认授权页面显示 "Read and write" 权限

### 步骤 3: 验证 Token Scope

授权后，检查 token 文件：

```bash
cat ./data/x_tokens.json | python3 -m json.tool | grep scope
```

**应该看到：**
```json
"scope": "tweet.write users.read offline.access"
```

### 步骤 4: 测试发推

使用测试接口：

```bash
curl -X POST http://localhost:8787/x/test-tweet
```

或等待自动发推任务执行。

## 🔧 快速修复命令

```bash
# 1. 检查当前 token scope
cat ./data/x_tokens.json | grep scope

# 2. 如果缺少 tweet.write，删除旧 token
rm ./data/x_tokens.json

# 3. 确保 OAuth Server 运行
npm run oauth

# 4. 访问授权页面重新授权
# http://localhost:8787/x/auth
```

## 📝 注意事项

1. **权限修改后必须重新授权：** 修改 App 权限后，旧的 token 不会自动更新，必须重新授权
2. **检查授权页面：** 授权时确认页面显示 "Read and write" 权限
3. **Token Scope：** 确保 token 包含 `tweet.write` scope
4. **App Type：** 必须是 "Web App, Automated App or Bot"

## ✅ 验证清单

- [ ] Twitter Developer Portal 中 App permissions = "Read and write"
- [ ] App Type = "Web App, Automated App or Bot"
- [ ] OAuth 2.0 已启用
- [ ] Token scope 包含 `tweet.write`
- [ ] 已重新授权（如果修改了权限）

## 🚨 如果仍然失败

如果按照以上步骤操作后仍然出现 403 错误：

1. **检查 Twitter API 状态：** https://api.twitterstat.us/
2. **查看详细错误信息：** 检查日志中的完整错误响应
3. **联系 Twitter Support：** 如果确认所有设置都正确，可能需要联系 Twitter 支持

