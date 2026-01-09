import { CoinGlassClient } from '../clients/coinglass.client';
import { DeepSeekClient } from '../clients/deepseek.client';
import { ContractSnapshotService } from './contractSnapshot.service';
import { logger } from '../utils/logger';
import { formatLargeNumber, formatPercent } from '../utils/formatter';
import { ContractSnapshot, ContractAnalysis } from '../types';
import { buildContractAnalysisPrompt, CONTRACT_ANALYSIS_SYSTEM_PROMPT } from '../prompts/contract.prompt';

/**
 * 合约查询服务（重构版）
 * 整合合约快照 + 爆仓数据 + DeepSeek 分析
 */
export class ContractService {
  private snapshotService: ContractSnapshotService;

  constructor(
    private coinglass: CoinGlassClient,
    private deepseek: DeepSeekClient
  ) {
    // 初始化 LiquidationService 和 ContractSnapshotService
    const { LiquidationService } = require('./liquidation.service');
    const liquidationService = new LiquidationService(coinglass);
    this.snapshotService = new ContractSnapshotService(coinglass, liquidationService);
  }

  /**
   * 获取合约快照（免费阶段）
   */
  async getContractSnapshot(baseSymbol: string): Promise<ContractSnapshot> {
    return this.snapshotService.getContractSnapshot(baseSymbol);
  }

  /**
   * 格式化合约快照（免费阶段输出）
   * 按照固定消息结构：只展示数值，不做分析，信息密度高但结构清晰
   */
  formatContractSnapshot(snapshot: ContractSnapshot): string {
    // 格式化数值（保持原始精度）
    const formatOI = (value: number): string => {
      if (value <= 0) return '—';
      return `$${formatLargeNumber(value)}`;
    };
    
    const formatFundingRate = (value: number): string => {
      if (value === 0) return '—';
      // 保持原始精度，直接显示原值（例如 0.007343），不转换为百分比
      return value.toString();
    };
    
    const formatTakerVol = (value: number): string => {
      if (value <= 0) return '—';
      return `$${formatLargeNumber(value)}`;
    };
    
    const formatPercent = (value: number): string => {
      if (value <= 0) return '—';
      return `${value.toFixed(2)}%`;
    };
    
    const formatRatio = (value: number): string => {
      if (value <= 0 || value === 1.0) return '—';
      return value.toString();
    };
    
    let message = `📊 合约数据概览｜${snapshot.symbol}\n\n`;
    
    // 📌 合约持仓（OI）
    message += `📌 合约持仓（OI）\n`;
    message += `总持仓（4h 前）：${formatOI(snapshot.oiUsd)}\n\n`;
    
    // 💰 当前资金费率
    message += `💰 当前资金费率\n`;
    if (snapshot.fundingRateError) {
      message += `Funding Rate：${snapshot.fundingRateError}\n\n`;
    } else if (snapshot.fundingRate !== 0) {
      message += `Funding Rate：${formatFundingRate(snapshot.fundingRate)}\n\n`;
    } else {
      message += `Funding Rate：—\n\n`;
    }
    
    // 📉 主动成交方向
    message += `📉 主动成交方向\n`;
    message += `主动买入：${formatTakerVol(snapshot.takerBuyVolUsd)}\n`;
    message += `主动卖出：${formatTakerVol(snapshot.takerSellVolUsd)}\n\n`;
    
    // 🐳 大户持仓结构（最近一周期）
    message += `🐳 大户持仓结构（最近一周期）\n`;
    message += `多单占比：${formatPercent(snapshot.topAccountLongPercent)}\n`;
    message += `空单占比：${formatPercent(snapshot.topAccountShortPercent)}\n`;
    message += `多空比：${formatRatio(snapshot.topAccountLongShortRatio)}\n\n`;
    
    // ⏱ 数据说明
    message += `⏱ 数据说明：\n`;
    message += `所有数据基于 ≥4h 粒度的合约市场统计`;
    
    return message;
  }

  /**
   * 格式化资金费率结算间隔
   */
  private formatFundingInterval(nextFundingTime: number): string {
    if (nextFundingTime === 0) return '8h';
    
    const now = Date.now();
    const diff = nextFundingTime - now;
    const hours = Math.floor(diff / (1000 * 60 * 60));
    
    if (hours >= 8) return '8h';
    if (hours >= 4) return '4h';
    return '1h';
  }

