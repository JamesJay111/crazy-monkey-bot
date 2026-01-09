/**
 * Orchestrator - OI 异动扫描系统编排器
 * 整合 TickerSource、Scanner、DecisionEngine、Notifier
 */

import { logger } from '../../utils/logger';
import { TickerSource } from './tickerSource';
import { Scanner } from './scanner';
import { DecisionEngine, DecisionEngineConfig } from './decisionEngine';
import { CandidatePool } from './candidatePool';
import { INotifier } from './notifiers/base';
import { OIAlertEvent, ScanStats, NotificationResult } from './types';
import Database from 'better-sqlite3';
import { CoinGlassClient } from '../../clients/coinglass.client';
import { DeepSeekClient } from '../../clients/deepseek.client';
import { env } from '../../config/env';

export interface OrchestratorConfig {
  scanIntervalMs?: number;
  thresholdPercent?: number;
  cooldownWindowMs?: number;
  interval?: '4h' | '24h';
  scanTopN?: number;
  scanGroups?: string[];
  useDynamicList?: boolean;
  dryRun?: boolean; // dry-run 模式，不真实发送
  concurrency?: number; // 扫描并发数
}

export class OIAlertOrchestrator {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private tickerSource: TickerSource;
  private scanner: Scanner;
  private decisionEngine: DecisionEngine;
  private candidatePool: CandidatePool;
  private notifiers: INotifier[];
  private orchestratorInstance: OIAlertOrchestrator | null = null; // 用于停止时引用

  constructor(
    private coinglass: CoinGlassClient,
    private deepseek: DeepSeekClient,
    private db: Database.Database,
    private config: OrchestratorConfig = {}
  ) {
    // 初始化组件
    this.candidatePool = new CandidatePool(db);
    
    this.tickerSource = new TickerSource(coinglass, {
      scanTopN: config.scanTopN,
      scanGroups: config.scanGroups,
      useDynamicList: config.useDynamicList,
    });

    this.scanner = new Scanner(coinglass);

    const decisionConfig: DecisionEngineConfig = {
      thresholdPercent: config.thresholdPercent || env.OI_ALERT_THRESHOLD_PERCENT || 10,
      cooldownWindowMs: config.cooldownWindowMs || 2 * 60 * 60 * 1000, // 默认 2 小时
      interval: config.interval || '4h',
    };
    this.decisionEngine = new DecisionEngine(this.candidatePool, decisionConfig);

    // 初始化 Notifiers
    this.notifiers = this.initNotifiers();
  }

  /**
   * 初始化 Notifiers
   */
  private initNotifiers(): INotifier[] {
    const notifiers: INotifier[] = [];

    // Lark Notifier
    const larkWebhookUrl = env.LARK_WEBHOOK_UNIFIED || env.LARK_WEBHOOK_OI_ALERT || env.LARK_WEBHOOK_URL;
    if (larkWebhookUrl) {
      const { LarkNotifier } = require('./notifiers/larkNotifier');
      notifiers.push(new LarkNotifier(larkWebhookUrl, this.deepseek));
      logger.info({ webhookUrl: larkWebhookUrl.substring(0, 50) + '...' }, 'Lark notifier initialized');
    }

    // Twitter Notifiers（使用 OAuth 1.0a，检查 token 是否存在）
    // 注意：Twitter OAuth 1.0a token 存储在文件中，这里只检查是否启用 Twitter 推送
    // 实际 token 检查在 XTweetOAuth1Service 中
    try {
      const { hasValidOAuth1Token } = require('../../services/xOAuth1.service');
      
      // 检查账户 A (CrazyMonkeyPerp -> 中文)
      if (hasValidOAuth1Token('accountA')) {
        const { TwitterNotifier } = require('./notifiers/twitterNotifier');
        notifiers.push(new TwitterNotifier({ 
          accountKey: 'accountA',
          deepseek: this.deepseek 
        }));
        logger.info('Twitter notifier (accountA - Chinese) initialized');
      }
      
      // 检查账户 B (CrazyMonkeyPerpEN -> 英文)
      if (hasValidOAuth1Token('accountB')) {
        const { TwitterNotifier } = require('./notifiers/twitterNotifier');
        notifiers.push(new TwitterNotifier({ 
          accountKey: 'accountB',
          deepseek: this.deepseek 
        }));
        logger.info('Twitter notifier (accountB - English) initialized');
      }
      
      // 检查账户 C (CrazyMonkeyPerpKR -> 韩语)
      if (hasValidOAuth1Token('accountC')) {
        const { TwitterNotifier } = require('./notifiers/twitterNotifier');
        notifiers.push(new TwitterNotifier({ 
          accountKey: 'accountC',
          deepseek: this.deepseek 
        }));
        logger.info('Twitter notifier (accountC - Korean) initialized');
      }
    } catch (error) {
      logger.debug({ error }, 'Twitter notifiers not available (OAuth tokens may not be configured)');
    }

    return notifiers;
  }

