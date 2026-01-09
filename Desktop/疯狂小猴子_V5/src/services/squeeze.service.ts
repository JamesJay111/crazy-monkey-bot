import { CoinGlassClient } from '../clients/coinglass.client';
import { DeepSeekClient } from '../clients/deepseek.client';
import { SqueezeCandidate } from '../types';
import { buildSqueezePrompt, SQUEEZE_SYSTEM_PROMPT } from '../prompts/squeeze.prompt';
import { logger } from '../utils/logger';

/**
 * 轧空分析服务
 */
export class SqueezeService {
  constructor(
    private coinglass: CoinGlassClient,
    private deepseek: DeepSeekClient
  ) {}

  /**
   * 检测过去30天可能出现过轧空结构的候选列表
   */
  async detectCandidates(limit: number = 15): Promise<SqueezeCandidate[]> {
    try {
      // 获取主流币种列表
      const supportedCoins = await this.coinglass.getFuturesSupportedCoins();
      
      if (!supportedCoins || supportedCoins.length === 0) {
        logger.error('No supported coins returned from CoinGlass API');
        throw new Error('无法获取支持的币种列表，请检查 CoinGlass API 配置');
      }

      logger.info({ coinCount: supportedCoins.length }, 'Got supported coins from CoinGlass');
      
      // 优先检查主流币种（BTC, ETH, SOL 等）
      const priorityCoins = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX', 'MATIC', 'DOT'];
      const mainCoins = [
        ...priorityCoins.filter(c => supportedCoins.includes(c)),
        ...supportedCoins.filter((c: string) => !priorityCoins.includes(c))
      ].slice(0, 50); // 限制检查数量

      logger.info({ mainCoinsCount: mainCoins.length }, 'Analyzing coins for squeeze candidates');

      const candidates: SqueezeCandidate[] = [];
      let successCount = 0;
      let errorCount = 0;

      for (const symbol of mainCoins) {
        try {
          const score = await this.calculateSqueezeScore(symbol);
          if (score > 0) {
            candidates.push({
              symbol,
              score,
              reasons: await this.getSqueezeReasons(symbol),
            });
            successCount++;
          }
        } catch (error) {
          errorCount++;
          const errorMsg = error instanceof Error ? error.message : String(error);
          
          // 检查是否是套餐升级错误
          if (errorMsg.includes('升级') || errorMsg.includes('upgrade') || errorMsg.includes('plan')) {
            logger.warn({ symbol }, 'API plan upgrade required for this feature');
            // 如果是套餐问题，只记录一次，然后继续
            if (errorCount === 1) {
              logger.error('CoinGlass API plan upgrade required for historical data access');
            }
            // 如果所有请求都需要升级，提前退出
            if (errorCount > 5 && successCount === 0) {
              throw new Error('该功能需要升级 CoinGlass API 套餐才能使用历史数据。请联系 CoinGlass 升级您的 API 计划。');
            }
            continue;
          }
          
          logger.warn({ error, symbol }, 'Failed to analyze symbol for squeeze');
          // 如果其他错误太多，提前退出
          if (errorCount > 10 && successCount === 0) {
            logger.error('Too many errors, stopping analysis');
            break;
          }
        }
      }

      logger.info({ candidatesCount: candidates.length, successCount, errorCount }, 'Squeeze detection completed');

      // 按分数排序
      candidates.sort((a, b) => b.score - a.score);

      return candidates.slice(0, limit);
    } catch (error) {
      logger.error({ error }, 'Failed to detect squeeze candidates');
      const errorMessage = error instanceof Error ? error.message : '未知错误';
      throw new Error(`检测轧空结构失败: ${errorMessage}。请检查 CoinGlass API 配置或稍后重试`);
    }
  }

  /**
   * 计算轧空分数（0-100）
   */
  private async calculateSqueezeScore(symbol: string): Promise<number> {
    try {
      const [oiHistory, longShortRatio] = await Promise.all([
        this.coinglass.getOpenInterestOhlcHistory({ symbol, interval: '1h', limit: 720 }),
        this.coinglass.getGlobalLongShortRatioHistory(symbol, '1h', 720).then((r: any) => r),
      ]);

      if (oiHistory.length < 48 || longShortRatio.length < 48) {
        return 0;
      }

      let score = 0;

      // 1. OI 先降后升（30分）
      const oiDropAndRise = this.detectOIDropAndRise(oiHistory);
      if (oiDropAndRise) score += 30;

      // 2. 多空比从低位快速反转（30分）
      const ratioReversal = this.detectRatioReversal(longShortRatio);
      if (ratioReversal) score += 30;

      // 3. OI 回升速度快（20分）
      const oiRiseSpeed = this.calculateOIRiseSpeed(oiHistory);
      score += oiRiseSpeed * 20;

      // 4. 多空比变化幅度大（20分）
      const ratioChange = this.calculateRatioChange(longShortRatio);
      score += ratioChange * 20;

      return Math.min(100, score);
    } catch (error) {
      logger.warn({ error, symbol }, 'Failed to calculate squeeze score');
      return 0;
    }
  }

