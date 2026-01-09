# Twitter 自动推送 Bug 修复 + 深度分析 + 预发布日志实现总结

## 1⃣ 新增/修改的文件列表

### 新增文件
1. **`src/utils/snapshotValidator.ts`** - 数据完整性校验工具
   - `SnapshotValidator.validate()` - 校验合约快照数据完整性
   - `SnapshotValidator.isFieldValid()` - 检查单个字段是否有效

2. **`src/utils/preflightLogger.ts`** - 预发布日志工具
   - `PreflightLogger.log()` - 记录预发布日志
   - `PreflightLogger.logIncompleteData()` - 记录数据不完整情况

3. **`src/utils/retry.ts`** - 重试工具（已存在，但新增了指数退避支持）
   - `RetryUtil.retry()` - 执行带重试的操作，支持指数退避

### 修改文件
1. **`src/config/env.ts`** - 环境变量配置
   - 新增：`PREFLIGHT_MODE` (boolean, 默认 false)
   - 新增：`DATA_RETRY_MAX` (number, 默认 3)
   - 新增：`DATA_RETRY_BACKOFF_MS` (number, 默认 10000)

2. **`src/services/tweetContent.service.ts`** - 推文内容生成服务
   - 修改：`generateTweet()` - 支持历史数据和深度分析
   - 新增：`generateBaseData()` - 生成基础数据部分（1⃣2⃣3⃣4⃣格式）
   - 新增：`generateDeepAnalysis()` - 生成深度分析（DeepSeek）
   - 新增：`prepareAnalysisData()` - 准备分析数据
   - 新增：`buildAnalysisPrompt()` - 构建分析 prompt
   - 新增：`validateAndFixAnalysisFormat()` - 验证并修复分析格式
   - 修改：构造函数 - 新增 `coinglass` 参数（可选）

3. **`src/services/xAutoTweetJob.service.ts`** - 自动发推任务服务
   - 修改：`runTweetJobOnce()` - 集成数据校验、重试、预发布、深度分析
   - 新增：`getSnapshotWithRetry()` - 带重试的快照获取
   - 新增：`fetchHistoricalData()` - 获取历史数据（用于深度分析）
   - 修改：构造函数 - 新增 `coinglass` 参数（可选）

4. **`src/bot/index.ts`** - Bot 主入口
   - 修改：初始化 `TweetContentService` - 传递 `coinglassClient`
   - 修改：初始化 `XAutoTweetJobService` - 传递 `coinglassClient`

## 2⃣ 数据完整性校验实现

### `isDataValid()` 实现逻辑

**位置**：`src/utils/snapshotValidator.ts`

**必需字段校验**：
1. **oiUsd** - OI 持仓总量，必须 > 0
2. **fundingRate** - 资金费率，不能为 null/undefined，且不能有 `fundingRateError`
3. **takerBuyVolUsd** - Taker 买入量，必须 > 0
4. **takerSellVolUsd** - Taker 卖出量，必须 > 0
5. **topAccountLongPercent** - 大户多单占比，必须 > 0
6. **topAccountShortPercent** - 大户空单占比，必须 > 0
7. **topAccountLongShortRatio** - 大户多空比，必须 > 0

**校验逻辑**：
- 检查字段是否为 `undefined`、`null`
- 检查数值字段是否 > 0
- 检查 `fundingRateError` 是否存在
- 返回 `ValidationResult`，包含 `isValid`、`missingFields`、`invalidFields`

## 3⃣ 重试机制实现

### 重试策略

**位置**：`src/utils/retry.ts`

**配置**（从环境变量读取）：
- `DATA_RETRY_MAX = 3` - 最大重试次数
- `DATA_RETRY_BACKOFF_MS = 10000` - 基础退避时间（10秒）

**指数退避算法**：
- 第 1 次重试：延迟 10 秒（10s * 2^0）
- 第 2 次重试：延迟 20 秒（10s * 2^1）
- 第 3 次重试：延迟 40 秒（10s * 2^2）

**实现位置**：
- `xAutoTweetJob.service.ts` 的 `getSnapshotWithRetry()` 方法
- 使用 `RetryUtil.retry()` 包装快照获取逻辑

**失败处理**：
- 如果多次重试仍失败：记录日志并跳过本轮（不发推文）
- 在预发布模式下：记录跳过原因到日志

## 4⃣ DeepSeek 深度分析实现

### 输入数据结构

**接口**：`HistoricalData`（定义在 `tweetContent.service.ts`）

```typescript
interface HistoricalData {
  fundingRateHistory: any[]; // 资金费率历史（6根，8h间隔）
  positionRatioHistory: any[]; // 持仓多空比历史（2根，用于对比）
  takerHistory: any[]; // Taker 历史（当前）
}
```

### Prompt 模板

**位置**：`src/services/tweetContent.service.ts` 的 `generateDeepAnalysis()` 方法

