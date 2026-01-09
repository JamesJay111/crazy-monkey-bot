# 疯狂的小猴子 - 多平台宏观新闻与合约数据推送系统

<div align="center">

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D20.0.0-brightgreen.svg)
![TypeScript](https://img.shields.io/badge/typescript-5.0+-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

一个基于 Node.js + TypeScript 的多平台推送系统，支持 Telegram Bot、Twitter 多账户、Lark Webhook，用于宏观新闻、ETF 资金流、合约数据的实时监控与推送。

[功能特性](#-功能特性) • [快速开始](#-快速开始) • [代码文档](#-代码文档) • [部署](#-部署) • [贡献](#-贡献)

</div>

---

## 📋 目录

- [项目简介](#-项目简介)
- [功能特性](#-功能特性)
- [宏观新闻推送详解](#-宏观新闻推送详解)
- [技术架构](#-技术架构)
- [快速开始](#-快速开始)
- [配置说明](#-配置说明)
- [使用指南](#-使用指南)
- [API 文档](#-api-文档)
- [代码文档](#-代码文档)
- [部署指南](#-部署指南)
- [项目结构](#-项目结构)
- [开发指南](#-开发指南)
- [故障排查](#-故障排查)
- [贡献指南](#-贡献指南)
- [许可证](#-许可证)

## 🎯 项目简介

**疯狂的小猴子** 是一个智能化的多平台数据推送系统，专注于加密货币市场的宏观新闻、ETF 资金流和合约数据监控。系统通过 CoinGlass API 获取实时数据，使用 DeepSeek AI 生成专业解读，并自动推送到 Telegram、Twitter 和 Lark Webhook 等多个平台。

### 核心价值

- 📊 **实时监控**: 每 10 分钟扫描一次宏观新闻，实时推送重要事件
- 🤖 **AI 解读**: 使用 DeepSeek AI 生成专业的市场影响分析
- 🌍 **多语言支持**: 自动生成中文、英文、韩语三种语言版本
- 📱 **多平台推送**: 支持 Telegram、Twitter（三账户）、Lark Webhook
- 🔄 **自动化运行**: 定时任务自动执行，无需人工干预
- 🏷️ **智能分类**: 自动将新闻分类为经济数据、财经事件、央行动态、新闻和快讯

## ✨ 功能特性

### 1. 宏观新闻推送

#### 1.1 Webhook 实时推送
- **推送频率**: 每 10 分钟扫描一次
- **数据源**: CoinGlass API（经济数据、财经事件、央行动态、新闻文章、快讯）
- **推送方式**: 分开发送三条消息（中文/英文/韩语各一条）
- **AI 解读**: 使用 DeepSeek 生成加密货币宏观市场影响解读
- **智能分类**: 自动分类为 [经济数据]、[财经事件]、[央行动态]、[新闻和快讯]
- **代码实现**: [`src/services/macroNewsWebhookPush.service.ts`](src/services/macroNewsWebhookPush.service.ts)

#### 1.2 Twitter 多账户推送
- **推送频率**: 每 2 小时扫描一次
- **推送账户**: 
  - 账户 A (@CrazyMonkeyPerp) - 中文
  - 账户 B (@CrazyMonkeyPerpEN) - 英文
  - 账户 C (@CrazyMonkeyPerpKR) - 韩语
- **功能**: 自动生成多语言推文并分别推送到对应账户
- **代码实现**: [`src/services/macroNewsPush.service.ts`](src/services/macroNewsPush.service.ts)

#### 1.3 宏观事件推送
- **推送频率**: 每 2 小时扫描一次
- **支持国家**: 美国、中国、俄罗斯、英国、南美洲等
- **功能**: 自动识别重要宏观事件并推送到 Twitter 三账户
- **代码实现**: [`src/services/macroUsTweetJob.service.ts`](src/services/macroUsTweetJob.service.ts)

### 2. ETF 资金流推送

#### 2.1 Twitter 多账户推送
- **推送频率**: 每天北京时间 15:00
- **数据范围**: 前一天（UTC+0）全天数据
- **支持币种**: BTC、ETH、SOL、XRP
- **推送格式**: 
  ```
  📊 ETF流入流出（2024/01/06）

  BTC 现货 ETF: +211.4M
  XRP现货 ETF: -35.2M
  ETH现货 ETF: +125.8M
  SOL现货ETF: +89.3M
  ```
- **推送账户**: 三账户分别推送对应语言版本
- **代码实现**: [`src/services/etfTwitterPush.service.ts`](src/services/etfTwitterPush.service.ts)

#### 2.2 Telegram Bot 查询
- **命令**: `/etf`
- **功能**: 查询 BTC/ETH/SOL/XRP 的 24 小时净流入/流出
- **高级功能**: 查看过去 30 天历史数据（需解锁）

### 3. 合约数据推送

#### 3.1 OI 异动实时推送
- **推送渠道**: Telegram、Lark Webhook、Twitter 三账户
- **触发条件**: 4 小时或 24 小时 OI 变化超过阈值
- **AI 解读**: 使用 DeepSeek 生成市场解读
- **推送格式**: 
  ```
  🟢 BTC 4小时币安未平仓合约变化 +12.50%，价格过去4小时变化 +2.30%，未平仓合约：1250.5M 美元，24小时价格变化：+5.20%

  解读：OI 大幅上升伴随价格上涨，市场情绪偏多，需关注后续资金流向变化
  ```

#### 3.2 Twitter 自动推送
- **推送频率**: 实时（检测到符合条件的 OI 增长）
- **推送账户**: 三账户多语言推送
- **功能**: 自动识别 OI 异动并生成推文

### 4. 其他功能

#### 4.1 庄家轧空/多空挤压分析
- **命令**: `/squeeze`
- **功能**: 扫描过去 30 天内可能出现过轧空结构的 Ticker
- **分析内容**: 详细的轧空结构分析（需解锁）

#### 4.2 资金费率异常扫描
- **命令**: `/fr`
- **功能**: 显示正/负资金费率最高 Top 10
- **筛选条件**: 市值前 5000，剔除极低流动性项目

#### 4.3 合约查询
- **命令**: `/contract <symbol>`
- **功能**: 查询指定 Ticker 的合约数据
- **返回内容**: OI、资金费率、多空比、基差等（需解锁）
- **AI 分析**: 自动生成当前合约状态分析

## 📰 宏观新闻推送详解

### 核心逻辑

宏观新闻推送系统采用**不区分国家和地区**的设计，自动从 CoinGlass API 获取所有类型的新闻，并智能分类为以下四种类型：

1. **[经济数据]** 📊 - 来自 `/api/calendar/economic-data` 端点
2. **[财经事件]** 💼 - 来自 `/api/calendar/financial-events` 端点
3. **[央行动态]** 🏦 - 来自 `/api/calendar/central-bank-activities` 端点
4. **[新闻和快讯]** 📰 - 来自 `/api/article/list` 和 `/api/newsflash/list` 端点

### 实现流程

#### 步骤 1: 数据获取

系统每 10 分钟扫描一次 CoinGlass API，获取过去 24 小时内的所有新闻：

```typescript
// 代码位置: src/services/macroNewsWebhookPush.service.ts
// 获取所有类型的新闻
const macroEvents = await this.coinglass.getMacroEvents({
  start_time: startTime,  // 毫秒级时间戳
  end_time: endTime,     // 毫秒级时间戳
});

const articles = await this.coinglass.getArticleList({
  start_time: startTime,
  end_time: endTime,
  limit: 100,
});

const newsflashes = await this.coinglass.getNewsflashList({
  start_time: startTime,
  end_time: endTime,
  limit: 100,
});
```

**代码链接**: [`src/services/macroNewsWebhookPush.service.ts`](src/services/macroNewsWebhookPush.service.ts#L168-L220)

#### 步骤 2: 智能分类

系统根据数据来源自动分类，无需手动判断国家或地区：

```typescript
// 代码位置: src/services/macroNewsWebhookPush.service.ts
// 经济数据、财经事件、央行动态来自 getMacroEvents
for (const event of macroEvents) {
  let type: NewsType = 'economic-data';  // 默认分类
  
  // 根据事件名称判断类型
  if (event.calendar_name?.toLowerCase().includes('central bank') || 
      event.calendar_name?.toLowerCase().includes('央行')) {
    type = 'central-bank';
  } else if (event.calendar_name?.toLowerCase().includes('financial') ||
             event.calendar_name?.toLowerCase().includes('财经')) {
    type = 'financial-events';
  } else {
    type = 'economic-data';
  }
  
  allNews.push({
    id: `event-${event.event_id}`,
    type,  // 分类类型
    title: event.calendar_name,
    publishTime: event.publish_timestamp,
    // 不区分国家，所有新闻都推送
  });
}

// 新闻文章分类为 'article'
for (const article of articles) {
  allNews.push({
    id: `article-${article.article_id}`,
    type: 'article',  // [新闻和快讯]
    title: article.article_title,
    // ...
  });
}

// 快讯分类为 'newsflash'
for (const newsflash of newsflashes) {
  allNews.push({
    id: `newsflash-${newsflash.newsflash_id}`,
    type: 'newsflash',  // [新闻和快讯]
    title: newsflash.newsflash_title,
    // ...
  });
}
```

**代码链接**: [`src/services/macroNewsWebhookPush.service.ts`](src/services/macroNewsWebhookPush.service.ts#L182-L250)

#### 步骤 3: 去重处理

系统使用数据库记录已推送的新闻，避免重复推送：

```typescript
// 代码位置: src/services/macroNewsWebhookPush.service.ts
// 检查新闻是否已推送
const stmt = this.db.prepare(`
  SELECT news_id FROM macro_news_webhook_push_log
  WHERE news_id = ?
`);

const newNews: NewsItem[] = [];
for (const news of allNews) {
  const existing = stmt.get(news.id);
  if (!existing) {
    newNews.push(news);  // 只推送新新闻
  }
}
```

**代码链接**: [`src/services/macroNewsWebhookPush.service.ts`](src/services/macroNewsWebhookPush.service.ts#L252-L270)

#### 步骤 4: AI 解读生成

对每条新新闻，系统调用 DeepSeek API 生成专业的市场影响分析：

```typescript
// 代码位置: src/services/macroNewsWebhookPush.service.ts
const systemPrompt = `你是一名专业的加密货币宏观市场分析师。你的任务是根据宏观新闻，分析其对加密货币市场的影响。

要求：
1. 生成一段 30-50 字的解读，说明该新闻对加密货币宏观市场的影响
2. 提供一段 50-100 字的背景信息，解释该新闻的背景和重要性
3. 分析要客观、专业，不要过度解读
4. 重点关注对 BTC、ETH 等主流加密货币的潜在影响`;

const analysis = await this.deepseek.analyzeWithPrompt(
  systemPrompt,
  userPrompt,
  { temperature: 0.7, maxTokens: 500 }
);
```

**代码链接**: [`src/services/macroNewsWebhookPush.service.ts`](src/services/macroNewsWebhookPush.service.ts#L350-L400)

#### 步骤 5: 多语言消息构建

系统为每条新闻生成三种语言版本的消息：

```typescript
// 代码位置: src/services/macroNewsWebhookPush.service.ts
const NEWS_TYPE_LABELS = {
  'economic-data': { zh: '[经济数据]', en: '[Economic Data]', ko: '[경제 데이터]' },
  'financial-events': { zh: '[财经事件]', en: '[Financial Events]', ko: '[금융 이벤트]' },
  'central-bank': { zh: '[央行动态]', en: '[Central Bank]', ko: '[중앙은행]' },
  'article': { zh: '[新闻和快讯]', en: '[News]', ko: '[뉴스]' },
  'newsflash': { zh: '[新闻和快讯]', en: '[News Flash]', ko: '[속보]' },
};

const NEWS_TYPE_ICONS = {
  'economic-data': '📊',
  'financial-events': '💼',
  'central-bank': '🏦',
  'article': '📰',
  'newsflash': '⚡',
};

// 构建消息
let message = `${icon} ${label}\n\n`;
message += `📰 ${news.title}\n`;
message += `⏰ ${publishTime}\n`;
message += `\n💡 解读：${analysis.interpretation}\n\n`;
message += `📚 背景：${analysis.background}`;
```

**代码链接**: [`src/services/macroNewsWebhookPush.service.ts`](src/services/macroNewsWebhookPush.service.ts#L32-L46) 和 [`src/services/macroNewsWebhookPush.service.ts`](src/services/macroNewsWebhookPush.service.ts#L402-L450)

#### 步骤 6: 分语言推送

系统分开发送三条消息到 Webhook，每条消息独立发送：

```typescript
// 代码位置: src/services/macroNewsWebhookPush.service.ts
// 1. 发送中文版本
await this.sendToWebhook(`🇨🇳 中文版本\n\n${zhMessage}`);
await this.sleep(1000);

// 2. 发送英文版本
await this.sendToWebhook(`🇺🇸 英文版本\n\n${enMessage}`);
await this.sleep(1000);

// 3. 发送韩语版本
await this.sendToWebhook(`🇰🇷 韩语版本\n\n${koMessage}`);
```

**代码链接**: [`src/services/macroNewsWebhookPush.service.ts`](src/services/macroNewsWebhookPush.service.ts#L452-L500)

### 推送展示 (Showcase)

#### 示例 1: 经济数据推送

**中文版本**:
```
🇨🇳 中文版本

📊 [经济数据]

📰 美国非农就业数据 (Non-Farm Payrolls)
⏰ 2024-01-06 20:30

💡 解读：非农就业数据超预期，可能引发市场对美联储加息预期的重新评估，短期内可能对加密货币市场造成波动。

📚 背景：非农就业数据是衡量美国劳动力市场健康状况的重要指标，直接影响美联储的货币政策决策，进而影响全球金融市场和加密货币市场。
```

**英文版本**:
```
🇺🇸 英文版本

📊 [Economic Data]

📰 US Non-Farm Payrolls
⏰ 2024-01-06 20:30

💡 Interpretation: Non-farm payrolls exceeded expectations, which may trigger a reassessment of market expectations for Fed rate hikes, potentially causing short-term volatility in the cryptocurrency market.

📚 Background: Non-farm payrolls is an important indicator of the health of the US labor market, directly affecting the Fed's monetary policy decisions, which in turn affects global financial markets and the cryptocurrency market.
```

**韩语版本**:
```
🇰🇷 韩语版本

📊 [경제 데이터]

📰 미국 비농업 고용 지표 (Non-Farm Payrolls)
⏰ 2024-01-06 20:30

💡 해석: 비농업 고용 지표가 예상을 초과하여 연준의 금리 인상 기대에 대한 시장의 재평가를 유발할 수 있으며, 단기적으로 암호화폐 시장에 변동성을 일으킬 수 있습니다.

📚 배경: 비농업 고용 지표는 미국 노동 시장의 건강 상태를 측정하는 중요한 지표로, 연준의 통화 정책 결정에 직접적인 영향을 미치며, 이는 전 세계 금융 시장과 암호화폐 시장에 영향을 줍니다.
```

#### 示例 2: 央行动态推送

**中文版本**:
```
🇨🇳 中文版本

🏦 [央行动态]

📰 美联储利率决议 (FOMC Meeting)
⏰ 2024-01-06 02:00

💡 解读：美联储维持利率不变，但暗示未来可能降息，这可能会提振风险资产，包括加密货币市场。

📚 背景：美联储利率决议是影响全球金融市场最重要的政策决定之一，其政策立场直接影响美元走势和全球流动性，进而影响加密货币等风险资产的表现。
```

#### 示例 3: 新闻和快讯推送

**中文版本**:
```
🇨🇳 中文版本

📰 [新闻和快讯]

📰 比特币现货 ETF 获得 SEC 批准
⏰ 2024-01-06 15:00
📌 来源：CoinDesk

💡 解读：比特币现货 ETF 获批是加密货币市场的重大里程碑，预计将吸引大量机构资金流入，长期利好 BTC 价格。

📚 背景：比特币现货 ETF 的批准意味着传统金融机构可以更方便地投资比特币，这将为加密货币市场带来更多的流动性和合法性认可。
```

### CoinGlass API 字段映射

系统使用 CoinGlass API v4.0 获取数据，关键字段映射如下：

| CoinGlass API 字段 | 内部字段名 | 说明 |
|-------------------|-----------|------|
| `event_id` | `id` | 事件唯一标识符 |
| `event_name` | `title` | 事件名称 |
| `publish_time_utc_ms` | `publishTime` | 发布时间（毫秒级时间戳） |
| `article_id` | `id` | 文章唯一标识符 |
| `article_title` | `title` | 文章标题 |
| `article_release_time` | `publishTime` | 发布时间（毫秒级时间戳） |
| `newsflash_id` | `id` | 快讯唯一标识符 |
| `newsflash_title` | `title` | 快讯标题 |
| `newsflash_release_time` | `publishTime` | 发布时间（毫秒级时间戳） |

**详细字段映射**: 参见 [`src/clients/coinglass.client.ts`](src/clients/coinglass.client.ts) 中的注释

### 关键代码文件

- **Webhook 推送服务**: [`src/services/macroNewsWebhookPush.service.ts`](src/services/macroNewsWebhookPush.service.ts)
- **Twitter 推送服务**: [`src/services/macroNewsPush.service.ts`](src/services/macroNewsPush.service.ts)
- **CoinGlass API 客户端**: [`src/clients/coinglass.client.ts`](src/clients/coinglass.client.ts)
- **DeepSeek API 客户端**: [`src/clients/deepseek.client.ts`](src/clients/deepseek.client.ts)

## 🏗️ 技术架构

### 核心技术栈

- **运行时**: Node.js 20+
- **语言**: TypeScript 5.0+
- **Bot 框架**: Grammy (Telegram Bot)
- **数据源**: CoinGlass API v4.0
- **AI 分析**: DeepSeek API
- **数据库**: SQLite (better-sqlite3)
- **日志**: Pino
- **HTTP 客户端**: Axios
- **定时任务**: node-cron

### 架构图

```
┌─────────────────┐
│  CoinGlass API  │
│   (数据源)      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ CoinGlassClient │
│  (API 封装)     │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────┐
│      Service Layer              │
│  ┌──────────────────────────┐  │
│  │ MacroNewsWebhookPush     │  │
│  │ MacroNewsPush            │  │
│  │ ETFTwitterPush           │  │
│  │ OIAlertOrchestrator      │  │
│  └──────────────────────────┘  │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────┐
│  DeepSeek API   │
│   (AI 解读)     │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────┐
│      Push Layer                 │
│  ┌──────┐  ┌──────┐  ┌──────┐ │
│  │Telegram│ │Twitter│ │Webhook│ │
│  └──────┘  └──────┘  └──────┘ │
└─────────────────────────────────┘
```

## 🚀 快速开始

### 环境要求

- Node.js >= 20.0.0
- npm >= 9.0.0
- SQLite 3.x

### 安装步骤

1. **克隆仓库**

```bash
git clone https://github.com/your-username/crazy-monkey-bot.git
cd crazy-monkey-bot
```

2. **安装依赖**

```bash
npm install
```

3. **配置环境变量**

复制 `.env.example` 并创建 `.env` 文件：

```bash
cp .env.example .env
```

编辑 `.env` 文件，填入以下配置：

```env
# Telegram Bot
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here

# CoinGlass API
COINGLASS_API_KEY=your_coinglass_api_key_here

# DeepSeek API
DEEPSEEK_API_KEY=your_deepseek_api_key_here

# 数据库路径
DB_PATH=./db/bot.db

# Twitter OAuth 1.0a 配置（多账户）
TWITTER_ACCOUNT_A_CONSUMER_KEY=your_consumer_key_a
TWITTER_ACCOUNT_A_CONSUMER_SECRET=your_consumer_secret_a
TWITTER_ACCOUNT_A_ACCESS_TOKEN=your_access_token_a
TWITTER_ACCOUNT_A_ACCESS_TOKEN_SECRET=your_access_token_secret_a

TWITTER_ACCOUNT_B_CONSUMER_KEY=your_consumer_key_b
TWITTER_ACCOUNT_B_CONSUMER_SECRET=your_consumer_secret_b
TWITTER_ACCOUNT_B_ACCESS_TOKEN=your_access_token_b
TWITTER_ACCOUNT_B_ACCESS_TOKEN_SECRET=your_access_token_secret_b

TWITTER_ACCOUNT_C_CONSUMER_KEY=your_consumer_key_c
TWITTER_ACCOUNT_C_CONSUMER_SECRET=your_consumer_secret_c
TWITTER_ACCOUNT_C_ACCESS_TOKEN=your_access_token_c
TWITTER_ACCOUNT_C_ACCESS_TOKEN_SECRET=your_access_token_secret_c

# Lark Webhook URLs
LARK_WEBHOOK_URL=your_lark_webhook_url_here
LARK_WEBHOOK_UNIFIED=your_unified_webhook_url_here
LARK_WEBHOOK_MACRO_NEWS=https://open.larksuite.com/open-apis/bot/v2/hook/your_webhook_id
```

4. **初始化数据库**

数据库会在首次启动时自动创建。如果需要手动初始化：

```bash
npm run build
node dist/src/db/init.js
```

5. **启动服务**

开发模式：

```bash
npm run dev
```

生产模式：

```bash
npm run build
npm start
```

## ⚙️ 配置说明

### 必需配置

| 配置项 | 说明 | 获取方式 |
|--------|------|----------|
| `TELEGRAM_BOT_TOKEN` | Telegram Bot Token | [BotFather](https://t.me/botfather) |
| `COINGLASS_API_KEY` | CoinGlass API Key | [CoinGlass](https://www.coinglass.com/) |
| `DEEPSEEK_API_KEY` | DeepSeek API Key | [DeepSeek](https://platform.deepseek.com/) |

### Twitter 配置

需要为每个账户配置 OAuth 1.0a 凭证：

1. 在 [Twitter Developer Portal](https://developer.twitter.com/) 创建应用
2. 获取 Consumer Key 和 Consumer Secret
3. 生成 Access Token 和 Access Token Secret
4. 配置到对应的环境变量

### Webhook 配置

#### Lark Webhook

1. 在 Lark 开放平台创建机器人
2. 获取 Webhook URL
3. 配置到 `LARK_WEBHOOK_URL` 环境变量

## 📖 使用指南

### Telegram Bot 命令

| 命令 | 说明 | 示例 |
|------|------|------|
| `/start` | 开始使用 Bot | `/start` |
| `/etf` | 查询 ETF 资金流 | `/etf` |
| `/contract <symbol>` | 查询合约数据 | `/contract BTC` |
| `/squeeze` | 庄家轧空分析 | `/squeeze` |
| `/fr` | 资金费率扫描 | `/fr` |
| `/help` | 帮助信息 | `/help` |

### 自动推送

系统会自动执行以下定时任务：

- **宏观新闻 Webhook 推送**: 每 10 分钟
- **宏观新闻 Twitter 推送**: 每 2 小时
- **ETF Twitter 推送**: 每天北京时间 15:00
- **OI 异动推送**: 实时（检测到异动时）

## 📚 API 文档

### CoinGlass API v4.0

所有数据必须来自 CoinGlass API v4.0，包括：
- 合约价格、Open Interest (OI)、OI 变化量
- 资金费率、多空比
- ETF 资金流
- 宏观新闻（经济数据、财经事件、央行动态、新闻文章、快讯）
- 历史 OHLC 数据

**Base URL**: `https://open-api-v4.coinglass.com`

**重要原则**：
- 不做"拍脑袋判断"
- 所有数值必须可追溯到 CoinGlass 返回结果
- 若 CoinGlass 无数据 → 明确告知用户"数据不可用"
- **时间戳格式**: API v4.0 要求使用**毫秒级**时间戳（13位数字）

**API 客户端实现**: [`src/clients/coinglass.client.ts`](src/clients/coinglass.client.ts)

### DeepSeek API

DeepSeek 只用于：
- 将 CoinGlass 返回的结构化数据转换为可读的交易行为解释
- 对"是否构成轧空/多空挤压"给出结构性判断
- 对单个 Ticker 给出总结型分析文本
- **宏观新闻解读**: 生成加密货币宏观市场影响分析

**DeepSeek 不负责**：
- 拉取价格
- 计算 OI
- 判断 ETF 净流入数值
- 编造数据

**API 客户端实现**: [`src/clients/deepseek.client.ts`](src/clients/deepseek.client.ts)

## 📝 代码文档

### 核心服务

#### 宏观新闻推送服务

- **Webhook 推送**: [`src/services/macroNewsWebhookPush.service.ts`](src/services/macroNewsWebhookPush.service.ts)
  - 数据获取逻辑: [L168-L220](src/services/macroNewsWebhookPush.service.ts#L168-L220)
  - 分类逻辑: [L182-L250](src/services/macroNewsWebhookPush.service.ts#L182-L250)
  - 去重处理: [L252-L270](src/services/macroNewsWebhookPush.service.ts#L252-L270)
  - AI 解读生成: [L350-L400](src/services/macroNewsWebhookPush.service.ts#L350-L400)
  - 消息构建: [L402-L450](src/services/macroNewsWebhookPush.service.ts#L402-L450)
  - 推送逻辑: [L452-L500](src/services/macroNewsWebhookPush.service.ts#L452-L500)

- **Twitter 推送**: [`src/services/macroNewsPush.service.ts`](src/services/macroNewsPush.service.ts)

#### ETF 推送服务

- **ETF Twitter 推送**: [`src/services/etfTwitterPush.service.ts`](src/services/etfTwitterPush.service.ts)

#### CoinGlass API 客户端

- **API 客户端**: [`src/clients/coinglass.client.ts`](src/clients/coinglass.client.ts)
  - 宏观事件获取: [`getMacroEvents()`](src/clients/coinglass.client.ts)
  - 文章列表获取: [`getArticleList()`](src/clients/coinglass.client.ts)
  - 快讯列表获取: [`getNewsflashList()`](src/clients/coinglass.client.ts)

#### DeepSeek API 客户端

- **AI 客户端**: [`src/clients/deepseek.client.ts`](src/clients/deepseek.client.ts)

### 数据库结构

- **数据库初始化**: [`db/init.sql`](db/init.sql)
- **宏观新闻推送日志表**: `macro_news_webhook_push_log`

## 🚢 部署指南

### 使用 PM2（推荐）

```bash
# 安装 PM2
npm install -g pm2

# 启动服务
pm2 start dist/src/bot/index.js --name macro-news-bot

# 保存配置
pm2 save

# 设置开机自启
pm2 startup
```

### 使用 Docker

创建 `Dockerfile`:

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY dist ./dist
COPY db ./db

ENV NODE_ENV=production

CMD ["node", "dist/src/bot/index.js"]
```

构建和运行：

```bash
docker build -t macro-news-bot .
docker run -d --name macro-news-bot --env-file .env macro-news-bot
```

## 📁 项目结构

```
.
├── src/
│   ├── bot/
│   │   └── index.ts              # Bot 主入口
│   ├── clients/
│   │   ├── coinglass.client.ts   # CoinGlass API 客户端
│   │   └── deepseek.client.ts    # DeepSeek API 客户端
│   ├── services/
│   │   ├── macroNewsWebhookPush.service.ts    # 宏观新闻 Webhook 推送
│   │   ├── macroNewsPush.service.ts           # 宏观新闻 Twitter 推送
│   │   ├── macroUsTweetJob.service.ts         # 宏观事件 Twitter 推送
│   │   ├── etfTwitterPush.service.ts          # ETF Twitter 推送
│   │   ├── oiAlert/                           # OI 异动推送
│   │   └── ...                                # 其他服务
│   ├── routes/                                # Telegram Bot 路由
│   ├── utils/                                 # 工具函数
│   ├── db/                                    # 数据库初始化
│   └── types/                                 # 类型定义
├── db/
│   └── init.sql                               # 数据库初始化 SQL
├── package.json
├── tsconfig.json
└── README.md
```

## 💻 开发指南

### 开发环境设置

1. **克隆仓库**

```bash
git clone https://github.com/your-username/crazy-monkey-bot.git
cd crazy-monkey-bot
```

2. **安装依赖**

```bash
npm install
```

3. **配置环境变量**

创建 `.env` 文件并配置必要的环境变量。

4. **启动开发服务器**

```bash
npm run dev
```

### 代码规范

- 使用 TypeScript 编写所有代码
- 遵循 ESLint 规则
- 使用 Prettier 格式化代码
- 提交前运行 `npm run lint` 检查代码

### 添加新功能

1. 在 `src/services/` 目录创建新的服务
2. 在 `src/routes/` 目录创建新的路由（如需要）
3. 在 `src/bot/index.ts` 中注册服务/路由
4. 更新文档

## 🔧 故障排查

### 常见问题

#### 1. 服务无法启动

**症状**: 服务启动后立即退出

**解决方案**:
1. 检查环境变量是否配置完整
2. 检查数据库文件权限
3. 查看错误日志：`tail -f logs/app.log`

#### 2. API 调用失败

**症状**: 日志中出现 API 调用错误

**解决方案**:
1. 检查 API Key 是否正确
2. 检查网络连接
3. 检查 API 配额是否用完

#### 3. Twitter 推送失败

**症状**: Twitter 推送返回错误

**解决方案**:
1. 检查 OAuth 1.0a 配置是否正确
2. 检查 Twitter API 配额
3. 检查推文内容是否符合 Twitter 规则

#### 4. Webhook 推送失败

**症状**: Webhook 没有收到消息

**解决方案**:
1. 检查 Webhook URL 是否正确
2. 检查网络连接
3. 查看 Webhook 推送日志

### 日志查看

```bash
# 查看应用日志
tail -f logs/app.log

# 查看错误日志
tail -f logs/error.log

# 查看特定服务的日志
grep "macroNews" logs/app.log
```

## 🤝 贡献指南

我们欢迎所有形式的贡献！

### 贡献方式

1. **报告 Bug**: 在 [Issues](https://github.com/your-username/crazy-monkey-bot/issues) 中报告问题
2. **提出功能建议**: 在 [Issues](https://github.com/your-username/crazy-monkey-bot/issues) 中提出新功能建议
3. **提交代码**: Fork 仓库，创建功能分支，提交 Pull Request

### 贡献流程

1. Fork 仓库
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

### 代码规范

- 遵循现有的代码风格
- 添加必要的注释
- 更新相关文档
- 确保所有测试通过

## 📄 许可证

本项目采用 MIT 许可证。详情请参阅 [LICENSE](LICENSE) 文件。

## 🙏 致谢

- [CoinGlass](https://www.coinglass.com/) - 数据源
- [DeepSeek](https://platform.deepseek.com/) - AI 分析
- [Grammy](https://grammy.dev/) - Telegram Bot 框架
- [TypeScript](https://www.typescriptlang.org/) - 编程语言

## 📞 联系方式

如有问题或建议，请通过以下方式联系：

- 提交 [Issue](https://github.com/your-username/crazy-monkey-bot/issues)
- 发送邮件至: nyt1154869180@gmail.com

## ⚠️ 免责声明

本 Bot 不预测价格，也不提供交易建议。所有分析仅供参考，投资有风险，请谨慎决策。

---

<div align="center">

**如果这个项目对你有帮助，请给一个 ⭐ Star！**

Made with ❤️ by Ocean

</div>
