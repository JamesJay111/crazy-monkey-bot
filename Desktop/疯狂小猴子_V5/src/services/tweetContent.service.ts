import { DeepSeekClient } from '../clients/deepseek.client';
import { ContractSnapshot } from '../types';
import { logger } from '../utils/logger';
import { formatLargeNumber } from '../utils/formatter';
import { CoinGlassClient } from '../clients/coinglass.client';

/**
 * 历史数据接口（用于深度分析）
 */
export interface HistoricalData {
  fundingRateHistory: any[]; // 资金费率历史（6根）
  positionRatioHistory: any[]; // 持仓多空比历史（2根，用于对比）
  takerHistory: any[]; // Taker 历史（当前）
}

/**
 * 推文内容生成服务
 * 格式化推文模板，调用 DeepSeek 生成结论和深度分析
 */
export class TweetContentService {
  constructor(
    private deepseek: DeepSeekClient,
    private coinglass?: CoinGlassClient
  ) {}

  /**
   * 格式化金额（推文用）
   * ≥ 1,000,000 → 用 M，保留 2 位小数，例如 $107.56M
   * < 1,000,000 → $ + 千分位 + 2 位小数
   */
  private formatAmount(value: number): string {
    if (value <= 0) return '$0.00';
    
    if (value >= 1_000_000) {
      const millions = value / 1_000_000;
      return `$${millions.toFixed(2)}M`;
    }
    
    // 千分位格式化
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  /**
   * 格式化 Funding Rate（转成百分比，保留 2 位小数）
   * 注意：不允许返回 "-"，数据不完整应由 validator 保证跳过
   */
  private formatFundingRate(rate: number | null | undefined, error?: string | null): string {
    // 如果 validator 通过，这里不应该有 error，但为了安全还是检查
    if (error) {
      logger.error({ error }, 'formatFundingRate called with error, should have been caught by validator');
      throw new Error('Funding rate has error, should not format');
    }
    if (rate === null || rate === undefined) {
      logger.error('formatFundingRate called with null/undefined, should have been caught by validator');
      throw new Error('Funding rate is missing, should not format');
    }
    
    // 转成百分比（rate 是小数，如 0.01 表示 1%，允许负值）
    const percent = rate * 100;
    return `${percent >= 0 ? '+' : ''}${percent.toFixed(2)}%`;
  }

  /**
   * 格式化百分比（保留 2 位）
   * 注意：不允许返回 "-"，数据不完整应由 validator 保证跳过
   */
  private formatPercent(value: number): string {
    if (value <= 0) {
      logger.error({ value }, 'formatPercent called with <= 0, should have been caught by validator');
      throw new Error('Percent value is invalid, should not format');
    }
    return `${value.toFixed(2)}%`;
  }

  /**
   * 格式化多空比（保留 2 位）
   * 注意：不允许返回 "-"，数据不完整应由 validator 保证跳过
   */
  private formatRatio(value: number): string {
    if (value <= 0) {
      logger.error({ value }, 'formatRatio called with <= 0, should have been caught by validator');
      throw new Error('Ratio value is invalid, should not format');
    }
    return value.toFixed(2);
  }

  /**
   * 生成推文内容（Twitter 专用模板）
   * @param snapshot 合约快照数据
   * @param historicalData 历史数据（可选，用于深度分析）
   * @returns 完整的推文内容
   */
  async generateTweet(snapshot: ContractSnapshot, historicalData?: HistoricalData): Promise<string> {
    // 1. 生成基础数据部分（严格按照新模板）
    const baseData = this.generateTwitterBaseData(snapshot);
    
    // 2. 生成 DeepSeek 分析块（结构分析 + 风险观察）
    let deepseekAnalysisBlock = '';
    let riskBlock = '';
    
    if (historicalData) {
      try {
        const analysisResult = await this.generateTwitterDeepSeekAnalysis(snapshot, historicalData);
        deepseekAnalysisBlock = analysisResult.analysisBlock;
        riskBlock = analysisResult.riskBlock;
      } catch (error) {
        logger.warn({ error, symbol: snapshot.symbol }, 'Failed to generate DeepSeek analysis, using fallback');
        // 使用 fallback
        const fallback = this.getFallbackTwitterAnalysis(snapshot, historicalData);
        deepseekAnalysisBlock = fallback.analysisBlock;
        riskBlock = fallback.riskBlock;
      }
    } else {
      // 没有历史数据，使用 fallback
      const fallback = this.getFallbackTwitterAnalysis(snapshot, historicalData);
      deepseekAnalysisBlock = fallback.analysisBlock;
      riskBlock = fallback.riskBlock;
    }

    // 3. 拼接完整推文（严格按照模板格式）
    return `${baseData}

—

结构分析｜${snapshot.symbol} 合约（4h）

${deepseekAnalysisBlock}

—

结构性风险观察

${riskBlock}

⚠️ 本内容为结构观察，不构成投资或交易建议。`;
  }

  /**
   * 生成结构状态标签
   */
  private generateStructureTag(snapshot: ContractSnapshot): string {
    const topRatio = snapshot.topAccountLongShortRatio;
    const fundingRate = snapshot.fundingRate || 0;
    const takerBuy = snapshot.takerBuyVolUsd || 0;
    const takerSell = snapshot.takerSellVolUsd || 0;
    const takerTotal = takerBuy + takerSell;
    const imbalance = takerTotal > 0 ? (takerBuy - takerSell) / takerTotal : 0;

    // 判断结构状态
    const isTopLong = topRatio > 1.1;
    const isTopShort = topRatio < 0.9;
    const isFundingHigh = fundingRate > 0.01;
    const isFundingLow = fundingRate < -0.01;
    const isTakerLong = imbalance > 0.1;
    const isTakerShort = imbalance < -0.1;

    if (isTopLong && isFundingHigh && isTakerLong) {
      return '多头拥挤';
    } else if (isTopShort && isFundingLow && isTakerShort) {
      return '空头拥挤';
    } else if (isTopLong && isFundingLow) {
      return '结构分歧';
    } else if (isTopShort && isFundingHigh) {
      return '结构分歧';
    } else if (Math.abs(fundingRate) < 0.001) {
      return '相对均衡';
    } else {
      return '结构观察';
    }
  }

  /**
   * 生成 Twitter 基础数据部分（严格按照新模板格式）
   */
  private generateTwitterBaseData(snapshot: ContractSnapshot): string {
    const oiUsd = this.formatAmount(snapshot.oiUsd);
    const fundingRate = this.formatFundingRate(snapshot.fundingRate, snapshot.fundingRateError);
    const takerBuy = this.formatAmount(snapshot.takerBuyVolUsd);
    const takerSell = this.formatAmount(snapshot.takerSellVolUsd);
    const topLong = this.formatPercent(snapshot.topAccountLongPercent);
    const topShort = this.formatPercent(snapshot.topAccountShortPercent);
    const topRatio = this.formatRatio(snapshot.topAccountLongShortRatio);

    return `📊 合约数据概览｜${snapshot.symbol}
Binance · 4h

—

合约持仓（OI）
总持仓（4h 前）：${oiUsd}

资金费率
Funding Rate：${fundingRate}

主动成交方向
主动买入：${takerBuy}
主动卖出：${takerSell}

大户持仓结构（最近一周期）
多单占比：${topLong}
空单占比：${topShort}
多空比：${topRatio}

数据说明
以上数据基于 ≥4h 粒度的合约市场统计`;
  }

  /**
   * 调用 DeepSeek 生成一句话结论
   * 约束：不出现「做多/做空/买卖建议/目标价/价格预测」
   * 只输出结构性总结（拥挤、分歧、一致性、扰动敏感等）
   */
  private async generateOneLiner(snapshot: ContractSnapshot): Promise<string> {
    try {
      const systemPrompt = `你是一个专业的合约市场结构分析师。根据提供的合约数据，生成一句话结构性总结。

要求：
1. 只输出一句话（不超过 50 字）
2. 不包含「做多/做空/买卖建议/目标价/价格预测」
3. 只描述结构性特征：拥挤、分歧、一致性、扰动敏感、持仓结构等
4. 用中文输出
5. 语气客观、专业`;

      const userPrompt = `合约数据：
- 币种：${snapshot.symbol}
- OI（4h）：$${formatLargeNumber(snapshot.oiUsd)}
- Funding Rate：${snapshot.fundingRate !== null && snapshot.fundingRate !== undefined ? (snapshot.fundingRate * 100).toFixed(4) + '%' : '—'}
- Taker 买入：$${formatLargeNumber(snapshot.takerBuyVolUsd)}
- Taker 卖出：$${formatLargeNumber(snapshot.takerSellVolUsd)}
- 大户多单占比：${snapshot.topAccountLongPercent.toFixed(2)}%
- 大户空单占比：${snapshot.topAccountShortPercent.toFixed(2)}%
- 大户多空比：${snapshot.topAccountLongShortRatio.toFixed(4)}

请生成一句话结构性总结。`;

      const response = await this.deepseek.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ]);

      const oneLiner = response.content.trim();

      // 验证：如果包含禁止词汇，使用默认结论
      const forbiddenWords = ['做多', '做空', '买入', '卖出', '目标价', '价格预测', '建议'];
      if (forbiddenWords.some(word => oneLiner.includes(word))) {
        logger.warn('DeepSeek response contains forbidden words, using fallback');
        return this.getFallbackOneLiner(snapshot);
      }

      logger.debug({ symbol: snapshot.symbol, oneLiner }, 'One-liner generated by DeepSeek');
      return oneLiner;
    } catch (error) {
      logger.error({ error, symbol: snapshot.symbol }, 'Failed to generate one-liner, using fallback');
      return this.getFallbackOneLiner(snapshot);
    }
  }

  /**
   * 生成 Twitter DeepSeek 分析（结构分析 + 风险观察）
   * @param snapshot 合约快照数据
   * @param historicalData 历史数据
   * @returns 结构分析块和风险观察块
   */
  private async generateTwitterDeepSeekAnalysis(
    snapshot: ContractSnapshot,
    historicalData: HistoricalData
  ): Promise<{ analysisBlock: string; riskBlock: string }> {
    try {
      // 分别生成结构分析和风险观察
      const [analysisResponse, riskResponse] = await Promise.all([
        this.generateStructureAnalysis(snapshot, historicalData),
        this.generateRiskObservation(snapshot, historicalData),
      ]);

      // 验证并清理输出
      const analysisBlock = this.validateAndCleanDeepSeekOutput(analysisResponse, 'analysis');
      const riskBlock = this.validateAndCleanDeepSeekOutput(riskResponse, 'risk');

      logger.debug({ symbol: snapshot.symbol }, 'Twitter DeepSeek analysis generated');
      return { analysisBlock, riskBlock };
    } catch (error) {
      logger.error({ error, symbol: snapshot.symbol }, 'Failed to generate Twitter DeepSeek analysis');
      throw error;
    }
  }

  /**
   * 生成结构分析（DeepSeek）
   */
  private async generateStructureAnalysis(
    snapshot: ContractSnapshot,
    historicalData: HistoricalData
  ): Promise<string> {
    const systemPrompt = `你是专业合约市场结构分析师。根据提供的合约数据，生成结构分析。

**严格约束**：
1. 只描述结构性特征：仓位结构、资金费率趋势、主动成交方向、结构一致性
2. 绝对禁止包含：数值（$、%、具体数字）、做多/做空/买卖/预测/建议、Markdown 标题、免责声明
3. 不重复基础数据（基础数据已在推文前半部分展示）
4. 用简体中文输出，语气客观专业
5. 若数据不足，用非技术口吻说明，不要提及"API/限流/数据不足"等技术词汇

**输出要求**：
只输出结构分析文本，不要包含标题、分点符号、数值。`;

    const userPrompt = this.buildStructureAnalysisPrompt(snapshot, historicalData);

    const response = await this.deepseek.analyzeWithPrompt(
      systemPrompt,
      userPrompt,
      { temperature: 0.3, maxTokens: 500 }
    );

    // analyzeWithPrompt 返回 string
    return typeof response === 'string' ? response.trim() : String(response).trim();
  }

  /**
   * 生成风险观察（DeepSeek）
   */
  private async generateRiskObservation(
    snapshot: ContractSnapshot,
    historicalData: HistoricalData
  ): Promise<string> {
    const systemPrompt = `你是专业合约市场结构分析师。根据提供的合约数据，生成结构性风险观察。

**严格约束**：
1. 只讨论结构错配/脆弱性，不涉及价格预测
2. 绝对禁止包含：数值（$、%、具体数字）、做多/做空/买卖/预测/建议、Markdown 标题、免责声明
3. 用简体中文输出，语气客观专业
4. 若数据不足，用非技术口吻说明

**输出要求**：
只输出风险观察文本，不要包含标题、分点符号、数值。`;

    const userPrompt = this.buildRiskObservationPrompt(snapshot, historicalData);

    const response = await this.deepseek.analyzeWithPrompt(
      systemPrompt,
      userPrompt,
      { temperature: 0.3, maxTokens: 300 }
    );

    // analyzeWithPrompt 返回 string
    return typeof response === 'string' ? response.trim() : String(response).trim();
  }

  /**
   * 构建结构分析 Prompt
   */
  private buildStructureAnalysisPrompt(
    snapshot: ContractSnapshot,
    historicalData: HistoricalData
  ): string {
    // 计算结构特征（不传递具体数值，只传递定性描述）
    const topBias = snapshot.topAccountLongShortRatio > 1.1 ? '偏多' : 
                    snapshot.topAccountLongShortRatio < 0.9 ? '偏空' : '中性';
    const fundingBias = snapshot.fundingRate > 0.01 ? '多头支付费用' : 
                        snapshot.fundingRate < -0.01 ? '空头支付费用' : '相对均衡';
    const takerTotal = snapshot.takerBuyVolUsd + snapshot.takerSellVolUsd;
    const takerImbalance = takerTotal > 0 
      ? (snapshot.takerBuyVolUsd - snapshot.takerSellVolUsd) / takerTotal
      : 0;
    const takerBias = takerImbalance > 0.1 ? '偏多' : 
                      takerImbalance < -0.1 ? '偏空' : '均衡';

    // 判断结构一致性
    const consistency = (topBias === '偏多' && fundingBias.includes('多头')) || 
                       (topBias === '偏空' && fundingBias.includes('空头')) 
                       ? '一致' : '分歧';

    // 资金费率趋势（定性描述）
    let fundingTrend = '相对稳定';
    if (historicalData.fundingRateHistory.length >= 2) {
      const latest = historicalData.fundingRateHistory[0]?.funding_rate || 0;
      const previous = historicalData.fundingRateHistory[1]?.funding_rate || 0;
      if (latest > previous * 1.1) fundingTrend = '上升趋势';
      else if (latest < previous * 0.9) fundingTrend = '下降趋势';
    }

    return `合约结构数据（定性描述）：
- 币种：${snapshot.symbol}
- 大户持仓结构：${topBias}
- 资金费率状态：${fundingBias}，趋势：${fundingTrend}
- 主动成交方向：${takerBias}
- 结构一致性：${consistency}

请生成结构分析，只描述结构性特征，不要包含数值、交易建议。`;
  }

  /**
   * 构建风险观察 Prompt
   */
  private buildRiskObservationPrompt(
    snapshot: ContractSnapshot,
    historicalData: HistoricalData
  ): string {
    const topBias = snapshot.topAccountLongShortRatio > 1.1 ? '偏多' : 
                    snapshot.topAccountLongShortRatio < 0.9 ? '偏空' : '中性';
    const fundingBias = snapshot.fundingRate > 0.01 ? '多头支付费用' : 
                        snapshot.fundingRate < -0.01 ? '空头支付费用' : '相对均衡';
    const consistency = (topBias === '偏多' && fundingBias.includes('多头')) || 
                       (topBias === '偏空' && fundingBias.includes('空头')) 
                       ? '一致' : '分歧';

    return `合约结构数据（定性描述）：
- 币种：${snapshot.symbol}
- 大户持仓结构：${topBias}
- 资金费率状态：${fundingBias}
- 结构一致性：${consistency}

请生成结构性风险观察，只讨论结构错配/脆弱性，不要包含数值、价格预测、交易建议。`;
  }

  /**
   * 验证并清理 DeepSeek 输出
   */
  private validateAndCleanDeepSeekOutput(output: string, type: 'analysis' | 'risk'): string {
    // 移除 Markdown 标题
    let cleaned = output.replace(/^#{1,6}\s+/gm, '').trim();
    
    // 移除可能的代码块标记
    cleaned = cleaned.replace(/^```[\w]*\n?/gm, '').replace(/```$/gm, '').trim();
    
    // 检查禁止词
    const forbiddenWords = [
      '做多', '做空', '买入', '卖出', '买卖', '建议', '目标价', '价格预测',
      '建议做', '建议买', '建议卖', '预测', '$', '%', '美元', '百分比'
    ];
    
    // 检查是否包含数值（简单检查，避免误判）
    const hasNumber = /\d+[\.\d]*[%$]/.test(cleaned);
    
    const hasForbiddenWord = forbiddenWords.some(word => cleaned.includes(word));
    
    if (hasForbiddenWord || hasNumber) {
      logger.warn({ type, hasForbiddenWord, hasNumber }, 'DeepSeek output contains forbidden content, using fallback');
      return this.getFallbackTwitterAnalysisBlock(type);
    }
    
    return cleaned;
  }

  /**
   * 获取 Fallback 结构分析块
   */
  private getFallbackTwitterAnalysisBlock(type: 'analysis' | 'risk'): string {
    if (type === 'analysis') {
      return '当前合约结构显示持仓分布与资金费率存在一定关联性，主动成交方向与大户持仓结构基本一致，整体结构相对稳定。';
    } else {
      return '当前结构存在一定脆弱性，需持续观察结构变化。资金费率与持仓结构的匹配度影响整体稳定性。';
    }
  }

  /**
   * 准备分析数据
   */
  private prepareAnalysisData(snapshot: ContractSnapshot, historicalData: HistoricalData): any {
    // 计算失衡度
    const takerTotal = snapshot.takerBuyVolUsd + snapshot.takerSellVolUsd;
    const imbalance = takerTotal > 0 
      ? ((snapshot.takerBuyVolUsd - snapshot.takerSellVolUsd) / takerTotal).toFixed(4)
      : '0.0000';

    // 处理持仓比变化
    let positionChange = '';
    let positionChangeStrength = '中';
    if (historicalData.positionRatioHistory.length >= 2) {
      const latest = historicalData.positionRatioHistory[0];
      const previous = historicalData.positionRatioHistory[1];
      const latestRatio = parseFloat(String(latest.top_position_long_short_ratio || latest.top_account_long_short_ratio || '1.0'));
      const previousRatio = parseFloat(String(previous.top_position_long_short_ratio || previous.top_account_long_short_ratio || '1.0'));
      const change = latestRatio - previousRatio;
      const changePercent = previousRatio > 0 ? (change / previousRatio * 100).toFixed(2) : '0.00';
      
      const direction = change > 0 ? '上升' : change < 0 ? '下降' : '持平';
      const latestBias = latestRatio > 1.1 ? '偏多' : latestRatio < 0.9 ? '偏空' : '中性';
      const previousBias = previousRatio > 1.1 ? '偏多' : previousRatio < 0.9 ? '偏空' : '中性';
      
      const changePercentNum = parseFloat(changePercent);
      if (Math.abs(changePercentNum) > 10) positionChangeStrength = '强';
      else if (Math.abs(changePercentNum) < 5) positionChangeStrength = '弱';
      
      positionChange = `${direction}。最新比值 ${latestRatio.toFixed(2)}（${latestBias}），上一根比值 ${previousRatio.toFixed(2)}（${previousBias}），变化幅度 ${changePercent}%，强度：${positionChangeStrength}`;
    }

    // 处理资金费率序列（6根，4h 间隔）
    const fundingSequence = historicalData.fundingRateHistory
      .slice(0, 6)
      .map((item: any) => parseFloat(item.funding_rate || '0'))
      .reverse(); // 从旧到新
    
    // 生成资金费率历史描述
    let fundingHistoryDesc = '数据不足，暂不展开';
    if (fundingSequence.length >= 6) {
      const oiWeighted = fundingSequence.map((r: number) => (r * 100).toFixed(6)).join(', ');
      const volumeWeighted = fundingSequence.map((r: number) => (r * 100).toFixed(6)).join(', '); // 简化处理
      fundingHistoryDesc = `OI加权序列：[${oiWeighted}]，成交量加权序列：[${volumeWeighted}]`;
    } else if (fundingSequence.length > 0) {
      fundingHistoryDesc = `数据不足，暂不展开（仅${fundingSequence.length}根）`;
    }

    // 计算结构一致性
    const topBias = snapshot.topAccountLongShortRatio > 1.1 ? '偏多' : snapshot.topAccountLongShortRatio < 0.9 ? '偏空' : '中性';
    const fundingBias = snapshot.fundingRate > 0.01 ? '多头支付费用' : snapshot.fundingRate < -0.01 ? '空头支付费用' : '相对均衡';
    const takerBias = parseFloat(imbalance) > 0.1 ? '偏多' : parseFloat(imbalance) < -0.1 ? '偏空' : '均衡';
    
    const consistencyResult = (topBias === '偏多' && fundingBias.includes('多头')) || (topBias === '偏空' && fundingBias.includes('空头')) ? '一致' : '分歧';
    const consistencyExplanation = `仓位结构${topBias}，资金费率${fundingBias}，主动成交${takerBias}，三者关系${consistencyResult === '一致' ? '一致' : '存在分歧'}`;
    const consistencySummary = consistencyResult === '一致' ? '结构一致，市场情绪统一' : '结构分歧，需持续观察';

    return {
      symbol: snapshot.symbol,
      currentFunding: snapshot.fundingRate,
      fundingSequence,
      fundingHistoryDesc,
      currentTopLong: snapshot.topAccountLongPercent,
      currentTopShort: snapshot.topAccountShortPercent,
      currentTopRatio: snapshot.topAccountLongShortRatio,
      positionChange: positionChange || '数据不足，暂不展开',
      takerBuy: snapshot.takerBuyVolUsd,
      takerSell: snapshot.takerSellVolUsd,
      imbalance,
      takerSentimentDesc: takerBias,
      consistencyResult,
      consistencyExplanation,
      consistencySummary,
      riskCrowding: fundingBias !== '相对均衡' ? `资金费率${fundingBias}，市场存在一定拥挤` : '资金费率相对均衡',
      riskReversal: '结构变化需持续观察',
      riskFragility: '当前结构相对稳定',
    };
  }

  /**
   * 构建分析 prompt
   */
  private buildAnalysisPrompt(data: any): string {
    return `合约数据：
- 币种：${data.symbol}
- 当前资金费率：${(data.currentFunding * 100).toFixed(6)}%
- 近6根资金费率序列（4h间隔）：${data.fundingSequence.length > 0 ? data.fundingSequence.map((r: number) => (r * 100).toFixed(6)).join(', ') + '%' : '数据不足'}
- 当前大户多单占比：${data.currentTopLong.toFixed(2)}%
- 当前大户空单占比：${data.currentTopShort.toFixed(2)}%
- 当前大户多空比：${data.currentTopRatio.toFixed(4)}
- 持仓比变化：${data.positionChange}
- Taker 买入：$${formatLargeNumber(data.takerBuy)}
- Taker 卖出：$${formatLargeNumber(data.takerSell)}
- 失衡度计算：(buy-sell)/(buy+sell)=${data.imbalance}

请严格按照要求的格式生成深度分析，必须包含 🔎 结构总评 和 1⃣2⃣3⃣4⃣5⃣ 五个分点，不允许修改结构。`;
  }

  /**
   * 验证并修复分析格式
   */
  private validateAndFixAnalysisFormat(analysis: string, snapshot: ContractSnapshot, historicalData: HistoricalData, analysisData?: any): string {
    // 检查禁止词
    const forbiddenWords = ['做多', '做空', '买入', '卖出', '目标价', '价格预测', '建议', '建议做', '建议买', '建议卖'];
    const hasForbiddenWord = forbiddenWords.some(word => analysis.includes(word));
    
    if (hasForbiddenWord) {
      logger.warn('DeepSeek response contains forbidden words, using fallback');
      return this.getFallbackDeepAnalysis(snapshot, historicalData, analysisData);
    }

    // 确保包含标题和结构总评
    if (!analysis.includes('🧠 合约结构深度分析')) {
      analysis = `🧠 合约结构深度分析｜${snapshot.symbol}（Binance · 4h）\n\n${analysis}`;
    }
    if (!analysis.includes('🔎 结构总评：')) {
      // 在标题后插入结构总评
      analysis = analysis.replace(
        /🧠 合约结构深度分析｜.*?（Binance · 4h）/,
        `$&\n\n🔎 结构总评：${analysisData.consistencySummary}`
      );
    }

    // 移除可能的 Markdown 标题
    analysis = analysis.replace(/^#{1,6}\s+/gm, '');

    // 确保包含结构总评
    if (!analysis.includes('🔎 结构总评：')) {
      const data = analysisData || this.prepareAnalysisData(snapshot, historicalData);
      // 在标题后插入结构总评
      if (analysis.includes('🧠 合约结构深度分析')) {
        analysis = analysis.replace(
          /(🧠 合约结构深度分析｜.*?（Binance · 4h）)/,
          `$1\n\n🔎 结构总评：${data.consistencySummary}`
        );
      } else {
        analysis = `🧠 合约结构深度分析｜${snapshot.symbol}（Binance · 4h）\n\n🔎 结构总评：${data.consistencySummary}\n\n${analysis}`;
      }
    }

    // 确保最后有说明
    if (!analysis.includes('⚠️ 本内容为结构观察')) {
      analysis += '\n\n⚠️ 本内容为结构观察，不构成投资或交易建议。';
    }

    return analysis;
  }

  /**
   * 获取 Twitter Fallback 分析（当 DeepSeek 失败时使用）
   */
  private getFallbackTwitterAnalysis(
    snapshot: ContractSnapshot,
    historicalData?: HistoricalData
  ): { analysisBlock: string; riskBlock: string } {
    const topBias = snapshot.topAccountLongShortRatio > 1.1 ? '偏多' : 
                    snapshot.topAccountLongShortRatio < 0.9 ? '偏空' : '中性';
    const fundingBias = snapshot.fundingRate > 0.01 ? '多头支付费用' : 
                        snapshot.fundingRate < -0.01 ? '空头支付费用' : '相对均衡';
    const takerTotal = snapshot.takerBuyVolUsd + snapshot.takerSellVolUsd;
    const takerImbalance = takerTotal > 0 
      ? (snapshot.takerBuyVolUsd - snapshot.takerSellVolUsd) / takerTotal
      : 0;
    const takerBias = takerImbalance > 0.1 ? '偏多' : 
                      takerImbalance < -0.1 ? '偏空' : '均衡';
    const consistency = (topBias === '偏多' && fundingBias.includes('多头')) || 
                       (topBias === '偏空' && fundingBias.includes('空头')) 
                       ? '一致' : '分歧';

    const analysisBlock = `当前合约结构显示大户持仓${topBias}，资金费率${fundingBias}，主动成交方向${takerBias}。整体结构${consistency === '一致' ? '一致' : '存在分歧'}，市场情绪${consistency === '一致' ? '相对统一' : '存在分化'}。`;

    const riskBlock = consistency === '分歧' 
      ? '当前结构存在分歧，持仓结构与资金费率不匹配，需持续观察结构变化。结构脆弱性较高，市场对扰动较为敏感。'
      : '当前结构相对一致，但资金费率状态显示市场存在一定拥挤。需关注结构变化，避免过度拥挤导致的结构性风险。';

    return { analysisBlock, riskBlock };
  }

  /**
   * 获取默认深度分析（Fallback，当 DeepSeek 失败或包含禁止词时使用）
   * 注意：此方法保留用于向后兼容，Twitter 模板使用 getFallbackTwitterAnalysis
   */
  private getFallbackDeepAnalysis(snapshot: ContractSnapshot, historicalData: HistoricalData, analysisData?: any): string {
    // 如果没有提供 analysisData，使用 prepareAnalysisData 生成
    if (!analysisData) {
      analysisData = this.prepareAnalysisData(snapshot, historicalData);
    }
    const imbalance = (snapshot.takerBuyVolUsd + snapshot.takerSellVolUsd) > 0
      ? ((snapshot.takerBuyVolUsd - snapshot.takerSellVolUsd) / (snapshot.takerBuyVolUsd + snapshot.takerSellVolUsd)).toFixed(4)
      : '0.0000';
    
    const imbalanceBias = parseFloat(imbalance) > 0.1 ? '偏多' : parseFloat(imbalance) < -0.1 ? '偏空' : '均衡';
    const topBias = snapshot.topAccountLongShortRatio > 1.1 ? '偏多' : snapshot.topAccountLongShortRatio < 0.9 ? '偏空' : '中性';
    const fundingBias = snapshot.fundingRate > 0.01 ? '多头支付费用' : snapshot.fundingRate < -0.01 ? '空头支付费用' : '相对均衡';

    const consistencyResult = (topBias === '偏多' && fundingBias.includes('多头')) || (topBias === '偏空' && fundingBias.includes('空头')) ? '一致' : '分歧';
    const consistencyExplanation = `仓位结构${topBias}，资金费率${fundingBias}，主动成交${imbalanceBias}，三者关系${consistencyResult === '一致' ? '一致' : '存在分歧'}`;
    const consistencySummary = consistencyResult === '一致' ? '结构一致，市场情绪统一' : '结构分歧，需持续观察';

    return `🧠 合约结构深度分析｜${snapshot.symbol}（Binance · 4h）

🔎 结构总评：${consistencySummary}

1⃣ 仓位结构（大户）
- 当前：多 ${snapshot.topAccountLongPercent.toFixed(2)}% / 空 ${snapshot.topAccountShortPercent.toFixed(2)}% ｜比值 ${snapshot.topAccountLongShortRatio.toFixed(2)}
- 变化：${analysisData?.positionChange || '数据不足，暂不展开'}

2⃣ 资金费率（拥挤度）
- 当前 funding：${(snapshot.fundingRate * 100).toFixed(6)}%
- 近6根对比：${analysisData?.fundingHistoryDesc || '数据不足，暂不展开'}

3⃣ 主动成交（短周期情绪）
- 买：$${formatLargeNumber(snapshot.takerBuyVolUsd)} / 卖：$${formatLargeNumber(snapshot.takerSellVolUsd)}
- 失衡度：${imbalance} → ${imbalanceBias}

4⃣ 结构一致性
- 结论：${consistencyResult}
- 解释：${consistencyExplanation}

5⃣ 风险清单（仅结构）
- 拥挤度风险：${analysisData?.riskCrowding || (fundingBias !== '相对均衡' ? `资金费率${fundingBias}，市场存在一定拥挤` : '资金费率相对均衡')}
- 反转风险：${analysisData?.riskReversal || '结构变化需持续观察'}
- 结构脆弱性风险：${analysisData?.riskFragility || '当前结构相对稳定'}

⚠️ 本内容为结构观察，不构成投资或交易建议。`;
  }

  /**
   * 获取默认结论（Fallback）
   */
  private getFallbackOneLiner(snapshot: ContractSnapshot): string {
    // 基于数据生成简单的结构性描述
    const fundingRate = snapshot.fundingRate || 0;
    const takerBuy = snapshot.takerBuyVolUsd || 0;
    const takerSell = snapshot.takerSellVolUsd || 0;
    const topRatio = snapshot.topAccountLongShortRatio || 1.0;

    if (fundingRate > 0.01) {
      return '多头支付费用，市场偏向多头拥挤';
    } else if (fundingRate < -0.01) {
      return '空头支付费用，市场偏向空头拥挤';
    } else if (takerBuy > takerSell * 1.2) {
      return '主动买入明显高于卖出，买方情绪较强';
    } else if (takerSell > takerBuy * 1.2) {
      return '主动卖出明显高于买入，卖方情绪较强';
    } else if (topRatio > 1.2) {
      return '大户多单占比偏高，持仓结构偏向多头';
    } else if (topRatio < 0.8) {
      return '大户空单占比偏高，持仓结构偏向空头';
    } else {
      return '市场结构相对均衡，无明显偏向';
    }
  }
}

