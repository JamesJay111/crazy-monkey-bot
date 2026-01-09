import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

/**
 * 发布内容缓存结构
 */
export interface PublishCacheEntry {
  publishId: string;
  createdAt: number;
  ticker: string;
  interval: string;
  sourceText: string; // 中文原文
  translations: {
    en: string | null; // 英文翻译（缓存）
    ko: string | null; // 韩语翻译（缓存）
  };
  published: {
    A: boolean; // 账户A是否已发布
    B: boolean; // 账户B是否已发布
    C: boolean; // 账户C是否已发布
  };
  publishResults?: {
    A?: { tweetId: string; url: string; timestamp: number };
    B?: { tweetId: string; url: string; timestamp: number };
    C?: { tweetId: string; url: string; timestamp: number };
  };
}

/**
 * 发布内容缓存服务
 * 管理推文发布内容的缓存（内存 + 文件）
 */
export class TweetPublishCacheService {
  private readonly CACHE_FILE = path.resolve('./data/tweet_publish_cache.json');
  private cache: Map<string, PublishCacheEntry> = new Map();
  private readonly MAX_CACHE_SIZE = 100; // 最多缓存 100 条

  constructor() {
    this.loadCache();
  }

  /**
   * 从文件加载缓存
   */
  private loadCache(): void {
    try {
      const dir = path.dirname(this.CACHE_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (!fs.existsSync(this.CACHE_FILE)) {
        return;
      }

      const content = fs.readFileSync(this.CACHE_FILE, 'utf-8');
      const data = JSON.parse(content) as Record<string, PublishCacheEntry>;

      // 加载到内存
      for (const [publishId, entry] of Object.entries(data)) {
        this.cache.set(publishId, entry);
      }

      logger.info({ count: this.cache.size }, 'Publish cache loaded from file');
    } catch (error) {
      logger.warn({ error }, 'Failed to load publish cache, using empty cache');
    }
  }

  /**
   * 保存缓存到文件
   */
  private saveCache(): void {
    try {
      const dir = path.dirname(this.CACHE_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 转换为对象
      const data: Record<string, PublishCacheEntry> = {};
      for (const [publishId, entry] of this.cache.entries()) {
        data[publishId] = entry;
      }

      fs.writeFileSync(this.CACHE_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (error) {
      logger.error({ error }, 'Failed to save publish cache');
    }
  }

  /**
   * 生成 publishId
   * 格式：YYYY-MM-DDTHH:mm:ssZ_TICKER
   */
  generatePublishId(ticker: string): string {
    const now = new Date();
    const isoString = now.toISOString();
    return `${isoString}_${ticker.toUpperCase()}`;
  }

  /**
   * 创建新的发布缓存条目
   */
  createEntry(ticker: string, interval: string, sourceText: string): string {
    const publishId = this.generatePublishId(ticker);

    const entry: PublishCacheEntry = {
      publishId,
      createdAt: Date.now(),
      ticker: ticker.toUpperCase(),
      interval,
      sourceText,
      translations: {
        en: null,
        ko: null,
      },
      published: {
        A: false,
        B: false,
        C: false,
      },
      publishResults: {},
    };

    this.cache.set(publishId, entry);
    this.saveCache();

    logger.info({ publishId, ticker }, 'Created new publish cache entry');
    return publishId;
  }

  /**
   * 获取缓存条目
   */
  getEntry(publishId: string): PublishCacheEntry | null {
    return this.cache.get(publishId) || null;
  }

  /**
   * 更新翻译缓存
   */
  updateTranslation(publishId: string, lang: 'en' | 'ko', translatedText: string): void {
    const entry = this.cache.get(publishId);
    if (!entry) {
      logger.warn({ publishId }, 'Entry not found when updating translation');
      return;
    }

    entry.translations[lang] = translatedText;
    this.saveCache();

    logger.debug({ publishId, lang }, 'Translation cached');
  }

  /**
   * 标记账户已发布
   */
  markPublished(
    publishId: string,
    account: 'A' | 'B' | 'C',
    tweetId: string,
    url: string
  ): void {
    const entry = this.cache.get(publishId);
    if (!entry) {
      logger.warn({ publishId }, 'Entry not found when marking published');
      return;
    }

    entry.published[account] = true;
    if (!entry.publishResults) {
      entry.publishResults = {};
    }
    entry.publishResults[account] = {
      tweetId,
      url,
      timestamp: Date.now(),
    };

    this.saveCache();

    logger.info({ publishId, account, tweetId }, 'Account marked as published');
  }

  /**
   * 检查账户是否已发布
   */
  isPublished(publishId: string, account: 'A' | 'B' | 'C'): boolean {
    const entry = this.cache.get(publishId);
    if (!entry) {
      return false;
    }
    return entry.published[account];
  }

  /**
   * 获取翻译（如果已缓存）
   */
  getTranslation(publishId: string, lang: 'en' | 'ko'): string | null {
    const entry = this.cache.get(publishId);
    if (!entry) {
      return null;
    }
    return entry.translations[lang];
  }

  /**
   * 清理旧缓存（保留最近 N 条）
   */
  cleanup(maxEntries: number = 100): void {
    if (this.cache.size <= maxEntries) {
      return;
    }

    // 按创建时间排序，保留最新的
    const entries = Array.from(this.cache.entries())
      .sort((a, b) => b[1].createdAt - a[1].createdAt)
      .slice(0, maxEntries);

    this.cache.clear();
    for (const [publishId, entry] of entries) {
      this.cache.set(publishId, entry);
    }

    this.saveCache();
    logger.info({ removed: this.cache.size - entries.length }, 'Cleaned up old cache entries');
  }

  /**
   * 获取所有未完成的发布（用于重试）
   */
  getUnpublishedEntries(): PublishCacheEntry[] {
    return Array.from(this.cache.values()).filter(
      entry => !entry.published.A || !entry.published.B || !entry.published.C
    );
  }
}



