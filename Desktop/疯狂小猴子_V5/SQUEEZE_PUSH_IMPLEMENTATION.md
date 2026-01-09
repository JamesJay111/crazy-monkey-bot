# 庄家轧空结构异动自动推送（实现文档）

## 📋 实现概览

在已实现的后台定时扫描基础上，新增"结构异动自动推送"能力。该能力是触发式（event-driven），只在结构发生变化时推送。

## 🎯 核心特性

- ✅ **触发式推送**：只在结构变化时推送，不重复推送相同结构
- ✅ **防骚扰机制**：单ticker 4h冷却 + 单次扫描最多3条
- ✅ **优先级排序**：多空反转 > 新强信号 > 强度升级
- ✅ **订阅系统预留**：支持订阅/取消订阅接口
- ✅ **不影响现有交互**：手动点击「庄家轧空」流程不变

## 📁 新增/修改的文件清单

### 1. **`src/services/squeezePush.service.ts`** (新增)
**推送服务类：**
- `SqueezePushService`: 检测结构异动并发送推送
- 实现触发条件检测、去重、冷却机制
- 格式化推送消息（固定模板）

**主要方法：**
- `detectAndPush(oldList, newList)`: 检测并推送结构异动
- `detectTriggers(oldList, newList)`: 检测触发条件
- `applyCooldown(candidates)`: 应用冷却时间
- `sendPush(candidate)`: 发送推送消息
- `formatPushMessage(candidate)`: 格式化推送消息
- `getSubscribedUsers()`: 获取订阅用户列表（预留接口）
- `subscribeUser(userId)`: 添加订阅（预留接口）
- `unsubscribeUser(userId)`: 取消订阅（预留接口）

### 2. **`src/services/squeezeScheduler.service.ts`** (修改)
**集成推送服务：**
- 在 `executeScan()` 中调用 `pushService.detectAndPush()`
- 推送失败不影响扫描任务

### 3. **`src/bot/index.ts`** (修改)
**初始化推送服务：**
- 创建 `SqueezePushService` 实例
- 传入 scheduler 服务

## 🔧 核心功能说明

### 1. 推送触发条件（D2）

**D2.1 新出现的强结构信号（NEW ENTRY）**
- 条件：`ticker ∈ newList && ticker ∉ oldList && score >= 8`
- 优先级：2（中等）
- 含义：新的合约在最近 4h 内首次出现明显的结构变化

**D2.2 结构强度显著升级（SCORE JUMP）**
- 条件：`ticker ∈ oldList && ticker ∈ newList && new.score - old.score >= 4 && new.score >= 8`
- 优先级：3（较低）
- 含义：同一合约的挤压结构在 4h 内明显增强

**D2.3 多空反转信号出现（REVERSAL EVENT）**
- 条件：`new.signal.reversal != "none" && (old.signal.reversal == "none" || 方向相反)`
- 优先级：1（最高）
- 含义：大户多空结构在 4h 内发生方向性反转（最重要、最稀缺）

### 2. 防骚扰机制（D3）

**单 Ticker 冷却时间：**
- 同一个 ticker 4h 内最多推送一次
- 使用 `last_notified_at[ticker]` 记录
- 状态存储在 `cache/squeeze_push_state.json`

**全局推送上限：**
- 单次扫描周期最多推送 3 条
- 按优先级排序：多空反转 > 新强信号 > 强度升级

### 3. 推送消息格式（D4）

**固定模板：**
```
🧨 庄家结构异动｜{TICKER}（Binance · 4h）

- 结构变化：{空→多 / 多→空 / 强化}
- 强度等级：{弱 / 中 / 强}
- 主要依据：
  • 大户多空比：{prev_ratio} → {now_ratio}
  • 4h 内占比变化：多 {Δlong}% / 空 {Δshort}%

点击查看完整结构分析 👇
```

**按钮：**
- `[ 🔍 查看结构详情 ]` → 进入庄家轧空详情分析

**不包含：**
- ❌ score 数字
- ❌ "做多 / 做空 / 目标价"
- ❌ 价格预测

### 4. 订阅系统（D6）

