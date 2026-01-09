# 轧空/挤压筛选器 - CoinGlass API 端点清单

## 📋 需要的端点清单

### 1. OI 历史（K 线）
**端点**：`GET /api/futures/openInterest/ohlc-history`
**参数**：
- `symbol` (string, required) - 币种符号（如 BTC）
- `interval` (string, default: 1d) - 时间间隔
- `limit` (number, default: 45) - 返回条数（取最近 30 天窗口）

**返回字段**：
- `time` - 时间戳（ms）
- `open`, `high`, `low`, `close` - OI 值（string）

### 2. 大户账户多空比历史（优先）
**端点**：`GET /api/futures/top-long-short-account-ratio/history`
**参数**：
- `exchange` (string, required) - 交易所（默认 Binance）
- `symbol` (string, required) - 交易对符号（如 BTCUSDT）
- `interval` (string, default: 1d) - 时间间隔
- `limit` (number, default: 45) - 返回条数

**返回字段**：
- `time` - 时间戳（ms）
- `top_account_long_short_ratio` - 大户账户多空比

### 3. 全局账户多空比历史（Fallback）
**端点**：`GET /api/futures/global-long-short-account-ratio/history`
**参数**：
- `exchange` (string, required) - 交易所（默认 Binance）
- `symbol` (string, required) - 交易对符号（如 BTCUSDT）
- `interval` (string, default: 1d) - 时间间隔
- `limit` (number, default: 45) - 返回条数

**返回字段**：
- `time` - 时间戳（ms）
- `global_account_long_short_ratio` - 全局账户多空比

### 4. Taker Buy/Sell 历史（优先）
**端点**：`GET /api/futures/taker-buy-sell-volume/history`
**参数**：
- `exchange` (string, required) - 交易所（默认 Binance）
- `symbol` (string, required) - 交易对符号（如 BTCUSDT）
- `interval` (string, default: 1d) - 时间间隔
- `limit` (number, default: 45) - 返回条数

**返回字段**：
- `time` - 时间戳（ms）
- `taker_buy_volume_usd` - 主动买入量（USD）
- `taker_sell_volume_usd` - 主动卖出量（USD）
- `taker_buy_ratio` - 主动买入比例

### 5. Taker Buy/Sell 交易所列表（Fallback）
**端点**：`GET /api/futures/taker-buy-sell-volume/exchange-list`
**参数**：
- `symbol` (string, optional) - 币种符号
- `range` (string, optional) - 时间范围（如 1h）

**返回字段**：
- 数组，每个元素包含交易所的 taker buy/sell 数据

### 6. Basis 历史
**端点**：`GET /api/futures/basis/history`
**参数**：
- `exchange` (string, required) - 交易所（默认 Binance）
- `symbol` (string, required) - 交易对符号（如 BTCUSDT）
- `interval` (string, default: 1d) - 时间间隔
- `limit` (number, default: 45) - 返回条数

**返回字段**：
- `time` - 时间戳（ms）
- `basis` - 基差值（string/number）

### 7. 支持的币种列表
**端点**：`GET /api/futures/supported-coins`
**参数**：无

**返回字段**：
- `data` - 币种数组

### 8. 支持的交易所和交易对
**端点**：`GET /api/futures/supported-exchange-pairs`
**参数**：无

**返回字段**：
- 对象，key 为交易所名，value 为交易对数组

---

## 🔧 实现计划

1. 扩展 `CoinGlassClient` 添加新端点（如需要）
2. 重写 `SignalEngine` 按照新的打分标准（4类，每类0-25分）
3. 更新 `SqueezeScanService` 实现筛选条件和 Universe 策略
4. 更新 `squeeze.ts` 路由实现新的交互流程
5. 更新 DeepSeek Prompt 包含量化证据

