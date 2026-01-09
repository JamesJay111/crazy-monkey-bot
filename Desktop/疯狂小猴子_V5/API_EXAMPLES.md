# API 使用示例

## CoinGlass API 调用示例

### 1. 获取历史 OHLC 数据

```typescript
const coinglass = new CoinGlassService(apiKey);
const ohlc = await coinglass.getOHLCHistory('BTC', '1h', 720);
// 返回: [{ time, open, high, low, close, volume }, ...]
```

### 2. 获取 Open Interest 历史

```typescript
const oi = await coinglass.getOIHistory('BTC', 720);
// 返回: [{ time, value, change }, ...]
```

### 3. 获取资金费率

```typescript
const rates = await coinglass.getFundingRates();
// 返回: [{ symbol, fundingRate, nextFundingTime }, ...]
```

### 4. 获取多空比

```typescript
const ratio = await coinglass.getLongShortRatio('BTC');
// 返回: { symbol, longRate, shortRate, longAccount, shortAccount }
```

### 5. 获取 ETF 数据

```typescript
const etf = await coinglass.getETFData('BTC');
// 返回: { symbol, netFlow, netFlow24h, totalAssets }
```

### 6. 扫描资金费率异常

```typescript
// 正资金费率最高
const positive = await coinglass.scanFundingAnomalies('positive', 10);

// 负资金费率最高
const negative = await coinglass.scanFundingAnomalies('negative', 10);
```

### 7. 获取完整 Ticker 数据

```typescript
const data = await coinglass.getTickerData('BTC');
// 返回: { symbol, price, fundingRate, longShortRatio, oi, oiChange24h, ... }
```

## DeepSeek API 调用示例

### 1. 分析轧空结构

```typescript
const deepseek = new DeepSeekService(apiKey);
const coinglassData = await coinglass.getShortSqueezeAnalysis('BTC');
const analysis = await deepseek.analyzeShortSqueeze(coinglassData);
// 返回: 结构化的中文分析文本
```

### 2. 分析 Ticker 状态

```typescript
const tickerData = await coinglass.getTickerData('ETH');
const analysis = await deepseek.analyzeTickerStatus(tickerData);
// 返回: 合约状态分析文本
```

### 3. 分析 ETF 资金流

```typescript
const etfData = await coinglass.getETFHistory('BTC', 30);
const analysis = await deepseek.analyzeETF({ symbol: 'BTC', history: etfData });
// 返回: ETF 资金流分析文本
```

## 注意事项

### CoinGlass API

1. **API Key**: 需要在 CoinGlass 官网申请
2. **请求限制**: 注意 API 调用频率限制
3. **数据格式**: 不同端点返回的数据格式可能不同，需要根据实际 API 文档调整
4. **错误处理**: 所有 API 调用都应包含错误处理

### DeepSeek API

1. **Prompt 设计**: 确保 Prompt 明确要求不预测价格，只分析结构
2. **数据输入**: 只传入 CoinGlass 返回的真实数据，不要编造
3. **输出格式**: 使用结构化的输出格式（Markdown）便于展示

## 实际 API 端点参考

根据 CoinGlass API 文档，主要端点包括：

- `/fr_ohlc_history` - 历史 OHLC 数据
- `/indicator/long_short_account` - 多空账户比
- `/indicator/funding_rate` - 资金费率
- `/etf` - ETF 数据
- `/etf/history` - ETF 历史数据

**重要**: 实际使用时，请根据 CoinGlass API v4.0 的最新文档调整端点路径和参数。

