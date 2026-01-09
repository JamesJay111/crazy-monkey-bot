/**
 * Scanner - 对每个 ticker 拉取 CoinGlass 数据
 */

import { logger } from '../../utils/logger';
import { CoinGlassClient } from '../../clients/coinglass.client';
import { ScanResult } from './types';

export class Scanner {
  constructor(private coinglass: CoinGlassClient) {}

  /**
   * 扫描单个 ticker 的 OI 数据
   */
  async scanTicker(symbol: string): Promise<ScanResult> {
    try {
      // 获取当前 OI 数据（从 pairs-markets）
      const pairs = await this.coinglass.getFuturesPairsMarkets({
        exchange: 'Binance',
        symbol: symbol,
      });

      if (pairs.length === 0) {
        return {
          symbol,
          oiUsd: null,
          oiChange4hPercent: null,
          oiChange24hPercent: null,
          priceChange1hPercent: null,
          priceChange4hPercent: null,
          priceChange24hPercent: null,
          marketCapUsd: null,
          oiMcPercent: null,
          direction: 'unknown',
          timestamp: Date.now(),
          errorType: 'no_data',
          errorMessage: 'No pairs data found',
        };
      }

      // 优先选择 USDT 交易对，如果没有则选择 OI 最大的交易对
      let currentPair = pairs.find((p: any) => 
        p.instrument_id?.endsWith('USDT') || p.symbol?.includes('/USDT')
      );
      
      // 如果没有 USDT 交易对，选择 OI 最大的交易对
      if (!currentPair) {
        currentPair = pairs.reduce((max: any, p: any) => {
          const oi = parseFloat(p.open_interest_usd || '0');
          const maxOi = parseFloat(max.open_interest_usd || '0');
          return oi > maxOi ? p : max;
        }, pairs[0]);
      }

      // 只汇总 Binance 交易所的交易对 OI（确保获取完整的 OI 数据）
      // 注意：API 可能返回多个交易所的数据，需要过滤
      const binancePairs = pairs.filter((p: any) => 
        (p.exchange_name || '').toLowerCase() === 'binance'
      );
      
      let totalOiUsd = 0;
      let totalPrice = 0;
      let priceCount = 0;
      
      // 如果找到 Binance 交易对，只汇总 Binance 的
      if (binancePairs.length > 0) {
        for (const pair of binancePairs) {
          const oi = parseFloat(pair.open_interest_usd || '0');
          const price = parseFloat(pair.current_price || '0');
          if (oi > 0) {
            totalOiUsd += oi;
          }
          if (price > 0) {
            totalPrice += price;
            priceCount++;
          }
        }
      } else {
        // 如果没有找到 Binance 交易对，汇总所有交易对（向后兼容）
        for (const pair of pairs) {
          const oi = parseFloat(pair.open_interest_usd || '0');
          const price = parseFloat(pair.current_price || '0');
          if (oi > 0) {
            totalOiUsd += oi;
          }
          if (price > 0) {
            totalPrice += price;
            priceCount++;
          }
        }
      }
      
      // 使用汇总的 OI，如果汇总为 0 则使用当前交易对的 OI
      const oiNowUsd = totalOiUsd > 0 ? totalOiUsd : parseFloat(currentPair.open_interest_usd || '0');
      // 使用平均价格，如果无法计算则使用当前交易对的价格
      const currentPrice = priceCount > 0 ? totalPrice / priceCount : parseFloat(currentPair.current_price || '0');

      if (oiNowUsd <= 0 || currentPrice <= 0) {
        return {
          symbol,
          oiUsd: null,
          oiChange4hPercent: null,
          oiChange24hPercent: null,
          priceChange1hPercent: null,
          priceChange4hPercent: null,
          priceChange24hPercent: null,
          marketCapUsd: null,
          oiMcPercent: null,
          direction: 'unknown',
          timestamp: Date.now(),
          errorType: 'no_data',
          errorMessage: 'Invalid OI or price data',
        };
      }

      // 计算 OI 变化（使用 24h 变化百分比估算 4h 变化）
      let oiChange4hPercent: number | null = null;
      let oiChange24hPercent: number | null = null;

      if (currentPair.open_interest_change_percent_24h !== undefined && 
          currentPair.open_interest_change_percent_24h !== null) {
        oiChange24hPercent = parseFloat(currentPair.open_interest_change_percent_24h.toString());
        // 估算 4h 变化：4h = 24h * (4/24) = 24h * 1/6
        oiChange4hPercent = oiChange24hPercent * (4 / 24);
      }

      // 计算价格变化
      let priceChange1hPercent: number | null = null;
      let priceChange4hPercent: number | null = null;
      let priceChange24hPercent: number | null = null;

      if (currentPair.price_change_percent_24h !== undefined && 
          currentPair.price_change_percent_24h !== null) {
        priceChange24hPercent = parseFloat(currentPair.price_change_percent_24h.toString());
        // 估算 4h 变化：4h = 24h * (4/24) = 24h * 1/6
        priceChange4hPercent = priceChange24hPercent * (4 / 24);
        // 估算 1h 变化：1h = 24h * (1/24) = 24h * 1/24
        priceChange1hPercent = priceChange24hPercent * (1 / 24);
      }

      // 确定方向
      const direction: 'up' | 'down' | 'unknown' = 
        oiChange4hPercent !== null
          ? (oiChange4hPercent > 0 ? 'up' : oiChange4hPercent < 0 ? 'down' : 'unknown')
          : 'unknown';

      // 计算市值和 OI/MC 比率（暂时为 null，后续可扩展）
      const marketCapUsd: number | null = null;
      const oiMcPercent: number | null = null;

      return {
        symbol,
        oiUsd: oiNowUsd,
        oiChange4hPercent,
        oiChange24hPercent,
        priceChange1hPercent,
        priceChange4hPercent,
        priceChange24hPercent,
        marketCapUsd,
        oiMcPercent,
        direction,
        timestamp: Date.now(),
        raw: currentPair,
        errorType: null,
      };
    } catch (error: any) {
      // 区分错误类型
      let errorType: 'rate_limit' | 'fatal_error' = 'fatal_error';
      if (error?.statusCode === 429 || 
          error?.response?.status === 429 ||
          error?.message?.includes('Too Many Requests') ||
          error?.message?.includes('Rate Limit')) {
        errorType = 'rate_limit';
      }

      logger.warn({ 
        error: error.message, 
        symbol,
        errorType 
      }, 'Failed to scan ticker');

      return {
        symbol,
        oiUsd: null,
        oiChange4hPercent: null,
        oiChange24hPercent: null,
        priceChange1hPercent: null,
        priceChange4hPercent: null,
        priceChange24hPercent: null,
        marketCapUsd: null,
        oiMcPercent: null,
        direction: 'unknown',
        timestamp: Date.now(),
        errorType,
        errorMessage: error.message,
      };
    }
  }

  /**
   * 批量扫描多个 ticker（带并发控制）
   */
  async scanTickers(symbols: string[], concurrency: number = 5): Promise<ScanResult[]> {
    const results: ScanResult[] = [];
    
    // 使用简单的并发控制
    for (let i = 0; i < symbols.length; i += concurrency) {
      const batch = symbols.slice(i, i + concurrency);
      const batchResults = await Promise.all(
        batch.map(symbol => this.scanTicker(symbol))
      );
      results.push(...batchResults);
    }

    return results;
  }
}

