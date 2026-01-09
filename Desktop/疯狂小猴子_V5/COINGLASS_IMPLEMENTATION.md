# CoinGlass v4 API 接入实现总结

## ✅ 已完成的工作

### 1. 工程化模块结构

- ✅ `src/config/env.ts` - 环境变量配置（使用 zod 验证）
- ✅ `src/utils/http.ts` - HTTP 客户端（支持重试、错误处理、响应头读取）
- ✅ `src/utils/retry.ts` - 重试工具（指数退避）
- ✅ `src/utils/rateLimit.ts` - 限流管理（p-limit + 响应头监控）
- ✅ `src/utils/cache.ts` - LRU 缓存实现
- ✅ `src/clients/coinglass.client.ts` - CoinGlass API 客户端（生产级）
- ✅ `src/services/coinglass.service.ts` - CoinGlass 业务服务层
- ✅ `src/commands/coinglass.commands.ts` - Bot 命令（/cg_ping, /cg_demo）

### 2. 核心功能

#### HTTP 客户端特性
- ✅ 自动添加请求头：`accept: application/json` 和 `CG-API-KEY`
- ✅ 统一错误处理（401/403/429/5xx）
- ✅ 指数退避重试（仅对网络错误、5xx、429）
- ✅ 响应头读取（API-KEY-MAX-LIMIT, API-KEY-USE-LIMIT）
- ✅ TraceId 追踪（每个请求生成 UUID）

#### CoinGlass Client 特性
- ✅ LRU 缓存（不同端点不同 TTL）
- ✅ 并发控制（p-limit）
- ✅ 限流监控和日志
- ✅ 限流时降级到缓存
- ✅ 兼容性方法（向后兼容旧代码）

#### 已实现的 API 端点
- ✅ `/api/futures/supported-coins` - 支持的币种
- ✅ `/api/futures/supported-exchange-pairs` - 支持的交易所和交易对
- ✅ `/api/futures/openInterest/exchange-list` - OI 交易所列表
- ✅ `/api/futures/openInterest/ohlc-history` - OI 历史 OHLC
- ✅ `/api/futures/fundingRate/exchange-list` - Funding Rate 交易所列表
- ✅ `/api/futures/fundingRate/ohlc-history` - Funding Rate 历史 OHLC
- ✅ `/api/futures/global-long-short-account-ratio/history` - 全网多空比历史
- ✅ `/api/futures/top-long-short-account-ratio/history` - 大户多空比历史（可选）
- ✅ `/api/etf/bitcoin/flow-history` - BTC ETF 资金流
- ✅ `/api/etf/ethereum/flow-history` - ETH ETF 资金流
- ✅ `/api/futures/basis/history` - 基差历史

### 3. Bot 命令

#### `/cg_ping` - 连通性验证
- 调用 `/api/futures/supported-coins`
- 显示币种数量和示例
- 显示 API 限流状态
- 友好的错误提示（401/403/429/timeout）

#### `/cg_demo <ticker>` - 演示数据回吐
- 验证 Ticker 是否支持
- 并行获取 OI、Funding Rate、多空比数据
- 格式化输出中文消息
- 支持重新查询按钮

## 📝 环境变量配置

在 `.env` 文件中添加：

```env
# CoinGlass API
COINGLASS_API_KEY=your_api_key_here
COINGLASS_BASE_URL=https://open-api-v4.coinglass.com
COINGLASS_TIMEOUT_MS=10000
COINGLASS_MAX_RETRIES=2
COINGLASS_CONCURRENCY=3
```

## 🚀 使用方式

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制 `.env.example` 到 `.env` 并填写 API Key

### 3. 编译

```bash
npm run build
```

### 4. 启动

```bash
npm start
```

### 5. 测试命令

在 Telegram Bot 中：
- `/cg_ping` - 测试连通性
- `/cg_demo BTC` - 测试数据回吐

## 🔍 关键点说明

### 为什么之前会连不通？

1. **请求头错误**：之前可能使用了 `coinglassSecret`，但 CoinGlass v4 要求使用 `CG-API-KEY`
2. **响应格式解析**：CoinGlass 返回 `{ code, msg, data }` 格式，需要检查 `code === "0"`
3. **错误处理不完善**：401/403/429 错误需要特殊处理

### 如何定位 401/429？

1. **401/403**：
   - 检查 `.env` 中的 `COINGLASS_API_KEY` 是否正确
   - 检查请求头是否包含 `CG-API-KEY`
   - 在 CoinGlass 官网验证 API Key 是否有效

2. **429**：
   - 查看日志中的限流信息（API-KEY-MAX-LIMIT, API-KEY-USE-LIMIT）
   - 检查是否并发请求过多
   - 考虑增加缓存时间或降低并发数

### 日志追踪

每个请求都有 `traceId`，可以在日志中搜索：
```bash
grep "traceId" logs/bot.log
```

## 📦 依赖

新增依赖：
- `uuid` - 生成 TraceId
- `p-limit` - 并发控制
- `@types/uuid` - TypeScript 类型定义

## 🔄 向后兼容

所有旧的服务代码都可以继续使用，因为：
- 兼容性方法保留了旧的方法签名
- 新方法使用对象参数，旧方法使用多个参数
- 内部实现统一使用新的 HTTP 客户端

## 📚 下一步

1. 测试所有端点是否正常工作
2. 根据实际使用情况调整缓存 TTL
3. 监控限流使用情况
4. 根据需求添加更多 API 端点

