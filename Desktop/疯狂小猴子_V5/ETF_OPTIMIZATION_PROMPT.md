# ETF 功能优化 Prompt（Cursor 使用）

## 背景

当前 Telegram Bot 的 ETF 功能只使用了基础的 `flow-history` 端点，缺少详细的 ETF 信息（如 AUM、价格变化、市场状态等）。需要集成 CoinGlass API 的更多端点，获取完整的 ETF 数据并优化展示。

## 目标

优化 ETF 功能，使其能够：
1. 展示每个 ETF 的详细信息（AUM、价格、价格变化、市场状态等）
2. 结合资金流数据和净资产数据，提供更全面的分析
3. 优化用户界面，让信息更清晰、更有价值

## API 端点需求

### 1. 已实现的端点
- ✅ `/api/etf/bitcoin/flow-history` - 资金流历史
- ✅ `/api/etf/ethereum/flow-history` - ETH ETF 资金流
- ✅ `/api/etf/solana/flow-history` - SOL ETF 资金流

### 2. 需要新增的端点

#### A. ETF 列表（包含详细信息）
**端点**: `GET /api/etf/bitcoin/list`
**请求头**: 
```
CG-API-KEY: {API_KEY}
accept: application/json
```

**响应示例**:
```json
{
  "code": "0",
  "data": [
    {
      "ticker": "GBTC",
      "fund_name": "Grayscale Bitcoin Trust ETF",
      "region": "us",
      "market_status": "closed",
      "primary_exchange": "ARCX",
      "cik_code": "0001588489",
      "fund_type": "Spot",
      "market_cap_usd": "14290964710.0",
      "list_date": 1424822400000,
      "shares_outstanding": "212980100",
      "aum_usd": "14292916691",
      "management_fee_percent": "1.5",
      "last_trade_time": 1766019600026,
      "last_quote_time": 1766019600066,
      "volume_quantity": 7660345,
      "volume_usd": 525113585.612,
      "price_usd": 67.1,
      "price_change_usd": -1.39,
      "price_change_percent": -2.03,
      "asset_details": {
        "net_asset_value_usd": 14292916691,
        ...
      }
    }
  ]
}
```

**需要实现的端点**:
- `/api/etf/bitcoin/list` - BTC ETF 列表（包含所有详细信息）
- `/api/etf/ethereum/list` - ETH ETF 列表（如果存在）
- `/api/etf/solana/list` - SOL ETF 列表（如果存在）

#### B. 净资产历史（可选，用于历史趋势）
**端点**: `GET /api/etf/bitcoin/net-assets/history`
**说明**: 此端点返回净资产历史数据，可用于展示趋势图

#### B. 其他可能需要的端点（根据 CoinGlass 文档）
- ETF 列表端点（获取所有支持的 ETF）
- ETF 详情端点（单个 ETF 的详细信息）
- ETF 价格历史端点
- ETF 溢价/折扣历史端点

## 实现要求

### 1. 类型定义扩展

在 `src/types/index.ts` 中添加：

```typescript
// ETF 净资产数据
export interface CoinGlassETFNetAssets {
  ticker: string;
  fund_name: string;
  region: string;
  market_status: 'open' | 'closed' | 'pre_market' | 'after_hours';
  primary_exchange: string;
  cik_code?: string;
  fund_type: string;
  market_cap_usd: string;
  list_date: number;
  shares_outstanding: string;
  aum_usd: string; // 资产管理规模
  management_fee_percent: string;
  last_trade_time: number;
  last_quote_time: number;
  volume_quantity: number;
  volume_usd: number;
  price_usd: number;
  price_change_usd: number;
  price_change_percent: number;
  asset_details?: {
    net_asset_value_usd: number;
    [key: string]: any;
  };
}

// 合并的 ETF 数据（资金流 + 净资产）
export interface CoinGlassETFComplete {
  // 来自 flow-history
  timestamp: number;
  flow_usd: string;
  price_usd: string;
  etf_flows: Array<{
    etf_ticker: string;
    flow_usd?: string;
  }>;
  
  // 来自 net-assets/history（按 ticker 匹配）
  etf_details?: Record<string, CoinGlassETFNetAssets>;
}
```

### 2. CoinGlass Client 扩展

在 `src/clients/coinglass.client.ts` 中添加：

