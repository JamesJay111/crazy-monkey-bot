import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';
import { BinanceUniverseService } from './binanceUniverse.service';
import { FundingNegativeOIService, FundingNegativeOIResult } from './fundingNegativeOIService';
import { OIGrowthService, OIGrowthResult } from './oiGrowthService';
import { ContractSnapshotService } from './contractSnapshot.service';
import { TweetContentService, HistoricalData } from './tweetContent.service';
import { XTweetService } from './xTweet.service';
import { XTweetOAuth1Service } from './xTweetOAuth1.service';
import { hasValidOAuth1Token } from './xOAuth1.service';
import { SnapshotValidator } from '../utils/snapshotValidator';
import { RetryUtil } from '../utils/retry';
import { PreflightLogger } from '../utils/preflightLogger';
import { env } from '../config/env';
import { CoinGlassClient } from '../clients/coinglass.client';
import { CoinGlassGuard } from '../utils/coinglassGuard';
import { parseNumberStrict, isFiniteNumber } from '../utils/number';
import { RawDebugLogger } from '../utils/rawDebugLogger';
import { TweetPublishCacheService } from './tweetPublishCache.service';
import { TweetTranslationService } from './tweetTranslation.service';
import { smartTruncate } from '../utils/textTruncate';
import * as os from 'os';

/**
 * 发推状态存储
 */
interface TweetState {
  lastTweetAt: number; // 上次发推时间戳
  lastTweetTicker: string | null; // 上次发推的 ticker
  lastTweetKey: string | null; // 上次发推的唯一标识 ${ticker}:${interval}:${timestampBucket}
  daily: {
    date: string; // YYYY-MM-DD
    count: number; // 当日已发送推文数量
  };
}

/**
 * X 自动发推 Job 服务
 * 轮询执行，当 FundingRate <= -0.05% 时触发推送，每日最多 3 条
 */
export class XAutoTweetJobService {
  private readonly POLL_INTERVAL_MS = env.POLL_INTERVAL_MS; // 可配置轮询间隔（默认 5 分钟）
  private readonly STATE_FILE = path.resolve('./data/x_tweet_state.json');
  private readonly LOG_DIR = path.join(os.homedir(), 'Desktop'); // Mac 桌面
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;

  private oauth1TweetService: XTweetOAuth1Service;
  private publishCache: TweetPublishCacheService;
  private translationService: TweetTranslationService;

  constructor(
    private universeService: BinanceUniverseService,
    private fundingNegativeOIService: FundingNegativeOIService,
    private oiGrowthService: OIGrowthService,
    private snapshotService: ContractSnapshotService,
    private contentService: TweetContentService,
    private tweetService: XTweetService,
    private coinglass?: CoinGlassClient
  ) {
    this.oauth1TweetService = new XTweetOAuth1Service();
    this.publishCache = new TweetPublishCacheService();
    this.translationService = new TweetTranslationService();
  }

  /**
   * 启动 Job（启动后立即执行一次，然后每 8 小时执行）
   */
  start(): void {
    if (this.intervalId) {
      logger.warn('Auto tweet job is already running');
      return;
    }

    logger.info({ 
      pollIntervalMs: this.POLL_INTERVAL_MS,
      pollIntervalMinutes: this.POLL_INTERVAL_MS / 60000,
      fundingThreshold: env.FUNDING_THRESHOLD_DECIMAL,
      dailyLimit: env.DAILY_TWEET_LIMIT,
    }, 'Starting X auto tweet job (polling mode)');

    // 立即执行一次
    this.runTweetJobOnce().catch(error => {
      logger.error({ error }, 'Failed to run initial tweet job');
    });

    // 每 POLL_INTERVAL_MS 轮询一次
    this.intervalId = setInterval(() => {
      this.runTweetJobOnce().catch(error => {
        logger.error({ error }, 'Failed to run scheduled tweet job');
      });
    }, this.POLL_INTERVAL_MS);

    logger.info('X auto tweet job started');
  }

