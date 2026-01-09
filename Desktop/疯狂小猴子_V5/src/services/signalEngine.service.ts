import { CoinGlassClient } from '../clients/coinglass.client';
import { logger } from '../utils/logger';
import {
  SqueezeFeatures,
  ScoreBreakdown,
  SqueezeType,
} from '../types';

/**
 * 信号引擎服务（新标准：4类信号，每类0-25分）
 * 负责计算轧空特征和打分
 */
export class SignalEngine {
  constructor(private coinglass: CoinGlassClient) {}

  /**
   * 计算单个 ticker 的轧空特征
   * @param baseSymbol 币种符号（如 BTC）
   * @param pairSymbol 交易对符号（如 BTCUSDT）
   * @param days 天数（默认30）
   */
  async calculateFeatures(
    baseSymbol: string,
    pairSymbol: string,
    days: number = 30
  ): Promise<{ features: SqueezeFeatures; missing: Record<string, boolean> }> {
    const missing = {
      oi: false,
      funding: false, // 新标准不需要 funding，但类型要求保留
      longShortRatio: false,
      takerBuySell: false,
      basis: false,
    };

    const limit = Math.ceil(days * 1.5); // 取45条以确保有30天窗口

    try {
      // 并行获取所有指标
      const [
        oiHistory,
        topLsRatioHistory,
        globalLsRatioHistory,
        takerVolumeHistory,
        takerVolumeList,
        basisHistory,
      ] = await Promise.all([
        // OI 历史
        this.coinglass.getOpenInterestOhlcHistory({
          symbol: baseSymbol.toUpperCase(),
          interval: '1d',
          limit,
        }).catch(() => {
          missing.oi = true;
          return [];
        }),
        
        // 大户账户多空比历史（优先）
        this.coinglass.getTopLongShortPositionRatioHistory({
          exchange: 'Binance',
          symbol: pairSymbol,
          interval: '1d',
          limit,
        }).catch(() => {
          // 失败不标记，会 fallback 到 global
          return [];
        }),
        
        // 全局账户多空比历史（Fallback）
        this.coinglass.getGlobalLongShortRatioHistory(
          baseSymbol,
          '1d',
          limit
        ).catch(() => {
          missing.longShortRatio = true;
          return [];
        }),
        
        // Taker Buy/Sell 历史（优先）
        this.coinglass.getTakerBuySellVolumeHistory({
          exchange: 'Binance',
          symbol: pairSymbol,
          interval: '1d',
          limit,
        }).catch(() => {
          // 失败不标记，会 fallback 到 exchange-list
          return [];
        }),
        
        // Taker Buy/Sell 交易所列表（Fallback）
        // 注意：如果 Taker Buy/Sell 历史失败，这里没有 fallback API，直接返回空数组
        Promise.resolve([]).catch(() => {
          missing.takerBuySell = true;
          return [];
        }),
        
        // Basis 历史
        this.coinglass.getBasisHistory({
          exchange: 'Binance',
          symbol: pairSymbol,
          interval: '1d',
          limit,
        }).catch(() => {
          missing.basis = true;
          return [];
        }),
      ]);

      // 计算特征
      const oiFeatures = this.calculateOIFeatures(oiHistory, days);
      const lsRatioFeatures = this.calculateLSRatioFeatures(
        topLsRatioHistory.length > 0 ? topLsRatioHistory : globalLsRatioHistory,
        days
      );
      const takerFeatures = this.calculateTakerFeatures(
        takerVolumeHistory.length > 0 ? takerVolumeHistory : takerVolumeList,
        days
      );
      const basisFeatures = this.calculateBasisFeatures(basisHistory, days);

      // 确保所有必需字段都被设置（使用默认值）
      const features: SqueezeFeatures = {
        symbol: baseSymbol.toUpperCase(),
        // OI 特征
        oi_min: oiFeatures.oi_min ?? 0,
        oi_max: oiFeatures.oi_max ?? 0,
        oi_last: oiFeatures.oi_last ?? 0,
        oi_drawdown_pct: oiFeatures.oi_drawdown_pct ?? 0,
        oi_rebound_from_min_pct: oiFeatures.oi_rebound_from_min_pct ?? 0,
        oi_slope_7d: oiFeatures.oi_slope_7d ?? 0,
        oi_clean_then_build_flag: oiFeatures.oi_clean_then_build_flag ?? false,
        // Funding 特征（新标准不需要，但类型要求保留）
        funding_last: 0,
        funding_p10: 0,
        funding_p90: 0,
        funding_extreme_side: 'normal',
        funding_shift_7d: 0,
        // Long/Short Ratio 特征
        ls_ratio_last: lsRatioFeatures.ls_ratio_last ?? 1.0,
        ls_ratio_p10: lsRatioFeatures.ls_ratio_p10 ?? 1.0,
        ls_ratio_p90: lsRatioFeatures.ls_ratio_p90 ?? 1.0,
        ls_ratio_reversal_flag: lsRatioFeatures.ls_ratio_reversal_flag ?? false,
        // Taker Buy/Sell 特征
        taker_buy_ratio_last: takerFeatures.taker_buy_ratio_last ?? 0.5,
        taker_buy_bias_flag: takerFeatures.taker_buy_bias_flag ?? false,
        // Basis 特征
        basis_last: basisFeatures.basis_last ?? 0,
        basis_jump_flag: basisFeatures.basis_jump_flag ?? false,
        // 缺失标记
        missing,
      };

      return { features, missing };
    } catch (error) {
      logger.error({ error, baseSymbol, pairSymbol }, 'Failed to calculate features');
      throw error;
    }
  }

