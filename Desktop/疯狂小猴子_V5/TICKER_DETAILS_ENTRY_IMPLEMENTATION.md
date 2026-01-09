# 统一 Ticker 详情入口实现文档

## 📋 实现概览

在保持原有交互流程完全不变的前提下，新增统一的 Ticker 详情入口逻辑。仅在用户点击具体 Ticker 后触发「合约数据概览 → 进一步分析 → DeepSeek」。

## 🎯 核心原则

- ✅ **原有交互流程绝对不改变**
- ✅ **仅在用户点击具体 Ticker 后触发新逻辑**
- ✅ **Top10 列表展示方式不变**
- ✅ **选择筛选条件流程不变**

## 📁 修改文件清单

### 新增文件
1. **`src/routes/tickerDetails.ts`** - 统一的 Ticker 详情入口模块
   - `handleTickerDetailsEntry()` - 主要入口函数
   - `formatContractOverview()` - 格式化合约数据概览
   - `handleAnalysisAsk()` - 处理"是否需要进一步分析"按钮
   - `handleAnalysisRun()` - 执行 DeepSeek 分析
   - `handleAnalysisNo()` - 处理"否"按钮
   - `registerTickerDetailsCallbacks()` - 注册统一的 callback 处理

### 修改文件
1. **`src/routes/funding.ts`**
   - 修改 `registerFundingRoute()` 签名，添加 `contractService` 和 `guard` 参数
   - 新增 `funding_ticker_` callback 处理，调用 `handleTickerDetailsEntry()`
   - 修改按钮生成逻辑，显示所有10个按钮（而不是5个）

2. **`src/routes/squeeze.ts`**
   - 修改 `registerSqueezeRoute()` 签名，添加 `contractService` 参数
   - 修改 `squeeze_detail_` callback，调用 `handleTickerDetailsEntry()` 而不是 `handleSqueezeDetail()`
   - 移除 `funding_ticker_` callback（已移至 funding.ts）

3. **`src/bot/index.ts`**
   - 更新 `registerFundingRoute()` 调用，传入 `contractService` 和 `guard`
   - 更新 `registerSqueezeRoute()` 调用，传入 `contractService`
   - 注册 `registerTickerDetailsCallbacks()`

4. **`src/services/contractSnapshot.service.ts`**
   - 修改 `fundingRateError` 文本为："该Ticker暂无主流交易所合约资金费率数据"

## 🔧 核心功能说明

### 1. 统一的 Ticker 详情入口流程

**Step 1：合约数据概览**
- 获取合约快照（复用 `ContractService.getContractSnapshot()`）
- 格式化并发送概览消息（固定模板）
- 缓存 snapshot 供后续分析使用

**Step 2：询问是否进一步分析**
- 发送询问按钮（Inline Keyboard）
- 按钮：`🔍 是，进行分析` / `❌ 否`

**Step 3：DeepSeek 分析（用户点击后）**
- 从缓存获取 snapshot（不重新拉取数据）
- 调用 `ContractService.analyzeContract()` 进行分析
- 复用"合约查询（Ticker）"的结构分析逻辑

### 2. 合约数据概览格式（固定模板）

```
📊 合约数据概览｜{TICKER}

📌 合约持仓（OI）
总持仓（4h 前）：${open_interest_usd}

💰 当前资金费率
Funding Rate：{funding_rate}

📉 主动成交方向
主动买入：${taker_buy_volume_usd}
主动卖出：${taker_sell_volume_usd}

🐳 大户持仓结构（最近一周期）
多单占比：{top_position_long_percent}%
空单占比：{top_position_short_percent}%
多空比：{top_position_long_short_ratio}

⏱ 数据说明：
所有数据基于 ≥4h 粒度的合约市场统计
```

**空值策略：**
- 任一字段缺失则显示 `—`
- 整条概览必须完整输出，不能因为某字段空就中断

### 3. Snapshot 缓存机制

**缓存 Key 格式：**
```
{userId}:{source}:{ticker}
```

**示例：**
- `123456789:funding:BTC`
- `123456789:squeeze:ETH`

**缓存 TTL：** 30分钟

**使用场景：**
- 用户点击"是否需要进一步分析"后，从缓存获取 snapshot
- 不重新拉取数据，确保分析使用的是概览时的数据

### 4. Callback 数据格式

**询问按钮：**
- `analysis:ask:{source}:{ticker}` - 是否需要进一步分析
- `analysis:no:{source}:{ticker}` - 否

**分析按钮（已解锁）：**
- `analysis:run:{source}:{ticker}` - 执行分析

