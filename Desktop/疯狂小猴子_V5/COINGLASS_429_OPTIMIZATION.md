# CoinGlass API 429 限流优化总结

## 📋 改动概述

本次优化针对 CoinGlass API 频繁 429 限流问题，实现了多层次的保护机制，确保系统稳定运行并降低限流发生率。

## 🎯 优化目标与实现

### P0: 降低 429 发生率

#### 1. RPS 限速（Token Bucket）

**实现位置**: `src/utils/rateLimit.ts`

**改动内容**:
- 新增 `TokenBucket` 类，实现令牌桶算法
- 在 `RateLimitManager` 中集成 RPS 控制
- 请求先获取 RPS token（必要时 sleep），再进入并发队列

**配置项**:
- `COINGLASS_RPS`: 每秒请求数限制（默认 2）
- `COINGLASS_BURST`: 突发请求容量（默认 2）

**效果**: 严格控制单位时间内的请求数，避免突发流量触发限流

#### 2. 429 重试策略优化

**实现位置**: `src/utils/retry.ts`, `src/utils/http.ts`

**改动内容**:
- 优先使用响应头 `Retry-After`（如果存在）
- 指数退避：1s, 2s, 4s, 8s...（上限 `COINGLASS_MAX_BACKOFF_MS`）
- 添加 jitter（0~300ms 随机）避免同步重试
- 仅对 429、5xx、网络错误重试；其他 4xx 直接抛错

**配置项**:
- `COINGLASS_MAX_RETRY`: 最大重试次数（默认 5）
- `COINGLASS_MAX_BACKOFF_MS`: 最大退避时间（默认 30000ms）

**效果**: 尊重服务端限流指示，避免窗口内反复撞限流

### P1: 避免缓存到期时的并发风暴

#### 3. In-Flight 去重

**实现位置**: `src/clients/coinglass.client.ts`

**改动内容**:
- 新增 `inflight: Map<string, Promise<any>>` 存储进行中的请求
- 相同 `cacheKey` 的请求共享同一个 Promise
- 请求完成后（无论成功或失败）自动清理

**效果**: 防止同一缓存 key 在 TTL 到期瞬间触发多个并发请求

#### 4. Stale-While-Revalidate 缓存兜底

**实现位置**: `src/utils/cache.ts`, `src/clients/coinglass.client.ts`

**改动内容**:
- 缓存值扩展为 `{ data, expires, staleExpires }` 结构
- 两层过期策略：
  - **Fresh TTL**: 保持现有 TTL（例如 5min/10min）
  - **Stale TTL**: fresh 过期后仍可使用的兜底窗口（默认 30min）
- 读取逻辑：
  - Fresh 未过期：直接返回
  - Fresh 过期但 stale 未过期：返回 stale（同时触发后台更新）
  - Stale 也过期：请求接口
- 429/网络错误时优先返回 stale（如果存在）

**配置项**:
- `COINGLASS_STALE_TTL_MS`: Stale 缓存 TTL（默认 1800000ms = 30分钟）

**效果**: 429 时尽量返回可用数据，避免完全无数据的情况

### P2: 批量请求保护

#### 5. 批量请求分片 + 抖动

**实现位置**: `src/services/fundingNegativeOIService.ts`

**改动内容**:
- 将批量请求分片（每 20 个一组）
- 批次间添加抖动延迟（300~800ms 随机）
- 先调用轻量接口筛选候选集合，再对候选集合调用重接口

**效果**: 避免批量遍历时一次性发送过多请求

## 📝 修改的文件列表

1. **`src/config/env.ts`**
   - 新增配置项：`COINGLASS_RPS`, `COINGLASS_BURST`, `COINGLASS_MAX_RETRY`, `COINGLASS_MAX_BACKOFF_MS`, `COINGLASS_STALE_TTL_MS`

2. **`src/utils/rateLimit.ts`**
   - 新增 `TokenBucket` 类（令牌桶算法）
   - `RateLimitManager` 集成 RPS 控制

3. **`src/utils/retry.ts`**
   - `RetryUtil.retry()` 支持 Retry-After 头、指数退避、jitter
   - `withRetry()` 使用新的重试策略
   - 新增 `extractRetryAfter()` 方法

4. **`src/utils/cache.ts`**
   - `LRUCache` 支持 stale-while-revalidate
   - 新增 `getWithStaleInfo()` 方法
   - `set()` 方法支持 stale TTL

5. **`src/clients/coinglass.client.ts`**
   - 新增 `inflight` Map 实现 in-flight 去重
   - `request()` 方法集成 stale-while-revalidate
   - 新增 `refreshCacheInBackground()` 方法
   - 429 错误时优先返回 stale 缓存

6. **`src/utils/http.ts`**
   - 429 错误时将响应头传递给 `HttpError`（用于提取 Retry-After）

7. **`src/services/fundingNegativeOIService.ts`**
   - `pickMaxOI()` 方法实现批量请求分片 + 抖动

## 🔧 环境变量配置

在 `.env` 文件中添加以下配置（所有配置项都有默认值，可选）：

```env
# CoinGlass 限流配置
COINGLASS_RPS=2                    # 每秒请求数限制
COINGLASS_BURST=2                  # 突发请求容量
COINGLASS_MAX_RETRY=5              # 最大重试次数（用于 429/5xx）
COINGLASS_MAX_BACKOFF_MS=30000     # 最大退避时间（毫秒）
COINGLASS_STALE_TTL_MS=1800000     # Stale 缓存 TTL（30分钟）
```