**系统 Prompt 约束**：
- 严格按照指定结构输出，使用 1⃣2⃣3⃣4⃣5⃣ 分点
- 不包含「做多/做空/买卖建议/目标价/价格预测」
- 只描述结构性特征
- 用简体中文输出
- 语气客观、专业，偏"结构观察"
- 不要输出 Markdown 标题符号
- 不要输出技术描述

**输出结构**（必须严格遵循）：
```
🧠 合约结构深度分析｜{TICKER}（Binance · 8H）

1⃣ 仓位结构（大户）
- 当前：多 xx.x% / 空 xx.x% ｜比值 x.xx
- 变化：{方向判断}。最新比值 x.xx（偏多/偏空/中性），上一根比值 x.xx（偏多/偏空/中性），变化幅度 x.xx，强度：{强/中/弱}

2⃣ 资金费率（拥挤度）
- 当前 funding：x.xxxxxx
- 近6根对比：
  - OI加权序列 [...]
  - 成交量加权序列 [...]
- OI加权 vs 成交量加权：{一致/不一致} → {结论一句话}

3⃣ 主动成交（短周期情绪）
- 买：xxxxxx / 卖：xxxxxx
- 失衡度：x.xxxx → {均衡/偏多/偏空}
- 计算：(buy-sell)/(buy+sell)=x.xxxx（展示到4位小数）

4⃣ 结构一致性
- 结论：{一致/分歧}
- 解释：{仓位结构、资金费率、主动成交三者关系一句话说明}

5⃣ 风险清单（仅结构）
- 拥挤度风险：{一句话}
- 反转风险：{一句话}
- 结构脆弱性风险：{一句话}

⚠️ 说明：结构分析不构成投资建议，不预测价格路径。
```

### 超时与失败处理

- **超时**：DeepSeek API 调用使用默认超时（30秒，在客户端配置）
- **失败处理**：
  - 如果深度分析生成失败：只使用基础数据部分，不发送包含深度分析的推文
  - 记录警告日志
  - 返回基础数据 + 说明

## 5⃣ 推文拼接器实现

### `composeTweet()` 保证输出框架恒定

**位置**：`src/services/tweetContent.service.ts` 的 `generateTweet()` 方法

**输出框架**：
```
[基础数据部分]

[深度分析部分]（如果可用）
```

**基础数据格式**（固定）：
```
✏️ 合约结构预警｜{TICKER}（Binance · 8H）

1⃣ OI（4h）：${OI_M}
2⃣ Funding：{FUNDING_PCT}
3⃣ Taker：买 ${TAKER_BUY_M} / 卖 ${TAKER_SELL_M}
4⃣ Top：多 {TOP_LONG}% / 空 {TOP_SHORT}%｜比 {RATIO}

📌 结论：{BASE_CONCLUSION}
```

**约束**：
- 若任一字段缺失则不进入拼接流程（回到数据校验与重试）
- 数值格式化保持稳定（M、%、小数位），不在推文中显示 "-"
- 如果深度分析失败，只输出基础数据 + 说明

## 6⃣ 预发布日志实现

### Preflight 写日志的实现

**位置**：`src/utils/preflightLogger.ts`

**日志路径**：
- 默认路径：`./logs/twitter_preflight.log`
- 若目录不存在则自动创建

**日志格式**：
```
-----
timestamp=2025-12-26T16:25:06.157Z
ticker=BCH
interval=8H
content=
[推文全文]
```

**行为要求**：
- Preflight 仍然必须走同样的数据校验与重试
- 如果数据不完整：只记录"跳过原因"到日志（内部日志可写明 missing fields）
- Preflight 完成后返回执行结果（console 或运行日志均可）

**配置**：
- 环境变量：`PREFLIGHT_MODE=true` 启用预发布模式
- 默认：`false`（正常发推）

## 7⃣ 实现顺序总结

1. ✅ **数据完整性校验** - 防止发出 "-"
2. ✅ **重试机制** - 解决短暂失败
3. ✅ **预发布模式** - 确保上线前可验证
4. ✅ **DeepSeek 深度分析** - 接入并拼接推文

## 8⃣ 注意事项

- ✅ 不把 "-" 当作 0 或替代值
- ✅ 不修改原有推文的基础字段含义
- ✅ 不变更原有的筛选/周期逻辑（仍然是 8h 筛选 OI 最大等）
- ✅ 日志只写本地文件，不推送到 TG，不上传
- ✅ 通过统一的 mapping 层解决字段命名不一致问题

## 9⃣ 环境变量配置示例

```env
# Twitter 自动推送配置
PREFLIGHT_MODE=false
DATA_RETRY_MAX=3
DATA_RETRY_BACKOFF_MS=10000
```

## 🔟 使用说明

### 正常模式（发送推文）
```bash
# .env 中设置
PREFLIGHT_MODE=false
```

### 预发布模式（只写日志，不发推文）
```bash
# .env 中设置
PREFLIGHT_MODE=true
```

运行后，推文内容会写入 `./logs/twitter_preflight.log`，不会实际发送到 Twitter。



