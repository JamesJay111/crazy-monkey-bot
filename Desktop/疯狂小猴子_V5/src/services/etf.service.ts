import { CoinGlassClient } from '../clients/coinglass.client';
import { DeepSeekClient } from '../clients/deepseek.client';
import { CoinGlassETFFlow } from '../types';
import { formatLargeNumber, formatPercent, formatDate } from '../utils/formatter';
import { logger } from '../utils/logger';
import { RetryUtil } from '../utils/retry';

/**
 * ETF 分析服务
 */
export class ETFService {
  constructor(
    private coinglass: CoinGlassClient,
    private deepseek: DeepSeekClient
  ) {}

  /**
   * 获取 UTC+0 昨日（00:00–23:59）ETF 数据
   * 支持 BTC, ETH, SOL, XRP
   * 与 Twitter 推送口径完全一致
   */
  async getLatestFlow(symbol: 'BTC' | 'ETH' | 'SOL' | 'XRP'): Promise<CoinGlassETFFlow | null> {
    try {
      // 计算 UTC+0 昨日的时间范围
      const { start, end } = this.getYesterdayUTCTimeRange();
      
      // 获取足够的历史数据（至少 7 天，确保能覆盖昨日）
      const history = await this.getFlowHistory(symbol, 7);
      
      logger.info({ 
        symbol, 
        historyLength: history.length,
        yesterdayStart: new Date(start).toISOString(),
        yesterdayEnd: new Date(end).toISOString()
      }, 'ETF flow history result');
      
      if (history.length === 0) {
        logger.warn({ symbol }, 'No ETF flow history returned after filtering');
        return null;
      }
      
      // 筛选出 UTC+0 昨日（00:00–23:59）的数据
      const yesterdayData = history.filter(item => {
        const itemTimestamp = item.timestamp;
        return itemTimestamp >= start && itemTimestamp <= end;
      });
      
      if (yesterdayData.length === 0) {
        logger.warn({ 
          symbol, 
          yesterdayStart: new Date(start).toISOString(),
          yesterdayEnd: new Date(end).toISOString(),
          historyTimestamps: history.slice(0, 3).map(h => new Date(h.timestamp).toISOString())
        }, 'No ETF flow data for UTC+0 yesterday');
        return null;
      }
      
      // 如果有多条数据，需要聚合（按日汇总）
      // 计算昨日所有 ETF 的净流入总和
      const aggregatedFlow: CoinGlassETFFlow = {
        timestamp: start, // 使用昨日开始时间作为时间戳
        flow_usd: yesterdayData.reduce((sum, item) => {
          const flow = parseFloat(item.flow_usd || '0');
          return sum + flow;
        }, 0).toString(),
        price_usd: yesterdayData[yesterdayData.length - 1]?.price_usd || '0', // 使用最后一条的价格
        etf_flows: this.aggregateETFFlows(yesterdayData), // 聚合所有 ETF 明细
      };
      
      logger.info({ 
        symbol, 
        timestamp: aggregatedFlow.timestamp,
        flowUsd: aggregatedFlow.flow_usd,
        date: new Date(aggregatedFlow.timestamp).toISOString().split('T')[0]
      }, 'Got UTC+0 yesterday ETF flow');
      
      return aggregatedFlow;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMsg, symbol, stack: error instanceof Error ? error.stack : undefined }, 'Failed to get latest ETF flow');
      
      // 检查是否是限流错误
      if (errorMsg.includes('Too Many Requests') || errorMsg.includes('请求频率超限') || errorMsg.includes('429')) {
        throw new Error(`请求过于频繁，请稍后重试。建议：\n• 等待 1-2 分钟后重试\n• 或使用其他功能`);
      }
      
      // 检查是否是套餐升级错误
      if (errorMsg.includes('升级') || errorMsg.includes('upgrade') || errorMsg.includes('plan')) {
        throw new Error(`获取 ${symbol} ETF 数据需要升级 API 套餐`);
      }
      
