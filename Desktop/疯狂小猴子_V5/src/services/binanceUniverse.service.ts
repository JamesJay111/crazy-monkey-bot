import { CoinGlassClient } from '../clients/coinglass.client';
import { logger } from '../utils/logger';

/**
 * Binance 合约 Universe 服务
 * 获取 Binance 合约可用交易对列表，并缓存
 */
export class BinanceUniverseService {
  private universeCache: string[] | null = null;
  private cacheTimestamp: number = 0;
  private readonly CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 小时

  // 硬编码的优先币种列表（已验证可用）
  private readonly PRIORITY_COINS = [
    'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX', 'MATIC', 'DOT',
    'LINK', 'UNI', 'LTC', 'ATOM', 'ETC', 'XLM', 'FIL', 'TRX', 'APT', 'ARB',
    'OP', 'NEAR', 'ALGO', 'VET', 'ICP', 'AAVE', 'GRT', 'SAND', 'MANA', 'AXS',
    'THETA', 'EOS', 'FLOW', 'HBAR', 'EGLD', 'ZIL', 'ENJ', 'CHZ', 'BAT', 'ZEC',
  ];

  constructor(private coinglass: CoinGlassClient) {}

  /**
   * 获取 Binance 合约交易对列表
   * 优先从 funding-rate exchange-list 获取，提取 Binance 下的 symbol
   */
  async getBinanceUniverse(): Promise<string[]> {
    // 检查缓存
    const now = Date.now();
    if (this.universeCache && (now - this.cacheTimestamp) < this.CACHE_TTL_MS) {
      logger.debug({ count: this.universeCache.length }, 'Using cached Binance universe');
      return this.universeCache;
    }

    try {
      logger.info('Fetching Binance universe from CoinGlass...');

      // 方法 1: 从 funding-rate exchange-list 获取
      const fundingRateList = await this.coinglass.getFundingRateExchangeList();
      const symbols = new Set<string>();

      if (Array.isArray(fundingRateList)) {
        for (const item of fundingRateList) {
          if (!item?.symbol) continue;

          // 检查 stablecoin_margin_list 中是否有 Binance
          if (Array.isArray(item.stablecoin_margin_list)) {
            const hasBinance = item.stablecoin_margin_list.some(
              (exchange: any) => exchange.exchange === 'Binance'
            );
            if (hasBinance) {
              symbols.add(item.symbol.toUpperCase());
            }
          }
        }
      }

      // 方法 2: 如果方法 1 结果太少，从 supported-coins 补充
      if (symbols.size < 50) {
        try {
          const supportedCoins = await this.coinglass.getFuturesSupportedCoins();
          supportedCoins.forEach(coin => symbols.add(coin.toUpperCase()));
        } catch (error) {
          logger.warn({ error }, 'Failed to get supported coins, using fallback');
        }
      }

      // 方法 3: 补充硬编码的优先币种
      this.PRIORITY_COINS.forEach(coin => symbols.add(coin));

      // 转换为数组并排序
      const universe = Array.from(symbols).sort();

      // 更新缓存
      this.universeCache = universe;
      this.cacheTimestamp = now;

      logger.info({ count: universe.length }, 'Binance universe updated');

      return universe;
    } catch (error) {
      logger.error({ error }, 'Failed to get Binance universe');

      // 如果获取失败，使用硬编码列表
      if (!this.universeCache) {
        logger.warn('Using fallback priority coins list');
        this.universeCache = [...this.PRIORITY_COINS];
        this.cacheTimestamp = now;
      }

      return this.universeCache;
    }
  }

  /**
   * 清除缓存（强制刷新）
   */
  clearCache(): void {
    this.universeCache = null;
    this.cacheTimestamp = 0;
    logger.info('Binance universe cache cleared');
  }
}

