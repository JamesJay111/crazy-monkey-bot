# 统一错误提示系统实现总结

## ✅ 实现完成

已成功实现统一的错误提示系统，严格区分 Rate Limit 和 Bug/异常两种情况，所有代码已编译通过。

---

## 📋 一、错误类型判断

### 1.1 情况 A：Rate Limit / 429

**判断条件**：
- HTTP 状态码为 429
- 错误信息包含：`rate limit`, `too many requests`, `exceeded`, `请求频率超限`, `请求过于频繁`
- `HttpError` 的 `statusCode === 429`

**提示文案**：
```
😅 数据有点挤不进来了…

我们刚刚请求得有点太勤快，触发了数据源的限流。
系统没坏，只是需要喘口气。

👉 你可以稍后再试
☕ 或者支持创作者升级更好的 API 服务包：

钱包地址：
0x0ad77a6cb6f382822c8dce9732c41b5c5c6b6ae7

（一杯咖啡的钱，就能让小猴子跑得更快 🐒）
```

**按钮**：
- 🔄 稍后再试（重试操作）
- 可选：替代操作按钮（如"快速查看"）
- 🔙 返回主菜单

### 1.2 情况 B：Bug / 数据源异常 / 网络错误

**判断条件**：
- HTTP 5xx 服务器错误
- 网络错误 / timeout（statusCode === 0）
- 数据源返回空数据或不可解析
- 未命中 Rate Limit 条件

**提示文案**：
```
😵 哎呀，数据暂时拿不到了

这不是你的问题，可能是数据源开小差了。
我们已经通知开发者去处理，请稍后再试。
```

**按钮**：
- 🔄 稍后重试（可选）
- 🔙 返回（或返回主菜单）

**特点**：
- 不展示任何付费或支持引导
- 语气"负责任"，不是玩笑
- 明确告知开发者已收到通知

---

## 🔧 二、核心实现

### 2.1 错误处理工具

**文件**：`src/utils/errorHandler.ts`

**核心方法**：
- `classifyError(error)` - 判断错误类型
- `handleDataError(error, context)` - 统一错误处理入口
- `isRateLimitError(error)` - 检查是否为 Rate Limit
- `isBugError(error)` - 检查是否为 Bug/异常

### 2.2 使用方式

```typescript
import { handleDataError } from '../utils/errorHandler';

try {
  // ... 业务逻辑
} catch (error) {
  const prompt = handleDataError(error, {
    retryAction: 'squeeze',           // 重试操作（Rate Limit 和 Bug 都可用）
    alternativeAction: 'etf_quick',   // 替代操作（仅 Rate Limit 显示）
    alternativeLabel: '⚡ 快速查看',   // 替代操作标签
    backAction: 'main_menu',          // 返回操作（Bug 使用）
  });
  
  await ctx.reply(prompt.message, {
    reply_markup: prompt.keyboard,
  });
}
```

---

## 📝 三、已更新的路由

### 3.1 ETF 路由（`src/routes/etf.ts`）

- ✅ `handleETFData` - ETF 数据获取错误
- ✅ `handleETFHistory` - ETF 历史数据错误
- ✅ `handleETFQuick` - ETF 快速查看错误
- ✅ 数据为空时的处理

### 3.2 轧空分析路由（`src/routes/squeeze.ts`）

- ✅ `handleSqueezeList` - 扫描列表错误
- ✅ `handleSqueezeDetail` - 详细分析错误
- ✅ `handleSqueezeCurrent` - 当前结构检测错误

### 3.3 资金费率路由（`src/routes/funding.ts`）

- ✅ `handleFundingResult` - 排名结果错误
- ✅ `handleFundingHistory` - 历史查询错误

### 3.4 合约查询路由（`src/routes/contract.ts`）

- ✅ `handleContractQuery` - 合约查询错误

### 3.5 全局错误处理（`src/bot/index.ts`）

- ✅ `bot.catch` - 全局兜底错误处理

---

## ✅ 四、验收标准

### 4.1 Rate Limit 错误

- ✅ 显示幽默、口语化的提示
- ✅ 明确告知"系统没坏"
- ✅ 提供支持引导（钱包地址）
- ✅ 提供"稍后再试"按钮
- ✅ 不使用红色报错样式

### 4.2 Bug/异常错误

- ✅ 显示简短、诚实的提示
- ✅ 明确告知"不是你的问题"
- ✅ 告知"开发者已收到通知"
- ✅ 不展示付费或支持引导
- ✅ 语气负责任，不是玩笑

### 4.3 文案要求

- ✅ 简体中文
- ✅ 口语但不低俗
- ✅ 不影响专业感
- ✅ 两种提示明显区分

---

## 🎯 五、关键特性

### 5.1 错误分类逻辑

```typescript
// 优先级判断：
1. HTTP 状态码 429 → Rate Limit
2. HTTP 状态码 5xx → Bug/异常
3. 错误消息关键词 → Rate Limit 或 Bug
4. 网络错误（statusCode === 0）→ Bug/异常
5. 默认 → Bug/异常
```

### 5.2 上下文支持

- `retryAction` - 重试操作（两种错误都支持）
- `alternativeAction` - 替代操作（仅 Rate Limit 显示）
- `alternativeLabel` - 替代操作标签
- `backAction` - 返回操作（Bug 使用）

### 5.3 日志记录

所有错误都会记录：
- 错误类型（Rate Limit / Bug）
- 错误消息
- HTTP 状态码（如果有）
- 用于开发者排查

---

## 📊 六、用户体验

### 6.1 Rate Limit 场景

**用户感受**：
- 😅 轻松、不紧张
- 知道是请求太频繁，不是系统问题
- 愿意支持升级服务

**行为引导**：
- 稍后再试
- 或支持升级（可选）

### 6.2 Bug/异常场景

**用户感受**：
- 😵 理解、不慌张
- 知道不是自己的问题
- 信任开发者会处理

**行为引导**：
- 稍后重试
- 返回主菜单

---

## 🔄 七、后续优化

### 7.1 可扩展性

- ✅ 支持多个数据源（CoinGlass / Binance / 自建）
- ✅ 统一的错误处理入口
- ✅ 便于添加新的错误类型

### 7.2 监控建议

- 记录 Rate Limit 频率（用于优化请求策略）
- 记录 Bug 错误类型（用于修复）
- 统计用户重试率

---

**实现完成时间**：2024  
**状态**：✅ 编译通过，可以上线使用

