/**
 * TickerSource - 负责提供本轮扫描的 ticker 列表
 */

import { logger } from '../../utils/logger';
import { CoinGlassClient } from '../../clients/coinglass.client';
import { env } from '../../config/env';

export interface TickerSourceConfig {
  scanTopN?: number; // 扫描 Top N 个币种
  scanGroups?: string[]; // 扫描组：['major', 'meme', 'topOI']
  useDynamicList?: boolean; // 是否使用动态列表
}

/**
 * TickerSource - 动态获取 ticker 列表
 */
export class TickerSource {
  constructor(
    private coinglass: CoinGlassClient,
    private config: TickerSourceConfig = {}
  ) {}

  /**
   * 获取本轮扫描的 ticker 列表
   */
  async getTickers(): Promise<string[]> {
    const { scanTopN = 200, scanGroups = ['major', 'meme', 'topOI'], useDynamicList = true } = this.config;

    try {
      if (useDynamicList) {
        // 方法1：尝试从 pairs-markets 动态获取（如果 API 支持）
        // 注意：CoinGlass API 可能需要逐个查询，这里先使用策略化分组
        return await this.getTickersByStrategy(scanGroups, scanTopN);
      } else {
        // 方法2：使用扩展的静态列表（包含更多币种）
        return this.getStaticTickerList();
      }
    } catch (error) {
      logger.error({ error }, 'Failed to get tickers, using fallback');
      return this.getStaticTickerList();
    }
  }

  /**
   * 策略化获取 ticker 列表
   */
  private async getTickersByStrategy(groups: string[], topN: number): Promise<string[]> {
    const tickerSet = new Set<string>();

    // 主流币（固定小集合）
    if (groups.includes('major')) {
      const majorTickers = [
        'BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'ADA', 'DOGE', 'AVAX', 'MATIC', 'DOT',
        'LINK', 'UNI', 'ATOM', 'LTC', 'BCH', 'ETC', 'XLM', 'ALGO', 'FIL', 'ICP',
        'APT', 'ARB', 'OP', 'SUI', 'SEI', 'TIA', 'INJ', 'NEAR', 'FTM', 'AAVE'
      ];
      majorTickers.forEach(t => tickerSet.add(t));
    }

    // Meme/新币（动态高频更新）
    if (groups.includes('meme')) {
      const memeTickers = [
        'BREV', 'PEPE', 'SHIB', 'FLOKI', 'BONK', 'WIF', 'JUP', 'PYTH', 'RENDER', 'FET',
        'AGIX', 'OCEAN', 'RNDR', 'AI', 'TAO', 'AKT', 'LPT', 'LRC', 'IMX', 'GRT',
        'MKR', 'SNX', 'COMP', 'CRV', 'SUSHI', '1INCH', 'YFI', 'SAND', 'MANA',
        'ENJ', 'GALA', 'AXS', 'CHZ', 'FLOW', 'THETA', 'BAT', 'ZRX', 'EOS', 'TRX'
      ];
      memeTickers.forEach(t => tickerSet.add(t));
    }

    // 尝试从支持的币种列表获取（Top OI）
    if (groups.includes('topOI')) {
      try {
        const supportedCoins = await this.coinglass.getFuturesSupportedCoins();
        if (supportedCoins && supportedCoins.length > 0) {
          // 取前 topN 个
          const topCoins = supportedCoins.slice(0, topN).map(c => c.toUpperCase());
          topCoins.forEach(t => tickerSet.add(t));
        }
      } catch (error) {
        logger.debug({ error }, 'Failed to get supported coins for topOI group');
      }
    }

    const tickers = Array.from(tickerSet);
    logger.info({ 
      tickerCount: tickers.length, 
      groups,
      sampleTickers: tickers.slice(0, 10) 
    }, 'Got tickers by strategy');
    
    return tickers;
  }

  /**
   * 获取静态 ticker 列表（fallback）
   */
  private getStaticTickerList(): string[] {
    return [
      // 主流币
      'BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'ADA', 'DOGE', 'AVAX', 'MATIC', 'DOT',
      'LINK', 'UNI', 'ATOM', 'LTC', 'BCH', 'ETC', 'XLM', 'ALGO', 'FIL', 'ICP',
      'APT', 'ARB', 'OP', 'SUI', 'SEI', 'TIA', 'INJ', 'NEAR', 'FTM', 'AAVE',
      // Meme/新币
      'BREV', 'PEPE', 'SHIB', 'FLOKI', 'BONK', 'WIF', 'JUP', 'PYTH', 'RENDER', 'FET',
      'AGIX', 'OCEAN', 'RNDR', 'AI', 'TAO', 'AKT', 'LPT', 'LRC', 'IMX', 'GRT',
      'MKR', 'SNX', 'COMP', 'CRV', 'SUSHI', '1INCH', 'YFI', 'SAND', 'MANA',
      'ENJ', 'GALA', 'AXS', 'CHZ', 'FLOW', 'THETA', 'BAT', 'ZRX', 'EOS', 'TRX',
      'XMR', 'DASH', 'ZEC', 'QTUM', 'ONT', 'VET', 'IOTA', 'NEO', 'WAVES', 'OMG'
    ];
  }
}

