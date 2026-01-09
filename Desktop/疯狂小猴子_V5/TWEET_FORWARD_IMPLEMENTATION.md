# Twitter 推文转发功能实现文档

## 📋 功能概述

实现了账户A发布推文后，自动翻译并转发到账户B（英文）和账户C（韩语）的功能。

## 🎯 核心功能

1. **轮询机制**：定期检查账户A的最新推文（默认每2分钟）
2. **幂等去重**：基于 tweetId 防止重复转发
3. **自动翻译**：使用 DeepSeek API 将推文翻译为英文或韩语
4. **失败隔离**：账户B失败不影响账户C，反之亦然
5. **智能截断**：超过280字符时智能截断，保留关键内容
6. **状态持久化**：转发状态保存在本地文件，重启后继续工作

## 📁 新增文件

### 服务层
- `src/services/tweetTranslation.service.ts` - DeepSeek 翻译服务
- `src/services/tweetForwardState.service.ts` - 转发状态管理服务
- `src/services/tweetForwardJob.service.ts` - 转发轮询 Job 服务

### 工具层
- `src/utils/textTruncate.ts` - 智能截断工具

### 修改文件
- `src/config/env.ts` - 添加转发相关环境变量
- `src/services/xOAuth1.service.ts` - 扩展支持多账户
- `src/services/xTweetOAuth1.service.ts` - 扩展支持多账户发推
- `src/bot/index.ts` - 集成转发 Job 到启动流程

## ⚙️ 环境变量配置

在 `.env` 文件中添加以下配置：

```env
# 转发功能开关
ENABLE_FORWARDING=true

# 账户A的用户名（不含@）
FORWARD_FROM_ACCOUNT_A_HANDLE=your_account_a_username

# 账户B和C的Token标识（对应 ./data/x_oauth1_tokens_accountB.json 和 accountC.json）
FORWARD_TO_ACCOUNT_B_KEY=accountB
FORWARD_TO_ACCOUNT_C_KEY=accountC

# 轮询间隔（毫秒，默认120000 = 2分钟）
FORWARD_POLL_INTERVAL_MS=120000
```

## 🔧 实现细节

### 1. 多账户支持

扩展了 `xOAuth1.service.ts` 和 `xTweetOAuth1.service.ts`，支持通过 `accountKey` 参数指定使用哪个账户的 Token：

```typescript
// 读取指定账户的 Token
readOAuth1TokenStore('accountB')

// 使用指定账户发推
await tweetService.sendTweet(text, 'accountB')
```

### 2. 翻译服务

使用 DeepSeek API 进行翻译，严格遵循以下规则：
- 保留原格式和换行结构
- 不扩写、不添加免责声明
- 不改变专有名词和数字格式
- 仅输出译文

### 3. 智能截断

当翻译后的文本超过280字符时：
- 优先在单词边界截断（英文）
- 避免截断到半个字符（韩文）
- 截断后追加 `…`

### 4. 状态管理

转发状态保存在 `./data/x_forward_state.json`：

```json
{
  "lastSeenTweetId": "1234567890",
  "processed": {
    "1234567890": {
      "b": {
        "tweetId": "forwarded_tweet_id_b",
        "url": "https://twitter.com/...",
        "timestamp": 1234567890000
      },
      "c": {
        "tweetId": "forwarded_tweet_id_c",
        "url": "https://twitter.com/...",
        "timestamp": 1234567890000
      }
    }
  }
}
```

### 5. 去重逻辑

- 如果推文已转发到B和C，跳过
- 如果只转发到其中一个账户，继续转发到另一个账户
- 使用 `tweetId` 作为唯一键

### 6. 失败隔离

使用 `Promise.allSettled` 确保：
- 账户B失败不影响账户C
- 每个账户的失败都会记录日志
- Job 不会因为单个账户失败而崩溃

## 🚀 使用方法

### 1. 配置环境变量

确保 `.env` 文件中包含所有必需的配置项。

### 2. 确保 Token 已授权

确保以下文件存在且包含有效的 Token：
- `./data/x_oauth1_tokens.json` (账户A，用于读取推文)
- `./data/x_oauth1_tokens_accountB.json` (账户B，用于发推)
- `./data/x_oauth1_tokens_accountC.json` (账户C，用于发推)

### 3. 启动 Bot

```bash
npm start
```

转发 Job 会在 Bot 启动时自动启动（如果 `ENABLE_FORWARDING=true`）。

### 4. 查看日志

转发过程的日志会输出到控制台，包括：
- 发现新推文
- 翻译开始/完成
- 转发成功/失败
- 去重跳过

## 📊 工作流程

```
1. Job 启动（每 FORWARD_POLL_INTERVAL_MS 执行一次）
   ↓
2. 获取账户A的最新推文
   ↓
3. 检查是否已处理（去重）
   ↓
4. 如果未处理：
   ├─ 翻译为英文 → 转发到账户B
   └─ 翻译为韩语 → 转发到账户C
   ↓
5. 记录转发结果到状态文件
   ↓
6. 更新 lastSeenTweetId
```

## ⚠️ 注意事项

1. **账户A的Token权限**：账户A的Token需要有读取推文的权限（Read权限）
2. **账户B/C的Token权限**：账户B和C的Token需要有发推的权限（Write权限）
3. **DeepSeek API**：确保 `DEEPSEEK_API_KEY` 配置正确且有足够的配额
4. **轮询频率**：默认2分钟，可根据需要调整，但注意不要过于频繁导致API限流
5. **字符限制**：Twitter推文限制280字符，超过会自动截断

## 🔍 故障排查

### 问题：转发Job未启动

**检查：**
1. `ENABLE_FORWARDING` 是否为 `true`
2. `FORWARD_FROM_ACCOUNT_A_HANDLE` 是否配置
3. 查看启动日志是否有错误

### 问题：无法获取账户A的推文

**检查：**
1. 账户A的Token是否存在且有效
2. `FORWARD_FROM_ACCOUNT_A_HANDLE` 是否正确（不含@）
3. Token是否有读取权限

### 问题：翻译失败

**检查：**
1. `DEEPSEEK_API_KEY` 是否正确
2. DeepSeek API 是否有配额
3. 查看日志中的具体错误信息

### 问题：转发失败

**检查：**
1. 账户B/C的Token是否存在且有效
2. Token是否有发推权限
3. 推文内容是否超过280字符（会自动截断）
4. 查看日志中的具体错误信息

## 📝 后续优化建议

1. **Webhook支持**：如果Twitter支持Webhook，可以替换轮询机制
2. **重试机制**：为翻译和转发添加重试逻辑
3. **批量处理**：如果账户A同时发布多条推文，可以批量处理
4. **状态清理**：定期清理旧的状态记录，避免文件过大
5. **监控告警**：添加监控和告警机制，及时发现异常



