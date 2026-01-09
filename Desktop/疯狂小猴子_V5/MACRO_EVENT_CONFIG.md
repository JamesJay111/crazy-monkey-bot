# CoinGlass 美国宏观事件自动推送配置说明

## 📋 环境变量配置

无需新增环境变量，使用现有配置：

```bash
# CoinGlass API Key（已在 .env 中配置）
COINGLASS_API_KEY=da0d629f45274302bb2647f72a1a29bc

# DeepSeek API Key（已在 .env 中配置）
DEEPSEEK_API_KEY=your_deepseek_api_key
```

## 🔐 Twitter OAuth 1.0a Token 配置

需要为三个账户配置 OAuth 1.0a Token：

### Account A (韩语/KR)
Token 文件：`./data/x_oauth1_tokens.json`（默认账户）

### Account B (中文/ZH)
Token 文件：`./data/x_oauth1_tokens_accountB.json`

### Account C (英文/EN)
Token 文件：`./data/x_oauth1_tokens_accountC.json`

**Token 文件格式**：
```json
{
  "accessToken": "your_access_token",
  "accessTokenSecret": "your_access_token_secret",
  "userId": "your_user_id",
  "screenName": "your_screen_name",
  "obtainedAt": 1234567890000
}
```

## 🚀 启动方式

### 1. 确保 Token 文件存在

```bash
# 检查 Token 文件
ls -la data/x_oauth1_tokens*.json
```

### 2. 启动 Bot

```bash
# 方式 1: 使用启动脚本
./start.sh

# 方式 2: 直接运行
npm run dev
```

### 3. 验证启动

查看日志确认服务已启动：

```bash
tail -f logs/bot.log | grep -i "macro"
```

应该看到：
```
✅ 宏观事件自动推送任务已启动
Running macro US tweet job...
```

## ⚙️ 配置参数

### 轮询间隔

默认：2 小时

修改位置：`src/services/macroUsTweetJob.service.ts`
```typescript
private readonly POLL_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 小时
```

### 时间窗口

默认：过去 6 小时 + 未来 24 小时

修改位置：`src/services/macroUsTweetJob.service.ts`
```typescript
private readonly TIME_WINDOW_HOURS = { past: 6, future: 24 };
```

### 字符限制

默认：200 characters

修改位置：`src/services/macroUsTweetJob.service.ts`
```typescript
private readonly MAX_TWEET_LENGTH = 200;
```

## 📊 数据库

### 表结构

表名：`macro_event_push_log`

字段：
- `event_key` (TEXT PRIMARY KEY) - 事件唯一键（SHA1 哈希）
- `calendar_name` (TEXT) - 事件名称
- `publish_time_utc_ms` (INTEGER) - 发布时间（毫秒）
- `importance_level` (INTEGER) - 重要性级别（1/2/3）
- `status` (TEXT) - 状态（UPCOMING/RELEASED）
- `sent_at_utc_ms` (INTEGER) - 发送时间（毫秒）
- `tw_a_status` (TEXT) - 账户A状态（sent/failed）
- `tw_b_status` (TEXT) - 账户B状态（sent/failed）
- `tw_c_status` (TEXT) - 账户C状态（sent/failed）
- `tw_a_tweet_id` (TEXT) - 账户A推文ID
- `tw_b_tweet_id` (TEXT) - 账户B推文ID
- `tw_c_tweet_id` (TEXT) - 账户C推文ID
- `last_error` (TEXT) - 最后错误信息

### 查看推送记录

```bash
# 使用 SQLite 命令行工具
sqlite3 db/bot.db "SELECT * FROM macro_event_push_log ORDER BY sent_at_utc_ms DESC LIMIT 10;"
```

## 🔍 日志查看

### 实时日志

```bash
tail -f logs/bot.log | grep -i "macro"
```

### 查看最近推送

```bash
grep "Selected event for push" logs/bot.log | tail -5
```

### 查看推送结果

```bash
grep "Macro US tweet job completed" logs/bot.log | tail -5
```

## 🐛 故障排查

### 1. 没有事件被推送

可能原因：
- CoinGlass API 返回空数据
- 没有美国事件
- 所有事件都已推送过（去重）

检查方法：
```bash
# 查看拉取的事件数
grep "Fetched events from CoinGlass" logs/bot.log | tail -5

# 查看过滤后的美国事件数
grep "Filtered USA events" logs/bot.log | tail -5

# 查看去重后的候选数
grep "Deduplicated events" logs/bot.log | tail -5
```

### 2. DeepSeek 生成失败

可能原因：
- DeepSeek API Key 无效
- 网络连接问题
- API 限流

检查方法：
```bash
# 查看 DeepSeek 错误
grep "Failed to generate tweet" logs/bot.log | tail -5
```

**降级策略**：DeepSeek 失败时会使用简单模板生成推文。

### 3. Twitter 发布失败

可能原因：
- OAuth Token 无效或过期
- API 限流（429）
- 网络问题

检查方法：
```bash
# 查看 Twitter 发布错误
grep "Failed to send tweet to account" logs/bot.log | tail -5
```

**重试机制**：每个账户最多重试 1 次（指数退避 2s -> 5s）。

### 4. 字符数超限

检查方法：
```bash
# 查看生成的推文长度
grep "Generated tweets for three languages" logs/bot.log | tail -5
```

**自动裁剪**：超过 200 字符会自动裁剪（先缩短 MT，再缩短 ST，最后删除 MT）。

## 📝 API 端点说明

### CoinGlass API

**端点**：`/api/macro/calendar`

**请求参数**：
- `start_time` (number) - 开始时间（秒级时间戳）
- `end_time` (number) - 结束时间（秒级时间戳）

**响应格式**：
```json
{
  "code": "0",
  "data": [
    {
      "calendar_name": "Non-Farm Payrolls",
      "country_code": "USA",
      "country_name": "United States",
      "publish_timestamp": 1767571200000,
      "importance_level": 3,
      "has_exact_publish_time": 1,
      "forecast_value": "200K",
      "previous_value": "199K",
      "published_value": "201K",
      "revised_previous_value": null,
      "data_effect": "Positive"
    }
  ]
}
```

**注意**：
- `publish_timestamp` 可能是秒级或毫秒级，代码已自动兼容
- `country_code` 支持多种格式（USA/US/UNITED_STATES），统一映射为 USA

## ✅ 验收检查清单

- [ ] Bot 启动后看到 "✅ 宏观事件自动推送任务已启动"
- [ ] 每 2 小时执行一次 Job（查看日志时间戳）
- [ ] 仅推送美国事件（country_code == "USA"）
- [ ] 每次最多推送 1 条事件
- [ ] 三账户分别发布 KR/ZH/EN 推文
- [ ] 推文包含 ICON + 时间 + ST + MT
- [ ] 推文字符数 <= 200
- [ ] 同一 event_key 不重复推送
- [ ] 账户失败互不影响

## 🔄 手动触发测试

如需手动触发一次 Job（用于测试），可以临时修改代码：

```typescript
// 在 macroUsTweetJob.service.ts 的 start() 方法中
// 立即执行一次（已默认实现）
this.runJobOnce().catch(error => {
  logger.error({ error }, 'Failed to run initial macro US tweet job');
});
```

或创建测试脚本：

```typescript
// scripts/testMacroTweet.ts
import { MacroUsTweetJobService } from '../src/services/macroUsTweetJob.service';
// ... 初始化服务
await macroUsTweetJob.runJobOnce();
```

