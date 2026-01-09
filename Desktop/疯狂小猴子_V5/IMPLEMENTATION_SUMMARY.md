# Twitter 自动推送：字段 Bug 修复 + 深度分析 + Preflight 实现总结

## 📋 改动文件列表

### 新增文件（5个）

1. **`src/utils/number.ts`** - 严格数值解析工具
   - `isFiniteNumber()` - 检查是否为有限数值
   - `parseNumberStrict()` - 严格解析数值（三态：undefined / number）
   - `parseNumberSafe()` - 安全解析数值（带默认值）

2. **`src/utils/coinglassGuard.ts`** - CoinGlass 响应守卫
   - `CoinGlassGuard.assertBusinessOk()` - 断言业务响应成功
   - `CoinGlassGuard.extractMeta()` - 提取响应元数据
   - `CoinGlassGuard.isValidData()` - 检查响应是否为有效数据

3. **`src/utils/rawDebugLogger.ts`** - Raw Debug 日志工具
   - `RawDebugLogger.log()` - 记录 CoinGlass 请求响应的原始数据

4. **`src/utils/snapshotValidator.ts`** - 数据完整性校验（已修改）
   - `SnapshotValidator.validate()` - 校验合约快照数据完整性（修正规则）
   - `SnapshotValidator.isFieldValid()` - 检查字段是否有效

5. **`src/utils/preflightLogger.ts`** - 预发布日志工具（已增强）
   - `PreflightLogger.log()` - 记录预发布日志（新增 dataSourceSummary 参数）
   - `PreflightLogger.logIncompleteData()` - 记录数据不完整情况

### 修改文件（4个）

1. **`src/config/env.ts`** - 环境变量配置
   - 新增：`PREFLIGHT_MODE` (boolean, 默认 false)
   - 新增：`DATA_RETRY_MAX` (number, 默认 3)
   - 新增：`DATA_RETRY_BACKOFF_MS` (number, 默认 10000)

2. **`src/services/contractSnapshot.service.ts`** - 合约快照服务
   - 所有 CoinGlass 请求后接入 `CoinGlassGuard.assertBusinessOk()`
   - 所有数值解析改为 `parseNumberStrict()`（禁止用 0 代表缺失）
   - 添加 `RawDebugLogger.log()` 记录原始响应

3. **`src/services/xAutoTweetJob.service.ts`** - 自动发推任务服务
   - `getSnapshotWithRetry()` - 返回快照和数据来源信息
   - `tryUpdate8hData()` - 使用 strict parse，禁止用 0 覆盖已有的 4h 值
   - `fetchHistoricalData()` - 接入 guard，记录 raw debug
   - 预发布日志记录时包含 `dataSourceSummary`

4. **`src/services/tweetContent.service.ts`** - 推文内容生成服务
   - `generateTweet()` - 固定框架：[基础数据] + 空行 + [深度分析] + 空行 + 风险提示
   - `generateBaseData()` - 使用 1⃣2⃣3⃣4⃣ 格式，不允许返回 "-"
   - `generateDeepAnalysis()` - 严格约束 DeepSeek 输出结构
   - `buildAnalysisPrompt()` - 构建严格模板约束 prompt
   - `validateAndFixAnalysisFormat()` - 验证并修复分析格式，检查禁止词
   - `getFallbackDeepAnalysis()` - Fallback 深度分析（当 DeepSeek 失败时使用）

## 🔍 Validator 字段规则

### 必需字段（必须 > 0 且为有限数值）

1. **oiUsd** - OI 持仓总量，必须 > 0
2. **takerBuyVolUsd** - Taker 买入量，必须 > 0
3. **takerSellVolUsd** - Taker 卖出量，必须 > 0
4. **topAccountLongPercent** - 大户多单占比，必须 > 0
5. **topAccountShortPercent** - 大户空单占比，必须 > 0
6. **topAccountLongShortRatio** - 大户多空比，必须 > 0

### 特殊字段（允许负值）

- **fundingRate** - 资金费率，允许为负（Funding < 0 是筛选条件），但必须为有限数值
  - 如果存在 `fundingRateError` → invalid（硬失败）
  - 如果为 NaN/Infinity → invalid

### 校验逻辑

- 使用 `isFiniteNumber()` 检查所有数值字段
- 区分 `missingFields`（undefined/null）和 `invalidFields`（NaN/Infinity/错误）
- `fundingRateError` 视为硬失败（invalid）

## 🤖 DeepSeek Prompt（System + User）