  /**
   * A) OI 节奏：先缩后扩（0~25分）
   */
  private calculateOIFeatures(oiHistory: any[], days: number): Partial<SqueezeFeatures> {
    if (!Array.isArray(oiHistory) || oiHistory.length === 0) {
      return {
        oi_min: 0,
        oi_max: 0,
        oi_last: 0,
        oi_drawdown_pct: 0,
        oi_rebound_from_min_pct: 0,
        oi_slope_7d: 0,
        oi_clean_then_build_flag: false,
      };
    }

    // 取最近 days 天的数据
    const recent = oiHistory.slice(-days).map(item => parseFloat(item.close || '0')).filter(v => !isNaN(v) && v > 0);
    
    if (recent.length === 0) {
      return {
        oi_min: 0,
        oi_max: 0,
        oi_last: 0,
        oi_drawdown_pct: 0,
        oi_rebound_from_min_pct: 0,
        oi_slope_7d: 0,
        oi_clean_then_build_flag: false,
      };
    }

    const oi_peak = Math.max(...recent);
    const oi_trough = Math.min(...recent);
    const oi_last = recent[recent.length - 1];

    const drawdown_pct = (oi_trough - oi_peak) / oi_peak; // 负数
    const rebound_pct = (oi_last - oi_trough) / oi_trough;

    // 计算近7日斜率（线性回归）
    const last7 = recent.slice(-7);
    const slope_7d = this.calculateLinearSlope(last7);

    // 判断是否存在"先缩后扩"
    // 简单判断：先下降后上升，且下降幅度和上升幅度都足够大
    const clean_then_build_flag = drawdown_pct <= -0.08 && rebound_pct >= 0.12;

    return {
      oi_min: oi_trough,
      oi_max: oi_peak,
      oi_last,
      oi_drawdown_pct: drawdown_pct,
      oi_rebound_from_min_pct: rebound_pct,
      oi_slope_7d: slope_7d,
      oi_clean_then_build_flag: clean_then_build_flag,
    };
  }

  /**
   * B) 多空反转：大户/账户多空比从低位抬升（0~25分）
   */
  private calculateLSRatioFeatures(lsRatioHistory: any[], days: number): Partial<SqueezeFeatures> {
    if (!Array.isArray(lsRatioHistory) || lsRatioHistory.length === 0) {
      return {
        ls_ratio_last: 1.0,
        ls_ratio_p10: 1.0,
        ls_ratio_p90: 1.0,
        ls_ratio_reversal_flag: false,
      };
    }

    // 取最近 days 天的数据
    const recent = lsRatioHistory
      .slice(-days)
      .map(item => {
        // 优先使用 top_account_long_short_ratio，否则使用 global_account_long_short_ratio
        const ratio = parseFloat(
          item.top_account_long_short_ratio || 
          item.global_account_long_short_ratio || 
          '1.0'
        );
        return isNaN(ratio) || ratio <= 0 ? 1.0 : ratio;
      })
      .filter(v => v > 0);

    if (recent.length === 0) {
      return {
        ls_ratio_last: 1.0,
        ls_ratio_p10: 1.0,
        ls_ratio_p90: 1.0,
        ls_ratio_reversal_flag: false,
      };
    }

    const sorted = [...recent].sort((a, b) => a - b);
    const ls_ratio_p10 = this.getPercentile(sorted, 10);
    const ls_ratio_p90 = this.getPercentile(sorted, 90);
    const ls_ratio_last = recent[recent.length - 1];

    // 计算近14天最低值
    const last14 = recent.slice(-14);
    const ls_min_14d = last14.length > 0 ? Math.min(...last14) : ls_ratio_last;
    const ls_jump = ls_ratio_last / ls_min_14d;

    // 判断反转标志：从低位抬升明显
    const ls_ratio_reversal_flag = ls_min_14d <= 0.8 && ls_jump >= 1.4;

    return {
      ls_ratio_last,
      ls_ratio_p10,
      ls_ratio_p90,
      ls_ratio_reversal_flag,
    };
  }

