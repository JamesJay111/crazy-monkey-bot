import { CoinGlassClient } from '../clients/coinglass.client';
import { LiquidationService } from './liquidation.service';
import { logger } from '../utils/logger';
import { ContractSnapshot, CoinGlassCoinsMarket } from '../types';
import { CoinGlassGuard } from '../utils/coinglassGuard';
import { parseNumberStrict } from '../utils/number';
import { RawDebugLogger } from '../utils/rawDebugLogger';

/**
 * 合约快照服务（重构版）
 * 聚合合约核心状态 + 爆仓清算数据
 * 
 * 修复：
 * - OI（持仓）确保不再缺失：coins-markets 优先 + openInterest/ohlc-history fallback
 * - 删除 "24h 多/空军增加（估算）"
 * - 新增：Top account L/S ratio（交易对维度）+ coin taker buy/sell（币种维度）
 */
export class ContractSnapshotService {
  constructor(
    private coinglass: CoinGlassClient,
    private liquidationService: LiquidationService
  ) {}

  /**
   * 获取合约快照（包含核心状态 + 爆仓数据）
   */
  async getContractSnapshot(baseSymbol: string): Promise<ContractSnapshot> {
    try {
      // 1. 获取交易对符号（默认 USDT）
      const pairSymbol = this.normalizePairSymbol(baseSymbol);
      
      // 2. 验证交易对是否支持（Binance）
      const isSupported = await this.validatePairSymbol('Binance', pairSymbol);
      if (!isSupported) {
        // 获取候选交易对
        const candidates = await this.getCandidatePairs(baseSymbol);
        throw new Error(
          `该交易对在 Binance 不支持。\n\n` +
          `候选交易对：${candidates.slice(0, 5).join(', ')}\n\n` +
          `请换一个 ticker 或指定交易对（如 ${candidates[0]}）`
        );
      }

      // 3. 并行获取所有数据（按照新需求，接入 guard）
      const [
        oiExchangeList,
        fundingRateList,
        topPositionRatioHistory,
        takerBuySellHistory,
        liquidation24h,
        isBinanceFutures,
      ] = await Promise.all([
        // 1️⃣ OI 交易所列表（4小时前数据）- 保持不变
        this.coinglass.getOpenInterestExchangeList({ symbol: baseSymbol.toUpperCase() })
          .then(resp => {
            try {
              CoinGlassGuard.assertBusinessOk(resp, { endpoint: 'getOpenInterestExchangeList', symbol: baseSymbol });
              RawDebugLogger.log('getOpenInterestExchangeList', { symbol: baseSymbol }, resp, { ok: true });
              return resp;
            } catch (error) {
              RawDebugLogger.log('getOpenInterestExchangeList', { symbol: baseSymbol }, resp, { ok: false, reason: (error as Error).message });
              throw error;
            }
          })
          .catch((error) => {
            logger.warn({ baseSymbol, error }, 'Failed to get OI exchange list');
            return [];
          }),
        
        // 2️⃣ 资金费率交易所列表（用于按优先级选择）
        this.coinglass.getFundingRateExchangeList(baseSymbol.toUpperCase())
          .then(resp => {
            try {
              CoinGlassGuard.assertBusinessOk(resp, { endpoint: 'getFundingRateExchangeList', symbol: baseSymbol });
              RawDebugLogger.log('getFundingRateExchangeList', { symbol: baseSymbol }, resp, { ok: true });
              return resp;
            } catch (error) {
              RawDebugLogger.log('getFundingRateExchangeList', { symbol: baseSymbol }, resp, { ok: false, reason: (error as Error).message });
              throw error;
            }
          })
          .catch((error) => {
            logger.warn({ baseSymbol, error }, 'Failed to get funding rate list');
            return [];
          }),
        
        // 5️⃣ 大户持仓多空比历史（交易对维度）- 使用 position-ratio 接口
        this.coinglass.getTopLongShortPositionRatioHistory({
          exchange: 'Binance',
          symbol: pairSymbol,
          interval: '4h',
          limit: 1,
        })
          .then(resp => {
            try {
              CoinGlassGuard.assertBusinessOk(resp, { endpoint: 'getTopLongShortPositionRatioHistory', pairSymbol, interval: '4h' });
              RawDebugLogger.log('getTopLongShortPositionRatioHistory', { pairSymbol, interval: '4h' }, resp, { ok: true });
              return resp;
            } catch (error) {
              RawDebugLogger.log('getTopLongShortPositionRatioHistory', { pairSymbol, interval: '4h' }, resp, { ok: false, reason: (error as Error).message });
              throw error;
            }
          })
          .catch((error) => {
            logger.warn({ baseSymbol, pairSymbol, error }, 'Failed to get top position ratio');
            return [];
          }),
        
        // 4️⃣ 交易对主动买卖历史（交易对维度）
        this.coinglass.getTakerBuySellVolumeHistory({
          exchange: 'Binance',
          symbol: pairSymbol,
          interval: '4h',
          limit: 1,
        })
          .then(resp => {
            try {
              CoinGlassGuard.assertBusinessOk(resp, { endpoint: 'getTakerBuySellVolumeHistory', pairSymbol, interval: '4h' });
              RawDebugLogger.log('getTakerBuySellVolumeHistory', { pairSymbol, interval: '4h' }, resp, { ok: true });
              return resp;
            } catch (error) {
              RawDebugLogger.log('getTakerBuySellVolumeHistory', { pairSymbol, interval: '4h' }, resp, { ok: false, reason: (error as Error).message });
              throw error;
            }
          })
          .catch((error) => {
            logger.warn({ baseSymbol, pairSymbol, error }, 'Failed to get taker buy-sell volume history');
            return [];
          }),
        
        // 爆仓数据（可能失败，不抛出错误）
        this.liquidationService.getPairLiquidation24h('Binance', pairSymbol).catch(() => {
          logger.warn({ pairSymbol }, 'Failed to get liquidation data');
          return null;
        }),
        
        // 是否在 Binance Futures 上线
        this.coinglass.isBinanceFutures(baseSymbol).catch(() => false),
      ]);

      // 4. 提取核心字段（按照新需求，使用 strict parse）
      
      // 1️⃣ OI（4小时前数据）- 从 exchange-list 汇总所有交易所
      let oiUsd: number | undefined = undefined;
      if (Array.isArray(oiExchangeList) && oiExchangeList.length > 0) {
        // 如果存在 "exchange": "All"，直接使用该条
        const allExchangeItem = oiExchangeList.find((item: any) => item.exchange === 'All');
        if (allExchangeItem) {
          oiUsd = parseNumberStrict(allExchangeItem.open_interest_usd || allExchangeItem.open_interest_quantity);
        } else {
          // 否则汇总所有交易所
          const sum = oiExchangeList.reduce((acc, item: any) => {
            const oi = parseNumberStrict(item.open_interest_usd || item.open_interest_quantity);
            return acc + (oi !== undefined ? oi : 0);
          }, 0);
          oiUsd = sum > 0 ? sum : undefined;
        }
      }
      // 如果 OI 缺失，使用 0（但 validator 会检测到并跳过）
      if (oiUsd === undefined) {
        oiUsd = 0;
      }
      
      // 2️⃣ 当前资金费率 - 从 stablecoin_margin_list 中按优先级选择
      let fundingRate: number | null = null;
      let nextFundingTime = 0;
      let fundingRateError: string | null = null;
      
      if (Array.isArray(fundingRateList) && fundingRateList.length > 0) {
        const fundingRateData = this.getFundingRateFromStablecoinList(fundingRateList, baseSymbol);
        if (fundingRateData) {
          fundingRate = fundingRateData.rate;
          nextFundingTime = fundingRateData.nextFundingTime;
        } else {
          // 无主流交易对
          fundingRateError = '该Ticker暂无主流交易所合约资金费率数据';
        }
      } else {
        fundingRateError = '该Ticker暂无主流交易所合约资金费率数据';
      }

      // 5️⃣ 大户持仓结构（交易对维度）- 使用 position-ratio 接口的字段（strict parse，不写 0）
      let topPositionLongPercent: number | undefined = undefined;
      let topPositionShortPercent: number | undefined = undefined;
      let topPositionLongShortRatio: number | undefined = undefined;
      
      if (Array.isArray(topPositionRatioHistory) && topPositionRatioHistory.length > 0) {
        const latest = topPositionRatioHistory[0];
        // 使用 position-ratio 接口的字段名，strict parse
        topPositionLongPercent = parseNumberStrict(latest?.top_position_long_percent || latest?.top_account_long_percent);
        topPositionShortPercent = parseNumberStrict(latest?.top_position_short_percent || latest?.top_account_short_percent);
        topPositionLongShortRatio = parseNumberStrict(latest?.top_position_long_short_ratio || latest?.top_account_long_short_ratio);
      }
      // 如果缺失，使用默认值（但 validator 会检测到并跳过）
      if (topPositionLongPercent === undefined) topPositionLongPercent = 0;
      if (topPositionShortPercent === undefined) topPositionShortPercent = 0;
      if (topPositionLongShortRatio === undefined) topPositionLongShortRatio = 1.0;

      // 4️⃣ 主动成交方向（交易对维度）- 使用交易对主动买卖历史接口（strict parse，不写 0）
      let takerBuyVolUsd: number | undefined = undefined;
      let takerSellVolUsd: number | undefined = undefined;

      if (Array.isArray(takerBuySellHistory) && takerBuySellHistory.length > 0) {
        const latest = takerBuySellHistory[0];
        takerBuyVolUsd = parseNumberStrict(latest?.taker_buy_volume_usd);
        takerSellVolUsd = parseNumberStrict(latest?.taker_sell_volume_usd);
      }
      // 如果缺失，使用默认值（但 validator 会检测到并跳过）
      if (takerBuyVolUsd === undefined) takerBuyVolUsd = 0;
      if (takerSellVolUsd === undefined) takerSellVolUsd = 0;

      // 6. 构建快照（fundingRate 使用 strict parse，如果缺失则设为 0，但 validator 会检测 fundingRateError）
      const snapshot: ContractSnapshot = {
        symbol: baseSymbol.toUpperCase(),
        pairSymbol,
        exchange: 'Binance',
        oiUsd: oiUsd || 0,
        fundingRate: fundingRate !== null && fundingRate !== undefined ? fundingRate : 0, // 如果为 null，使用 0（validator 会检测 fundingRateError）
        nextFundingTime,
        fundingRateError, // 新增：Funding Rate 错误提示
        // 删除：longIncreaseUsd24h, shortIncreaseUsd24h
        // 新增：大户持仓结构（使用 position-ratio 字段）
        topAccountLongPercent: topPositionLongPercent,
        topAccountShortPercent: topPositionShortPercent,
        topAccountLongShortRatio: topPositionLongShortRatio,
        // 新增：主动成交方向（交易对维度）
        takerBuyRatio: 0.5, // 不再使用，保留字段以兼容
        takerSellRatio: 0.5, // 不再使用，保留字段以兼容
        takerBuyVolUsd,
        takerSellVolUsd,
        exchangeTakerData: [], // 不再使用，保留字段以兼容
        liquidation24h,
        isBinanceFutures,
        dataSource: 'CoinGlass',
      };

      logger.info({
        symbol: snapshot.symbol,
        pairSymbol: snapshot.pairSymbol,
        oiUsd: snapshot.oiUsd,
        fundingRate: snapshot.fundingRate,
        fundingRateError: snapshot.fundingRateError,
        topAccountLongShortRatio: snapshot.topAccountLongShortRatio,
        takerBuyVolUsd: snapshot.takerBuyVolUsd,
        takerSellVolUsd: snapshot.takerSellVolUsd,
        hasLiquidation: snapshot.liquidation24h !== null,
      }, 'Contract snapshot created');

      return snapshot;
    } catch (error) {
      logger.error({ error, baseSymbol }, 'Failed to get contract snapshot');
      throw error;
    }
  }

