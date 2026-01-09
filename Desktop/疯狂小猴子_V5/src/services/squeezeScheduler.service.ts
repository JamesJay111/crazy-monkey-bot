import { CoinGlassClient } from '../clients/coinglass.client';
import { SqueezeScanService } from './squeezeScan.service';
import { SqueezeCacheService, SqueezeCache, SqueezeCacheItem } from './squeezeCache.service';
import { SqueezePushService } from './squeezePush.service';
import { logger } from '../utils/logger';

/**
 * 推送Hook回调函数类型
 */
export type SqueezeListUpdatedHook = (
  oldList: SqueezeCacheItem[],
  newList: SqueezeCacheItem[]
) => void | Promise<void>;

/**
 * 庄家轧空定时扫描服务
 * 负责后台定时扫描并更新缓存
 */
export class SqueezeSchedulerService {
  private intervalHandle: NodeJS.Timeout | null = null;
  private isRunning = false;
  private hooks: SqueezeListUpdatedHook[] = [];
  private lastScanTime: number | null = null;

  constructor(
    private scanService: SqueezeScanService,
    private cacheService: SqueezeCacheService,
    private coinglass: CoinGlassClient,
    private pushService?: SqueezePushService
  ) {}

  /**
   * 启动定时任务（每4小时执行一次）
   * 推荐时间点：00:00 / 04:00 / 08:00 / 12:00 / 16:00 / 20:00
   */
  start(intervalMs: number = 4 * 60 * 60 * 1000): void {
    if (this.intervalHandle) {
      logger.warn('Squeeze scheduler is already running');
      return;
    }

    logger.info({ intervalHours: intervalMs / (60 * 60 * 1000) }, 'Starting squeeze scheduler');

    // 立即执行一次扫描
    this.executeScan().catch(error => {
      logger.error({ error }, 'Failed to execute initial scan');
    });

    // 设置定时任务
    this.intervalHandle = setInterval(() => {
      this.executeScan().catch(error => {
        logger.error({ error }, 'Failed to execute scheduled scan');
      });
    }, intervalMs);

    // 计算下次执行时间
    const nextRun = new Date(Date.now() + intervalMs);
    logger.info({ nextRun: nextRun.toISOString() }, 'Squeeze scheduler started');
  }

  /**
   * 停止定时任务
   */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      logger.info('Squeeze scheduler stopped');
    }
  }

  /**
   * 手动触发扫描（用于测试）
   */
  async triggerScan(): Promise<SqueezeCache | null> {
    return this.executeScan();
  }

  /**
   * 注册推送Hook（预留接口）
   */
  onSqueezeListUpdated(hook: SqueezeListUpdatedHook): void {
    this.hooks.push(hook);
    logger.info({ hookCount: this.hooks.length }, 'Squeeze list updated hook registered');
  }

  /**
   * 获取上次扫描时间
   */
  getLastScanTime(): number | null {
    return this.lastScanTime;
  }

  /**
   * 执行扫描任务
   */
  private async executeScan(): Promise<SqueezeCache | null> {
    if (this.isRunning) {
      logger.warn('Squeeze scan is already running, skipping');
      return null;
    }

    this.isRunning = true;
    const scanStartTime = Date.now();

    try {
      logger.info('Starting scheduled squeeze scan');

      // 执行扫描（复用现有逻辑）
      const results = await this.scanService.scanBinance4hStructure(10);

      // 转换为缓存格式
      const cacheItems: SqueezeCacheItem[] = results.map(item => {
        // 根据score推断signal（简化版，可以根据实际需求增强）
        let reversal: 'none' | 'short_to_long' | 'long_to_short' = 'none';
        let reversalStrength: 'weak' | 'medium' | 'strong' | undefined;
        let positionBias: 'long_stronger' | 'short_stronger' | 'neutral' = 'neutral';

        // 根据score推断反转强度
        if (item.score >= 9) {
          reversalStrength = 'strong';
          reversal = 'short_to_long'; // 简化假设，实际应该从扫描结果中获取
        } else if (item.score >= 6) {
          reversalStrength = 'medium';
          reversal = 'short_to_long';
        } else if (item.score >= 3) {
          reversalStrength = 'weak';
        }

        // 根据score判断开仓倾向
        if (item.score >= 4) {
          positionBias = 'long_stronger';
        }

        return {
          ticker: item.symbol,
          symbolPair: `${item.symbol}USDT`,
          score: item.score,
          signal: {
            reversal,
            reversal_strength: reversalStrength,
            position_bias: positionBias,
          },
        };
      });

      // 构建缓存对象
      const cache: SqueezeCache = {
        generated_at: scanStartTime,
        exchange: 'Binance',
        interval: '4h',
        list: cacheItems,
      };

      // 获取旧列表（用于hook）
      const oldCache = this.cacheService.getCache();
      const oldList = oldCache?.list || [];

      // 更新缓存
      this.cacheService.setCache(cache);

      // 触发hook（包括推送服务）
      if (this.pushService) {
        try {
          await this.pushService.detectAndPush(oldList, cacheItems);
        } catch (error) {
          logger.warn({ error }, 'Push service failed');
        }
      }

      // 触发其他注册的hook
      if (this.hooks.length > 0) {
        for (const hook of this.hooks) {
          try {
            await hook(oldList, cacheItems);
          } catch (error) {
            logger.warn({ error }, 'Squeeze list updated hook failed');
          }
        }
      }

      this.lastScanTime = scanStartTime;
      const duration = Date.now() - scanStartTime;

      logger.info({
        itemCount: cacheItems.length,
        duration,
        topTickers: cacheItems.slice(0, 5).map(item => item.ticker),
      }, 'Scheduled squeeze scan completed');

      return cache;
    } catch (error) {
      logger.error({ error }, 'Scheduled squeeze scan failed');
      return null;
    } finally {
      this.isRunning = false;
    }
  }
}

