# 交易员一句话标签系统（Label Engine）- 实现文档

## 📋 实现概览

在庄家轧空模块基础上，新增"交易员一句话标签系统"，用于将复杂结构压缩成极低认知成本的标签描述。

## 🎯 设计目标

- ✅ 一句话 ≤ 14 个字（中文）
- ✅ 交易员扫一眼就懂发生了什么
- ✅ 同一结构 → 同一标签（稳定、可复用）
- ✅ 可用于：推荐List、自动推送标题、详情页Summary

## 📁 新增/修改的文件清单

### 1. **`src/services/squeezeLabelEngine.service.ts`** (新增)
**标签引擎核心模块：**
- `SqueezeLabelEngine`: 标签生成引擎
- `generateSqueezeLabel()`: 主要接口，生成标签
- `generateLabelFromCacheItem()`: 从CacheItem生成标签（便捷方法）
- `generateListLabel()`: 生成List展示标签
- `generatePushTitleLabel()`: 生成推送标题标签

### 2. **`src/routes/squeeze.ts`** (修改)
**集成标签系统：**
- `handleSqueezeScan()`: 推荐List使用标签
- `formatSqueezeAnalysis()`: 详情页顶部添加标签Summary

### 3. **`src/services/squeezePush.service.ts`** (修改)
**推送标题使用标签：**
- `formatPushMessage()`: 使用标签引擎生成推送标题

## 🔧 标签分类与规则

### 一级标签：多空反转类（最高优先级）

| 条件 | 标签 |
|------|------|
| short_to_long + strong | 空转多（强） |
| short_to_long + medium | 空转多 |
| long_to_short + strong | 多转空（强） |
| long_to_short + medium | 多转空 |
| 反转为 weak | 结构反转 |

**规则：**
- 若 reversal != none，必须使用反转类标签，忽略其他类型
- 强反转可用粗体（UI层处理）
- weak不强调方向，避免误导

### 二级标签：开仓倾向类

**仅在无反转时使用：**

| 条件 | 标签 |
|------|------|
| positionBias = long_stronger | 多头加速 |
| positionBias = short_stronger | 空头加速 |
| 无明显倾向 | — |

### 三级标签：结构强度补充

**用于List或推送副标题（可选）：**

| score | 强度标签 |
|-------|----------|
| ≥ 12 | 结构剧烈 |
| 8–11 | 结构明显 |
| 5–7 | 结构变化 |
| < 5 | 不展示 |

## 🎨 标签组合规则

### E5.1 List中的推荐展示（最多一行）

**优先级：**
1. 一级标签（如有反转，只显示一级标签）
2. 二级标签（仅当无反转）
3. 三级强度标签（可选）

**示例：**
- `BTC ｜空转多（强）`
- `SOL ｜多头加速 · 结构明显`
- `ETH ｜结构变化`

### E5.2 自动推送标题（更克制）

```
🧨 结构异动｜BTC
空转多（强）
```

**或（无反转）：**
```
🧨 结构异动｜SOL
多头加速
```

### E5.3 详情页顶部Summary（完整但仍一句话）

```
结构标签：空转多（强）｜Binance · 4h
```

## 🚫 禁止词汇（严格）

- ❌ 看多 / 看空
- ❌ 做多 / 做空
- ❌ 买入 / 卖出
- ❌ 目标价 / 压力位
- ❌ 爆拉 / 暴跌

## 🧪 自测样例

| 输入 | 期望输出 |
|------|----------|
| short_to_long + strong | 空转多（强） |
| long_stronger + score=9 | 多头加速 · 结构明显 |
| no signal + score=6 | 结构变化 |
| weak reversal | 结构反转 |

## ✅ 集成点

### 1. 推荐List（`handleSqueezeScan`）

**位置：** `src/routes/squeeze.ts`

```typescript
const listLabel = squeezeLabelEngine.generateListLabel(item);
message += `${emoji} ${item.ticker}｜${listLabel}\n`;
```

