import { CoinGlassClient } from '../clients/coinglass.client';
import { SignalEngine } from './signalEngine.service';
import { logger } from '../utils/logger';
import { LRUCache } from '../utils/cache';
import { env } from '../config/env';
import pLimit from 'p-limit';
import {
  SqueezeScanResult,
  SqueezeFeatures,
  ScoreBreakdown,
  SqueezeType,
} from '../types';

/**
 * 轧空扫描服务（新标准）
 * 负责扫描 Universe、计算特征、打分、筛选、排序
 */
export class SqueezeScanService {
  private cache: LRUCache;
  private signalEngine: SignalEngine;
  private limit: ReturnType<typeof pLimit>;

  // 默认 Universe 大小（可配置）
  private readonly DEFAULT_UNIVERSE_SIZE = 80;

  // 蓝筹币列表（仅 5 个）
  private readonly BLUECHIP_COINS = ['BTC', 'ETH', 'BNB', 'XRP', 'SOL'];
  
  // 优先币种列表（硬编码，可快速上线）
  private readonly PRIORITY_COINS = [
    'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX', 'MATIC', 'DOT',
    'LINK', 'UNI', 'ATOM', 'LTC', 'BCH', 'ETC', 'XLM', 'ALGO', 'FIL', 'ICP',
    'APT', 'ARB', 'OP', 'SUI', 'SEI', 'TIA', 'INJ', 'NEAR', 'FTM', 'AAVE',
    'MKR', 'SNX', 'COMP', 'CRV', 'SUSHI', '1INCH', 'YFI', 'SAND', 'MANA',
    'ENJ', 'GALA', 'AXS', 'CHZ', 'FLOW', 'THETA', 'BAT', 'ZRX', 'EOS', 'TRX',
    'XMR', 'DASH', 'ZEC', 'QTUM', 'ONT', 'VET', 'IOTA', 'NEO', 'WAVES', 'OMG',
  ];
  
  // 山寨币 Universe 大小（可配置）
  private readonly ALT_UNIVERSE_SIZE = 80;

  // 缓存 TTL
  private readonly CACHE_TTL = {
    SCAN_RESULT: 15 * 60 * 1000, // 15 分钟
    FEATURES: 30 * 60 * 1000, // 30 分钟
  };

  constructor(
    private coinglass: CoinGlassClient
  ) {
    this.cache = new LRUCache(500);
    this.signalEngine = new SignalEngine(coinglass);
    this.limit = pLimit(env.COINGLASS_CONCURRENCY || 3);
  }

