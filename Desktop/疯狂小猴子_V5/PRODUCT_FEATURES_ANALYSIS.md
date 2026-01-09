# 产品功能分析文档

## 📱 一、Telegram Bot 功能分析

### 1.1 核心功能模块

#### 🔍 庄家轧空/多空挤压分析 (`/squeeze`)
**功能描述**：
- 监测 Binance 合约的庄家轧空结构变化
- 基于最近 4 小时大户持仓结构数据
- 按「庄家轧空结构变化强度」排序显示

**交互流程**：
1. 用户点击「🔍 庄家轧空/多空挤压」按钮
2. 从缓存读取最近 4h 的扫描结果
3. 显示推荐列表（Top 10），包含：
   - 币种符号
   - 结构标签（由 Label Engine 生成）
   - 风险&可信度（由 Risk Engine 生成）
4. 用户可点击具体币种查看详细分析

**数据来源**：
- CoinGlass API：大户持仓结构、OI 历史、多空比历史
- 数据粒度：4 小时

**权限要求**：
- 查看列表：无需解锁
- 详细分析：需要解锁（2999 Stars 或邀请码）

---

#### 📊 ETF 资金流向 (`/etf`)
**功能描述**：
- 查询 BTC、ETH、SOL、XRP 的 ETF 资金流入/流出数据
- 支持查看最新数据和历史数据（30 天）

**支持的币种**：
- ₿ BTC
- Ξ ETH
- ◎ SOL
- 💧 XRP

**功能特性**：
- **最新数据查询**：显示当前最新的 ETF 资金流
- **历史数据查询**：查看过去 30 天的资金流趋势
- **快速查看**：仅显示最新数据，不获取历史（节省 API 调用）
- **ETF 列表**：查看支持的 ETF 列表

**数据字段**：
- 总流入/流出金额（USD）
- 价格（USD）
- 时间戳
- ETF 明细（各 ETF 的流入/流出）

**数据来源**：
- CoinGlass API：`/api/etf/flow` 相关接口
- 数据粒度：实时 + 历史（30 天）

**权限要求**：
- 查看最新数据：无需解锁
- 查看历史数据：需要解锁

---

#### 💹 资金费率扫描 (`/funding`)
**功能描述**：
- 扫描资金费率异常的合约
- 支持多种查询模式

**功能模块**：
1. **交易所资金费率列表** (`exchange`)
   - 按交易所显示资金费率
   - 支持筛选：正费率 / 负费率

2. **累计资金费率** (`accumulated`)
   - 显示累计资金费率
   - 支持筛选：正费率 / 负费率

3. **资金费率历史** (`history`)
   - 查询指定币种的资金费率历史
   - 需要输入 Ticker（如 BTC）

4. **成交量加权资金费率历史** (`vol_weighted`)
   - 按成交量加权计算的资金费率历史
   - 需要输入 Ticker

5. **持仓加权资金费率历史** (`oi_weighted`)
   - 按持仓量加权计算的资金费率历史
   - 需要输入 Ticker

**数据来源**：
- CoinGlass API：`/api/futures/fundingRate/*` 相关接口

**权限要求**：
- 基础查询：无需解锁
- 详细分析：需要解锁

---

#### 🔎 合约查询（Ticker）(`/contract`)
**功能描述**：
- 查询指定合约的详细交易状态
- 支持输入 Ticker 符号（如 BTC、ETH、SOL）

**查询流程**：
1. **Step 1：展示基础数据**
   - 合约持仓（OI）
   - 资金费率
   - 主动成交方向（Taker Buy/Sell）
   - 大户持仓结构（Top Long/Short）
   - 爆仓数据（24h）

2. **Step 2：询问是否需要分析**
   - 用户可选择「Yes，进行分析」或「No」
   - 选择「Yes」后，调用 DeepSeek 生成深度分析

