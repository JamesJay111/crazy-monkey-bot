# 轧空/挤压筛选器 - 完整实现文档

## ✅ 实现完成

已成功实现完整的「庄家轧空/多空挤压」量化筛选器功能，按照新标准（4类信号，每类0-25分，总分0-100）。

---

## 📋 功能概述

### 1. 产品交互

#### 免费阶段：输出 Top 15 列表
- 用户点击「🔍 庄家轧空/多空挤压」按钮
- Bot 输出过去 30 天「疑似 Short Squeeze（轧空）」Top 15
- 每行显示：`Ticker | Score | 关键触发点摘要（最多1句）`
- 每个 ticker 作为可点击按钮

#### 付费阶段：详细结构分析
- 用户点击某个 Ticker → 触发付费墙
- 已解锁（2999 Stars 或邀请码 Ocean001）→ 展示详细分析
- 未解锁 → 提示付费或输入邀请码

### 2. 量化定义（新标准）

#### A) OI 节奏：先缩后扩（0~25分）
- **接口**：`GET /api/futures/openInterest/ohlc-history?symbol={BASE}&interval=1d&limit=45`
- **计算**：
  - `oi_peak` = 30天内最高 close
  - `oi_trough` = 30天内最低 close
  - `oi_last` = 最新 close
  - `drawdown_pct` = (oi_trough - oi_peak) / oi_peak（负数）
  - `rebound_pct` = (oi_last - oi_trough) / oi_trough
- **打分规则**：
  - 若 `drawdown_pct <= -0.12` 且 `rebound_pct >= 0.18` → 22~25 分（强"清洗→堆杠杆"）
  - 若 `drawdown_pct <= -0.08` 且 `rebound_pct >= 0.12` → 16~21 分
  - 否则 0~15 分（按 rebound_pct 线性映射）

#### B) 多空反转：大户/账户多空比从低位抬升（0~25分）
- **接口优先**：`GET /api/futures/top-long-short-account-ratio/history?exchange=Binance&symbol={PAIR}&interval=1d&limit=45`
- **Fallback**：`GET /api/futures/global-long-short-account-ratio/history?exchange=Binance&symbol={PAIR}&interval=1d&limit=45`
- **计算**：
  - `ls_min_14d` = 近14天 ratio 最低值
  - `ls_last` = 最新 ratio
  - `ls_jump` = ls_last / ls_min_14d
- **打分规则**：
  - 若 `ls_min_14d <= 0.6` 且 `ls_jump >= 1.8` → 20~25（强反转）
  - 若 `ls_min_14d <= 0.8` 且 `ls_jump >= 1.4` → 14~19
  - 否则 0~13（按 ls_jump 映射）

#### C) 主动买量：taker buy 上升（0~25分）
- **接口优先**：`GET /api/futures/taker-buy-sell-volume/history?exchange=Binance&symbol={PAIR}&interval=1d&limit=45`
- **Fallback**：`GET /api/futures/taker-buy-sell-volume/exchange-list?symbol={BASE}`
- **计算**：
  - `taker_buy_ratio_last`
  - `taker_buy_ratio_ma7` vs `taker_buy_ratio_ma30` 的偏离度
  - `taker_spike_flag`: 最近3天是否有 > 30天均值 1.5 倍的放量
- **打分规则**：
  - 若 `taker_buy_ratio_ma7 - taker_buy_ratio_ma30 >= 0.08` 或 `taker_spike_flag==true` → 16~25
  - 否则 0~15（偏离度映射）

#### D) 基差：合约溢价扩大（0~25分）
- **接口**：`GET /api/futures/basis/history?exchange=Binance&symbol={PAIR}&interval=1d&limit=45`
- **计算**：
  - `basis_last`
  - `basis_p90_30d`（30天90分位）
  - `basis_jump_3d` = basis_last - basis_3days_ago
- **打分规则**：
  - 若 `basis_last >= basis_p90_30d` 且 `basis_jump_3d >= 0.003` → 18~25
  - 若 `basis_jump_3d >= 0.0015` → 10~17
  - 否则 0~9

### 3. 筛选条件（硬过滤）

只有满足以下条件之一的 ticker 才进入候选池：
- **条件1**：`OI分 >= 16` 且（`多空反转分 >= 14` 或 `基差分 >= 10`）
- **条件2**：`总分 >= 65`

然后按总分降序，输出 Top 15。

### 4. Universe（候选币池）策略

- 从 `GET /api/futures/supported-coins` 获取币种列表
- 优先使用硬编码的主流币种列表（50+ 币种）
- 默认 Universe 大小：80（可配置）
- Pair 映射：默认 `{BASE}USDT`
- 校验 pair 是否支持：`/api/futures/supported-exchange-pairs`（Binance）

---

## 🔧 技术实现

### 1. 新增/更新的服务

