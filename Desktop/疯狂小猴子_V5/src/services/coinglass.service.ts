import { CoinGlassClient } from '../clients/coinglass.client';
import { logger } from '../utils/logger';

/**
 * CoinGlass 业务服务层
 * 封装业务逻辑，提供更高级的 API
 */
export class CoinGlassService {
  constructor(private client: CoinGlassClient) {}

  /**
   * 获取支持的币种列表
   */
  async getFuturesSupportedCoins(): Promise<string[]> {
    return this.client.getFuturesSupportedCoins();
  }

  /**
   * 获取支持的交易所和交易对
   */
  async getFuturesSupportedExchangePairs(): Promise<Record<string, any[]>> {
    return this.client.getFuturesSupportedExchangePairs();
  }

  /**
   * 检查币种是否在 Binance Futures 上线
   */
  async isBinanceFutures(symbol: string): Promise<boolean> {
    try {
      const pairs = await this.client.getFuturesSupportedExchangePairs();
      const binancePairs = pairs['Binance'] || [];
      const normalized = symbol.toUpperCase();
      
      return binancePairs.some((pair: any) => 
        pair.base_asset === normalized && 
        (pair.instrument_id?.includes('PERP') || pair.instrument_id?.includes('SWAP'))
      );
    } catch (error) {
      logger.error({ error, symbol }, 'Failed to check Binance Futures');
      return false;
    }
  }

  /**
   * 获取 OI 交易所列表（过滤 Binance）
   */
  async getOpenInterestExchangeList(symbol?: string): Promise<any[]> {
    const list = await this.client.getOpenInterestExchangeList({ symbol });
    
    // 优先返回 Binance 数据，如果没有则返回所有
    const binanceData = list.find((item: any) => item.exchange === 'Binance');
    if (binanceData) {
      return [binanceData];
    }
    
    return list;
  }

  /**
   * 获取 Funding Rate 交易所列表（过滤 Binance）
   */
  async getFundingRateExchangeList(symbol?: string): Promise<any[]> {
    // 调用兼容性方法（单参数版本）
    const list = await this.client.getFundingRateExchangeList(symbol);
    
    // 处理 stablecoin_margin_list 和 token_margin_list
    const allRates: any[] = [];
    if (Array.isArray(list)) {
      allRates.push(...list);
    } else if (list && typeof list === 'object' && !Array.isArray(list)) {
      const listObj = list as any;
      if (Array.isArray(listObj.stablecoin_margin_list)) {
        allRates.push(...listObj.stablecoin_margin_list);
      }
      if (Array.isArray(listObj.token_margin_list)) {
        allRates.push(...listObj.token_margin_list);
      }
    }
    
    // 优先返回 Binance 数据
    const binanceData = allRates.find((item: any) => item.exchange === 'Binance');
    if (binanceData) {
      return [binanceData];
    }
    
    return allRates;
  }

  /**
   * 获取 OI 历史
   */
  async getOpenInterestHistory(symbol: string, interval: string = '1h', limit: number = 720): Promise<any[]> {
    return this.client.getOpenInterestOhlcHistory({ symbol, interval, limit });
  }

  /**
   * 获取 Funding Rate 历史
   */
  async getFundingRateHistory(symbol: string, interval: string = '1h', limit: number = 168): Promise<any[]> {
    return this.client.getFundingRateOhlcHistory({ symbol, interval, limit });
  }

  /**
   * 获取全网账户多空比历史
   */
  async getGlobalLongShortRatioHistory(symbol: string, interval: string = '1h', limit: number = 720): Promise<any[]> {
    // 调用兼容性方法（多参数版本）
    return this.client.getGlobalLongShortRatioHistory(symbol, interval, limit);
  }

  /**
   * 获取 BTC ETF 资金流历史
   */
  async getBtcEtfFlowHistory(days: number = 30): Promise<any[]> {
    return this.client.getBtcEtfFlowHistory({ days });
  }

  /**
   * 获取 ETH ETF 资金流历史
   */
  async getEthEtfFlowHistory(days: number = 30): Promise<any[]> {
    return this.client.getEthEtfFlowHistory({ days });
  }

  /**
   * 获取基差历史
   */
  async getBasisHistory(symbol: string, interval: string = '1h', limit: number = 720): Promise<any[]> {
    return this.client.getBasisHistory({ symbol, interval, limit });
  }

  /**
   * 获取限流状态
   */
  getRateLimitStatus() {
    return this.client.getRateLimitStatus();
  }
}