```typescript
/**
 * 获取 BTC ETF 列表（包含详细信息）
 * GET /api/etf/bitcoin/list
 */
async getBTCETFList(): Promise<CoinGlassETFNetAssets[]> {
  const cacheKey = 'btc-etf-list';
  return this.cachedRequest(cacheKey, async () => {
    const response = await this.api.get('/api/etf/bitcoin/list');
    const data = this.parseResponse(response);
    return Array.isArray(data) ? data : [];
  });
}

/**
 * 获取 BTC ETF 净资产历史（可选，用于历史趋势）
 * GET /api/etf/bitcoin/net-assets/history
 */
async getBTCETFNetAssetsHistory(): Promise<any[]> {
  const cacheKey = 'btc-etf-net-assets-history';
  return this.cachedRequest(cacheKey, async () => {
    const response = await this.api.get('/api/etf/bitcoin/net-assets/history');
    const data = this.parseResponse(response);
    return Array.isArray(data) ? data : [];
  });
}

/**
 * 获取 ETH ETF 列表（如果存在）
 */
async getETFETFList(): Promise<CoinGlassETFNetAssets[]> {
  const cacheKey = 'eth-etf-list';
  return this.cachedRequest(cacheKey, async () => {
    try {
      const response = await this.api.get('/api/etf/ethereum/list');
      const data = this.parseResponse(response);
      return Array.isArray(data) ? data : [];
    } catch (error) {
      logger.warn('ETH ETF list endpoint may not exist');
      return [];
    }
  });
}

/**
 * 获取 SOL ETF 列表（如果存在）
 */
async getSOLETFList(): Promise<CoinGlassETFNetAssets[]> {
  const cacheKey = 'sol-etf-list';
  return this.cachedRequest(cacheKey, async () => {
    try {
      const response = await this.api.get('/api/etf/solana/list');
      const data = this.parseResponse(response);
      return Array.isArray(data) ? data : [];
    } catch (error) {
      logger.warn('SOL ETF list endpoint may not exist');
      return [];
    }
  });
}
```

### 3. ETF Service 优化

在 `src/services/etf.service.ts` 中：

#### A. 添加获取完整数据的方法

```typescript
/**
 * 获取完整的 ETF 数据（资金流 + 净资产详情）
 */
async getCompleteETFData(symbol: 'BTC' | 'ETH' | 'SOL'): Promise<CoinGlassETFComplete | null> {
  try {
    // 获取资金流数据
    const flow = await this.getLatestFlow(symbol);
    if (!flow) return null;

    // 获取 ETF 列表数据（包含详细信息）
    let etfList: CoinGlassETFNetAssets[] = [];
    switch (symbol) {
      case 'BTC':
        etfList = await this.coinglass.getBTCETFList();
        break;
      case 'ETH':
        etfList = await this.coinglass.getETFETFList();
        break;
      case 'SOL':
        etfList = await this.coinglass.getSOLETFList();
        break;
    }

    // 将 ETF 列表数据按 ticker 组织成 Map
    const etfDetailsMap: Record<string, CoinGlassETFNetAssets> = {};
    etfList.forEach(asset => {
      etfDetailsMap[asset.ticker] = asset;
    });

    return {
      ...flow,
      etf_details: etfDetailsMap,
    };
  } catch (error) {
    logger.error({ error, symbol }, 'Failed to get complete ETF data');
    throw error;
  }
}
```

#### B. 优化格式化方法

```typescript
/**
 * 格式化完整的 ETF 数据（包含详细信息）
 */
formatCompleteETFData(complete: CoinGlassETFComplete, symbol: string): string {
  const flowUsd = parseFloat(complete.flow_usd || '0');
  const priceUsd = parseFloat(complete.price_usd || '0');
  const sign = flowUsd >= 0 ? '+' : '';
  
  const date = new Date(complete.timestamp);
  const dateStr = date.toLocaleDateString('zh-CN', { 
    year: 'numeric', 
    month: '2-digit', 
    day: '2-digit' 
  });
  
  let message = `📊 ${symbol} ETF 资金流详情\n\n`;
  message += `📅 日期: ${dateStr}\n`;
  message += `💰 总净流入: ${sign}${formatLargeNumber(flowUsd)} USD\n`;
  message += `💎 BTC 价格: $${formatLargeNumber(priceUsd)}\n\n`;
  
  if (complete.etf_flows && Array.isArray(complete.etf_flows) && complete.etf_flows.length > 0) {
    message += `📈 各 ETF 明细：\n\n`;
    
    // 合并资金流和净资产数据
    const enrichedFlows = complete.etf_flows
      .filter(etf => etf.etf_ticker && etf.flow_usd !== undefined)
      .map(etf => {
        const details = complete.etf_details?.[etf.etf_ticker];
        return {
          ticker: etf.etf_ticker,
          flowUsd: parseFloat(etf.flow_usd || '0'),
          details: details,
        };
      })
      .sort((a, b) => Math.abs(b.flowUsd) - Math.abs(a.flowUsd)); // 按绝对值排序
    
    enrichedFlows.forEach((etf, index) => {
      const flowSign = etf.flowUsd >= 0 ? '+' : '';
      message += `${index + 1}. ${etf.ticker}\n`;
      message += `   资金流: ${flowSign}${formatLargeNumber(etf.flowUsd)} USD\n`;
      
      if (etf.details) {
        const details = etf.details;
        message += `   基金名称: ${details.fund_name}\n`;
        message += `   AUM: $${formatLargeNumber(parseFloat(details.aum_usd))}\n`;
        message += `   价格: $${formatLargeNumber(details.price_usd)}`;
        
        if (details.price_change_percent !== undefined) {
          const changeSign = details.price_change_percent >= 0 ? '+' : '';
          message += ` (${changeSign}${details.price_change_percent.toFixed(2)}%)\n`;
        } else {
          message += `\n`;
        }
        
        message += `   市场状态: ${this.formatMarketStatus(details.market_status)}\n`;
        message += `   交易所: ${details.primary_exchange}\n`;
        
        if (details.management_fee_percent) {
          message += `   管理费: ${details.management_fee_percent}%\n`;
        }
      }
      
      message += `\n`;
    });
  }
  
  message += `\n数据来源: CoinGlass API`;
  
  return message;
}

/**
 * 格式化市场状态
 */
private formatMarketStatus(status: string): string {
  const statusMap: Record<string, string> = {
    'open': '🟢 交易中',
    'closed': '🔴 已收盘',
    'pre_market': '🟡 盘前',
    'after_hours': '🟡 盘后',
  };
  return statusMap[status] || status;
}
```

