# 疯狂的小猴子 - 多平台宏观新闻与合约数据推送系统

一个基于 Node.js + TypeScript 的多平台推送系统，支持 Telegram Bot、Twitter 多账户、Lark Webhook，用于宏观新闻、ETF 资金流、合约数据的实时监控与推送。

## 核心定位

这是一个**合约行为感知工具**，而不是预测工具。

核心价值：通过 OI、资金费率、基差、多空比等指标，判断"市场结构是否正在发生变化"。

## 技术架构

- **运行时**: Node.js 20+
- **语言**: TypeScript
- **Bot 框架**: Grammy
- **数据源**: CoinGlass API v4.0 - 唯一数据源
- **AI 分析**: DeepSeek API - 仅用于数据解释和结构判断
- **数据库**: SQLite (better-sqlite3)
- **日志**: Pino
- **HTTP 客户端**: Axios

## 项目结构

```
.
├── src/
│   ├── bot/
│   │   └── index.ts              # Bot 主入口
│   ├── clients/
│   │   ├── coinglass.client.ts   # CoinGlass v4 API 客户端
│   │   └── deepseek.client.ts   # DeepSeek API 客户端
│   ├── services/
│   │   ├── squeeze.service.ts    # 轧空分析服务
│   │   ├── etf.service.ts        # ETF 资金流服务
│   │   ├── funding.service.ts   # 资金费率扫描服务
│   │   └── contract.service.ts  # 合约查询服务
│   ├── routes/
│   │   ├── start.ts              # /start 命令
│   │   ├── help.ts               # /help 命令
│   │   ├── squeeze.ts            # /squeeze 命令
│   │   ├── etf.ts                # /etf 命令
│   │   ├── funding.ts            # /fr 命令
│   │   ├── contract.ts           # /contract 命令
│   │   ├── pay.ts                # /pay 命令
│   │   └── code.ts               # /code 命令
│   ├── repositories/
│   │   └── user.repository.ts    # 用户数据仓库
│   ├── guards/
│   │   └── entitlement.guard.ts # 权限守卫
│   ├── prompts/
│   │   ├── squeeze.prompt.ts    # 轧空分析 Prompt
│   │   └── contract.prompt.ts   # 合约分析 Prompt
│   ├── utils/
│   │   ├── logger.ts             # 日志工具
│   │   ├── formatter.ts          # 格式化工具
│   │   └── validator.ts          # 验证工具
│   ├── db/
│   │   └── init.ts               # 数据库初始化
│   └── types/
│       └── index.ts              # 类型定义
├── db/
│   └── init.sql                  # 数据库初始化 SQL
├── package.json
├── tsconfig.json
└── README.md
```

## 功能模块

### 1. 宏观新闻推送

#### 1.1 Webhook 实时推送 (`MacroNewsWebhookPushService`)
- **推送频率**: 每 10 分钟扫描一次
- **数据源**: CoinGlass API（经济数据、财经事件、央行动态、新闻文章、快讯）
- **推送方式**: 分开发送三条消息（中文/英文/韩语各一条）
- **AI 解读**: 使用 DeepSeek 生成加密货币宏观市场影响解读
- **详细文档**: [docs/MACRO_NEWS_IMPLEMENTATION.md](docs/MACRO_NEWS_IMPLEMENTATION.md)

#### 1.2 Twitter 多账户推送 (`MacroNewsPushService`)
- **推送频率**: 每 2 小时扫描一次
- **推送账户**: 
  - 账户 A (@CrazyMonkeyPerp) - 中文
  - 账户 B (@CrazyMonkeyPerpEN) - 英文
  - 账户 C (@CrazyMonkeyPerpKR) - 韩语
- **详细文档**: [docs/MACRO_NEWS_IMPLEMENTATION.md](docs/MACRO_NEWS_IMPLEMENTATION.md)

#### 1.3 宏观事件推送 (`MacroUsTweetJobService`)
- **推送频率**: 每 2 小时扫描一次
- **支持国家**: 美国、中国、俄罗斯、英国、南美洲等
- **推送方式**: Twitter 三账户多语言推送
- **详细文档**: [docs/MACRO_NEWS_IMPLEMENTATION.md](docs/MACRO_NEWS_IMPLEMENTATION.md)

### 2. ETF 资金流推送

#### 2.1 Twitter 多账户推送 (`ETFTwitterPushService`)
- **推送频率**: 每天北京时间 15:00
- **数据范围**: 前一天（UTC+0）全天数据
- **支持币种**: BTC、ETH、SOL、XRP
- **推送账户**: 三账户分别推送对应语言版本
- **详细文档**: [docs/ETF_IMPLEMENTATION.md](docs/ETF_IMPLEMENTATION.md)

#### 2.2 Telegram Bot 查询 (`/etf`)
- 支持 BTC / ETH / SOL / XRP
- 显示 24 小时净流入/流出
- 查看过去 30 天历史数据（需解锁）

### 3. 合约数据推送