**输出示例：**
```
1️⃣ BTC｜空转多（强）
2️⃣ SOL｜多头加速 · 结构明显
```

### 2. 推送标题（`formatPushMessage`）

**位置：** `src/services/squeezePush.service.ts`

```typescript
const titleLabel = squeezeLabelEngine.generatePushTitleLabel(newItem);
message = `🧨 结构异动｜${ticker}\n${titleLabel}\n...`;
```

**输出示例：**
```
🧨 结构异动｜BTC
空转多（强）
```

### 3. 详情页Summary（`formatSqueezeAnalysis`）

**位置：** `src/routes/squeeze.ts`

```typescript
const label = squeezeLabelEngine.generateLabelFromCacheItem(cacheItem);
if (label.fullLabel) {
  labelSummary = label.fullLabel + '\n\n';
}
```

**输出示例：**
```
📊 BTC 详细结构分析

结构标签：空转多（强）｜Binance · 4h

结构：🔺 Short Squeeze（轧空倾向）
...
```

## 🔍 代码示例

### 使用Label Engine

```typescript
import { squeezeLabelEngine } from '../services/squeezeLabelEngine.service';

// 从CacheItem生成标签
const label = squeezeLabelEngine.generateLabelFromCacheItem(cacheItem);

// 生成List标签
const listLabel = squeezeLabelEngine.generateListLabel(cacheItem);
// 输出：空转多（强） 或 多头加速 · 结构明显

// 生成推送标题标签
const pushLabel = squeezeLabelEngine.generatePushTitleLabel(cacheItem);
// 输出：空转多（强） 或 多头加速

// 生成完整标签（详情页）
const fullLabel = label.fullLabel;
// 输出：结构标签：空转多（强）｜Binance · 4h
```

## ✅ 验收标准

- ✅ 一句话 ≤ 14 个字（中文）
- ✅ 同一结构生成相同标签（稳定）
- ✅ 所有使用点统一调用Label Engine
- ✅ 不包含禁止词汇
- ✅ 标签清晰易懂，交易员扫一眼就懂

## 📝 实现细节

### 标签生成逻辑

1. **优先级判断**：
   - 先检查是否有反转（一级标签）
   - 无反转时检查开仓倾向（二级标签）
   - 最后添加强度标签（三级标签）

2. **标签组合**：
   - List：一级标签优先，如有则不显示二级
   - 推送：只显示核心标签（一级或二级）
   - 详情页：显示完整标签（包含元数据）

3. **稳定性保证**：
   - 相同输入 → 相同输出
   - 不依赖外部状态
   - 纯函数设计

## 🚀 测试建议

### 单元测试示例

```typescript
// 测试反转标签
const signal1: SqueezeSignal = {
  reversal: 'short_to_long',
  reversalStrength: 'strong',
  score: 9,
};
const label1 = squeezeLabelEngine.generateSqueezeLabel(signal1);
// 期望：primary = '空转多（强）'

// 测试开仓倾向标签
const signal2: SqueezeSignal = {
  reversal: 'none',
  positionBias: 'long_stronger',
  score: 9,
};
const label2 = squeezeLabelEngine.generateSqueezeLabel(signal2);
// 期望：secondary = '多头加速', strength = '结构明显'

// 测试弱反转
const signal3: SqueezeSignal = {
  reversal: 'short_to_long',
  reversalStrength: 'weak',
  score: 4,
};
const label3 = squeezeLabelEngine.generateSqueezeLabel(signal3);
// 期望：primary = '结构反转'
```

## 💡 产品层完成度

现在系统已经拥有：

1. ✅ **扫描式结构引擎** - 后台定时扫描Binance合约
2. ✅ **事件驱动推送** - 结构异动自动推送
3. ✅ **交易员级"一句话标签"抽象** - 极低认知成本

**可直接用于：**
- 订阅服务
- Pro版功能
- 高频但不骚扰的提醒系统

