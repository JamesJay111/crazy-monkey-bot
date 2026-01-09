import { HttpClient } from '../utils/http';
import { LRUCache } from '../utils/cache';
import { RateLimitManager } from '../utils/rateLimit';
import { logger } from '../utils/logger';
import { env } from '../config/env';
import pLimit from 'p-limit';

/**
 * CoinGlass API 客户端（生产级）
 * 支持缓存、限流、重试、错误处理
 */
export class CoinGlassClient {
  private http: HttpClient;
  private cache: LRUCache;
  private rateLimiter: RateLimitManager;
  private limit: ReturnType<typeof pLimit>;

  // 缓存 TTL 常量
  readonly CACHE_TTL = {
    EXCHANGE_LIST: 2 * 60 * 1000, // 2 分钟
    HISTORY: 5 * 60 * 1000, // 5 分钟
    COINS: 24 * 60 * 60 * 1000, // 24 小时
  };

  constructor() {
    this.http = new HttpClient({
      baseURL: env.COINGLASS_BASE_URL || 'https://open-api-v4.coinglass.com',
      apiKey: env.COINGLASS_API_KEY || '',
      timeout: env.COINGLASS_TIMEOUT_MS || 10000,
      maxRetries: env.COINGLASS_MAX_RETRIES || 2,
    });

    this.cache = new LRUCache(1000);
    this.rateLimiter = new RateLimitManager(
      env.COINGLASS_CONCURRENCY || 3,
      env.COINGLASS_RPS || 10,
      env.COINGLASS_BURST || 20
    );

    this.limit = pLimit(env.COINGLASS_CONCURRENCY || 3);
  }

  /**
   * 生成缓存键
   */
  private getCacheKey(endpoint: string, params: any): string {
    const paramStr = JSON.stringify(params || {});
    return `coinglass:${endpoint}:${paramStr}`;
  }

  /**
   * 通用请求方法（带缓存、限流、重试）
   */
  private async request<T>(
    endpoint: string,
    params?: Record<string, any>,
    options?: {
      cacheKey?: string;
      cacheTTL?: number;
    }
  ): Promise<T> {
    const cacheKey = options?.cacheKey || this.getCacheKey(endpoint, params);
    const cacheTTL = options?.cacheTTL || this.CACHE_TTL.HISTORY;

    // 尝试从缓存获取
      const cached = this.cache.get(cacheKey);
    if (cached) {
      logger.debug({ endpoint, cacheKey }, 'Cache hit');
      return cached as T;
    }

    // 限流并执行请求（带并发控制）
    return this.rateLimiter.execute(async () => {
      try {
        const response = await this.http.request<T>(endpoint, params);

      // 存入缓存
        this.cache.set(cacheKey, response, cacheTTL);

        return response;
    } catch (error) {
        logger.error({ error, endpoint, params }, 'CoinGlass API request failed');
        throw error;
      }
    });
  }

  // ========== 基础方法 ==========

  /**
   * 获取支持的币种列表
   */
  async getFuturesSupportedCoins(): Promise<string[]> {
    const cacheKey = this.getCacheKey('/api/futures/supported-coins', {});
    const response = await this.request<any[]>(
      '/api/futures/supported-coins',
      undefined,
      { cacheKey, cacheTTL: this.CACHE_TTL.COINS }
    );
    return Array.isArray(response) ? response : [];
  }

  /**
   * 获取支持的交易所和交易对
   */
  async getFuturesSupportedExchangePairs(): Promise<Record<string, any[]>> {
    const cacheKey = this.getCacheKey('/api/futures/supported-exchange-pairs', {});
    return await this.request<Record<string, any[]>>(
      '/api/futures/supported-exchange-pairs',
      undefined,
      { cacheKey, cacheTTL: this.CACHE_TTL.EXCHANGE_LIST }
    );
  }

  /**
   * 检查币种是否在 Binance Futures 上线
   */
  async isBinanceFutures(symbol: string): Promise<boolean> {
    try {
      const pairs = await this.getFuturesSupportedExchangePairs();
      const binancePairs = pairs['Binance'] || [];
      const normalized = symbol.toUpperCase();
      
      return binancePairs.some((pair: any) => 
        pair.base_asset === normalized && 
        (pair.instrument_id?.includes('PERP') || pair.instrument_id?.includes('SWAP'))
      );
    } catch (error) {
      logger.warn({ error, symbol }, 'Failed to check Binance Futures');
      return false;
    }
  }

  // ========== OI 相关 ==========

