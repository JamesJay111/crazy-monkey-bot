/**
 * ETF Twitter 多语言推送服务
 * 每天北京时间 15:00 推送前一天（UTC+0）的 ETF 数据到三个 Twitter 账户
 */

import { logger } from '../utils/logger';
import { ETFService } from './etf.service';
import { XTweetOAuth1Service } from './xTweetOAuth1.service';
import { formatEtfAmountM } from '../utils/etfFormatter';
import Database from 'better-sqlite3';
import * as cron from 'node-cron';
import { getTargetDateUTCRange } from '../utils/etfDateMatcher';

/**
 * ETF 资金流数据
 */
interface ETFFlowData {
  BTC: number | null;
  XRP: number | null;
  ETH: number | null;
  SOL: number | null;
}

/**
 * 推文生成结果
 */
interface TweetResult {
  accountKey: string;
  language: 'zh' | 'en' | 'ko';
  tweetText: string;
  success: boolean;
  tweetId?: string;
  url?: string;
  error?: string;
}

/**
 * 账户配置
 */
const ACCOUNT_CONFIG = {
  A: { key: 'accountA', language: 'zh' as const, name: 'CrazyMonkeyPerp (Chinese)' },
  B: { key: 'accountB', language: 'en' as const, name: 'CrazyMonkeyPerpEN (English)' },
  C: { key: 'accountC', language: 'ko' as const, name: 'CrazyMonkeyPerpKR (Korean)' },
} as const;

export class ETFTwitterPushService {
  private cronJob: cron.ScheduledTask | null = null;
  private isRunning = false;

  constructor(
    private etfService: ETFService,
    private twitterService: XTweetOAuth1Service,
    private db: Database.Database
  ) {
    this.initDatabase();
  }