**数据字段**：
- OI（Open Interest）：未平仓合约价值
- Funding Rate：资金费率
- Taker Buy/Sell Volume：主动买入/卖出量
- Top Account Long/Short Ratio：大户多空比
- Liquidation 24h：24 小时爆仓数据

**数据来源**：
- CoinGlass API：多个接口聚合
- 默认交易所：Binance

**权限要求**：
- 查看基础数据：无需解锁
- 深度分析：需要解锁（2999 Stars 或邀请码）

---

#### 📡 结构订阅 (`/subscription`)
**功能描述**：
- 订阅结构信号推送
- 用户可选择关注的结构主题（可多选）

**订阅机制**：
- 当结构信号命中用户订阅的频道时，自动推送通知
- 支持多频道订阅
- 可随时开启/关闭订阅

**频道类型**：
- 由 `strategyChannelEngine` 管理
- 每个频道有独立的显示名称和描述

**权限要求**：
- 订阅功能：无需解锁

---

### 1.2 辅助功能

#### 💎 付费与解锁
- **`/pricing`**：解锁全部功能（Telegram Stars）
  - 价格：2999 Stars（终身解锁）
  
- **`/redeem`**：输入邀请码
  - 有效邀请码：Ocean001
  - 输入后自动解锁分析功能

- **`/balance`**：查看剩余分析次数
  - 显示当前账户状态
  - 显示是否已解锁

#### 📖 帮助与支持
- **`/help`**：使用说明
- **`/support`**：支付与问题支持
  - 常见问题解答
  - 联系方式（Twitter: @Ocean_Jackon）

---

### 1.3 数据源与 API

**主要数据源**：
- **CoinGlass API v4.0**
  - 合约数据（OI、Funding Rate、Taker、Top 持仓）
  - ETF 资金流数据
  - 历史数据（OHLC）

**AI 分析**：
- **DeepSeek API**
  - 合约结构深度分析
  - 庄家轧空分析
  - ETF 资金流分析

---

## 🐦 二、Twitter 自动推送功能分析

### 2.1 推送机制

#### 触发条件
- **选币逻辑**：选择 4 小时内 OI 增长最大的币种
- **交易所限制**：必须在 Binance Futures 上线
- **执行方式**：轮询模式（默认每 5 分钟检查一次）
- **每日限额**：每天最多推送 3 条推文
- **幂等性**：48 小时内同一币种不重复推送

#### 轮询配置
- **轮询间隔**：`POLL_INTERVAL_MS`（默认 300000 毫秒 = 5 分钟）
- **启动行为**：启动后立即执行一次，然后按间隔轮询
- **并发控制**：使用 `isRunning` 防止并发执行

#### 每日限额机制
- **限额**：`DAILY_TWEET_LIMIT`（默认 3 条）
- **时区**：Asia/Bangkok 或系统本地时区
- **状态存储**：`./data/x_tweet_state.json`
- **重置规则**：新的一天自动重置计数
- **计数规则**：仅在真实发送成功后计数，`PREFLIGHT_MODE=true` 不计入

---

### 2.2 推文内容结构

#### 完整模板格式
```
📊 合约数据概览｜{TICKER}
Binance · 4h

—

合约持仓（OI）
总持仓（4h 前）：{OI_USD}

资金费率
Funding Rate：{FUNDING_RATE}

主动成交方向
主动买入：{TAKER_BUY_USD}
主动卖出：{TAKER_SELL_USD}

大户持仓结构（最近一周期）
多单占比：{TOP_LONG_PERCENT}
空单占比：{TOP_SHORT_PERCENT}
多空比：{TOP_LONG_SHORT_RATIO}

数据说明
以上数据基于 ≥4h 粒度的合约市场统计

—

结构分析｜{TICKER} 合约（4h）

{DEEPSEEK_ANALYSIS_BLOCK}

—

结构性风险观察

{RISK_BLOCK}

⚠️ 本内容为结构观察，不构成投资或交易建议。
```

#### 数据字段说明