  /**
   * 扫描 Universe 并返回 Top N（新标准）
   * @param topN 返回数量（默认15）
   * @param days 扫描天数（默认30）
   * @param universeType 币池类型：'bluechip' | 'alt' | 'all'
   */
  async scanTopN(topN: number = 15, days: number = 30, universeType: 'bluechip' | 'alt' | 'all' = 'all'): Promise<SqueezeScanResult[]> {
    const cacheKey = `squeeze_scan:${days}d:${topN}:${universeType}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      logger.debug({ cacheKey }, 'Squeeze scan cache hit');
      return cached as SqueezeScanResult[];
    }

    try {
      // 1. 获取 Universe（根据类型过滤）
      const universe = await this.getUniverse(universeType);

      logger.info({ universeSize: universe.length }, 'Starting squeeze scan');

      // 2. 并发计算特征和得分
      const candidates: SqueezeScanResult[] = [];
      const fetchPromises = universe.map(symbol => 
        this.limit(async () => {
          try {
            const pairSymbol = `${symbol}USDT`;
            
            // 检查缓存
            const featureCacheKey = `features:${symbol}:${days}d`;
            let cachedFeatures = this.cache.get(featureCacheKey);
            let features: SqueezeFeatures;
            let missing: Record<string, boolean>;

            if (cachedFeatures) {
              features = cachedFeatures.features;
              missing = cachedFeatures.missing;
            } else {
              const result = await this.signalEngine.calculateFeatures(symbol, pairSymbol, days);
              features = result.features;
              missing = result.missing;
              this.cache.set(featureCacheKey, { features, missing }, this.CACHE_TTL.FEATURES);
            }

            // 计算得分
            const { breakdown, squeezeType } = this.signalEngine.calculateScore(features);

            // 调试日志：记录每个 ticker 的得分情况
            if (breakdown.total > 0) {
              logger.debug({
                symbol,
                score: breakdown.total,
                breakdown: {
                  oi: breakdown.oi_rhythm,
                  ls: breakdown.ls_ratio_reversal,
                  taker: breakdown.taker_buy_bias,
                  basis: breakdown.basis_expansion,
                },
                passesFilter: this.passesFilter(breakdown),
              }, 'Ticker score calculated');
            }

            // 3. 筛选条件（硬过滤）
            // 临时放宽：如果总分 > 0 也显示（用于调试）
            if (this.passesFilter(breakdown) || breakdown.total > 0) {
              candidates.push({
                symbol,
                score: breakdown.total,
                squeezeType,
                features,
                scoreBreakdown: breakdown,
              });
            }
          } catch (error) {
            logger.warn({ error, symbol }, 'Failed to calculate features for symbol');
          }
        })
      );

      await Promise.all(fetchPromises);

      // 4. 排序并返回 Top N
      const sorted = candidates
        .sort((a, b) => b.score - a.score)
        .slice(0, topN);

      logger.info({ 
        universeSize: universe.length,
        totalCandidates: candidates.length, 
        topN: sorted.length,
        avgScore: sorted.length > 0 ? sorted.reduce((sum, c) => sum + c.score, 0) / sorted.length : 0,
        topScores: sorted.slice(0, 5).map(c => ({ symbol: c.symbol, score: c.score })),
      }, 'Squeeze scan completed');

      // 缓存结果
      this.cache.set(cacheKey, sorted, this.CACHE_TTL.SCAN_RESULT);

      return sorted;
    } catch (error) {
      logger.error({ error }, 'Failed to scan squeeze candidates');
      throw error;
    }
  }

  /**
   * 获取单个 ticker 的详细特征和得分（用于详情页）
   */
  async getTickerDetails(
    baseSymbol: string,
    days: number = 30
  ): Promise<{ features: SqueezeFeatures; breakdown: ScoreBreakdown; squeezeType: SqueezeType }> {
    const pairSymbol = `${baseSymbol}USDT`;
    
    // 检查缓存
    const featureCacheKey = `features:${baseSymbol}:${days}d`;
    const cachedFeatures = this.cache.get(featureCacheKey);
    
    let features: SqueezeFeatures;
    if (cachedFeatures) {
      features = cachedFeatures.features;
    } else {
      const result = await this.signalEngine.calculateFeatures(baseSymbol, pairSymbol, days);
      features = result.features;
      this.cache.set(featureCacheKey, { features, missing: result.missing }, this.CACHE_TTL.FEATURES);
    }

    const { breakdown, squeezeType } = this.signalEngine.calculateScore(features);

    return { features, breakdown, squeezeType };
  }

  /**
   * 获取 Universe（候选币池）
   * @param universeType 币池类型：'bluechip' | 'alt' | 'all'
   */
  private async getUniverse(universeType: 'bluechip' | 'alt' | 'all' = 'all'): Promise<string[]> {
    try {
      if (universeType === 'bluechip') {
        // 蓝筹：只保留 allowlist
        return this.BLUECHIP_COINS;
      }

      // 从 supported-coins 获取全量币种
      const supportedCoins = await this.coinglass.getFuturesSupportedCoins().catch(() => {
        logger.warn('Failed to get supported coins, using priority coins');
        return this.PRIORITY_COINS;
      });

      if (universeType === 'alt') {
        // 山寨：从 supported-coins 中剔除蓝筹币
        const bluechipSet = new Set(this.BLUECHIP_COINS);
        const altCoins = supportedCoins.filter((coin: string) => !bluechipSet.has(coin.toUpperCase()));
        
        // 取前 ALT_UNIVERSE_SIZE 个
        const universe = altCoins.slice(0, this.ALT_UNIVERSE_SIZE);
        logger.debug({ universeSize: universe.length, universeType: 'alt' }, 'Alt universe generated');
        return universe;
      }

      // all：合并所有币种
      const allCoins = [...new Set([...this.PRIORITY_COINS, ...supportedCoins])];
      const universe = allCoins.slice(0, this.DEFAULT_UNIVERSE_SIZE);
      logger.debug({ universeSize: universe.length, universeType: 'all' }, 'Universe generated');
      return universe;
    } catch (error) {
      logger.warn({ error, universeType }, 'Failed to get universe, using fallback');
      if (universeType === 'bluechip') {
        return this.BLUECHIP_COINS;
      }
      return this.PRIORITY_COINS.slice(0, this.DEFAULT_UNIVERSE_SIZE);
    }
  }

  /**
   * 筛选条件（硬过滤）
   * 只有满足以下条件之一的 ticker 才进入候选池：
   * - OI分 >= 16 且（多空反转分 >= 14 或 基差分 >= 10）
   * - 或 总分 >= 65
   * 
   * 临时放宽：总分 >= 30 也显示（用于调试和确保有结果）
   */
  private passesFilter(breakdown: ScoreBreakdown): boolean {
    // 条件1：OI分 >= 16 且（多空反转分 >= 14 或 基差分 >= 10）
    if (breakdown.oi_rhythm >= 16) {
      if (breakdown.ls_ratio_reversal >= 14 || breakdown.basis_expansion >= 10) {
        return true;
      }
    }

    // 条件2：总分 >= 65
    if (breakdown.total >= 65) {
      return true;
    }

    // 临时放宽：总分 >= 30 也显示（用于调试）
    if (breakdown.total >= 30) {
      return true;
    }

    return false;
  }

  /**
   * 生成关键触发点摘要（用于列表显示）
   */
  generateSummary(features: SqueezeFeatures, breakdown: ScoreBreakdown): string {
    const parts: string[] = [];

    if (breakdown.oi_rhythm >= 16) {
      parts.push(`OI先缩后扩`);
    }
    if (breakdown.ls_ratio_reversal >= 14) {
      parts.push(`多空反转`);
    }
    if (breakdown.taker_buy_bias >= 16) {
      parts.push(`主动买量抬升`);
    }
    if (breakdown.basis_expansion >= 10) {
      parts.push(`基差扩大`);
    }

    if (parts.length === 0) {
      return '结构信号较弱';
    }

    return parts.join(' + ');
  }

  /**
   * 扫描 Binance 合约项目的 4h 结构变化（新流程）
   * 基于大户多空比历史，筛选并排序
   * @param maxResults 最多返回数量（默认10）
   */
  async scanBinance4hStructure(maxResults: number = 10): Promise<Array<{ symbol: string; score: number }>> {
    const cacheKey = `squeeze_scan_4h:${maxResults}`;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      logger.debug({ cacheKey }, '4h structure scan cache hit');
      return cached as Array<{ symbol: string; score: number }>;
    }

    try {
      // 1. 获取 Binance 合约可用项目列表
      const binanceSymbols = await this.getBinanceContractSymbols();
      logger.info({ symbolCount: binanceSymbols.length }, 'Starting Binance 4h structure scan');

      // 2. 并发评估每个 symbol 的 4h 结构
      const candidates: Array<{ symbol: string; score: number }> = [];
      const fetchPromises = binanceSymbols.map(symbol =>
        this.limit(async () => {
          try {
            const score = await this.evaluate4hStructure(symbol);
            if (score >= 3) { // 最低阈值
              candidates.push({ symbol, score });
            }
          } catch (error) {
            logger.debug({ error, symbol }, 'Failed to evaluate 4h structure for symbol');
            // 静默失败，不记录错误
          }
        })
      );

      await Promise.all(fetchPromises);

      // 3. 按 score 从高到低排序并返回 Top N
      const sorted = candidates
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults);

      logger.info({
        totalScanned: binanceSymbols.length,
        candidatesFound: candidates.length,
        topN: sorted.length,
        topScores: sorted.slice(0, 5).map(c => ({ symbol: c.symbol, score: c.score })),
      }, 'Binance 4h structure scan completed');

      // 缓存结果（15分钟）
      this.cache.set(cacheKey, sorted, this.CACHE_TTL.SCAN_RESULT);

      return sorted;
    } catch (error) {
      logger.error({ error }, 'Failed to scan Binance 4h structure');
      throw error;
    }
  }

  /**
   * 获取 Binance 合约可用项目列表
   * 从 CoinGlass 获取，确保后续接口能正常取到数据
   */
  private async getBinanceContractSymbols(): Promise<string[]> {
    try {
      // 从 supported-coins 获取，这些币种在 Binance 都有合约
      const supportedCoins = await this.coinglass.getFuturesSupportedCoins();
      
      // 优先使用硬编码的优先币种列表（已验证可用的）
      const allSymbols = [...new Set([...this.PRIORITY_COINS, ...supportedCoins])];
      
      // 限制数量，避免扫描过多
      return allSymbols.slice(0, 100);
    } catch (error) {
      logger.warn({ error }, 'Failed to get Binance contract symbols, using fallback');
      return this.PRIORITY_COINS;
    }
  }

  /**
   * 评估单个 symbol 的 4h 结构变化
   * 返回评分（用于排序）
   */
  private async evaluate4hStructure(symbol: string): Promise<number> {
    try {
      const pairSymbol = `${symbol}USDT`;

      // 读取大户多空比历史（至少需要最近 2 根）
      const ratioHistory = await this.coinglass.getTopLongShortPositionRatioHistory({
        exchange: 'Binance',
        symbol: pairSymbol,
        interval: '4h',
        limit: 6,
      });

      // 若返回 <2 根 → 直接跳过（返回 0）
      if (!Array.isArray(ratioHistory) || ratioHistory.length < 2) {
        return 0;
      }

      // 提取最新两根数据
      const prev = ratioHistory[ratioHistory.length - 2];
      const now = ratioHistory[ratioHistory.length - 1];

      // 解析数值
      const prevRatio = this.parseRatio(prev);
      const nowRatio = this.parseRatio(now);
      const prevLongPercent = this.parsePercent(prev, 'top_position_long_percent', 'top_account_long_percent');
      const nowLongPercent = this.parsePercent(now, 'top_position_long_percent', 'top_account_long_percent');
      const prevShortPercent = this.parsePercent(prev, 'top_position_short_percent', 'top_account_short_percent');
      const nowShortPercent = this.parsePercent(now, 'top_position_short_percent', 'top_account_short_percent');

      let score = 0;

      // B3.2 判定 4h 内是否出现"多空比反转"
      const reversalInfo = this.detectReversal(prevRatio, nowRatio);
      if (reversalInfo.hasReversal) {
        // 根据反转强度加分
        if (reversalInfo.strength === 'weak') {
          score += 3;
        } else if (reversalInfo.strength === 'medium') {
          score += 6;
        } else if (reversalInfo.strength === 'strong') {
          score += 9;
        }
      }

      // B3.3 判定"大户开仓倾向"
      const deltaLong = nowLongPercent - prevLongPercent;
      const deltaShort = nowShortPercent - prevShortPercent;

      // 多军开仓更猛
      if ((deltaLong >= 2.0 && deltaShort <= -2.0) || (deltaLong - Math.abs(deltaShort) >= 3.0)) {
        score += 4;
      }

      // 空军开仓更猛
      if ((deltaShort >= 2.0 && deltaLong <= -2.0) || (deltaShort - Math.abs(deltaLong) >= 3.0)) {
        score += 4;
      }

      // 若无反转但存在明显开仓倾向
      if (!reversalInfo.hasReversal && (Math.abs(deltaLong) >= 2.0 || Math.abs(deltaShort) >= 2.0)) {
        score += 2;
      }

      return score;
    } catch (error) {
      logger.debug({ error, symbol }, 'Failed to evaluate 4h structure');
      return 0;
    }
  }

  /**
   * 检测多空比反转
   */
  private detectReversal(prevRatio: number, nowRatio: number): {
    hasReversal: boolean;
    strength: 'weak' | 'medium' | 'strong' | 'none';
  } {
    // 判定反转
    const hasReversal =
      (prevRatio < 1 && nowRatio > 1) || // 空 → 多 反转
      (prevRatio > 1 && nowRatio < 1); // 多 → 空 反转

    if (!hasReversal) {
      return { hasReversal: false, strength: 'none' };
    }

    // 计算反转强度
    const change = Math.abs(nowRatio - prevRatio);
    let strength: 'weak' | 'medium' | 'strong';
    if (change < 0.1) {
      strength = 'weak';
    } else if (change < 0.3) {
      strength = 'medium';
    } else {
      strength = 'strong';
    }

    return { hasReversal: true, strength };
  }

  /**
   * 解析多空比数值
   */
  private parseRatio(item: any): number {
    const value = item?.top_position_long_short_ratio ||
                  item?.top_account_long_short_ratio ||
                  item?.long_short_ratio ||
                  '1.0';
    return parseFloat(String(value)) || 1.0;
  }

  /**
   * 解析百分比数值
   */
  private parsePercent(item: any, primaryKey: string, fallbackKey: string): number {
    const value = item?.[primaryKey] || item?.[fallbackKey] || '0';
    return parseFloat(String(value)) || 0;
  }
}