  /**
   * 初始化数据库表
   */
  private initDatabase(): void {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS etf_twitter_push_log (
          date TEXT PRIMARY KEY,
          target_date_utc TEXT NOT NULL,
          pushed_at_utc_ms INTEGER NOT NULL,
          account_a_status TEXT CHECK(account_a_status IN ('sent', 'failed', 'skipped')),
          account_b_status TEXT CHECK(account_b_status IN ('sent', 'failed', 'skipped')),
          account_c_status TEXT CHECK(account_c_status IN ('sent', 'failed', 'skipped')),
          account_a_tweet_id TEXT,
          account_b_tweet_id TEXT,
          account_c_tweet_id TEXT,
          btc_netflow_m TEXT,
          xrp_netflow_m TEXT,
          eth_netflow_m TEXT,
          sol_netflow_m TEXT,
          last_error TEXT
        )
      `);
      logger.info('ETF Twitter push log table initialized');
    } catch (error) {
      logger.error({ error }, 'Failed to init ETF Twitter push log database');
    }
  }

  /**
   * 启动定时任务（每天北京时间 15:00）
   */
  start(): void {
    if (this.cronJob) {
      logger.warn('ETF Twitter push service is already running');
      return;
    }

    // 北京时间 15:00 = Asia/Shanghai 时区的 15:00
    // cron 表达式：0 15 * * *（每天 15:00）
    // 注意：node-cron 默认使用系统时区，需要显式指定 Asia/Shanghai
    this.cronJob = cron.schedule('0 15 * * *', async () => {
      await this.runDailyPush();
    }, {
      scheduled: true,
      timezone: 'Asia/Shanghai'
    });

    logger.info({
      schedule: '每天北京时间 15:00',
      timezone: 'Asia/Shanghai',
      cron: '0 15 * * *'
    }, 'ETF Twitter push service started');
  }

  /**
   * 停止定时任务
   */
  stop(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      logger.info('ETF Twitter push service stopped');
    }
  }

  /**
   * 执行每日推送任务
   */
  async runDailyPush(): Promise<void> {
    if (this.isRunning) {
      logger.warn('ETF Twitter push is already running, skipping');
      return;
    }

    this.isRunning = true;
    const triggerTime = Date.now();

    try {
      logger.info({ triggerTime: new Date(triggerTime).toISOString() }, 'Running ETF Twitter daily push');

      // 1. 计算目标日期（前一天 UTC+0）
      const targetDate = new Date();
      targetDate.setUTCDate(targetDate.getUTCDate() - 1);
      const targetDateStr = targetDate.toISOString().split('T')[0]; // YYYY-MM-DD
      const displayDate = this.formatDisplayDate(targetDate); // YYYY/MM/DD

      // 2. 检查幂等性（是否已推送过该日期）
      if (await this.isAlreadyPushed(targetDateStr)) {
        logger.info({ targetDateStr }, 'ETF data for this date has already been pushed, skipping');
        return;
      }

      // 3. 获取四个币种的数据
      const flows = await this.fetchAllFlows(targetDate);
      logger.info({
        targetDateStr,
        flows: {
          BTC: flows.BTC !== null ? formatEtfAmountM(flows.BTC) : '—',
          XRP: flows.XRP !== null ? formatEtfAmountM(flows.XRP) : '—',
          ETH: flows.ETH !== null ? formatEtfAmountM(flows.ETH) : '—',
          SOL: flows.SOL !== null ? formatEtfAmountM(flows.SOL) : '—',
        }
      }, 'Fetched ETF flows for all symbols');

      // 4. 生成三条推文（中文、英文、韩文）
      const tweets = {
        zh: this.buildTweet(displayDate, flows, 'zh'),
        en: this.buildTweet(displayDate, flows, 'en'),
        ko: this.buildTweet(displayDate, flows, 'ko'),
      };

      logger.info({
        zhLength: tweets.zh.length,
        enLength: tweets.en.length,
        koLength: tweets.ko.length,
      }, 'Generated tweets for three languages');

      // 5. 发送到三个账户
      const results: TweetResult[] = [];
      
      // 账户 A（中文）
      const resultA = await this.postTweet(ACCOUNT_CONFIG.A.key, tweets.zh, 'zh');
      results.push(resultA);
      
      // 延迟避免限流
      await this.sleep(2000);
      
      // 账户 B（英文）
      const resultB = await this.postTweet(ACCOUNT_CONFIG.B.key, tweets.en, 'en');
      results.push(resultB);
      
      // 延迟避免限流
      await this.sleep(2000);
      
      // 账户 C（韩文）
      const resultC = await this.postTweet(ACCOUNT_CONFIG.C.key, tweets.ko, 'ko');
      results.push(resultC);

      // 6. 记录推送日志
      await this.logPush(targetDateStr, displayDate, flows, results);

      logger.info({
        targetDateStr,
        results: {
          accountA: resultA.success ? 'sent' : 'failed',
          accountB: resultB.success ? 'sent' : 'failed',
          accountC: resultC.success ? 'sent' : 'failed',
        },
        tweetIds: {
          accountA: resultA.tweetId,
          accountB: resultB.tweetId,
          accountC: resultC.tweetId,
        }
      }, 'ETF Twitter push completed');

    } catch (error) {
      logger.error({ error, triggerTime }, 'ETF Twitter push failed');
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 获取所有币种的数据
   */
  private async fetchAllFlows(targetDate: Date): Promise<ETFFlowData> {
    const symbols: Array<'BTC' | 'ETH' | 'SOL' | 'XRP'> = ['BTC', 'ETH', 'SOL', 'XRP'];
    const flows: ETFFlowData = {
      BTC: null,
      XRP: null,
      ETH: null,
      SOL: null,
    };

    // 使用目标日期获取数据
    const { start, end } = getTargetDateUTCRange(targetDate);

    // 并发获取所有币种数据（带错误处理）
    const promises = symbols.map(async (symbol) => {
      try {
        // 使用 ETFService 的 getFlowHistory 方法
        const history = await this.etfService['getFlowHistory'](symbol, 7);
        
        if (!Array.isArray(history) || history.length === 0) {
          logger.warn({ symbol, targetDate: targetDate.toISOString().split('T')[0] }, 'No history data for symbol');
          return { symbol, netflow: null };
        }
        
        // 筛选目标日期的数据
        const targetData = history.filter(item => {
          const itemTimestamp = item.timestamp;
          return itemTimestamp >= start && itemTimestamp <= end;
        });

        if (targetData.length === 0) {
          logger.warn({ symbol, targetDate: targetDate.toISOString().split('T')[0] }, 'No data for symbol on target date');
          return { symbol, netflow: null };
        }

        // 聚合净流入
        const netflow = targetData.reduce((sum, item) => {
          const flow = parseFloat(item.flow_usd || '0');
          return sum + flow;
        }, 0);

        return { symbol, netflow };
      } catch (error) {
        logger.error({ error, symbol }, `Failed to fetch ${symbol} ETF flow`);
        return { symbol, netflow: null };
      }
    });

    const results = await Promise.all(promises);
    results.forEach(({ symbol, netflow }) => {
      flows[symbol] = netflow;
    });

    return flows;
  }

  /**
   * 构建推文内容
   */
  private buildTweet(date: string, flows: ETFFlowData, language: 'zh' | 'en' | 'ko'): string {
    const btcFlow = formatEtfAmountM(flows.BTC);
    const xrpFlow = formatEtfAmountM(flows.XRP);
    const ethFlow = formatEtfAmountM(flows.ETH);
    const solFlow = formatEtfAmountM(flows.SOL);

    const templates = {
      zh: `📊 ETF流入流出（${date}）

BTC 现货 ETF: ${btcFlow}
XRP现货 ETF: ${xrpFlow}
ETH现货 ETF: ${ethFlow}
SOL现货ETF: ${solFlow}`,
      en: `📊 ETF Flows (${date})

BTC Spot ETF: ${btcFlow}
XRP Spot ETF: ${xrpFlow}
ETH Spot ETF: ${ethFlow}
SOL Spot ETF: ${solFlow}`,
      ko: `📊 ETF 자금흐름 (${date})

BTC 현물 ETF: ${btcFlow}
XRP 현물 ETF: ${xrpFlow}
ETH 현물 ETF: ${ethFlow}
SOL 현물 ETF: ${solFlow}`,
    };

    return templates[language];
  }

  /**
   * 发送推文（带重试逻辑）
   */
  private async postTweet(accountKey: string, tweetText: string, language: 'zh' | 'en' | 'ko'): Promise<TweetResult> {
    const maxRetries = 2;
    let lastError: any = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.twitterService.sendTweet(tweetText, accountKey);
        
        return {
          accountKey,
          language,
          tweetText,
          success: true,
          tweetId: result.tweetId,
          url: result.url,
        };
      } catch (error: any) {
        lastError = error;
        const errorMsg = error.response?.data?.detail || error.message || 'Unknown error';
        const status = error.response?.status;

        // 如果是 429 限流，等待后重试
        if (status === 429 && attempt < maxRetries) {
          const retryAfter = error.response?.headers?.['retry-after'] 
            ? parseInt(error.response.headers['retry-after']) * 1000 
            : (attempt + 1) * 5000; // 默认 5s, 10s
          
          logger.warn({
            accountKey,
            language,
            attempt: attempt + 1,
            retryAfter,
          }, 'Twitter rate limit, retrying after delay');
          
          await this.sleep(retryAfter);
          continue;
        }

        // 401/403 权限错误，不重试
        if (status === 401 || status === 403) {
          logger.error({
            error: errorMsg,
            accountKey,
            language,
            status,
          }, 'Twitter authentication error, skipping account');
          break;
        }

        // 其他错误，重试一次
        if (attempt < maxRetries) {
          logger.warn({
            error: errorMsg,
            accountKey,
            language,
            attempt: attempt + 1,
            status,
          }, 'Twitter error, retrying');
          await this.sleep((attempt + 1) * 2000); // 2s, 4s
          continue;
        }
      }
    }

    // 所有重试都失败
    const errorMsg = lastError?.response?.data?.detail || lastError?.message || 'Unknown error';
    logger.error({
      error: errorMsg,
      accountKey,
      language,
      status: lastError?.response?.status,
    }, 'Failed to post ETF tweet after retries');

    return {
      accountKey,
      language,
      tweetText,
      success: false,
      error: errorMsg,
    };
  }

  /**
   * 格式化显示日期（YYYY/MM/DD）
   */
  private formatDisplayDate(date: Date): string {
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}/${month}/${day}`;
  }

