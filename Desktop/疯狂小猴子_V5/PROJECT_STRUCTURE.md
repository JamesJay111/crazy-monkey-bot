# 项目结构说明

## 目录结构

```
疯狂的小猴子/
├── src/                          # 源代码目录
│   ├── bot/
│   │   └── index.ts              # Bot 主入口，初始化所有服务和路由
│   ├── clients/                   # 外部 API 客户端
│   │   ├── coinglass.client.ts   # CoinGlass v4 API 客户端
│   │   └── deepseek.client.ts    # DeepSeek API 客户端
│   ├── services/                  # 业务逻辑服务层
│   │   ├── squeeze.service.ts    # 轧空分析服务
│   │   ├── etf.service.ts        # ETF 资金流服务
│   │   ├── funding.service.ts   # 资金费率扫描服务
│   │   └── contract.service.ts  # 合约查询服务
│   ├── routes/                    # 路由处理器
│   │   ├── start.ts              # /start 命令
│   │   ├── help.ts               # /help 命令
│   │   ├── squeeze.ts            # /squeeze 命令
│   │   ├── etf.ts                # /etf 命令
│   │   ├── funding.ts            # /fr 命令
│   │   ├── contract.ts           # /contract 命令
│   │   ├── pay.ts                # /pay 命令
│   │   └── code.ts               # /code 命令
│   ├── repositories/              # 数据访问层
│   │   └── user.repository.ts   # 用户数据仓库
│   ├── guards/                    # 权限守卫
│   │   └── entitlement.guard.ts # 解锁权限检查
│   ├── prompts/                   # AI Prompt 模板
│   │   ├── squeeze.prompt.ts    # 轧空分析 Prompt
│   │   └── contract.prompt.ts   # 合约分析 Prompt
│   ├── utils/                     # 工具函数
│   │   ├── logger.ts             # 日志工具（Pino）
│   │   ├── formatter.ts          # 格式化工具
│   │   └── validator.ts          # 验证工具
│   ├── db/                        # 数据库相关
│   │   └── init.ts               # 数据库初始化
│   └── types/                     # TypeScript 类型定义
│       └── index.ts              # 所有类型定义
├── db/                            # 数据库文件目录
│   └── init.sql                  # 数据库初始化 SQL
├── dist/                          # 编译输出目录
├── node_modules/                  # 依赖包
├── .env                           # 环境变量（不提交到 Git）
├── .env.example                   # 环境变量示例
├── .gitignore                     # Git 忽略文件
├── package.json                   # 项目配置和依赖
├── tsconfig.json                  # TypeScript 配置
├── README.md                      # 项目文档
└── PROJECT_STRUCTURE.md          # 本文件
```

## 核心模块说明

### 1. CoinGlassClient (`clients/coinglass.client.ts`)

**职责**: 封装 CoinGlass v4 API 调用

**主要方法**:
- `getSupportedCoins()` - 获取支持的币种列表
- `getSupportedExchangePairs()` - 获取支持的交易所和交易对
- `getOIExchangeList()` - 获取 OI 交易所列表
- `getOIHistory()` - 获取 OI 历史 OHLC
- `getFundingRateExchangeList()` - 获取资金费率列表
- `getFundingRateHistory()` - 获取资金费率历史
- `getGlobalLongShortRatioHistory()` - 获取多空比历史
- `getBTCETFFlowHistory()` - 获取 BTC ETF 资金流历史
- `getETFETFFlowHistory()` - 获取 ETH ETF 资金流历史
- `getSOLETFFlowHistory()` - 获取 SOL ETF 资金流历史
- `isBinanceFutures()` - 检查是否在 Binance Futures 上线

**特性**:
- 30 秒缓存机制
- 错误处理和重试
- 健康检查

### 2. DeepSeekClient (`clients/deepseek.client.ts`)

**职责**: 封装 DeepSeek API 调用

**主要方法**:
- `chat()` - 发送聊天请求
- `analyzeWithPrompt()` - 使用 Prompt 模板生成分析

**特性**:
- 错误处理
- Token 使用统计

### 3. Services 层

#### SqueezeService (`services/squeeze.service.ts`)
- `detectCandidates()` - 检测过去30天轧空候选
- `analyzeSqueeze()` - 分析单个 Ticker 的轧空结构
- `detectCurrent()` - 检测当前市场结构

