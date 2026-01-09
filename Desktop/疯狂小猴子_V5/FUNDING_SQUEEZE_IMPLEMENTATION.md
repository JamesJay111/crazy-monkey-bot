# 资金费率多级选择与轧空结构分析实现总结

## ✅ 实现完成

已成功实现资金费率多级选择交互和轧空结构打分系统，所有代码已编译通过。

---

## 📋 一、资金费率多级选择（/funding）

### 1.1 一级菜单：模块选择

用户点击 `/funding` 或「资金费率」按钮时，显示：

```
📊 请选择你想查看的资金费率类型：

1️⃣ 币种资金费率（交易所实时）
2️⃣ 累计资金费率（交易所）
3️⃣ 资金费率历史（K 线）
4️⃣ 成交量加权资金费率历史（K 线）
```

### 1.2 二级菜单：正/负方向选择

选择 ① 或 ② 时，进入二级选择：

```
🔺 正资金费率最高（多头拥挤）
🔻 负资金费率最低（空头拥挤）
```

### 1.3 结果输出

**排名类（Top 10）**：
```
📊 币种资金费率（正资金费率最高）Top 10

1. BTC | +0.7421% | Binance | 下次结算：16:00
2. ETH | +0.5312% | OKX     | 下次结算：16:00
...
```

**历史类**：
- 需要用户输入 Ticker（如 BTC）
- 返回最近 30 天摘要（最新、最低、最高、平均、趋势）

### 1.4 状态管理

使用内存 Map 管理用户状态：
- `funding_module` → 选择模块
- `funding_direction` → 选择方向（仅排名类）
- `funding_result` → 显示结果

---

## 📊 二、轧空结构分析（/squeeze）

### 2.1 扫描流程

1. **获取 Universe**（默认 80 个币种）
   - 优先使用硬编码的主流币种列表
   - 从 `supported-coins` 补充

2. **并发计算特征**（限流控制）
   - OI 30 天历史
   - Funding 30 天历史
   - Long/Short Ratio 30 天历史
   - Basis 30 天历史
   - Taker Buy/Sell Volume

3. **计算得分**（0-100）
   - OI 节奏：0-20 分
   - Funding 拥挤度：0-20 分
   - 多空比反转：0-20 分
   - 基差扩大：0-20 分
   - 主动买卖倾向：0-20 分

4. **排序并返回 Top 15**

### 2.2 用户流程

**免费层**：
- 显示 Top 15 列表（评分 + 类型）
- 点击任意币种：显示摘要（3 条 signals + why）
- 隐藏详细数值

**付费层**（2999 Stars 或邀请码）：
- 显示完整报告（得分明细、关键数值、DeepSeek 分析）
- 可查看当前结构（近7天）

### 2.3 输出格式

**列表**：
```
📌 过去30天「结构性挤压」Top 15（按强度排序）

1) BTC | 82 | 🔺 short_squeeze_like
2) ETH | 77 | ➡️ neutral
...
```

**详细分析**：
```
📊 BTC 轧空结构详细分析

类型: 🔺 疑似空头挤压
评分: 82/100
置信度: 85%

📈 得分明细：
• OI 节奏: 18/20
• Funding 拥挤度: 16/20
• 多空比反转: 15/20
• 基差扩大: 12/20
• 主动买卖倾向: 10/20

🔑 关键信号：
1. OI 先缩后扩，反弹 28.5%
2. Funding 负极端 -0.0123%，可能触发空头挤压
3. 多空比从低位 0.85 抬升至 1.25

💡 原因：
基于 OI 反弹 28.5%、Funding -0.0123%、多空比反转至 1.25 等指标，判断可能存在挤压结构。

👀 关注点：
1. 关注 OI 变化
2. 关注资金费率
3. 关注多空比

💡 资金费率含义：
资金费率越极端，说明一边越拥挤；挤压通常发生在拥挤的一侧开始被迫反向平仓时

⚠️ 非投资建议
```

---

## 🔧 三、核心服务

### 3.1 SignalEngine（信号引擎）

**文件**：`src/services/signalEngine.service.ts`

**功能**：
- 计算单个 ticker 的轧空特征
- 计算得分明细（5 项，每项 0-20）
- 判定 squeezeType（short_squeeze_like / long_squeeze_like / neutral）

**方法**：
- `calculateFeatures(symbol, days)` - 计算特征
- `calculateScore(features)` - 计算得分

### 3.2 SqueezeScanService（扫描服务）

**文件**：`src/services/squeezeScan.service.ts`

**功能**：
- 扫描 Universe（默认 80 个币种）
- 并发控制（p-limit）
- 缓存管理（扫描结果 15 分钟，特征 30 分钟）
- 返回 Top N

**方法**：
- `scanTopN(limit, days)` - 扫描 Top N
- `getTickerAnalysis(symbol, days)` - 获取单个 ticker 分析

### 3.3 FundingService（资金费率服务）

**文件**：`src/services/funding.service.ts`

**功能**：
- 币种资金费率 Top N
- 累计资金费率 Top N
- 资金费率历史摘要
- 成交量加权资金费率历史摘要