  /**
   * 获取 OI 交易所列表
   */
  async getOpenInterestExchangeList(params?: { symbol?: string }): Promise<any[]> {
    try {
      const cacheKey = this.getCacheKey('/api/futures/openInterest/exchange-list', params);
      const response = await this.request<any>(
          '/api/futures/openInterest/exchange-list',
          params,
        { cacheKey, cacheTTL: this.CACHE_TTL.EXCHANGE_LIST }
      );
      
      if (Array.isArray(response)) {
        return response;
      }
      if (response && Array.isArray(response.data)) {
        return response.data;
      }
      return [];
    } catch (error: any) {
      // 如果端点不存在（404），尝试使用 pairs-markets 作为 fallback
      if (error?.statusCode === 404 || error?.response?.status === 404) {
        logger.debug({ symbol: params?.symbol }, 'OI exchange-list endpoint not found, using pairs-markets fallback');
        try {
          const pairs = await this.getFuturesPairsMarkets({
            exchange: 'Binance',
            symbol: params?.symbol,
          });
          // 将 pairs-markets 数据转换为 exchange-list 格式
          return pairs.map(pair => ({
            exchange: pair.exchange_name || 'Binance',
            symbol: pair.symbol || params?.symbol,
            open_interest_usd: pair.open_interest_usd,
            open_interest: pair.open_interest,
          }));
        } catch (fallbackError) {
          logger.warn({ error: fallbackError, symbol: params?.symbol }, 'Fallback to pairs-markets also failed');
          return [];
        }
      }
      logger.warn({ error, symbol: params?.symbol }, 'Failed to get OI exchange list');
      return [];
    }
  }

  /**
   * 获取 OI 历史 OHLC
   */
  async getOpenInterestOhlcHistory(params: {
    symbol: string;
    exchange?: string;
    interval?: string;
    limit?: number;
  }): Promise<any[]> {
    try {
      const cacheKey = this.getCacheKey('/api/futures/openInterest/ohlc-history', params);
      const response = await this.request<any>(
        '/api/futures/openInterest/ohlc-history',
        {
          symbol: params.symbol.toUpperCase(),
          exchange: params.exchange,
          interval: params.interval || '4h',
          limit: params.limit || 100,
        },
        { cacheKey, cacheTTL: this.CACHE_TTL.HISTORY }
      );
      
      if (Array.isArray(response)) {
        return response;
      }
      if (response && Array.isArray(response.data)) {
        return response.data;
      }
      return [];
    } catch (error: any) {
      // 如果端点不存在（404），返回空数组（已在 binanceOILarkAlert.service.ts 中使用 fallback 逻辑）
      if (error?.statusCode === 404 || error?.response?.status === 404) {
        logger.debug({ symbol: params.symbol, exchange: params.exchange }, 'OI ohlc-history endpoint not found, returning empty array (fallback logic will be used)');
        return [];
      }
      logger.warn({ error, symbol: params.symbol }, 'Failed to get OI ohlc history');
      return [];
    }
  }

  // ========== Funding Rate 相关 ==========

  /**
   * 获取 Funding Rate 交易所列表
   */
  async getFundingRateExchangeList(symbol?: string): Promise<any> {
    try {
      const params = symbol ? { symbol: symbol.toUpperCase() } : undefined;
      const cacheKey = this.getCacheKey('/api/futures/funding-rate/exchange-list', params);
      const response = await this.request<any>(
        '/api/futures/funding-rate/exchange-list',
        params,
        { cacheKey, cacheTTL: this.CACHE_TTL.EXCHANGE_LIST }
      );
      
      // 处理响应格式
      if (Array.isArray(response)) {
        return response;
      }
      if (response && Array.isArray(response.data)) {
        return response.data;
      }
      if (response && typeof response === 'object') {
        return response;
      }
      return response;
    } catch (error: any) {
      // 如果端点不存在（404），尝试使用 pairs-markets 作为 fallback
      if (error?.statusCode === 404 || error?.response?.status === 404) {
        logger.debug({ symbol }, 'Funding rate exchange-list endpoint not found, using pairs-markets fallback');
        try {
          const pairs = await this.getFuturesPairsMarkets({
            exchange: 'Binance',
            symbol: symbol,
          });
          // 将 pairs-markets 数据转换为 funding-rate 格式
          return pairs.map(pair => ({
            exchange: pair.exchange_name || 'Binance',
            symbol: pair.symbol || symbol,
            funding_rate: pair.funding_rate,
            next_funding_time: pair.next_funding_time,
          }));
        } catch (fallbackError) {
          logger.warn({ error: fallbackError, symbol }, 'Fallback to pairs-markets also failed');
          return [];
        }
      }
      logger.warn({ error, symbol }, 'Failed to get funding rate exchange list');
      return [];
    }
  }