**基础数据部分**：
- **OI（Open Interest）**：未平仓合约价值（USD）
  - 格式：≥ $1M 显示为 `$XX.XXM`，否则显示完整金额
- **Funding Rate**：资金费率
  - 格式：百分比，保留 2 位小数（如 `+0.94%`、`-0.05%`）
- **Taker Buy/Sell**：主动买入/卖出量（USD）
  - 格式：≥ $1M 显示为 `$XX.XXM`，否则显示完整金额
- **Top Long/Short**：大户多单/空单占比
  - 格式：百分比，保留 2 位小数
- **Top Long/Short Ratio**：大户多空比
  - 格式：保留 2 位小数

**DeepSeek 分析部分**：
- **结构分析块** (`DEEPSEEK_ANALYSIS_BLOCK`)：
  - 由 DeepSeek 生成合约结构分析
  - 不包含基础数据、不生成数值、不给交易建议
  - 使用简体中文，客观描述

- **风险观察块** (`RISK_BLOCK`)：
  - 由 DeepSeek 生成结构性风险观察
  - 只讨论结构错配/脆弱性
  - 禁止价格预测、交易建议

**数据完整性要求**：
- 所有关键字段必须完整有效
- 不允许出现 `-`、`—`、`undefined`
- 数据不完整时跳过推文发送

---

### 2.3 多账户发布机制

#### 账户配置
- **账户 A**：中文原文发布（主账户）
- **账户 B**：英文翻译发布
- **账户 C**：韩文翻译发布

#### 发布流程
1. **后端生成中文原文**
   - 使用完整的 Twitter 模板生成中文推文
   - 写入发布缓存（`TweetPublishCacheService`）

2. **创建发布缓存条目**
   - `publishId`：唯一发布标识（格式：`YYYY-MM-DDTHH:mm:ss.sssZ_SYMBOL`）
   - `sourceText`：中文原文
   - `translations`：翻译结果缓存（`en`、`ko`）
   - `published`：发布状态（`A`、`B`、`C`）

3. **账户 A 发布**
   - 直接使用 `sourceText` 发布
   - 成功后标记 `published.A = true`

4. **账户 B 发布（英文）**
   - 调用 `TweetTranslationService.translateWithDeepSeek(sourceText, 'en')`
   - 翻译后发布，成功后标记 `published.B = true`

5. **账户 C 发布（韩文）**
   - 调用 `TweetTranslationService.translateWithDeepSeek(sourceText, 'ko')`
   - 翻译后发布，成功后标记 `published.C = true`

#### 翻译规则
- **DeepSeek 系统提示**：
  ```
  你是专业翻译助手。
  仅进行翻译，不改写、不扩写、不缩写。
  保留原始格式、换行和分隔线。
  保持币名、Ticker、数字与符号不变。
  ```

- **用户提示**：
  ```
  请将以下内容翻译为 {English / Korean}。
  仅输出译文。
  {text}
  ```

- **约束**：
  - 不添加免责声明
  - 不添加标题
  - 不修改数值
  - 不修改段落结构
  - 超过 280 字符时智能截断

#### 失败隔离
- A/B/C 发布互不影响
- 如果 A 成功但 B 失败，B 可在下一轮重试
- 不影响 C 的发布
- 所有失败都会记录日志

---

### 2.4 数据获取与验证

#### OI 增长选币逻辑
1. **获取候选池**：
   - 从 Binance Universe 获取所有支持的币种
   - 批量查询 `pairs-markets` API（限制 Top 200）

2. **计算 4h OI 增量**：
   - 优先使用 `open-interest/history` API（4h 间隔，limit=2）
   - Fallback：使用 `pairs-markets` 数据中的 `open_interest_change_percent_24h` 估算

3. **筛选条件**：
   - 必须是 Binance 交易所
   - 必须在 Binance Futures Universe 中
   - OI 增量 > 0

4. **排序规则**：
   - 按 OI 增量降序排序
   - 选择增量最大的币种