**方法**：
- `getExchangeFundingRateTopN(direction, limit)`
- `getAccumulatedFundingRateTopN(direction, limit)`
- `getFundingRateHistorySummary(symbol, interval, limit)`
- `getVolWeightFundingRateHistorySummary(symbol, interval, limit)`

---

## 📝 四、类型定义

### 4.1 新增类型

**`src/types/index.ts`**：

- `CoinGlassFundingRateExchangeItem` - 币种资金费率
- `CoinGlassAccumulatedFundingRate` - 累计资金费率
- `CoinGlassVolWeightFundingRateOHLC` - 成交量加权资金费率历史
- `CoinGlassBasis` - 基差历史
- `CoinGlassTakerBuySellVolume` - Taker Buy/Sell Volume
- `SqueezeFeatures` - 轧空特征
- `ScoreBreakdown` - 得分明细
- `SqueezeType` - 轧空类型
- `SqueezeAnalysis` - DeepSeek 分析结果
- `SqueezeScanResult` - 扫描结果
- `FundingState` - 资金费率状态

---

## 🚀 五、API 端点

### 5.1 新增 CoinGlass 端点

**`src/clients/coinglass.client.ts`**：

- `getAccumulatedFundingRateExchangeList()` - 累计资金费率列表
- `getVolWeightFundingRateOhlcHistory()` - 成交量加权资金费率历史
- `getTakerBuySellVolumeExchangeList()` - Taker Buy/Sell Volume 列表

---

## ✅ 六、验收标准

### 6.1 资金费率功能

- ✅ `/funding` 显示一级菜单（4 个选项）
- ✅ 选择 ① 或 ② 进入二级菜单（正/负）
- ✅ 显示 Top 10 排名（格式正确）
- ✅ 选择 ③ 或 ④ 可输入 Ticker 查询历史
- ✅ 状态可回退

### 6.2 轧空分析功能

- ✅ `/squeeze` 显示 Top 15 列表
- ✅ 免费层显示摘要（3 条 signals + why）
- ✅ 付费层显示完整报告（得分明细 + DeepSeek 分析）
- ✅ 所有数值可追溯（来自 CoinGlass）
- ✅ 缺失指标降级处理（得分 0，标记 missing）

### 6.3 工程要求

- ✅ 限流控制（p-limit，并发 3）
- ✅ 缓存管理（扫描结果 15 分钟，特征 30 分钟）
- ✅ 错误处理（429 降级到缓存，缺失指标降级）
- ✅ 日志记录（扫描耗时、成功数、失败数、429 次数）

---

## 📚 七、使用说明

### 7.1 启动 Bot

```bash
npm run build
npm start
```

### 7.2 测试命令

**资金费率**：
- `/funding` - 进入一级菜单
- 选择「币种资金费率」→ 选择「正资金费率最高」
- 查看 Top 10 列表

**轧空分析**：
- `/squeeze` - 扫描 Top 15
- 点击任意币种查看分析
- 付费用户可查看完整报告

### 7.3 配置

**环境变量**（`.env`）：
```env
COINGLASS_API_KEY=your_key
COINGLASS_CONCURRENCY=3  # 并发数
```

**Universe 大小**（`src/services/squeezeScan.service.ts`）：
```typescript
private readonly DEFAULT_UNIVERSE_SIZE = 80; // 可调整
```

---

## 🎯 八、关键特性

### 8.1 数据源

- ✅ 所有数据来自 CoinGlass v4 API
- ✅ 请求头使用 `CG-API-KEY`
- ✅ 字段名与文档一致

### 8.2 降级策略

- ✅ 限流时从缓存返回
- ✅ 缺失指标得分记 0，标记 missing
- ✅ 缺失数据 ≥ 2 时，confidence ≤ 70

### 8.3 用户体验

- ✅ 多级选择清晰直观
- ✅ 免费/付费分层明确
- ✅ 错误提示友好
- ✅ 状态可回退

---

## 📊 九、性能优化

### 9.1 缓存策略

- 扫描结果：15 分钟 TTL
- 特征数据：30 分钟 TTL
- 交易所列表：2 分钟 TTL
- 历史数据：5 分钟 TTL

### 9.2 并发控制

- 默认并发：3（可配置）
- 使用 `p-limit` 控制
- 避免触发 API 限流

### 9.3 成本控制

- Universe 大小：80（可配置）
- 优先使用硬编码主流币种
- 避免全量扫描

---

## 🔄 十、后续优化

### 10.1 TODO

- [ ] 使用 markets API 自动选择活跃币种（替代硬编码）
- [ ] 添加更多特征（如持仓集中度）
- [ ] 优化 DeepSeek Prompt（提高 JSON 解析成功率）
- [ ] 添加实时监控（WebSocket 或定时任务）

### 10.2 已知限制

- Universe 使用硬编码列表（第一版快速上线）
- 部分币种可能缺少某些指标（已降级处理）
- DeepSeek JSON 解析可能失败（有降级方案）

---

**实现完成时间**：2024  
**状态**：✅ 编译通过，可以上线使用

