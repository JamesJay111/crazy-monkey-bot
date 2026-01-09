# 庄家轧空模块 · 后台定时扫描 + 前台缓存（实现文档）

## 📋 实现概览

将「庄家轧空」模块升级为"后台定时扫描 + 前台读取缓存"的架构，支持秒级响应和未来推送扩展。

## 🎯 架构设计

### 数据流程

```
后台定时任务 (每4小时)
  ↓
扫描 Binance 合约
  ↓
计算结构评分
  ↓
写入缓存 (内存 + 本地JSON)
  ↓
前台 Bot (用户点击)
  ↓
读取缓存 (秒级响应)
  ↓
展示推荐 List
```

## 📁 新增/修改的文件清单

### 1. **`src/services/squeezeCache.service.ts`** (新增)
**缓存服务类：**
- `SqueezeCacheService`: 管理庄家轧空缓存
- 支持内存缓存 + 本地 JSON 文件持久化
- 自动检测缓存过期（4小时TTL）

**主要方法：**
- `setCache(cache: SqueezeCache)`: 设置缓存
- `getCache(): SqueezeCache | null`: 获取缓存
- `isCacheValid(): boolean`: 检查缓存是否有效
- `getCacheAge(): number | null`: 获取缓存年龄
- `clearCache()`: 清空缓存

### 2. **`src/services/squeezeScheduler.service.ts`** (新增)
**定时扫描服务类：**
- `SqueezeSchedulerService`: 后台定时扫描任务
- 每4小时执行一次扫描
- 自动更新缓存
- 预留推送Hook接口

**主要方法：**
- `start(intervalMs)`: 启动定时任务
- `stop()`: 停止定时任务
- `triggerScan()`: 手动触发扫描（测试用）
- `onSqueezeListUpdated(hook)`: 注册推送Hook（预留接口）

### 3. **`src/routes/squeeze.ts`** (修改)
**路由改造：**
- `handleSqueezeScan()`: 改为从缓存读取，不再实时扫描
- 支持轻量标签展示（「结构反转」「多头加速」等）
- 保持原有文案和交互不变

### 4. **`src/bot/index.ts`** (修改)
**启动时初始化：**
- 初始化 `SqueezeCacheService`
- 初始化 `SqueezeSchedulerService`
- Bot 启动后自动启动定时任务

## 🔧 核心功能说明

### 1. 缓存结构

```typescript
interface SqueezeCache {
  generated_at: number;      // 生成时间戳（毫秒）
  exchange: string;           // "Binance"
  interval: string;           // "4h"
  list: SqueezeCacheItem[];   // 推荐列表（最多10个）
}

interface SqueezeCacheItem {
  ticker: string;             // 币种符号（如 "BTC"）
  symbolPair: string;         // 交易对（如 "BTCUSDT"）
  score: number;              // 评分（仅用于排序）
  signal: {
    reversal?: 'none' | 'short_to_long' | 'long_to_short';
    reversal_strength?: 'weak' | 'medium' | 'strong';
    position_bias?: 'long_stronger' | 'short_stronger' | 'neutral';
  };
}
```

### 2. 后台定时任务

**执行频率：**
- 每 4 小时执行一次
- 启动时立即执行一次
- 推荐时间点：00:00 / 04:00 / 08:00 / 12:00 / 16:00 / 20:00

**扫描逻辑：**
- 完全复用 Prompt B 中的 `scanBinance4hStructure()` 逻辑
- 多空比反转判断
- 大户开仓倾向判断
- 结构评分 score 计算
- 生成 Top 10 推荐榜单

**缓存更新：**
- 扫描完成后自动写入缓存
- 同时更新内存缓存和本地 JSON 文件
- 缓存 TTL: 4 小时

### 3. 前台 Bot 改造

**用户点击「庄家轧空」时：**
1. 从缓存读取结果（不再实时扫描）
2. 判断缓存状态：
   - 存在 & 不为空 → 直接展示 List
   - 不存在 / 为空 → 显示"暂无有效结构信号（最近 4h）"
3. 展示推荐 List（保持原有文案）