### System Prompt

```
你是一个专业的合约市场结构分析师。根据提供的合约数据，生成结构化的深度分析。

**严格约束**：
1. 必须严格按照以下结构输出，使用 1⃣2⃣3⃣4⃣5⃣ 分点，不允许多段落
2. 绝对不包含「做多/做空/买入/卖出/买卖建议/目标价/价格预测/建议」等词汇
3. 只描述结构性特征：仓位结构、资金费率、主动成交、一致性、风险
4. 用简体中文输出
5. 语气客观、专业，偏"结构观察"
6. 不要输出 Markdown 标题符号（如 ###）
7. 不要输出技术描述（如"API/限流/数据不足"），若数据不足可用非技术口吻说明

**输出结构（必须严格遵循，不允许修改）**：
🧠 合约结构深度分析｜{TICKER}（Binance · 8h）

1⃣ 仓位结构（大户）
- 当前：多 xx.x% / 空 xx.x% ｜比值 x.xx
- 变化：{方向判断}。最新比值 x.xx（偏多/偏空/中性），上一根比值 x.xx（偏多/偏空/中性），变化幅度 x.xx%，强度：{强/中/弱}

2⃣ 资金费率（拥挤度）
- 当前 funding：x.xxxxxx%
- 近6根对比：
  - OI加权序列：[序列值，用逗号分隔]
  - 成交量加权序列：[序列值，用逗号分隔]
- OI加权 vs 成交量加权：{一致/不一致} → {结论一句话}

3⃣ 主动成交（短周期情绪）
- 买：xxxxxx / 卖：xxxxxx
- 失衡度：x.xxxx → {均衡/偏多/偏空}
- 计算：(buy-sell)/(buy+sell)=x.xxxx

4⃣ 结构一致性
- 结论：{一致/分歧}
- 解释：{仓位结构、资金费率、主动成交三者关系一句话说明}

5⃣ 风险清单（仅结构）
- 拥挤度风险：{一句话}
- 反转风险：{一句话}
- 结构脆弱性风险：{一句话}

⚠️ 说明：结构分析不构成投资建议，不预测价格路径。
```

### User Prompt（示例）

```
合约数据：
- 币种：BCH
- 当前资金费率：-0.012345%
- 近6根资金费率序列：-0.010000%, -0.011000%, -0.012000%, -0.012345%, -0.013000%, -0.014000% （基于近6根资金费率，可计算 OI 加权和成交量加权趋势）
- 当前大户多单占比：45.20%
- 当前大户空单占比：54.80%
- 当前大户多空比：0.8250
- 持仓比变化：下降。最新比值 0.82（偏空），上一根比值 0.85（偏空），变化幅度 -3.53%，强度：弱
- Taker 买入：$70,639.30
- Taker 卖出：$81,829.70
- 失衡度计算：(buy-sell)/(buy+sell)=-0.0736

请严格按照要求的格式生成深度分析，必须包含 1⃣2⃣3⃣4⃣5⃣ 五个分点，不允许修改结构。
```

## 📝 Preflight 日志样例

### 成功样例

```
-----
timestamp=2025-12-29T03:32:45.098Z
ticker=BCH
interval=8H
dataSourceSummary={"oiSource":"4h","takerSource":"8h","topSource":"8h","fundingSource":"4h"}
content=
✏️ 合约结构预警｜BCH（Binance · 8H）

1⃣ OI（4h）：$76.47M
2⃣ Funding：-0.01%
3⃣ Taker：买 $70.64K / 卖 $81.83K
4⃣ Top：多 45.20% / 空 54.80%｜比 0.83

📌 结论：当前结构偏空，资金费率负值，市场存在一定拥挤。

🧠 合约结构深度分析｜BCH（Binance · 8h）

1⃣ 仓位结构（大户）
- 当前：多 45.20% / 空 54.80% ｜比值 0.83
- 变化：下降。最新比值 0.82（偏空），上一根比值 0.85（偏空），变化幅度 -3.53%，强度：弱

2⃣ 资金费率（拥挤度）
- 当前 funding：-0.012345%
- 近6根对比：
  - OI加权序列：[-0.010000, -0.011000, -0.012000, -0.012345, -0.013000, -0.014000]
  - 成交量加权序列：[-0.010000, -0.011000, -0.012000, -0.012345, -0.013000, -0.014000]
- OI加权 vs 成交量加权：一致 → 资金费率持续负值，市场存在一定拥挤

3⃣ 主动成交（短周期情绪）
- 买：$70,639.30 / 卖：$81,829.70
- 失衡度：-0.0736 → 偏空
- 计算：(buy-sell)/(buy+sell)=-0.0736

4⃣ 结构一致性
- 结论：一致
- 解释：仓位结构偏空，资金费率负值，主动成交偏空，三者关系一致

5⃣ 风险清单（仅结构）
- 拥挤度风险：资金费率持续负值，市场存在一定拥挤
- 反转风险：结构变化需持续观察
- 结构脆弱性风险：当前结构相对稳定

⚠️ 说明：结构分析不构成投资建议，不预测价格路径。

⚠️ 结构观察，不构成交易建议
```

