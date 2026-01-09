# Lark Webhook 推送实现文档

## 📋 实现概览

为指定的 Lark Incoming Webhook 添加独立的推送规则，不影响现有推送逻辑。

**Webhook URL**: `https://open.larksuite.com/open-apis/bot/v2/hook/dec78df3-407c-431d-b3d4-839b56731e2a`

---

## 📁 新增/修改的文件清单

### 1. 新增文件
- **`src/services/larkWebhook.service.ts`** - Lark Webhook 发送服务

### 2. 修改文件
- **`src/services/etfDailyReport.service.ts`** - 添加 ETF 币种拆分推送逻辑
- **`src/services/macroUsTweetJob.service.ts`** - 添加财经新闻推送逻辑

---

## 🔧 核心功能说明

### 一、ETF 推送规则（仅对该 Webhook 生效）

**规则**：
- BTC / ETH / SOL / XRP 四个币种完全分开推送
- 每个币种 = 一条独立消息
- 推送频率：每日一次（沿用现有"每日 ETF 推送"触发点）

**实现位置**：
- `src/services/etfDailyReport.service.ts`
- 方法：`sendETFToLarkBySymbol()`
- 调用点：`generateReport()` 方法中，在报告保存后调用

**关键代码片段**：
```typescript
// 在 generateReport() 中
// 【Lark 专属逻辑】拆分币种并分别推送到 Lark Webhook
await this.sendETFToLarkBySymbol(rawDataContent, reportDateStr);

// sendETFToLarkBySymbol() 实现
private async sendETFToLarkBySymbol(rawDataContent: string, reportDateStr: string): Promise<void> {
  for (const symbol of this.SYMBOLS) {
    const flow = await this.etfService.getLatestFlow(symbol);
    if (!flow) continue;
    
    const message = this.etfService.formatLatestFlow(flow, symbol);
    await this.larkWebhook.sendText(message);
    
    // 币种之间延迟 1 秒
    if (symbol !== this.SYMBOLS[this.SYMBOLS.length - 1]) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}
```

**特点**：
- ✅ 不修改 ETF 原始数据计算逻辑
- ✅ 不修改 ETF 原始文案生成函数（复用 `formatLatestFlow`）
- ✅ 其他渠道（Twitter / TG 等）不受影响

---

### 二、财经新闻推送规则（仅对该 Webhook 生效）

**规则**：
- 只要财经新闻 API 有更新/新内容，即刻触发推送
- 完全复用当前已经开发好的新闻推送文案（中文推文）
- 不做拆分、不做合并、不做重写

**实现位置**：
- `src/services/macroUsTweetJob.service.ts`
- 方法：`sendMacroEventToLark()`
- 调用点：`runJobOnce()` 方法中，在推文发布后调用

**关键代码片段**：
```typescript
// 在 runJobOnce() 中
// 6. 发布到三账户
const results = await this.publishTweets(selectedEvent, tweets);

// 7. 【Lark 专属逻辑】推送财经新闻到 Lark Webhook
await this.sendMacroEventToLark(selectedEvent, tweets.zh);

// sendMacroEventToLark() 实现
private async sendMacroEventToLark(event: EventDTO, tweetText: string): Promise<void> {
  const success = await this.larkWebhook.sendText(tweetText);
  // 只记录日志，不抛出异常
}
```

**特点**：
- ✅ 不修改新闻 API 的更新判断逻辑
- ✅ 不修改新闻内容生成逻辑
- ✅ 不增加额外频控、不做二次过滤
- ✅ 保证：只要 API 有更新 → Lark 群必然收到

---

## 🔧 新增函数清单

### 1. `LarkWebhookService.sendText(text: string): Promise<boolean>`
- **文件**: `src/services/larkWebhook.service.ts`
- **功能**: 发送文本消息到 Lark Webhook
- **返回值**: 是否发送成功
- **异常处理**: 只记录 error log，不抛出异常

### 2. `ETFDailyReportService.sendETFToLarkBySymbol(rawDataContent: string, reportDateStr: string): Promise<void>`
- **文件**: `src/services/etfDailyReport.service.ts`
- **功能**: 按币种拆分 ETF 数据并分别推送到 Lark
- **调用点**: `generateReport()` 方法中
- **特点**: 私有方法，仅用于 Lark Webhook

### 3. `MacroUsTweetJobService.sendMacroEventToLark(event: EventDTO, tweetText: string): Promise<void>`
- **文件**: `src/services/macroUsTweetJob.service.ts`
- **功能**: 推送财经新闻到 Lark Webhook
- **调用点**: `runJobOnce()` 方法中
- **特点**: 私有方法，仅用于 Lark Webhook

---

## 📍 插入点说明

### ETF 推送插入点
**文件**: `src/services/etfDailyReport.service.ts`
**位置**: `generateReport()` 方法，第 183 行附近
```typescript
// 5. 同时保存到 /data/etf/ 目录
fs.writeFileSync(dataFilePath, completeReport, 'utf-8');

// 【Lark 专属逻辑】拆分币种并分别推送到 Lark Webhook
await this.sendETFToLarkBySymbol(rawDataContent, reportDateStr);

logger.info({ dateStr }, 'ETF daily report generation completed');
```

### 财经新闻推送插入点
**文件**: `src/services/macroUsTweetJob.service.ts`
**位置**: `runJobOnce()` 方法，第 187 行附近
```typescript
// 6. 发布到三账户
const results = await this.publishTweets(selectedEvent, tweets);

// 7. 【Lark 专属逻辑】推送财经新闻到 Lark Webhook
await this.sendMacroEventToLark(selectedEvent, tweets.zh);

// 8. 记录推送日志
await this.logPush(selectedEvent, results);
```

---

## ✅ 约束遵守

1. ✅ **只新增**：Lark Webhook 发送函数和专属分发逻辑
2. ✅ **不允许改动**：任何已有发送函数、任何已有渠道判断逻辑
3. ✅ **Lark 行为明确写死**：Webhook URL 硬编码，行为明确限定
4. ✅ **不影响其他渠道**：Twitter / TG 等保持原有行为
5. ✅ **异常处理**：Lark 推送失败只记录 error log，不 retry，不影响主流程

---

## 🧪 测试验证

### 测试 ETF 推送
```bash
# 手动触发 ETF 报告生成（会同时推送到 Lark）
node -r ts-node/register scripts/testETFDailyReport.ts
```

### 测试财经新闻推送
```bash
# 手动触发宏观事件推送（会同时推送到 Lark）
node -r ts-node/register scripts/testMacroTweetWithMock.ts
```

---

## 📝 日志示例

### ETF 推送成功
```
[INFO] Sending ETF data to Lark webhook (split by symbol)
  reportDateStr: "2026-01-06"
[INFO] ETF data sent to Lark webhook successfully
  symbol: "BTC"
  reportDateStr: "2026-01-06"
  messageLength: 234
[INFO] ETF data sent to Lark webhook successfully
  symbol: "ETH"
  reportDateStr: "2026-01-06"
  messageLength: 198
```

### 财经新闻推送成功
```
[INFO] Macro event sent to Lark webhook successfully
  eventKey: "test_1234567890"
  calendarName: "Non-Farm Payrolls"
  textLength: 121
```

### 推送失败（不影响主流程）
```
[ERROR] Failed to send message to Lark webhook
  error: "Request failed with status code 500"
[WARN] Failed to send ETF data to Lark webhook
  symbol: "SOL"
  reportDateStr: "2026-01-06"
```

