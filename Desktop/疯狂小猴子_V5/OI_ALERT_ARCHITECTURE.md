# OI 异动扫描系统 - 模块化架构文档

## 概述

本次重构将原有的 `BinanceOILarkAlertService` 重构为模块化架构，支持：
- 动态 ticker 列表获取
- 候选池机制（二次确认才推送）
- 多渠道推送（Lark + Twitter 并行）
- 完善的错误处理和日志
- Dry-run 模式

## 架构设计

### 模块划分

```
OIAlertOrchestrator (编排器)
├── TickerSource (ticker 列表提供)
├── Scanner (数据扫描)
├── DecisionEngine (阈值判断 + 候选池)
└── Notifiers (多渠道推送)
    ├── LarkNotifier
    └── TwitterNotifier
```

### 核心模块说明

#### 1. TickerSource (`src/services/oiAlert/tickerSource.ts`)

**职责**：提供本轮扫描的 ticker 列表

**策略**：
- 主流币（固定小集合）
- Meme/新币（动态高频更新）
- 近期高 OI / 高成交额 TopN（动态）

**配置**：
- `scanTopN`: 扫描 Top N 个币种（默认 200）
- `scanGroups`: 扫描组（`['major', 'meme', 'topOI']`）
- `useDynamicList`: 是否使用动态列表（默认 true）

#### 2. Scanner (`src/services/oiAlert/scanner.ts`)

**职责**：对每个 ticker 拉取 CoinGlass 数据

**特性**：
- Ticker 级 try/catch 隔离
- 区分错误类型：`rate_limit`、`no_data`、`fatal_error`
- 并发控制（默认 5 个并发）

**输出**：`ScanResult[]`

#### 3. DecisionEngine (`src/services/oiAlert/decisionEngine.ts`)

**职责**：阈值判断 + 候选池 + 去重

**候选池机制**：
1. 首次满足阈值 → `status=candidate`（不推送）
2. 后续扫描再次满足 → 触发推送事件，`status=confirmed_sent`
3. 若后续不满足 → `status=dropped`
4. 若限流/失败 → 保留 `candidate`，等待下次扫描

**去重规则**：
- `eventId = hash(symbol + interval + direction + floor(detectedAt/cooldownWindow))`
- `cooldownWindow` 可配置（默认 2 小时）

#### 4. CandidatePool (`src/services/oiAlert/candidatePool.ts`)

**职责**：候选池持久化存储

**字段**：
- `key`: symbol + interval
- `firstDetectedAt`: 首次检测到满足阈值的时间
- `lastCheckedAt`: 最后检查时间
- `status`: `candidate` | `confirmed_sent` | `dropped`
- `retryPendingCount`: 限流重试次数

#### 5. Notifiers (`src/services/oiAlert/notifiers/`)

**职责**：多渠道推送

**LarkNotifier**：
- 保持现有 webhook 文本样式
- 调用 DeepSeek 生成解读

**TwitterNotifier**：
- 支持多账户（accountA, accountB, accountC）
- 简洁推文格式
- 可配置只推送上升异动

## 配置说明

### 环境变量

```bash
# 启用新架构
USE_NEW_OI_ALERT_ORCHESTRATOR=true

# Dry-run 模式（不真实发送）
OI_ALERT_DRY_RUN=true

# 基础配置
OI_ALERT_POLL_INTERVAL_MS=600000  # 10 分钟
OI_ALERT_THRESHOLD_PERCENT=10     # 10%
OI_ALERT_COOLDOWN_MS=3600000      # 60 分钟（旧 cooldown）
OI_ALERT_COOLDOWN_WINDOW_MS=7200000  # 2 小时（事件去重窗口）

# 扫描配置
OI_ALERT_SCAN_TOP_N=200           # 扫描 Top 200
OI_ALERT_SCAN_GROUPS=major,meme,topOI  # 扫描组
OI_ALERT_USE_DYNAMIC_LIST=true    # 使用动态列表
OI_ALERT_CONCURRENCY=5            # 并发数

# Lark Webhook
LARK_WEBHOOK_UNIFIED=https://open.larksuite.com/open-apis/bot/v2/hook/...

# Twitter OAuth 1.0a（用于 Twitter 推送）
TW_A_API_KEY=...
TW_A_API_SECRET=...
TW_A_ACCESS_TOKEN=...
TW_A_ACCESS_TOKEN_SECRET=...
```

### 数据库

候选池表会自动创建（`oi_alert_candidate_pool`），无需手动初始化。

## 使用方法

### 1. Dry-Run 模式（测试）

```bash
# 设置环境变量
export OI_ALERT_DRY_RUN=true
export USE_NEW_OI_ALERT_ORCHESTRATOR=true

# 运行 dry-run 脚本
npm run ts-node scripts/oiAlertDryRun.ts
```

### 2. 真实模式（生产）

```bash
# 设置环境变量
export USE_NEW_OI_ALERT_ORCHESTRATOR=true
export OI_ALERT_DRY_RUN=false

# 启动 Bot（会自动使用新架构）
npm start
```

### 3. 向后兼容

如果不设置 `USE_NEW_OI_ALERT_ORCHESTRATOR=true`，系统会继续使用旧的 `BinanceOILarkAlertService`。

## 日志说明

### 扫描统计

```
{
  "totalTickers": 200,
  "successCount": 180,
  "noDataCount": 10,
  "rateLimitCount": 5,
  "fatalErrorCount": 5,
  "candidateCount": 3,
  "confirmedCount": 1,
  "droppedCount": 2
}
```

### 事件日志

每个检测到的事件会记录：
- `eventId`: 事件唯一标识
- `symbol`: 币种
- `oiChangePct`: OI 变化百分比
- `direction`: 方向（up/down/unknown）
- 推送结果（Lark/Twitter）

## 故障排查

### 为什么某个币没有推送？

1. 检查扫描统计：是否在 `successCount` 中
2. 检查候选池：`SELECT * FROM oi_alert_candidate_pool WHERE symbol = 'XXX'`
3. 检查日志：是否有错误信息

### 是否推到 Twitter 了？

查看日志中的 `Notification summary`，会显示每个渠道的推送结果。

## 迁移指南

### 从旧架构迁移到新架构

1. **备份数据库**（可选）
2. **设置环境变量**：
   ```bash
   USE_NEW_OI_ALERT_ORCHESTRATOR=true
   OI_ALERT_DRY_RUN=true  # 先测试
   ```
3. **运行 dry-run 测试**
4. **确认无误后，设置**：
   ```bash
   OI_ALERT_DRY_RUN=false
   ```
5. **重启 Bot**

### 回滚

如果遇到问题，只需移除 `USE_NEW_OI_ALERT_ORCHESTRATOR` 环境变量，系统会自动回退到旧架构。

## 文件结构

```
src/services/oiAlert/
├── types.ts              # 类型定义
├── tickerSource.ts       # Ticker 列表提供
├── scanner.ts            # 数据扫描
├── candidatePool.ts      # 候选池管理
├── decisionEngine.ts     # 决策引擎
├── orchestrator.ts       # 编排器
└── notifiers/
    ├── base.ts           # Notifier 接口
    ├── larkNotifier.ts   # Lark 推送
    └── twitterNotifier.ts # Twitter 推送
```

## 后续优化

- [ ] 支持更多交易所（不仅 Binance）
- [ ] 支持自定义推送模板
- [ ] 支持 Webhook 回调通知
- [ ] 支持更细粒度的扫描策略配置