### 失败样例（数据不完整）

```
-----
timestamp=2025-12-29T03:32:45.098Z
ticker=BCH
interval=8H
skipReason=数据不完整: 缺失字段=[takerBuyVolUsd, takerSellVolUsd, topAccountLongPercent, topAccountShortPercent], 无效字段=[fundingRate (has error)]
dataSourceSummary={"oiSource":"4h","takerSource":"4h","topSource":"4h","fundingSource":"error"}
content=(skipped)
```

## 🧪 测试方式

### 1. 预发布模式测试（推荐）

```bash
# 确保 .env 中设置
PREFLIGHT_MODE=true

# 运行测试
node -r ts-node/register scripts/manualTweet.ts
```

**预期结果**：
- 推文内容写入 `./logs/twitter_preflight.log`
- 不会实际发送推文
- 如果数据不完整，会记录 skipReason 和 dataSourceSummary

### 2. 正常模式测试（实际发推）

```bash
# 确保 .env 中设置
PREFLIGHT_MODE=false

# 运行测试
node -r ts-node/register scripts/manualTweet.ts
```

**预期结果**：
- 推文内容写入 `./logs/twitter_preflight.log`（如果启用）
- 实际发送推文到 Twitter
- 如果数据不完整，会跳过发送并记录日志

### 3. 查看 Raw Debug 日志

```bash
# 查看 CoinGlass API 原始响应日志
cat ./logs/coinglass_raw_debug.log | tail -50
```

**日志内容**：
- timestamp
- endpoint 名称
- symbol/pairSymbol/interval
- meta（success/code/msg/error）
- data length / 是否为空
- 关键字段原始值
- guard 判定结果（ok/fail + 原因）

### 4. 查看预发布日志

```bash
# 查看预发布日志
cat ./logs/twitter_preflight.log | tail -50
```

## ✅ 验收标准

### 字段 Bug 修复

- ✅ HTTP 200 但业务失败的响应会被 guard 识别并触发 retry
- ✅ 不会用 0 代表缺失值污染 snapshot
- ✅ 8h 数据失败时不会覆盖已有的 4h 值
- ✅ Validator 正确识别 funding 负值（允许）和错误（invalid）
- ✅ Raw debug 日志记录所有关键请求

### 推文结构

- ✅ 固定框架：[基础数据] + 空行 + [深度分析] + 空行 + 风险提示
- ✅ 基础数据使用 1⃣2⃣3⃣4⃣ 格式，不出现 "-"
- ✅ 深度分析使用 1⃣2⃣3⃣4⃣5⃣ 格式，严格约束结构
- ✅ DeepSeek 输出包含禁止词时会回退到 fallback

### Preflight

- ✅ 预发布模式只写日志，不发推文
- ✅ 记录 dataSourceSummary（4h/8h 数据来源）
- ✅ 记录 skipReason（数据不完整原因）

## 🔧 环境变量配置

```env
# Twitter 自动推送配置
PREFLIGHT_MODE=true          # 预发布模式（true=只写日志，false=实际发推）
DATA_RETRY_MAX=3              # 最大重试次数
DATA_RETRY_BACKOFF_MS=10000   # 基础退避时间（毫秒）
```

## 📊 日志文件位置

- **预发布日志**：`./logs/twitter_preflight.log`
- **Raw Debug 日志**：`./logs/coinglass_raw_debug.log`
- **应用日志**：`bot.log`（或控制台输出）

## 🚀 部署建议

1. **测试阶段**：使用 `PREFLIGHT_MODE=true` 验证推文格式和数据完整性
2. **生产阶段**：设置 `PREFLIGHT_MODE=false` 启用实际发推
3. **监控**：定期检查 `coinglass_raw_debug.log` 和 `twitter_preflight.log` 定位问题