  /**
   * C) 主动买量：taker buy 上升（0~25分）
   */
  private calculateTakerFeatures(takerData: any[], days: number): Partial<SqueezeFeatures> {
    if (!Array.isArray(takerData) || takerData.length === 0) {
      return {
        taker_buy_ratio_last: 0.5,
        taker_buy_bias_flag: false,
      };
    }

    // 处理历史数据格式
    let ratios: number[] = [];
    
    if (takerData[0]?.time !== undefined) {
      // 历史数据格式
      const recent = takerData.slice(-days);
      ratios = recent.map(item => {
        const buy = parseFloat(item.taker_buy_volume_usd || '0');
        const sell = parseFloat(item.taker_sell_volume_usd || '0');
        const ratio = parseFloat(item.taker_buy_ratio || '0');
        
        if (!isNaN(ratio) && ratio > 0 && ratio <= 1) {
          return ratio;
        }
        if (!isNaN(buy) && !isNaN(sell) && (buy + sell) > 0) {
          return buy / (buy + sell);
        }
        return 0.5;
      }).filter(r => r > 0 && r <= 1);
    } else {
      // 交易所列表格式
      ratios = takerData.map(item => {
        const ratio = parseFloat(item.taker_buy_ratio || '0');
        return (!isNaN(ratio) && ratio > 0 && ratio <= 1) ? ratio : 0.5;
      }).filter(r => r > 0 && r <= 1);
    }

    if (ratios.length === 0) {
      return {
        taker_buy_ratio_last: 0.5,
        taker_buy_bias_flag: false,
      };
    }

    const taker_buy_ratio_last = ratios[ratios.length - 1];

    // 计算 ma7 和 ma30
    const ma7 = ratios.slice(-7).reduce((a, b) => a + b, 0) / Math.min(7, ratios.length);
    const ma30 = ratios.slice(-30).reduce((a, b) => a + b, 0) / Math.min(30, ratios.length);

    // 判断是否有放量（如果有 volume 字段）
    let taker_spike_flag = false;
    if (takerData[0]?.time !== undefined && takerData[0]?.volume) {
      const volumes = takerData.slice(-days).map(item => parseFloat(item.volume || '0')).filter(v => !isNaN(v) && v > 0);
      if (volumes.length >= 30) {
        const avg30 = volumes.slice(-30).reduce((a, b) => a + b, 0) / 30;
        const recent3 = volumes.slice(-3);
        taker_spike_flag = recent3.some(v => v > avg30 * 1.5);
      }
    }

    // 判断偏买标志
    const taker_buy_bias_flag = (ma7 - ma30 >= 0.08) || taker_spike_flag;

    return {
      taker_buy_ratio_last,
      taker_buy_bias_flag,
    };
  }

  /**
   * D) 基差：合约溢价扩大（0~25分）
   */
  private calculateBasisFeatures(basisHistory: any[], days: number): Partial<SqueezeFeatures> {
    if (!Array.isArray(basisHistory) || basisHistory.length === 0) {
      return {
        basis_last: 0,
        basis_jump_flag: false,
      };
    }

    // 取最近 days 天的数据
    const recent = basisHistory
      .slice(-days)
      .map(item => parseFloat(item.basis || '0'))
      .filter(v => !isNaN(v));

    if (recent.length === 0) {
      return {
        basis_last: 0,
        basis_jump_flag: false,
      };
    }

    const sorted = [...recent].sort((a, b) => a - b);
    const basis_p90_30d = this.getPercentile(sorted, 90);
    const basis_last = recent[recent.length - 1];
    const basis_3days_ago = recent.length >= 3 ? recent[recent.length - 4] : basis_last;
    const basis_jump_3d = basis_last - basis_3days_ago;

    // 判断基差扩大标志
    const basis_jump_flag = (basis_last >= basis_p90_30d && basis_jump_3d >= 0.003) || basis_jump_3d >= 0.0015;

    return {
      basis_last,
      basis_jump_flag,
    };
  }