#### 数据完整性验证
- **SnapshotValidator 校验**：
  - OI 必须 > 0
  - Funding Rate 必须为有限数值（允许负值）
  - Taker Buy/Sell 必须 > 0
  - Top Account Long/Short 必须 > 0

- **数据补充机制**：
  - 如果快照数据不完整，尝试使用 `pairs-markets` 数据补充
  - 如果 Funding Rate 为 0 且没有错误，清除错误标记
  - 如果 Top Account 数据缺失，使用默认值（50% / 50%）

- **验证失败处理**：
  - 数据不完整时跳过推文
  - 记录 `skipReason` 到预发布日志
  - 不发送推文，不影响每日限额

---

### 2.5 预发布模式（Preflight Mode）

#### 功能说明
- **环境变量**：`PREFLIGHT_MODE=true/false`
- **行为**：
  - `true`：只生成推文内容并写入本地日志，不实际发送
  - `false`：正常发送推文到 Twitter

#### 日志记录
- **日志文件**：`./logs/twitter_preflight.log`
- **记录内容**：
  - 推文内容（完整文本）
  - 跳过原因（如果验证失败）
  - 数据源摘要（4h/8h 数据更新状态）
  - 时间戳

#### 预发布模式特点
- 不影响每日配额计数
- 不影响转发状态
- 不更新幂等性时间戳
- 用于测试和验证推文内容

---

### 2.6 定时任务

#### X 自动发推任务
- **服务**：`XAutoTweetJobService`
- **启动时机**：Bot 启动时自动启动
- **执行频率**：每 5 分钟轮询一次
- **状态存储**：`./data/x_tweet_state.json`

#### ETF 每日报告任务
- **服务**：`ETFDailyReportService`
- **执行时间**：每天北京时间早上 8 点
- **报告内容**：
  - 过去 24 小时（UTC+0）的 ETF 资金流数据
  - DeepSeek 生成的分析文本
- **保存位置**：
  - Mac 桌面：`etf_daily_report_YYYY-MM-DD.txt`
  - 数据目录：`./data/etf/`
- **支持币种**：BTC、ETH、XRP、SOL（必须全部有数据才生成报告）

---

## 📊 三、数据源总结

### 3.1 CoinGlass API 使用情况

#### 合约数据相关
- `getFuturesPairsMarkets({ symbol })`：获取交易对市场数据
- `getOpenInterestHistory({ symbol, exchange, interval, limit, unit })`：获取 OI 历史
- `getFundingRateOhlcHistory({ symbol, exchange, interval, limit })`：获取资金费率历史
- `getTopLongShortPositionRatioHistory({ exchange, symbol, interval, limit })`：获取大户持仓多空比历史
- `getTakerBuySellVolumeHistory({ exchange, symbol, interval, limit })`：获取主动成交历史
- `getLiquidationHistory({ exchange, symbol, interval, limit })`：获取爆仓历史

#### ETF 数据相关
- `getBtcEtfFlowHistory({ days })`：BTC ETF 资金流历史
- `getEthEtfFlowHistory({ days })`：ETH ETF 资金流历史
- `getSolEtfFlowHistory({ days })`：SOL ETF 资金流历史
- `getXrpEtfFlowHistory({ days })`：XRP ETF 资金流历史

#### 基础数据相关
- `getFuturesSupportedCoins()`：获取支持的币种列表
- `getFundingRateExchangeList({ symbol })`：获取资金费率交易所列表

---

### 3.2 DeepSeek API 使用情况

#### 分析生成
- **合约结构分析**：生成结构分析文本
- **风险观察**：生成结构性风险观察
- **庄家轧空分析**：生成庄家轧空分析报告
- **ETF 资金流分析**：生成 ETF 资金流分析报告

#### 翻译服务
- **英文翻译**：将中文推文翻译为英文
- **韩文翻译**：将中文推文翻译为韩文

---

## 🔧 四、技术架构

### 4.1 服务层架构