#### 3.1 OI 异动实时推送 (`OIAlertOrchestrator`)
- **推送渠道**: Telegram、Lark Webhook、Twitter 三账户
- **触发条件**: 4 小时或 24 小时 OI 变化超过阈值
- **AI 解读**: 使用 DeepSeek 生成市场解读
- **详细文档**: [docs/OI_ALERT_IMPLEMENTATION.md](docs/OI_ALERT_IMPLEMENTATION.md)

#### 3.2 Twitter 自动推送 (`XAutoTweetJobService`)
- **推送频率**: 实时（检测到符合条件的 OI 增长）
- **推送账户**: 三账户多语言推送
- **详细文档**: [docs/TWITTER_AUTO_TWEET_IMPLEMENTATION.md](docs/TWITTER_AUTO_TWEET_IMPLEMENTATION.md)

### 4. 其他功能

#### 4.1 庄家轧空/多空挤压 (`/squeeze`)
- 扫描过去 30 天内可能出现过轧空结构的 Ticker
- 提供详细的轧空结构分析（需解锁）
- 检测当前市场是否存在类似结构

#### 4.2 资金费率异常扫描 (`/fr`)
- 正资金费率最高 Top 10
- 负资金费率最高 Top 10
- 筛选条件：市值前 5000，剔除极低流动性项目

#### 4.3 查询指定 Ticker 合约 (`/contract`)
- 输入 Ticker 符号查询
- 返回：OI、资金费率、多空比、基差等（需解锁）
- AI 分析当前合约状态

## 安装与配置

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制 `.env.example` 并创建 `.env` 文件：

```bash
cp .env.example .env
```

编辑 `.env` 文件，填入以下配置：

```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here
DEEPSEEK_API_KEY=your_deepseek_api_key_here
COINGLASS_API_KEY=your_coinglass_api_key_here
DB_PATH=./db/bot.db
```

### 3. 初始化数据库

数据库会在首次启动时自动创建。

### 4. 编译 TypeScript

```bash
npm run build
```

### 5. 启动 Bot

```bash
npm start
```

或开发模式：

```bash
npm run dev
```

## Bot 命令列表

在 Telegram 中，Bot 支持以下命令：

- `/start` - 开始使用
- `/squeeze` - 庄家轧空/多空挤压
- `/etf` - ETF 流入流出
- `/fr` - 资金费率扫描
- `/contract` - 合约查询
- `/pay` - 付费说明
- `/code` - 输入邀请码
- `/help` - 帮助信息

## 付费与解锁

### 解锁方式

1. **Telegram Stars**: 支付 2999 Stars（终身解锁）
2. **邀请码**: 输入 `Ocean001` 免费体验

### 需要解锁的功能

- 轧空结构详细分析
- ETF 历史数据（30天）
- Ticker 详细查询（OI、资金费率、多空比等）
- AI 分析

## API 集成说明

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

**字段映射文档**: [docs/COINGLASS_FIELD_MAPPING.md](docs/COINGLASS_FIELD_MAPPING.md)

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

## 开发说明

### 状态管理

用户状态使用 SQLite 数据库持久化存储。

### 错误处理

所有 API 调用都包含错误处理，会向用户返回友好的错误信息。

### 扩展功能

要添加新功能：
1. 在 `services/` 目录创建新的服务
2. 在 `routes/` 目录创建新的路由
3. 在 `bot/index.ts` 中注册路由
4. 如需付费，使用 `EntitlementGuard` 检查解锁状态

## 详细文档

### 核心模块文档

- **[宏观新闻推送实现文档](docs/MACRO_NEWS_IMPLEMENTATION.md)** - 详细的宏观新闻推送模块实现说明，包括 CoinGlass API 字段映射、服务实现步骤、错误处理等
- **[CoinGlass 字段映射文档](docs/COINGLASS_FIELD_MAPPING.md)** - 完整的 CoinGlass API v4.0 字段映射说明，包括所有端点的字段对应关系
- **[部署文档](docs/DEPLOYMENT.md)** - 详细的部署指南，包括环境配置、服务启动、监控等

### 其他文档

- [ETF 推送实现文档](docs/ETF_IMPLEMENTATION.md)
- [OI 异动推送实现文档](docs/OI_ALERT_IMPLEMENTATION.md)
- [Twitter 自动推送实现文档](docs/TWITTER_AUTO_TWEET_IMPLEMENTATION.md)

## 部署建议

### 使用 PM2

```bash
npm install -g pm2
pm2 start dist/src/bot/index.js --name contract-bot
pm2 save
pm2 startup
```

### 使用 Docker

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
CMD ["node", "dist/src/bot/index.js"]
```

## 注意事项

1. **数据来源**: 严格使用 CoinGlass API v4.0，不要使用其他数据源
2. **AI 分析**: DeepSeek 只用于解释数据，不用于生成数据
3. **付费逻辑**: 确保在生产环境中正确配置 Telegram Stars 支付
4. **数据库备份**: 定期备份 SQLite 数据库文件

## 许可证

MIT

## 作者

Ocean | 湄南河畔