**邀请码按钮：**
- `analysis:code:{source}:{ticker}` - 输入邀请码

## 🎨 适配范围

### 1. 资金费率模块

**接入点：** `src/routes/funding.ts`

**流程：**
1. 用户选择正/负资金费率 → 输出 Top10 → 生成 ticker 按钮（**保持不变**）
2. 用户点击 ticker 按钮（如 VRA）→ 触发 `handleTickerDetailsEntry()`
3. 显示合约数据概览 → 询问是否进一步分析
4. 用户点击"是" → 执行 DeepSeek 分析

**修改内容：**
- 在 `registerFundingRoute()` 中注册 `funding_ticker_` callback
- 修改按钮生成逻辑，显示所有10个按钮（每行2个）

### 2. 庄家轧空/多空挤压模块

**接入点：** `src/routes/squeeze.ts`

**流程：**
1. 用户查看推荐列表（**保持不变**）
2. 用户点击 ticker 按钮 → 触发 `handleTickerDetailsEntry()`
3. 显示合约数据概览 → 询问是否进一步分析
4. 用户点击"是" → 执行 DeepSeek 分析

**修改内容：**
- 修改 `squeeze_detail_` callback，调用 `handleTickerDetailsEntry()`
- 移除原有的 `handleSqueezeDetail()` 调用（但保留函数定义，以防其他地方使用）

### 3. 合约查询模块

**保持不变：** 合约查询模块已有自己的概览+分析流程，不需要修改

## ✅ 验收标准

### 资金费率模块
- ✅ 从选择正/负资金费率 → 输出 Top10 → 生成 ticker 按钮，过程不变
- ✅ 只有点 ticker 按钮后才出现概览与进一步分析按钮
- ✅ Top10 列表文案和排序不变

### 庄家轧空/多空挤压
- ✅ 列表页不变
- ✅ 点 ticker 后出现概览与进一步分析按钮
- ✅ 深度分析复用合约查询的结构分析风格

### 缺字段情况
- ✅ 概览仍完整输出，缺项为 `—`
- ✅ 不影响"是否进一步分析"按钮显示

## 📝 最小自测路径

### 测试路径1：资金费率模块

1. 发送 `/funding`
2. 选择「1️⃣ 币种资金费率（交易所实时）」
3. 选择「🔺 正资金费率最高」
4. **验证：** Top10 列表正常显示，包含10个 ticker 按钮
5. 点击某个 ticker 按钮（如 VRA）
6. **验证：** 显示合约数据概览
7. **验证：** 显示"是否需要进一步分析"按钮
8. 点击"是，进行分析"
9. **验证：** 如果未解锁，显示解锁提示
10. **验证：** 如果已解锁，显示 DeepSeek 分析结果

### 测试路径2：庄家轧空模块

1. 发送 `/squeeze` 或点击「🔍 庄家轧空/多空挤压」
2. **验证：** 推荐列表正常显示（包含标签和风险&可信度）
3. 点击某个 ticker 按钮（如 BTC）
4. **验证：** 显示合约数据概览
5. **验证：** 显示"是否需要进一步分析"按钮
6. 点击"是，进行分析"
7. **验证：** 显示 DeepSeek 分析结果（复用合约查询的结构分析风格）

### 测试路径3：缺字段情况

1. 选择一个可能缺数据的 ticker（如小众币种）
2. **验证：** 概览完整输出，缺项显示为 `—`
3. **验证：** "是否需要进一步分析"按钮正常显示
4. 点击"是，进行分析"
5. **验证：** 分析正常执行（即使部分字段缺失）

## 🔍 技术细节

### Snapshot 缓存实现

```typescript
const snapshotCache = new Map<string, {
  snapshot: ContractSnapshot;
  timestamp: number;
}>();

// 缓存 Key: {userId}:{source}:{ticker}
// TTL: 30分钟
```

### 字段口径（与合约查询模块一致）

- **OI：** `open_interest_usd`（4h 前数据）
- **Funding Rate：** `stablecoin_margin_list` → 优先级：Binance → Bybit → OKX → Gate.io
- **主动成交方向：** `taker_buy_volume_usd` / `taker_sell_volume_usd`（≥4h）
- **大户结构：** `top long/short position ratio history` 最近一期

### 权限检查

- 概览阶段：**无需权限**（免费）
- 分析阶段：**需要解锁**（检查 `guard.isUnlocked()`）

## 🚀 部署注意事项

1. **向后兼容：** 所有原有功能保持不变
2. **缓存清理：** Snapshot 缓存会在30分钟后自动过期
3. **错误处理：** 如果缓存过期或缺失，提示用户重新查询

