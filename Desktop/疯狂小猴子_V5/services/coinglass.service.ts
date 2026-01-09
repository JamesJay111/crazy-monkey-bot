import axios, { AxiosInstance } from 'axios';

/**
 * CoinGlass API 服务
 * 所有合约数据必须来自此服务
 */
export class CoinGlassService {
  private api: AxiosInstance;
  private apiKey: string;

  constructor(apiKey: string, baseURL: string = 'https://open-api.coinglass.com/public/v2') {
    this.apiKey = apiKey;
    this.api = axios.create({
      baseURL,
      headers: {
        'coinglassSecret': apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });
  }

  /**
   * 获取历史 OHLC 数据
   * @param symbol 交易对符号 (BTC, ETH, etc.)
   * @param interval 时间间隔 (1h, 4h, 1d)
   * @param limit 数据条数
   */
  async getOHLCHistory(
    symbol: string,
    interval: string = '1h',
    limit: number = 720 // 30天 * 24小时
  ): Promise<any[]> {
    try {
      const response = await this.api.get('/fr_ohlc_history', {
        params: {
          symbol: symbol.toUpperCase(),
          interval,
          limit,
        },
      });
      return response.data?.data || [];
    } catch (error: any) {
      console.error(`CoinGlass OHLC Error for ${symbol}:`, error.message);
      throw new Error(`无法获取 ${symbol} 的 OHLC 数据: ${error.message}`);
    }
  }

  /**
   * 获取 Open Interest 历史数据
   */
  async getOIHistory(
    symbol: string,
    limit: number = 720
  ): Promise<any[]> {
    try {
      const response = await this.api.get('/indicator/long_short_account', {
        params: {
          symbol: symbol.toUpperCase(),
          limit,
        },
      });
      return response.data?.data || [];
    } catch (error: any) {
      console.error(`CoinGlass OI Error for ${symbol}:`, error.message);
      throw new Error(`无法获取 ${symbol} 的 OI 数据: ${error.message}`);
    }
  }

  /**
   * 获取当前资金费率
   */
  async getFundingRates(): Promise<any[]> {
    try {
      const response = await this.api.get('/indicator/funding_rate', {
        params: {
          limit: 500, // 获取前500个项目
        },
      });
      return response.data?.data || [];
    } catch (error: any) {
      console.error('CoinGlass Funding Rate Error:', error.message);
      throw new Error(`无法获取资金费率数据: ${error.message}`);
    }
  }

  /**
   * 获取多空比数据
   */
  async getLongShortRatio(symbol: string): Promise<any> {
    try {
      const response = await this.api.get('/indicator/long_short_account', {
        params: {
          symbol: symbol.toUpperCase(),
        },
      });
      return response.data?.data || null;
    } catch (error: any) {
      console.error(`CoinGlass Long/Short Ratio Error for ${symbol}:`, error.message);
      throw new Error(`无法获取 ${symbol} 的多空比数据: ${error.message}`);
    }
  }

  /**
   * 获取 ETF 资金流数据
   */
  async getETFData(symbol: 'BTC' | 'ETH' | 'SOL'): Promise<any> {
    try {
      const response = await this.api.get('/etf', {
        params: {
          symbol: symbol.toUpperCase(),
        },
      });
      return response.data?.data || null;
    } catch (error: any) {
      console.error(`CoinGlass ETF Error for ${symbol}:`, error.message);
      throw new Error(`无法获取 ${symbol} 的 ETF 数据: ${error.message}`);
    }
  }

  /**
   * 获取 ETF 历史数据（30天）
   */
  async getETFHistory(symbol: 'BTC' | 'ETH' | 'SOL', days: number = 30): Promise<any[]> {
    try {
      const response = await this.api.get('/etf/history', {
        params: {
          symbol: symbol.toUpperCase(),
          days,
        },
      });
      return response.data?.data || [];
    } catch (error: any) {
      console.error(`CoinGlass ETF History Error for ${symbol}:`, error.message);
      throw new Error(`无法获取 ${symbol} 的 ETF 历史数据: ${error.message}`);
    }
  }

  /**
   * 获取指定 Ticker 的完整合约数据
   */
  async getTickerData(symbol: string): Promise<any> {
    try {
      const [funding, longShort, oi] = await Promise.all([
        this.getFundingRates().then(rates => 
          rates.find((r: any) => r.symbol === symbol.toUpperCase())
        ),
        this.getLongShortRatio(symbol),
        this.getOIHistory(symbol, 1).then(data => data[0] || null),
      ]);

      // 获取价格数据（从 OHLC 最新数据）
      const ohlc = await this.getOHLCHistory(symbol, '1h', 1);
      const latestPrice = ohlc[0]?.close || null;

      return {
        symbol: symbol.toUpperCase(),
        price: latestPrice,
        fundingRate: funding?.fundingRate || null,
        longShortRatio: longShort?.longRate / longShort?.shortRate || null,
        oi: oi?.value || null,
        oiChange24h: oi?.change || null,
        longRate: longShort?.longRate || null,
        shortRate: longShort?.shortRate || null,
        isBinanceFutures: true, // 需要根据实际 API 返回判断
      };
    } catch (error: any) {
      console.error(`CoinGlass Ticker Data Error for ${symbol}:`, error.message);
      throw new Error(`无法获取 ${symbol} 的完整数据: ${error.message}`);
    }
  }

  /**
   * 扫描资金费率异常项目
   * @param type 'positive' | 'negative'
   * @param limit 返回数量
   */
  async scanFundingAnomalies(
    type: 'positive' | 'negative',
    limit: number = 10
  ): Promise<any[]> {
    try {
      const rates = await this.getFundingRates();
      
      // 过滤：只保留市值前5000的项目（这里简化处理，实际需要根据市值过滤）
      // 过滤：剔除极低流动性项目（根据 volume 过滤）
      const filtered = rates
        .filter((item: any) => {
          // 这里需要根据实际 API 返回的字段调整
          return item.volume24h > 1000000; // 示例：24h 交易量 > 100万
        })
        .sort((a: any, b: any) => {
          if (type === 'positive') {
            return (b.fundingRate || 0) - (a.fundingRate || 0);
          } else {
            return (a.fundingRate || 0) - (b.fundingRate || 0);
          }
        })
        .slice(0, limit);

      return filtered.map((item: any) => ({
        symbol: item.symbol,
        fundingRate: item.fundingRate,
        fundingRatePercent: ((item.fundingRate || 0) * 100).toFixed(4),
      }));
    } catch (error: any) {
      console.error('CoinGlass Funding Scan Error:', error.message);
      throw new Error(`无法扫描资金费率异常: ${error.message}`);
    }
  }

  /**
   * 分析是否构成轧空结构
   * 返回过去30天内可能出现过轧空结构的 Ticker 列表
   */
  async detectShortSqueezeCandidates(): Promise<string[]> {
    try {
      // 获取主流币种的 OI 和价格历史数据
      const symbols = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX', 'MATIC', 'DOT'];
      const candidates: string[] = [];

      for (const symbol of symbols) {
        try {
          const [ohlc, oi] = await Promise.all([
            this.getOHLCHistory(symbol, '1h', 720),
            this.getOIHistory(symbol, 720),
          ]);

          // 简化的轧空检测逻辑
          // 实际应该更复杂，这里仅作示例
          if (this.analyzeShortSqueezePattern(ohlc, oi)) {
            candidates.push(symbol);
          }
        } catch (error) {
          // 忽略单个币种错误，继续处理其他币种
          console.warn(`Failed to analyze ${symbol}:`, error);
        }
      }

      return candidates;
    } catch (error: any) {
      console.error('Short Squeeze Detection Error:', error.message);
      throw new Error(`无法检测轧空结构: ${error.message}`);
    }
  }

  /**
   * 分析单个 Ticker 的轧空结构
   */
  private analyzeShortSqueezePattern(ohlc: any[], oi: any[]): boolean {
    if (ohlc.length < 48 || oi.length < 48) return false;

    // 简化的检测逻辑（实际需要更复杂的分析）
    // 1. OI 先下降后上升
    // 2. 价格逆势启动
    // 3. 成交量放大
    
    const recentOI = oi.slice(-48); // 最近48小时
    const recentPrice = ohlc.slice(-48);
    
    const oiDrop = recentOI[0]?.value > recentOI[24]?.value;
    const oiRise = recentOI[recentOI.length - 1]?.value > recentOI[24]?.value;
    const priceRise = recentPrice[recentPrice.length - 1]?.close > recentPrice[0]?.close * 1.05;

    return oiDrop && oiRise && priceRise;
  }

  /**
   * 获取单个 Ticker 的详细轧空分析数据
   */
  async getShortSqueezeAnalysis(symbol: string): Promise<any> {
    try {
      const [ohlc, oi, longShort, funding] = await Promise.all([
        this.getOHLCHistory(symbol, '1h', 720),
        this.getOIHistory(symbol, 720),
        this.getLongShortRatio(symbol),
        this.getFundingRates().then(rates => 
          rates.find((r: any) => r.symbol === symbol.toUpperCase())
        ),
      ]);

      return {
        symbol: symbol.toUpperCase(),
        ohlc,
        oi,
        longShortRatio: longShort,
        fundingRate: funding,
        timestamp: Date.now(),
      };
    } catch (error: any) {
      console.error(`Short Squeeze Analysis Error for ${symbol}:`, error.message);
      throw new Error(`无法分析 ${symbol} 的轧空结构: ${error.message}`);
    }
  }
}

