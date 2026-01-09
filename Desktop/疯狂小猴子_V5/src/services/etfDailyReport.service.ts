import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { ETFService } from './etf.service';
import { DeepSeekClient } from '../clients/deepseek.client';
import { logger } from '../utils/logger';
import { formatLargeNumber, formatDate } from '../utils/formatter';
import { CoinGlassETFFlow } from '../types';
import { RetryUtil } from '../utils/retry';
import { env } from '../config/env';
import { aggregateEtfFlows, validateAggregateResult, EtfFlowAggregateResult } from '../utils/etfFlowAggregate';
import { matchTargetDate, getLatestAvailableDate, getTargetDateUTCRange, isDataAvailable } from '../utils/etfDateMatcher';
import { LarkWebhookService } from './larkWebhook.service';
import { LarkWebhookCustomService } from './larkWebhookCustom.service';
import { env } from '../config/env';

/**
 * ETF 每日资金流报告服务
 * 每天北京时间早上8点生成过去24小时的ETF资金流报告
 * 
 * 【新增功能】每日 ETF 资金流向分析落盘
 * - 生成原始数据文件：/data/etf/raw/etf_flow_raw_YYYY-MM-DD.txt
 * - 生成分析文本文件：/data/etf/analysis/etf_flow_analysis_YYYY-MM-DD.txt
 */
export class ETFDailyReportService {
  private intervalHandle: NodeJS.Timeout | null = null;
  // 报告保存到 Mac 桌面（保留兼容性）
  private readonly REPORT_DIR = path.join(os.homedir(), 'Desktop');
  // 【新增】ETF 数据目录结构
  private readonly ETF_DATA_DIR = path.resolve('./data/etf');
  private readonly ETF_RAW_DIR = path.join(this.ETF_DATA_DIR, 'raw');
  private readonly ETF_ANALYSIS_DIR = path.join(this.ETF_DATA_DIR, 'analysis');
  private readonly SYMBOLS: Array<'BTC' | 'ETH' | 'XRP' | 'SOL'> = ['BTC', 'ETH', 'XRP', 'SOL'];
  private readonly MAX_RETRY_ATTEMPTS = 20; // 最多重试20次
  private readonly RETRY_DELAY_MS = 60000; // 每次重试等待60秒（1分钟）
  private readonly MAX_WAIT_MINUTES = 90; // 最多等待90分钟
  private readonly MAX_CHECKS = 30; // 最多检查30次
  private readonly MIN_SYMBOLS_FOR_REPORT = 1; // 至少需要1个币种的数据才能生成报告

  private larkWebhook: LarkWebhookService;
  private larkWebhookUnified: LarkWebhookCustomService | null = null;

  constructor(
    private etfService: ETFService,
    private deepseek?: DeepSeekClient // 【新增】DeepSeek 客户端（可选）
  ) {
    // 初始化 Lark Webhook 服务（仅用于该 Webhook）
    this.larkWebhook = new LarkWebhookService();
    
    // 初始化统一推送 Webhook（如果配置了）
    if (env.LARK_WEBHOOK_UNIFIED) {
      this.larkWebhookUnified = new LarkWebhookCustomService(env.LARK_WEBHOOK_UNIFIED);
      logger.info({ webhookUrl: env.LARK_WEBHOOK_UNIFIED.substring(0, 50) + '...' }, 'Unified Lark webhook initialized for ETF');
    }
    // 确保报告目录存在（Mac 桌面应该已存在，但检查一下）
    if (!fs.existsSync(this.REPORT_DIR)) {
      fs.mkdirSync(this.REPORT_DIR, { recursive: true });
      logger.info({ reportDir: this.REPORT_DIR }, 'Created ETF daily report directory');
    }
    logger.info({ reportDir: this.REPORT_DIR }, 'ETF daily report will be saved to Mac Desktop');
    
    // 【新增】确保 ETF 数据目录存在
    if (!fs.existsSync(this.ETF_RAW_DIR)) {
      fs.mkdirSync(this.ETF_RAW_DIR, { recursive: true });
      logger.info({ rawDir: this.ETF_RAW_DIR }, 'Created ETF raw data directory');
    }
    if (!fs.existsSync(this.ETF_ANALYSIS_DIR)) {
      fs.mkdirSync(this.ETF_ANALYSIS_DIR, { recursive: true });
      logger.info({ analysisDir: this.ETF_ANALYSIS_DIR }, 'Created ETF analysis directory');
    }
    logger.info({ 
      rawDir: this.ETF_RAW_DIR, 
      analysisDir: this.ETF_ANALYSIS_DIR,
      hasDeepSeek: !!this.deepseek 
    }, 'ETF data directories initialized');
  }

