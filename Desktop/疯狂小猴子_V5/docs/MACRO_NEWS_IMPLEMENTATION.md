# 宏观新闻推送模块实现文档

## 概述

宏观新闻推送模块是一个实时监控和推送系统，用于从 CoinGlass API 获取宏观新闻（经济数据、财经事件、央行动态、新闻文章、快讯），并通过 Webhook 和 Twitter 进行多语言推送。

## 架构设计

### 模块组成

1. **MacroNewsWebhookPushService** - Webhook 实时推送服务
2. **MacroNewsPushService** - Twitter 多账户推送服务
3. **CoinGlassClient** - CoinGlass API 客户端封装

### 数据流

```
CoinGlass API
    ↓
CoinGlassClient (字段映射与转换)
    ↓
MacroNewsWebhookPushService / MacroNewsPushService
    ↓
DeepSeek API (生成解读)
    ↓
Webhook / Twitter (多语言推送)
```

## CoinGlass API 字段映射详解

### 1. 经济数据 (Economic Data)

**API 端点**: `/api/calendar/economic-data`

**请求参数**:
```typescript
{
  start_time: number;  // 毫秒级时间戳（注意：不是秒级）
  end_time: number;   // 毫秒级时间戳
}
```

**API 响应字段映射**:

| CoinGlass API 字段 | 内部字段名 | 类型 | 说明 |
|-------------------|-----------|------|------|
| `event_id` | `id` | string | 事件唯一标识符 |
| `event_name` | `calendar_name` | string | 事件名称（如 "Non-Farm Payrolls"） |
| `country_code` | `country_code` | string | 国家代码（如 "US", "CN"） |
| `publish_time_utc` | `publish_time_utc_ms` | number | 发布时间（毫秒级时间戳） |
| `importance_level` | `importance_level` | number | 重要性级别（1-3，3为最高） |
| `status` | `status` | string | 状态（"UPCOMING" 或 "RELEASED"） |
| `forecast_value` | `forecast_value` | string | 预期值 |
| `previous_value` | `previous_value` | string | 前值 |
| `published_value` | `published_value` | string | 公布值（如果已发布） |

**代码实现位置**: `src/clients/coinglass.client.ts` - `getMacroEvents()` 方法

**关键实现细节**:
```typescript
// 1. 时间戳转换：确保使用毫秒级时间戳
const startTime = now - TIME_WINDOW_HOURS.past * 60 * 60 * 1000; // 毫秒
const endTime = now + TIME_WINDOW_HOURS.future * 60 * 60 * 1000; // 毫秒

// 2. 字段映射：将 API 返回的字段映射到内部数据结构
const events = response.data.map((item: any) => ({
  event_id: item.event_id,
  event_name: item.event_name,
  country_code: item.country_code,
  publish_time_utc: item.publish_time_utc, // 注意：API 可能返回秒级或毫秒级
  publish_time_utc_ms: item.publish_time_utc_ms || item.publish_time_utc * 1000, // 统一转换为毫秒级
  importance_level: item.importance_level || 1,
  status: item.status || 'UPCOMING',
  forecast_value: item.forecast_value,
  previous_value: item.previous_value,
  published_value: item.published_value,
}));
```

### 2. 财经事件 (Financial Events)

**API 端点**: `/api/calendar/financial-events`

**字段映射**: 与经济数据相同，使用相同的字段结构。

**代码实现位置**: `src/clients/coinglass.client.ts` - `getMacroEvents()` 方法（合并处理）

### 3. 央行动态 (Central Bank Activities)

**API 端点**: `/api/calendar/central-bank-activities`

**字段映射**: 与经济数据相同，使用相同的字段结构。

**代码实现位置**: `src/clients/coinglass.client.ts` - `getMacroEvents()` 方法（合并处理）

### 4. 新闻文章 (Articles)

**API 端点**: `/api/article/list`

**请求参数**:
```typescript
{
  start_time?: number;  // 毫秒级时间戳
  end_time?: number;    // 毫秒级时间戳
  limit?: number;       // 返回数量限制（默认 100）
}
```

**API 响应字段映射**:

| CoinGlass API 字段 | 内部字段名 | 类型 | 说明 |
|-------------------|-----------|------|------|
| `article_id` | `id` | string | 文章唯一标识符 |
| `article_title` | `title` | string | 文章标题 |
| `article_content` | `content` | string | 文章内容 |
| `article_release_time` | `publish_time` | number | 发布时间（毫秒级时间戳） |
| `url` | `url` | string | 文章链接 |
| `source_name` | `source` | string | 来源名称 |

