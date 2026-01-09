import { CoinGlassClient } from '../clients/coinglass.client';
import { logger } from '../utils/logger';

/**
 * Taker 增长计算服务
 * 计算 8h 内 Taker 总量增长最快的交易对
 */
export interface TakerGrowthResult {
  symbol: string;
  pairSymbol: string;
  currentTakerTotal: number; // 最近一期 Taker 总量
  previousTakerTotal: number; // 前一期 Taker 总量
  growth: number; // 增长值（差值）
  growthPercent: number; // 增长百分比
}

export class TakerGrowthService {
  // 排除的主流币种列表（不参与 Taker 增长选币）
  private readonly EXCLUDED_SYMBOLS = [
    'BTC', 'ETH', 'SOL', 'XRP', 'BNB', 
    'TRX', 'TRON',  // TRON 可能是 TRX
    'DOGE', 'DOGECOIN',  // Dogecoin 可能是 DOGE
    'LINK', 'CHAINLINK',  // Chainlink 可能是 LINK
  ];

  constructor(private coinglass: CoinGlassClient) {}

  /**
   * 计算单个交易对的 8h Taker 增长
   * @param symbol 币种符号（如 BTC）
   * @returns Taker 增长结果，如果数据不足则返回 null
   */
  async calculateTakerGrowth(symbol: string): Promise<TakerGrowthResult | null> {
    try {
      const pairSymbol = `${symbol}USDT`;

      // 获取最近 2 期的 8h Taker 数据（用于计算增长）
      const history = await this.coinglass.getTakerBuySellVolumeHistory({
        exchange: 'Binance',
        symbol: pairSymbol,
        interval: '8h',
        limit: 2,
      });

      if (!Array.isArray(history) || history.length < 2) {
        // 数据不足，无法计算增长
        return null;
      }

      // 解析数据
      const latest = history[0]; // 最近一期
      const previous = history[1]; // 前一期

      const parseNumber = (value: string | number | undefined): number => {
        if (typeof value === 'number') return value;
        if (typeof value === 'string') {
          const parsed = parseFloat(value);
          return isNaN(parsed) ? 0 : parsed;
        }
        return 0;
      };

      const currentBuy = parseNumber(latest.taker_buy_volume_usd);
      const currentSell = parseNumber(latest.taker_sell_volume_usd);
      const previousBuy = parseNumber(previous.taker_buy_volume_usd);
      const previousSell = parseNumber(previous.taker_sell_volume_usd);

      const currentTakerTotal = currentBuy + currentSell;
      const previousTakerTotal = previousBuy + previousSell;

      // 计算增长（差值）
      const growth = currentTakerTotal - previousTakerTotal;
      
      // 计算增长百分比
      const growthPercent = previousTakerTotal > 0
        ? (growth / previousTakerTotal) * 100
        : 0;

      return {
        symbol,
        pairSymbol,
        currentTakerTotal,
        previousTakerTotal,
        growth,
        growthPercent,
      };
    } catch (error) {
      logger.debug({ error, symbol }, 'Failed to calculate taker growth');
      return null;
    }
  }

  /**
   * 找出 8h 内 Taker 增长最快的交易对
   * @param symbols 候选币种列表
   * @returns 增长最快的交易对结果，如果无有效数据则返回 null
   */
  async findFastestGrowth(symbols: string[]): Promise<TakerGrowthResult | null> {
    // 过滤掉排除的主流币种
    const filteredSymbols = symbols.filter(symbol => {
      const upperSymbol = symbol.toUpperCase();
      return !this.EXCLUDED_SYMBOLS.some(excluded => 
        excluded.toUpperCase() === upperSymbol
      );
    });

    logger.info({ 
      total: symbols.length, 
      filtered: filteredSymbols.length,
      excluded: symbols.length - filteredSymbols.length,
    }, 'Calculating taker growth (excluding mainstream coins)');

    if (filteredSymbols.length === 0) {
      logger.warn('No symbols left after filtering excluded coins');
      return null;
    }

    const results: TakerGrowthResult[] = [];

    // 并发计算（限制并发数，避免 API 限流）
    const pLimit = (await import('p-limit')).default;
    const limit = pLimit(5); // 最多 5 个并发

    const promises = filteredSymbols.map(symbol =>
      limit(async () => {
        const result = await this.calculateTakerGrowth(symbol);
        if (result && result.growth > 0) {
          // 只保留增长为正的结果
          results.push(result);
        }
      })
    );

    await Promise.all(promises);

    if (results.length === 0) {
      logger.warn('No valid taker growth results found');
      return null;
    }

    // 按增长值排序，取最大值
    results.sort((a, b) => b.growth - a.growth);
    const fastest = results[0];

    logger.info({
      symbol: fastest.symbol,
      growth: fastest.growth,
      growthPercent: fastest.growthPercent.toFixed(2),
      totalCandidates: results.length,
    }, 'Fastest taker growth found');

    return fastest;
  }
}

