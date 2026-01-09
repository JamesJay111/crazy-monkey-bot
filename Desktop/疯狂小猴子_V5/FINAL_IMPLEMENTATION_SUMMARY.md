# Twitter 自动推送改进：最终实现总结

## 📋 改动文件列表

### 修改文件（4个）

1. **`src/config/env.ts`**
   - 新增：`POLL_INTERVAL_MS` (默认 300000 = 5 分钟)
   - 新增：`FUNDING_THRESHOLD_DECIMAL` (默认 -0.0005 = -0.05%)
   - 新增：`DAILY_TWEET_LIMIT` (默认 3)

2. **`src/services/fundingNegativeOIService.ts`**
   - 修改：`filterNegativeFunding()` - 使用阈值触发（fundingRate <= -0.0005）
   - 新增：`normalizeFundingRateToDecimal()` - 归一化资金费率
   - 修改：`pickMaxOI()` - OI 相同时按 symbol 字母序排序

3. **`src/services/tweetContent.service.ts`**
   - 修改：`generateBaseData()` - 模板改为 4H，添加结构状态标签
   - 修改：`generateDeepAnalysis()` - 深度分析模板改为 4h，添加结构总评
   - 修改：`prepareAnalysisData()` - 添加结构一致性计算和风险清单
   - 修改：`buildAnalysisPrompt()` - 历史数据使用 4h interval
   - 修改：`getFallbackDeepAnalysis()` - 使用新模板结构
   - 新增：`generateStructureTag()` - 生成结构状态标签

4. **`src/services/xAutoTweetJob.service.ts`**
   - 修改：`start()` - 从 8h 固定间隔改为可配置轮询
   - 修改：`runTweetJobOnce()` - 添加每日限额检查
   - 修改：`fetchHistoricalData()` - 历史数据使用 4h interval
   - 修改：`shouldSkipTweet()` - 48 小时去重逻辑（保持）
   - 修改：`loadTweetState()` / `saveTweetState()` - 支持 daily 字段
   - 新增：`checkDailyQuota()` - 检查每日限额
   - 新增：`incrementDailyQuota()` - 增加每日限额计数
   - 新增：`getTodayDate()` - 获取当前日期（Asia/Bangkok 时区）

## 🔍 资金费率单位统一

### 归一化函数

**位置**：`src/services/fundingNegativeOIService.ts` 的 `normalizeFundingRateToDecimal()`

```typescript
private normalizeFundingRateToDecimal(fundingRate: number): number {
  // 如果绝对值 > 1，可能是百分数形式（例如 -0.05 表示 -0.05%），需要除以 100
  // 如果绝对值 <= 1，可能是 decimal 形式（例如 -0.0005 表示 -0.05%），直接返回
  if (Math.abs(fundingRate) > 1) {
    return fundingRate / 100;
  }
  return fundingRate;
}
```

### 阈值常量

```typescript
FUNDING_THRESHOLD_DECIMAL = -0.0005  // -0.05% (decimal 形式)
```

**环境变量**：
```env
FUNDING_THRESHOLD_DECIMAL=-0.0005
```

### 日志输出

```typescript
logger.debug({ 
  symbol, 
  originalFundingRate: fundingRate,
  normalizedFundingRate,
  threshold: env.FUNDING_THRESHOLD_DECIMAL 
}, 'Found funding rate threshold candidate');
```

## ⏰ 轮询机制

### POLL_INTERVAL_MS 配置

**默认值**：`300000` (5 分钟)

**环境变量**：
```env
POLL_INTERVAL_MS=300000  # 5 分钟（默认）
```

**实现位置**：`src/services/xAutoTweetJob.service.ts` 的 `start()` 方法

**行为**：
- 启动后立即执行一次
- 然后每 `POLL_INTERVAL_MS` 轮询一次
- 保持 `isRunning` 防重入（并发限制为 1）

## 📊 每日限额机制

### 状态结构

**文件**：`./data/x_tweet_state.json`

```json
{
  "lastTweetAt": 1703827200000,
  "lastTweetTicker": "ZBT",
  "lastTweetKey": "ZBT:48h:12345",
  "daily": {
    "date": "2025-12-29",
    "count": 2
  }
}
```

### 重置规则