**代码实现位置**: `src/clients/coinglass.client.ts` - `getArticleList()` 方法

**关键实现细节**:
```typescript
// 1. 字段映射：处理 API 返回的字段名差异
return response.data.map((item: any) => ({
  // 保留原始字段名（用于调试）
  article_id: item.article_id || item.id,
  article_title: item.article_title,
  article_content: item.article_content,
  article_release_time: item.article_release_time,
  
  // 映射到统一字段名（用于业务逻辑）
  title: item.article_title || item.title,
  content: item.article_content || item.content,
  publish_time: item.article_release_time || item.publish_time,
  url: item.url,
  source: item.source_name || item.source,
  source_name: item.source_name,
}));

// 2. ID 生成：如果 API 没有返回 article_id，则生成唯一 ID
const articleId = article.article_id || `${articleTitle}-${articlePublishTime}`;
```

### 5. 快讯 (Newsflashes)

**API 端点**: `/api/newsflash/list`

**请求参数**: 与新闻文章相同

**API 响应字段映射**:

| CoinGlass API 字段 | 内部字段名 | 类型 | 说明 |
|-------------------|-----------|------|------|
| `newsflash_id` | `id` | string | 快讯唯一标识符 |
| `newsflash_title` | `title` | string | 快讯标题 |
| `newsflash_content` | `content` | string | 快讯内容 |
| `newsflash_release_time` | `publish_time` | number | 发布时间（毫秒级时间戳） |
| `url` | `url` | string | 快讯链接 |
| `source_name` | `source` | string | 来源名称 |

**代码实现位置**: `src/clients/coinglass.client.ts` - `getNewsflashList()` 方法

**关键实现细节**:
```typescript
// 字段映射逻辑与文章相同，但使用 newsflash_ 前缀的字段
return response.data.map((item: any) => ({
  newsflash_id: item.newsflash_id || item.id,
  newsflash_title: item.newsflash_title,
  newsflash_content: item.newsflash_content,
  newsflash_release_time: item.newsflash_release_time,
  title: item.newsflash_title || item.title,
  content: item.newsflash_content || item.content,
  publish_time: item.newsflash_release_time || item.publish_time,
  url: item.url,
  source: item.source_name || item.source,
  source_name: item.source_name,
}));
```

## 服务实现详解

### MacroNewsWebhookPushService

**文件位置**: `src/services/macroNewsWebhookPush.service.ts`

**核心功能**:
1. 每 10 分钟扫描一次 CoinGlass API
2. 获取所有类型的新闻（经济数据、财经事件、央行动态、文章、快讯）
3. 去重处理（基于新闻 ID）
4. 调用 DeepSeek 生成解读
5. 分开发送三条消息到 Webhook（中文/英文/韩语）

**实现步骤**:

#### 步骤 1: 初始化服务

```typescript
export class MacroNewsWebhookPushService {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private readonly POLL_INTERVAL_MS = 10 * 60 * 1000; // 10 分钟
  private readonly TIME_WINDOW_MS = 24 * 60 * 60 * 1000; // 过去 24 小时
  private readonly WEBHOOK_URL: string;

  constructor(
    private coinglass: CoinGlassClient,
    private deepseek: DeepSeekClient,
    private db: Database.Database,
    webhookUrl: string
  ) {
    this.WEBHOOK_URL = webhookUrl;
    this.initDatabase();
  }
}
```

#### 步骤 2: 初始化数据库表

```typescript
private initDatabase(): void {
  this.db.exec(`
    CREATE TABLE IF NOT EXISTS macro_news_webhook_push_log (
      news_id TEXT PRIMARY KEY,
      news_type TEXT NOT NULL,
      title TEXT NOT NULL,
      publish_time_ms INTEGER NOT NULL,
      pushed_at_ms INTEGER NOT NULL,
      zh_status TEXT CHECK(zh_status IN ('sent', 'failed')),
      en_status TEXT CHECK(en_status IN ('sent', 'failed')),
      ko_status TEXT CHECK(ko_status IN ('sent', 'failed')),
      last_error TEXT
    )
  `);
}
```

#### 步骤 3: 启动定时扫描

```typescript
start(): void {
  if (this.intervalId) {
    logger.warn('Macro news webhook push service is already running');
    return;
  }

  // 立即执行一次
  this.runScanOnce().catch(error => {
    logger.error({ error }, 'Failed to run initial macro news scan');
  });

  // 每 10 分钟执行一次
  this.intervalId = setInterval(() => {
    this.runScanOnce().catch(error => {
      logger.error({ error }, 'Failed to run scheduled macro news scan');
    });
  }, this.POLL_INTERVAL_MS);
}
```

