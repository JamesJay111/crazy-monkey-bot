# ETF 每日资金流报告实现文档

## 📋 功能概述

每天北京时间早上8点自动生成ETF资金流报告，包含 BTC、ETH、XRP、SOL 在过去24小时内的资金流入和流出数据。

## 🗂️ 文件清单

### 新增文件

1. **`src/services/etfDailyReport.service.ts`**
   - ETF 每日报告服务
   - 定时任务：每天北京时间早上8点执行
   - 生成文本文件到 `./reports/` 目录

2. **`scripts/testETFDailyReport.ts`**
   - 测试脚本，用于手动触发报告生成

### 修改文件

1. **`src/bot/index.ts`**
   - 导入 `ETFDailyReportService`
   - 初始化服务实例
   - 在 Bot 启动时启动报告服务
   - 在优雅关闭时停止报告服务

## 🔧 核心功能说明

### 1. 定时任务机制

- **执行时间**：每天北京时间早上8点（UTC+8）
- **报告周期**：过去24小时的数据
- **文件命名**：`etf_daily_report_YYYY-MM-DD.txt`
- **文件位置**：`./reports/` 目录

### 2. 时间计算逻辑

```typescript
// 获取下次北京时间早上8点的时间
private getNextBeijing8AM(): Date {
  const now = new Date();
  // 北京时间是 UTC+8
  const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const beijingDate = new Date(beijingTime.getUTCFullYear(), beijingTime.getUTCMonth(), beijingTime.getUTCDate());
  
  // 设置目标时间为今天或明天的早上8点（北京时间）
  const targetHour = 8;
  const target = new Date(beijingDate.getTime() + targetHour * 60 * 60 * 1000);
  
  // 转换为UTC时间（减去8小时）
  const utcTarget = new Date(target.getTime() - 8 * 60 * 60 * 1000);
  
  // 如果已经过了今天早上8点，则设置为明天早上8点
  if (utcTarget.getTime() <= now.getTime()) {
    utcTarget.setUTCDate(utcTarget.getUTCDate() + 1);
  }
  
  return utcTarget;
}
```

### 3. 报告内容结构

报告包含以下内容：

1. **报告头部**
   - 生成时间（北京时间）
   - 报告周期说明

2. **每个币种的数据**（BTC、ETH、XRP、SOL）
   - 净流入（过去24小时）
   - 总流入
   - 总流出
   - 最新价格
   - 数据点数
   - 每日明细（按时间排序）
   - 主要ETF明细（最新数据）

3. **报告尾部**
   - 数据来源说明

### 4. 报告文件示例

```
═══════════════════════════════════════════════════════════
ETF 每日资金流报告
生成时间: 2025-12-30 08:00:00 (北京时间)
报告周期: 过去24小时
═══════════════════════════════════════════════════════════

────────────────────────────────────────────────────────────
📊 BTC ETF 资金流（过去24小时）
────────────────────────────────────────────────────────────

💰 净流入: +123.45M USD
📈 总流入: +150.00M USD
📉 总流出: -26.55M USD
💎 最新价格: $42,500.00
📅 数据点数: 1 条

每日明细:
  1. 2025/12/30 08:00: +123.45M USD

主要 ETF 明细（最新数据）:
  • GBTC: +50.00M USD
  • IBIT: +30.00M USD
  • FBTC: +20.00M USD
  ...

────────────────────────────────────────────────────────────
📊 ETH ETF 资金流（过去24小时）
────────────────────────────────────────────────────────────
...
```

## 🚀 使用方法

### 1. 自动执行

Bot 启动后，服务会自动启动。每天北京时间早上8点会自动生成报告。

### 2. 手动测试

运行测试脚本手动触发报告生成：

```bash
npx ts-node scripts/testETFDailyReport.ts
```

### 3. 查看报告

报告文件保存在 `./reports/` 目录下：

```bash
# 查看最新报告
ls -lt reports/ | head -5

# 查看报告内容
cat reports/etf_daily_report_2025-12-30.txt
```

## 📊 数据获取逻辑

1. **获取过去24小时数据**
   - 调用 `etfService.getFlowHistory(symbol, 1)` 获取过去1天的数据
   - 数据按时间倒序排序（最新的在前）

2. **计算统计指标**
   - 净流入 = 所有数据点的 flow_usd 总和
   - 总流入 = 所有正数 flow_usd 的总和
   - 总流出 = 所有负数 flow_usd 的绝对值总和

3. **容错处理**
   - 如果某个币种获取失败，会在报告中显示错误信息
   - 如果某个 ETF 明细缺失 flow_usd，会显示为 "—"

## ⚙️ 配置说明

- **报告目录**：`./reports/`（自动创建）
- **支持的币种**：BTC、ETH、XRP、SOL
- **执行时间**：每天北京时间早上8点（固定）
- **数据周期**：过去24小时

## 🔍 日志说明

服务启动时会记录：
- 下次执行时间
- 延迟时间（分钟）

报告生成时会记录：
- 文件路径
- 文件名
- 文件大小

## ✅ 验证方法

1. **检查服务是否启动**
   ```bash
   tail -f bot.log | grep "ETF 每日报告"
   ```

2. **手动触发测试**
   ```bash
   npx ts-node scripts/testETFDailyReport.ts
   ```

3. **检查报告文件**
   ```bash
   ls -la reports/
   cat reports/etf_daily_report_*.txt
   ```

## 📝 注意事项

1. **时区处理**：所有时间都转换为北京时间（UTC+8）显示
2. **API 限流**：如果遇到 CoinGlass API 限流，会在日志中记录错误，但不会中断服务
3. **文件覆盖**：同一天多次生成会覆盖之前的文件（使用日期作为文件名）
4. **目录权限**：确保 `./reports/` 目录有写入权限

## 🎯 未来扩展

- 支持邮件发送报告
- 支持生成 CSV/Excel 格式
- 支持自定义报告模板
- 支持多时区报告