  /**
   * 获取累计资金费率交易所列表
   * GET /api/futures/funding-rate/accumulated-exchange-list
   */
  async getAccumulatedFundingRateExchangeList(symbol?: string): Promise<any> {
    try {
      const params = symbol ? { symbol: symbol.toUpperCase() } : undefined;
      const cacheKey = this.getCacheKey('/api/futures/funding-rate/accumulated-exchange-list', params);
      return await this.request<any>(
        '/api/futures/funding-rate/accumulated-exchange-list',
        params,
        { cacheKey, cacheTTL: this.CACHE_TTL.EXCHANGE_LIST }
      );
    } catch (error) {
      logger.warn({ error, symbol }, 'accumulated-exchange-list endpoint may not exist, falling back to exchange-list');
      // Fallback: 尝试从 exchange-list 获取（如果累计端点不存在）
      return await this.getFundingRateExchangeList(symbol);
    }
  }

  /**
   * 获取 Funding Rate 历史 OHLC
   */
  async getFundingRateOhlcHistory(params: {
    symbol: string;
    exchange?: string;
    interval?: string;
    limit?: number;
  }): Promise<any[]> {
    const cacheKey = this.getCacheKey('/api/futures/funding-rate/ohlc-history', params);
    const response = await this.request<any>(
      '/api/futures/funding-rate/ohlc-history',
      {
        symbol: params.symbol.toUpperCase(),
        exchange: params.exchange,
        interval: params.interval || '4h',
        limit: params.limit || 100,
      },
      { cacheKey, cacheTTL: this.CACHE_TTL.HISTORY }
    );
    
    if (Array.isArray(response)) {
      return response;
    }
    if (response && Array.isArray(response.data)) {
      return response.data;
    }
    return [];
  }

  // ========== 持仓多空比相关 ==========

  /**
   * 获取大户持仓多空比历史
   */
  async getTopLongShortPositionRatioHistory(params: {
    exchange: string;
    symbol: string;
    interval?: string;
    limit?: number;
  }): Promise<any[]> {
    const cacheKey = this.getCacheKey('/api/futures/top-long-short-account-ratio/history', params);
    const response = await this.request<any>(
      '/api/futures/top-long-short-account-ratio/history',
      {
        exchange: params.exchange,
      symbol: params.symbol.toUpperCase(),
        interval: params.interval || '4h',
        limit: params.limit || 100,
      },
      { cacheKey, cacheTTL: this.CACHE_TTL.HISTORY }
    );
    
    if (Array.isArray(response)) {
      return response;
    }
    if (response && Array.isArray(response.data)) {
      return response.data;
    }
    return [];
  }

  /**
   * 获取全网账户多空比历史（兼容性方法）
   */
  async getGlobalLongShortRatioHistory(
    symbol: string,
    interval: string = '1h',
    limit: number = 720
  ): Promise<any[]> {
    const params = { symbol, interval, limit };
    const cacheKey = this.getCacheKey('/api/futures/global-long-short-account-ratio/history', params);
    const response = await this.request<any>(
      '/api/futures/global-long-short-account-ratio/history',
      {
        symbol: symbol.toUpperCase(),
        interval,
        limit,
      },
      { cacheKey, cacheTTL: this.CACHE_TTL.HISTORY }
    );
    
    if (Array.isArray(response)) {
      return response;
    }
    if (response && Array.isArray(response.data)) {
      return response.data;
    }
    return [];
  }

  // ========== Taker 相关 ==========

  /**
   * 获取 Taker 买卖量历史
   */
  async getTakerBuySellVolumeHistory(params: {
    exchange: string;
    symbol: string;
    interval?: string;
    limit?: number;
  }): Promise<any[]> {
    const cacheKey = this.getCacheKey('/api/futures/taker-buy-sell-volume/history', params);
    const response = await this.request<any>(
      '/api/futures/taker-buy-sell-volume/history',
      {
        exchange: params.exchange,
        symbol: params.symbol.toUpperCase(),
        interval: params.interval || '4h',
        limit: params.limit || 100,
      },
      { cacheKey, cacheTTL: this.CACHE_TTL.HISTORY }
    );
    
    if (Array.isArray(response)) {
      return response;
    }
    if (response && Array.isArray(response.data)) {
      return response.data;
    }
    return [];
  }

  // ========== 爆仓相关 ==========

  /**
   * 获取爆仓历史
   */
  async getLiquidationHistory(params: {
    exchange: string;
    symbol: string;
    interval?: string;
    limit?: number;
  }): Promise<any[]> {
    const cacheKey = this.getCacheKey('/api/futures/liquidation/history', params);
    const response = await this.request<any>(
      '/api/futures/liquidation/history',
      {
        exchange: params.exchange,
        symbol: params.symbol.toUpperCase(),
        interval: params.interval || '1h',
        limit: params.limit || 100,
      },
      { cacheKey, cacheTTL: this.CACHE_TTL.HISTORY }
    );
    
    if (Array.isArray(response)) {
      return response;
    }
    if (response && Array.isArray(response.data)) {
      return response.data;
    }
    return [];
  }

  // ========== ETF 相关 ==========