### 4. 路由更新

在 `src/routes/etf.ts` 中更新 `handleETFData` 方法：

```typescript
async function handleETFData(ctx: any, symbol: 'BTC' | 'ETH' | 'SOL', service: ETFService, guard: EntitlementGuard) {
  try {
    await ctx.reply(`📊 正在获取 ${symbol} ETF 数据...`);

    // 使用新的完整数据方法
    const complete = await service.getCompleteETFData(symbol);

    if (!complete) {
      await ctx.reply(`❌ 无法获取 ${symbol} 的 ETF 数据`);
      return;
    }

    // 使用新的格式化方法
    const message = service.formatCompleteETFData(complete, symbol);

    const keyboard = new InlineKeyboard()
      .text('📈 查看过去 30 天历史', `etf_history_${symbol}`)
      .row()
      .text('🔙 返回', 'etf');

    await ctx.reply(message, {
      reply_markup: keyboard,
    });
  } catch (error) {
    logger.error({ error, symbol }, 'Failed to get ETF data');
    await ctx.reply(`❌ 获取失败: ${error instanceof Error ? error.message : '未知错误'}`);
  }
}
```

## 实现步骤

1. **第一步：扩展类型定义**
   - 在 `src/types/index.ts` 中添加 `CoinGlassETFNetAssets` 和 `CoinGlassETFComplete` 接口

2. **第二步：扩展 CoinGlass Client**
   - 在 `src/clients/coinglass.client.ts` 中添加三个新方法：
     - `getBTCETFNetAssetsHistory()`
     - `getETFETFNetAssetsHistory()`
     - `getSOLETFNetAssetsHistory()`

3. **第三步：优化 ETF Service**
   - 添加 `getCompleteETFData()` 方法
   - 添加 `formatCompleteETFData()` 方法
   - 添加 `formatMarketStatus()` 辅助方法

4. **第四步：更新路由**
   - 修改 `handleETFData()` 使用新的完整数据方法

5. **第五步：测试**
   - 测试 BTC ETF 数据获取
   - 验证所有字段正确显示
   - 检查错误处理

## 注意事项

1. **API 端点可用性**：ETH 和 SOL 的 `net-assets/history` 端点可能不存在，需要优雅处理
2. **数据匹配**：确保 `etf_flows` 中的 `ticker` 与 `net-assets` 中的 `ticker` 能正确匹配
3. **缓存策略**：净资产数据变化频率较低，可以设置更长的缓存时间（如 5 分钟）
4. **错误处理**：如果净资产数据获取失败，应该降级到只显示资金流数据
5. **性能优化**：如果 ETF 数量很多，考虑分页或限制显示数量

## 预期效果

优化后的 ETF 功能应该能够：
- 显示每个 ETF 的完整信息（名称、AUM、价格、价格变化等）
- 提供更专业的展示格式
- 帮助用户更好地理解 ETF 市场状况
- 为后续的 AI 分析提供更丰富的数据基础

## 测试命令

```bash
# 测试 ETF 列表端点（主要端点）
curl --request GET \
     --url https://open-api-v4.coinglass.com/api/etf/bitcoin/list \
     --header 'CG-API-KEY: YOUR_API_KEY' \
     --header 'accept: application/json'

# 测试净资产历史端点（可选）
curl --request GET \
     --url https://open-api-v4.coinglass.com/api/etf/bitcoin/net-assets/history \
     --header 'CG-API-KEY: YOUR_API_KEY' \
     --header 'accept: application/json'
```

## 已验证的端点

✅ `/api/etf/bitcoin/list` - 返回 19 个 BTC ETF 的详细信息
- 包含所有字段：ticker, fund_name, region, market_status, aum_usd, price_usd, price_change_percent 等
- 数据格式与用户提供的示例完全匹配

✅ `/api/etf/bitcoin/net-assets/history` - 返回净资产历史数据
- 可用于展示历史趋势

## 完成标准

- [ ] 所有新端点已实现并测试
- [ ] 类型定义完整且正确
- [ ] 数据合并逻辑正确
- [ ] 格式化输出美观且信息完整
- [ ] 错误处理完善
- [ ] 代码通过编译和 Lint 检查
- [ ] 在 Telegram Bot 中测试通过

