import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 庄家轧空缓存项
 */
export interface SqueezeCacheItem {
  ticker: string;
  symbolPair: string;
  score: number;
  signal: {
    reversal?: 'none' | 'short_to_long' | 'long_to_short';
    reversal_strength?: 'weak' | 'medium' | 'strong';
    position_bias?: 'long_stronger' | 'short_stronger' | 'neutral';
  };
}

/**
 * 庄家轧空缓存结构
 */
export interface SqueezeCache {
  generated_at: number; // 毫秒时间戳
  exchange: string;
  interval: string;
  list: SqueezeCacheItem[];
}

/**
 * 庄家轧空缓存服务
 * 支持内存缓存 + 本地 JSON 文件持久化
 */
export class SqueezeCacheService {
  private memoryCache: SqueezeCache | null = null;
  private readonly cacheFilePath: string;
  private readonly CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4小时

  constructor(cacheDir: string = './cache') {
    // 确保缓存目录存在
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    this.cacheFilePath = path.join(cacheDir, 'squeeze_cache.json');
    
    // 启动时尝试从文件加载缓存
    this.loadFromFile();
  }

  /**
   * 设置缓存
   */
  setCache(cache: SqueezeCache): void {
    this.memoryCache = cache;
    this.saveToFile(cache);
    logger.info({ 
      generatedAt: new Date(cache.generated_at).toISOString(),
      itemCount: cache.list.length 
    }, 'Squeeze cache updated');
  }

  /**
   * 获取缓存
   */
  getCache(): SqueezeCache | null {
    // 优先使用内存缓存
    if (this.memoryCache) {
      // 检查是否过期
      const age = Date.now() - this.memoryCache.generated_at;
      if (age < this.CACHE_TTL_MS) {
        return this.memoryCache;
      }
      // 过期了，清空内存缓存
      this.memoryCache = null;
    }

    // 尝试从文件加载
    const fileCache = this.loadFromFile();
    if (fileCache) {
      const age = Date.now() - fileCache.generated_at;
      if (age < this.CACHE_TTL_MS) {
        this.memoryCache = fileCache;
        return fileCache;
      }
    }

    return null;
  }

  /**
   * 检查缓存是否有效
   */
  isCacheValid(): boolean {
    const cache = this.getCache();
    return cache !== null && cache.list.length > 0;
  }

  /**
   * 获取缓存年龄（毫秒）
   */
  getCacheAge(): number | null {
    const cache = this.getCache();
    if (!cache) return null;
    return Date.now() - cache.generated_at;
  }

  /**
   * 清空缓存
   */
  clearCache(): void {
    this.memoryCache = null;
    if (fs.existsSync(this.cacheFilePath)) {
      fs.unlinkSync(this.cacheFilePath);
    }
    logger.info('Squeeze cache cleared');
  }

  /**
   * 从文件加载缓存
   */
  private loadFromFile(): SqueezeCache | null {
    try {
      if (!fs.existsSync(this.cacheFilePath)) {
        return null;
      }

      const content = fs.readFileSync(this.cacheFilePath, 'utf-8');
      const cache = JSON.parse(content) as SqueezeCache;
      
      // 验证缓存结构
      if (!cache.generated_at || !cache.list || !Array.isArray(cache.list)) {
        logger.warn('Invalid cache file format, clearing');
        this.clearCache();
        return null;
      }

      return cache;
    } catch (error) {
      logger.warn({ error }, 'Failed to load cache from file');
      return null;
    }
  }

  /**
   * 保存缓存到文件
   */
  private saveToFile(cache: SqueezeCache): void {
    try {
      fs.writeFileSync(this.cacheFilePath, JSON.stringify(cache, null, 2), 'utf-8');
    } catch (error) {
      logger.warn({ error }, 'Failed to save cache to file');
    }
  }
}

