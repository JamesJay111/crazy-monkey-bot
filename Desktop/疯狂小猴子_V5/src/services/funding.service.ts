import { CoinGlassClient } from '../clients/coinglass.client';
import { logger } from '../utils/logger';
import { formatPercent, formatDate } from '../utils/formatter';
import {
  CoinGlassFundingRateExchangeItem,
  CoinGlassAccumulatedFundingRate,
  CoinGlassOHLC,
} from '../types';

/**
 * 资金费率服务（多级选择支持 + 历史查询）
 */
export class FundingService {
  // 交易所优先级（用于去重）
  private readonly EXCHANGE_PRIORITY = ['Binance', 'OKX', 'Bybit', 'Bitget', 'Gate', 'Other'];

  constructor(private coinglass: CoinGlassClient) {}

  /**
   * 1. 币种资金费率（交易所实时）- Top N
   */
  async getExchangeFundingRateTopN(
    direction: 'positive' | 'negative',
    limit: number = 10
  ): Promise<Array<{
    symbol: string;
    exchange: string;
    fundingRate: number;
    fundingRatePercent: string;
    nextFundingTime: number;
  }>> {
    try {
      const allRates = await this.coinglass.getFundingRateExchangeList();

      // 展平所有交易所的数据
      const items: Array<{
        symbol: string;
        exchange: string;
        fundingRate: number;
        nextFundingTime: number;
      }> = [];

      // 处理返回的数据结构
      if (Array.isArray(allRates)) {
        for (const symbolData of allRates) {
          if (!symbolData || !symbolData.symbol) continue;
          
          const symbol = symbolData.symbol.toUpperCase();
          
        // 处理 stablecoin_margin_list
          if (Array.isArray(symbolData.stablecoin_margin_list)) {
            for (const item of symbolData.stablecoin_margin_list) {
              if (item.exchange && item.funding_rate !== undefined) {
                const rate = this.parseFundingRate(item.funding_rate);
                if (!isNaN(rate)) {
              items.push({
                    symbol,
                    exchange: item.exchange,
                    fundingRate: rate,
                    nextFundingTime: item.next_funding_time || 0,
                  });
                }
              }
            }
        }
        
        // 处理 token_margin_list
          if (Array.isArray(symbolData.token_margin_list)) {
            for (const item of symbolData.token_margin_list) {
              if (item.exchange && item.funding_rate !== undefined) {
                const rate = this.parseFundingRate(item.funding_rate);
                if (!isNaN(rate)) {
                  items.push({
                    symbol,
                    exchange: item.exchange,
                    fundingRate: rate,
                    nextFundingTime: item.next_funding_time || 0,
                  });
                }
              }
            }
          }
        }
      }

      // 去重：同一 symbol 只保留优先级最高的交易所
      const symbolMap = new Map<string, typeof items[0]>();
      for (const item of items) {
        const existing = symbolMap.get(item.symbol);
        if (!existing || this.getExchangePriority(item.exchange) < this.getExchangePriority(existing.exchange)) {
          symbolMap.set(item.symbol, item);
        }
      }

      // 筛选和排序
      const filtered = Array.from(symbolMap.values())
        .filter(item => (direction === 'positive' ? item.fundingRate > 0 : item.fundingRate < 0))
        .sort((a, b) => (direction === 'positive' ? b.fundingRate - a.fundingRate : a.fundingRate - b.fundingRate))
        .slice(0, limit)
        .map(item => ({ ...item, fundingRatePercent: formatPercent(item.fundingRate, 4) }));

      return filtered;
    } catch (error) {
      logger.error({ error, direction }, 'Failed to get exchange funding rate top N');
      throw error;
    }
  }

