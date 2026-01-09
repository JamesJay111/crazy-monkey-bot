import { CoinGlassClient } from '../clients/coinglass.client';
import { BinanceUniverseService } from './binanceUniverse.service';
import { logger } from '../utils/logger';
import { env } from '../config/env';
import pLimit from 'p-limit';

/**
 * OI 增长选币结果
 */
export interface OIGrowthResult {
  symbol: string;
  instrumentId: string;
  exchangeName: string;
  oiDeltaUsd: number; // 4h OI 增量（USD）
  currentOIUsd: number; // 当前 OI（USD）
  prevOIUsd: number; // 4h 前 OI（USD）
}

/**
 * OI 增长选币服务
 * 选择过去 4 小时内 OI 增长最大的代币（必须在 Binance Futures 上线）
 */
export class OIGrowthService {
  private readonly TOP_N: number;

  constructor(
    private coinglass: CoinGlassClient,
    private universeService: BinanceUniverseService
  ) {
    // 从环境变量读取，默认 200
    this.TOP_N = env.OI_GROWTH_CANDIDATE_TOPN || 200;
  }

  /**
   * 从 instrument_id 提取 base symbol
   * 例如：BTCUSDT -> BTC, 1000PEPEUSDT -> PEPE, ETHUSDT -> ETH
   */
  private extractBaseSymbol(instrumentId: string): string {
    // 移除 USDT/USDC 等后缀
    let base = instrumentId.replace(/USDT$|USDC$|BUSD$/i, '');
    
    // 处理 1000PEPE 这类情况（移除数字前缀）
    base = base.replace(/^\d+/, '');
    
    return base.toUpperCase();
  }

  /**
   * 检查 symbol 是否在 Binance Futures 上线
   */
  private async isInBinanceFutures(symbol: string, instrumentId: string): Promise<boolean> {
    try {
      // 方法1: 使用 instrument_id 直接匹配（如果 universe 支持）
      const universe = await this.universeService.getBinanceUniverse();
      
      // 提取 base symbol
      const baseSymbol = this.extractBaseSymbol(instrumentId);
      
      // 检查是否在 universe 中
      return universe.includes(baseSymbol);
    } catch (error) {
      logger.warn({ error, symbol, instrumentId }, 'Failed to check Binance Futures');
      return false;
    }
  }

  /**
   * 计算 4h OI 增量
   * @param instrumentId 合约交易对（如 BTCUSDT）
   * @param exchangeName 交易所名称（如 Binance）
   * @param currentOIUsd 当前 OI（USD），从 pairs-markets 获取
   * @param oiChangePercent24h 24h OI 变化百分比，从 pairs-markets 获取
   * @returns OI 增量（USD），如果失败返回 null
   */
  private async calculate4hOIDelta(
    instrumentId: string,
    exchangeName: string,
    currentOIUsd?: number,
    oiChangePercent24h?: number
  ): Promise<{ delta: number; current: number; prev: number } | null> {
    try {
      // 优先尝试使用 open-interest/history API
      const history = await this.coinglass.getOpenInterestHistory({
        symbol: instrumentId,
        exchange: exchangeName,
        interval: '4h',
        limit: 2,
        unit: 'usd',
      });

      // 如果 history API 有数据，使用它
      if (Array.isArray(history) && history.length >= 2) {
        const latest = history[0];
        const prev = history[1];

        if (latest && prev) {
          const latestClose = parseFloat(latest.close);
          const prevClose = parseFloat(prev.close);

          if (!isNaN(latestClose) && !isNaN(prevClose)) {
            const delta = latestClose - prevClose;
            return {
              delta,
              current: latestClose,
              prev: prevClose,
            };
          }
        }
      }

      // Fallback: 使用 pairs-markets 数据估算 4h OI 增量
      // 如果提供了 currentOIUsd 和 oiChangePercent24h，可以估算
      if (currentOIUsd !== undefined && currentOIUsd > 0) {
        // 使用 24h 变化百分比估算 4h 增量（简化：假设线性变化）
        // 4h 增量 ≈ (24h 变化百分比 / 6) * 当前 OI
        // 但更准确的方法是：如果 24h 变化了 X%，那么 4h 大约变化 X% / 6
        if (oiChangePercent24h !== undefined && !isNaN(oiChangePercent24h)) {
          // 估算 4h 前的 OI：current / (1 + changePercent24h / 100)
          const estimatedPrevOI = currentOIUsd / (1 + oiChangePercent24h / 100);
          // 估算 4h 增量：假设 24h 变化均匀分布，4h 增量 ≈ (current - prev) / 6
          const estimated4hDelta = (currentOIUsd - estimatedPrevOI) / 6;
          
          logger.debug({
            instrumentId,
            currentOIUsd,
            oiChangePercent24h,
            estimatedPrevOI,
            estimated4hDelta,
          }, 'Using pairs-markets data to estimate 4h OI delta');

          return {
            delta: estimated4hDelta,
            current: currentOIUsd,
            prev: estimatedPrevOI,
          };
        }
      }

      logger.debug({ instrumentId, exchangeName, historyLength: history?.length }, 'Insufficient data for OI delta calculation');
      return null;
    } catch (error) {
      logger.warn({ error, instrumentId, exchangeName }, 'Failed to calculate 4h OI delta');
      return null;
    }
  }