  /**
   * 获取 BTC ETF 资金流历史
   */
  async getBTCETFFlowHistory(days: number = 30): Promise<any[]> {
    return this.getBtcEtfFlowHistory({ days });
  }

  /**
   * 通用 ETF 资金流历史方法（支持所有币种）
   */
  async getETFHistory(symbol: 'BTC' | 'ETH' | 'SOL' | 'XRP', days: number = 30): Promise<any[]> {
    switch (symbol.toUpperCase()) {
      case 'BTC':
        return this.getBtcEtfFlowHistory({ days });
      case 'ETH':
        return this.getEthEtfFlowHistory({ days });
      case 'SOL':
        return this.getSolEtfFlowHistory({ days });
      case 'XRP':
        return this.getXrpEtfFlowHistory({ days });
      default:
        logger.warn({ symbol }, 'Unsupported ETF symbol');
        return [];
    }
  }

  /**
   * 获取 BTC ETF 资金流历史（CoinGlass v4 格式）
   */
  async getBtcEtfFlowHistory(params: { days?: number }): Promise<any[]> {
    const cacheKey = this.getCacheKey('/api/etf/bitcoin/flow-history', params);
    const response = await this.request<any>(
      '/api/etf/bitcoin/flow-history',
      { days: params.days || 30 },
      { cacheKey, cacheTTL: this.CACHE_TTL.HISTORY }
    );
    
    if (Array.isArray(response)) {
      return response;
    }
    if (response && Array.isArray(response.data)) {
      return response.data;
    }
    return [];
  }

  /**
   * 获取 ETH ETF 资金流历史
   */
  async getETFETFFlowHistory(days: number = 30): Promise<any[]> {
    return this.getEthEtfFlowHistory({ days });
  }

  /**
   * 获取 ETH ETF 资金流历史（CoinGlass v4 格式）
   */
  async getEthEtfFlowHistory(params: { days?: number }): Promise<any[]> {
    const cacheKey = this.getCacheKey('/api/etf/ethereum/flow-history', params);
    const response = await this.request<any>(
      '/api/etf/ethereum/flow-history',
      { days: params.days || 30 },
      { cacheKey, cacheTTL: this.CACHE_TTL.HISTORY }
    );
    
    if (Array.isArray(response)) {
      return response;
    }
    if (response && Array.isArray(response.data)) {
      return response.data;
    }
    return [];
  }

  /**
   * 获取 SOL ETF 资金流历史
   */
  async getSOLETFFlowHistory(days: number = 30): Promise<any[]> {
    return this.getSolEtfFlowHistory({ days });
  }

  /**
   * 获取 SOL ETF 资金流历史（CoinGlass v4 格式）
   */
  async getSolEtfFlowHistory(params: { days?: number }): Promise<any[]> {
    const cacheKey = this.getCacheKey('/api/etf/solana/flow-history', params);
    const response = await this.request<any>(
        '/api/etf/solana/flow-history',
      { days: params.days || 30 },
      { cacheKey, cacheTTL: this.CACHE_TTL.HISTORY }
    );
    
    if (Array.isArray(response)) {
      return response;
    }
    if (response && Array.isArray(response.data)) {
      return response.data;
    }
      return [];
    }

  /**
   * 获取 XRP ETF 资金流历史
   */
  async getXRPETFFlowHistory(days: number = 30): Promise<any[]> {
    return this.getXrpEtfFlowHistory({ days });
  }

  /**
   * 获取 XRP ETF 资金流历史（CoinGlass v4 格式）
   */
  async getXrpEtfFlowHistory(params: { days?: number }): Promise<any[]> {
    const cacheKey = this.getCacheKey('/api/etf/xrp/flow-history', params);
    const response = await this.request<any>(
      '/api/etf/xrp/flow-history',
      { days: params.days || 30 },
      { cacheKey, cacheTTL: this.CACHE_TTL.HISTORY }
    );
    
    if (Array.isArray(response)) {
      return response;
    }
    if (response && Array.isArray(response.data)) {
      return response.data;
    }
    return [];
  }

  // ========== 基差相关 ==========

  /**
   * 获取基差历史
   */
  async getBasisHistory(params: {
    symbol: string;
    exchange?: string;
    interval?: string;
    limit?: number;
  }): Promise<any[]> {
    const cacheKey = this.getCacheKey('/api/futures/basis/history', params);
    const response = await this.request<any>(
      '/api/futures/basis/history',
      {
        symbol: params.symbol.toUpperCase(),
        exchange: params.exchange,
        interval: params.interval || '1h',
        limit: params.limit || 100,
      },
      { cacheKey, cacheTTL: this.CACHE_TTL.HISTORY }
    );
    
    if (Array.isArray(response)) {
      return response;
    }
    if (response && Array.isArray(response.data)) {
      return response.data;
    }
    return [];
  }