## 📊 默认参数推荐值与调整建议

### 推荐默认值

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| `COINGLASS_RPS` | 2 | 每秒 2 个请求，适合大多数场景 |
| `COINGLASS_BURST` | 2 | 允许突发 2 个请求 |
| `COINGLASS_MAX_RETRY` | 5 | 最多重试 5 次 |
| `COINGLASS_MAX_BACKOFF_MS` | 30000 | 最大退避 30 秒 |
| `COINGLASS_STALE_TTL_MS` | 1800000 | Stale 缓存 30 分钟 |

### 调整建议

#### 如果仍然频繁 429：

1. **降低 RPS**：将 `COINGLASS_RPS` 调整为 1
2. **增加退避时间**：将 `COINGLASS_MAX_BACKOFF_MS` 调整为 60000（60秒）
3. **增加 stale TTL**：将 `COINGLASS_STALE_TTL_MS` 调整为 3600000（1小时）

#### 如果需要更高吞吐量：

1. **提高 RPS**：将 `COINGLASS_RPS` 调整为 3-5（需确认 API 套餐限制）
2. **增加 burst**：将 `COINGLASS_BURST` 调整为 5-10
3. **注意**：提高吞吐量可能导致 429，建议先测试

#### 如果数据实时性要求高：

1. **缩短 stale TTL**：将 `COINGLASS_STALE_TTL_MS` 调整为 900000（15分钟）
2. **注意**：缩短 stale TTL 可能导致 429 时无数据可用

## 🎯 如何降低 429

### 1. RPS 限速（核心机制）

- **Token Bucket 算法**：严格控制每秒请求数
- **并发控制**：p-limit 限制同时进行的请求数
- **双重保护**：RPS + 并发同时生效

### 2. 重试策略优化

- **Retry-After 支持**：尊重服务端指示的等待时间
- **指数退避**：避免短时间内重复请求
- **Jitter**：随机化重试时间，避免同步重试

### 3. 缓存优化

- **Stale-While-Revalidate**：429 时返回 stale 数据，避免完全无数据
- **In-Flight 去重**：防止缓存到期时的并发风暴

### 4. 批量请求保护

- **分片处理**：将大批量请求分成小批次
- **抖动延迟**：批次间添加随机延迟

## 🛡️ 如何避免缓存雪崩

### 1. In-Flight 去重

**问题场景**：多个请求同时发现缓存过期，同时发起 API 请求

**解决方案**：
- 使用 `Map<string, Promise>` 存储进行中的请求
- 相同 `cacheKey` 的请求共享同一个 Promise
- 请求完成后自动清理

**效果**：即使 100 个请求同时发现缓存过期，也只会发起 1 个 API 请求

### 2. Stale-While-Revalidate

**问题场景**：缓存到期时，所有请求都去请求 API，导致并发风暴

**解决方案**：
- Fresh 过期后，仍可返回 stale 数据
- 返回 stale 数据的同时，触发后台更新
- 429 时优先返回 stale，避免触发更多请求

**效果**：缓存到期时，请求可以立即返回 stale 数据，后台异步更新

## 📈 性能影响

### 正面影响

1. **降低 429 发生率**：RPS 限速 + 重试策略优化
2. **提高可用性**：Stale 缓存兜底，429 时仍有数据可用
3. **减少 API 调用**：In-flight 去重 + 缓存优化

### 潜在影响

1. **响应延迟**：RPS 限速可能导致请求需要等待 token
2. **数据新鲜度**：Stale 缓存可能返回稍旧的数据（但保证可用）

### 权衡建议

- **生产环境**：使用默认配置，平衡性能和稳定性
- **高并发场景**：适当提高 RPS 和 burst，但需监控 429 频率
- **数据敏感场景**：缩短 stale TTL，但需接受更高的 429 风险

## 🔍 监控与调试

### 日志输出

所有关键操作都有日志输出：

- **RPS 限速**：`logger.debug` 记录 token 获取和等待
- **重试**：`logger.debug` 记录重试原因、尝试次数、等待时间
- **Stale 缓存**：`logger.warn` 记录 `served_stale=true`
- **In-Flight**：`logger.debug` 记录请求共享

### 关键日志字段

- `wait_ms`: 重试等待时间（毫秒）
- `reason`: 重试原因（`HTTP 429` 或 `network error`）
- `attempt`: 当前尝试次数
- `served_stale`: 是否返回了 stale 数据
- `retryAfterSeconds`: Retry-After 头值（秒）

## ✅ 向后兼容性

- **API 结构不变**：所有对外接口保持原有返回格式
- **调用方无需修改**：新增逻辑封装在 `utils/client` 内
- **配置项可选**：所有新配置项都有默认值

## 🚀 部署建议

1. **先测试**：在测试环境验证新配置
2. **监控 429**：部署后监控 429 频率是否降低
3. **调整参数**：根据实际情况调整 RPS、burst 等参数
4. **观察日志**：关注 `served_stale` 和重试日志

## 📚 相关文档

- `src/utils/rateLimit.ts` - RPS 限速实现
- `src/utils/retry.ts` - 重试策略实现
- `src/utils/cache.ts` - 缓存实现
- `src/clients/coinglass.client.ts` - CoinGlass 客户端实现