  /**
   * 主方法：选择 4h OI 增长最大的代币（必须在 Binance Futures）
   * @returns 选中的代币，如果没有则返回 null
   */
  async selectBestCandidate(): Promise<OIGrowthResult | null> {
    try {
      logger.info({ topN: this.TOP_N }, 'Starting OI growth candidate selection');

      // 1. 获取所有 futures 交易对市场列表
      // 注意：pairs-markets API 需要 symbol 参数，我们需要先获取支持的币种列表
      let pairsMarkets: any[] = [];
      
      // 获取 Binance Universe（已支持的币种列表）
      const binanceUniverse = await this.universeService.getBinanceUniverse();
      logger.info({ universeSize: binanceUniverse.length }, 'Got Binance universe');
      
      // 使用 p-limit 控制并发，避免 API 限流
      const limit = pLimit(env.COINGLASS_CONCURRENCY || 3);
      
      // 并发查询多个币种的 pairs-markets 数据（限制最多查询前 50 个币种以节省时间）
      const allPairs: any[] = [];
      const queryPromises = binanceUniverse.slice(0, 50).map(symbol =>
        limit(async () => {
          try {
            const coinPairs = await this.coinglass.getFuturesPairsMarkets({ symbol });
            if (Array.isArray(coinPairs) && coinPairs.length > 0) {
              // 只保留 Binance 交易所的数据
              const binancePairs = coinPairs.filter((p: any) => 
                p.exchange_name === 'Binance' && 
                p.open_interest_usd && 
                parseFloat(String(p.open_interest_usd)) > 0
              );
              allPairs.push(...binancePairs);
            }
          } catch (error) {
            logger.debug({ error, symbol }, 'Failed to fetch pairs-markets for symbol');
          }
        })
      );
      
      await Promise.all(queryPromises);
      pairsMarkets = allPairs;
      
      if (!Array.isArray(pairsMarkets) || pairsMarkets.length === 0) {
        logger.warn('No pairs-markets data available after querying universe');
        return null;
      }

      logger.info({ totalPairs: pairsMarkets.length }, 'Fetched pairs-markets from multiple symbols');

      // 2. 按 open_interest_usd 降序排序，取 Top N
      const sortedByOI = pairsMarkets
        .filter((pair: any) => {
          // 过滤掉无效数据
          const oi = pair.open_interest_usd;
          return oi !== null && oi !== undefined && !isNaN(parseFloat(String(oi))) && parseFloat(String(oi)) > 0;
        })
        .sort((a: any, b: any) => {
          const oiA = parseFloat(String(a.open_interest_usd || 0));
          const oiB = parseFloat(String(b.open_interest_usd || 0));
          return oiB - oiA; // 降序
        })
        .slice(0, this.TOP_N);

      logger.info({
        topN: sortedByOI.length,
        sampleRange: sortedByOI.length > 0 ? {
          maxOI: sortedByOI[0]?.open_interest_usd,
          minOI: sortedByOI[sortedByOI.length - 1]?.open_interest_usd,
        } : null,
      }, 'Top N candidates selected by OI');

      // 3. 计算每个候选的 4h OI 增量
      const candidatesWithDelta: Array<{
        instrumentId: string;
        exchangeName: string;
        symbol: string;
        oiDeltaUsd: number;
        currentOIUsd: number;
        prevOIUsd: number;
      }> = [];

      for (const pair of sortedByOI) {
        const instrumentId = pair.instrument_id;
        const exchangeName = pair.exchange_name;

        if (!instrumentId || !exchangeName) {
          continue;
        }

        // 从 pairs-markets 数据中获取当前 OI 和 24h 变化百分比
        const currentOIUsd = pair.open_interest_usd ? parseFloat(String(pair.open_interest_usd)) : undefined;
        const oiChangePercent24h = pair.open_interest_change_percent_24h ? parseFloat(String(pair.open_interest_change_percent_24h)) : undefined;

        // 计算 4h OI 增量（优先使用 history API，fallback 到 pairs-markets 数据）
        const deltaResult = await this.calculate4hOIDelta(
          instrumentId,
          exchangeName,
          currentOIUsd,
          oiChangePercent24h
        );
        
        if (!deltaResult) {
          continue; // 数据不足，跳过
        }

        candidatesWithDelta.push({
          instrumentId,
          exchangeName,
          symbol: pair.symbol || this.extractBaseSymbol(instrumentId),
          oiDeltaUsd: deltaResult.delta,
          currentOIUsd: deltaResult.current,
          prevOIUsd: deltaResult.prev,
        });
      }

      if (candidatesWithDelta.length === 0) {
        logger.warn('No valid OI delta calculated');
        return null;
      }

      // 4. 按 oiDeltaUsd 降序排序
      candidatesWithDelta.sort((a, b) => b.oiDeltaUsd - a.oiDeltaUsd);

      // 5. 记录前 10 名（用于日志）
      const top10 = candidatesWithDelta.slice(0, 10).map(c => ({
        instrumentId: c.instrumentId,
        exchangeName: c.exchangeName,
        oiDeltaUsd: c.oiDeltaUsd,
      }));

      logger.info({ top10 }, 'Top 10 OI growth candidates');

      // 6. 依次检查是否在 Binance Futures，选第一个符合的
      const skippedReasons: Array<{ instrumentId: string; reason: string }> = [];

      for (const candidate of candidatesWithDelta) {
        const baseSymbol = this.extractBaseSymbol(candidate.instrumentId);
        const isBinance = await this.isInBinanceFutures(baseSymbol, candidate.instrumentId);

        if (!isBinance) {
          skippedReasons.push({
            instrumentId: candidate.instrumentId,
            reason: 'not in Binance Futures',
          });
          continue; // 不在 Binance Futures，跳过
        }

        // 找到第一个在 Binance Futures 的
        logger.info({
          symbol: baseSymbol,
          instrumentId: candidate.instrumentId,
          exchangeName: candidate.exchangeName,
          oiDeltaUsd: candidate.oiDeltaUsd,
          currentOIUsd: candidate.currentOIUsd,
          prevOIUsd: candidate.prevOIUsd,
          skippedCount: skippedReasons.length,
          skippedReasons: skippedReasons.slice(0, 5), // 只记录前5个被跳过的
        }, 'Selected OI growth candidate');

        return {
          symbol: baseSymbol,
          instrumentId: candidate.instrumentId,
          exchangeName: candidate.exchangeName,
          oiDeltaUsd: candidate.oiDeltaUsd,
          currentOIUsd: candidate.currentOIUsd,
          prevOIUsd: candidate.prevOIUsd,
        };
      }

      // 所有候选都不在 Binance Futures
      logger.warn({
        totalCandidates: candidatesWithDelta.length,
        skippedReasons: skippedReasons.slice(0, 10),
      }, 'No candidate found in Binance Futures');

      return null;
    } catch (error) {
      logger.error({ error }, 'Failed to select OI growth candidate');
      return null;
    }
  }
}