  // ========== 限流状态 ==========

  /**
   * 获取限流状态
   */
  getRateLimitStatus() {
    return this.rateLimiter.getStatus ? this.rateLimiter.getStatus() : { maxLimit: null, useLimit: null };
  }

  /**
   * 12. 获取 Futures 交易对市场列表（CoinGlass v4 文档对齐）
   * GET /api/futures/pairs-markets
   * 
   * 可选查询参数：
   * - exchange: 交易所名称（如 Binance）
   * - symbol: 币种符号（如 BTC）
   * - limit: 返回数量限制
   * 
   * 返回格式：{ code: "0", msg: "success", data: [...] }
   * 
   * 返回字段（严格对齐文档）：
   * - instrument_id: 合约交易对（如 BTCUSDT）
   * - exchange_name: 交易所名称（如 Binance）
   * - symbol: 币种对（如 BTC/USDT）
   * - open_interest_usd: 未平仓合约价值 USD
   * - funding_rate: 当前资金费率
   * - current_price: 当前价格
   * - volume_usd: 24小时交易量(USD)
   * - long_liquidation_usd_24h: 近24小时多单爆仓金额(USD)
   * - short_liquidation_usd_24h: 近24小时空单爆仓金额(USD)
   */
  async getFuturesPairsMarkets(params?: {
    exchange?: string;
    symbol?: string;
    limit?: number;
  }): Promise<any[]> {
    try {
      const requestParams: Record<string, string | number> = {};
      if (params?.exchange) {
        requestParams.exchange = params.exchange;
      }
      if (params?.symbol) {
        requestParams.symbol = params.symbol.toUpperCase();
      }
      if (params?.limit) {
        requestParams.limit = params.limit;
      }

      const cacheKey = this.getCacheKey('/api/futures/pairs-markets', requestParams);
      const response = await this.request<any>(
        '/api/futures/pairs-markets',
        Object.keys(requestParams).length > 0 ? requestParams : undefined,
      {
        cacheKey,
        cacheTTL: this.CACHE_TTL.EXCHANGE_LIST,
      }
    );

      // 处理响应格式：{ code: "0", msg: "success", data: [...] }
      if (response && typeof response === 'object' && !Array.isArray(response)) {
        // 检查 code 字段，如果不是 "0" 表示失败
        const code = response.code;
        if (code !== undefined && code !== "0" && code !== 0 && code !== "400") {
          logger.warn({ 
            code: response.code, 
            msg: response.msg,
            endpoint: 'pairs-markets',
            params
          }, 'API returned error code');
          return [];
        }
        
        // 如果响应有 data 字段，提取 data
        if (Array.isArray(response.data)) {
          logger.debug({ 
            count: response.data.length,
            params 
          }, 'pairs-markets data extracted successfully');
          return response.data;
        }
        
        // 如果 data 字段不存在或不是数组，返回空数组
        logger.warn({ 
          code: response.code,
          msg: response.msg,
          hasData: 'data' in response,
          dataType: response.data ? typeof response.data : 'undefined',
          params
        }, 'pairs-markets response missing data array');
        return [];
      }

      // 如果响应本身就是数组，直接返回（向后兼容）
      if (Array.isArray(response)) {
        logger.debug({ count: response.length }, 'pairs-markets response is array');
        return response;
      }

      logger.warn({ 
        responseType: typeof response,
        responseKeys: response && typeof response === 'object' ? Object.keys(response) : 'N/A',
        params
      }, 'Unexpected pairs-markets response format');
      return [];
    } catch (error: any) {
      // 如果是限流错误（400 Too Many Requests），记录但不抛出
      if (error.statusCode === 400 || error.statusCode === 429) {
        logger.warn({ 
          error: error.errorMessage || error.message,
          statusCode: error.statusCode,
          params
        }, 'pairs-markets rate limited');
        return [];
      }
      logger.warn({ error: error.message || error, params }, 'pairs-markets endpoint request failed');
      return [];
    }
  }