  /**
   * 检查是否已推送过该日期
   */
  private async isAlreadyPushed(dateStr: string): Promise<boolean> {
    try {
      const stmt = this.db.prepare('SELECT date FROM etf_twitter_push_log WHERE date = ?');
      const row = stmt.get(dateStr) as { date: string } | undefined;
      return !!row;
    } catch (error) {
      logger.error({ error, dateStr }, 'Failed to check if date already pushed');
      return false; // 出错时返回 false，允许重试
    }
  }

  /**
   * 记录推送日志
   */
  private async logPush(
    dateStr: string,
    displayDate: string,
    flows: ETFFlowData,
    results: TweetResult[]
  ): Promise<void> {
    try {
      const resultA = results.find(r => r.accountKey === 'accountA');
      const resultB = results.find(r => r.accountKey === 'accountB');
      const resultC = results.find(r => r.accountKey === 'accountC');

      const stmt = this.db.prepare(`
        INSERT INTO etf_twitter_push_log (
          date, target_date_utc, pushed_at_utc_ms,
          account_a_status, account_b_status, account_c_status,
          account_a_tweet_id, account_b_tweet_id, account_c_tweet_id,
          btc_netflow_m, xrp_netflow_m, eth_netflow_m, sol_netflow_m,
          last_error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        dateStr,
        displayDate,
        Date.now(),
        resultA?.success ? 'sent' : (resultA ? 'failed' : 'skipped'),
        resultB?.success ? 'sent' : (resultB ? 'failed' : 'skipped'),
        resultC?.success ? 'sent' : (resultC ? 'failed' : 'skipped'),
        resultA?.tweetId || null,
        resultB?.tweetId || null,
        resultC?.tweetId || null,
        formatEtfAmountM(flows.BTC),
        formatEtfAmountM(flows.XRP),
        formatEtfAmountM(flows.ETH),
        formatEtfAmountM(flows.SOL),
        results.find(r => !r.success)?.error || null
      );

      logger.info({ dateStr }, 'ETF Twitter push logged to database');
    } catch (error) {
      logger.error({ error, dateStr }, 'Failed to log ETF Twitter push');
    }
  }

  /**
   * 延迟函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 手动触发推送（用于测试）
   */
  async triggerPush(force: boolean = false): Promise<void> {
    if (!force && this.isRunning) {
      throw new Error('Push is already running');
    }
    await this.runDailyPush();
  }
}

