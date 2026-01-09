# Binance OI 异动推送配置说明

## 功能概述

Binance 合约 OI 异动推送到 Lark Webhook 模块，用于监控 Binance 交易所各币种的未平仓合约（Open Interest, OI）变化，当满足阈值条件时自动推送到指定的 Lark Webhook。

## 环境变量配置

在 `.env` 文件中添加以下配置项：

```env
# Binance OI 异动推送配置
OI_ALERT_POLL_INTERVAL_MS=300000          # 轮询间隔（毫秒），默认 5 分钟
OI_ALERT_THRESHOLD_PERCENT=10             # OI 变化阈值（百分比），默认 10%
OI_ALERT_COOLDOWN_MS=3600000              # 冷却时间（毫秒），默认 60 分钟
LARK_WEBHOOK_OI_ALERT=https://open.larksuite.com/open-apis/bot/v2/hook/xxx  # OI 异动专用 Webhook URL（可选）
LARK_WEBHOOK_URL=https://open.larksuite.com/open-apis/bot/v2/hook/xxx      # 通用 Lark Webhook URL（fallback）
```

### 配置项说明

- **OI_ALERT_POLL_INTERVAL_MS**: 扫描频率，默认每 5 分钟执行一次
- **OI_ALERT_THRESHOLD_PERCENT**: 触发推送的 OI 变化阈值，默认 10%（即 abs(ΔOI_1h%) >= 10%）
- **OI_ALERT_COOLDOWN_MS**: 同一 ticker 的冷却时间，默认 60 分钟
- **LARK_WEBHOOK_OI_ALERT**: OI 异动专用的 Lark Webhook URL（如果设置，优先使用）
- **LARK_WEBHOOK_URL**: 通用 Lark Webhook URL（如果 LARK_WEBHOOK_OI_ALERT 未设置，使用此 URL）

## 数据库表结构

系统会自动创建 `binance_oi_alert_cooldown` 表用于存储冷却状态：

```sql
CREATE TABLE IF NOT EXISTS binance_oi_alert_cooldown (
  ticker TEXT PRIMARY KEY,
  last_sent_at_utc_ms INTEGER NOT NULL,
  last_direction INTEGER NOT NULL CHECK(last_direction IN (-1, 0, 1)),
  last_oi_change_percent REAL NOT NULL,
  created_at_utc_ms INTEGER NOT NULL,
  updated_at_utc_ms INTEGER NOT NULL
);
```

## 触发条件

1. **交易所**: 固定为 Binance
2. **阈值**: `abs(ΔOI_1h%) >= OI_ALERT_THRESHOLD_PERCENT`（默认 10%）
3. **冷却机制**: 
   - 同一 ticker 在冷却时间内（默认 60 分钟）只允许推送一次
   - 如果方向反转（由正转负或由负转正）且仍满足阈值，可突破冷却

## 消息格式

推送消息包含以下字段：

1. **当前未平仓合约总量** (OI_now_usd) → 显示为 XXM（百万美元，保留 1 位小数）
2. **未平仓合约 1 小时变化** (ΔOI_1h%) → 带正负号，保留 2 位小数
3. **价格 1 小时变化** (ΔP_1h%) → 带正负号，保留 2 位小数
4. **未平仓合约 4 小时变化** (ΔOI_4h%) → 带正负号，保留 2 位小数
5. **价格 4 小时变化** (ΔP_4h%) → 带正负号，保留 2 位小数
6. **当前市值** (MC_now_usd) → 显示为 XXM（百万美元，保留 1 位小数），如果不可用显示 "—"
7. **未平仓合约/市值比率** (OI/MC%) → 保留 2 位小数，如果不可用显示 "—"
8. **24h 价格变化** (ΔP_24h%) → 带正负号，保留 2 位小数，如果不可用显示 "—"
9. **DeepSeek 解读** → 20-30 个中文字符的市场解读

### 图标规则

- 🔴: OI 下降（ΔOI_1h% < 0）
- 🟢: OI 上升（ΔOI_1h% > 0）
- ⚪: OI 无变化（ΔOI_1h% = 0）

## 数据获取

系统使用 CoinGlass API 获取以下数据：

1. **OI 数据**: 通过 `getOpenInterestOhlcHistory` 获取历史 OI 数据
2. **价格数据**: 通过 `getFuturesPairsMarkets` 获取当前价格和历史价格
3. **市值数据**: 如果 CoinGlass 提供，则使用；否则返回 null（显示为 "—"）

## 本地运行与验证

### 1. 启动 Bot

```bash
npm run start
# 或
node -r ts-node/register src/bot/index.ts
```

### 2. 查看日志

服务启动后，会在日志中输出：

```
✅ Binance OI 异动推送任务已启动（每5分钟）
```

### 3. 测试推送

可以使用 mock webhook 进行测试：

1. 使用 [webhook.site](https://webhook.site) 或类似服务生成测试 webhook URL
2. 在 `.env` 中设置 `LARK_WEBHOOK_OI_ALERT` 为测试 URL
3. 重启 Bot，等待触发条件满足
4. 在 webhook.site 查看接收到的消息

### 4. 手动触发测试

可以修改代码临时降低阈值或缩短冷却时间进行测试：

```typescript
// 临时测试配置
private readonly OI_THRESHOLD_PERCENT = 1; // 降低阈值到 1%
private readonly COOLDOWN_MS = 1 * 60 * 1000; // 缩短冷却到 1 分钟
```

## 单元测试

系统包含以下单元测试场景：

1. **ΔOI_1h% 计算正确性测试** - 验证正负号和数据准确性
2. **Cooldown 生效测试** - 验证冷却机制正常工作
3. **缺失数据容错测试** - 验证 MC 或 price 缺失时仍能生成消息且不报错

## 注意事项

1. **数据可用性**: 如果 CoinGlass API 无法提供某些数据（如市值），系统会显示 "—" 但不会中断推送
2. **API 限流**: 系统已实现限流和重试机制，但仍需注意 CoinGlass API 的调用频率限制
3. **DeepSeek 失败**: 如果 DeepSeek API 调用失败，会使用兜底文案："OI 异动明显，关注仓位变化与短线波动。"
4. **Lark Webhook 失败**: 如果推送失败，会进行最多 2 次重试（指数退避：0.5s、1s）

## 故障排查

### 问题：没有收到推送

1. 检查日志中是否有 "Running Binance OI alert job..." 日志
2. 检查是否有满足阈值的 ticker（查看 "Calculated OI alerts" 日志）
3. 检查是否在冷却期内（查看 "Alert skipped due to cooldown" 日志）
4. 检查 Lark Webhook URL 是否正确配置

### 问题：推送消息格式不正确

1. 检查 DeepSeek API Key 是否正确配置
2. 检查消息模板是否符合要求（查看 `buildMessage` 方法）

### 问题：数据库错误

1. 检查数据库文件是否存在且可写
2. 检查 `binance_oi_alert_cooldown` 表是否已创建
3. 运行 `db/init.sql` 确保表结构正确

## 相关文件

- `src/services/binanceOILarkAlert.service.ts` - 核心服务实现
- `db/init.sql` - 数据库表结构定义
- `src/config/env.ts` - 环境变量配置
- `src/bot/index.ts` - Bot 启动和集成