  /**
   * 13. 获取 Open Interest 历史（CoinGlass v4 文档对齐）
   * GET /api/futures/open-interest/history
   * 
   * 返回字段（严格对齐文档）：
   * - time: 时间戳（ms）
   * - open, high, low, close: 字符串形式的 OHLC
   * 
   * @param params 请求参数
   * @param params.symbol 币种符号（如 BTC）或交易对（如 BTCUSDT）
   * @param params.exchange 可选，交易所（如 Binance）
   * @param params.interval 时间间隔（如 4h）
   * @param params.limit 返回条数（默认2，用于计算4h增量）
   * @param params.unit 单位（usd 或 btc）
   */
  async getOpenInterestHistory(params: {
    symbol: string;
    exchange?: string;
    interval?: string;
    limit?: number;
    unit?: string;
  }): Promise<Array<{ time: number; open: string; high: string; low: string; close: string }>> {
    try {
      const cacheKey = this.getCacheKey('/api/futures/open-interest/history', params);
    const requestParams: Record<string, string | number> = {
      symbol: params.symbol.toUpperCase(),
        interval: params.interval || '4h',
        limit: params.limit || 2,
      };
      
      if (params.exchange) {
        requestParams.exchange = params.exchange;
      }
      
      if (params.unit) {
        requestParams.unit = params.unit;
      }

      const response = await this.request<any>(
        '/api/futures/open-interest/history',
        requestParams,
        {
          cacheKey,
          cacheTTL: this.CACHE_TTL.HISTORY,
        }
      );

      // 确保返回数组格式
      if (Array.isArray(response)) {
        return response;
      }
      
      // 如果返回的是 { data: [...] } 格式，提取 data
      if (response && Array.isArray(response.data)) {
        return response.data;
      }

      return [];
    } catch (error) {
      logger.warn({ error, params }, 'open-interest/history endpoint may not exist or failed');
      return [];
    }
  }

  // ========== 宏观事件相关 ==========

  /**
   * 获取宏观事件日历（经济数据/财经日历/央行动态）
   * @param params.start_time 开始时间（秒级时间戳）
   * @param params.end_time 结束时间（秒级时间戳）
   */
  /**
   * 获取宏观事件（经济数据、财经事件、央行动态）
   * 
   * API 端点：
   * - GET /api/calendar/economic-data
   * - GET /api/calendar/financial-events
   * - GET /api/calendar/central-bank-activities
   * 
   * 文档：
   * - https://docs.coinglass.com/v4.0-zh/reference/economic-data
   * - https://docs.coinglass.com/v4.0-zh/reference/financial-events
   * - https://docs.coinglass.com/v4.0-zh/reference/central-bank-activities
   * 
   * CoinGlass API 字段映射：
   * - event_id (API) -> event_id (内部)
   * - event_name (API) -> event_name / calendar_name (内部)
   * - country_code (API) -> country_code (内部)
   * - publish_time_utc (API) -> publish_time_utc_ms (内部，统一转换为毫秒级)
   * - importance_level (API) -> importance_level (内部，1-3，3为最高)
   * - status (API) -> status (内部，"UPCOMING" 或 "RELEASED")
   * - forecast_value (API) -> forecast_value (内部)
   * - previous_value (API) -> previous_value (内部)
   * - published_value (API) -> published_value (内部)
   * 
   * ⚠️ 重要：CoinGlass API v4.0 要求使用毫秒级时间戳（13位数字），不是秒级
   * 
   * 详细字段映射文档：docs/COINGLASS_FIELD_MAPPING.md
   * 实现文档：docs/MACRO_NEWS_IMPLEMENTATION.md
   */
  async getMacroEvents(params: {
    start_time: number; // 毫秒级时间戳（CoinGlass v4.0 API 要求）
    end_time: number; // 毫秒级时间戳（CoinGlass v4.0 API 要求）
  }): Promise<Array<{
    calendar_name: string;
    country_code: string;
    country_name?: string;
    publish_timestamp: number;
    importance_level: number;
    has_exact_publish_time: number;
    forecast_value?: string;
    previous_value?: string;
    published_value?: string;
    revised_previous_value?: string;
    data_effect?: string;
  }>> {
    // v4.0 新端点（根据文档：https://docs.coinglass.com/v4.0-zh/reference/economic-data）
    const v4Endpoints = [
      '/api/calendar/economic-data',        // 经济数据
      '/api/calendar/financial-events',     // 财经事件
      '/api/calendar/central-bank-activities', // 央行动态
    ];

    const allEvents: any[] = [];
    const requestParams = {
      start_time: params.start_time,
      end_time: params.end_time,
    };

    // 尝试从所有 v4.0 端点获取数据并合并
    for (const endpoint of v4Endpoints) {
      try {
        const cacheKey = this.getCacheKey(endpoint, requestParams);
        const response = await this.request<any>(
          endpoint,
          requestParams,
          {
            cacheKey,
            cacheTTL: 5 * 60 * 1000, // 5分钟缓存
          }
        );

        // 处理响应格式：{ code: "0", data: [...] }
        if (response && response.code === '0' && Array.isArray(response.data)) {
          logger.info({ endpoint, dataCount: response.data.length }, 'Successfully fetched macro events from v4.0 endpoint');
          allEvents.push(...response.data);
          continue;
        }

        // 如果直接返回数组
        if (Array.isArray(response)) {
          logger.info({ endpoint, dataCount: response.length }, 'Successfully fetched macro events (array format) from v4.0 endpoint');
          allEvents.push(...response);
          continue;
        }

        logger.debug({ endpoint, response }, 'Unexpected response format from v4.0 endpoint');
      } catch (error: any) {
        // 如果是 404，记录但继续尝试其他端点
        if (error?.statusCode === 404 || error?.response?.status === 404) {
          logger.debug({ endpoint }, 'v4.0 endpoint not found (404), trying next');
          continue;
        }
        // 其他错误记录但继续尝试
        logger.warn({ endpoint, error: error?.statusCode || error?.message }, 'Failed to fetch from v4.0 endpoint, trying next');
      }
    }

    // 如果从 v4.0 端点获取到数据，返回合并结果
    if (allEvents.length > 0) {
      logger.info({ totalEvents: allEvents.length, endpoints: v4Endpoints }, 'Successfully fetched macro events from v4.0 endpoints');
      return allEvents;
    }

    // Fallback: 尝试旧端点（向后兼容）
    const legacyEndpoints = [
      '/api/macro/calendar',
      '/api/economic-calendar',
      '/api/macro/economic-calendar',
      '/api/calendar',
      '/api/macro-events',
      '/api/v1/macro/calendar',
    ];

    for (const endpoint of legacyEndpoints) {
      try {
        const cacheKey = this.getCacheKey(endpoint, requestParams);
        const response = await this.request<any>(
          endpoint,
          requestParams,
          {
            cacheKey,
            cacheTTL: 5 * 60 * 1000, // 5分钟缓存
          }
        );

        // 处理响应格式：{ code: "0", data: [...] }
        if (response && response.code === '0' && Array.isArray(response.data)) {
          logger.info({ endpoint, dataCount: response.data.length }, 'Successfully fetched macro events from legacy endpoint');
          return response.data;
        }

        // 如果直接返回数组
        if (Array.isArray(response)) {
          logger.info({ endpoint, dataCount: response.length }, 'Successfully fetched macro events (array format) from legacy endpoint');
          return response;
        }

        logger.debug({ endpoint, response }, 'Unexpected response format, trying next endpoint');
      } catch (error: any) {
        // 如果是 404，尝试下一个端点
        if (error?.statusCode === 404 || error?.response?.status === 404) {
          logger.debug({ endpoint }, 'Endpoint not found (404), trying next');
          continue;
        }
        // 其他错误记录但继续尝试
        logger.warn({ endpoint, error: error?.statusCode || error?.message }, 'Failed to fetch from endpoint, trying next');
      }
    }

    logger.error({ params, triedEndpoints: [...v4Endpoints, ...legacyEndpoints] }, 'All macro event endpoints failed');
    return [];
  }