**推荐 List 格式：**
```
🧨 庄家轧空监测（Binance · 4h）

以下合约按「庄家轧空结构变化强度」排序：
（基于最近 4 小时大户持仓结构）

1️⃣ BTC 「结构反转」
2️⃣ SOL 「多头加速」
3️⃣ ETH
...

请选择你想进一步查看的合约 👇
```

**用户点选 Ticker：**
- 允许即时拉取该 Ticker 的详细分析
- 完全复用原有的 `handleSqueezeDetail()` 逻辑

### 4. 推送Hook预留接口（C5）

**Hook 注册：**
```typescript
squeezeSchedulerService.onSqueezeListUpdated((oldList, newList) => {
  // 未来可以实现：
  // - 新增 ticker 推送
  // - score 大幅上升推送
  // - 强反转（强度=strong）推送
});
```

**当前状态：**
- Hook 接口已预留
- 扫描完成后会自动调用所有注册的Hook
- **暂不启用推送功能**（不发TG消息）

## 🧪 最小测试流程

### 1. 手动触发扫描

**方式一：通过代码触发**
```typescript
// 在 bot/index.ts 或测试脚本中
const cache = await squeezeSchedulerService.triggerScan();
console.log('Scan result:', cache);
```

**方式二：等待定时任务**
- Bot 启动后会自动执行首次扫描
- 之后每4小时自动执行

### 2. 查看缓存

**查看内存缓存：**
```typescript
const cache = squeezeCacheService.getCache();
console.log('Cache:', JSON.stringify(cache, null, 2));
```

**查看本地文件：**
```bash
cat cache/squeeze_cache.json
```

**缓存文件位置：**
- 默认：`./cache/squeeze_cache.json`
- 如果目录不存在，会自动创建

### 3. Bot 读取并展示 List

**测试步骤：**
1. 启动 Bot：`npm run dev`
2. 等待首次扫描完成（或手动触发扫描）
3. 在 Telegram 中发送 `/squeeze` 或点击「庄家轧空」按钮
4. Bot 应该秒级返回推荐 List（从缓存读取）
5. 点击某个 Ticker 查看详细分析

### 4. 验证缓存有效性

**检查缓存年龄：**
```typescript
const age = squeezeCacheService.getCacheAge();
if (age !== null) {
  const ageHours = age / (60 * 60 * 1000);
  console.log(`Cache age: ${ageHours.toFixed(2)} hours`);
}
```

**检查缓存是否有效：**
```typescript
const isValid = squeezeCacheService.isCacheValid();
console.log('Cache valid:', isValid);
```

## ✅ 验收标准

- ✅ Bot 打开「庄家轧空」秒级返回
- ✅ 不因接口慢而卡住
- ✅ List 在 4h 内稳定一致
- ✅ 用户点选后能看到详细结构分析
- ✅ 无任何"喊单/预测"风险

## 🔍 异常处理

### 后台任务失败
- 不影响 Bot 前台运行
- 前台只显示"暂无有效结构信号"
- 不向用户展示错误详情

### 缓存过期
- 自动检测缓存年龄
- 超过4小时视为过期
- 过期后返回 null，前台显示友好提示

### 文件读写失败
- 优先使用内存缓存
- 文件操作失败不影响内存缓存
- 记录警告日志，但不影响功能

## 📝 未来扩展

### 推送功能（预留接口）
1. 在 `squeezeSchedulerService.onSqueezeListUpdated()` 中实现推送逻辑
2. 检测新增 ticker、score 大幅上升、强反转等条件
3. 通过 Bot API 发送消息给订阅用户

### 缓存优化
1. 可以迁移到 Redis（修改 `SqueezeCacheService`）
2. 支持多实例部署
3. 增加缓存预热机制

### 性能优化
1. 扫描结果分页加载
2. 增加更细粒度的缓存策略
3. 优化并发扫描数量

## 🚀 部署注意事项

1. **确保缓存目录可写**
   - 默认目录：`./cache`
   - 确保 Bot 有读写权限

2. **定时任务持久化**
   - 如果使用进程管理器（如 PM2），确保进程重启后定时任务继续运行
   - 或使用系统级 Cron 任务

3. **日志监控**
   - 监控定时任务执行情况
   - 监控缓存更新频率
   - 监控缓存命中率