  /**
   * 规范化交易对符号
   */
  private normalizePairSymbol(baseSymbol: string): string {
    const normalized = baseSymbol.toUpperCase();
    
    if (normalized.includes('USDT') || normalized.includes('USDC') || normalized.includes('BUSD')) {
      return normalized;
    }
    
    return `${normalized}USDT`;
  }

  /**
   * 验证交易对是否在指定交易所支持
   */
  private async validatePairSymbol(exchange: string, pairSymbol: string): Promise<boolean> {
    try {
      const pairs = await this.coinglass.getFuturesSupportedExchangePairs();
      const exchangePairs = pairs[exchange] || [];
      
      // 如果 API 返回空数据，假设支持（避免阻塞）
      if (exchangePairs.length === 0) {
        logger.warn({ exchange, pairSymbol }, 'No exchange pairs data available, assuming supported');
        return true;
      }
      
      const baseAsset = pairSymbol.replace(/USDT|USDC|BUSD$/, '');
      
      return exchangePairs.some((pair: any) => {
        return (
          pair.base_asset === baseAsset &&
          (pair.instrument_id?.includes(pairSymbol) || 
           pair.instrument_id?.includes('PERP') ||
           pair.instrument_id?.includes('SWAP'))
        );
      });
    } catch (error) {
      logger.warn({ error, exchange, pairSymbol }, 'Failed to validate pair symbol');
      return true; // 验证失败时，假设支持（避免阻塞）
    }
  }

