import { SqueezeCacheItem } from './squeezeCache.service';

/**
 * 庄家轧空上下文（Risk Engine 输入）
 */
export interface SqueezeContext {
  score: number;
  reversal?: 'none' | 'short_to_long' | 'long_to_short';
  reversalStrength?: 'weak' | 'medium' | 'strong';
  positionBias?: 'none' | 'long_stronger' | 'short_stronger' | 'neutral';
  orderflowImbalance?: 'none' | 'mild' | 'strong'; // 若已实现可用
  sampleSufficiency: 'ok' | 'low'; // 数据是否足够（>=2根4h）
  exchange?: string;
  interval?: string;
}

/**
 * 风险等级
 */
export type RiskLevel = 'low' | 'medium' | 'high' | 'extreme';

/**
 * 可信度星级
 */
export type ConfidenceStars = 1 | 2 | 3;

/**
 * 风险与可信度输出
 */
export interface RiskConfidenceOutput {
  riskLevel: RiskLevel;
  riskLabel: string;        // 如：极高结构风险
  riskEmoji: string;        // 🔴 🟠 🟡 🟢
  confidenceStars: ConfidenceStars;
  confidenceLabel: string;  // 如：结构一致性高
  confidenceEmoji: string;  // ⭐⭐⭐ ⭐⭐ ⭐
  notes?: string;           // 如：样本有限
}

/**
 * 风险等级与可信度引擎
 * 用于对结构信号给出克制、可解释、可比较的风险提示
 */
export class SqueezeRiskEngine {
  /**
   * 评估风险等级和可信度（主要接口）
   */
  evaluateRiskAndConfidence(ctx: SqueezeContext): RiskConfidenceOutput {
    // 评估风险等级
    const riskLevel = this.evaluateRiskLevel(ctx);
    
    // 评估可信度
    const confidenceStars = this.evaluateConfidence(ctx);
    
    // 生成输出
    return {
      riskLevel,
      riskLabel: this.getRiskLabel(riskLevel),
      riskEmoji: this.getRiskEmoji(riskLevel),
      confidenceStars,
      confidenceLabel: this.getConfidenceLabel(confidenceStars),
      confidenceEmoji: this.getConfidenceEmoji(confidenceStars),
      notes: ctx.sampleSufficiency === 'low' ? '样本有限' : undefined,
    };
  }

  /**
   * 从 CacheItem 评估风险与可信度（便捷方法）
   */
  evaluateFromCacheItem(item: SqueezeCacheItem): RiskConfidenceOutput {
    const ctx: SqueezeContext = {
      score: item.score,
      reversal: item.signal.reversal || 'none',
      reversalStrength: item.signal.reversal_strength,
      positionBias: item.signal.position_bias || 'none',
      orderflowImbalance: 'none', // 暂时不可用
      sampleSufficiency: 'ok', // 假设数据足够（实际应该从扫描结果判断）
      exchange: 'Binance',
      interval: '4h',
    };

    return this.evaluateRiskAndConfidence(ctx);
  }

  /**
   * 评估风险等级（F2.2）
   */
  private evaluateRiskLevel(ctx: SqueezeContext): RiskLevel {
    let riskLevel: RiskLevel = 'low';

    // Step 1：反转优先
    if (ctx.reversal && ctx.reversal !== 'none') {
      if (ctx.reversalStrength === 'strong') {
        riskLevel = 'extreme'; // 🔴 极高
      } else if (ctx.reversalStrength === 'medium') {
        riskLevel = 'high'; // 🟠 高
      } else if (ctx.reversalStrength === 'weak') {
        // weak 反转降级为 high
        riskLevel = 'high';
      }
    } else {
      // Step 2：非反转结构
      if (ctx.score >= 12) {
        riskLevel = 'high'; // 🟠 高
      } else if (ctx.score >= 8) {
        riskLevel = 'medium'; // 🟡 中
      } else if (ctx.score >= 5) {
        riskLevel = 'low'; // 🟢 低
      } else {
        // score < 5，不展示（返回low，由调用方决定是否展示）
        riskLevel = 'low';
      }
    }

    // Step 3：样本不足降级
    if (ctx.sampleSufficiency === 'low') {
      riskLevel = this.downgradeRiskLevel(riskLevel);
    }

    return riskLevel;
  }