      throw new Error(`获取 ${symbol} ETF 数据失败: ${errorMsg}`);
    }
  }

  /**
   * 获取 UTC+0 昨日时间范围（毫秒时间戳）
   * @returns { start: 昨日00:00:00, end: 昨日23:59:59.999 } (UTC时间戳)
   */
  private getYesterdayUTCTimeRange(): { start: number; end: number } {
    const now = new Date();
    
    // 获取当前UTC时间
    const utcNow = new Date(now);
    const utcYear = utcNow.getUTCFullYear();
    const utcMonth = utcNow.getUTCMonth();
    const utcDate = utcNow.getUTCDate();
    
    // 计算昨日（UTC+0）
    const yesterday = new Date(Date.UTC(utcYear, utcMonth, utcDate - 1, 0, 0, 0, 0));
    const yesterdayEnd = new Date(Date.UTC(utcYear, utcMonth, utcDate - 1, 23, 59, 59, 999));
    
    // 返回UTC时间戳（毫秒）
    const start = yesterday.getTime();
    const end = yesterdayEnd.getTime();
    
    return { start, end };
  }

  /**
   * 聚合多条 ETF 数据中的 etf_flows
   * 将相同 ticker 的 flow_usd 相加
   */
  private aggregateETFFlows(data: CoinGlassETFFlow[]): Array<{ etf_ticker: string; flow_usd?: string }> {
    const tickerMap = new Map<string, number>();
    
    // 遍历所有数据，累加相同 ticker 的 flow_usd
    data.forEach(item => {
      if (item.etf_flows && Array.isArray(item.etf_flows)) {
        item.etf_flows.forEach(etf => {
          if (etf.etf_ticker) {
            const current = tickerMap.get(etf.etf_ticker) || 0;
            const flow = parseFloat(etf.flow_usd || '0');
            tickerMap.set(etf.etf_ticker, current + flow);
          }
        });
      }
    });
    
    // 转换为数组格式
    return Array.from(tickerMap.entries()).map(([ticker, flow]) => ({
      etf_ticker: ticker,
      flow_usd: flow.toString(),
    }));
  }

  /**
   * 获取 ETF 历史数据
   * 支持 BTC, ETH, SOL, XRP
   */
  async getFlowHistory(symbol: 'BTC' | 'ETH' | 'SOL' | 'XRP', days: number = 30): Promise<CoinGlassETFFlow[]> {
    try {
      let history: CoinGlassETFFlow[] = [];
      
      switch (symbol) {
        case 'BTC':
          history = await this.coinglass.getBTCETFFlowHistory(days);
          break;
        case 'ETH':
          history = await this.coinglass.getETFETFFlowHistory(days);
          break;
        case 'SOL':
          history = await this.coinglass.getSOLETFFlowHistory(days);
          break;
        case 'XRP':
          history = await this.coinglass.getXRPETFFlowHistory(days);
          break;
      }

      if (!Array.isArray(history)) {
        logger.warn({ symbol, days, historyType: typeof history }, 'ETF history is not an array');
        return [];
      }

      // 过滤无效数据并确保数据格式正确
      // 注意：flow_usd 可能是 string 或 number
      const validHistory = history.filter(item => {
        if (!item) return false;
        if (typeof item.timestamp !== 'number' || item.timestamp <= 0) return false;
        // flow_usd 可以是 string 或 number
        if (item.flow_usd === undefined || item.flow_usd === null) return false;
        return true;
      });
      
      // 统一转换 flow_usd 为 string（如果 API 返回的是 number）
      const normalizedHistory = validHistory.map((item: any) => ({
        ...item,
        flow_usd: typeof item.flow_usd === 'number' ? item.flow_usd.toString() : String(item.flow_usd || '0'),
        price_usd: typeof item.price_usd === 'number' ? item.price_usd.toString() : String(item.price_usd || '0'),
      }));

      // 按时间倒序排序（最新的在前）
      const sorted = normalizedHistory.sort((a, b) => b.timestamp - a.timestamp);
      
      logger.info({ symbol, days, total: history.length, valid: sorted.length }, 'Got ETF flow history');
      
      if (sorted.length === 0) {
        logger.warn({ symbol, days, rawHistory: history.slice(0, 2) }, 'No valid ETF history after filtering');
      }
      
      return sorted;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMsg, symbol, days, stack: error instanceof Error ? error.stack : undefined }, 'Failed to get ETF flow history');
      
      // 检查是否是套餐升级错误
      if (errorMsg.includes('升级') || errorMsg.includes('upgrade') || errorMsg.includes('plan')) {
        throw new Error(`获取 ${symbol} ETF 历史数据需要升级 API 套餐`);
      }
      
      throw new Error(`获取 ${symbol} ETF 历史数据失败: ${errorMsg}`);
    }
  }

  /**
   * 格式化昨日 ETF 数据（UTC+0 昨日）
   */
  formatLatestFlow(flow: CoinGlassETFFlow, symbol: string): string {
    const flowUsd = parseFloat(flow.flow_usd || '0');
    const priceUsd = parseFloat(flow.price_usd || '0');
    const sign = flowUsd >= 0 ? '+' : '';
    
    // 格式化日期（UTC+0）
    const date = new Date(flow.timestamp);
    const dateStr = date.toISOString().split('T')[0]; // YYYY-MM-DD
    const dateDisplay = `${dateStr.split('-')[0]}/${dateStr.split('-')[1]}/${dateStr.split('-')[2]}`;
    
    let message = `📊 ${symbol} ETF 资金流\n\n`;
    message += `📅 日期: ${dateDisplay} (UTC+0 昨日)\n`;
    message += `💰 净流入: ${sign}${formatLargeNumber(flowUsd)} USD\n`;
    message += `💎 价格: $${formatLargeNumber(priceUsd)}\n\n`;
    
    if (flow.etf_flows && Array.isArray(flow.etf_flows) && flow.etf_flows.length > 0) {
      message += `主要 ETF 明细：\n`;
      // 显示所有有 ticker 的项，缺失 flow_usd 时显示为 "—"
      const validFlows = flow.etf_flows
        .filter(etf => etf.etf_ticker) // 只要有 ticker 就显示
        .slice(0, 10); // 显示前10个
      
      if (validFlows.length > 0) {
        validFlows.forEach(etf => {
          // 容错处理：如果 flow_usd 缺失，显示为 "—"
          if (etf.flow_usd === undefined || etf.flow_usd === null || etf.flow_usd === '') {
            message += `  • ${etf.etf_ticker}: —\n`;
          } else {
            const etfFlow = parseFloat(etf.flow_usd || '0');
            const etfSign = etfFlow >= 0 ? '+' : '';
            message += `  • ${etf.etf_ticker}: ${etfSign}${formatLargeNumber(etfFlow)} USD\n`;
          }
        });
      } else {
        message += `  (暂无明细数据)\n`;
      }
    } else {
      message += `(暂无 ETF 明细数据)\n`;
    }
    
    message += `\n数据来源: CoinGlass API`;
    message += `\n统计口径: UTC+0 昨日（00:00–23:59）单日 ETF 净流入`;
    
    return message;
  }

  /**
   * 生成 ETF 解读分析（使用 DeepSeek）
   * @param symbol 币种
   * @returns 分析文本
   */
  async generateETFAnalysis(symbol: 'BTC' | 'ETH' | 'SOL' | 'XRP'): Promise<string> {
    try {
      // 1. 获取昨日（UTC+0）单日 ETF 数据
      const yesterdayFlow = await this.getLatestFlow(symbol);
      if (!yesterdayFlow) {
        return `❌ 无法获取 ${symbol} 昨日 ETF 数据，请稍后重试。`;
      }

      // 2. 获取过去 30 天 ETF 历史数据
      const history30Days = await this.getFlowHistory(symbol, 30);
      if (history30Days.length === 0) {
        return `❌ 无法获取 ${symbol} ETF 历史数据，请稍后重试。`;
      }

      // 3. 构建 DeepSeek Prompt
      const systemPrompt = `你是一名专业加密资产 ETF 研究分析师，长期跟踪 BTC、ETH、SOL、XRP 的 ETF 资金结构。

你需要基于以下信息进行分析：
- 昨日（UTC+0）单日 ETF 资金流入 / 流出
- 过去 30 天 ETF 资金变化趋势
- 不同 ETF 发行方（如 IBIT、FBTC、ARKB、BITB 等）的行为差异

在分析中，请重点回答：
1. 昨日资金行为的性质：是趋势延续、阶段性回补，还是异常波动？
2. 主力资金结构判断：更偏向传统机构（BlackRock / Fidelity）？还是交易型、套利型资金？
3. 30 天维度的趋势判断：是否出现趋势反转、加速、或边际走弱？
4. 宏观因素联动分析：是否需要考虑美联储利率政策预期变化？日元是否存在加息预期变化？当前是否处于风险偏好上升 / 收缩阶段？

输出要求：
- 使用研究员分析结构
- 分段清晰，避免情绪化语言
- 不做价格预测，只做资金与趋势判断
- 结尾给出一个 偏多 / 中性 / 偏空 的 ETF 资金趋势结论
- 如果 30 天数据不足，需在分析中明确说明"样本有限"
- 使用中文输出`;

      // 4. 构建用户 Prompt（包含结构化数据）
      const yesterdayDate = new Date(yesterdayFlow.timestamp).toISOString().split('T')[0];
      const yesterdayFlowUsd = parseFloat(yesterdayFlow.flow_usd || '0');
      
      // 计算 30 天趋势数据
      const flows30Days = history30Days.map(h => parseFloat(h.flow_usd || '0'));
      const totalFlow30Days = flows30Days.reduce((a, b) => a + b, 0);
      const avgDailyFlow = totalFlow30Days / flows30Days.length;
      const positiveDays = flows30Days.filter(f => f > 0).length;
      const maxInflow = Math.max(...flows30Days);
      const maxOutflow = Math.min(...flows30Days);
      
      // 提取 ETF 明细（昨日）
      let etfDetailsText = '';
      if (yesterdayFlow.etf_flows && Array.isArray(yesterdayFlow.etf_flows)) {
        etfDetailsText = yesterdayFlow.etf_flows
          .filter(etf => etf.etf_ticker)
          .map(etf => {
            const flow = parseFloat(etf.flow_usd || '0');
            return `  - ${etf.etf_ticker}: ${flow >= 0 ? '+' : ''}${formatLargeNumber(flow)} USD`;
          })
          .join('\n');
      }

      const userPrompt = `请基于以下 ${symbol} ETF 数据进行分析：

【昨日（UTC+0）单日数据】
日期: ${yesterdayDate}
净流入: ${yesterdayFlowUsd >= 0 ? '+' : ''}${formatLargeNumber(yesterdayFlowUsd)} USD
价格: $${formatLargeNumber(parseFloat(yesterdayFlow.price_usd || '0'))}
${etfDetailsText ? `\n主要 ETF 明细：\n${etfDetailsText}` : ''}

【过去 30 天趋势数据】
总净流入: ${totalFlow30Days >= 0 ? '+' : ''}${formatLargeNumber(totalFlow30Days)} USD
平均每日净流入: ${avgDailyFlow >= 0 ? '+' : ''}${formatLargeNumber(avgDailyFlow)} USD
净流入为正的天数: ${positiveDays} / ${flows30Days.length}
最大单日流入: +${formatLargeNumber(maxInflow)} USD
最大单日流出: ${formatLargeNumber(maxOutflow)} USD

请生成专业的研究分析文本。`;

      logger.info({ symbol, yesterdayDate }, 'Calling DeepSeek API to generate ETF analysis');

      // 5. 调用 DeepSeek API（带重试机制）
      const analysis = await RetryUtil.retry(
        async () => {
          return await this.deepseek.analyzeWithPrompt(
            systemPrompt,
            userPrompt,
            { temperature: 0.7, maxTokens: 2000 }
          );
        },
        {
          maxAttempts: 3, // 最多重试3次
          backoffMs: 2000, // 初始退避2秒
          exponential: true, // 使用指数退避
          maxBackoffMs: 10000, // 最大退避10秒
        }
      );

      logger.info({ symbol, analysisLength: analysis.length }, 'ETF analysis generated successfully');

      return analysis.trim();
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      
      // 检查是否是网络连接错误
      const isNetworkError = errorMsg.includes('ECONNRESET') || 
                             errorMsg.includes('aborted') || 
                             errorMsg.includes('timeout') ||
                             errorMsg.includes('网络') ||
                             errorMsg.includes('连接');
      
      logger.error({ 
        error: errorMsg, 
        symbol,
        isNetworkError,
        errorStack: error instanceof Error ? error.stack : undefined
      }, 'Failed to generate ETF analysis');
      
      if (isNetworkError) {
        return `❌ 分析生成失败：网络连接问题\n\n请稍后重试，或检查网络连接。`;
      }
      
      return `❌ 分析生成失败：${errorMsg}\n\n请稍后重试。`;
    }
  }

  /**
   * 格式化 30 天历史数据摘要
   */
  formatHistorySummary(history: CoinGlassETFFlow[], symbol: string): string {
    if (history.length === 0) {
      return `❌ 暂无 ${symbol} ETF 历史数据`;
    }

    const flows = history.map(h => parseFloat(h.flow_usd));
    const totalFlow = flows.reduce((a, b) => a + b, 0);
    const positiveDays = flows.filter(f => f > 0).length;
    const maxInflow = Math.max(...flows);
    const maxOutflow = Math.min(...flows);

    let message = `📈 ${symbol} ETF 过去 30 天资金流汇总\n\n`;
    message += `💰 总净流入: ${totalFlow >= 0 ? '+' : ''}${formatLargeNumber(totalFlow)} USD\n`;
    message += `📊 净流入为正的天数: ${positiveDays} / ${history.length}\n`;
    message += `📈 最大单日流入: +${formatLargeNumber(maxInflow)} USD\n`;
    message += `📉 最大单日流出: ${formatLargeNumber(maxOutflow)} USD\n\n`;
    
    message += `Top 10 单日流入：\n`;
    const top10 = [...history]
      .sort((a, b) => parseFloat(b.flow_usd) - parseFloat(a.flow_usd))
      .slice(0, 10);
    
    top10.forEach((flow, index) => {
      const flowUsd = parseFloat(flow.flow_usd);
      const sign = flowUsd >= 0 ? '+' : '';
      message += `${index + 1}. ${formatDate(flow.timestamp)}: ${sign}${formatLargeNumber(flowUsd)} USD\n`;
    });

    message += `\n数据来源: CoinGlass API`;

    return message;
  }
}