  /**
   * 计算得分明细（新标准：4类，每类0-25分）
   */
  calculateScore(features: SqueezeFeatures): { breakdown: ScoreBreakdown; squeezeType: SqueezeType } {
    // A) OI 节奏得分（0~25）
    let oi_rhythm = 0;
    if (features.oi_drawdown_pct <= -0.12 && features.oi_rebound_from_min_pct >= 0.18) {
      // 强"清洗→堆杠杆"
      oi_rhythm = 22 + Math.min(3, Math.floor((features.oi_rebound_from_min_pct - 0.18) * 10));
    } else if (features.oi_drawdown_pct <= -0.08 && features.oi_rebound_from_min_pct >= 0.12) {
      // 中等
      oi_rhythm = 16 + Math.min(5, Math.floor((features.oi_rebound_from_min_pct - 0.12) * 8));
    } else {
      // 按 rebound_pct 线性映射到 0-15
      oi_rhythm = Math.max(0, Math.min(15, Math.floor(features.oi_rebound_from_min_pct * 125)));
    }

    // B) 多空反转得分（0~25，缺失则 0）
    let ls_ratio_reversal = 0;
    if (!features.missing.longShortRatio) {
      // 计算近14天最低值
      const ls_min_14d = features.ls_ratio_p10; // 简化：用 p10 近似最低值
      const ls_jump = features.ls_ratio_last / ls_min_14d;

      if (ls_min_14d <= 0.6 && ls_jump >= 1.8) {
        // 强反转（0.3 → 1.5 属于 jump=5 的极端反转）
        ls_ratio_reversal = 20 + Math.min(5, Math.floor((ls_jump - 1.8) * 2));
      } else if (ls_min_14d <= 0.8 && ls_jump >= 1.4) {
        // 中等反转
        ls_ratio_reversal = 14 + Math.min(5, Math.floor((ls_jump - 1.4) * 1.5));
      } else {
        // 按 ls_jump 映射到 0-13
        ls_ratio_reversal = Math.max(0, Math.min(13, Math.floor((ls_jump - 1.0) * 13)));
      }
    }

    // C) 主动买量得分（0~25，缺失则 0）
    let taker_buy_bias = 0;
    if (!features.missing.takerBuySell) {
      // 计算 ma7 和 ma30（需要从历史数据计算，这里简化处理）
      // 实际应该从 calculateTakerFeatures 传入
      if (features.taker_buy_bias_flag) {
        // 有偏买标志
        taker_buy_bias = 16 + Math.min(9, Math.floor((features.taker_buy_ratio_last - 0.5) * 18));
      } else {
        // 按偏离度映射到 0-15
        const deviation = Math.abs(features.taker_buy_ratio_last - 0.5);
        taker_buy_bias = Math.max(0, Math.min(15, Math.floor(deviation * 30)));
      }
    }

    // D) 基差扩大得分（0~25，缺失则 0）
    let basis_expansion = 0;
    if (!features.missing.basis) {
      if (features.basis_jump_flag) {
        // 基差扩大
        if (features.basis_last >= 0.012) {
          // 非常强的溢价（如 +0.012）
          basis_expansion = 20 + Math.min(5, Math.floor((features.basis_last - 0.012) * 100));
        } else if (features.basis_last >= 0.006) {
          // 强溢价
          basis_expansion = 18 + Math.min(2, Math.floor((features.basis_last - 0.006) * 33));
        } else {
          // 中等溢价
          basis_expansion = 10 + Math.min(7, Math.floor(features.basis_last * 1167));
        }
      } else {
        // 按 basis_last 映射到 0-9
        basis_expansion = Math.max(0, Math.min(9, Math.floor(Math.abs(features.basis_last) * 750)));
      }
    }

    const total = oi_rhythm + ls_ratio_reversal + taker_buy_bias + basis_expansion;

    const breakdown: ScoreBreakdown = {
      oi_rhythm,
      ls_ratio_reversal,
      taker_buy_bias,
      basis_expansion,
      total,
    };

    // 判断 squeezeType
    const squeezeType = this.determineSqueezeType(features, breakdown);

    return { breakdown, squeezeType };
  }

  /**
   * 判断轧空类型
   */
  private determineSqueezeType(features: SqueezeFeatures, breakdown: ScoreBreakdown): SqueezeType {
    // 规则判断
    if (breakdown.oi_rhythm >= 16 && breakdown.ls_ratio_reversal >= 14) {
      return 'short_squeeze_like';
    }
    if (breakdown.oi_rhythm >= 16 && breakdown.basis_expansion >= 10) {
      return 'short_squeeze_like';
    }
    if (breakdown.total >= 65) {
      return 'short_squeeze_like';
    }
    return 'neutral';
  }

  /**
   * 计算线性斜率
   */
  private calculateLinearSlope(values: number[]): number {
    if (values.length < 2) return 0;
    const n = values.length;
    const sumX = (n * (n - 1)) / 2;
    const sumY = values.reduce((a, b) => a + b, 0);
    const sumXY = values.reduce((sum, y, i) => sum + i * y, 0);
    const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
    return (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  }

  /**
   * 获取百分位数
   */
  private getPercentile(sorted: number[], percentile: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.floor((sorted.length - 1) * (percentile / 100));
    return sorted[index] || 0;
  }
}
