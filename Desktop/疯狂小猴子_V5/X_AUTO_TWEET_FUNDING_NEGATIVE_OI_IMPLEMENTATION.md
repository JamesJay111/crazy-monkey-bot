# X 自动发推 Job 更新：Funding < 0 + OI 最大

## 📋 修改摘要

将自动发推 Job 的选币逻辑从 **"Taker 增长最快"** 调整为 **"Funding < 0 且 OI 最大"**。

## 🔧 修改/新增文件清单

### 新增文件
1. **`src/services/fundingNegativeOIService.ts`**
   - 新服务：筛选 Binance Futures 中 Funding < 0 的币种，选择 OI 最大的
   - 关键方法：
     - `getBinanceUniverse()`: 获取 Binance Universe（复用现有逻辑）
     - `filterNegativeFunding()`: 过滤 Funding < 0 的币种（仅 Binance）
     - `pickMaxOI()`: 从候选中选择 OI 最大的
     - `selectBestCandidate()`: 主方法，完整流程

### 修改文件
1. **`src/services/xAutoTweetJob.service.ts`**
   - 替换选币逻辑：从 `TakerGrowthService` 改为 `FundingNegativeOIService`
   - 新增 `getContractSnapshot8h()`: 获取 8h 间隔的数据（Taker 和 Top）
   - 更新日志格式：从 Taker 增长改为 Funding Rate 和 OI
   - 保持其他逻辑不变：调度周期、幂等性、错误处理等

2. **`src/bot/index.ts`**
   - 注入新服务：`FundingNegativeOIService`
   - 更新 `XAutoTweetJobService` 构造函数参数

## 🎯 核心逻辑说明

### 1. Universe 获取
- **复用现有逻辑**：`BinanceUniverseService.getBinanceUniverse()`
- 来源：`funding-rate/exchange-list` 的 `stablecoin_margin_list` 中 `exchange=Binance` 的 symbols

### 2. 过滤条件：Funding < 0（Binance）
- API: `GET /api/futures/funding-rate/exchange-list`
- 取值规则：
  - 找到 `symbol={TICKER}` 的条目
  - 进入 `stablecoin_margin_list`
  - 找 `exchange="Binance"` 对应项
  - 字段 `funding_rate`
- **必须条件**：
  - `funding_rate < 0`
  - 必须来自 Binance（不允许用其他交易所兜底）

### 3. 选择规则：OI 最大
- API: `GET /api/futures/open-interest/exchange-list`
- 取值规则：
  - 取 `exchange="All"` 的汇总行
  - 匹配 `symbol={TICKER}`
  - 字段 `open_interest_usd`
- 排序：降序，`open_interest_usd` 最大优先

### 4. 数据拉取（选中 ticker 后）

#### 4.1 Taker（8h 最近一期）
- API: `GET /api/futures/taker-buy-sell-volume/history`
- 参数：
  - `exchange=Binance`
  - `symbol={TICKER}USDT`
  - `interval=8h`（不支持则降级到 4h）
  - `limit=1`
- 字段：`taker_buy_volume_usd`, `taker_sell_volume_usd`

#### 4.2 Top 大户结构（8h 最近一期）
- API: `GET /api/futures/top-long-short-position-ratio/history`
- 参数：
  - `exchange=Binance`
  - `symbol={TICKER}USDT`
  - `interval=8h`（不支持则降级到 4h）
  - `limit=1`
- 字段：`top_position_long_percent`, `top_position_short_percent`, `top_position_long_short_ratio`

#### 4.3 OI（4h 前数据）
- 复用现有逻辑：`ContractSnapshotService.getContractSnapshot()`
- 注意：OI 是 4h 前数据（保持不变）

#### 4.4 Funding（当前）
- 复用现有逻辑：从 `funding-rate/exchange-list` 获取 Binance 的当前 funding rate

### 5. 推文模板（固定格式）

```
🧨 合约结构预警｜{TICKER}（Binance · 8H）

- OI（4h）：${oi_usd}
- Funding：{funding_rate_pct}
- Taker：买 ${taker_buy_usd} / 卖 ${taker_sell_usd}
- Top：多 {top_long_pct}% / 空 {top_short_pct}%｜比 {top_ls_ratio}

结论：{one_liner}

⚠️ 结构观察，不构成交易建议
```

