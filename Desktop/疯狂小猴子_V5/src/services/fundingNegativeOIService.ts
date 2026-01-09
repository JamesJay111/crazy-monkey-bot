import { CoinGlassClient } from '../clients/coinglass.client';
import { BinanceUniverseService } from './binanceUniverse.service';
import { logger } from '../utils/logger';
import { env } from '../config/env';

/**
 * Funding < 0 且 OI 最大的候选结果
 */
export interface FundingNegativeOIResult {
  symbol: string;
  fundingRate: number; // 负数
  oiUsd: number;
}

/**
 * Funding < 0 且 OI 最大选币服务
 * 从 Binance Futures 中筛选 Funding < 0 的币种，选择 OI 最大的
 */
export class FundingNegativeOIService {
  constructor(
    private coinglass: CoinGlassClient,
    private universeService: BinanceUniverseService
  ) {}

  /**
   * 获取 Binance Universe（复用现有逻辑）
   */
  private async getBinanceUniverse(): Promise<string[]> {
    return this.universeService.getBinanceUniverse();
  }

  /**
   * 过滤 Funding < 0 的币种（仅 Binance）
   * @param symbols 候选币种列表
   * @returns 符合条件的币种及其 Funding Rate
   */
  async filterNegativeFunding(symbols: string[]): Promise<Array<{ symbol: string; fundingRate: number }>> {
    logger.info({ count: symbols.length }, 'Filtering negative funding candidates');

    const candidates: Array<{ symbol: string; fundingRate: number }> = [];

    try {
      // 获取所有币种的 Funding Rate 列表
      const fundingRateList = await this.coinglass.getFundingRateExchangeList();
      
      if (!Array.isArray(fundingRateList)) {
        logger.warn('Funding rate list is not an array');
        return [];
      }

      // 遍历每个币种
      for (const symbol of symbols) {
        try {
          // 找到该币种的条目
          const item = fundingRateList.find(
            (entry: any) => entry?.symbol?.toUpperCase() === symbol.toUpperCase()
          );

          if (!item) {
            continue; // 该币种无数据，跳过
          }

          // 检查 stablecoin_margin_list 中是否有 Binance
          if (!Array.isArray(item.stablecoin_margin_list)) {
            continue; // 无 stablecoin_margin_list，跳过
          }

          const binanceEntry = item.stablecoin_margin_list.find(
            (exchange: any) => exchange?.exchange === 'Binance'
          );

          if (!binanceEntry) {
            continue; // Binance 无数据，跳过
          }

          // 获取 Binance 的 funding_rate
          const fundingRate = binanceEntry.funding_rate;

          if (fundingRate === null || fundingRate === undefined) {
            continue; // 无 funding rate 数据，跳过
          }

          // 归一化资金费率到 decimal 形式（1% = 0.01）
          const normalizedFundingRate = this.normalizeFundingRateToDecimal(fundingRate);
          
          // 只保留 Funding <= 阈值的（阈值是负数，例如 -0.0005 表示 -0.05%）
          if (normalizedFundingRate <= env.FUNDING_THRESHOLD_DECIMAL) {
            candidates.push({
              symbol: symbol.toUpperCase(),
              fundingRate: normalizedFundingRate,
            });
            logger.debug({ 
              symbol, 
              originalFundingRate: fundingRate,
              normalizedFundingRate,
              threshold: env.FUNDING_THRESHOLD_DECIMAL 
            }, 'Found funding rate threshold candidate');
          }
        } catch (error) {
          logger.warn({ error, symbol }, 'Failed to check funding rate for symbol');
          continue; // 单个币种失败，继续下一个
        }
      }

      logger.info({ count: candidates.length }, 'Negative funding candidates filtered');
      return candidates;
    } catch (error) {
      logger.error({ error }, 'Failed to filter negative funding candidates');
      return [];
    }
  }

  /**
   * 获取币种的 OI（USD）
   * @param symbol 币种符号
   * @returns OI（USD），失败返回 0
   */
  private async getOIUsd(symbol: string): Promise<number> {
    try {
      const oiList = await this.coinglass.getOpenInterestExchangeList({ symbol: symbol.toUpperCase() });
      
      if (!Array.isArray(oiList) || oiList.length === 0) {
        return 0;
      }

      // 查找 exchange="All" 的汇总行
      const allExchangeItem = oiList.find((item: any) => item.exchange === 'All');
      if (allExchangeItem && allExchangeItem.open_interest_usd) {
        return allExchangeItem.open_interest_usd;
      }

      // 如果没有 "All"，汇总所有交易所
      let totalOI = 0;
      for (const item of oiList) {
        if (item.open_interest_usd) {
          totalOI += item.open_interest_usd;
        }
      }

      return totalOI;
    } catch (error) {
      logger.warn({ error, symbol }, 'Failed to get OI for symbol');
      return 0;
    }
  }