**预留接口：**
```typescript
// 获取订阅用户
getSubscribedUsers(): number[]

// 添加订阅
subscribeUser(userId: number): void

// 取消订阅
unsubscribeUser(userId: number): void
```

**当前实现：**
- 默认支持管理员/测试用户（从环境变量 `SQUEEZE_PUSH_ADMIN_USERS` 读取）
- 格式：`SQUEEZE_PUSH_ADMIN_USERS=123456789,987654321`

**未来扩展：**
- 可以通过 Bot 命令订阅/取消订阅
- 可以存储到数据库
- 可以支持付费订阅

## 🧪 测试流程

### 1. 设置测试用户

**方式一：环境变量**
```bash
export SQUEEZE_PUSH_ADMIN_USERS=123456789,987654321
```

**方式二：代码中直接添加**
```typescript
squeezePushService.subscribeUser(123456789);
```

### 2. 触发测试推送

**方式一：等待定时任务**
- Bot 启动后，等待 4 小时后定时任务执行
- 如果有结构异动，会自动推送

**方式二：手动触发扫描**
```typescript
// 在 bot/index.ts 中添加测试代码
await squeezeSchedulerService.triggerScan();
```

### 3. 验证推送

**检查日志：**
```bash
tail -f bot.log | grep "Push"
```

**预期日志：**
```
{"level":30,"msg":"Squeeze push completed","totalCandidates":2,"filteredCount":1,"pushedCount":1,"pushedTickers":["BTC"]}
{"level":30,"msg":"Push sent","userId":123456789,"ticker":"BTC","type":"REVERSAL_EVENT"}
```

**推送消息示例：**
```
🧨 庄家结构异动｜BTC（Binance · 4h）

- 结构变化：空→多
- 强度等级：强
- 主要依据：
  • 结构信号强度：强
  • 持仓倾向：多头加速

点击查看完整结构分析 👇
```

## ✅ 验收标准

- ✅ 没有结构变化 → 0 推送
- ✅ 出现强反转 → 1 条清晰推送
- ✅ 同一 ticker 4h 内不刷屏
- ✅ 推送内容不引导交易，但"交易员一眼看懂"
- ✅ 推送失败不影响扫描任务

## 🔍 异常处理

### 推送失败
- TG API 报错：记录日志，不影响后续扫描
- 用户屏蔽Bot：自动从订阅列表移除
- 网络错误：记录警告日志，继续处理其他用户

### 数据缺失
- 跳过该 ticker，不推送
- 记录调试日志

### 状态存储失败
- 优先使用内存状态
- 文件操作失败不影响推送功能

## 📝 状态存储

**文件位置：** `./cache/squeeze_push_state.json`

**结构：**
```json
{
  "last_notified_at": {
    "BTC": 1750185600000,
    "ETH": 1750199200000
  }
}
```

**自动清理：**
- 超过 7 天的通知记录会自动清理
- 避免状态文件无限增长

## 🚀 部署注意事项

1. **环境变量配置**
   ```bash
   # .env 文件
   SQUEEZE_PUSH_ADMIN_USERS=123456789,987654321
   ```

2. **权限检查**
   - 确保 Bot 有发送消息的权限
   - 确保订阅用户已与 Bot 开始对话

3. **日志监控**
   - 监控推送成功率
   - 监控推送频率
   - 监控冷却机制是否生效

4. **性能考虑**
   - 推送是异步的，不影响扫描任务
   - 单个用户推送失败不影响其他用户

## 🔮 未来扩展

### 订阅系统UI
1. 添加 `/subscribe` 命令：订阅推送
2. 添加 `/unsubscribe` 命令：取消订阅
3. 添加 `/subscription_status` 命令：查看订阅状态

### 推送模板扩展
1. 支持更多触发条件
2. 支持自定义推送模板
3. 支持推送优先级配置

### 推送统计
1. 推送成功率统计
2. 用户互动率统计
3. 推送效果分析

## 💡 设计亮点

1. **触发式架构**：只在结构变化时推送，不骚扰用户
2. **优先级机制**：多空反转优先，确保重要信号不遗漏
3. **防骚扰设计**：冷却时间 + 推送上限，保护用户体验
4. **可扩展性**：预留订阅系统接口，方便后续扩展
5. **稳定性**：推送失败不影响核心功能