**格式化规则**：
- 金额 >= 1,000,000 → 用 M，保留 2 位：`$107.56M`
- Funding Rate → 百分比，保留 2 位：`-0.35%`
- 百分比保留 2 位；多空比保留 2 位
- 缺数据显示 `—`，但仍可发推（除非选币核心字段缺失：funding 或 OI）

### 6. one_liner 生成（DeepSeek）
- 输入：本次的 OI、Funding、Taker、Top 数据
- 约束：
  - 不出现"做多/做空/买卖建议/目标价/价格预测"
  - 只描述结构：一致性、拥挤度、扰动敏感性、风险暴露等
  - 字数：20–28 字

## 🔄 保持不变的行为

1. **调度周期**：每 8 小时执行一次
2. **发推频率**：每次只发 1 条推文（1 个 Ticker）
3. **启动行为**：部署/启动后立即执行一次（不等待 8h）
4. **幂等去重**：同一 8h bucket 内不重复发相同 ticker
5. **无候选处理**：若本轮无候选 → 不发推，仅记录日志
6. **错误处理**：发推失败最多重试 1 次，失败记录日志，不影响下一轮

## 🧪 自测步骤

### 1. 启动后立即发推
```bash
# 启动 Bot
npm start

# 观察日志，应该立即执行一次发推任务
# 检查是否选择了 Funding < 0 且 OI 最大的币种
```

### 2. 验证选币逻辑
- ✅ 候选池仅来自 Binance Futures
- ✅ 只选择 Funding < 0 的币种（必须来自 Binance）
- ✅ 在 Funding < 0 的候选中选择 OI 最大的
- ✅ 推文标题包含 "Binance · 8H"
- ✅ 推文格式符合模板要求

### 3. 验证数据拉取
- ✅ Taker 和 Top 使用 8h 间隔（如果支持）
- ✅ OI 显示为 4h 前数据
- ✅ Funding Rate 来自 Binance

### 4. 开发自测（缩短 interval）
```typescript
// 在 xAutoTweetJob.service.ts 中临时修改
private readonly INTERVAL_MS = 1 * 60 * 1000; // 1 分钟（仅用于测试）

// 测试完成后恢复为 8 小时
private readonly INTERVAL_MS = 8 * 60 * 60 * 1000; // 8 小时
```

## 📝 异常处理

1. **Funding list 拉取失败**：本轮跳过，记录日志
2. **Funding < 0 候选为空**：不发推，记录 "no negative funding candidates"
3. **OI 获取失败**：跳过该 ticker（继续尝试下一个 OI 次大候选），直到成功或耗尽
4. **发推失败**：最多重试 1 次，失败记录日志，不影响下一轮

## 🔍 关键函数说明

### `FundingNegativeOIService.selectBestCandidate()`
- 主入口：从 Binance Universe 中筛选 Funding < 0 且 OI 最大的币种
- 返回：`FundingNegativeOIResult | null`

### `FundingNegativeOIService.filterNegativeFunding(symbols)`
- 过滤 Funding < 0 的币种（仅 Binance）
- 返回：符合条件的币种及其 Funding Rate

### `FundingNegativeOIService.pickMaxOI(candidates)`
- 从候选中选择 OI 最大的
- 返回：`FundingNegativeOIResult | null`

### `XAutoTweetJobService.getContractSnapshot8h(symbol)`
- 获取合约快照（使用 8h 间隔）
- 注意：如果接口不支持 8h，会降级到 4h（在 API 客户端中处理）

### `XAutoTweetJobService.runTweetJobOnce()`
- 执行一次发推任务
- 流程：选币 → 检查幂等性 → 获取数据 → 生成推文 → 发送推文 → 记录日志

## ✅ 验收标准

- [x] 选币逻辑：Binance Futures + Funding < 0 + OI 最大
- [x] 推文模板：符合固定格式要求
- [x] 数据拉取：Taker 和 Top 使用 8h（如果支持）
- [x] 幂等性：同一 8h bucket 内不重复发相同 ticker
- [x] 错误处理：完善的异常处理和日志记录
- [x] 日志格式：更新为 Funding Rate 和 OI

## 🚀 部署说明

1. 代码已修改完成，无需额外配置
2. 重启 Bot 后立即执行一次发推任务
3. 之后每 8 小时自动执行一次
4. 推文日志保存在 Mac 桌面：`X_Tweet_Log_YYYY-MM-DD.txt`

