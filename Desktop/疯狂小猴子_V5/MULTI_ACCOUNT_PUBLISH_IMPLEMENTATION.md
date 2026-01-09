# 多账户直接发布系统实现文档

## 📋 实现概述

已重构 Twitter 发布系统，从"读取账户A推文 → 翻译转发"改为"后端生成 → 缓存 → 多账户直接发布"的流程。

## 🎯 核心变更

### 1. 发布流程（新）

```
1️⃣ 后端触发一次合约推送（满足 Funding 条件）
   ↓
2️⃣ 后端生成【中文原始推文内容】（完整 Twitter 模板）
   ↓
3️⃣ 将该原始内容写入缓存（in-memory + 文件）
   ↓
4️⃣ 使用该缓存内容：
     ├─ 账户 A：直接发布（中文）
     ├─ 账户 B：DeepSeek 翻译为英文 → 发布
     └─ 账户 C：DeepSeek 翻译为韩语 → 发布
```

### 2. 关键改进

- ✅ **不再从 Twitter API 读取账户A的推文**
- ✅ **不再使用 tweetId 作为翻译输入**
- ✅ **所有账户都是独立发布者**
- ✅ **翻译来源只来自后端缓存**

## 📁 新增/修改文件

### 新增文件

1. **`src/services/tweetPublishCache.service.ts`** - 发布内容缓存服务
   - 管理推文发布内容的缓存（内存 + 文件）
   - 支持 `publishId` 作为唯一标识
   - 缓存翻译结果，避免重复调用 DeepSeek

### 修改文件

1. **`src/services/xAutoTweetJob.service.ts`** - 重构发布流程
   - 生成中文原文后写入缓存
   - 实现 `publishToAllAccounts()` 方法
   - 实现 `publishToAccountA/B/C()` 方法
   - 支持失败隔离和幂等性

2. **`src/services/tweetForwardJob.service.ts`** - 标记为废弃
   - 添加 `@deprecated` 注释
   - `start()` 方法不再启动，直接返回

3. **`src/bot/index.ts`** - 更新启动逻辑
   - 移除转发 Job 的启动
   - 多账户发布功能已集成到自动发推任务中

## 🔧 实现细节

### 1. 缓存结构

```typescript
interface PublishCacheEntry {
  publishId: string; // 格式：YYYY-MM-DDTHH:mm:ssZ_TICKER
  createdAt: number;
  ticker: string;
  interval: string;
  sourceText: string; // 中文原文
  translations: {
    en: string | null; // 英文翻译（缓存）
    ko: string | null; // 韩语翻译（缓存）
  };
  published: {
    A: boolean; // 账户A是否已发布
    B: boolean; // 账户B是否已发布
    C: boolean; // 账户C是否已发布
  };
  publishResults?: {
    A?: { tweetId: string; url: string; timestamp: number };
    B?: { tweetId: string; url: string; timestamp: number };
    C?: { tweetId: string; url: string; timestamp: number };
  };
}
```

### 2. 发布流程

#### 账户 A（中文）
```typescript
1. 检查是否已发布（幂等性）
2. 直接使用 sourceText 发布
3. 使用 OAuth 1.0a 或 OAuth 2.0（账户A的Token）
4. 标记 published.A = true
```

#### 账户 B（英文）
```typescript
1. 检查是否已发布（幂等性）
2. 检查是否有缓存的英文翻译
3. 如果没有，调用 DeepSeek 翻译为英文
4. 缓存翻译结果
5. 智能截断（280字符）
6. 使用账户B的Token发布
7. 标记 published.B = true
```

#### 账户 C（韩语）
```typescript
1. 检查是否已发布（幂等性）
2. 检查是否有缓存的韩语翻译
3. 如果没有，调用 DeepSeek 翻译为韩语
4. 缓存翻译结果
5. 智能截断（280字符）
6. 使用账户C的Token发布
7. 标记 published.C = true
```

### 3. 失败隔离

使用 `Promise.allSettled` 确保：
- 账户A失败不影响B和C
- 账户B失败不影响A和C
- 账户C失败不影响A和B
- 每个账户的失败都会记录日志

### 4. 幂等性

- 使用 `publishId` 作为唯一标识
- 检查 `published.A/B/C` 状态
- 如果已发布，跳过并返回已有结果
- 支持重试机制（未发布的账户可以重试）

### 5. 翻译缓存

