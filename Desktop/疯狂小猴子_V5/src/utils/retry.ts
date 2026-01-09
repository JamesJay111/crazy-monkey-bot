import { logger } from './logger';
import { HttpError } from './http';
import { env } from '../config/env';

/**
 * 重试配置
 */
export interface RetryConfig {
  maxAttempts: number;
  backoffMs: number;
  exponential?: boolean; // 是否使用指数退避
  maxBackoffMs?: number; // 最大退避时间
}

/**
 * 旧版重试配置（用于兼容 http.ts）
 */
export interface LegacyRetryConfig {
  maxRetries: number;
  retryable?: (error: any) => boolean;
}

/**
 * 重试工具
 * 支持指数退避策略、Retry-After 头、jitter
 */
export class RetryUtil {
  /**
   * 执行带重试的操作
   * @param fn 要执行的操作（返回 Promise）
   * @param config 重试配置
   * @returns 操作结果
   */
  static async retry<T>(
    fn: () => Promise<T>,
    config: RetryConfig
  ): Promise<T> {
    let lastError: any;
    const { maxAttempts, backoffMs, exponential = true, maxBackoffMs } = config;
    const maxBackoff = maxBackoffMs ?? env.COINGLASS_MAX_BACKOFF_MS;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        if (attempt === maxAttempts) {
          logger.warn({ attempt, maxAttempts, error }, 'Retry exhausted');
          throw error;
        }

        // 计算退避时间
        let delay: number;
        
        // 如果是 429 错误，优先使用 Retry-After 头
        if (error instanceof HttpError && error.statusCode === 429) {
          const retryAfter = this.extractRetryAfter(error);
          if (retryAfter !== null) {
            delay = retryAfter * 1000; // 转换为毫秒
            logger.debug({ attempt, retryAfterSeconds: retryAfter }, 'Using Retry-After header');
          } else {
            // 否则使用指数退避
            delay = exponential
              ? Math.min(backoffMs * Math.pow(2, attempt - 1), maxBackoff)
              : backoffMs;
          }
        } else {
          // 其他错误使用指数退避
          delay = exponential
            ? Math.min(backoffMs * Math.pow(2, attempt - 1), maxBackoff)
            : backoffMs;
        }

        // 添加 jitter（0~300ms 随机）
        const jitter = Math.random() * 300;
        delay = Math.floor(delay + jitter);

        logger.debug({ 
          attempt, 
          maxAttempts, 
          wait_ms: delay,
          reason: error instanceof HttpError ? `HTTP ${error.statusCode}` : 'network error'
        }, 'Retrying after delay');
        
        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  /**
   * 从 HttpError 中提取 Retry-After 头（如果存在）
   * @param error HttpError 实例
   * @returns Retry-After 秒数，如果不存在则返回 null
   */
  static extractRetryAfter(error: HttpError): number | null {
    // HttpError 的 rawResponse 可能包含 headers 信息
    if (error.rawResponse && typeof error.rawResponse === 'object') {
      const headers = (error.rawResponse as any).headers || {};
      
      // 尝试多种可能的 header 名称
      const retryAfter = headers['retry-after'] || 
                        headers['Retry-After'] || 
                        headers['retry_after'] ||
                        headers['RETRY_AFTER'];
      
      if (retryAfter) {
        // 可能是字符串（秒数）或数组（取第一个）
        const value = Array.isArray(retryAfter) ? retryAfter[0] : retryAfter;
        const seconds = parseInt(String(value), 10);
        if (!isNaN(seconds) && seconds > 0) {
          return seconds;
        }
      }
    }
    return null;
  }

  /**
   * 延迟函数
   */
  private static sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * 旧版重试函数（用于兼容 http.ts，但使用新的重试策略）
 * @param fn 要执行的操作
 * @param config 重试配置
 * @returns 操作结果
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: LegacyRetryConfig
): Promise<T> {
  let lastError: any;
  const { maxRetries, retryable } = config;
  const maxAttempts = maxRetries + 1; // maxRetries 是重试次数，总尝试次数是 maxRetries + 1
  const maxBackoff = env.COINGLASS_MAX_BACKOFF_MS;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      // 检查是否可重试
      if (retryable && !retryable(error)) {
        throw error;
      }

      if (attempt === maxAttempts) {
        logger.warn({ attempt, maxAttempts, error }, 'Retry exhausted');
        throw error;
      }

      // 计算退避时间（使用新的策略）
      let delay: number;
      
      // 如果是 429 错误，优先使用 Retry-After 头
      if (error instanceof HttpError && error.statusCode === 429) {
        const retryAfter = RetryUtil.extractRetryAfter(error);
        if (retryAfter !== null) {
          delay = retryAfter * 1000; // 转换为毫秒
          logger.debug({ attempt, retryAfterSeconds: retryAfter }, 'Using Retry-After header');
        } else {
          // 否则使用指数退避：1s, 2s, 4s, 8s...
          delay = Math.min(1000 * Math.pow(2, attempt - 1), maxBackoff);
        }
      } else if (error instanceof HttpError && error.statusCode >= 500) {
        // 5xx 错误：指数退避
        delay = Math.min(1000 * Math.pow(2, attempt - 1), maxBackoff);
      } else if (error instanceof HttpError && error.statusCode === 0) {
        // 网络错误：指数退避
        delay = Math.min(1000 * Math.pow(2, attempt - 1), maxBackoff);
      } else {
        // 其他错误：固定 1 秒（保持兼容）
        delay = 1000;
      }

      // 添加 jitter（0~300ms 随机）
      const jitter = Math.random() * 300;
      delay = Math.floor(delay + jitter);

      logger.debug({ 
        attempt, 
        maxAttempts, 
        wait_ms: delay,
        reason: error instanceof HttpError ? `HTTP ${error.statusCode}` : 'network error'
      }, 'Retrying after delay');
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}
