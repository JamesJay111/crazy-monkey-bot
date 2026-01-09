# CoinGlass API 字段映射完整文档

本文档详细说明 CoinGlass API v4.0 返回的字段与内部代码字段的映射关系。

## 目录

1. [经济数据字段映射](#经济数据字段映射)
2. [财经事件字段映射](#财经事件字段映射)
3. [央行动态字段映射](#央行动态字段映射)
4. [新闻文章字段映射](#新闻文章字段映射)
5. [快讯字段映射](#快讯字段映射)
6. [ETF 数据字段映射](#etf-数据字段映射)
7. [合约数据字段映射](#合约数据字段映射)

## 经济数据字段映射

### API 端点
- **URL**: `/api/calendar/economic-data`
- **方法**: `GET`
- **文档**: https://docs.coinglass.com/v4.0-zh/reference/economic-data

### 请求参数

| 参数名 | 类型 | 必填 | 说明 | 示例 |
|--------|------|------|------|------|
| `start_time` | number | 是 | 开始时间（**毫秒级**时间戳） | `1704067200000` |
| `end_time` | number | 是 | 结束时间（**毫秒级**时间戳） | `1704153600000` |

**⚠️ 重要**: CoinGlass API v4.0 要求使用**毫秒级**时间戳，不是秒级。

### 响应字段映射

| CoinGlass API 字段 | 类型 | 内部字段名 | 说明 | 示例值 |
|-------------------|------|-----------|------|--------|
| `event_id` | string | `event_id` | 事件唯一标识符 | `"evt_123456"` |
| `event_name` | string | `event_name` / `calendar_name` | 事件名称 | `"Non-Farm Payrolls"` |
| `country_code` | string | `country_code` | 国家代码（ISO 3166-1 alpha-2 或 alpha-3） | `"US"` / `"USA"` |
| `publish_time_utc` | number | `publish_time_utc_ms` | 发布时间（**毫秒级**时间戳） | `1704067200000` |
| `importance_level` | number | `importance_level` | 重要性级别（1-3，3为最高） | `3` |
| `status` | string | `status` | 状态 | `"UPCOMING"` / `"RELEASED"` |
| `forecast_value` | string | `forecast_value` | 预期值 | `"200K"` |
| `previous_value` | string | `previous_value` | 前值 | `"180K"` |
| `published_value` | string | `published_value` | 公布值（仅当 status="RELEASED" 时存在） | `"195K"` |
| `unit` | string | `unit` | 单位 | `"K"` / `"%"` |
| `impact` | string | `impact` | 影响方向 | `"Positive"` / `"Negative"` / `"Neutral"` |

### 代码实现

```typescript
// src/clients/coinglass.client.ts

async getMacroEvents(params: {
  start_time: number; // 毫秒级时间戳
  end_time: number;   // 毫秒级时间戳
}): Promise<CoinGlassMacroEvent[]> {
  // 1. 构建请求参数
  const requestParams = {
    start_time: params.start_time,
    end_time: params.end_time,
  };

  // 2. 调用 API（支持多个端点）
  const v4Endpoints = [
    '/api/calendar/economic-data',
    '/api/calendar/financial-events',
    '/api/calendar/central-bank-activities',
  ];

  const allEvents: CoinGlassMacroEvent[] = [];

  for (const endpoint of v4Endpoints) {
    try {
      const response = await this.request<any>(endpoint, requestParams);
      
      if (response && response.code === '0' && Array.isArray(response.data)) {
        // 3. 字段映射
        const events = response.data.map((item: any) => ({
          event_id: item.event_id,
          event_name: item.event_name,
          calendar_name: item.event_name, // 别名
          country_code: item.country_code,
          
          // ⚠️ 关键：时间戳转换
          // API 可能返回秒级或毫秒级，统一转换为毫秒级
          publish_time_utc_ms: item.publish_time_utc_ms || 
                              (item.publish_time_utc ? item.publish_time_utc * 1000 : Date.now()),
          
          importance_level: item.importance_level || 1,
          status: item.status || 'UPCOMING',
          forecast_value: item.forecast_value,
          previous_value: item.previous_value,
          published_value: item.published_value,
          unit: item.unit,
          impact: item.impact,
        }));
        
        allEvents.push(...events);
      }
    } catch (error) {
      // 单个端点失败不影响其他端点
      logger.warn({ error, endpoint }, 'Failed to fetch macro events from endpoint');
    }
  }

  return allEvents;
}
```

## 财经事件字段映射

### API 端点
- **URL**: `/api/calendar/financial-events`
- **方法**: `GET`
- **文档**: https://docs.coinglass.com/v4.0-zh/reference/financial-events

### 字段映射

财经事件使用与经济数据**完全相同**的字段结构，通过 `getMacroEvents()` 方法合并处理。

**区别**: 财经事件通常不包含 `forecast_value`、`previous_value`、`published_value` 等数值字段。

## 央行动态字段映射

### API 端点
- **URL**: `/api/calendar/central-bank-activities`
- **方法**: `GET`
- **文档**: https://docs.coinglass.com/v4.0-zh/reference/central-bank-activities

### 字段映射

央行动态使用与经济数据**完全相同**的字段结构，通过 `getMacroEvents()` 方法合并处理。

**特点**: 央行动态的 `country_code` 通常为 `"CB"` 或特定国家代码。

## 新闻文章字段映射

### API 端点
- **URL**: `/api/article/list`
- **方法**: `GET`
- **文档**: https://docs.coinglass.com/v4.0-zh/reference/article-list

### 请求参数

| 参数名 | 类型 | 必填 | 说明 | 示例 |
|--------|------|------|------|------|
| `start_time` | number | 否 | 开始时间（**毫秒级**时间戳） | `1704067200000` |
| `end_time` | number | 否 | 结束时间（**毫秒级**时间戳） | `1704153600000` |
| `limit` | number | 否 | 返回数量限制 | `100` |

### 响应字段映射

| CoinGlass API 字段 | 类型 | 内部字段名 | 说明 | 示例值 |
|-------------------|------|-----------|------|--------|
| `article_id` | string | `article_id` / `id` | 文章唯一标识符 | `"art_123456"` |
| `article_title` | string | `article_title` / `title` | 文章标题 | `"Bitcoin Reaches New High"` |
| `article_content` | string | `article_content` / `content` | 文章内容（可能为 HTML） | `"<p>Bitcoin...</p>"` |
| `article_release_time` | number | `article_release_time` / `publish_time` | 发布时间（**毫秒级**时间戳） | `1704067200000` |
| `url` | string | `url` | 文章链接 | `"https://..."` |
| `source_name` | string | `source_name` / `source` | 来源名称 | `"CoinDesk"` |
| `source` | string | `source` | 来源（备用字段） | `"CoinDesk"` |

### 代码实现

```typescript
// src/clients/coinglass.client.ts

async getArticleList(params?: {
  start_time?: number;
  end_time?: number;
  limit?: number;
}): Promise<Array<{
  article_id?: string;
  article_title?: string;
  article_content?: string;
  article_release_time?: number;
  title?: string;
  content?: string;
  publish_time?: number;
  url?: string;
  source?: string;
  source_name?: string;
}>> {
  const requestParams: Record<string, any> = {};
  if (params?.start_time) requestParams.start_time = params.start_time;
  if (params?.end_time) requestParams.end_time = params.end_time;
  if (params?.limit) requestParams.limit = params.limit;

  const response = await this.request<any>('/api/article/list', requestParams);

  if (response && response.code === '0' && Array.isArray(response.data)) {
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
  }

  return [];
}
```

### 字段缺失处理

```typescript
// 如果 API 没有返回 article_id，生成唯一 ID
const articleId = article.article_id || `${articleTitle}-${articlePublishTime}`;

// 如果缺少必需字段，跳过该文章
if (!articleTitle || !articlePublishTime) {
  logger.debug({ article }, 'Article missing required fields (title or publish_time)');
  continue;
}
```

## 快讯字段映射

### API 端点
- **URL**: `/api/newsflash/list`
- **方法**: `GET`
- **文档**: https://docs.coinglass.com/v4.0-zh/reference/newsflash-list

### 请求参数

与新闻文章相同。

### 响应字段映射

| CoinGlass API 字段 | 类型 | 内部字段名 | 说明 | 示例值 |
|-------------------|------|-----------|------|--------|
| `newsflash_id` | string | `newsflash_id` / `id` | 快讯唯一标识符 | `"flash_123456"` |
| `newsflash_title` | string | `newsflash_title` / `title` | 快讯标题 | `"Breaking: Fed Raises Rates"` |
| `newsflash_content` | string | `newsflash_content` / `content` | 快讯内容 | `"The Federal Reserve..."` |
| `newsflash_release_time` | number | `newsflash_release_time` / `publish_time` | 发布时间（**毫秒级**时间戳） | `1704067200000` |
| `url` | string | `url` | 快讯链接 | `"https://..."` |
| `source_name` | string | `source_name` / `source` | 来源名称 | `"Reuters"` |

### 代码实现

```typescript
// src/clients/coinglass.client.ts

async getNewsflashList(params?: {
  start_time?: number;
  end_time?: number;
  limit?: number;
}): Promise<Array<{
  newsflash_id?: string;
  newsflash_title?: string;
  newsflash_content?: string;
  newsflash_release_time?: number;
  title?: string;
  content?: string;
  publish_time?: number;
  url?: string;
  source?: string;
  source_name?: string;
}>> {
  const requestParams: Record<string, any> = {};
  if (params?.start_time) requestParams.start_time = params.start_time;
  if (params?.end_time) requestParams.end_time = params.end_time;
  if (params?.limit) requestParams.limit = params.limit;

  const response = await this.request<any>('/api/newsflash/list', requestParams);

  if (response && response.code === '0' && Array.isArray(response.data)) {
    return response.data.map((item: any) => ({
      // 保留原始字段名
      newsflash_id: item.newsflash_id || item.id,
      newsflash_title: item.newsflash_title,
      newsflash_content: item.newsflash_content,
      newsflash_release_time: item.newsflash_release_time,
      
      // 映射到统一字段名
      title: item.newsflash_title || item.title,
      content: item.newsflash_content || item.content,
      publish_time: item.newsflash_release_time || item.publish_time,
      url: item.url,
      source: item.source_name || item.source,
      source_name: item.source_name,
    }));
  }

  return [];
}
```

## ETF 数据字段映射

### API 端点
- **URL**: `/api/etf/flow-history`
- **方法**: `GET`
- **文档**: https://docs.coinglass.com/v4.0-zh/reference/etf-flow-history

### 请求参数

| 参数名 | 类型 | 必填 | 说明 | 示例 |
|--------|------|------|------|------|
| `symbol` | string | 是 | 币种符号 | `"BTC"` / `"ETH"` / `"SOL"` / `"XRP"` |
| `start_time` | number | 否 | 开始时间（**毫秒级**时间戳） | `1704067200000` |
| `end_time` | number | 否 | 结束时间（**毫秒级**时间戳） | `1704153600000` |

### 响应字段映射

| CoinGlass API 字段 | 类型 | 内部字段名 | 说明 | 示例值 |
|-------------------|------|-----------|------|--------|
| `date` | string | `date` | 日期（YYYY-MM-DD） | `"2024-01-06"` |
| `netflow` | number | `netflow` | 净流入/流出（USD） | `211400000` |
| `inflow` | number | `inflow` | 流入量（USD） | `250000000` |
| `outflow` | number | `outflow` | 流出量（USD） | `38600000` |
| `total_assets` | number | `total_assets` | 总资产（USD） | `50000000000` |

## 合约数据字段映射

### API 端点
- **URL**: `/api/futures/pairs-markets`
- **方法**: `GET`

### 响应字段映射

| CoinGlass API 字段 | 类型 | 内部字段名 | 说明 | 示例值 |
|-------------------|------|-----------|------|--------|
| `open_interest_usd` | number | `open_interest_usd` / `oiUsd` | 未平仓合约（USD） | `1250000000` |
| `current_price` | number | `current_price` / `price` | 当前价格 | `45000` |
| `funding_rate` | number | `funding_rate` | 资金费率 | `0.0001` |
| `long_short_ratio` | number | `long_short_ratio` | 多空比 | `1.5` |
| `exchange_name` | string | `exchange_name` | 交易所名称 | `"Binance"` |
| `symbol` | string | `symbol` | 交易对符号 | `"BTC/USDT"` |

## 常见问题

### Q1: 时间戳格式不一致

**问题**: API 有时返回秒级时间戳，有时返回毫秒级时间戳。

**解决方案**:
```typescript
// 统一转换为毫秒级
const publishTime = item.publish_time_utc_ms || 
                   (item.publish_time_utc ? item.publish_time_utc * 1000 : Date.now());
```

### Q2: 字段名不一致

**问题**: API 返回的字段名可能与文档不一致。

**解决方案**:
```typescript
// 使用多个可能的字段名
const title = item.article_title || item.title || item.newsflash_title;
```

### Q3: 字段缺失

**问题**: 某些字段可能不存在。

**解决方案**:
```typescript
// 提供默认值或生成唯一 ID
const articleId = article.article_id || `${articleTitle}-${articlePublishTime}`;
```

## 测试建议

### 1. 打印原始响应

```typescript
logger.debug({ rawResponse: response.data }, 'Raw API response');
```

### 2. 验证字段映射

```typescript
// 确保所有必需字段都已映射
const requiredFields = ['id', 'title', 'publish_time'];
for (const field of requiredFields) {
  if (!mappedItem[field]) {
    logger.warn({ field, item }, 'Required field missing after mapping');
  }
}
```

### 3. 时间戳验证

```typescript
// 验证时间戳是否为毫秒级（13位数字）
const timestamp = item.publish_time_utc_ms;
if (timestamp && timestamp.toString().length !== 13) {
  logger.warn({ timestamp }, 'Timestamp may not be in milliseconds');
}
```