- 翻译结果缓存在 `translations.en` 和 `translations.ko`
- 避免重复调用 DeepSeek API
- 如果翻译已存在，直接使用缓存

## 📊 发布流程时序

```
触发条件满足（Funding <= -0.05%）
  ↓
生成中文原文（TweetContentService.generateTweet）
  ↓
创建缓存条目（publishId = YYYY-MM-DDTHH:mm:ssZ_TICKER）
  ↓
写入缓存（内存 + 文件）
  ↓
并行发布到三个账户：
  ├─ 账户A：直接发布中文
  ├─ 账户B：翻译为英文 → 发布
  └─ 账户C：翻译为韩语 → 发布
  ↓
记录发布结果
  ↓
更新每日限额（至少一个账户成功）
```

## 🔍 示例：一个 publishId 的完整流程

### publishId: `2024-12-29T10:30:00.000Z_AAVE`

```json
{
  "publishId": "2024-12-29T10:30:00.000Z_AAVE",
  "createdAt": 1735465800000,
  "ticker": "AAVE",
  "interval": "4h",
  "sourceText": "📊 合约数据概览｜AAVE\nBinance · 4h\n\n—\n...",
  "translations": {
    "en": "📊 Contract Data Overview｜AAVE\nBinance · 4h\n\n—\n...",
    "ko": "📊 계약 데이터 개요｜AAVE\nBinance · 4h\n\n—\n..."
  },
  "published": {
    "A": true,
    "B": true,
    "C": true
  },
  "publishResults": {
    "A": {
      "tweetId": "1234567890123456789",
      "url": "https://twitter.com/i/web/status/1234567890123456789",
      "timestamp": 1735465801000
    },
    "B": {
      "tweetId": "9876543210987654321",
      "url": "https://twitter.com/i/web/status/9876543210987654321",
      "timestamp": 1735465802000
    },
    "C": {
      "tweetId": "1122334455667788990",
      "url": "https://twitter.com/i/web/status/1122334455667788990",
      "timestamp": 1735465803000
    }
  }
}
```

## ✅ 验证规则

### 1. 不再从 Twitter API 读取
- ✅ 删除了 `fetchLatestTweet()` 方法（在 tweetForwardJob 中）
- ✅ 删除了 `getUserIdByUsername()` 方法
- ✅ 不再使用 Twitter API 的 timeline 端点

### 2. 不再使用 tweetId
- ✅ 使用 `publishId` 作为唯一标识
- ✅ 翻译输入是 `sourceText`（缓存的中文原文）
- ✅ 不依赖 Twitter 上的推文

### 3. 所有账户都是独立发布者
- ✅ 账户A/B/C都使用各自的Token直接发布
- ✅ 不是转发，是独立发布
- ✅ 使用 `POST /2/tweets` 端点

## 🚀 使用说明

### 1. 环境变量

无需新增环境变量，使用现有配置：
- `PREFLIGHT_MODE` - 预发布模式（仍然有效）
- `FUNDING_THRESHOLD_DECIMAL` - 资金费率阈值（-0.0005）
- `DAILY_TWEET_LIMIT` - 每日限额（3）
- `POLL_INTERVAL_MS` - 轮询间隔（300000 = 5分钟）

### 2. Token 配置

确保以下 Token 文件存在：
- `./data/x_oauth1_tokens.json` - 账户A（中文）
- `./data/x_oauth1_tokens_accountB.json` - 账户B（英文）
- `./data/x_oauth1_tokens_accountC.json` - 账户C（韩语）

### 3. 启动

```bash
npm start
```

系统会自动：
1. 轮询检查 Funding 条件
2. 生成中文原文
3. 写入缓存
4. 发布到 A/B/C 三个账户

### 4. 缓存文件

缓存保存在：
- `./data/tweet_publish_cache.json` - 发布缓存（持久化）

## ⚠️ 注意事项

1. **Preflight 模式**：仍然有效，会生成缓存但不发布
2. **每日限额**：至少一个账户成功才计入限额
3. **失败重试**：未发布的账户可以在下一轮重试
4. **翻译缓存**：翻译结果会缓存，避免重复调用 DeepSeek
5. **TG Bot**：完全未修改，不受影响

## 📝 后续优化建议

1. **重试机制**：可以为失败的账户添加自动重试
2. **监控告警**：添加监控，及时发现发布失败
3. **缓存清理**：定期清理旧缓存，避免文件过大
4. **批量发布**：如果同时满足多个条件，可以批量处理