  /**
   * 2. 累计资金费率（交易所）- Top N
   */
  async getAccumulatedFundingRateTopN(
    direction: 'positive' | 'negative',
    limit: number = 10
  ): Promise<Array<{
    symbol: string;
    exchange: string;
    accumulatedFundingRate: number;
    accumulatedFundingRatePercent: string;
    nextFundingTime: number;
  }>> {
    try {
      // 优先尝试使用专门的累计资金费率端点
      let allRates: any;
      try {
        allRates = await this.coinglass.getAccumulatedFundingRateExchangeList();
      } catch (error) {
        logger.warn({ error }, 'Failed to get accumulated funding rate from dedicated endpoint, trying exchange-list');
        // Fallback: 尝试从 exchange-list 获取（如果累计端点不存在）
        allRates = await this.coinglass.getFundingRateExchangeList();
      }

      const items: Array<{
        symbol: string;
        exchange: string;
        accumulatedFundingRate: number;
        nextFundingTime: number;
      }> = [];

      // 处理返回的数据结构
      if (Array.isArray(allRates)) {
        // 遍历数组，处理每个 symbolData
        for (const symbolData of allRates) {
          if (!symbolData || !symbolData.symbol) continue;
          
          const symbol = symbolData.symbol.toUpperCase();
          
          // 处理 stablecoin_margin_list
          if (Array.isArray(symbolData.stablecoin_margin_list)) {
            for (const item of symbolData.stablecoin_margin_list) {
              if (item.exchange && item.accumulated_funding_rate !== undefined) {
                const rate = this.parseFundingRate(item.accumulated_funding_rate);
                if (!isNaN(rate)) {
                  items.push({
                    symbol,
                    exchange: item.exchange,
                    accumulatedFundingRate: rate,
                    nextFundingTime: item.next_funding_time || 0,
                  });
                }
              }
            }
          }
          
          // 处理 token_margin_list
          if (Array.isArray(symbolData.token_margin_list)) {
            for (const item of symbolData.token_margin_list) {
              if (item.exchange && item.accumulated_funding_rate !== undefined) {
                const rate = this.parseFundingRate(item.accumulated_funding_rate);
                if (!isNaN(rate)) {
                  items.push({
                    symbol,
                    exchange: item.exchange,
                    accumulatedFundingRate: rate,
                    nextFundingTime: item.next_funding_time || 0,
                  });
                }
              }
            }
          }
        }
      } else {
        // 如果返回的不是数组，尝试直接处理（兼容旧格式）
        logger.warn({ allRatesType: typeof allRates }, 'Unexpected data format for accumulated funding rate');
      }

      // 如果没有任何数据，返回空数组
      if (items.length === 0) {
        logger.warn('No accumulated funding rate data found');
        return [];
      }

      // 去重：同一 symbol 只保留优先级最高的交易所
      const symbolMap = new Map<string, typeof items[0]>();
      for (const item of items) {
        const existing = symbolMap.get(item.symbol);
        if (!existing || this.getExchangePriority(item.exchange) < this.getExchangePriority(existing.exchange)) {
          symbolMap.set(item.symbol, item);
        }
      }

      // 筛选和排序
      const filtered = Array.from(symbolMap.values())
        .filter(item => (direction === 'positive' ? item.accumulatedFundingRate > 0 : item.accumulatedFundingRate < 0))
        .sort((a, b) => (direction === 'positive' ? b.accumulatedFundingRate - a.accumulatedFundingRate : a.accumulatedFundingRate - b.accumulatedFundingRate))
        .slice(0, limit)
        .map(item => ({ ...item, accumulatedFundingRatePercent: formatPercent(item.accumulatedFundingRate, 4) }));

      if (filtered.length === 0) {
        logger.warn({ direction, totalItems: items.length }, 'No accumulated funding rate items match direction filter');
      }

      return filtered;
    } catch (error) {
      logger.error({ error, direction }, 'Failed to get accumulated funding rate top N');
      throw error;
    }
  }