#### 核心服务
- `ContractSnapshotService`：合约快照服务
- `ContractService`：合约查询与分析服务
- `ETFService`：ETF 资金流服务
- `ETFDailyReportService`：ETF 每日报告服务
- `FundingService`：资金费率服务
- `SqueezeScanService`：庄家轧空扫描服务
- `XAutoTweetJobService`：Twitter 自动发推任务服务
- `TweetContentService`：推文内容生成服务
- `TweetTranslationService`：推文翻译服务
- `TweetPublishCacheService`：推文发布缓存服务

#### 客户端
- `CoinGlassClient`：CoinGlass API 客户端
- `DeepSeekClient`：DeepSeek API 客户端
- `XTweetOAuth1Service`：Twitter OAuth 1.0a 发推服务

---

### 4.2 数据存储

#### 文件存储
- `./data/x_tweet_state.json`：Twitter 发推状态
- `./data/x_forward_state.json`：Twitter 转发状态（已废弃）
- `./data/x_publish_cache.json`：推文发布缓存
- `./data/x_oauth1_tokens.json`：账户 A OAuth Token
- `./data/x_oauth1_tokens_accountB.json`：账户 B OAuth Token
- `./data/x_oauth1_tokens_accountC.json`：账户 C OAuth Token
- `./logs/twitter_preflight.log`：预发布日志
- `./logs/coinglass_raw_debug.log`：CoinGlass API 原始调试日志

#### 数据库
- `./db/bot.db`：SQLite 数据库
  - 用户信息
  - 订阅状态
  - 其他持久化数据

---

## 📝 五、功能总结表

### Telegram Bot 功能

| 功能模块 | 命令 | 主要功能 | 权限要求 |
|---------|------|---------|---------|
| 庄家轧空/多空挤压 | `/squeeze` | 监测庄家轧空结构变化 | 列表：免费<br>分析：需解锁 |
| ETF 资金流向 | `/etf` | 查询 BTC/ETH/SOL/XRP ETF 资金流 | 最新：免费<br>历史：需解锁 |
| 资金费率扫描 | `/funding` | 扫描资金费率异常合约 | 基础：免费<br>详细：需解锁 |
| 合约查询 | `/contract` | 查询指定合约详细状态 | 基础：免费<br>分析：需解锁 |
| 结构订阅 | `/subscription` | 订阅结构信号推送 | 免费 |
| 付费解锁 | `/pricing` | 解锁全部功能（2999 Stars） | - |
| 邀请码 | `/redeem` | 输入邀请码解锁 | - |
| 账户查询 | `/balance` | 查看账户状态 | 免费 |
| 使用说明 | `/help` | 查看帮助文档 | 免费 |
| 问题支持 | `/support` | 支付与问题支持 | 免费 |

### Twitter 自动推送功能

| 功能项 | 说明 |
|--------|------|
| **触发条件** | 4h OI 增长最大的币种（Binance Futures） |
| **执行方式** | 轮询模式（默认 5 分钟） |
| **每日限额** | 最多 3 条推文 |
| **幂等性** | 48 小时内同一币种不重复 |
| **发布账户** | A（中文）、B（英文）、C（韩文） |
| **内容结构** | 基础数据 + DeepSeek 结构分析 + 风险观察 |
| **数据验证** | 严格验证，数据不完整跳过 |
| **预发布模式** | 支持测试模式，不实际发送 |

---

## 🎯 六、产品定位

### Telegram Bot
**定位**：合约行为感知工具
- 不预测价格，不喊单
- 通过合约数据变化，判断市场结构是否正在发生变化
- 帮助用户发现庄家轧空、ETF 资金流、资金费率异常等市场信号

### Twitter 自动推送
**定位**：市场结构信号搬运
- 自动发现 OI 增长显著的合约
- 提供结构分析和风险观察
- 多语言发布（中文、英文、韩文）

---

**文档生成时间**：2025-12-30
**文档版本**：v1.0