#### 步骤 4: 获取所有新闻

```typescript
private async fetchAllNews(): Promise<NewsItem[]> {
  const now = Date.now();
  const startTime = now - this.TIME_WINDOW_MS;
  const endTime = now;
  const allNews: NewsItem[] = [];

  // 1. 获取经济数据、财经事件、央行动态
  const macroEvents = await this.coinglass.getMacroEvents({
    start_time: startTime,
    end_time: endTime,
  });

  for (const event of macroEvents) {
    // 根据事件类型分类
    let type: NewsType;
    if (event.event_name?.includes('Central Bank') || event.country_code === 'CB') {
      type = 'central-bank';
    } else if (event.event_name?.includes('Financial')) {
      type = 'financial-events';
    } else {
      type = 'economic-data';
    }

    allNews.push({
      id: `event-${event.event_id}`,
      type,
      title: event.event_name || 'Unknown Event',
      publishTime: event.publish_time_utc_ms,
      countryCode: event.country_code,
    });
  }

  // 2. 获取文章列表
  const articles = await this.coinglass.getArticleList({
    start_time: startTime,
    end_time: endTime,
    limit: 100,
  });

  for (const article of articles) {
    const articleTitle = article.article_title || article.title;
    const articlePublishTime = article.article_release_time || article.publish_time;
    if (articleTitle && articlePublishTime) {
      const articleId = article.article_id || `${articleTitle}-${articlePublishTime}`;
      allNews.push({
        id: `article-${articleId}`,
        type: 'article',
        title: articleTitle,
        content: article.article_content || article.content,
        publishTime: articlePublishTime,
        url: article.url,
        source: article.source_name || article.source,
      });
    }
  }

  // 3. 获取快讯列表
  const newsflashes = await this.coinglass.getNewsflashList({
    start_time: startTime,
    end_time: endTime,
    limit: 100,
  });

  for (const newsflash of newsflashes) {
    const newsflashTitle = newsflash.newsflash_title || newsflash.title;
    const newsflashPublishTime = newsflash.newsflash_release_time || newsflash.publish_time;
    if (newsflashTitle && newsflashPublishTime) {
      const newsflashId = newsflash.newsflash_id || `${newsflashTitle}-${newsflashPublishTime}`;
      allNews.push({
        id: `newsflash-${newsflashId}`,
        type: 'newsflash',
        title: newsflashTitle,
        content: newsflash.newsflash_content || newsflash.content,
        publishTime: newsflashPublishTime,
        url: newsflash.url,
        source: newsflash.source_name || newsflash.source,
      });
    }
  }

  return allNews;
}
```

#### 步骤 5: 去重处理

```typescript
private async deduplicateNews(allNews: NewsItem[]): Promise<NewsItem[]> {
  const stmt = this.db.prepare(`
    SELECT news_id FROM macro_news_webhook_push_log
    WHERE news_id = ?
  `);

  const newNews: NewsItem[] = [];
  for (const news of allNews) {
    const existing = stmt.get(news.id);
    if (!existing) {
      newNews.push(news);
    }
  }

  return newNews;
}
```

#### 步骤 6: 生成 DeepSeek 解读

```typescript
private async generateDeepSeekAnalysis(news: NewsItem): Promise<{ interpretation: string; background: string }> {
  const systemPrompt = `你是一名专业的加密货币宏观市场分析师。你的任务是根据宏观新闻，分析其对加密货币市场的影响。

要求：
1. 生成一段 30-50 字的解读，说明该新闻对加密货币宏观市场的影响
2. 提供一段 50-100 字的背景信息，解释该新闻的背景和重要性
3. 分析要客观、专业，不要过度解读
4. 重点关注对 BTC、ETH 等主流加密货币的潜在影响`;

  const userPrompt = `新闻标题：${news.title}
${news.content ? `新闻内容：${news.content.substring(0, 500)}` : ''}
${news.countryCode ? `国家：${news.countryCode}` : ''}
发布时间：${new Date(news.publishTime).toISOString()}