  /**
   * 生成 AI 分析（付费阶段）
   * 按照新需求：深度结构分析，返回原始 DeepSeek 文本响应
   */
  async analyzeContract(snapshot: ContractSnapshot): Promise<any> {
    try {
      // 获取补充历史数据（用于分析）- 时间粒度≥4h
      const [
        oiWeightFundingHistory,
        volWeightFundingHistory,
        ratioHistory,
      ] = await Promise.all([
        // 3️⃣ 持仓加权资金费率历史（K线）- 至少取 6 根用于分位判断
        this.coinglass.getFundingRateOhlcHistory({
          symbol: snapshot.symbol,
          interval: '4h',
          limit: 30,
        }).catch(() => []),
        // 4️⃣ 成交量加权资金费率历史（K线）- 至少取 6 根用于分位判断
        this.coinglass.getFundingRateOhlcHistory({
          symbol: snapshot.symbol,
          interval: '4h',
          limit: 30,
        }).catch(() => []),
        // 6️⃣ 大户持仓多空比历史 - 至少取 2-6 根用于反转判断
        this.coinglass.getTopLongShortPositionRatioHistory({
          exchange: 'Binance',
          symbol: snapshot.pairSymbol,
          interval: '4h',
          limit: 30,
        }).catch(() => []),
      ]);

      // 构建分析输入数据（按照用户要求的 JSON 格式）
      const analysisInput = {
        // 元数据
        symbol: snapshot.symbol,
        exchange: snapshot.exchange || 'Binance',
        pairSymbol: snapshot.pairSymbol,
        
        // OI（4小时前）
        oiUsd: snapshot.oiUsd,
        
        // 当前资金费率
        fundingRate: snapshot.fundingRate,
        fundingExchange: snapshot.exchange || 'Binance',
        
        // 资金费率历史（OI 加权 & 成交量加权）K 线
        fundingRateHistory: {
          oiWeighted: oiWeightFundingHistory || [],
          volWeighted: volWeightFundingHistory || [],
        },
        
        // 主动买卖成交量
        takerBuyVolUsd: snapshot.takerBuyVolUsd,
        takerSellVolUsd: snapshot.takerSellVolUsd,
        takerTimeLatest: Date.now(), // 使用当前时间作为最新时间
        
        // 大户多空比（最新）
        topAccountLongShortRatio: snapshot.topAccountLongShortRatio,
        topAccountLongPercent: snapshot.topAccountLongPercent,
        topAccountShortPercent: snapshot.topAccountShortPercent,
        topRatioTimeLatest: Date.now(), // 使用当前时间作为最新时间
        
        // 大户多空比历史（至少最近 2-6 根）
        topRatioHistory: ratioHistory || [],
      };

      // 调用 DeepSeek
      const prompt = buildContractAnalysisPrompt(analysisInput);
      const response = await this.deepseek.analyzeWithPrompt(
        CONTRACT_ANALYSIS_SYSTEM_PROMPT,
        prompt
      );
      
      // 新格式：直接返回原始文本响应（DeepSeek 会按照固定格式输出）
      // 不需要解析 JSON，因为输出格式已经是固定的文本格式
      return {
        rawResponse: response, // 原始响应文本
        symbol: snapshot.symbol,
      };
    } catch (error) {
      logger.error({ error, symbol: snapshot.symbol }, 'Failed to analyze contract');
      // 降级：使用规则判断
      return {
        rawResponse: this.fallbackAnalysisText(snapshot),
        symbol: snapshot.symbol,
      };
    }
  }

