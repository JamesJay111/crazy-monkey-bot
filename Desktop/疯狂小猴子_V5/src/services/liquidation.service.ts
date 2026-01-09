import { CoinGlassClient } from '../clients/coinglass.client';
import { logger } from '../utils/logger';
import { CoinGlassLiquidationHistoryItem } from '../types';

/**
 * 爆仓/清算服务
 */
export class LiquidationService {
  constructor(private coinglass: CoinGlassClient) {}

  /**
   * 获取交易对近 24 小时爆仓数据
   * 
   * 策略：
   * 1. 优先：interval=1h & limit=24 → 汇总 24 条
   * 2. Fallback：interval=1d & limit=1 → 使用最近 1 天数据
   */
  async getPairLiquidation24h(
    exchange: string = 'Binance',
    pairSymbol: string
  ): Promise<{
    longUsd24h: number;
    shortUsd24h: number;
    netLongMinusShortUsd24h: number;
  } | null> {
    try {
      // 优先尝试 1h 粒度，获取 24 条数据
      let history: CoinGlassLiquidationHistoryItem[] = [];
      
      try {
        history = await this.coinglass.getLiquidationHistory({
          exchange,
          symbol: pairSymbol,
          interval: '1h',
          limit: 24,
        });

        // 如果返回数据不足 24 条，尝试 fallback
        if (!Array.isArray(history) || history.length === 0) {
          throw new Error('1h interval returned no data');
        }
      } catch (error) {
        logger.warn({ error, exchange, pairSymbol }, 'Failed to get 1h liquidation, trying 1d fallback');
        
        // Fallback：使用 1d 粒度，获取最近 1 条
        try {
          history = await this.coinglass.getLiquidationHistory({
            exchange,
            symbol: pairSymbol,
            interval: '1d',
            limit: 1,
          });
        } catch (fallbackError) {
          logger.error({ error: fallbackError, exchange, pairSymbol }, 'Failed to get liquidation history');
          return null; // 数据不可用
        }
      }

      if (!Array.isArray(history) || history.length === 0) {
        logger.warn({ exchange, pairSymbol }, 'Liquidation history is empty');
        return null;
      }

      // 按时间排序（确保升序）
      const sorted = [...history].sort((a, b) => a.time - b.time);

      // 汇总所有数据
      let totalLong = 0;
      let totalShort = 0;

      for (const item of sorted) {
        const long = this.parseLiquidationValue(item.long_liquidation_usd);
        const short = this.parseLiquidationValue(item.short_liquidation_usd);
        
        if (!isNaN(long)) {
          totalLong += long;
        }
        if (!isNaN(short)) {
          totalShort += short;
        }
      }

      const netLongMinusShort = totalLong - totalShort;

      logger.info({
        exchange,
        pairSymbol,
        dataPoints: sorted.length,
        totalLong,
        totalShort,
        netLongMinusShort,
      }, 'Got liquidation 24h data');

      return {
        longUsd24h: totalLong,
        shortUsd24h: totalShort,
        netLongMinusShortUsd24h: netLongMinusShort,
      };
    } catch (error) {
      logger.error({ error, exchange, pairSymbol }, 'Failed to get pair liquidation 24h');
      return null; // 数据不可用，但不抛出错误
    }
  }

  /**
   * 解析爆仓值（支持 string 或 number）
   */
  private parseLiquidationValue(value: string | number | undefined): number {
    if (value === undefined || value === null) return 0;
    if (typeof value === 'number') return value;
    const parsed = parseFloat(String(value));
    return isNaN(parsed) ? 0 : parsed;
  }
}

