# 标签引擎自测样例

## 测试用例

### 用例1：强反转
**输入：**
```typescript
{
  reversal: 'short_to_long',
  reversalStrength: 'strong',
  score: 13
}
```
**期望输出：**
- primary: `'空转多（强）'`
- secondary: `undefined`
- strength: `'结构剧烈'`
- List标签: `'空转多（强）'`
- 推送标签: `'空转多（强）'`
- 完整标签: `'结构标签：空转多（强）｜Binance · 4h'`

### 用例2：多头加速 + 结构明显
**输入：**
```typescript
{
  reversal: 'none',
  positionBias: 'long_stronger',
  score: 9
}
```
**期望输出：**
- primary: `undefined` (空字符串)
- secondary: `'多头加速'`
- strength: `'结构明显'`
- List标签: `'多头加速 · 结构明显'`
- 推送标签: `'多头加速'`
- 完整标签: `'结构标签：多头加速｜Binance · 4h'`

### 用例3：无信号 + 结构变化
**输入：**
```typescript
{
  reversal: 'none',
  positionBias: 'none',
  score: 6
}
```
**期望输出：**
- primary: `undefined`
- secondary: `undefined`
- strength: `'结构变化'`
- List标签: `'结构变化'`
- 推送标签: `'结构变化'`
- 完整标签: `'结构标签：结构变化｜Binance · 4h'`

### 用例4：弱反转
**输入：**
```typescript
{
  reversal: 'short_to_long',
  reversalStrength: 'weak',
  score: 5
}
```
**期望输出：**
- primary: `'结构反转'`
- secondary: `undefined`
- strength: `'结构变化'`
- List标签: `'结构反转'`
- 推送标签: `'结构反转'`
- 完整标签: `'结构标签：结构反转｜Binance · 4h'`

### 用例5：多转空（中）
**输入：**
```typescript
{
  reversal: 'long_to_short',
  reversalStrength: 'medium',
  score: 8
}
```
**期望输出：**
- primary: `'多转空'`
- secondary: `undefined`
- strength: `'结构明显'`
- List标签: `'多转空'`
- 推送标签: `'多转空'`
- 完整标签: `'结构标签：多转空｜Binance · 4h'`

### 用例6：空头加速
**输入：**
```typescript
{
  reversal: 'none',
  positionBias: 'short_stronger',
  score: 7
}
```
**期望输出：**
- primary: `undefined`
- secondary: `'空头加速'`
- strength: `'结构变化'`
- List标签: `'空头加速 · 结构变化'`
- 推送标签: `'空头加速'`
- 完整标签: `'结构标签：空头加速｜Binance · 4h'`

## 快速测试脚本

可以在 Node.js REPL 中运行：

```javascript
const { squeezeLabelEngine } = require('./dist/src/services/squeezeLabelEngine.service.js');

// 测试用例1
const signal1 = {
  reversal: 'short_to_long',
  reversalStrength: 'strong',
  score: 13
};
console.log('用例1:', squeezeLabelEngine.generateSqueezeLabel(signal1));

// 测试用例2
const signal2 = {
  reversal: 'none',
  positionBias: 'long_stronger',
  score: 9
};
console.log('用例2:', squeezeLabelEngine.generateSqueezeLabel(signal2));
```

