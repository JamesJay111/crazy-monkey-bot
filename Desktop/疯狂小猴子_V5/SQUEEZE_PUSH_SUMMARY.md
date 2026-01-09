# 庄家轧空结构异动自动推送 - 实现总结

## ✅ 完成状态

所有功能已实现并集成到现有系统中。

## 📁 文件清单

### 新增文件
1. **`src/services/squeezePush.service.ts`** - 推送服务核心实现

### 修改文件
1. **`src/services/squeezeScheduler.service.ts`** - 集成推送服务
2. **`src/bot/index.ts`** - 初始化推送服务

### 文档
1. **`SQUEEZE_PUSH_IMPLEMENTATION.md`** - 详细实现文档
2. **`SQUEEZE_PUSH_SUMMARY.md`** - 本文档

## 🔧 核心功能

### 1. 触发条件（满足任一条件即推送）

**D2.1 新出现的强结构信号（NEW ENTRY）**
- `ticker ∈ newList && ticker ∉ oldList && score >= 8`
- 优先级：2

**D2.2 结构强度显著升级（SCORE JUMP）**
- `new.score - old.score >= 4 && new.score >= 8`
- 优先级：3

**D2.3 多空反转信号出现（REVERSAL EVENT）**
- `new.signal.reversal != "none" && (old.signal.reversal == "none" || 方向相反)`
- 优先级：1（最高）

### 2. 防骚扰机制

- **单Ticker冷却**：4小时内最多推送一次
- **全局上限**：单次扫描最多推送3条
- **优先级排序**：多空反转 > 新强信号 > 强度升级

### 3. 推送消息格式

```
🧨 庄家结构异动｜{TICKER}（Binance · 4h）

- 结构变化：{空→多 / 多→空 / 强化}
- 强度等级：{弱 / 中 / 强}
- 主要依据：
  • {根据触发类型显示详细信息}

点击查看完整结构分析 👇
```

**不包含：**
- ❌ score 数字
- ❌ "做多 / 做空 / 目标价"
- ❌ 价格预测

### 4. 订阅系统（预留接口）

```typescript
// 获取订阅用户
getSubscribedUsers(): number[]

// 添加订阅
subscribeUser(userId: number): void

// 取消订阅
unsubscribeUser(userId: number): void
```

**当前实现：**
- 支持从环境变量 `SQUEEZE_PUSH_ADMIN_USERS` 读取管理员用户
- 格式：`SQUEEZE_PUSH_ADMIN_USERS=123456789,987654321`

## 🧪 测试步骤

### 1. 设置测试用户

**方式一：环境变量**
```bash
# 在 .env 文件中添加
SQUEEZE_PUSH_ADMIN_USERS=123456789,987654321
```

**方式二：代码中添加**
```typescript
// 在 bot/index.ts 中
squeezePushService.subscribeUser(123456789);
```

### 2. 手动触发测试

```typescript
// 在 bot/index.ts 启动函数中临时添加
setTimeout(async () => {
  await squeezeSchedulerService.triggerScan();
}, 5000); // 启动后5秒触发
```

### 3. 验证推送

1. 确保测试用户已与Bot开始对话
2. 等待扫描完成
3. 如果有结构异动，会收到推送消息
4. 查看日志确认推送状态

### 4. 验证冷却机制

1. 第一次扫描触发推送
2. 4小时内再次扫描，相同ticker不应再次推送
3. 4小时后，冷却解除，可以再次推送

## 📊 状态存储

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
- 超过7天的通知记录会自动清理

## ✅ 验收标准

- ✅ 没有结构变化 → 0 推送
- ✅ 出现强反转 → 1 条清晰推送
- ✅ 同一 ticker 4h 内不刷屏
- ✅ 推送内容不引导交易，但"交易员一眼看懂"
- ✅ 推送失败不影响扫描任务
- ✅ 不改变现有 Bot 交互

## 🔍 异常处理

- 推送失败：记录日志，不影响扫描任务
- 用户屏蔽Bot：自动从订阅列表移除
- 数据缺失：跳过该ticker，不推送
- 状态存储失败：使用内存状态

## 🚀 部署要点

1. **环境变量配置**
   ```bash
   SQUEEZE_PUSH_ADMIN_USERS=123456789,987654321
   ```

2. **确保Bot有发送消息权限**
   - 用户必须先与Bot开始对话（发送/start）
   - Bot需要有发送消息的权限

3. **监控日志**
   ```bash
   tail -f bot.log | grep "Push"
   ```

## 📝 使用示例

### 推送消息示例

**多空反转：**
```
🧨 庄家结构异动｜BTC（Binance · 4h）

- 结构变化：空→多
- 强度等级：强
- 主要依据：
  • 空→多反转（强）
  • 持仓倾向：多头加速

点击查看完整结构分析 👇
```

**新强信号：**
```
🧨 庄家结构异动｜SOL（Binance · 4h）

- 结构变化：强化
- 强度等级：强
- 主要依据：
  • 首次出现强结构信号
  • 持仓倾向：多头加速

点击查看完整结构分析 👇
```

## 🔮 未来扩展

1. **订阅系统UI**
   - `/subscribe` - 订阅推送
   - `/unsubscribe` - 取消订阅
   - `/subscription_status` - 查看订阅状态

2. **推送模板扩展**
   - 支持更多触发条件
   - 支持自定义推送模板

3. **推送统计**
   - 推送成功率
   - 用户互动率
   - 推送效果分析

## 💡 设计亮点

1. **触发式架构**：只在结构变化时推送，不骚扰用户
2. **优先级机制**：多空反转优先，确保重要信号不遗漏
3. **防骚扰设计**：冷却时间 + 推送上限，保护用户体验
4. **可扩展性**：预留订阅系统接口，方便后续扩展
5. **稳定性**：推送失败不影响核心功能
6. **合规性**：不喊单、不预测价格，只做结构解读

