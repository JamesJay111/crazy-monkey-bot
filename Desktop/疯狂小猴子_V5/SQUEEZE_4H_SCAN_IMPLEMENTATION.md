# 庄家轧空模块 · Binance 合约扫描（4h 结构版本）

## 📋 实现概览

实现了基于 4h 粒度大户持仓结构变化的庄家轧空扫描功能，按照用户需求迭代了「庄家轧空」模块。

## 🎯 用户流程

1. **用户点击「庄家轧空」**
   - Bot 立即开始扫描 Binance 合约项目

2. **Bot 扫描并筛选**
   - 扫描 Binance 中可用的合约项目
   - 基于 4h 内的结构变化进行筛选与打分
   - 最多返回 10 个候选合约（按得分排序）

3. **用户选择查看**
   - Bot 输出推荐 List（固定格式）
   - 用户点击某个 Ticker 的按钮
   - Bot 输出该 Ticker 的详细结构分析（复用原有逻辑）

## 📁 修改的文件清单

### 1. `src/services/squeezeScan.service.ts`
**新增方法：**

- `scanBinance4hStructure(maxResults: number = 10)`: 扫描 Binance 合约项目的 4h 结构变化
- `getBinanceContractSymbols()`: 获取 Binance 合约可用项目列表
- `evaluate4hStructure(symbol: string)`: 评估单个 symbol 的 4h 结构变化
- `detectReversal(prevRatio: number, nowRatio: number)`: 检测多空比反转
- `parseRatio(item: any)`: 解析多空比数值
- `parsePercent(item: any, primaryKey: string, fallbackKey: string)`: 解析百分比数值

**核心逻辑：**

1. **扫描 Binance 合约项目**
   - 从 `getFuturesSupportedCoins()` 获取可用币种
   - 合并硬编码的优先币种列表
   - 限制扫描数量（最多 100 个）

2. **4h 结构评估**
   - 读取大户多空比历史（4h 粒度，至少 2 根）
   - 判定多空比反转（弱/中/强）
   - 判定大户开仓倾向（多军/空军）

3. **评分逻辑**
   ```
   score = 0
   如果发生多空反转：
     - 弱：+3
     - 中：+6
     - 强：+9
   如果"多军开仓更猛"：+4
   如果"空军开仓更猛"：+4
   若无反转但存在明显开仓倾向：+2
   ```
   - 最低阈值：score >= 3 才进入推荐列表

### 2. `src/routes/squeeze.ts`
**修改内容：**

- 更新 `/squeeze` 命令和 `squeeze` 回调，直接调用新的扫描流程
- 新增 `handleSqueezeScan()` 函数：处理新的扫描和列表展示流程
- 保留 `handleSqueezeDetail()` 函数：复用原有的详细分析逻辑

**推荐 List 格式：**

```
🧨 庄家轧空监测（Binance · 4h）

以下合约按「庄家轧空结构变化强度」从高到低排序：
（仅基于大户持仓结构，不预测价格）

1️⃣ BTC
2️⃣ SOL
3️⃣ ETH
4️⃣ ...

请选择你想进一步查看的合约 👇
```

## 🔧 核心函数说明

### 扫描 + 排序的核心函数

#### `scanBinance4hStructure(maxResults: number = 10)`
- **功能**：扫描 Binance 合约项目的 4h 结构变化，返回排序后的候选列表
- **输入**：`maxResults` - 最多返回数量（默认 10）
- **输出**：`Array<{ symbol: string; score: number }>` - 按得分从高到低排序的候选列表
- **缓存**：15 分钟 TTL

#### `evaluate4hStructure(symbol: string)`
- **功能**：评估单个 symbol 的 4h 结构变化，返回评分
- **输入**：`symbol` - 币种符号（如 "BTC"）
- **输出**：`number` - 评分（0 表示未触发信号）
- **逻辑**：
  1. 获取大户多空比历史（4h 粒度，至少 2 根）
  2. 检测多空比反转（B3.2）
  3. 检测大户开仓倾向（B3.3）
  4. 计算评分（B4）

### 推荐 List 的生成逻辑

#### `handleSqueezeScan(ctx, scanService)`
- **功能**：处理用户点击「庄家轧空」后的扫描和列表展示
- **流程**：
  1. 调用 `scanBinance4hStructure(10)` 获取候选列表
  2. 如果列表为空，显示"未发现明显结构变化"
  3. 如果列表不为空，格式化输出推荐 List
  4. 为每个候选合约创建 Inline Button
  5. 用户点击按钮后，触发 `handleSqueezeDetail()` 显示详细分析

## 🧪 最小自测说明

### 测试步骤

1. **启动 Bot**
   ```bash
   npm run dev
   ```

2. **测试扫描功能**
   - 在 Telegram 中发送 `/squeeze` 或点击「庄家轧空」按钮
   - Bot 应该显示："🔍 正在扫描 Binance 合约中的庄家轧空结构变化（4h）..."
   - 等待扫描完成（可能需要 10-30 秒）

3. **验证推荐 List**
   - Bot 应该输出固定格式的推荐列表
   - 列表最多包含 10 个合约
   - 每个合约都有对应的按钮

4. **测试详细分析**
   - 点击某个 Ticker 的按钮（如 BTC）
   - Bot 应该调用 `handleSqueezeDetail()` 显示详细分析
   - 详细分析应该复用原有的逻辑（SignalEngine + DeepSeek）

### 预期结果

**推荐 List 示例：**
```
🧨 庄家轧空监测（Binance · 4h）

以下合约按「庄家轧空结构变化强度」从高到低排序：
（仅基于大户持仓结构，不预测价格）

1️⃣ BTC
2️⃣ SOL
3️⃣ ETH
4️⃣ BNB
5️⃣ XRP

请选择你想进一步查看的合约 👇
```

**无结果情况：**
```
当前 Binance 合约中未发现明显的庄家轧空结构变化（4h）
```

### 测试用例

- **BTC**：应该出现在列表中（如果满足条件）
- **ETH**：应该出现在列表中（如果满足条件）
- **SOL**：应该出现在列表中（如果满足条件）

### 注意事项

1. **数据要求**：
   - 每个 symbol 必须至少有 2 根 4h 历史数据
   - 如果数据不足，该 symbol 会被跳过（静默失败）

2. **评分阈值**：
   - score < 3 的合约不会出现在推荐列表中

3. **缓存机制**：
   - 扫描结果缓存 15 分钟
   - 避免频繁请求 CoinGlass API

4. **错误处理**：
   - 单个 symbol 失败不影响整体扫描
   - 如果全部失败，显示友好的错误消息

## ✅ 完成状态

- ✅ B0. 总体产品流程（用户路径）
- ✅ B1. 数据范围与硬性约束（只分析 Binance，4h 粒度）
- ✅ B2. Binance 合约项目扫描
- ✅ B3. 4h 结构评估（反转判定、开仓倾向判定）
- ✅ B4. 庄家轧空程度评分逻辑
- ✅ B5. 推荐 List 格式化输出
- ✅ B6. 详细分析（复用原有逻辑）
- ✅ B7. 异常与边界处理

## 📝 后续优化建议

1. **性能优化**：
   - 可以考虑并行扫描的并发数
   - 增加更细粒度的缓存策略

2. **用户体验**：
   - 可以显示扫描进度
   - 可以显示"正在扫描 X/Y 个合约..."

3. **数据质量**：
   - 可以增加数据验证逻辑
   - 可以过滤掉明显异常的数据