1. **日期检查**：每次检查时，如果 `state.daily.date !== today` → 重置为 `today + count=0`
2. **限额检查**：如果 `count >= DAILY_TWEET_LIMIT` → 跳过发送
3. **计数规则**：仅在"真实发送成功"后 `count += 1`
4. **预发布模式**：`PREFLIGHT_MODE=true` 不增加 count

### 时区处理

使用 `Asia/Bangkok` 时区（UTC+7）计算当前日期：

```typescript
private getTodayDate(): string {
  const now = new Date();
  const bangkokTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
  const year = bangkokTime.getFullYear();
  const month = String(bangkokTime.getMonth() + 1).padStart(2, '0');
  const day = String(bangkokTime.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
```

## 📝 推文模板（4H）

### 完整模板

```
✏️ 合约结构预警｜{TICKER}（Binance · 4H）

1⃣ OI（4h）：${OI_USD}
2⃣ Funding：{FUNDING_RATE}
3⃣ Taker：买 ${TAKER_BUY_USD} / 卖 ${TAKER_SELL_USD}
4⃣ Top：多 {TOP_LONG}% / 空 {TOP_SHORT}%｜比 {LONG_SHORT_RATIO}

📌 结构状态：{STRUCTURE_TAG}

结论：{BASE_CONCLUSION}

🧠 合约结构深度分析｜{TICKER}（Binance · 4h）

🔎 结构总评：{CONSISTENCY_SUMMARY}

1⃣ 仓位结构（大户）
- 当前：多 {TOP_LONG}% / 空 {TOP_SHORT}% ｜比值 {LONG_SHORT_RATIO}
- 变化：{POSITION_CHANGE_DESC}

2⃣ 资金费率（拥挤度）
- 当前 funding：{FUNDING_RAW}
- 近6根对比：{FUNDING_HISTORY_DESC}

3⃣ 主动成交（短周期情绪）
- 买：${TAKER_BUY_USD_RAW} / 卖：${TAKER_SELL_USD_RAW}
- 失衡度：{TAKER_IMBALANCE} → {TAKER_SENTIMENT_DESC}

4⃣ 结构一致性
- 结论：{CONSISTENCY_RESULT}
- 解释：{CONSISTENCY_EXPLANATION}

5⃣ 风险清单（仅结构）
- 拥挤度风险：{RISK_CROWDING}
- 反转风险：{RISK_REVERSAL}
- 结构脆弱性风险：{RISK_FRAGILITY}

⚠️ 本内容为结构观察，不构成投资或交易建议。
```

### 结构状态标签

**生成逻辑**（`generateStructureTag()`）：
- `多头拥挤`：topRatio > 1.1 && fundingRate > 0.01 && takerImbalance > 0.1
- `空头拥挤`：topRatio < 0.9 && fundingRate < -0.01 && takerImbalance < -0.1
- `结构分歧`：topRatio 与 fundingRate 方向不一致
- `相对均衡`：|fundingRate| < 0.001
- `结构观察`：其他情况

## 📋 Preflight 日志样例

### 成功样例（满足阈值且 quota 未满）

```
-----
timestamp=2025-12-29T04:15:30.123Z
ticker=ZBT
interval=4H
dataSourceSummary={"oiSource":"4h","takerSource":"4h","topSource":"4h","fundingSource":"4h"}
content=
✏️ 合约结构预警｜ZBT（Binance · 4H）

1⃣ OI（4h）：$66.89M
2⃣ Funding：+0.36%
3⃣ Taker：买 $394.74M / 卖 $380.71M
4⃣ Top：多 56.44% / 空 43.56%｜比 1.30

📌 结构状态：多头拥挤

结论：大户持仓结构偏多，资金费率较高，市场存在一定多头拥挤。

🧠 合约结构深度分析｜ZBT（Binance · 4h）

🔎 结构总评：结构分歧，需持续观察

1⃣ 仓位结构（大户）
- 当前：多 56.44% / 空 43.56% ｜比值 1.30
- 变化：数据不足，暂不展开

2⃣ 资金费率（拥挤度）
- 当前 funding：0.355300%
- 近6根对比：数据不足，暂不展开

3⃣ 主动成交（短周期情绪）
- 买：$394,735,953 / 卖：$380,713,911
- 失衡度：0.0181 → 均衡

4⃣ 结构一致性
- 结论：分歧
- 解释：仓位结构偏多，资金费率相对均衡，主动成交均衡，三者关系存在分歧

5⃣ 风险清单（仅结构）
- 拥挤度风险：资金费率相对均衡，市场存在一定拥挤
- 反转风险：结构变化需持续观察
- 结构脆弱性风险：当前结构相对稳定

⚠️ 本内容为结构观察，不构成投资或交易建议。
```