  /**
   * 归一化资金费率到 decimal 形式（1% = 0.01）
   * 处理不同数据源可能的单位差异
   * @param fundingRate 原始资金费率
   * @returns 归一化后的 decimal 形式
   */
  private normalizeFundingRateToDecimal(fundingRate: number): number {
    // 如果绝对值 > 1，可能是百分数形式（例如 -0.05 表示 -0.05%），需要除以 100
    // 如果绝对值 <= 1，可能是 decimal 形式（例如 -0.0005 表示 -0.05%），直接返回
    if (Math.abs(fundingRate) > 1) {
      return fundingRate / 100;
    }
    return fundingRate;
  }

  /**
   * 选择 OI 最大的币种（从满足阈值的候选中）
   * @param candidates 满足阈值的候选列表
   * @returns OI 最大的币种，如果没有则返回 null
   */
  async pickMaxOI(
    candidates: Array<{ symbol: string; fundingRate: number }>
  ): Promise<FundingNegativeOIResult | null> {
    if (candidates.length === 0) {
      logger.warn('No negative funding candidates, cannot pick max OI');
      return null;
    }

    logger.info({ count: candidates.length }, 'Picking max OI from candidates');

    const results: FundingNegativeOIResult[] = [];

    // 批量获取 OI（分片 + 抖动，避免并发风暴）
    const batchSize = 20; // 每批 20 个
    const batches: Array<Array<{ symbol: string; fundingRate: number }>> = [];
    
    for (let i = 0; i < candidates.length; i += batchSize) {
      batches.push(candidates.slice(i, i + batchSize));
    }

    logger.debug({ totalCandidates: candidates.length, batchCount: batches.length }, 'Processing OI requests in batches');

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      
      // 并行获取当前批次的 OI
      const batchPromises = batch.map(async (candidate) => {
        const oiUsd = await this.getOIUsd(candidate.symbol);
        if (oiUsd > 0) {
          results.push({
            symbol: candidate.symbol,
            fundingRate: candidate.fundingRate,
            oiUsd,
          });
        }
      });

      await Promise.all(batchPromises);

      // 批次间添加抖动延迟（300~800ms），避免连续请求
      if (i < batches.length - 1) {
        const jitter = 300 + Math.random() * 500; // 300~800ms
        await new Promise(resolve => setTimeout(resolve, jitter));
      }
    }

    if (results.length === 0) {
      logger.warn('No valid OI found for any candidate');
      return null;
    }

    // 按 OI 降序排序，如果 OI 相同则按 symbol 字母序排序（稳定排序）
    results.sort((a, b) => {
      if (b.oiUsd !== a.oiUsd) {
        return b.oiUsd - a.oiUsd;
      }
      return a.symbol.localeCompare(b.symbol);
    });
    const selected = results[0];

    logger.info({
      symbol: selected.symbol,
      fundingRate: selected.fundingRate,
      oiUsd: selected.oiUsd,
    }, 'Selected max OI candidate');

    return selected;
  }

  /**
   * 主方法：从 Binance Universe 中筛选 Funding < 0 且 OI 最大的币种
   * @returns 选中的币种，如果没有则返回 null
   */
  async selectBestCandidate(): Promise<FundingNegativeOIResult | null> {
    try {
      // 1. 获取 Binance Universe
      const universe = await this.getBinanceUniverse();
      logger.info({ count: universe.length }, 'Binance universe loaded');

      if (universe.length === 0) {
        logger.warn('Binance universe is empty');
        return null;
      }

      // 2. 过滤 Funding < 0 的币种
      const negativeFundingCandidates = await this.filterNegativeFunding(universe);

      if (negativeFundingCandidates.length === 0) {
        logger.warn('No negative funding candidates found');
        return null;
      }

      // 3. 选择 OI 最大的
      const selected = await this.pickMaxOI(negativeFundingCandidates);

      return selected;
    } catch (error) {
      logger.error({ error }, 'Failed to select best candidate');
      return null;
    }
  }
}

