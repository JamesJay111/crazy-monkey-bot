import { SqueezeCacheItem } from './squeezeCache.service';
import { RiskConfidenceOutput } from './squeezeRiskEngine.service';

/**
 * 策略频道定义
 */
export interface StrategyChannel {
  id: string;
  displayName: string;
  description: string;
}

/**
 * 庄家轧空事件（用于频道匹配）
 */
export interface SqueezeEvent {
  ticker: string;
  label: string; // 来自 Label Engine
  risk: RiskConfidenceOutput; // 来自 Risk Engine
  reversal?: 'none' | 'short_to_long' | 'long_to_short';
  reversalStrength?: 'weak' | 'medium' | 'strong';
  positionBias?: 'none' | 'long_stronger' | 'short_stronger' | 'neutral';
  exchange?: string;
  interval?: string;
}

/**
 * 策略频道引擎
 * 用于判断事件命中哪些频道
 */
export class StrategyChannelEngine {
  /**
   * 预置频道定义（G1.1）
   */
  private readonly CHANNELS: Record<string, StrategyChannel> = {
    strong_reversal: {
      id: 'strong_reversal',
      displayName: '强结构反转',
      description: '4h 内出现强反转（空→多 / 多→空）',
    },
    high_risk_squeeze: {
      id: 'high_risk_squeeze',
      displayName: '高风险挤压',
      description: '风险等级 ≥ 🟠 高',
    },
    high_confidence: {
      id: 'high_confidence',
      displayName: '高可信结构',
      description: '结构可信度 ⭐⭐⭐',
    },
    long_bias_accel: {
      id: 'long_bias_accel',
      displayName: '多头加速',
      description: '无反转，但多军开仓明显',
    },
    short_bias_accel: {
      id: 'short_bias_accel',
      displayName: '空头加速',
      description: '无反转，但空军开仓明显',
    },
  };

  /**
   * 获取所有预置频道
   */
  getAllChannels(): StrategyChannel[] {
    return Object.values(this.CHANNELS);
  }

  /**
   * 获取频道显示名称
   */
  getChannelDisplayName(channelId: string): string {
    return this.CHANNELS[channelId]?.displayName || channelId;
  }

  /**
   * 判断事件命中哪些频道（G2.2）
   */
  matchChannels(event: SqueezeEvent): string[] {
    const matchedChannels: string[] = [];

    // 命中 strong_reversal
    if (event.reversalStrength === 'strong') {
      matchedChannels.push('strong_reversal');
    }

    // 命中 high_risk_squeeze
    if (event.risk.riskLevel === 'high' || event.risk.riskLevel === 'extreme') {
      matchedChannels.push('high_risk_squeeze');
    }

    // 命中 high_confidence
    if (event.risk.confidenceStars === 3) {
      matchedChannels.push('high_confidence');
    }

    // 命中 long_bias_accel
    if (
      (!event.reversal || event.reversal === 'none') &&
      event.positionBias === 'long_stronger'
    ) {
      matchedChannels.push('long_bias_accel');
    }

    // 命中 short_bias_accel
    if (
      (!event.reversal || event.reversal === 'none') &&
      event.positionBias === 'short_stronger'
    ) {
      matchedChannels.push('short_bias_accel');
    }

    return matchedChannels;
  }

  /**
   * 从 CacheItem 构建事件（便捷方法）
   */
  buildEventFromCacheItem(
    item: SqueezeCacheItem,
    label: string,
    risk: RiskConfidenceOutput
  ): SqueezeEvent {
    return {
      ticker: item.ticker,
      label,
      risk,
      reversal: item.signal.reversal || 'none',
      reversalStrength: item.signal.reversal_strength,
      positionBias: item.signal.position_bias || 'none',
      exchange: 'Binance',
      interval: '4h',
    };
  }

  /**
   * 格式化频道列表为显示文本（G5）
   * 输入：['strong_reversal', 'high_confidence']
   * 输出：'强结构反转 · 高可信结构'
   */
  formatChannelList(channelIds: string[]): string {
    if (channelIds.length === 0) {
      return '';
    }

    return channelIds
      .map(id => this.getChannelDisplayName(id))
      .join(' · ');
  }

  /**
   * 获取频道优先级（用于防骚扰排序，G7）
   * 数值越小优先级越高
   */
  getChannelPriority(channelId: string): number {
    const priorities: Record<string, number> = {
      strong_reversal: 1,
      high_risk_squeeze: 2,
      high_confidence: 3,
      long_bias_accel: 4,
      short_bias_accel: 4,
    };

    return priorities[channelId] || 999;
  }

  /**
   * 按优先级排序频道列表
   */
  sortChannelsByPriority(channelIds: string[]): string[] {
    return [...channelIds].sort(
      (a, b) => this.getChannelPriority(a) - this.getChannelPriority(b)
    );
  }
}

// 导出单例
export const strategyChannelEngine = new StrategyChannelEngine();