  /**
   * 计算分析可信度标签
   * 基于指标一致性判断
   */
  private calculateCredibilityLabel(snapshot: ContractSnapshot, analysis: any): {
    label: '🟢 结构一致' | '🟡 存在分歧' | '🔴 高不确定';
    explanation: string;
  } {
    // 判断各指标的方向
    const indicators: Array<{ name: string; direction: 'long' | 'short' | 'neutral' }> = [];
    
    // 1. OI 方向（基于大户多空比）
    if (snapshot.topAccountLongShortRatio > 1.2) {
      indicators.push({ name: 'OI', direction: 'long' });
    } else if (snapshot.topAccountLongShortRatio < 0.8) {
      indicators.push({ name: 'OI', direction: 'short' });
    } else {
      indicators.push({ name: 'OI', direction: 'neutral' });
    }
    
    // 2. Funding 方向
    if (snapshot.fundingRate > 0.001) {
      indicators.push({ name: 'Funding', direction: 'long' });
    } else if (snapshot.fundingRate < -0.001) {
      indicators.push({ name: 'Funding', direction: 'short' });
    } else {
      indicators.push({ name: 'Funding', direction: 'neutral' });
    }
    
    // 3. 成交方向
    if (snapshot.takerBuyVolUsd > snapshot.takerSellVolUsd * 1.2) {
      indicators.push({ name: '成交', direction: 'long' });
    } else if (snapshot.takerSellVolUsd > snapshot.takerBuyVolUsd * 1.2) {
      indicators.push({ name: '成交', direction: 'short' });
    } else {
      indicators.push({ name: '成交', direction: 'neutral' });
    }
    
    // 4. 大户方向
    if (snapshot.topAccountLongShortRatio > 1.2) {
      indicators.push({ name: '大户', direction: 'long' });
    } else if (snapshot.topAccountLongShortRatio < 0.8) {
      indicators.push({ name: '大户', direction: 'short' });
    } else {
      indicators.push({ name: '大户', direction: 'neutral' });
    }
    
    // 统计方向一致性
    const longCount = indicators.filter(i => i.direction === 'long').length;
    const shortCount = indicators.filter(i => i.direction === 'short').length;
    const neutralCount = indicators.filter(i => i.direction === 'neutral').length;
    
    // 判断可信度
    if (longCount >= 3 || shortCount >= 3) {
      // 🟢 结构一致：至少 3 个指标同方向
      const dominantDirection = longCount >= 3 ? '多头' : '空头';
      return {
        label: '🟢 结构一致',
        explanation: `OI、Funding、成交、大户指标均指向${dominantDirection}方向`,
      };
    } else if (longCount === 2 && shortCount === 2) {
      // 🔴 高不确定：指标相互冲突
      return {
        label: '🔴 高不确定',
        explanation: '多个指标方向相互冲突，市场结构不明确',
      };
    } else if (neutralCount >= 2) {
      // 🔴 高不确定：多个指标中性
      return {
        label: '🔴 高不确定',
        explanation: '多个指标处于中性状态，结构判断依据不足',
      };
    } else {
      // 🟡 存在分歧：1-2 个指标方向不一致
      return {
        label: '🟡 存在分歧',
        explanation: '部分指标方向不一致，需结合其他因素综合判断',
      };
    }
  }

  /**
   * 格式化分析结果
   * 新格式：直接显示 DeepSeek 的原始文本响应（已经是固定格式）
   */
  formatContractAnalysis(snapshot: ContractSnapshot, analysis: any): string {
    // 新格式：直接返回 DeepSeek 的原始响应文本
    // DeepSeek 已经按照固定格式输出，无需额外格式化
    if (analysis.rawResponse) {
      return analysis.rawResponse;
    }
    
    // 降级：如果没有原始响应，使用降级分析
    return analysis.rawResponse || this.fallbackAnalysisText(snapshot);
  }