  /**
   * 降级风险等级
   */
  private downgradeRiskLevel(level: RiskLevel): RiskLevel {
    switch (level) {
      case 'extreme':
        return 'high';
      case 'high':
        return 'medium';
      case 'medium':
        return 'low';
      case 'low':
        return 'low'; // 最低不降
    }
  }

  /**
   * 评估可信度（F3.3）
   */
  private evaluateConfidence(ctx: SqueezeContext): ConfidenceStars {
    let score = 0;

    // 出现反转（+2）
    if (ctx.reversal && ctx.reversal !== 'none') {
      score += 2;
    }

    // score ≥ 8（+1）
    if (ctx.score >= 8) {
      score += 1;
    }

    // positionBias 明确（+1）
    if (ctx.positionBias && ctx.positionBias !== 'none' && ctx.positionBias !== 'neutral') {
      score += 1;
    }

    // orderflowImbalance 明确（+1，可选）
    if (ctx.orderflowImbalance && ctx.orderflowImbalance !== 'none') {
      score += 1;
    }

    // sampleSufficiency == low（−2）
    if (ctx.sampleSufficiency === 'low') {
      score -= 2;
    }

    // 映射到可信度等级
    if (score >= 4) {
      return 3; // ⭐⭐⭐ 高
    } else if (score >= 2) {
      return 2; // ⭐⭐ 中
    } else {
      return 1; // ⭐ 低
    }
  }

  /**
   * 获取风险等级标签
   */
  private getRiskLabel(level: RiskLevel): string {
    switch (level) {
      case 'extreme':
        return '极高结构风险';
      case 'high':
        return '高结构风险';
      case 'medium':
        return '中结构风险';
      case 'low':
        return '低结构风险';
    }
  }

  /**
   * 获取风险等级表情符号
   */
  private getRiskEmoji(level: RiskLevel): string {
    switch (level) {
      case 'extreme':
        return '🔴';
      case 'high':
        return '🟠';
      case 'medium':
        return '🟡';
      case 'low':
        return '🟢';
    }
  }

  /**
   * 获取可信度标签
   */
  private getConfidenceLabel(stars: ConfidenceStars): string {
    switch (stars) {
      case 3:
        return '结构一致性高';
      case 2:
        return '结构一致性中';
      case 1:
        return '结构一致性低';
    }
  }

  /**
   * 获取可信度表情符号
   */
  private getConfidenceEmoji(stars: ConfidenceStars): string {
    switch (stars) {
      case 3:
        return '⭐⭐⭐';
      case 2:
        return '⭐⭐';
      case 1:
        return '⭐';
    }
  }

  /**
   * 生成推荐List展示（F5.1）
   * 格式：🔴 极高 ｜⭐⭐⭐
   */
  generateListDisplay(item: SqueezeCacheItem): string {
    const result = this.evaluateFromCacheItem(item);
    
    // 如果风险等级太低（low且score<5），不展示风险
    if (result.riskLevel === 'low' && item.score < 5) {
      return '';
    }

    const riskText = result.riskLevel === 'extreme' ? '极高' : 
                     result.riskLevel === 'high' ? '高' : 
                     result.riskLevel === 'medium' ? '中' : '低';
    
    return `${result.riskEmoji} ${riskText} ｜${result.confidenceEmoji}`;
  }

  /**
   * 生成推送展示（F5.2：克制格式）
   */
  generatePushDisplay(item: SqueezeCacheItem): string {
    const result = this.evaluateFromCacheItem(item);
    
    const riskText = result.riskLevel === 'extreme' ? '极高' : 
                     result.riskLevel === 'high' ? '高' : 
                     result.riskLevel === 'medium' ? '中' : '低';
    
    let display = `风险等级：${result.riskEmoji} ${riskText}\n`;
    display += `结构可信度：${result.confidenceEmoji}`;
    
    if (result.notes) {
      display += `\n${result.notes}`;
    }
    
    return display;
  }

  /**
   * 生成详情页展示（F5.3）
   */
  generateDetailDisplay(item: SqueezeCacheItem): string {
    const result = this.evaluateFromCacheItem(item);
    
    let display = `风险等级：${result.riskEmoji} ${result.riskLabel}\n`;
    display += `结构可信度：${result.confidenceEmoji}（${result.confidenceLabel}）`;
    
    if (result.notes) {
      display += `\n${result.notes}`;
    }
    
    return display;
  }
}

// 导出单例（推荐使用）
export const squeezeRiskEngine = new SqueezeRiskEngine();

