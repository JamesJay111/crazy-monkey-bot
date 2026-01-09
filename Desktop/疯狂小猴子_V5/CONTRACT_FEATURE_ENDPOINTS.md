# 合约查询功能 - CoinGlass API 端点清单

## 📋 需要的端点清单

### 1. 币种合约市场数据（聚合）
**端点**：`GET /api/futures/coins-markets`
**参数**：
- `symbol` (string, optional) - 币种符号
- 返回所有币种或指定币种的市场数据

**返回字段**：
- `symbol` - 币种符号
- `open_interest_usd` - OI 持仓总量（USD）
- `funding_rate` - 当前资金费率
- `long_volume_usd` - 多军成交量（USD）
- `short_volume_usd` - 空军成交量（USD）
- `open_interest_change_percent_24h` - OI 24h 变化百分比
- `long_short_ratio` - 多空比（如果存在）

### 2. 全网账户多空比历史
**端点**：`GET /api/futures/global-long-short-account-ratio/history`
**参数**：
- `symbol` (string, required) - 币种符号
- `interval` (string, default: 1h) - 时间间隔
- `limit` (number, default: 1) - 获取最近 1 条

**返回字段**：
- `time` - 时间戳（ms）
- `global_account_long_percent` - 多军账户百分比
- `global_account_short_percent` - 空军账户百分比
- `global_account_long_short_ratio` - 多空比

### 3. 资金费率交易所列表（Fallback）
**端点**：`GET /api/futures/funding-rate/exchange-list`
**参数**：
- `symbol` (string, optional) - 币种符号

**返回字段**：
- 数组，每个元素包含 `{ symbol, stablecoin_margin_list[], token_margin_list[] }`
- 每个交易所项包含 `funding_rate`, `exchange`, `next_funding_time`

### 4. 交易对爆仓历史
**端点**：`GET /api/futures/liquidation/history`
**参数**：
- `exchange` (string, required) - 交易所（默认 Binance）
- `symbol` (string, required) - 交易对符号（如 BTCUSDT）
- `interval` (string, required) - 时间间隔（默认 1d）
- `limit` (number, default: 10) - 返回条数
- `start_time` (number, optional) - 开始时间（ms）
- `end_time` (number, optional) - 结束时间（ms）

**返回字段**：
- `time` - 时间戳（ms）
- `long_liquidation_usd` - 多单爆仓（USD，string/number）
- `short_liquidation_usd` - 空单爆仓（USD，string/number）

### 5. 支持的交易所和交易对（用于验证）
**端点**：`GET /api/futures/supported-exchange-pairs`
**参数**：无

**返回字段**：
- 对象，key 为交易所名，value 为交易对数组
- 每个交易对包含 `base_asset`, `quote_asset`, `instrument_id`

### 6. 资金费率历史（用于分析，可选）
**端点**：`GET /api/futures/funding-rate/ohlc-history`
**参数**：
- `symbol` (string, required)
- `interval` (string, default: 1d)
- `limit` (number, default: 30)

### 7. OI 历史（用于分析，可选）
**端点**：`GET /api/futures/openInterest/ohlc-history`
**参数**：
- `symbol` (string, required)
- `interval` (string, default: 1d)
- `limit` (number, default: 30)

---

## 🔧 实现计划

1. 扩展 `CoinGlassClient` 添加新端点
2. 创建 `LiquidationService` 处理爆仓数据
3. 创建 `ContractSnapshotService` 聚合所有数据
4. 更新 `ContractService` 整合新功能
5. 更新 `/contract` 路由支持新交互
6. 创建 DeepSeek 分析 Prompt