  /**
   * 3. 资金费率历史（K线）
   * GET /api/futures/funding-rate/ohlc-history
   */
  async getFundingRateHistoryOhlc(
    symbol: string,
    interval: string = '1d',
    limit: number = 30
  ): Promise<{
    history: CoinGlassOHLC[];
    summary: {
      latest: number;
      high: number;
      low: number;
      highTime: number;
      lowTime: number;
    } | null;
  }> {
    try {
      // 确认 symbol 是币种（BTC），不是交易对（BTCUSDT）
      const baseSymbol = symbol.replace(/USDT|USDC|BUSD$/, '').toUpperCase();
      
      // 验证 interval
      const validIntervals = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '6h', '8h', '12h', '1d', '1w'];
      if (!validIntervals.includes(interval)) {
        throw new Error(`Invalid interval: ${interval}. Must be one of: ${validIntervals.join(', ')}`);
      }

      const history = await this.coinglass.getFundingRateOhlcHistory({
        symbol: baseSymbol,
        interval,
        limit: Math.min(limit, 1000), // 限制最大 1000
      });

      if (!Array.isArray(history) || history.length === 0) {
        return {
          history: [],
          summary: null,
        };
      }

      // 解析 OHLC 数据（统一转换为 string，符合 CoinGlassOHLC 类型）
      const parsed: CoinGlassOHLC[] = history.map(item => ({
        time: item.time,
        open: String(this.parseNumber(item.open)),
        high: String(this.parseNumber(item.high)),
        low: String(this.parseNumber(item.low)),
        close: String(this.parseNumber(item.close)),
      }));

      // 计算摘要（使用 number 类型）
      const latest = this.parseNumber(parsed[parsed.length - 1].close);
      const high = Math.max(...parsed.map(p => this.parseNumber(p.high)));
      const low = Math.min(...parsed.map(p => this.parseNumber(p.low)));
      const highItem = parsed.find(p => this.parseNumber(p.high) === high);
      const lowItem = parsed.find(p => this.parseNumber(p.low) === low);

      return {
        history: parsed,
        summary: {
          latest,
          high,
          low,
          highTime: highItem?.time || 0,
          lowTime: lowItem?.time || 0,
        },
      };
    } catch (error) {
      logger.error({ error, symbol, interval }, 'Failed to get funding rate OHLC history');
      throw error;
    }
  }

  /**
   * 4. 持仓加权资金费率历史（K线）
   * GET /api/futures/funding-rate/oi-weight-ohlc-history
   */
  async getFundingOiWeightOhlcHistory(
    symbol: string,
    interval: string = '1d',
    limit: number = 30
  ): Promise<{
    history: CoinGlassOHLC[];
    summary: {
      latest: number;
      high: number;
      low: number;
      highTime: number;
      lowTime: number;
    } | null;
  }> {
    try {
      const baseSymbol = symbol.replace(/USDT|USDC|BUSD$/, '').toUpperCase();
      const validIntervals = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '6h', '8h', '12h', '1d', '1w'];
      if (!validIntervals.includes(interval)) {
        throw new Error(`Invalid interval: ${interval}`);
      }

      const history = await this.coinglass.getFundingRateOhlcHistory({
        symbol: baseSymbol,
        interval,
        limit: Math.min(limit, 1000),
      });

      if (!Array.isArray(history) || history.length === 0) {
        return {
          history: [],
          summary: null,
        };
      }

      const parsed: CoinGlassOHLC[] = history.map(item => ({
        time: item.time,
        open: String(this.parseNumber(item.open)),
        high: String(this.parseNumber(item.high)),
        low: String(this.parseNumber(item.low)),
        close: String(this.parseNumber(item.close)),
      }));

      const latest = this.parseNumber(parsed[parsed.length - 1].close);
      const high = Math.max(...parsed.map(p => this.parseNumber(p.high)));
      const low = Math.min(...parsed.map(p => this.parseNumber(p.low)));
      const highItem = parsed.find(p => this.parseNumber(p.high) === high);
      const lowItem = parsed.find(p => this.parseNumber(p.low) === low);

      return {
        history: parsed,
        summary: {
          latest,
          high,
          low,
          highTime: highItem?.time || 0,
          lowTime: lowItem?.time || 0,
        },
      };
    } catch (error) {
      logger.error({ error, symbol, interval }, 'Failed to get funding OI weight OHLC history');
      throw error;
    }
  }

  /**
   * 5. 成交量加权资金费率历史（K线）
   * GET /api/futures/funding-rate/vol-weight-ohlc-history
   */
  async getVolWeightFundingRateHistoryOhlc(
    symbol: string,
    interval: string = '1d',
    limit: number = 30
  ): Promise<{
    history: CoinGlassOHLC[];
    summary: {
      latest: number;
      high: number;
      low: number;
      highTime: number;
      lowTime: number;
    } | null;
  }> {
    try {
      const baseSymbol = symbol.replace(/USDT|USDC|BUSD$/, '').toUpperCase();
      const validIntervals = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '6h', '8h', '12h', '1d', '1w'];
      if (!validIntervals.includes(interval)) {
        throw new Error(`Invalid interval: ${interval}`);
      }

      const history = await this.coinglass.getFundingRateOhlcHistory({
        symbol: baseSymbol,
        interval,
        limit: Math.min(limit, 1000),
      });

      if (!Array.isArray(history) || history.length === 0) {
        return {
          history: [],
          summary: null,
        };
      }

      const parsed: CoinGlassOHLC[] = history.map(item => ({
        time: item.time,
        open: String(this.parseNumber(item.open)),
        high: String(this.parseNumber(item.high)),
        low: String(this.parseNumber(item.low)),
        close: String(this.parseNumber(item.close)),
      }));

      const latest = this.parseNumber(parsed[parsed.length - 1].close);
      const high = Math.max(...parsed.map(p => this.parseNumber(p.high)));
      const low = Math.min(...parsed.map(p => this.parseNumber(p.low)));
      const highItem = parsed.find(p => this.parseNumber(p.high) === high);
      const lowItem = parsed.find(p => this.parseNumber(p.low) === low);

      return {
        history: parsed,
        summary: {
          latest,
          high,
          low,
          highTime: highItem?.time || 0,
          lowTime: lowItem?.time || 0,
        },
      };
    } catch (error) {
      logger.error({ error, symbol, interval }, 'Failed to get volume weighted funding rate OHLC history');
      throw error;
    }
  }

  /**
   * 格式化资金费率历史摘要
   */
  formatFundingHistorySummary(
    symbol: string,
    summary: {
      latest: number;
      high: number;
      low: number;
      highTime: number;
      lowTime: number;
    },
    interval: string
  ): string {
    let message = `📊 ${symbol} 资金费率历史（${interval}）摘要\n\n`;
    message += `最新：${formatPercent(summary.latest, 4)}\n`;
    message += `最高：${formatPercent(summary.high, 4)}（${formatDate(summary.highTime)}）\n`;
    message += `最低：${formatPercent(summary.low, 4)}（${formatDate(summary.lowTime)}）\n\n`;
    message += `数据源：CoinGlass`;
    return message;
  }

  private getExchangePriority(exchange: string): number {
    const index = this.EXCHANGE_PRIORITY.indexOf(exchange);
    return index === -1 ? this.EXCHANGE_PRIORITY.length : index;
  }

  private parseFundingRate(rate: string | number | undefined): number {
    if (typeof rate === 'string') {
      const parsed = parseFloat(rate);
      return isNaN(parsed) ? 0 : parsed;
    }
    return rate ?? 0;
  }

  private parseNumber(value: string | number | undefined): number {
    if (value === undefined || value === null) return 0;
    if (typeof value === 'number') return value;
    const parsed = parseFloat(String(value));
    return isNaN(parsed) ? 0 : parsed;
  }
}