  /**
   * 获取新闻文章列表
   * GET /api/article/list
   * 根据文档：https://docs.coinglass.com/v4.0-zh/reference/article-list
   * 
   * CoinGlass API 字段映射：
   * - article_id (API) -> article_id / id (内部)
   * - article_title (API) -> article_title / title (内部)
   * - article_content (API) -> article_content / content (内部)
   * - article_release_time (API) -> article_release_time / publish_time (内部，毫秒级时间戳)
   * - source_name (API) -> source_name / source (内部)
   * 
   * 详细字段映射文档：docs/COINGLASS_FIELD_MAPPING.md
   */
  async getArticleList(params?: {
    start_time?: number; // 毫秒级时间戳
    end_time?: number; // 毫秒级时间戳
    limit?: number;
  }): Promise<Array<{
    article_id?: string;
    article_title?: string; // API 返回的是 article_title
    article_content?: string; // API 返回的是 article_content
    article_release_time?: number; // API 返回的是 article_release_time
    title?: string;
    content?: string;
    publish_time?: number;
    url?: string;
    source?: string;
    source_name?: string; // API 返回的是 source_name
  }>> {
    try {
      const requestParams: Record<string, any> = {};
      if (params?.start_time) {
        requestParams.start_time = params.start_time;
      }
      if (params?.end_time) {
        requestParams.end_time = params.end_time;
      }
      if (params?.limit) {
        requestParams.limit = params.limit;
      }

      const cacheKey = this.getCacheKey('/api/article/list', requestParams);
      const response = await this.request<any>(
        '/api/article/list',
        Object.keys(requestParams).length > 0 ? requestParams : undefined,
        {
          cacheKey,
          cacheTTL: 5 * 60 * 1000, // 5分钟缓存
        }
      );

      // 处理响应格式：{ code: "0", data: [...] }
      if (response && response.code === '0' && Array.isArray(response.data)) {
        logger.info({ dataCount: response.data.length }, 'Successfully fetched article list');
        // 转换字段名以匹配我们的接口
        return response.data.map((item: any) => ({
          article_id: item.article_id || item.id,
          article_title: item.article_title,
          article_content: item.article_content,
          article_release_time: item.article_release_time,
          title: item.article_title || item.title,
          content: item.article_content || item.content,
          publish_time: item.article_release_time || item.publish_time,
          url: item.url,
          source: item.source_name || item.source,
          source_name: item.source_name,
        }));
      }

      // 如果直接返回数组
      if (Array.isArray(response)) {
        logger.info({ dataCount: response.length }, 'Successfully fetched article list (array format)');
        return response.map((item: any) => ({
          article_id: item.article_id || item.id,
          article_title: item.article_title,
          article_content: item.article_content,
          article_release_time: item.article_release_time,
          title: item.article_title || item.title,
          content: item.article_content || item.content,
          publish_time: item.article_release_time || item.publish_time,
          url: item.url,
          source: item.source_name || item.source,
          source_name: item.source_name,
        }));
      }

      logger.warn({ response }, 'Unexpected article list response format');
      return [];
    } catch (error: any) {
      if (error?.statusCode === 404 || error?.response?.status === 404) {
        logger.debug('Article list endpoint not found (404)');
      } else {
        logger.warn({ error: error?.statusCode || error?.message }, 'Failed to fetch article list');
      }
      return [];
    }
  }