  /**
   * 启动定时扫描
   */
  start(): void {
    if (this.intervalId) {
      logger.warn('OI Alert Orchestrator is already running');
      return;
    }

    const intervalMs = this.config.scanIntervalMs || env.OI_ALERT_POLL_INTERVAL_MS || 10 * 60 * 1000;

    logger.info({
      scanIntervalMs: intervalMs,
      scanIntervalMinutes: intervalMs / (60 * 1000),
      thresholdPercent: this.config.thresholdPercent || env.OI_ALERT_THRESHOLD_PERCENT || 10,
      dryRun: this.config.dryRun || false,
      notifiers: this.notifiers.map(n => n.getName()),
    }, 'Starting OI Alert Orchestrator');

    // 立即执行一次
    this.runScan().catch(error => {
      logger.error({ error }, 'Failed to run initial scan');
    });

    // 定时执行
    this.intervalId = setInterval(() => {
      this.runScan().catch(error => {
        logger.error({ error }, 'Failed to run scheduled scan');
      });
    }, intervalMs);

    logger.info('OI Alert Orchestrator started');
  }

  /**
   * 停止定时扫描
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('OI Alert Orchestrator stopped');
    }
    // 清理候选池中的旧记录（可选）
    try {
      this.candidatePool['cleanupOldRecords'](7); // 清理 7 天前的记录
    } catch (error) {
      logger.warn({ error }, 'Failed to cleanup old candidate records');
    }
  }

  /**
   * 执行一次完整扫描
   */
  async runScan(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Scan is already running, skipping');
      return;
    }

    this.isRunning = true;
    const scanStartTime = Date.now();

    try {
      logger.info('Running OI alert scan...');

      // 1. 获取 ticker 列表
      const tickers = await this.tickerSource.getTickers();
      logger.info({ tickerCount: tickers.length }, 'Got tickers from source');

      // 2. 扫描所有 ticker
      const scanResults = await this.scanner.scanTickers(
        tickers,
        this.config.concurrency || 5
      );

      // 3. 决策引擎处理
      const { events, stats } = await this.decisionEngine.processScanResults(scanResults);

      // 4. 记录统计
      this.logScanStats(stats, scanResults.length, Date.now() - scanStartTime);

      // 5. 推送事件（如果不在 dry-run 模式）
      if (!this.config.dryRun && events.length > 0) {
        await this.sendNotifications(events);
      } else if (this.config.dryRun) {
        logger.info({
          eventCount: events.length,
          events: events.map(e => ({
            symbol: e.symbol,
            oiChangePct: e.oiChangePct,
            direction: e.direction,
          })),
        }, 'Dry-run mode: events would be sent');
      }

      logger.info('OI alert scan completed');
    } catch (error) {
      logger.error({ error }, 'Failed to run scan');
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 发送通知到所有渠道
   */
  private async sendNotifications(events: OIAlertEvent[]): Promise<void> {
    const results: NotificationResult[] = [];

    for (const event of events) {
      for (const notifier of this.notifiers) {
        try {
          const result = await notifier.send(event);
          results.push(result);

          if (result.success) {
            logger.info({
              eventId: event.eventId,
              symbol: event.symbol,
              channel: result.channel,
            }, 'Notification sent successfully');
          } else {
            logger.warn({
              eventId: event.eventId,
              symbol: event.symbol,
              channel: result.channel,
              error: result.error,
            }, 'Notification failed');
          }
        } catch (error: any) {
          logger.error({
            error: error.message,
            eventId: event.eventId,
            symbol: event.symbol,
            channel: notifier.getName(),
          }, 'Notification error');
        }
      }
    }

    // 记录推送摘要
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    logger.info({
      totalEvents: events.length,
      totalNotifications: results.length,
      successCount,
      failCount,
      channels: [...new Set(results.map(r => r.channel))],
    }, 'Notification summary');
  }

  /**
   * 记录扫描统计
   */
  private logScanStats(stats: ScanStats, totalTickers: number, durationMs: number): void {
    logger.info({
      totalTickers,
      successCount: stats.successCount,
      noDataCount: stats.noDataCount,
      rateLimitCount: stats.rateLimitCount,
      fatalErrorCount: stats.fatalErrorCount,
      candidateCount: stats.candidateCount,
      confirmedCount: stats.confirmedCount,
      droppedCount: stats.droppedCount,
      durationMs,
      durationSeconds: (durationMs / 1000).toFixed(1),
    }, 'Scan statistics');
  }
}

