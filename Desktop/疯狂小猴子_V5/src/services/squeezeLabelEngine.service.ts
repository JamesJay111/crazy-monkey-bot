import { SqueezeCacheItem } from './squeezeCache.service';

/**
 * 庄家轧空信号结构（Label Engine 输入）
 */
export interface SqueezeSignal {
  reversal?: 'none' | 'short_to_long' | 'long_to_short';
  reversalStrength?: 'weak' | 'medium' | 'strong';
  positionBias?: 'none' | 'long_stronger' | 'short_stronger' | 'neutral';
  score: number;
  interval?: string;
  exchange?: string;
}

/**
 * 标签生成结果
 */
export interface SqueezeLabel {
  primary?: string;     // 主标签（可选，无反转时为undefined）
  secondary?: string;   // 副标签（可选）
  strength?: string;    // 强度标签（可选）
  fullLabel?: string;   // 完整标签（用于详情页）
}

/**
 * 交易员一句话标签引擎
 * 将复杂结构压缩成极低认知成本的标签描述
 */
export class SqueezeLabelEngine {
  /**
   * 生成标签（主要接口）
   */
  generateSqueezeLabel(signal: SqueezeSignal): SqueezeLabel {
    // 一级标签：多空反转类（最高优先级）
    const primary = this.generatePrimaryLabel(signal);
    
    // 二级标签：开仓倾向类（仅当无反转时）
    // 如果primary为空字符串，说明无反转，可以使用二级标签
    const secondary = (!primary || signal.reversal === 'none' || !signal.reversal)
      ? this.generateSecondaryLabel(signal)
      : undefined;
    
    // 三级标签：结构强度补充（可选）
    const strength = this.generateStrengthLabel(signal.score);
    
    // 完整标签（用于详情页）
    const fullLabel = this.generateFullLabel(primary, secondary, signal);

    return {
      primary: primary || undefined, // 空字符串转为undefined
      secondary,
      strength,
      fullLabel,
    };
  }

  /**
   * 从 CacheItem 生成标签（便捷方法）
   */
  generateLabelFromCacheItem(item: SqueezeCacheItem): SqueezeLabel {
    const signal: SqueezeSignal = {
      reversal: item.signal.reversal || 'none',
      reversalStrength: item.signal.reversal_strength,
      positionBias: item.signal.position_bias || 'none',
      score: item.score,
      interval: '4h',
      exchange: 'Binance',
    };
    
    return this.generateSqueezeLabel(signal);
  }

  /**
   * 一级标签：多空反转类（最高优先级）
   */
  private generatePrimaryLabel(signal: SqueezeSignal): string {
    const reversal = signal.reversal || 'none';
    const strength = signal.reversalStrength;

    // E2.1 多空反转类
    if (reversal === 'short_to_long') {
      if (strength === 'strong') {
        return '空转多（强）';
      } else if (strength === 'medium') {
        return '空转多';
      } else if (strength === 'weak') {
        return '结构反转';
      }
      // 默认medium
      return '空转多';
    }

    if (reversal === 'long_to_short') {
      if (strength === 'strong') {
        return '多转空（强）';
      } else if (strength === 'medium') {
        return '多转空';
      } else if (strength === 'weak') {
        return '结构反转';
      }
      // 默认medium
      return '多转空';
    }

    // 无反转，返回空字符串（将使用二级标签）
    return '';
  }

  /**
   * 二级标签：开仓倾向类（仅当无反转时使用）
   */
  private generateSecondaryLabel(signal: SqueezeSignal): string | undefined {
    const positionBias = signal.positionBias || 'none';

    // E3. 开仓倾向类
    if (positionBias === 'long_stronger') {
      return '多头加速';
    }

    if (positionBias === 'short_stronger') {
      return '空头加速';
    }

    // 无明显倾向，不显示二级标签
    return undefined;
  }

  /**
   * 三级标签：结构强度补充（可选）
   */
  private generateStrengthLabel(score: number): string | undefined {
    // E4. 结构强度补充
    if (score >= 12) {
      return '结构剧烈';
    } else if (score >= 8) {
      return '结构明显';
    } else if (score >= 5) {
      return '结构变化';
    }

    // score < 5，不展示
    return undefined;
  }

  /**
   * 生成完整标签（用于详情页）
   * E5.3：详情页顶部Summary（完整但仍一句话）
   */
  private generateFullLabel(
    primary: string,
    secondary: string | undefined,
    signal: SqueezeSignal
  ): string {
    const parts: string[] = [];

    // 主标签（一级）
    if (primary) {
      parts.push(primary);
    } else if (secondary) {
      // 无主标签时，使用二级标签
      parts.push(secondary);
    }

    // 如果没有主标签和二级标签，使用强度标签
    if (parts.length === 0) {
      const strength = this.generateStrengthLabel(signal.score);
      if (strength) {
        parts.push(strength);
      }
    }

    // 如果有内容，添加元数据
    if (parts.length > 0) {
      const exchange = signal.exchange || 'Binance';
      const interval = signal.interval || '4h';
      return `结构标签：${parts.join('｜')}｜${exchange} · ${interval}`;
    }

    return '结构标签：无明显变化';
  }

  /**
   * 生成List展示标签（E5.1）
   * 格式：TICKER ｜标签
   * 
   * 示例：
   * - BTC ｜空转多（强）
   * - SOL ｜多头加速 · 结构明显
   * - ETH ｜结构变化
   */
  generateListLabel(item: SqueezeCacheItem): string {
    const label = this.generateLabelFromCacheItem(item);

    // E5.1 标签组合规则
    // 优先级：一级标签 > 二级标签（仅当无反转）> 三级强度标签

    // 有一级标签（反转类）
    if (label.primary) {
      // 一级标签优先，不显示二级和三级
      return label.primary;
    }

    // 无一级标签，使用二级标签（开仓倾向）
    const parts: string[] = [];
    if (label.secondary) {
      parts.push(label.secondary);
    }

    // 三级强度标签（可选）
    if (label.strength) {
      parts.push(label.strength);
    }

    if (parts.length === 0) {
      // 如果都没有，使用三级标签（如果有）
      if (label.strength) {
        return label.strength;
      }
      return '结构变化';
    }

    // 组合二级和三级标签，使用 · 分隔
    return parts.join(' · ');
  }

  /**
   * 生成推送标题标签（E5.2）
   * 格式更克制，仅显示核心信息
   */
  generatePushTitleLabel(item: SqueezeCacheItem): string {
    const label = this.generateLabelFromCacheItem(item);

    // 优先使用一级标签（反转）
    if (label.primary) {
      return label.primary;
    }

    // 无反转时使用二级标签
    if (label.secondary) {
      return label.secondary;
    }

    // 都没有时返回默认
    return '结构变化';
  }
}

// 导出单例（推荐使用）
export const squeezeLabelEngine = new SqueezeLabelEngine();