#### ETFService (`services/etf.service.ts`)
- `getLatestFlow()` - 获取最新 ETF 资金流
- `getFlowHistory()` - 获取 ETF 历史数据
- `formatLatestFlow()` - 格式化最新数据
- `formatHistoryFlow()` - 格式化历史数据

#### FundingService (`services/funding.service.ts`)
- `scanAnomalies()` - 扫描资金费率异常

#### ContractService (`services/contract.service.ts`)
- `getContractStatus()` - 获取合约状态
- `getContractStatusWithAnalysis()` - 获取合约状态 + AI 分析
- `formatContractStatusSimple()` - 格式化简化版
- `formatContractStatusFull()` - 格式化完整版

### 4. Routes 层

每个路由文件负责处理对应的命令和回调：

- `start.ts` - 开场白和主菜单
- `help.ts` - 帮助信息
- `squeeze.ts` - 轧空功能
- `etf.ts` - ETF 功能
- `funding.ts` - 资金费率扫描
- `contract.ts` - 合约查询
- `pay.ts` - 付费说明
- `code.ts` - 邀请码输入

### 5. Repository 层

#### UserRepository (`repositories/user.repository.ts`)
- `getOrCreate()` - 获取或创建用户
- `unlockUser()` - 解锁用户
- `isUnlocked()` - 检查是否解锁
- `getUser()` - 获取用户信息

### 6. Guards 层

#### EntitlementGuard (`guards/entitlement.guard.ts`)
- `isUnlocked()` - 检查是否解锁
- `requireUnlocked()` - 要求解锁（未解锁抛出错误）
- `unlockByStars()` - 通过 Stars 解锁
- `unlockByInviteCode()` - 通过邀请码解锁

### 7. Prompts 层

#### SqueezePrompt (`prompts/squeeze.prompt.ts`)
- `SQUEEZE_SYSTEM_PROMPT` - 系统 Prompt
- `buildSqueezePrompt()` - 构建用户 Prompt

#### ContractPrompt (`prompts/contract.prompt.ts`)
- `CONTRACT_SYSTEM_PROMPT` - 系统 Prompt
- `buildContractPrompt()` - 构建用户 Prompt

### 8. Utils 层

#### Logger (`utils/logger.ts`)
- 基于 Pino 的日志系统
- 开发环境使用 pino-pretty

#### Formatter (`utils/formatter.ts`)
- `formatNumber()` - 格式化数字
- `formatLargeNumber()` - 格式化大数字（千分位）
- `formatPercent()` - 格式化百分比
- `formatTimestamp()` - 格式化时间戳（UTC+7）
- `formatDate()` - 格式化日期
- `normalizeTicker()` - 规范化 Ticker

#### Validator (`utils/validator.ts`)
- `isValidTicker()` - 验证 Ticker 格式
- `normalizeTicker()` - 规范化 Ticker
- `isValidInviteCode()` - 验证邀请码

## 数据流

1. **用户输入** → Bot 主入口 (`bot/index.ts`)
2. **路由分发** → 对应的 Route Handler
3. **权限检查** → EntitlementGuard
4. **业务逻辑** → Service 层
5. **数据获取** → Client 层（CoinGlass/DeepSeek）
6. **数据存储** → Repository 层（SQLite）
7. **格式化输出** → Formatter
8. **返回用户** → Telegram Bot API

## 错误处理

- **API 错误**: Client 层捕获并转换为友好错误消息
- **业务错误**: Service 层处理并记录日志
- **路由错误**: Bot 主入口统一捕获并回复用户

## 缓存策略

- CoinGlass API: 30 秒内存缓存
- 减少 API 调用频率

## 数据库设计

### users 表
- `id` (INTEGER PRIMARY KEY) - Telegram User ID
- `username` (TEXT) - Telegram Username
- `is_unlocked` (INTEGER) - 是否解锁（0/1）
- `unlock_method` (TEXT) - 解锁方式（stars/invite）
- `unlock_time` (INTEGER) - 解锁时间戳
- `created_at` (INTEGER) - 创建时间
- `updated_at` (INTEGER) - 更新时间

## 扩展指南

### 添加新功能

1. 在 `services/` 创建新服务
2. 在 `routes/` 创建新路由
3. 在 `bot/index.ts` 注册路由
4. 如需付费，使用 `EntitlementGuard`

### 添加新的 API 端点

1. 在对应的 Client 中添加方法
2. 在 Service 中使用新方法
3. 更新类型定义

### 修改 Prompt

1. 在 `prompts/` 目录修改或创建新 Prompt
2. 在 Service 中使用新 Prompt
