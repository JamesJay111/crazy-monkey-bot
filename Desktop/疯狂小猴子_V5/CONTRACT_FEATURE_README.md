# 合约查询功能 - 完整实现文档

## 📋 功能概述

实现了完整的「单个 Ticker 合约状态查询」功能，包含：
1. **合约核心状态数据**（免费阶段）
2. **爆仓/清算数据**（近24h）
3. **DeepSeek AI 结构分析**（付费阶段）

## 🎯 用户流程

### 第一阶段（免费）
用户输入 `/contract BTC` 或点击按钮后输入 Ticker，Bot 立即返回：

- OI 持仓总量（USD）
- 当前资金费率
- 24h 多军增加量（USD，估算）
- 24h 空军增加量（USD，估算）
- 当前多空比
- 近24h 多单爆仓总额（USD）
- 近24h 空单爆仓总额（USD）
- 多空爆仓差值（Long - Short）

### 第二阶段（付费分析）
第一阶段输出后，Bot 自动弹出二次确认：

**是否需要对以上数据进行结构分析？**

包含内容：
- 当前多空是否拥挤
- OI 变化是否异常
- 资金费率是否处于极端区间
- 清算方向是否显示挤压风险（结构提示）
- 是否存在潜在挤压风险（不预测价格、不喊单）

**权限规则：**
- ✅ 已付费 或 输入有效 code（Ocean001）→ 执行 DeepSeek 分析
- ❌ 未付费 → 提示获取 code 的渠道

## 🔧 技术实现

### 1. 新增服务

#### `LiquidationService` (`src/services/liquidation.service.ts`)
- 处理爆仓/清算数据获取
- 支持 1h 粒度（24条）和 1d 粒度（fallback）
- 自动汇总近24h数据

#### `ContractSnapshotService` (`src/services/contractSnapshot.service.ts`)
- 聚合合约核心状态数据
- 整合爆仓数据
- 验证交易对支持情况
- 处理数据降级和容错

#### `ContractService` (重构)
- 整合快照和分析功能
- 格式化输出（免费/付费）
- DeepSeek AI 分析调用
- 降级分析（规则判断）

### 2. CoinGlass API 端点

#### 已实现的端点

1. **币种合约市场数据（聚合）**
   - `GET /api/futures/coins-markets`
   - 获取 OI、资金费率、多空比等核心数据

2. **交易对爆仓历史**
   - `GET /api/futures/liquidation/history`
   - 参数：`exchange`, `symbol`, `interval`, `limit`
   - 返回：`time`, `long_liquidation_usd`, `short_liquidation_usd`

3. **支持的交易所和交易对**
   - `GET /api/futures/supported-exchange-pairs`
   - 用于验证交易对是否支持

4. **全网账户多空比历史**
   - `GET /api/futures/global-long-short-account-ratio/history`
   - 用于获取多空比数据

5. **资金费率交易所列表**
   - `GET /api/futures/funding-rate/exchange-list`
   - 作为资金费率的 fallback 数据源

### 3. 数据流程

```
用户输入 Ticker
    ↓
ContractSnapshotService.getContractSnapshot()
    ↓
并行获取：
  - coins-markets (核心数据)
  - global-long-short-account-ratio (多空比)
  - funding-rate/exchange-list (资金费率 fallback)
  - liquidation/history (爆仓数据)
  - supported-exchange-pairs (验证)
    ↓
构建 ContractSnapshot
    ↓
格式化输出（免费阶段）
    ↓
用户点击"是否需要分析"
    ↓
检查权限 → 调用 DeepSeek 分析
    ↓
格式化分析结果（付费阶段）
```

### 4. 容错与降级

- **爆仓数据失败**：显示"清算数据暂不可用"，其他数据正常显示
- **资金费率缺失**：从 `funding-rate/exchange-list` fallback
- **多空比缺失**：使用默认值 1.0
- **DeepSeek 失败**：使用规则判断降级分析
- **429 限流**：指数退避重试，缓存降级

### 5. 缓存策略

- **Contract snapshot**：TTL 30-60s
- **Liquidation 24h**：TTL 60s
- **Supported pairs**：TTL 1h

## 📝 类型定义

### `ContractSnapshot`
```typescript
{
  symbol: string;
  pairSymbol: string; // 如 BTCUSDT
  exchange: string; // 默认 Binance
  oiUsd: number;
  fundingRate: number;
  longIncreaseUsd24h: number;
  shortIncreaseUsd24h: number;
  longShortRatio: number;
  liquidation24h: {
    longUsd24h: number;
    shortUsd24h: number;
    netLongMinusShortUsd24h: number;
  } | null;
  isBinanceFutures: boolean;
  dataSource: 'CoinGlass';
}
```

### `ContractAnalysis`
```typescript
{
  ticker: string;
  structure: 'neutral' | 'long_crowded' | 'short_crowded' | 'squeeze_risk';
  confidence: number; // 0-100
  keyFindings: string[];
  interpretation: string; // 不超过120字
  whatToWatch: string[];
  disclaimer: string;
}
```

## 🧪 本地验收

### 测试步骤

1. **启动 Bot**
   ```bash
   npm run build
   npm start
   ```

2. **测试免费阶段**
   ```
   /contract BTC
   ```
   预期：
   - 显示完整的合约快照数据
   - 包含爆仓数据（如果可用）
   - 弹出"是否需要分析"提示

3. **测试付费分析**
   - 点击"解锁分析"
   - 输入邀请码 `Ocean001`
   - 或支付 2999 Stars
   - 查看分析结果

4. **测试错误处理**
   - 输入不支持的 Ticker（如 `INVALID`）
   - 预期：显示友好的错误提示和候选交易对

5. **测试交易对格式**
   ```
   /contract BTCUSDT
   ```
   预期：正常处理，使用 BTCUSDT 作为交易对

### 验收标准

- ✅ `/contract BTC` 能稳定输出 5 项核心数据 + 近24h 清算数据（若可用）
- ✅ 输出字段与 CoinGlass 文档一致
- ✅ 输出后出现"是否需要分析"的二次交互
- ✅ 未付费：提示 Stars / Code 获取渠道
- ✅ 已解锁：返回结构化 JSON 分析结论（包含 liquidation finding）
- ✅ 全程不预测价格、不喊单
- ✅ 错误处理友好，包含重试和返回按钮

## 📚 相关文件

- `src/services/liquidation.service.ts` - 爆仓数据服务
- `src/services/contractSnapshot.service.ts` - 合约快照服务
- `src/services/contract.service.ts` - 合约查询服务（重构）
- `src/routes/contract.ts` - 合约查询路由
- `src/prompts/contract.prompt.ts` - DeepSeek 分析 Prompt
- `src/types/index.ts` - 类型定义
- `src/clients/coinglass.client.ts` - CoinGlass API 客户端（已扩展）

## 🔄 后续优化

1. **更精确的 24h 增量计算**
   - 当前使用 `long_volume_usd` / `short_volume_usd` 作为代理
   - TODO: 接入更严格的日对日差分（需要历史接口或明确增量字段来源）

2. **多交易所支持**
   - 当前默认 Binance
   - 未来可支持用户选择交易所

3. **历史趋势分析**
   - 当前分析基于快照数据
   - 未来可加入 7-30 天历史趋势对比

4. **实时更新**
   - 当前缓存 TTL 较短（30-60s）
   - 未来可支持 WebSocket 实时推送

