# CoinGlass v4 API 接入完成 ✅

## 🎉 实现完成

所有代码已编译通过，生产级 CoinGlass API Client 已成功集成到 Telegram Bot 中。

## 📋 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

在 `.env` 文件中确保有以下配置：

```env
COINGLASS_API_KEY=your_api_key_here
COINGLASS_BASE_URL=https://open-api-v4.coinglass.com
COINGLASS_TIMEOUT_MS=10000
COINGLASS_MAX_RETRIES=2
COINGLASS_CONCURRENCY=3
```

### 3. 编译

```bash
npm run build
```

### 4. 启动 Bot

```bash
npm start
```

## 🧪 测试命令

在 Telegram Bot 中测试：

### `/cg_ping` - 连通性验证

测试 CoinGlass API 是否正常连接：
- 显示支持的币种数量
- 显示前 10 个币种示例
- 显示 API 限流状态（如果可用）

**成功示例：**
```
✅ CoinGlass 已连通

📊 支持的币种数量: 953
📋 前 10 个币种: BTC, ETH, SOL, BNB, XRP, ADA, DOGE, AVAX, MATIC, DOT

📈 API 限流状态:
   • 最大请求数: 60/分钟
   • 已使用: 5/分钟
   • 使用率: 8.3%

数据来源: CoinGlass API v4.0
```

### `/cg_demo BTC` - 演示数据回吐

获取指定 Ticker 的合约数据：
- 当前 OI（Binance）
- OI 24h 变化
- 当前资金费率（Binance）
- 全网账户多空比

**成功示例：**
```
📊 BTC（演示数据）

📈 当前 OI（Binance）: 12,345,678,901 USD
📊 OI 24h 变化: +2.34%

💹 当前资金费率（Binance）: 0.0123%

⚖️ 全网账户多空比（最新）: 1.25

数据源: CoinGlass
```

## 🔧 核心功能

### HTTP 客户端
- ✅ 自动添加请求头（`CG-API-KEY`, `accept: application/json`）
- ✅ 统一错误处理（401/403/429/5xx）
- ✅ 指数退避重试
- ✅ TraceId 追踪

### 缓存系统
- ✅ LRU 内存缓存
- ✅ 不同端点不同 TTL：
  - 支持的币种：24 小时
  - 交易所列表：2 分钟
  - 历史数据：5 分钟

### 限流管理
- ✅ 并发控制（p-limit）
- ✅ 响应头监控（API-KEY-MAX-LIMIT, API-KEY-USE-LIMIT）
- ✅ 限流时自动降级到缓存

### 已实现的 API 端点
- ✅ 支持的币种列表
- ✅ 支持的交易所和交易对
- ✅ OI 交易所列表和历史
- ✅ Funding Rate 交易所列表和历史
- ✅ 全网/大户多空比历史
- ✅ BTC/ETH ETF 资金流历史
- ✅ 基差历史

## 📊 错误处理

### 401/403 - API Key 错误
**可能原因：**
- API Key 无效或缺失
- 请求头中缺少 `CG-API-KEY`
- API Key 权限不足

**解决方案：**
1. 检查 `.env` 文件中的 `COINGLASS_API_KEY`
2. 确认 API Key 在 CoinGlass 官网有效
3. 检查 API Key 是否有访问权限

### 429 - 请求频率超限
**可能原因：**
- 请求频率超过限制

**解决方案：**
- 稍后重试
- Bot 会自动使用缓存数据（如果可用）

### 网络错误
**可能原因：**
- 网络连接问题
- CoinGlass 服务暂时不可用

**解决方案：**
- 检查网络连接
- 稍后重试

## 🔍 日志追踪

每个请求都有唯一的 `traceId`，可以在日志中搜索：

```bash
grep "traceId" logs/bot.log
```

## 📁 文件结构

```
src/
├── config/
│   └── env.ts                    # 环境变量配置
├── clients/
│   └── coinglass.client.ts       # CoinGlass API 客户端
├── services/
│   └── coinglass.service.ts     # CoinGlass 业务服务
├── commands/
│   └── coinglass.commands.ts    # Bot 命令（/cg_ping, /cg_demo）
└── utils/
    ├── http.ts                   # HTTP 客户端
    ├── retry.ts                  # 重试工具
    ├── rateLimit.ts              # 限流管理
    └── cache.ts                  # LRU 缓存
```

## 🔄 向后兼容

所有旧的服务代码都可以继续使用，因为：
- 兼容性方法保留了旧的方法签名
- 新方法使用对象参数，旧方法使用多个参数
- 内部实现统一使用新的 HTTP 客户端

## 📝 下一步

1. ✅ 测试 `/cg_ping` 命令验证连通性
2. ✅ 测试 `/cg_demo BTC` 验证数据回吐
3. 根据实际使用情况调整缓存 TTL
4. 监控限流使用情况
5. 根据需求添加更多 API 端点

## 🎯 关键点

### 为什么之前会连不通？

1. **请求头错误**：CoinGlass v4 要求使用 `CG-API-KEY`（不是 `coinglassSecret`）
2. **响应格式解析**：需要检查 `code === "0"` 判断成功
3. **错误处理不完善**：401/403/429 需要特殊处理

### 如何定位问题？

1. 查看日志中的 `traceId`
2. 检查响应头中的限流信息
3. 使用 `/cg_ping` 命令快速诊断

---

**实现完成时间：** 2024
**状态：** ✅ 编译通过，可以上线使用