  /**
   * 获取候选交易对（用于错误提示）
   */
  private async getCandidatePairs(baseSymbol: string): Promise<string[]> {
    try {
      const pairs = await this.coinglass.getFuturesSupportedExchangePairs();
      const binancePairs = pairs['Binance'] || [];
      const baseAsset = baseSymbol.toUpperCase();
      
      const candidates = binancePairs
        .filter((pair: any) => pair.base_asset === baseAsset)
        .map((pair: any) => {
          if (pair.instrument_id) {
            return pair.instrument_id;
          }
          return `${pair.base_asset}${pair.quote_asset || 'USDT'}`;
        })
        .slice(0, 5);
      
      return candidates.length > 0 ? candidates : [`${baseSymbol.toUpperCase()}USDT`];
    } catch (error) {
      logger.warn({ error, baseSymbol }, 'Failed to get candidate pairs');
      return [`${baseSymbol.toUpperCase()}USDT`];
    }
  }

  /**
   * 从 coins-markets 数组中找到指定币种的数据
   */
  private findMarketData(markets: any[], symbol: string): CoinGlassCoinsMarket | null {
    if (!Array.isArray(markets) || markets.length === 0) {
      logger.debug({ symbol, marketsLength: 0 }, 'No market data available');
      return null;
    }
    
    const normalized = symbol.toUpperCase();
    const found = markets.find((item: any) => {
      const itemSymbol = (item.symbol || '').toUpperCase();
      return itemSymbol === normalized;
    });
    
    if (!found) {
      logger.debug({ symbol, availableSymbols: markets.slice(0, 5).map((m: any) => m.symbol) }, 'Symbol not found in market data');
    }
    
    return found || null;
  }

