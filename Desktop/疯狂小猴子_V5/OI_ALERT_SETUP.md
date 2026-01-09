# OI 异动扫描系统 - 快速配置指南

## 快速开始

### 1. 启用新架构

在 `.env` 文件中添加：

```bash
# 启用新架构
USE_NEW_OI_ALERT_ORCHESTRATOR=true

# Dry-run 模式（测试，不真实发送）
OI_ALERT_DRY_RUN=true
```

### 2. 基础配置

```bash
# 扫描间隔（默认 10 分钟）
OI_ALERT_POLL_INTERVAL_MS=600000

# 阈值（默认 10%）
OI_ALERT_THRESHOLD_PERCENT=10

# 事件去重窗口（默认 2 小时）
OI_ALERT_COOLDOWN_WINDOW_MS=7200000

# 扫描配置
OI_ALERT_SCAN_TOP_N=200
OI_ALERT_SCAN_GROUPS=major,meme,topOI
OI_ALERT_USE_DYNAMIC_LIST=true
OI_ALERT_CONCURRENCY=5
```

### 3. Lark Webhook 配置

```bash
LARK_WEBHOOK_UNIFIED=https://open.larksuite.com/open-apis/bot/v2/hook/...
```

### 4. Twitter 推送配置（可选）

Twitter 推送使用 OAuth 1.0a，需要先绑定账户（参考 `TWITTER_OAUTH1_BINDING_GUIDE.md`）。

绑定后，系统会自动检测可用的账户并启用推送。

## 测试（Dry-Run）

```bash
# 运行 dry-run 脚本
npm run ts-node scripts/oiAlertDryRun.ts
```

## 生产部署

1. **设置环境变量**：
   ```bash
   USE_NEW_OI_ALERT_ORCHESTRATOR=true
   OI_ALERT_DRY_RUN=false
   ```

2. **重启 Bot**：
   ```bash
   npm start
   ```

## 验证

查看日志，应该看到：

```
✅ OI Alert Orchestrator 已启动（新架构）
```

以及每 10 分钟的扫描统计：

```
{
  "totalTickers": 200,
  "successCount": 180,
  "candidateCount": 3,
  "confirmedCount": 1
}
```

## 故障排查

### 为什么某个币没有推送？

1. 检查是否在扫描列表中（查看日志中的 `tickerCount`）
2. 检查是否满足阈值（查看日志中的 `candidateCount`）
3. 检查候选池状态：
   ```sql
   SELECT * FROM oi_alert_candidate_pool WHERE symbol = 'XXX';
   ```

### 是否推到 Twitter 了？

查看日志中的 `Notification summary`：

```
{
  "totalEvents": 1,
  "totalNotifications": 2,
  "successCount": 2,
  "channels": ["lark", "twitter"]
}
```

## 回滚

如果遇到问题，移除环境变量即可回退到旧架构：

```bash
# 移除或设置为 false
USE_NEW_OI_ALERT_ORCHESTRATOR=false
```