  /**
   * 停止 Job
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('X auto tweet job stopped');
    }
  }

  /**
   * 执行一次发推任务
   * @param force 是否强制发推（跳过幂等性检查）
   */
  async runTweetJobOnce(force: boolean = false): Promise<void> {
    if (this.isRunning) {
      logger.warn('Tweet job is already running, skipping');
      return;
    }

    this.isRunning = true;

    try {
      logger.info({ force }, 'Running tweet job...');

      // 1. 选择 4h OI 增长最大的币种（必须在 Binance Futures）
      const selected = await this.oiGrowthService.selectBestCandidate();
      
      if (!selected) {
        logger.warn('No OI growth candidates found, skipping tweet');
        return;
      }

      logger.info({
        symbol: selected.symbol,
        instrumentId: selected.instrumentId,
        exchangeName: selected.exchangeName,
        oiDeltaUsd: selected.oiDeltaUsd,
        currentOIUsd: selected.currentOIUsd,
        prevOIUsd: selected.prevOIUsd,
      }, 'Selected candidate: Max 4h OI Growth');

      // 2. 检查每日限额（除非强制发推或预发布模式）
      if (!force && !env.PREFLIGHT_MODE) {
        const dailyQuota = this.checkDailyQuota();
        if (!dailyQuota.canSend) {
          logger.warn({
            date: dailyQuota.date,
            count: dailyQuota.count,
            limit: env.DAILY_TWEET_LIMIT,
          }, 'Daily tweet quota reached, skipping tweet');
          
          // 记录到预发布日志
          if (env.PREFLIGHT_MODE) {
            PreflightLogger.log(selected.symbol, '4H', null, 'daily quota reached', {
              oiSource: '4h',
              takerSource: '4h',
              topSource: '4h',
              fundingSource: '4h',
            });
          }
          
          return;
        }
      }

      // 3. 检查幂等性（防止重复发推），除非强制发推
      if (!force) {
      const shouldSkip = this.shouldSkipTweet(selected.symbol);
      if (shouldSkip) {
        logger.info({ symbol: selected.symbol }, 'Tweet skipped (duplicate in same bucket)');
        return;
        }
      } else {
        logger.info({ symbol: selected.symbol }, 'Force tweet enabled, skipping idempotency check');
      }

      // 4. 获取合约快照数据（带重试机制）
      let snapshotResult = await this.getSnapshotWithRetry(selected.symbol);
      let snapshot = snapshotResult.snapshot;
      let dataSource = snapshotResult.dataSource;
      
      // 4.1 如果快照数据不完整，尝试使用 pairs-markets 数据补充
      const validation = SnapshotValidator.validate(snapshot);
      if (!validation.isValid && this.coinglass) {
        logger.warn({
          symbol: selected.symbol,
          missingFields: validation.missingFields,
          invalidFields: validation.invalidFields,
        }, 'Snapshot validation failed, trying to supplement with pairs-markets data');
        
        try {
          // 尝试从 pairs-markets 获取数据
          const pairsData = await this.coinglass.getFuturesPairsMarkets({ symbol: selected.symbol });
          
          if (!Array.isArray(pairsData) || pairsData.length === 0) {
            logger.debug({ symbol: selected.symbol }, 'No pairs-markets data available');
        } else {
            // 优先查找特定 instrumentId 的交易对
            let binancePair = pairsData.find((p: any) => 
              p.exchange_name === 'Binance' && p.instrument_id === selected.instrumentId
            );
            
            // 如果找不到特定交易对，但需要 OI 数据，汇总所有 Binance 交易对的 OI
            if (!binancePair && (!snapshot.oiUsd || snapshot.oiUsd <= 0)) {
              const binancePairs = pairsData.filter((p: any) => 
                (p.exchange_name || '').toLowerCase() === 'binance'
              );
              
              if (binancePairs.length > 0) {
                let totalOiUsd = 0;
                for (const pair of binancePairs) {
                  const oi = parseFloat(String(pair.open_interest_usd || '0'));
                  if (oi > 0) {
                    totalOiUsd += oi;
                  }
                }
                
                if (totalOiUsd > 0) {
                  // 创建一个虚拟的 binancePair 对象用于后续逻辑
                  binancePair = {
                    ...binancePairs[0],
                    open_interest_usd: totalOiUsd,
                  };
                  logger.debug({
                    symbol: selected.symbol,
                    totalOiUsd,
                    binancePairsCount: binancePairs.length,
                  }, 'Aggregated OI from all Binance pairs');
                }
              }
            }
            
            // 如果没有找到任何 Binance 交易对，尝试使用第一个交易对作为 fallback
            if (!binancePair) {
              binancePair = pairsData.find((p: any) => 
                (p.exchange_name || '').toLowerCase() === 'binance'
              ) || pairsData[0];
            }
          
            if (binancePair) {
              // 使用 pairs-markets 数据补充快照
              if (!snapshot.oiUsd || snapshot.oiUsd <= 0) {
                snapshot.oiUsd = parseFloat(String(binancePair.open_interest_usd || 0));
              }
              // 如果 fundingRate 是 0 且没有错误，清除错误标记（0 是有效值）
              const fundingRate = parseFloat(String(binancePair.funding_rate || 0));
              if (snapshot.fundingRateError) {
                // 如果 pairs-markets 有 funding_rate 数据，使用它并清除错误
                snapshot.fundingRate = fundingRate;
                snapshot.fundingRateError = null;
              } else if (!isFiniteNumber(snapshot.fundingRate)) {
                snapshot.fundingRate = fundingRate;
              }
              if (!snapshot.takerBuyVolUsd || snapshot.takerBuyVolUsd <= 0) {
                snapshot.takerBuyVolUsd = parseFloat(String(binancePair.long_volume_usd || 0));
              }
              if (!snapshot.takerSellVolUsd || snapshot.takerSellVolUsd <= 0) {
                snapshot.takerSellVolUsd = parseFloat(String(binancePair.short_volume_usd || 0));
              }
              // 如果 Top Account 数据缺失，使用默认值（50% / 50%）
              if (!snapshot.topAccountLongPercent || snapshot.topAccountLongPercent <= 0) {
                snapshot.topAccountLongPercent = 50;
              }
              if (!snapshot.topAccountShortPercent || snapshot.topAccountShortPercent <= 0) {
                snapshot.topAccountShortPercent = 50;
              }
              if (!snapshot.topAccountLongShortRatio || snapshot.topAccountLongShortRatio <= 0) {
                snapshot.topAccountLongShortRatio = 1.0;
              }
              
              logger.info({
                symbol: selected.symbol,
                oiUsd: snapshot.oiUsd,
                fundingRate: snapshot.fundingRate,
                takerBuy: snapshot.takerBuyVolUsd,
                takerSell: snapshot.takerSellVolUsd,
              }, 'Supplemented snapshot with pairs-markets data');
            }
          }
        } catch (error) {
          logger.warn({ error, symbol: selected.symbol }, 'Failed to supplement snapshot with pairs-markets data');
        }
      }
      
      // 5. 数据完整性校验（重新验证）
      const finalValidation = SnapshotValidator.validate(snapshot);
      if (!finalValidation.isValid) {
        logger.warn({
          symbol: selected.symbol,
          missingFields: finalValidation.missingFields,
          invalidFields: finalValidation.invalidFields,
        }, 'Snapshot validation failed after supplementation, skipping tweet');

        // 记录到预发布日志（如果启用）
        if (env.PREFLIGHT_MODE) {
          const skipReason = `数据不完整: 缺失字段=[${finalValidation.missingFields.join(', ')}], 无效字段=[${finalValidation.invalidFields.join(', ')}]`;
          PreflightLogger.log(selected.symbol, '4H', null, skipReason, dataSource);
        }

        return; // 不发送推文
      }

      // 6. 获取历史数据（用于深度分析，使用 4h interval）
      let historicalData: HistoricalData | undefined;
      if (this.coinglass) {
        try {
          historicalData = await this.fetchHistoricalData(selected.symbol, snapshot.pairSymbol);
        } catch (error) {
          logger.warn({ error, symbol: selected.symbol }, 'Failed to fetch historical data, will use base data only');
        }
      }

      // 7. 生成推文内容（包含深度分析）
      const tweetContent = await this.contentService.generateTweet(snapshot, historicalData);
      logger.debug({ contentLength: tweetContent.length }, 'Tweet content generated');

      // 8. 创建发布缓存条目（使用 publishId 作为唯一标识）
      const publishId = this.publishCache.createEntry(selected.symbol, '4h', tweetContent);
      logger.info({ publishId, symbol: selected.symbol }, 'Created publish cache entry');

      // 9. 预发布模式：只写日志，不发送
      if (env.PREFLIGHT_MODE) {
        PreflightLogger.log(selected.symbol, '4H', tweetContent, undefined, dataSource);
        logger.info({ symbol: selected.symbol, publishId }, 'Preflight mode: tweet logged, not sent');
        return;
      }

      // 10. 发布到三个账户（A/B/C）
      await this.publishToAllAccounts(publishId, selected.symbol, tweetContent);

      // 11. 更新每日限额计数（仅在真实发送成功后，至少一个账户成功）
      const cacheEntry = this.publishCache.getEntry(publishId);
      if (cacheEntry && (cacheEntry.published.A || cacheEntry.published.B || cacheEntry.published.C)) {
        this.incrementDailyQuota();
      }
      
      // 12. 保存状态（幂等性）
        this.saveTweetState(selected.symbol);

      // 13. 记录成功日志到文件
      // 获取发布结果
      const publishResults = cacheEntry?.publishResults || {};

        this.writeTweetLog({
          success: true,
          symbol: selected.symbol,
          publishId,
          content: tweetContent,
          oiDeltaUsd: selected.oiDeltaUsd,
          currentOIUsd: selected.currentOIUsd,
          prevOIUsd: selected.prevOIUsd,
          publishResults,
        });

      logger.info({ publishId }, 'Tweet job completed');
    } catch (error) {
      logger.error({ error }, 'Tweet job failed');
      
      // 记录失败日志到文件（Job 级别错误）
      this.writeTweetLog({
        success: false,
        symbol: null,
        error: error instanceof Error ? error.message : String(error),
        content: null,
        oiDeltaUsd: null,
        currentOIUsd: null,
        prevOIUsd: null,
      });
      
      // 不抛出错误，避免影响下个周期
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 获取合约快照（带重试机制）
   * @returns { snapshot, dataSource } - 快照和数据来源信息
   */
  private async getSnapshotWithRetry(symbol: string): Promise<{ snapshot: any; dataSource: { oiSource: string; takerSource: string; topSource: string; fundingSource: string } }> {
    return RetryUtil.retry(
      async () => {
        const snapshot = await this.snapshotService.getContractSnapshot(symbol);
        
        // 记录数据来源（统一使用 4h）
        const dataSource = {
          oiSource: '4h',
          takerSource: '4h',
          topSource: '4h',
          fundingSource: snapshot.fundingRateError ? 'error' : '4h',
        };
        
        logger.info({ 
          symbol: snapshot.symbol,
          oiUsd: snapshot.oiUsd,
          fundingRate: snapshot.fundingRate,
          fundingRateError: snapshot.fundingRateError,
          takerBuyVolUsd: snapshot.takerBuyVolUsd,
          takerSellVolUsd: snapshot.takerSellVolUsd,
          topAccountLongPercent: snapshot.topAccountLongPercent,
          topAccountShortPercent: snapshot.topAccountShortPercent,
          topAccountLongShortRatio: snapshot.topAccountLongShortRatio,
          dataSource,
        }, 'Contract snapshot retrieved with retry');
        
        return { snapshot, dataSource };
      },
      {
        maxAttempts: env.DATA_RETRY_MAX,
        backoffMs: env.DATA_RETRY_BACKOFF_MS,
        exponential: true,
      }
    );
  }

  /**
   * 获取历史数据（用于深度分析，接入 guard）
   */
  private async fetchHistoricalData(symbol: string, pairSymbol: string): Promise<HistoricalData> {
    if (!this.coinglass) {
      throw new Error('CoinGlass client not available');
    }

    const [fundingRateHistory, positionRatioHistory, takerHistory] = await Promise.all([
      // 获取 6 根资金费率历史（8h 间隔）
      this.coinglass.getFundingRateOhlcHistory({
        symbol: symbol.toUpperCase(),
        interval: '8h',
        limit: 6,
      })
        .then(resp => {
          try {
            CoinGlassGuard.assertBusinessOk(resp, { endpoint: 'getFundingRateOhlcHistory', symbol, interval: '4h' });
            RawDebugLogger.log('getFundingRateOhlcHistory', { symbol, interval: '4h' }, resp, { ok: true });
            return resp;
          } catch (error) {
            RawDebugLogger.log('getFundingRateOhlcHistory', { symbol, interval: '4h' }, resp, { ok: false, reason: (error as Error).message });
            throw error;
          }
        })
        .catch(() => []),
      
      // 获取 2 根持仓多空比历史（用于对比，4h 间隔）
      this.coinglass.getTopLongShortPositionRatioHistory({
        exchange: 'Binance',
        symbol: pairSymbol,
        interval: '4h',
        limit: 2,
      })
        .then(resp => {
          try {
            CoinGlassGuard.assertBusinessOk(resp, { endpoint: 'getTopLongShortPositionRatioHistory', pairSymbol, interval: '4h' });
            RawDebugLogger.log('getTopLongShortPositionRatioHistory', { pairSymbol, interval: '4h' }, resp, { ok: true });
            return resp;
          } catch (error) {
            RawDebugLogger.log('getTopLongShortPositionRatioHistory', { pairSymbol, interval: '4h' }, resp, { ok: false, reason: (error as Error).message });
            throw error;
          }
        })
        .catch(() => []),
      
      // 获取当前 Taker 数据（4h 间隔）
      this.coinglass.getTakerBuySellVolumeHistory({
        exchange: 'Binance',
        symbol: pairSymbol,
        interval: '4h',
        limit: 1,
      })
        .then(resp => {
          try {
            CoinGlassGuard.assertBusinessOk(resp, { endpoint: 'getTakerBuySellVolumeHistory', pairSymbol, interval: '4h' });
            RawDebugLogger.log('getTakerBuySellVolumeHistory', { pairSymbol, interval: '4h' }, resp, { ok: true });
            return resp;
          } catch (error) {
            RawDebugLogger.log('getTakerBuySellVolumeHistory', { pairSymbol, interval: '4h' }, resp, { ok: false, reason: (error as Error).message });
            throw error;
          }
        })
        .catch(() => []),
    ]);

    return {
      fundingRateHistory: fundingRateHistory || [],
      positionRatioHistory: positionRatioHistory || [],
      takerHistory: takerHistory || [],
    };
  }

  /**
   * 尝试更新 8h 数据（如果支持）
   * 复用 ContractSnapshotService 的完整逻辑获取数据，然后尝试用 8h 数据更新 Taker 和 Top
   * 注意：如果 8h 不支持，会保持使用 4h 数据（从 getContractSnapshot 获取的）
   * @returns { takerUpdated, topUpdated } - 是否成功更新了 8h 数据
   */
  private async tryUpdate8hData(snapshot: any, symbol: string): Promise<{ takerUpdated: boolean; topUpdated: boolean }> {
    let takerUpdated = false;
    let topUpdated = false;
    try {
      // 构建交易对符号（默认 USDT，复用 ContractSnapshotService 的逻辑）
      const pairSymbol = this.normalizePairSymbol(symbol);
      
      // 获取 CoinGlass Client（通过 ContractSnapshotService 的依赖注入）
      const coinglass = (this.snapshotService as any).coinglass;
      
      const [taker8h, top8h] = await Promise.all([
        // Taker 8h（如果接口不支持 8h，会降级到 4h）
        coinglass.getTakerBuySellVolumeHistory({
          exchange: 'Binance',
          symbol: pairSymbol,
          interval: '8h', // 尝试 8h，不支持则降级到 4h（在 API 客户端中处理）
          limit: 1,
        })
          .then((resp: any) => {
            try {
              CoinGlassGuard.assertBusinessOk(resp, { endpoint: 'getTakerBuySellVolumeHistory', pairSymbol, interval: '8h' });
              RawDebugLogger.log('getTakerBuySellVolumeHistory (8h)', { pairSymbol, interval: '8h' }, resp, { ok: true });
              return resp;
            } catch (error) {
              RawDebugLogger.log('getTakerBuySellVolumeHistory (8h)', { pairSymbol, interval: '8h' }, resp, { ok: false, reason: (error as Error).message });
              throw error;
            }
          })
          .catch((err: any) => {
            logger.warn({ error: err, symbol, pairSymbol }, 'Failed to get 8h Taker data');
            return null;
          }),
        
        // Top 8h（如果接口不支持 8h，会降级到 4h）
        coinglass.getTopLongShortPositionRatioHistory({
          exchange: 'Binance',
          symbol: pairSymbol,
          interval: '8h', // 尝试 8h，不支持则降级到 4h（在 API 客户端中处理）
          limit: 1,
        })
          .then((resp: any) => {
            try {
              CoinGlassGuard.assertBusinessOk(resp, { endpoint: 'getTopLongShortPositionRatioHistory', pairSymbol, interval: '8h' });
              RawDebugLogger.log('getTopLongShortPositionRatioHistory (8h)', { pairSymbol, interval: '8h' }, resp, { ok: true });
              return resp;
            } catch (error) {
              RawDebugLogger.log('getTopLongShortPositionRatioHistory (8h)', { pairSymbol, interval: '8h' }, resp, { ok: false, reason: (error as Error).message });
              throw error;
            }
          })
          .catch((err: any) => {
            logger.warn({ error: err, symbol, pairSymbol }, 'Failed to get 8h Top data');
            return null;
          }),
      ]);

      // 如果 8h 数据可用，使用 strict parse 更新快照（禁止用 0 覆盖已有的 4h 值）
      if (taker8h && Array.isArray(taker8h) && taker8h.length > 0) {
        const latest = taker8h[0];
        logger.debug({ symbol, pairSymbol, taker8hData: latest }, 'Received 8h Taker data');
        
        const takerBuy = parseNumberStrict(latest.taker_buy_volume_usd);
        const takerSell = parseNumberStrict(latest.taker_sell_volume_usd);
        
        // 只有当 strict parse 成功且 > 0 时才更新（不覆盖为 0）
        if (takerBuy !== undefined && takerBuy > 0) {
          snapshot.takerBuyVolUsd = takerBuy;
          takerUpdated = true;
        }
        if (takerSell !== undefined && takerSell > 0) {
          snapshot.takerSellVolUsd = takerSell;
          takerUpdated = true;
        }
        
        if (takerUpdated) {
          logger.info({ symbol, takerBuy, takerSell }, 'Updated Taker data with 8h');
        } else {
          logger.warn({ symbol, latest }, '8h Taker data is empty or invalid, keeping 4h data');
        }
      } else {
        logger.warn({ symbol, pairSymbol, taker8hLength: taker8h?.length }, 'No 8h Taker data available, keeping 4h data');
      }

      if (top8h && Array.isArray(top8h) && top8h.length > 0) {
        const latest = top8h[0];
        logger.debug({ symbol, pairSymbol, top8hData: latest }, 'Received 8h Top data');
        
        // 尝试多种字段名（兼容不同的 API 响应格式），使用 strict parse
        const topLong = parseNumberStrict(
          latest.top_position_long_percent || 
          latest.top_account_long_percent || 
          latest.long_percent
        );
        const topShort = parseNumberStrict(
          latest.top_position_short_percent || 
          latest.top_account_short_percent || 
          latest.short_percent
        );
        const topRatio = parseNumberStrict(
          latest.top_position_long_short_ratio || 
          latest.top_account_long_short_ratio || 
          latest.long_short_ratio
        );
        
        // 只有当 strict parse 成功且有效时才更新（不覆盖为 0）
        if (topLong !== undefined && topLong > 0) {
          snapshot.topAccountLongPercent = topLong;
          topUpdated = true;
        }
        if (topShort !== undefined && topShort > 0) {
          snapshot.topAccountShortPercent = topShort;
          topUpdated = true;
        }
        if (topRatio !== undefined && topRatio > 0) {
          snapshot.topAccountLongShortRatio = topRatio;
          topUpdated = true;
        }
        
        if (topUpdated) {
          logger.info({ symbol, topLong, topShort, topRatio }, 'Updated Top data with 8h');
        } else {
          logger.warn({ symbol, latest }, '8h Top data is empty or invalid, keeping 4h data');
        }
      } else {
        logger.warn({ symbol, pairSymbol, top8hLength: top8h?.length }, 'No 8h Top data available, keeping 4h data');
      }
      
      return { takerUpdated, topUpdated };
    } catch (error) {
      logger.error({ error, symbol }, 'Failed to update 8h data, using 4h data from contract snapshot');
      return { takerUpdated: false, topUpdated: false };
    }
  }

  /**
   * 规范化交易对符号（复用 ContractSnapshotService 的逻辑）
   */
  private normalizePairSymbol(baseSymbol: string): string {
    const normalized = baseSymbol.toUpperCase();
    
    if (normalized.includes('USDT') || normalized.includes('USDC') || normalized.includes('BUSD')) {
      return normalized;
    }
    
    return `${normalized}USDT`;
  }

  /**
   * 写入推文日志到 Mac 桌面
   */
  private writeTweetLog(data: {
    success: boolean;
    symbol: string | null;
    publishId?: string;
    tweetId?: string;
    url?: string;
    error?: string;
    content: string | null;
    oiDeltaUsd?: number | null;
    currentOIUsd?: number | null;
    prevOIUsd?: number | null;
    publishResults?: {
      A?: { tweetId: string; url: string; timestamp: number };
      B?: { tweetId: string; url: string; timestamp: number };
      C?: { tweetId: string; url: string; timestamp: number };
    };
  }): void {
    try {
      const timestamp = new Date().toISOString();
      const dateStr = new Date().toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).replace(/\//g, '-');
      const timeStr = new Date().toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });

      let logContent = '';
      
      if (data.success) {
        logContent = `✅ Twitter 推文发送成功

时间: ${dateStr} ${timeStr} (${timestamp})
状态: 成功
币种: ${data.symbol}
推文 ID: ${data.tweetId}
推文 URL: ${data.url}
OI Delta (4h): ${data.oiDeltaUsd !== null && data.oiDeltaUsd !== undefined ? (data.oiDeltaUsd >= 0 ? '+' : '') + data.oiDeltaUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' USD' : '—'}
Current OI: ${data.currentOIUsd ? data.currentOIUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' USD' : '—'}
Prev OI (4h): ${data.prevOIUsd ? data.prevOIUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' USD' : '—'}

推文内容:
${data.content || '—'}

---
`;
      } else {
        logContent = `❌ Twitter 推文发送失败

时间: ${dateStr} ${timeStr} (${timestamp})
状态: 失败
币种: ${data.symbol || '—'}
错误信息: ${data.error || '未知错误'}
${data.oiDeltaUsd !== null && data.oiDeltaUsd !== undefined ? `OI Delta (4h): ${(data.oiDeltaUsd >= 0 ? '+' : '') + data.oiDeltaUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD` : ''}
${data.currentOIUsd ? `Current OI: ${data.currentOIUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD` : ''}
${data.prevOIUsd ? `Prev OI (4h): ${data.prevOIUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD` : ''}

${data.content ? `推文内容（未发送）:\n${data.content}\n` : ''}

---
`;
      }

      // 文件名：X_Tweet_Log_YYYY-MM-DD.txt
      const fileName = `X_Tweet_Log_${dateStr}.txt`;
      const filePath = path.join(this.LOG_DIR, fileName);

      // 追加写入（如果文件已存在）
      if (fs.existsSync(filePath)) {
        fs.appendFileSync(filePath, logContent, 'utf-8');
      } else {
        // 创建新文件，添加文件头
        const header = `X (Twitter) 自动发推日志
生成日期: ${dateStr}
日志位置: ${filePath}

========================================

`;
        fs.writeFileSync(filePath, header + logContent, 'utf-8');
      }

      logger.debug({ filePath, success: data.success }, 'Tweet log written to file');
    } catch (error) {
      logger.error({ error }, 'Failed to write tweet log to file');
    }
  }

  /**
   * 检查是否应该跳过发推（48 小时去重检查）
   * 规则：48 小时内不能重复发相同 ticker
   */
  private shouldSkipTweet(ticker: string): boolean {
    const state = this.loadTweetState();
    
    if (!state.lastTweetAt || !state.lastTweetTicker) {
      // 从未发过推，不跳过
      return false;
    }

    // 48 小时去重逻辑
    const now = Date.now();
    const bucketSize = 48 * 60 * 60 * 1000; // 48 小时
    const currentBucket = Math.floor(now / bucketSize);
    const lastBucket = Math.floor(state.lastTweetAt / bucketSize);

    // 如果在同一个 48 小时 bucket 内，且 ticker 相同，则跳过
    if (currentBucket === lastBucket && state.lastTweetTicker === ticker) {
      return true;
    }

    return false;
  }

  /**
   * 保存发推状态
   */
  private saveTweetState(ticker: string): void {
    try {
      const now = Date.now();
      // 48 小时去重逻辑（保持原有逻辑）
      const bucketSize = 48 * 60 * 60 * 1000; // 48 小时
      const bucket = Math.floor(now / bucketSize);
      const tweetKey = `${ticker}:48h:${bucket}`;

      const currentState = this.loadTweetState();
      const state: TweetState = {
        lastTweetAt: now,
        lastTweetTicker: ticker,
        lastTweetKey: tweetKey,
        daily: currentState.daily, // 保持 daily 字段
      };

      const dir = path.dirname(this.STATE_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(this.STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
      logger.debug({ state }, 'Tweet state saved');
    } catch (error) {
      logger.error({ error }, 'Failed to save tweet state');
    }
  }

  /**
   * 获取当前日期（Asia/Bangkok 时区）
   */
  private getTodayDate(): string {
    // 使用 Asia/Bangkok 时区（UTC+7）
    const now = new Date();
    const bangkokTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
    const year = bangkokTime.getFullYear();
    const month = String(bangkokTime.getMonth() + 1).padStart(2, '0');
    const day = String(bangkokTime.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  /**
   * 检查每日限额
   */
  private checkDailyQuota(): { canSend: boolean; date: string; count: number } {
    const state = this.loadTweetState();
    const today = this.getTodayDate();

    // 如果日期不匹配，重置计数
    if (!state.daily || state.daily.date !== today) {
      return {
        canSend: true,
        date: today,
        count: 0,
      };
    }

    // 检查是否达到限额
    const canSend = state.daily.count < env.DAILY_TWEET_LIMIT;
    return {
      canSend,
      date: state.daily.date,
      count: state.daily.count,
    };
  }

  /**
   * 增加每日限额计数（仅在真实发送成功后调用）
   */
  private incrementDailyQuota(): void {
    const state = this.loadTweetState();
    const today = this.getTodayDate();

    // 如果日期不匹配，重置计数
    if (!state.daily || state.daily.date !== today) {
      state.daily = {
        date: today,
        count: 1,
      };
    } else {
      state.daily.count += 1;
    }

    // 保存状态
    this.saveTweetState(state.lastTweetTicker || '');
  }

  /**
   * 发布到所有账户（A/B/C）
   * @param publishId 发布ID
   * @param symbol 交易对符号
   * @param sourceText 中文原文
   */
  private async publishToAllAccounts(
    publishId: string,
    symbol: string,
    sourceText: string
  ): Promise<void> {
    // 检查缓存条目
    const cacheEntry = this.publishCache.getEntry(publishId);
    if (!cacheEntry) {
      logger.error({ publishId }, 'Cache entry not found');
      return;
    }

    // 使用 Promise.allSettled 确保失败隔离
    const results = await Promise.allSettled([
      this.publishToAccountA(publishId, sourceText),
      this.publishToAccountB(publishId, sourceText),
      this.publishToAccountC(publishId, sourceText),
    ]);

    // 记录结果
    const resultA = results[0];
    const resultB = results[1];
    const resultC = results[2];

    if (resultA.status === 'fulfilled') {
      logger.info({ publishId, account: 'A' }, 'Account A published successfully');
    } else {
      logger.error({ publishId, account: 'A', error: resultA.reason }, 'Failed to publish to account A');
    }

    if (resultB.status === 'fulfilled') {
      logger.info({ publishId, account: 'B' }, 'Account B published successfully');
    } else {
      logger.error({ publishId, account: 'B', error: resultB.reason }, 'Failed to publish to account B');
    }

    if (resultC.status === 'fulfilled') {
      logger.info({ publishId, account: 'C' }, 'Account C published successfully');
    } else {
      logger.error({ publishId, account: 'C', error: resultC.reason }, 'Failed to publish to account C');
    }
  }

  /**
   * 发布到账户 A（中文，直接发布）
   */
  private async publishToAccountA(
    publishId: string,
    sourceText: string
  ): Promise<{ tweetId: string; url: string }> {
    // 检查是否已发布
    if (this.publishCache.isPublished(publishId, 'A')) {
      const entry = this.publishCache.getEntry(publishId);
      const result = entry?.publishResults?.A;
      if (result) {
        logger.debug({ publishId }, 'Account A already published, skipping');
        return { tweetId: result.tweetId, url: result.url };
      }
    }

    // 发布（优先使用 OAuth 1.0a）
    let result: { tweetId: string; url: string };
    if (hasValidOAuth1Token()) {
      logger.info({ publishId }, 'Publishing to account A (OAuth 1.0a)');
      result = await this.oauth1TweetService.sendTweet(sourceText);
    } else {
      logger.info({ publishId }, 'Publishing to account A (OAuth 2.0)');
      result = await this.tweetService.sendTweet(sourceText);
    }

    // 标记已发布
    this.publishCache.markPublished(publishId, 'A', result.tweetId, result.url);

    return result;
  }

  /**
   * 发布到账户 B（英文，翻译后发布）
   */
  private async publishToAccountB(
    publishId: string,
    sourceText: string
  ): Promise<{ tweetId: string; url: string }> {
    // 检查是否已发布
    if (this.publishCache.isPublished(publishId, 'B')) {
      const entry = this.publishCache.getEntry(publishId);
      const result = entry?.publishResults?.B;
      if (result) {
        logger.debug({ publishId }, 'Account B already published, skipping');
        return { tweetId: result.tweetId, url: result.url };
      }
    }

    // 检查是否有缓存的翻译
    let translatedText = this.publishCache.getTranslation(publishId, 'en');
    
    if (!translatedText) {
      // 翻译为英文
      logger.info({ publishId }, 'Translating to English for account B');
      translatedText = await this.translationService.translateWithDeepSeek(sourceText, 'en');
      
      // 缓存翻译结果
      this.publishCache.updateTranslation(publishId, 'en', translatedText);
    } else {
      logger.debug({ publishId }, 'Using cached English translation for account B');
    }

    // 智能截断（Twitter 限制 280 字符）
    const finalText = smartTruncate(translatedText, 280);

    // 发布（使用账户 B 的 Token）
    logger.info({ publishId }, 'Publishing to account B');
    const result = await this.oauth1TweetService.sendTweet(finalText, 'accountB');

    // 标记已发布
    this.publishCache.markPublished(publishId, 'B', result.tweetId, result.url);

    return result;
  }

  /**
   * 发布到账户 C（韩语，翻译后发布）
   */
  private async publishToAccountC(
    publishId: string,
    sourceText: string
  ): Promise<{ tweetId: string; url: string }> {
    // 检查是否已发布
    if (this.publishCache.isPublished(publishId, 'C')) {
      const entry = this.publishCache.getEntry(publishId);
      const result = entry?.publishResults?.C;
      if (result) {
        logger.debug({ publishId }, 'Account C already published, skipping');
        return { tweetId: result.tweetId, url: result.url };
      }
    }

    // 检查是否有缓存的翻译
    let translatedText = this.publishCache.getTranslation(publishId, 'ko');
    
    if (!translatedText) {
      // 翻译为韩语
      logger.info({ publishId }, 'Translating to Korean for account C');
      translatedText = await this.translationService.translateWithDeepSeek(sourceText, 'ko');
      
      // 缓存翻译结果
      this.publishCache.updateTranslation(publishId, 'ko', translatedText);
    } else {
      logger.debug({ publishId }, 'Using cached Korean translation for account C');
    }

    // 智能截断（Twitter 限制 280 字符）
    const finalText = smartTruncate(translatedText, 280);

    // 发布（使用账户 C 的 Token）
    logger.info({ publishId }, 'Publishing to account C');
    const result = await this.oauth1TweetService.sendTweet(finalText, 'accountC');

    // 标记已发布
    this.publishCache.markPublished(publishId, 'C', result.tweetId, result.url);

    return result;
  }

  /**
   * 加载发推状态
   */
  private loadTweetState(): TweetState {
    try {
      if (!fs.existsSync(this.STATE_FILE)) {
        return {
          lastTweetAt: 0,
          lastTweetTicker: null,
          lastTweetKey: null,
          daily: {
            date: this.getTodayDate(),
            count: 0,
          },
        };
      }

      const content = fs.readFileSync(this.STATE_FILE, 'utf-8');
      const state = JSON.parse(content) as TweetState;
      
      // 兼容旧版本（没有 daily 字段）
      if (!state.daily) {
        state.daily = {
          date: this.getTodayDate(),
          count: 0,
        };
      }
      
      return state;
    } catch (error) {
      logger.error({ error }, 'Failed to load tweet state');
      return {
        lastTweetAt: 0,
        lastTweetTicker: null,
        lastTweetKey: null,
        daily: {
          date: this.getTodayDate(),
          count: 0,
        },
      };
    }
  }
}