请生成：
1. 解读（30-50字）：该新闻对加密货币宏观市场的影响
2. 背景信息（50-100字）：该新闻的背景和重要性`;

  try {
    const response = await this.deepseek.analyzeWithPrompt(
      systemPrompt,
      userPrompt,
      { temperature: 0.7, maxTokens: 500 }
    );

    // 解析响应（假设响应格式为 "解读：...\n\n背景：..."）
    const lines = response.split('\n\n');
    let interpretation = '';
    let background = '';

    for (const line of lines) {
      if (line.includes('解读：') || line.includes('影响：')) {
        interpretation = line.replace(/^(解读：|影响：)/, '').trim();
      } else if (line.includes('背景：') || line.includes('背景信息：')) {
        background = line.replace(/^(背景：|背景信息：)/, '').trim();
      }
    }

    // 如果没有明确的分隔，则尝试其他解析方式
    if (!interpretation || !background) {
      const parts = response.split(/\n{2,}/);
      interpretation = parts[0]?.trim() || response.substring(0, 100);
      background = parts[1]?.trim() || response.substring(100);
    }

    return { interpretation, background };
  } catch (error) {
    logger.error({ error, newsId: news.id }, 'Failed to generate DeepSeek analysis');
    return {
      interpretation: '该新闻可能对加密货币市场产生影响，建议关注市场动态。',
      background: '该新闻涉及宏观经济或金融政策，可能影响市场情绪和资金流向。',
    };
  }
}
```

#### 步骤 7: 构建 Webhook 消息

```typescript
private buildWebhookMessage(
  news: NewsItem,
  language: 'zh' | 'en' | 'ko',
  analysis: { interpretation: string; background: string }
): string {
  const label = NEWS_TYPE_LABELS[news.type][language];
  const icon = NEWS_TYPE_ICONS[news.type];
  const publishTime = new Date(news.publishTime).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  let message = `${icon} ${label}\n\n`;
  message += `📰 ${news.title}\n`;
  message += `⏰ ${publishTime}\n`;
  
  if (news.countryName) {
    message += `🌍 ${news.countryName}\n`;
  }
  
  if (news.source) {
    message += `📌 来源：${news.source}\n`;
  }
  
  message += `\n💡 解读：${analysis.interpretation}\n\n`;
  message += `📚 背景：${analysis.background}`;

  return message;
}
```

#### 步骤 8: 翻译消息

```typescript
private async translateText(
  text: string,
  fromLang: 'zh' | 'en' | 'ko',
  toLang: 'zh' | 'en' | 'ko'
): Promise<string> {
  if (fromLang === toLang) {
    return text;
  }

  const langNames = {
    zh: '中文',
    en: '英文',
    ko: '韩语',
  };

  const systemPrompt = `你是一名专业的翻译专家。请将以下文本从${langNames[fromLang]}翻译为${langNames[toLang]}，保持格式和结构不变。`;

  try {
    const response = await this.deepseek.analyzeWithPrompt(
      systemPrompt,
      text,
      { temperature: 0.3, maxTokens: 1000 }
    );
    return response.trim();
  } catch (error) {
    logger.error({ error, fromLang, toLang }, 'Failed to translate text');
    return text; // 翻译失败时返回原文
  }
}
```

#### 步骤 9: 发送到 Webhook

```typescript
private async sendToWebhook(text: string): Promise<boolean> {
  try {
    const payload = {
      msg_type: 'text',
      content: {
        text: text,
      },
    };

    const response = await axios.post(this.WEBHOOK_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });

    if (response.status === 200) {
      return true;
    } else {
      logger.warn({ status: response.status }, 'Webhook returned non-200 status');
      return false;
    }
  } catch (error) {
    logger.error({ error }, 'Failed to send message to webhook');
    return false;
  }
}
```

#### 步骤 10: 推送新闻（主流程）

```typescript
private async pushNews(news: NewsItem): Promise<void> {
  try {
    // 1. 生成 DeepSeek 解读（中文）
    const analysis = await this.generateDeepSeekAnalysis(news);

    // 2. 构建中文消息
    const zhMessage = this.buildWebhookMessage(news, 'zh', analysis);

    // 3. 翻译为英文和韩语
    const enMessage = await this.translateText(zhMessage, 'zh', 'en');
    const koMessage = await this.translateText(zhMessage, 'zh', 'ko');

    // 4. 分开发送三条消息
    const results = {
      zh: false,
      en: false,
      ko: false,
    };

    // 发送中文版本
    results.zh = await this.sendToWebhook(`🇨🇳 中文版本\n\n${zhMessage}`);
    await this.sleep(1000);

    // 发送英文版本
    results.en = await this.sendToWebhook(`🇺🇸 英文版本\n\n${enMessage}`);
    await this.sleep(1000);

    // 发送韩语版本
    results.ko = await this.sendToWebhook(`🇰🇷 韩语版本\n\n${koMessage}`);

    // 5. 记录推送日志
    await this.logPush(news, results);

    logger.info({
      newsId: news.id,
      newsType: news.type,
      results,
    }, 'Macro news pushed to webhook');
  } catch (error) {
    logger.error({ error, newsId: news.id }, 'Failed to push macro news');
  }
}
```