  /**
   * 启动每日报告任务（每天北京时间早上8点执行）
   */
  start(): void {
    if (this.intervalHandle) {
      logger.warn('ETF daily report service is already running');
      return;
    }

    logger.info('Starting ETF daily report service');

    // 计算到下次北京时间早上8点的延迟
    const nextRun = this.getNextBeijing8AM();
    const delayMs = nextRun.getTime() - Date.now();

    logger.info({ 
      nextRun: nextRun.toISOString(),
      delayMs: Math.round(delayMs / 1000 / 60) + ' minutes'
    }, 'ETF daily report scheduled');

    // 设置第一次执行
    setTimeout(() => {
      this.generateReport().catch(error => {
        logger.error({ error }, 'Failed to generate ETF daily report');
      });

      // 之后每24小时执行一次
      this.intervalHandle = setInterval(() => {
        this.generateReport().catch(error => {
          logger.error({ error }, 'Failed to generate ETF daily report');
        });
      }, 24 * 60 * 60 * 1000); // 24小时
    }, delayMs);
  }

  /**
   * 停止每日报告任务
   */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      logger.info('ETF daily report service stopped');
    }
  }

  /**
   * 获取下次北京时间早上8点的时间
   * 北京时间早上8点 = UTC 0点（在同一天）
   */
  private getNextBeijing8AM(): Date {
    const now = new Date();
    
    // 获取当前UTC时间对应的北京时间
    const beijingNow = new Date(now.getTime() + 8 * 60 * 60 * 1000);
    const beijingYear = beijingNow.getUTCFullYear();
    const beijingMonth = beijingNow.getUTCMonth();
    const beijingDate = beijingNow.getUTCDate();
    const beijingHour = beijingNow.getUTCHours();
    
    // 计算目标时间（北京时间早上8点）
    // 北京时间早上8点 = UTC 0点（在同一天）
    const targetUTC = new Date(Date.UTC(beijingYear, beijingMonth, beijingDate, 0, 0, 0, 0));
    
    // 如果已经过了今天早上8点（北京时间），则设置为明天早上8点
    if (beijingHour >= 8 || targetUTC.getTime() <= now.getTime()) {
      targetUTC.setUTCDate(targetUTC.getUTCDate() + 1);
    }
    
    return targetUTC;
  }

  /**
   * 生成每日报告
   * 【修改】只生成一个文件：第一部分是 DeepSeek 分析，第二部分是资金流数据
   */
  private async generateReport(): Promise<void> {
    logger.info('Generating ETF daily report...');

    const reportDate = new Date();
    // 转换为北京时间
    const beijingTime = new Date(reportDate.getTime() + 8 * 60 * 60 * 1000);
    const dateStr = beijingTime.toISOString().split('T')[0]; // YYYY-MM-DD
    
    try {
      // 1. 生成原始数据内容（用于 DeepSeek 分析）
      const { content: rawDataContent, reportDateStr } = await this.buildReportContent();
      
      // 2. 生成 DeepSeek 分析（第一部分，限制200-300字）
      const analysisText = await this.generateAnalysisText(rawDataContent, reportDateStr);
      
      // 3. 生成完整报告（先分析，后数据）
      const completeReport = this.buildCompleteReport(analysisText, rawDataContent, reportDateStr);
      
      // 4. 保存到 Mac 桌面
      const desktopFileName = `etf_daily_report_${dateStr}.txt`;
      const desktopFilePath = path.join(this.REPORT_DIR, desktopFileName);
      fs.writeFileSync(desktopFilePath, completeReport, 'utf-8');
      logger.info({ 
        filePath: desktopFilePath, 
        fileName: desktopFileName,
        size: completeReport.length 
      }, 'ETF daily report saved to Desktop');
      
      // 5. 同时保存到 /data/etf/ 目录（统一文件名）
      const dataFileName = `etf_daily_report_${dateStr}.txt`;
      const dataFilePath = path.join(this.ETF_DATA_DIR, dataFileName);
      fs.writeFileSync(dataFilePath, completeReport, 'utf-8');
      logger.info({ 
        filePath: dataFilePath, 
        fileName: dataFileName,
        size: completeReport.length 
      }, 'ETF daily report saved to data directory');
      
      // 【Lark 专属逻辑】拆分币种并分别推送到 Lark Webhook
      await this.sendETFToLarkBySymbol(rawDataContent, reportDateStr);
      
      logger.info({ dateStr }, 'ETF daily report generation completed');
    } catch (error) {
      logger.error({ error }, 'Failed to generate ETF daily report');
      throw error;
    }
  }

  /**
   * 【修改】生成 DeepSeek 分析文本（不保存单独文件，只返回文本）
   * 如果 DeepSeek 调用失败，返回错误提示
   * @returns 分析文本内容（成功时返回分析文本，失败时返回错误提示）
   */
  private async generateAnalysisText(rawContent: string, dateStr: string): Promise<string> {
    try {
      if (!this.deepseek) {
        logger.warn('DeepSeek client not available, skipping analysis generation');
        return '分析生成失败：DeepSeek 客户端未配置，请稍后重试';
      }

      // 构建 DeepSeek Prompt（限制200-300字）
      const systemPrompt = `你是一位专业的数据分析师，专注于加密货币 ETF 资金流向研究。你的任务是基于提供的 ETF 资金流数据，生成一段精简、客观的研究分析文本。

要求：
1. 使用研究员/数据分析师的风格，使用相对判断与缓冲语气
2. 分析资金流向趋势、主要 ETF 的变化、不同资产的表现差异
3. 不给出交易建议，不预测价格
4. 使用中文，自然流畅，逻辑清晰
5. 只输出分析文本本身，不包含标题、日期等元信息
6. 【重要】文本长度必须严格控制在200-300字之间，不能超过300字`;

      const userPrompt = `请基于以下 ETF 资金流数据（日期：${dateStr}），生成一段精简分析文本（200-300字）：

${rawContent}

请从以下角度进行分析（控制在200-300字）：
- 整体资金流向趋势（净流入/流出规模）
- 各资产（BTC/ETH/SOL/XRP）的表现差异
- 主要 ETF 发行方的资金变化（如 BlackRock、Grayscale 等）

请只输出分析文本，不要包含任何 JSON、Prompt 或日志信息。文本长度必须严格控制在200-300字之间。`;

      logger.info({ dateStr }, 'Calling DeepSeek API to generate analysis');
      
      // 调用 DeepSeek API（限制输出长度）
      const analysisText = await this.deepseek.analyzeWithPrompt(
        systemPrompt,
        userPrompt,
        { temperature: 0.7, maxTokens: 400 } // 限制token数，确保输出在200-300字
      );
      
      // 验证并截断分析文本（确保不超过300字）
      let finalAnalysisText = analysisText.trim();
      if (finalAnalysisText.length > 300) {
        // 如果超过300字，截断到300字（保留完整句子）
        finalAnalysisText = finalAnalysisText.substring(0, 300);
        const lastPeriod = finalAnalysisText.lastIndexOf('。');
        const lastComma = finalAnalysisText.lastIndexOf('，');
        const lastBreak = Math.max(lastPeriod, lastComma);
        if (lastBreak > 200) {
          finalAnalysisText = finalAnalysisText.substring(0, lastBreak + 1);
        }
        logger.warn({ originalLength: analysisText.length, truncatedLength: finalAnalysisText.length }, 'Analysis text truncated to 300 characters');
      }
      
      if (finalAnalysisText.length < 200) {
        logger.warn({ length: finalAnalysisText.length }, 'Analysis text is shorter than 200 characters');
      }

      logger.info({ dateStr, analysisLength: analysisText.length }, 'DeepSeek analysis generated successfully');
      
      return analysisText;
      
    } catch (error) {
      // DeepSeek 调用失败，返回错误提示
      const errorMessage = '分析生成失败，请稍后重试';
      
      logger.error({ 
        error, 
        dateStr 
      }, 'Failed to generate ETF analysis');
      
      return errorMessage;
    }
  }

  /**
   * 【新增】构建完整报告（第一部分：DeepSeek 分析，第二部分：资金流数据）
   */
  private buildCompleteReport(analysisText: string, rawDataContent: string, dateStr: string): string {
    const reportDate = new Date();
    const beijingTime = new Date(reportDate.getTime() + 8 * 60 * 60 * 1000);
    const timeStr = beijingTime.toTimeString().split(' ')[0]; // HH:MM:SS
    
    let completeContent = '';
    
    // 文件头部（使用rawDataContent中的头部，已包含正确的统计日期信息）
    // 从rawDataContent中提取头部（前5行）
    const rawLines = rawDataContent.split('\n');
    const headerEndIndex = rawLines.findIndex(line => line.includes('═══════════════════════════════════════════════════════════') && rawLines.indexOf(line) > 0);
    if (headerEndIndex > 0) {
      completeContent += rawLines.slice(0, headerEndIndex + 1).join('\n') + '\n\n';
    } else {
      // Fallback：如果无法提取，使用默认头部
      const reportDate = new Date();
      const generateDateStr = reportDate.toISOString().split('T')[0];
      const generateTimeStr = reportDate.toTimeString().split(' ')[0];
      completeContent += '═══════════════════════════════════════════════════════════\n';
      completeContent += `ETF 每日资金流报告\n`;
      completeContent += `生成时间: ${generateDateStr} ${generateTimeStr} (UTC+0)\n`;
      completeContent += `统计日期: ${dateStr} (UTC+0)\n`;
      completeContent += '═══════════════════════════════════════════════════════════\n\n';
    }
    
    // 第一部分：DeepSeek AI 分析
    completeContent += '═══════════════════════════════════════════════════════════\n';
    completeContent += '📊 DeepSeek AI 分析\n';
    completeContent += '═══════════════════════════════════════════════════════════\n\n';
    completeContent += analysisText;
    completeContent += '\n\n';
    
    // 分隔线
    completeContent += '═══════════════════════════════════════════════════════════\n';
    completeContent += '📊 具体资金流数据\n';
    completeContent += '═══════════════════════════════════════════════════════════\n\n';
    
    // 第二部分：具体资金流数据（移除原始数据中的头部，只保留数据部分）
    // 从原始数据中提取数据部分（跳过头部）
    const dataLines = rawDataContent.split('\n');
    let dataStartIndex = 0;
    for (let i = 0; i < dataLines.length; i++) {
      if (dataLines[i].includes('📊') && dataLines[i].includes('ETF 资金流')) {
        dataStartIndex = i;
        break;
      }
    }
    // 如果找到了数据开始位置，从那里开始；否则使用全部内容
    const dataContent = dataStartIndex > 0 
      ? dataLines.slice(dataStartIndex).join('\n')
      : rawDataContent;
    
    completeContent += dataContent;
    
    // 文件尾部
    completeContent += '\n';
    completeContent += '═══════════════════════════════════════════════════════════\n';
    completeContent += '数据来源: CoinGlass API\n';
    completeContent += '分析来源: DeepSeek AI\n';
    completeContent += '═══════════════════════════════════════════════════════════\n';
    
    return completeContent;
  }

  /**
   * 获取昨日UTC+0范围（毫秒时间戳）
   * @param reportDate 报告日期（UTC+0，默认昨日）
   * @returns { start: 昨日00:00:00, end: 昨日23:59:59.999 } (UTC时间戳)
   */
  private getYesterdayUTCTimeRange(reportDate?: Date): { start: number; end: number } {
    const now = reportDate || new Date();
    
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
   * 获取单个币种目标日期的数据（带重试）
   * 【修复】使用改进的日期匹配逻辑（区间匹配 + 日线点匹配）
   * @param symbol 币种
   * @param targetDate 目标日期（可选，默认昨日）
   * @returns 匹配的数据数组和最新可用日期信息
   */
  private async fetchSymbolDataWithRetry(
    symbol: 'BTC' | 'ETH' | 'XRP' | 'SOL',
    targetDate?: Date
  ): Promise<{
    data: CoinGlassETFFlow[];
    latestAvailableDate: { timestamp: number; dateStr: string } | null;
    targetDateStr: string;
  }> {
    let attempt = 0;
    let lastError: any;
    
    // 获取目标日期UTC+0范围（默认昨日）
    const { start, end, dateStr: targetDateStr } = getTargetDateUTCRange(targetDate);

    while (attempt < this.MAX_RETRY_ATTEMPTS) {
      try {
        logger.info({ symbol, attempt: attempt + 1, maxAttempts: this.MAX_RETRY_ATTEMPTS, targetDateStr }, 'Fetching ETF data for target date');
        // 获取足够的历史数据（至少7天，确保能覆盖目标日期）
        const history = await this.etfService.getFlowHistory(symbol, 7);
        
        if (history && history.length > 0) {
          // 【修复A】使用改进的日期匹配逻辑（区间匹配 + 日线点匹配）
          const matchedData = history.filter(item => {
            return matchTargetDate(item.timestamp, start, end);
          });
          
          // 【修复B】探测最新可用日期
          const latestAvailable = getLatestAvailableDate(history);
          
          // 调试信息：打印时间戳分布
          if (history.length > 0) {
            const timestamps = history.map(item => item.timestamp).sort((a, b) => a - b);
            const sampleTimestamps = timestamps.slice(0, 3).concat(timestamps.slice(-3));
            logger.info({
              symbol,
              totalHistory: history.length,
              matchedCount: matchedData.length,
              targetDateStr,
              latestAvailableDate: latestAvailable?.dateStr || 'N/A',
              sampleTimestamps: sampleTimestamps.map(ts => ({
                timestamp: ts,
                date: new Date(ts).toISOString(),
                isTargetDate: matchTargetDate(ts, start, end)
              }))
            }, 'Date matching debug info');
          }
          
          if (matchedData.length > 0) {
            logger.info({ 
              symbol, 
              dataCount: matchedData.length, 
              targetDateStr,
              sampleTimestamp: matchedData[0].timestamp,
              sampleFlowUsd: matchedData[0].flow_usd,
              latestAvailableDate: latestAvailable?.dateStr
            }, 'Successfully fetched target date ETF data');
            return {
              data: matchedData,
              latestAvailableDate: latestAvailable,
              targetDateStr,
            };
          } else {
            // 检查最新可用日期是否早于目标日期
            if (latestAvailable) {
              const isAvailable = isDataAvailable(latestAvailable.dateStr, targetDateStr);
              logger.warn({
                symbol,
                attempt: attempt + 1,
                totalHistory: history.length,
                targetDateStr,
                latestAvailableDate: latestAvailable.dateStr,
                isDataAvailable: isAvailable,
                reason: isAvailable ? 'Data exists but timestamp mismatch' : 'API not updated to target date yet'
              }, 'No data found for target date');
              
              // 【优化】如果最新可用日期早于目标日期，且这是第一次尝试，立即返回（不重试）
              if (!isAvailable && attempt === 0) {
                logger.info({
                  symbol,
                  targetDateStr,
                  latestAvailableDate: latestAvailable.dateStr,
                  reason: 'Latest available date is before target date, skipping retries'
                }, 'Returning early with latest available date info');
                return {
                  data: [],
                  latestAvailableDate: latestAvailable,
                  targetDateStr,
                };
              }
            } else {
              logger.warn({ symbol, attempt: attempt + 1, totalHistory: history.length, targetDateStr }, 'No data found for target date, no latest date available');
            }
          }
        } else {
          logger.warn({ symbol, attempt: attempt + 1 }, 'ETF data is empty, will retry');
        }
      } catch (error) {
        lastError = error;
        const errorMsg = error instanceof Error ? error.message : String(error);
        const isRateLimit = errorMsg.includes('限流') || errorMsg.includes('Too Many Requests') || errorMsg.includes('429');
        const isTimeout = errorMsg.includes('timeout') || errorMsg.includes('TIMEOUT');
        
        if (isRateLimit || isTimeout) {
          attempt++;
          const waitSeconds = this.RETRY_DELAY_MS / 1000;
          logger.warn({ 
            symbol, 
            attempt, 
            maxAttempts: this.MAX_RETRY_ATTEMPTS,
            waitSeconds,
            error: errorMsg 
          }, `API rate limit or timeout, waiting ${waitSeconds}s before retry`);
          
          if (attempt < this.MAX_RETRY_ATTEMPTS) {
            await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY_MS));
            continue;
          }
        } else {
          // 非限流/超时错误，直接抛出
          throw error;
        }
      }
      
      attempt++;
      if (attempt < this.MAX_RETRY_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, this.RETRY_DELAY_MS));
      }
    }

    // 所有重试都失败，返回空数据但包含最新可用日期信息
    logger.error({ symbol, attempts: this.MAX_RETRY_ATTEMPTS, error: lastError, targetDateStr }, 'Failed to fetch ETF data after all retries');
    
    // 尝试获取最新可用日期（即使匹配失败）
    try {
      const history = await this.etfService.getFlowHistory(symbol, 7);
      const latestAvailable = history && history.length > 0 ? getLatestAvailableDate(history) : null;
      return {
        data: [],
        latestAvailableDate: latestAvailable,
        targetDateStr,
      };
    } catch (error) {
      return {
        data: [],
        latestAvailableDate: null,
        targetDateStr,
      };
    }
  }

  /**
   * 构建报告内容（支持降级策略）
   * 【修复C】允许部分币种数据或使用最新可用日期生成报告
   */
  private async buildReportContent(reportDate?: Date): Promise<{ content: string; reportDateStr: string }> {
    const now = reportDate || new Date();
    const generateDateStr = now.toISOString().split('T')[0];
    const generateTimeStr = now.toTimeString().split(' ')[0]; // HH:MM:SS
    
    // 计算目标日期（UTC+0，默认昨日）
    const { start, end, dateStr: targetDateStr } = getTargetDateUTCRange(reportDate);
    const targetDateDisplay = `${targetDateStr} 00:00–23:59`;

    // 获取每个币种的数据（带重试）
    const reports: Array<{
      symbol: string;
      data: CoinGlassETFFlow[];
      latestAvailableDate: { timestamp: number; dateStr: string } | null;
      actualDateStr: string; // 实际使用的日期
    }> = [];

    const latestAvailableDates: Map<string, string> = new Map(); // 记录每个币种的最新可用日期

    logger.info({ symbols: this.SYMBOLS, targetDateStr }, 'Starting to fetch ETF data for target date (with retry and fallback)');

    for (const symbol of this.SYMBOLS) {
      try {
        // 使用重试机制获取目标日期数据
        const result = await this.fetchSymbolDataWithRetry(symbol, reportDate);
        
        // 记录最新可用日期
        if (result.latestAvailableDate) {
          latestAvailableDates.set(symbol, result.latestAvailableDate.dateStr);
        }
        
        // 【修复C】降级策略：如果目标日期没有数据，立即使用最新可用日期
        let actualDateStr = result.targetDateStr;
        let actualData = result.data;
        
        if (result.data.length === 0 && result.latestAvailableDate) {
          const latestDate = result.latestAvailableDate.dateStr;
          const isAvailable = isDataAvailable(latestDate, targetDateStr);
          
          if (!isAvailable) {
            // API 尚未更新到目标日期，立即使用最新可用日期（不重试）
            logger.warn({
              symbol,
              targetDateStr,
              latestAvailableDate: latestDate,
              reason: 'API not updated to target date, using latest available date immediately'
            }, 'Falling back to latest available date');
            
            // 直接使用最新可用日期获取数据（只尝试一次，不重试）
            try {
              const latestDateObj = new Date(result.latestAvailableDate.timestamp);
              const latestHistory = await this.etfService.getFlowHistory(symbol, 7);
              const { start: latestStart, end: latestEnd } = getTargetDateUTCRange(latestDateObj);
              const latestMatchedData = latestHistory?.filter(item => {
                return matchTargetDate(item.timestamp, latestStart, latestEnd);
              }) || [];
              
              if (latestMatchedData.length > 0) {
                actualData = latestMatchedData;
                actualDateStr = latestDate;
                logger.info({
                  symbol,
                  latestDate,
                  dataCount: latestMatchedData.length
                }, 'Successfully fetched data using latest available date');
              } else {
                logger.warn({
                  symbol,
                  latestDate
                }, 'No data found even for latest available date');
              }
            } catch (error) {
              logger.error({
                symbol,
                latestDate,
                error: error instanceof Error ? error.message : String(error)
              }, 'Failed to fetch data using latest available date');
            }
          }
        }
        
        if (actualData.length > 0) {
          reports.push({
            symbol,
            data: actualData,
            latestAvailableDate: result.latestAvailableDate,
            actualDateStr,
          });
          logger.info({
            symbol,
            dataCount: actualData.length,
            targetDateStr,
            actualDateStr,
            isFallback: actualDateStr !== targetDateStr
          }, 'Successfully fetched and added to report');
        } else {
          logger.warn({
            symbol,
            targetDateStr,
            latestAvailableDate: result.latestAvailableDate?.dateStr
          }, 'No data available for symbol, skipping');
        }
        
        // 在币种之间添加延迟，避免并发请求导致限流
        if (symbol !== this.SYMBOLS[this.SYMBOLS.length - 1]) {
          const delayBetweenSymbols = 30000; // 30秒延迟
          logger.info({ symbol, nextSymbol: this.SYMBOLS[this.SYMBOLS.indexOf(symbol) + 1], delay: delayBetweenSymbols }, 'Waiting before fetching next symbol to avoid rate limit');
          await new Promise(resolve => setTimeout(resolve, delayBetweenSymbols));
        }
      } catch (error) {
        // 如果所有重试都失败，记录错误但继续处理其他币种
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error({ error: errorMsg, symbol, targetDateStr }, 'Failed to fetch ETF data after all retries, skipping this symbol');
        // 不添加到 reports，这样报告中就不会包含这个币种
        if (symbol !== this.SYMBOLS[this.SYMBOLS.length - 1]) {
          const delayBetweenSymbols = 30000; // 30秒延迟
          await new Promise(resolve => setTimeout(resolve, delayBetweenSymbols));
        }
      }
    }

    // 【修复C】降级策略：允许部分币种数据生成报告
    if (reports.length < this.MIN_SYMBOLS_FOR_REPORT) {
      logger.error({ reportsCount: reports.length, minRequired: this.MIN_SYMBOLS_FOR_REPORT, targetDateStr }, 'Insufficient ETF data available');
      throw new Error(`所有币种的数据获取都失败，无法生成报告。至少需要 ${this.MIN_SYMBOLS_FOR_REPORT} 个币种的数据。`);
    }
    
    // 确定实际使用的报告日期（优先使用目标日期，如果有降级则标注）
    const actualReportDateStr = reports.every(r => r.actualDateStr === targetDateStr)
      ? targetDateStr
      : reports.map(r => r.actualDateStr).sort()[0]; // 使用最早的可用日期
    
    const hasFallback = reports.some(r => r.actualDateStr !== targetDateStr);
    const missingSymbols = this.SYMBOLS.filter(s => !reports.find(r => r.symbol === s));
    
    logger.info({
      reportsCount: reports.length,
      expectedCount: this.SYMBOLS.length,
      symbols: reports.map(r => r.symbol).join(', '),
      targetDateStr,
      actualReportDateStr,
      hasFallback,
      missingSymbols: missingSymbols.length > 0 ? missingSymbols.join(', ') : 'none'
    }, 'Proceeding with report generation (with fallback if needed)');

    // 构建报告内容
    let content = '';
    content += '═══════════════════════════════════════════════════════════\n';
    content += `ETF 每日资金流报告\n`;
    content += `生成时间: ${generateDateStr} ${generateTimeStr} (UTC+0)\n`;
    content += `目标日期: ${targetDateStr} (UTC+0)\n`;
    
    // 【修复C】如果使用了降级策略，在标题中明确标注
    if (hasFallback) {
      content += `⚠️ 注意: 目标日期 ${targetDateStr} 尚未更新，当前使用最新可用日期 ${actualReportDateStr} (UTC+0)\n`;
      if (missingSymbols.length > 0) {
        content += `缺失币种: ${missingSymbols.join(', ')}\n`;
      }
    } else {
      content += `统计日期: ${actualReportDateStr} (UTC+0)\n`;
      content += `统计区间: ${actualReportDateStr} 00:00–23:59 (UTC+0)\n`;
    }
    
    content += '═══════════════════════════════════════════════════════════\n\n';
    
    // 添加最新可用日期信息
    if (latestAvailableDates.size > 0) {
      content += '📅 各币种最新可用日期（UTC+0）:\n';
      for (const symbol of this.SYMBOLS) {
        const latestDate = latestAvailableDates.get(symbol);
        if (latestDate) {
          content += `  • ${symbol}: ${latestDate}\n`;
        } else {
          content += `  • ${symbol}: 无数据\n`;
        }
      }
      content += '\n';
    }

    // 生成报告内容（所有数据都已成功获取）
    // 【统一计算口径】使用公共函数 aggregateEtfFlows 统一计算所有资产的汇总
    
    for (const report of reports) {
      content += `\n${'─'.repeat(60)}\n`;
      // 如果使用了降级日期，在标题中标注
      if (report.actualDateStr !== targetDateStr) {
        content += `📊 ${report.symbol} ETF 资金流（${report.actualDateStr}，目标日期 ${targetDateStr} 尚未更新）\n`;
      } else {
        content += `📊 ${report.symbol} ETF 资金流（${report.actualDateStr}）\n`;
      }
      content += `${'─'.repeat(60)}\n\n`;

      // 【统一计算】使用公共函数聚合ETF资金流
      const aggregateResult = aggregateEtfFlows(report.data);
      
      // 【一致性校验】校验聚合结果
      const validation = validateAggregateResult(aggregateResult, report.data);
      
      if (!validation.isValid) {
        logger.error({
          symbol: report.symbol,
          actualDateStr: report.actualDateStr,
          recordCount: report.data.length,
          errors: validation.errors,
          sampleRecord: report.data[0],
        }, 'ETF flow aggregate validation failed');
        
        // 校验失败：标记数据校验失败，汇总字段置为"—"
        content += `⚠️ 数据校验失败，汇总字段不可用\n`;
        content += `💰 净流入: —\n`;
        content += `📈 总流入: —\n`;
        content += `📉 总流出: —\n`;
        
        // 获取最新价格（即使校验失败也显示价格）
        const latest = report.data[0];
        const latestPrice = parseFloat(latest.price_usd || '0');
        content += `💎 最新价格: $${formatLargeNumber(latestPrice)}\n`;
        content += `📅 数据点数: ${report.data.length} 条\n\n`;
        content += `主要 ETF 明细: 数据校验失败，明细不可用\n\n`;
        continue;
      }

      // 校验通过：使用聚合结果
      const { netFlowUsd, inflowUsd, outflowAbsUsd, topTickers } = aggregateResult;

      // 获取最新价格（使用最新的一条数据）
      const latest = report.data[0];
      const latestPrice = parseFloat(latest.price_usd || '0');

      // 【统一展示口径】净流入可正可负，总流入永远为正，总流出显示为"-X USD"但数值来自outflowAbsUsd
      content += `💰 净流入: ${netFlowUsd >= 0 ? '+' : ''}${formatLargeNumber(netFlowUsd)} USD\n`;
      content += `📈 总流入: +${formatLargeNumber(inflowUsd)} USD\n`;
      content += `📉 总流出: -${formatLargeNumber(outflowAbsUsd)} USD\n`;
      content += `💎 最新价格: $${formatLargeNumber(latestPrice)}\n`;
      content += `📅 数据点数: ${report.data.length} 条\n\n`;

      // 【统一明细】使用聚合结果中的 topTickers，确保与汇总字段一致
      if (topTickers.length > 0) {
        content += `主要 ETF 明细（${report.actualDateStr} 汇总）:\n`;
        
        // 显示所有ETF（不限制数量），按绝对值排序
        topTickers.forEach(({ ticker, flowUsd }) => {
          const sign = flowUsd >= 0 ? '+' : '';
          content += `  • ${ticker}: ${sign}${formatLargeNumber(flowUsd)} USD\n`;
        });
        content += '\n';
      } else {
        content += `主要 ETF 明细: 暂无数据\n\n`;
      }
      
      // 将聚合结果附加到report对象，供DeepSeek分析使用
      (report as any).aggregateResult = aggregateResult;
    }

    content += '\n';
    content += '═══════════════════════════════════════════════════════════\n';
    content += '数据来源: CoinGlass API\n';
    if (hasFallback) {
      content += `⚠️ 报告说明: 部分币种使用了最新可用日期而非目标日期，详见各币种标题\n`;
    }
    content += '═══════════════════════════════════════════════════════════\n';

    return { content, reportDateStr: actualReportDateStr };
  }

  /**
   * 手动触发生成报告（用于测试）
   */
  async triggerReport(): Promise<string> {
    logger.info('Manually triggering ETF daily report generation');
    await this.generateReport();
    const reportDate = new Date();
    const beijingTime = new Date(reportDate.getTime() + 8 * 60 * 60 * 1000);
    const dateStr = beijingTime.toISOString().split('T')[0];
    const fileName = `etf_daily_report_${dateStr}.txt`;
    return path.join(this.REPORT_DIR, fileName);
  }

  /**
   * 【Lark 专属逻辑】按币种拆分 ETF 数据并分别推送到 Lark Webhook
   * 每个币种发送一条独立消息
   * @param rawDataContent 原始报告内容（包含所有币种）
   * @param reportDateStr 报告日期
   */
  private async sendETFToLarkBySymbol(rawDataContent: string, reportDateStr: string): Promise<void> {
    try {
      logger.info({ reportDateStr }, 'Sending ETF data to Lark webhook (split by symbol)');

      // 从原始内容中提取每个币种的数据
      for (const symbol of this.SYMBOLS) {
        try {
          // 获取该币种的 ETF 数据
          const flow = await this.etfService.getLatestFlow(symbol);
          
          if (!flow) {
            logger.warn({ symbol, reportDateStr }, 'No ETF flow data for symbol, skipping Lark push');
            continue;
          }

          // 使用现有的格式化函数生成单币种消息
          const message = this.etfService.formatLatestFlow(flow, symbol);
          
          // 发送到 Lark Webhook（原有）
          const success = await this.larkWebhook.sendText(message);
          
          if (success) {
            logger.info({ symbol, reportDateStr, messageLength: message.length }, 'ETF data sent to Lark webhook successfully');
          } else {
            logger.warn({ symbol, reportDateStr }, 'Failed to send ETF data to Lark webhook');
          }

          // 发送到统一推送 Webhook（如果配置了）
          if (this.larkWebhookUnified) {
            const unifiedSuccess = await this.larkWebhookUnified.sendText(message);
            if (unifiedSuccess) {
              logger.info({ symbol, reportDateStr }, 'ETF data sent to unified Lark webhook successfully');
            } else {
              logger.warn({ symbol, reportDateStr }, 'Failed to send ETF data to unified Lark webhook');
            }
          }

          // 在币种之间添加短暂延迟，避免请求过快
          if (symbol !== this.SYMBOLS[this.SYMBOLS.length - 1]) {
            await new Promise(resolve => setTimeout(resolve, 1000)); // 1秒延迟
          }
        } catch (error) {
          // 单个币种失败不影响其他币种
          const errorMsg = error instanceof Error ? error.message : String(error);
          logger.error({ error: errorMsg, symbol, reportDateStr }, 'Failed to send ETF data to Lark webhook for symbol');
        }
      }
    } catch (error) {
      // Lark 推送失败不影响主流程
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMsg, reportDateStr }, 'Failed to send ETF data to Lark webhook');
    }
  }
}