  /**
   * 计算历史统计（p10/p90/last/7dChange）
   */
  private calculateHistoryStats(history: any[], valueKey: string): {
    p10: number;
    p90: number;
    last: number;
    change7d: number;
  } {
    if (!Array.isArray(history) || history.length === 0) {
      return { p10: 0, p90: 0, last: 0, change7d: 0 };
    }

    const values = history
      .map(item => parseFloat(item[valueKey] || '0'))
      .filter(v => !isNaN(v) && v > 0);

    if (values.length === 0) {
      return { p10: 0, p90: 0, last: 0, change7d: 0 };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const p10 = this.getPercentile(sorted, 10);
    const p90 = this.getPercentile(sorted, 90);
    const last = values[values.length - 1];

    // 计算 7 天变化
    const recent7 = values.slice(-7);
    const previous7 = values.slice(-14, -7);
    const recent7Avg = recent7.reduce((a, b) => a + b, 0) / recent7.length;
    const previous7Avg = previous7.length > 0 ? previous7.reduce((a, b) => a + b, 0) / previous7.length : last;
    const change7d = recent7Avg - previous7Avg;

    return { p10, p90, last, change7d };
  }

  /**
   * 降级分析（规则判断）- 返回固定格式文本
   */
  private fallbackAnalysisText(snapshot: ContractSnapshot): string {
    // 计算主动成交失衡度
    const buy = snapshot.takerBuyVolUsd || 0;
    const sell = snapshot.takerSellVolUsd || 0;
    const total = buy + sell;
    const imbalance = total > 0 ? (buy - sell) / total : 0;
    
    let imbalanceLabel = '均衡';
    if (Math.abs(imbalance) >= 0.15) {
      imbalanceLabel = '明显失衡';
    } else if (Math.abs(imbalance) >= 0.05) {
      imbalanceLabel = '轻度失衡';
    }
    
    const directionLabel = buy > sell ? '买方更激进' : sell > buy ? '卖方更激进' : '均衡';
    
    // 判断大户多空
    const ratio = snapshot.topAccountLongShortRatio || 1.0;
    const longPercent = snapshot.topAccountLongPercent || 0;
    const shortPercent = snapshot.topAccountShortPercent || 0;
    
    let positionLabel = '均衡';
    if (ratio > 1.2) {
      positionLabel = '偏多';
    } else if (ratio < 0.8) {
      positionLabel = '偏空';
    }
    
    // 判断资金费率
    const funding = snapshot.fundingRate || 0;
    let fundingLabel = '正常';
    if (funding > 0.01) {
      fundingLabel = '偏高';
    } else if (funding < -0.01) {
      fundingLabel = '偏低';
    }
    
    // 判断结构一致性（简化）
    let consistencyLabel = '一致';
    let consistencyExplain = '各指标方向基本一致';
    
    if ((ratio > 1 && funding < 0) || (ratio < 1 && funding > 0)) {
      consistencyLabel = '分歧';
      consistencyExplain = '大户结构与资金费率方向不一致';
    }
    
    // 构建固定格式输出
    let message = `🧠 合约结构深度分析｜${snapshot.symbol}（Binance · 4h）\n\n`;
    
    message += `1) 仓位结构（大户）\n`;
    message += `- 当前：多 ${longPercent.toFixed(2)}% / 空 ${shortPercent.toFixed(2)}% ｜比值 ${ratio.toFixed(2)}\n`;
    message += `- 变化：${positionLabel}（数据不足，无法判断反转）\n\n`;
    
    message += `2) 资金费率（拥挤度）\n`;
    message += `- 当前 funding：${funding.toFixed(6)}\n`;
    message += `- 近6根对比：${fundingLabel}（历史样本不足，结论降级）\n`;
    message += `- OI加权 vs 成交量加权：数据不足\n\n`;
    
    message += `3) 主动成交（短周期情绪）\n`;
    message += `- 买：$${this.formatLargeNumber(buy)} / 卖：$${this.formatLargeNumber(sell)}\n`;
    message += `- 失衡度：${imbalance.toFixed(3)} → ${imbalanceLabel}（${directionLabel}）\n\n`;
    
    message += `4) 结构一致性\n`;
    message += `- 结论：${consistencyLabel}\n`;
    message += `- 解释：${consistencyExplain}\n\n`;
    
    message += `5) 风险清单（仅结构）\n`;
    if (funding > 0.01 && ratio > 1.3) {
      message += `- 拥挤度风险：资金费率偏高且大户偏多，存在反向挤压可能\n`;
    }
    if (Math.abs(imbalance) >= 0.15) {
      message += `- 成交失衡：主动成交明显偏向一侧，短周期情绪较强\n`;
    }
    message += `- 数据完整度：部分历史数据缺失，分析结论仅供参考\n\n`;
    
    message += `⚠️ 说明：结构分析不构成投资建议，不预测价格路径。`;
    
    return message;
  }
  
  /**
   * 格式化大数字（辅助方法）
   */
  private formatLargeNumber(value: number): string {
    if (value >= 1e9) {
      return (value / 1e9).toFixed(2) + 'B';
    } else if (value >= 1e6) {
      return (value / 1e6).toFixed(2) + 'M';
    } else if (value >= 1e3) {
      return (value / 1e3).toFixed(2) + 'K';
    }
    return value.toFixed(2);
  }

  /**
   * 获取百分位数
   */
  private getPercentile(sorted: number[], percentile: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.floor((sorted.length - 1) * (percentile / 100));
    return sorted[index] || 0;
  }

  // ========== 兼容性方法（向后兼容） ==========

  /**
   * 获取合约状态（旧方法，保持兼容）
   */
  async getContractStatus(symbol: string): Promise<any> {
    const snapshot = await this.getContractSnapshot(symbol);
      return {
      symbol: snapshot.symbol,
      openInterest: snapshot.oiUsd.toString(),
      openInterestChange24h: '0', // 旧接口不提供
      fundingRate: snapshot.fundingRate.toString(),
      longShortRatio: snapshot.topAccountLongShortRatio.toString(), // 使用大户多空比
      isBinanceFutures: snapshot.isBinanceFutures,
    };
  }

  /**
   * 获取合约状态并生成 AI 分析（旧方法，保持兼容）
   */
  async getContractStatusWithAnalysis(symbol: string): Promise<any> {
    const snapshot = await this.getContractSnapshot(symbol);
    const analysis = await this.analyzeContract(snapshot);
    
    return {
      ...this.getContractStatus(symbol),
      analysis: this.formatContractAnalysis(snapshot, analysis),
    };
  }

  /**
   * 格式化合约状态（简化版，未付费）
   */
  formatContractStatusSimple(status: any): string {
    // 使用新的快照格式
    return '请使用新的 formatContractSnapshot 方法';
  }

  /**
   * 格式化合约状态（完整版，已付费）
   */
  formatContractStatusFull(status: any): string {
    // 使用新的分析格式
    return status.analysis || '分析不可用';
  }
}