#### `SignalEngine` (`src/services/signalEngine.service.ts`)
- **重写**：按照新标准实现 4 类信号计算
- **方法**：
  - `calculateFeatures(baseSymbol, pairSymbol, days)` - 计算特征
  - `calculateScore(features)` - 计算得分（4类，每类0-25分）
  - `determineSqueezeType(features, breakdown)` - 判断轧空类型

#### `SqueezeScanService` (`src/services/squeezeScan.service.ts`)
- **重写**：实现筛选条件和 Universe 策略
- **方法**：
  - `scanTopN(topN, days)` - 扫描 Universe 并返回 Top N
  - `getTickerDetails(baseSymbol, days)` - 获取单个 ticker 的详细特征和得分
  - `passesFilter(breakdown)` - 筛选条件判断
  - `generateSummary(features, breakdown)` - 生成关键触发点摘要

#### `CoinGlassClient` 扩展
- **新增端点**：
  - `getTakerBuySellVolumeHistory()` - Taker Buy/Sell 历史
  - `getTopLongShortAccountRatioHistory()` - 大户账户多空比历史（支持 exchange 参数）
  - `getBasisHistory()` - 基差历史（支持 exchange 参数）
  - `getGlobalLongShortRatioHistoryInternal()` - 全局账户多空比历史（支持 exchange 参数）

### 2. 路由和交互

#### `squeeze.ts` (`src/routes/squeeze.ts`)
- **重写**：实现新的交互流程
- **功能**：
  - `handleSqueezeList()` - 处理 Top 15 列表（免费阶段）
  - `handleSqueezeDetail()` - 处理单个 ticker 详情（付费阶段）
  - `generateDeepSeekAnalysis()` - 生成 DeepSeek 分析
  - `formatSqueezeAnalysis()` - 格式化分析结果

### 3. DeepSeek Prompt

#### `squeeze.prompt.ts` (`src/prompts/squeeze.prompt.ts`)
- **更新**：包含量化证据（evidence）字段
- **输出格式**：
  ```json
  {
    "ticker": "...",
    "structure": "short_squeeze_like|long_squeeze_like|neutral",
    "score": 0-100,
    "confidence": 0-100,
    "evidence": [
      "OI: drawdown=-12.4%, rebound=+19.1%",
      "LS: min14d=0.52 → last=0.96 (jump=1.85x)",
      "Basis: last=0.0062, jump3d=+0.0034",
      "Taker: ma7-ma30=+0.09"
    ],
    "interpretation": "≤140字",
    "whatToWatch": ["...","...","..."],
    "disclaimer": "非投资建议"
  }
  ```

### 4. 类型定义

#### `types/index.ts`
- **更新**：`ScoreBreakdown` 接口（新标准：4类，每类0-25分）
  ```typescript
  {
    oi_rhythm: number; // 0-25
    ls_ratio_reversal: number; // 0-25
    taker_buy_bias: number; // 0-25
    basis_expansion: number; // 0-25
    total: number; // 0-100
  }
  ```

---

## 🧪 本地验收

### 测试步骤

1. **测试免费阶段**
   ```
   /squeeze
   ```
   预期：
   - 显示 Top 15 列表
   - 每行包含：Ticker | Score | 关键触发点摘要
   - 每个 ticker 可点击

2. **测试付费阶段**
   - 点击某个 Ticker
   - 未解锁：显示付费墙
   - 输入邀请码 `Ocean001` 或支付 2999 Stars
   - 查看详细分析（包含分项得分、量化证据、AI 解释）

3. **测试筛选条件**
   - 验证只有满足条件的 ticker 才会出现在列表中
   - 验证排序按总分降序

### 验收标准

- ✅ `/squeeze` 能稳定输出 Top 15 列表
- ✅ 列表包含关键触发点摘要
- ✅ 点击 ticker 触发付费墙（未解锁时）
- ✅ 已解锁后显示详细分析（包含分项得分、量化证据）
- ✅ DeepSeek 分析包含量化证据（必须引用数值）
- ✅ 筛选条件正确执行（硬过滤）
- ✅ 缓存和限流正常工作

---

## 📚 相关文件

- `src/services/signalEngine.service.ts` - 信号引擎（新标准）
- `src/services/squeezeScan.service.ts` - 扫描服务（筛选条件）
- `src/routes/squeeze.ts` - 路由和交互
- `src/prompts/squeeze.prompt.ts` - DeepSeek Prompt（包含量化证据）
- `src/clients/coinglass.client.ts` - CoinGlass API 客户端（已扩展）
- `src/types/index.ts` - 类型定义（已更新）

---

## 🔄 后续优化

1. **更精确的 Taker Buy/Sell 计算**
   - 当前使用简化逻辑
   - TODO: 接入更严格的历史数据计算 ma7/ma30

2. **Universe 自动选择**
   - 当前使用硬编码列表
   - TODO: 使用 markets API 自动选择活跃币种

3. **实时更新**
   - 当前缓存 TTL 15 分钟
   - TODO: 支持 WebSocket 实时推送

4. **更多筛选条件**
   - 当前只有硬过滤
   - TODO: 支持用户自定义筛选条件