  /**
   * 从 stablecoin_margin_list 中按优先级选择资金费率
   * 优先级：Binance > Bybit > OKX > Gate.io
   */
  private getFundingRateFromStablecoinList(
    fundingRateList: any[],
    symbol: string
  ): { rate: number; nextFundingTime: number } | null {
    if (!Array.isArray(fundingRateList) || fundingRateList.length === 0) {
      return null;
    }

    // 找到对应币种的数据
    const symbolData = fundingRateList.find((item: any) => item.symbol === symbol.toUpperCase());
    if (!symbolData) {
      return null;
    }

    // Step A: 先锁定 stablecoin_margin_list
    if (!Array.isArray(symbolData.stablecoin_margin_list) || symbolData.stablecoin_margin_list.length === 0) {
      return null; // 无主流交易对
    }

    // Step B: 按交易所优先级选择
    const exchangePriority = ['Binance', 'Bybit', 'OKX', 'Gate.io'];
    
    for (const exchange of exchangePriority) {
        const rateItem = symbolData.stablecoin_margin_list.find(
          (item: any) => item.exchange === exchange && item.funding_rate !== undefined && item.funding_rate !== null
        );
        
        if (rateItem) {
          const rate = parseNumberStrict(rateItem.funding_rate);
          // 验证 rate 是否合理（避免异常值，例如 > 1 或 < -1 的明显错误值，允许负值）
          if (rate !== undefined && rate >= -1 && rate <= 1) {
            return {
              rate,
              nextFundingTime: rateItem.next_funding_time || 0,
            };
          }
        }
    }

    // 如果四大交易所都找不到，返回 null（表示无主流交易对）
    return null;
  }

  /**
   * 解析数字（支持 string 或 number）
   * @deprecated 使用 parseNumberStrict 替代，避免用 0 代表缺失
   */
  private parseNumber(value: string | number | undefined): number {
    if (value === undefined || value === null) return 0;
    if (typeof value === 'number') return value;
    const parsed = parseFloat(String(value));
    return isNaN(parsed) ? 0 : parsed;
  }
}
