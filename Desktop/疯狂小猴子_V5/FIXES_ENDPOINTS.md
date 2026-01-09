# 修复与优化 - CoinGlass API 端点清单

## 📋 需要的端点清单

### A) 轧空筛选器 - Universe 获取

#### 1. 支持的币种列表
**端点**：`GET /api/futures/supported-coins`
**参数**：无
**返回**：币种数组（如 ["BTC", "ETH", "SOL", ...]）

---

### B) 合约查询 - OI 和多空比

#### 2. 币种市场数据（聚合）- 优先路径
**端点**：`GET /api/futures/coins-markets`
**参数**：
- `symbol` (string, optional) - 币种符号（如 BTC）
**返回字段**：
- `open_interest_usd` - OI 持仓（USD）
- `open_interest_quantity` - OI 持仓（数量）
- `funding_rate` - 资金费率（可能缺失）

#### 3. 持仓历史（K线）- Fallback 路径
**端点**：`GET /api/futures/openInterest/ohlc-history`
**参数**：
- `symbol` (string, required) - 币种符号（如 BTC）
- `exchange` (string, optional) - 交易所（如 Binance）
- `interval` (string, required) - 时间间隔（默认 1d）
- `limit` (number, default: 1) - 返回条数
- `start_time` (number, optional) - 开始时间（ms）
- `end_time` (number, optional) - 结束时间（ms）
- `unit` (string, optional) - 单位（usd/coin）
**返回字段**：
- `time` - 时间戳（ms）
- `open`, `high`, `low`, `close` - OI 值（string）

#### 4. 大户账户多空比历史
**端点**：`GET /api/futures/top-long-short-account-ratio/history`
**参数**：
- `exchange` (string, required) - 交易所（默认 Binance）
- `symbol` (string, required) - 交易对符号（如 BTCUSDT）
- `interval` (string, default: 1d) - 时间间隔
- `limit` (number, default: 1) - 返回条数
**返回字段**：
- `time` - 时间戳（ms）
- `top_account_long_percent` - 大户多军百分比
- `top_account_short_percent` - 大户空军百分比
- `top_account_long_short_ratio` - 大户多空比

#### 5. 币种主动买卖比（交易所列表）
**端点**：`GET /api/futures/taker-buy-sell-volume/exchange-list`
**参数**：
- `symbol` (string, required) - 币种符号（如 BTC）
- `range` (string, default: 24h) - 时间范围（1h/4h/24h）
**返回字段**：
- 顶层：`buy_ratio`, `sell_ratio`, `buy_vol_usd`, `sell_vol_usd`
- `exchange_list[]` - 交易所列表
  - `exchange` - 交易所名
  - `taker_buy_ratio` - 买入比例
  - `taker_sell_ratio` - 卖出比例

---

### C) 资金费率历史（K线）

#### 6. 资金费率历史（K线）
**端点**：`GET /api/futures/funding-rate/ohlc-history`
**参数**：
- `symbol` (string, required) - 币种符号（如 BTC，不是交易对）
- `interval` (string, required) - 时间间隔（默认 1d；支持 1m,3m,5m,15m,30m,1h,4h,6h,8h,12h,1d,1w）
- `limit` (number, default: 30) - 返回条数（<=1000）
- `start_time` (number, optional) - 开始时间（ms）
- `end_time` (number, optional) - 结束时间（ms）
**返回字段**：
- `time` - 时间戳（ms）
- `open`, `high`, `low`, `close` - 资金费率值（string）

#### 7. 持仓加权资金费率历史（K线）
**端点**：`GET /api/futures/funding-rate/oi-weight-ohlc-history`
**参数**：同 6（symbol/interval/limit/start_time/end_time）
**返回字段**：同 6（OHLC 格式）

#### 8. 成交量加权资金费率历史（K线）
**端点**：`GET /api/futures/funding-rate/vol-weight-ohlc-history`
**参数**：同 6（symbol/interval/limit/start_time/end_time）
**返回字段**：同 6（OHLC 格式）

---

## 🔧 实现计划

1. **CoinGlassClient 扩展**
   - 添加 `getFundingOiWeightOhlcHistory()` 方法
   - 确保所有资金费率历史接口使用正确的参数格式

2. **ContractSnapshotService 改造**
   - OI 获取：coins-markets 优先 + ohlc-history fallback
   - 删除 "24h 多/空军增加（估算）"
   - 新增：Top account L/S ratio + Taker buy/sell ratio

3. **FundingService 扩展**
   - 添加资金费率历史（K线）查询方法
   - 添加持仓加权和成交量加权历史查询

4. **SqueezeScanService 改造**
   - 添加蓝筹/山寨二选一逻辑
   - Universe 过滤实现

5. **路由和 Handler**
   - 更新 `/squeeze` 路由添加二选一菜单
   - 更新 `/contract` 路由输出格式
   - 更新 `/funding` 路由支持历史查询