## 错误处理

### API 调用错误

```typescript
// 1. 404 错误：端点不存在
if (error?.statusCode === 404 || error?.response?.status === 404) {
  logger.debug('API endpoint not found (404)');
  return []; // 返回空数组，不影响其他新闻类型的获取
}

// 2. 网络错误：重试机制
const maxRetries = 3;
for (let attempt = 1; attempt <= maxRetries; attempt++) {
  try {
    const response = await this.coinglass.getArticleList(params);
    return response;
  } catch (error) {
    if (attempt === maxRetries) {
      logger.error({ error }, 'Failed to fetch articles after retries');
      return [];
    }
    await this.sleep(1000 * attempt); // 指数退避
  }
}
```

### 数据缺失处理

```typescript
// 如果 API 没有返回 article_id，生成唯一 ID
const articleId = article.article_id || `${articleTitle}-${articlePublishTime}`;

// 如果缺少必需字段，跳过该新闻
if (!articleTitle || !articlePublishTime) {
  logger.debug({ article }, 'Article missing required fields, skipping');
  continue;
}
```

## 性能优化

### 1. 缓存机制

```typescript
// CoinGlassClient 中的缓存实现
const cacheKey = this.getCacheKey('/api/article/list', requestParams);
const response = await this.request<any>(
  '/api/article/list',
  requestParams,
  {
    cacheKey,
    cacheTTL: 5 * 60 * 1000, // 5分钟缓存
  }
);
```

### 2. 批量处理

```typescript
// 批量获取新闻，而不是逐个请求
const allNews = await Promise.all([
  this.coinglass.getMacroEvents(params),
  this.coinglass.getArticleList(params),
  this.coinglass.getNewsflashList(params),
]);
```

### 3. 延迟发送

```typescript
// 避免 Webhook 限流
await this.sleep(1000); // 每条消息之间延迟 1 秒
```

## 测试建议

### 1. 单元测试

```typescript
// 测试字段映射
describe('CoinGlassClient - getArticleList', () => {
  it('should map article_title to title', async () => {
    const mockResponse = {
      code: '0',
      data: [{
        article_id: '123',
        article_title: 'Test Article',
        article_release_time: 1234567890000,
      }],
    };
    // ... 测试逻辑
  });
});
```

### 2. 集成测试

```typescript
// 测试完整流程
describe('MacroNewsWebhookPushService', () => {
  it('should fetch and push news to webhook', async () => {
    const service = new MacroNewsWebhookPushService(...);
    await service.runScanOnce();
    // 验证 Webhook 是否收到消息
  });
});
```

## 部署配置

### 环境变量

```env
COINGLASS_API_KEY=your_api_key_here
DEEPSEEK_API_KEY=your_deepseek_key_here
WEBHOOK_URL=https://open.larksuite.com/open-apis/bot/v2/hook/...
```

### 启动服务

```typescript
// src/bot/index.ts
const macroNewsWebhookPushService = new MacroNewsWebhookPushService(
  coinglassClient,
  deepseek,
  db,
  'https://open.larksuite.com/open-apis/bot/v2/hook/...'
);

macroNewsWebhookPushService.start();
```

## 常见问题

### Q1: API 返回 404 错误

**原因**: API 端点可能不存在或 URL 错误

**解决方案**:
1. 检查 API 文档确认正确的端点
2. 确认 API Key 权限
3. 检查 API 版本（v4.0）

### Q2: 字段映射错误

**原因**: API 返回的字段名与代码中的字段名不一致

**解决方案**:
1. 打印 API 响应查看实际字段名
2. 更新字段映射逻辑
3. 添加字段缺失的容错处理

### Q3: 时间戳格式错误

**原因**: API 可能返回秒级时间戳，但代码期望毫秒级

**解决方案**:
```typescript
// 统一转换为毫秒级
const publishTime = item.publish_time_utc_ms || item.publish_time_utc * 1000;
```

## 相关文档

- [CoinGlass API v4.0 文档](https://docs.coinglass.com/v4.0-zh)
- [DeepSeek API 文档](https://platform.deepseek.com/api-docs/)
- [Lark Webhook 文档](https://open.larksuite.com/document/ukTMukTMukTM/ucTM5YjL3ETO24yNxkjN)
