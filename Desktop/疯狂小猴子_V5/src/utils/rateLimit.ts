import pLimit from 'p-limit';
import { logger } from './logger';
import { env } from '../config/env';

/**
 * Token Bucket 限流器（用于 RPS 控制）
 */
class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private readonly capacity: number; // 桶容量（burst）
  private readonly refillRate: number; // 每秒补充的 token 数（RPS）

  constructor(capacity: number, refillRate: number) {
    this.capacity = capacity;
    this.refillRate = refillRate;
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  /**
   * 尝试获取一个 token，如果成功返回 true，否则返回 false
   */
  async acquire(): Promise<void> {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000; // 秒

    // 补充 tokens
    this.tokens = Math.min(
      this.capacity,
      this.tokens + elapsed * this.refillRate
    );
    this.lastRefill = now;

    // 如果有 token，直接消耗
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }

    // 否则需要等待
    const waitTime = (1 - this.tokens) / this.refillRate * 1000; // 毫秒
    await this.sleep(waitTime);

    // 等待后再次尝试
    this.tokens = 0; // 消耗掉补充的 token
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * 限流管理器（并发控制 + RPS 控制）
 */
export class RateLimitManager {
  private limit: ReturnType<typeof pLimit>;
  private tokenBucket: TokenBucket;
  private maxLimit: number | null = null;
  private useLimit: number | null = null;

  constructor(concurrency: number, rps?: number, burst?: number) {
    this.limit = pLimit(concurrency);
    
    // 初始化 Token Bucket（如果提供了 RPS 配置）
    const configuredRPS = rps ?? env.COINGLASS_RPS;
    const configuredBurst = burst ?? env.COINGLASS_BURST;
    this.tokenBucket = new TokenBucket(configuredBurst, configuredRPS);
  }

  /**
   * 执行限流函数（先获取 RPS token，再进入并发队列）
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // 先获取 RPS token（必要时 sleep）
    await this.tokenBucket.acquire();
    
    // 再进入并发控制队列
    return this.limit(fn);
  }

  /**
   * 更新限流信息（从响应头读取）
   */
  updateLimits(headers: Record<string, string | string[] | undefined>): void {
    const maxLimit = headers['api-key-max-limit'];
    const useLimit = headers['api-key-use-limit'];

    if (maxLimit) {
      this.maxLimit = parseInt(Array.isArray(maxLimit) ? maxLimit[0] : maxLimit, 10);
    }

    if (useLimit) {
      this.useLimit = parseInt(Array.isArray(useLimit) ? useLimit[0] : useLimit, 10);
    }

    // 记录限流信息
    if (this.maxLimit !== null && this.useLimit !== null) {
      const usagePercent = ((this.useLimit / this.maxLimit) * 100).toFixed(1);
      logger.debug({
        maxLimit: this.maxLimit,
        useLimit: this.useLimit,
        usagePercent: `${usagePercent}%`,
      }, 'CoinGlass API rate limit status');

      // 如果使用率超过 80%，发出警告
      if (this.useLimit / this.maxLimit > 0.8) {
        logger.warn({
          maxLimit: this.maxLimit,
          useLimit: this.useLimit,
          usagePercent: `${usagePercent}%`,
        }, 'CoinGlass API rate limit approaching');
      }
    }
  }

  /**
   * 获取当前限流状态
   */
  getStatus(): { maxLimit: number | null; useLimit: number | null } {
    return {
      maxLimit: this.maxLimit,
      useLimit: this.useLimit,
    };
  }
}

