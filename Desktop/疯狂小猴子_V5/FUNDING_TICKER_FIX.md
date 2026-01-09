# 资金费率扫描板块 Ticker 点击修复文档

## 📋 修复概览

仅修复「资金费率扫描」板块中用户点击 Ticker 后的逻辑，使其与庄家轧空模块保持一致，走"合约数据概览 → 是否进一步分析 → DeepSeek"流程。

## ✅ 修复内容

### 1. 资金费率历史模块增强

**文件：** `src/routes/funding.ts`

**修改位置：** `handleFundingHistory` 函数（第 320-329 行）

**修改内容：**
- 在显示历史数据后，添加"📊 查看合约数据概览"按钮
- 点击该按钮会触发 `funding_ticker_{symbol}` callback
- 该 callback 已接入统一的 `handleTickerDetailsEntry` 函数

**修改前：**
```typescript
const keyboard = new InlineKeyboard()
  .text('🔄 查询其他币种', `funding_module_${module}`)
  .row()
  .text('🔙 返回', 'funding');
```

**修改后：**
```typescript
const keyboard = new InlineKeyboard()
  .text('📊 查看合约数据概览', `funding_ticker_${symbol}`)
  .row()
  .text('🔄 查询其他币种', `funding_module_${module}`)
  .row()
  .text('🔙 返回', 'funding');
```

### 2. 已存在的正确实现

以下部分已经正确实现，无需修改：

#### 2.1 Ticker 点击 Callback Handler
**文件：** `src/routes/funding.ts` 第 145-149 行

```typescript
bot.callbackQuery(/^funding_ticker_(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const ticker = ctx.match[1];
  await handleTickerDetailsEntry(ctx, ticker, 'funding', contractService, guard);
});
```

✅ 已正确接入统一的 `handleTickerDetailsEntry` 函数

#### 2.2 统一的 Ticker 详情入口
**文件：** `src/routes/tickerDetails.ts`

- `handleTickerDetailsEntry()` - 统一的入口函数
- `formatContractOverview()` - 格式化合约数据概览（固定模板）
- 已实现 Step A（概览）、Step B（询问按钮）、Step C（DeepSeek 分析）

#### 2.3 合约快照服务
**文件：** `src/services/contractSnapshot.service.ts`

- `getContractSnapshot()` - 获取合约快照
- `getFundingRateFromStablecoinList()` - 按优先级获取资金费率（Binance → Bybit → OKX → Gate.io）
- 已正确实现所有字段的获取逻辑

## 🔧 技术实现细节

### 字段口径（与庄家轧空一致）

1. **OI（合约持仓）**
   - 来源：`open_interest_usd`（4h 前）
   - 逻辑：从 `exchange-list` 汇总，优先使用 "All" 汇总

2. **Funding Rate（资金费率）**
   - 来源：`stablecoin_margin_list`
   - 优先级：Binance → Bybit → OKX → Gate.io
   - 若都没有：显示 `—`，不改变文案结构

3. **主动成交方向**
   - 来源：`taker_buy_volume_usd` / `taker_sell_volume_usd`（≥4h）

4. **大户持仓结构**
   - 来源：`top long/short position ratio history` 最新一期
   - 字段：`top_position_long_percent`, `top_position_short_percent`, `top_position_long_short_ratio`

### 空值策略

- 任意字段缺失：显示 `—`
- 必须完整输出概览模板，不能因为字段缺失而中断

### Snapshot 缓存

- 在 `handleTickerDetailsEntry` 中，snapshot 会被缓存
- 缓存 key：`{userId}:{source}:{ticker}`
- 缓存 TTL：30 分钟
- 按钮点击后直接使用缓存的 snapshot，不重复拉取接口

## 📁 修改文件清单

### 修改文件
1. **`src/routes/funding.ts`**
   - 第 320-329 行：在 `handleFundingHistory` 函数中添加"查看合约数据概览"按钮

### 无需修改的文件（已正确实现）
1. **`src/routes/funding.ts`** - Ticker callback handler 已正确接入
2. **`src/routes/tickerDetails.ts`** - 统一的入口函数已实现
3. **`src/services/contractSnapshot.service.ts`** - 合约快照服务已正确实现
4. **`src/services/contract.service.ts`** - DeepSeek 分析已正确实现

## 🎯 资金费率扫描板块 Ticker Callback Handler 定位

### 位置
**文件：** `src/routes/funding.ts`  
**行号：** 第 145-149 行

### 代码
```typescript
// 处理 ticker 按钮点击（仅在用户点击具体 ticker 后触发新逻辑）
bot.callbackQuery(/^funding_ticker_(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const ticker = ctx.match[1];
  await handleTickerDetailsEntry(ctx, ticker, 'funding', contractService, guard);
});
```