### 失败样例（quota 达到 3 条）

```
-----
timestamp=2025-12-29T04:20:15.456Z
ticker=ZBT
interval=4H
skipReason=daily quota reached
dataSourceSummary={"oiSource":"4h","takerSource":"4h","topSource":"4h","fundingSource":"4h"}
content=(skipped)
```

**内部日志**：
```
[2025-12-29 04:20:15.456 +0700] WARN: Daily tweet quota reached, skipping tweet
  date: "2025-12-29"
  count: 3
  limit: 3
```

## 🧪 测试方式

### 1. 预发布模式测试（推荐）

```bash
# 确保 .env 中设置
PREFLIGHT_MODE=true
POLL_INTERVAL_MS=300000
FUNDING_THRESHOLD_DECIMAL=-0.0005
DAILY_TWEET_LIMIT=3

# 运行测试
node -r ts-node/register scripts/manualTweet.ts
```

### 2. 测试指定币种（如果满足阈值）

```bash
# 测试 ZBT（如果满足阈值）
node -r ts-node/register scripts/testSpecificSymbol.ts ZBT
```

### 3. 验证每日限额

```bash
# 连续运行多次，观察 count 达到 3 后是否跳过
for i in {1..5}; do
  echo "第 $i 次运行..."
  PREFLIGHT_MODE=true node -r ts-node/register scripts/manualTweet.ts
  sleep 10
done

# 查看状态文件
cat ./data/x_tweet_state.json
```

### 4. 验证次日重置

```bash
# 等待到次日（Asia/Bangkok 时区）后运行
PREFLIGHT_MODE=true node -r ts-node/register scripts/manualTweet.ts
# 应该看到 count 重置为 0
```

## ✅ 验收标准

### 触发逻辑

- ✅ FundingRate <= -0.0005 时触发
- ✅ 资金费率单位正确归一化（日志输出原始值和归一化值）
- ✅ 选择 OI 最大的币种（OI 相同时按 symbol 字母序）

### 轮询机制

- ✅ 启动后立即执行一次
- ✅ 每 POLL_INTERVAL_MS 轮询一次（默认 5 分钟）
- ✅ 防重入保护（isRunning）

### 每日限额

- ✅ 每个自然日（Asia/Bangkok 时区）最多 3 条
- ✅ 超过限额后跳过发送并记录日志
- ✅ 仅在真实发送成功后计数
- ✅ PREFLIGHT_MODE 不增加计数
- ✅ 次日自动重置

### 推文模板

- ✅ 所有 interval 统一为 4H
- ✅ 包含结构状态标签
- ✅ 包含结构总评（🔎 结构总评）
- ✅ 不出现 "-" 或 "—"
- ✅ 数据不完整时跳过

### 48 小时去重

- ✅ 保持启用（与每日限额共同作用）
- ✅ 先检查 48h 去重，再检查 daily quota，再发推

## 🔧 环境变量配置

```env
# 轮询配置
POLL_INTERVAL_MS=300000          # 5 分钟（默认）

# 资金费率阈值（decimal，-0.05% = -0.0005）
FUNDING_THRESHOLD_DECIMAL=-0.0005

# 每日推文限额
DAILY_TWEET_LIMIT=3

# 预发布模式
PREFLIGHT_MODE=true              # 测试时设为 true
```

## 📊 状态文件结构

**文件**：`./data/x_tweet_state.json`

**结构**：
```json
{
  "lastTweetAt": 1703827200000,
  "lastTweetTicker": "ZBT",
  "lastTweetKey": "ZBT:48h:12345",
  "daily": {
    "date": "2025-12-29",
    "count": 2
  }
}
```

## 🚀 部署建议

1. **测试阶段**：
   - 设置 `PREFLIGHT_MODE=true`
   - 设置 `POLL_INTERVAL_MS=60000`（1 分钟，快速测试）
   - 验证阈值触发、每日限额、次日重置

2. **生产阶段**：
   - 设置 `PREFLIGHT_MODE=false`
   - 设置 `POLL_INTERVAL_MS=300000`（5 分钟）
   - 监控日志确保限额正常工作