  /**
   * 检测 OI 先降后升
   */
  private detectOIDropAndRise(oiHistory: Array<{ close: string }>): boolean {
    if (oiHistory.length < 48) return false;

    const values = oiHistory.map(h => parseFloat(h.close));
    const mid = Math.floor(values.length / 2);
    const firstHalf = values.slice(0, mid);
    const secondHalf = values.slice(mid);

    const firstMin = Math.min(...firstHalf);
    const firstMax = Math.max(...firstHalf);
    const secondMin = Math.min(...secondHalf);
    const secondMax = Math.max(...secondHalf);

    // 前半段有下降，后半段有上升
    const hasDrop = (firstMax - firstMin) / firstMax > 0.1;
    const hasRise = (secondMax - secondMin) / secondMin > 0.15;

    return hasDrop && hasRise;
  }

  /**
   * 检测多空比反转
   */
  private detectRatioReversal(ratioHistory: Array<{ global_account_long_short_ratio: string }>): boolean {
    if (ratioHistory.length < 48) return false;

    const ratios = ratioHistory.map((r: any) => parseFloat(r.global_account_long_short_ratio));
    const recent = ratios.slice(-24);
    const earlier = ratios.slice(0, 24);

    const earlierAvg = earlier.reduce((a, b) => a + b, 0) / earlier.length;
    const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;

    // 从低位（< 1.0）快速抬升到高位（> 1.2）
    return earlierAvg < 1.0 && recentAvg > 1.2 && (recentAvg / earlierAvg) > 1.3;
  }

  /**
   * 计算 OI 回升速度（0-1）
   */
  private calculateOIRiseSpeed(oiHistory: Array<{ close: string }>): number {
    if (oiHistory.length < 24) return 0;

    const values = oiHistory.map(h => parseFloat(h.close));
    const recent = values.slice(-24);
    const slope = (recent[recent.length - 1] - recent[0]) / recent[0];

    return Math.min(1, Math.max(0, slope));
  }

  /**
   * 计算多空比变化幅度（0-1）
   */
  private calculateRatioChange(ratioHistory: Array<{ global_account_long_short_ratio: string }>): number {
    if (ratioHistory.length < 24) return 0;

    const ratios = ratioHistory.map((r: any) => parseFloat(r.global_account_long_short_ratio));
    const recent = ratios.slice(-24);
    const change = (Math.max(...recent) - Math.min(...recent)) / Math.min(...recent);

    return Math.min(1, change);
  }

  /**
   * 获取轧空原因说明
   */
  private async getSqueezeReasons(symbol: string): Promise<string[]> {
    const reasons: string[] = [];
    try {
      const [oiHistory, longShortRatio] = await Promise.all([
        this.coinglass.getOpenInterestOhlcHistory({ symbol, interval: '1h', limit: 720 }),
        this.coinglass.getGlobalLongShortRatioHistory(symbol, '1h', 720).then((r: any) => r),
      ]);

      if (this.detectOIDropAndRise(oiHistory)) {
        reasons.push('OI 出现先降后升的节奏');
      }

      if (this.detectRatioReversal(longShortRatio)) {
        reasons.push('多空比从低位快速反转');
      }
    } catch (error) {
      logger.warn({ error, symbol }, 'Failed to get squeeze reasons');
    }

    return reasons;
  }

  /**
   * 分析单个 Ticker 的轧空结构
   */
  async analyzeSqueeze(symbol: string): Promise<string> {
    try {
      const [oiHistory, longShortRatio, fundingRates] = await Promise.all([
        this.coinglass.getOpenInterestOhlcHistory({ symbol, interval: '1h', limit: 720 }),
        this.coinglass.getGlobalLongShortRatioHistory(symbol, '1h', 720).then((r: any) => r),
        this.coinglass.getFundingRateExchangeList(symbol).catch(() => []),
      ]);

      // 获取当前资金费率（优先 Binance）
      let currentFundingRate: string | undefined;
      const binanceRate = fundingRates.find((r: any) => r.exchange === 'Binance');
      if (binanceRate) {
        currentFundingRate = binanceRate.funding_rate;
      }

      // 获取资金费率历史
      let fundingRateHistory: Array<{ time: number; close: string }> | undefined;
      try {
        const frHistory = await this.coinglass.getFundingRateOhlcHistory({ symbol, interval: '1h', limit: 168 });
        fundingRateHistory = frHistory.map((h: any) => ({
          time: h.time,
          close: h.close,
        }));
      } catch (error) {
        logger.warn({ error, symbol }, 'Failed to get funding rate history');
      }

      // 构建 Prompt（旧方法，已废弃，保留以兼容）
      // TODO: 迁移到新的 SignalEngine 和 SqueezeScanService
      const prompt = JSON.stringify({
        symbol,
        oiHistory: oiHistory.map((h: any) => ({ time: h.time, close: h.close })),
        longShortRatio: longShortRatio.map((r: any) => ({
          time: r.time,
          global_account_long_short_ratio: r.global_account_long_short_ratio,
        })),
        fundingRate: currentFundingRate,
        fundingRateHistory,
      });

      // 调用 DeepSeek
      const analysis = await this.deepseek.analyzeWithPrompt(
        SQUEEZE_SYSTEM_PROMPT,
        prompt,
        { maxTokens: 1000 }
      );

      return analysis;
    } catch (error) {
      logger.error({ error, symbol }, 'Failed to analyze squeeze');
      throw new Error(`分析 ${symbol} 的轧空结构失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }
}

