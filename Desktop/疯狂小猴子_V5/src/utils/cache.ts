/**
 * 简单的 LRU 内存缓存实现（支持 stale-while-revalidate）
 */

interface CacheEntry<T> {
  data: T;
  expires: number; // Fresh TTL 过期时间
  staleExpires: number; // Stale TTL 过期时间
}

export interface CacheGetResult<T> {
  data: T;
  isStale: boolean; // 是否为 stale 数据
}

export class LRUCache<T = any> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private maxSize: number;
  private defaultStaleTTL: number; // 默认 stale TTL（毫秒）

  constructor(maxSize: number = 100, defaultStaleTTL: number = 30 * 60 * 1000) {
    this.maxSize = maxSize;
    this.defaultStaleTTL = defaultStaleTTL;
  }

  /**
   * 获取缓存（支持 stale）
   * @param key 缓存键
   * @param allowStale 是否允许返回 stale 数据（默认 true）
   * @returns 缓存数据，如果不存在或已过期则返回 null
   */
  get(key: string, allowStale: boolean = true): T | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }

    const now = Date.now();

    // Fresh 未过期：直接返回
    if (entry.expires >= now) {
      // LRU: 将访问的项移到末尾
      this.cache.delete(key);
      this.cache.set(key, entry);
      return entry.data;
    }

    // Fresh 过期但 stale 未过期：允许返回 stale
    if (allowStale && entry.staleExpires >= now) {
      return entry.data;
    }

    // Stale 也过期：删除并返回 null
    this.cache.delete(key);
    return null;
  }

  /**
   * 获取缓存（返回是否 stale 的信息）
   * @param key 缓存键
   * @param allowStale 是否允许返回 stale 数据（默认 true）
   * @returns 缓存结果，包含数据和是否 stale 的标记
   */
  getWithStaleInfo(key: string, allowStale: boolean = true): CacheGetResult<T> | null {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return null;
    }

    const now = Date.now();

    // Fresh 未过期：直接返回
    if (entry.expires >= now) {
      // LRU: 将访问的项移到末尾
      this.cache.delete(key);
      this.cache.set(key, entry);
      return { data: entry.data, isStale: false };
    }

    // Fresh 过期但 stale 未过期：允许返回 stale
    if (allowStale && entry.staleExpires >= now) {
      return { data: entry.data, isStale: true };
    }

    // Stale 也过期：删除并返回 null
    this.cache.delete(key);
    return null;
  }

  /**
   * 设置缓存
   * @param key 缓存键
   * @param data 缓存数据
   * @param ttl 新鲜度 TTL（毫秒）
   * @param staleTTL 可选，stale TTL（毫秒），默认使用 defaultStaleTTL 或 3x fresh TTL
   */
  set(key: string, data: T, ttl: number, staleTTL?: number): void {
    // 如果超过最大大小，删除最旧的项
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    const now = Date.now();
    const expires = now + ttl;
    // Stale TTL：使用传入值，或默认值，或 3x fresh TTL（取较大者）
    const staleTTLValue = staleTTL ?? Math.max(this.defaultStaleTTL, ttl * 3);
    const staleExpires = now + staleTTLValue;

    this.cache.set(key, { data, expires, staleExpires });
  }

  /**
   * 删除缓存
   */
  delete(key: string): void {
    this.cache.delete(key);
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 获取缓存大小
   */
  size(): number {
    return this.cache.size;
  }
}