  /**
   * 获取快讯列表
   * GET /api/newsflash/list
   * 根据文档：https://docs.coinglass.com/v4.0-zh/reference/newsflash-list
   * 
   * CoinGlass API 字段映射：
   * - newsflash_id (API) -> newsflash_id / id (内部)
   * - newsflash_title (API) -> newsflash_title / title (内部)
   * - newsflash_content (API) -> newsflash_content / content (内部)
   * - newsflash_release_time (API) -> newsflash_release_time / publish_time (内部，毫秒级时间戳)
   * - source_name (API) -> source_name / source (内部)
   * 
   * 详细字段映射文档：docs/COINGLASS_FIELD_MAPPING.md
   */
  async getNewsflashList(params?: {
    start_time?: number; // 毫秒级时间戳
    end_time?: number; // 毫秒级时间戳
    limit?: number;
  }): Promise<Array<{
    newsflash_id?: string;
    newsflash_title?: string; // API 返回的是 newsflash_title
    newsflash_content?: string; // API 返回的是 newsflash_content
    newsflash_release_time?: number; // API 返回的是 newsflash_release_time
    title?: string;
    content?: string;
    publish_time?: number;
    url?: string;
    source?: string;
    source_name?: string; // API 返回的是 source_name
  }>> {
    try {
      const requestParams: Record<string, any> = {};
      if (params?.start_time) {
        requestParams.start_time = params.start_time;
      }
      if (params?.end_time) {
        requestParams.end_time = params.end_time;
      }
      if (params?.limit) {
        requestParams.limit = params.limit;
      }

      const cacheKey = this.getCacheKey('/api/newsflash/list', requestParams);
      const response = await this.request<any>(
        '/api/newsflash/list',
        Object.keys(requestParams).length > 0 ? requestParams : undefined,
        {
          cacheKey,
          cacheTTL: 5 * 60 * 1000, // 5分钟缓存
        }
      );

      // 处理响应格式：{ code: "0", data: [...] }
      if (response && response.code === '0' && Array.isArray(response.data)) {
        logger.info({ dataCount: response.data.length }, 'Successfully fetched newsflash list');
        // 转换字段名以匹配我们的接口
        return response.data.map((item: any) => ({
          newsflash_id: item.newsflash_id || item.id,
          newsflash_title: item.newsflash_title,
          newsflash_content: item.newsflash_content,
          newsflash_release_time: item.newsflash_release_time,
          title: item.newsflash_title || item.title,
          content: item.newsflash_content || item.content,
          publish_time: item.newsflash_release_time || item.publish_time,
          url: item.url,
          source: item.source_name || item.source,
          source_name: item.source_name,
        }));
      }

      // 如果直接返回数组
      if (Array.isArray(response)) {
        logger.info({ dataCount: response.length }, 'Successfully fetched newsflash list (array format)');
        return response.map((item: any) => ({
          newsflash_id: item.newsflash_id || item.id,
          newsflash_title: item.newsflash_title,
          newsflash_content: item.newsflash_content,
          newsflash_release_time: item.newsflash_release_time,
          title: item.newsflash_title || item.title,
          content: item.newsflash_content || item.content,
          publish_time: item.newsflash_release_time || item.publish_time,
          url: item.url,
          source: item.source_name || item.source,
          source_name: item.source_name,
        }));
      }

      logger.warn({ response }, 'Unexpected newsflash list response format');
      return [];
    } catch (error: any) {
      if (error?.statusCode === 404 || error?.response?.status === 404) {
        logger.debug('Newsflash list endpoint not found (404)');
      } else {
        logger.warn({ error: error?.statusCode || error?.message }, 'Failed to fetch newsflash list');
      }
      return [];
    }
  }
}