### 触发场景
1. **币种资金费率（交易所实时）** - Top10 列表中的 ticker 按钮
2. **累计资金费率（交易所）** - Top10 列表中的 ticker 按钮
3. **资金费率历史（K线）** - 显示历史数据后的"查看合约数据概览"按钮（新增）
4. **持仓加权资金费率历史（K线）** - 显示历史数据后的"查看合约数据概览"按钮（新增）
5. **成交量加权资金费率历史（K线）** - 显示历史数据后的"查看合约数据概览"按钮（新增）

## 🔄 新增/复用的 Snapshot 生成函数

### 主要函数调用链

1. **`handleTickerDetailsEntry()`** (`src/routes/tickerDetails.ts`)
   - 调用 → `contractService.getContractSnapshot(ticker)`

2. **`contractService.getContractSnapshot()`** (`src/services/contract.service.ts`)
   - 调用 → `snapshotService.getContractSnapshot(baseSymbol)`

3. **`snapshotService.getContractSnapshot()`** (`src/services/contractSnapshot.service.ts`)
   - 内部调用：
     - `getFundingRateFromStablecoinList()` - 获取资金费率（按优先级）
     - `getOpenInterestExchangeList()` - 获取 OI 数据
     - `getTopLongShortPositionRatioHistory()` - 获取大户持仓结构
     - `getTakerBuySellVolumeHistory()` - 获取主动成交数据

### 关键函数说明

**`getFundingRateFromStablecoinList()`** (`src/services/contractSnapshot.service.ts` 第 286-327 行)
- 从 `stablecoin_margin_list` 中按优先级选择资金费率
- 优先级：Binance → Bybit → OKX → Gate.io
- 若都没有，返回 null（会显示 `—`）

## ✅ 最小自测步骤

### 测试 1: 币种资金费率（交易所实时）

1. 发送 `/funding`
2. 选择「1️⃣ 币种资金费率（交易所实时）」
3. 选择「🔺 正资金费率最高」或「🔻 负资金费率最低」
4. **验证：** Top10 列表正常显示，包含 10 个 ticker 按钮
5. 点击某个 ticker 按钮（如 VRA）
6. **验证：** 显示"📊 正在获取 VRA 的合约数据..."
7. **验证：** 显示合约数据概览（固定模板，字段正确）
8. **验证：** 显示"🔍 是否需要进一步分析？"按钮
9. 点击"是，进行分析"
10. **验证：** 如果未解锁，显示解锁提示；如果已解锁，显示 DeepSeek 分析结果

### 测试 2: 累计资金费率（交易所）

1. 发送 `/funding`
2. 选择「2️⃣ 累计资金费率（交易所）」
3. 选择「🔺 正累计资金费率最高」或「🔻 负累计资金费率最低」
4. **验证：** Top10 列表正常显示
5. 点击某个 ticker 按钮
6. **验证：** 走完整的"概览 → 询问 → DeepSeek"流程

### 测试 3: 资金费率历史（K线）

1. 发送 `/funding`
2. 选择「3️⃣ 资金费率历史（K 线）」
3. 输入 ticker（如 BTC）
4. **验证：** 显示历史数据摘要
5. **验证：** 显示"📊 查看合约数据概览"按钮（新增）
6. 点击"📊 查看合约数据概览"按钮
7. **验证：** 显示合约数据概览
8. **验证：** 显示"🔍 是否需要进一步分析？"按钮
9. 点击"是，进行分析"
10. **验证：** 显示 DeepSeek 分析结果

### 测试 4: 持仓加权/成交量加权资金费率历史

1. 发送 `/funding`
2. 选择「4️⃣ 持仓加权资金费率历史（K 线）」或「5️⃣ 成交量加权资金费率历史（K 线）」
3. 输入 ticker
4. **验证：** 显示历史数据后，有"📊 查看合约数据概览"按钮
5. 点击按钮
6. **验证：** 走完整的"概览 → 询问 → DeepSeek"流程

### 测试 5: 字段验证

1. 选择一个可能缺数据的 ticker（如小众币种）
2. **验证：** 概览完整输出，缺项显示为 `—`
3. **验证：** Funding Rate 如果取不到，显示 `—` 或错误信息（不改变文案结构）
4. **验证：** "是否需要进一步分析"按钮正常显示

## 📝 备注

只修复了"资金费率扫描"板块内用户点击 ticker 后的逻辑，使其与庄家轧空的"合约概览→询问→DeepSeek 分析"完全一致。其他模块（庄家轧空、合约查询）未做任何改动。

