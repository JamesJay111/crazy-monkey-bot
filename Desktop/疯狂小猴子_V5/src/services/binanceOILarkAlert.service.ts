/**
 * Binance 合约 OI 异动推送到 Lark Webhook 服务
 * 
 * 功能：
 * - 每 10 分钟扫描 Binance 交易所各币种的未平仓合约（OI）变化
 * - 当 abs(ΔOI_4h%) >= 10% 时触发推送
 * - 实现去重/冷却机制（60分钟）
 * - 方向反转时可突破冷却
 * - 调用 DeepSeek 生成 20-30 字解读
 */

import Database from 'better-sqlite3';
import { logger } from '../utils/logger';
import { CoinGlassClient } from '../clients/coinglass.client';
import { DeepSeekClient } from '../clients/deepseek.client';
import { env } from '../config/env';
import { RetryUtil } from '../utils/retry';
import axios from 'axios';
import { LarkWebhookCustomService } from './larkWebhookCustom.service';

/**
 * OI 异动数据
 */
interface OIAlertData {
  ticker: string;
  oiNowUsd: number;
  oiChange1hPercent: number;
  priceChange1hPercent: number;
  oiChange4hPercent: number;
  priceChange4hPercent: number;
  marketCapUsd: number | null;
  oiMcPercent: number | null;
  priceChange24hPercent: number | null;
  direction: number; // -1: 下降, 0: 无变化, 1: 上升
}

/**
 * Cooldown 记录
 */
interface CooldownRecord {
  ticker: string;
  lastSentAtUtcMs: number;
  lastDirection: number;
  lastOiChangePercent: number;
}

/**
 * Binance OI 异动推送服务
 */
export class BinanceOILarkAlertService {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private readonly POLL_INTERVAL_MS = env.OI_ALERT_POLL_INTERVAL_MS || 10 * 60 * 1000; // 默认 10 分钟
  private readonly OI_THRESHOLD_PERCENT = env.OI_ALERT_THRESHOLD_PERCENT || 10; // 默认 10%
  private readonly COOLDOWN_MS = env.OI_ALERT_COOLDOWN_MS || 60 * 60 * 1000; // 默认 60 分钟
  private readonly LARK_WEBHOOK_URL = env.LARK_WEBHOOK_OI_ALERT || env.LARK_WEBHOOK_URL || 'https://open.larksuite.com/open-apis/bot/v2/hook/f182517d-8c87-4a09-adc9-be40730b0506';
  private larkWebhookUnified: LarkWebhookCustomService | null = null;

  constructor(
    private coinglass: CoinGlassClient,
    private deepseek: DeepSeekClient,
    private db: Database.Database
  ) {
    this.initDatabase();
    
    // 初始化统一推送 Webhook（如果配置了）
    if (env.LARK_WEBHOOK_UNIFIED) {
      this.larkWebhookUnified = new LarkWebhookCustomService(env.LARK_WEBHOOK_UNIFIED);
      logger.info({ webhookUrl: env.LARK_WEBHOOK_UNIFIED.substring(0, 50) + '...' }, 'Unified Lark webhook initialized for OI alerts');
    }
  }

  /**
   * 初始化数据库表
   */
  private initDatabase(): void {
    try {
      // 表已在 init.sql 中创建，这里只做验证
      const tableInfo = this.db.prepare("PRAGMA table_info(binance_oi_alert_cooldown)").all();
      if (tableInfo.length === 0) {
        logger.warn('binance_oi_alert_cooldown table not found, please check db/init.sql');
      }
    } catch (error) {
      logger.error({ error }, 'Failed to init OI alert cooldown database');
    }
  }

  /**
   * 启动 Job（每 10 分钟执行一次）
   */
  start(): void {
    if (this.intervalId) {
      logger.warn('Binance OI alert job is already running');
      return;
    }

    logger.info({
      pollIntervalMs: this.POLL_INTERVAL_MS,
      pollIntervalMinutes: this.POLL_INTERVAL_MS / (60 * 1000),
      thresholdPercent: this.OI_THRESHOLD_PERCENT,
      cooldownMinutes: this.COOLDOWN_MS / (60 * 1000),
    }, 'Starting Binance OI alert job');

    // 立即执行一次
    this.runJobOnce().catch(error => {
      logger.error({ error }, 'Failed to run initial OI alert job');
    });

    // 每 10 分钟执行一次
    this.intervalId = setInterval(() => {
      this.runJobOnce().catch(error => {
        logger.error({ error }, 'Failed to run scheduled OI alert job');
      });
    }, this.POLL_INTERVAL_MS);

    logger.info('Binance OI alert job started');
  }

  /**
   * 停止 Job
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('Binance OI alert job stopped');
    }
  }

  /**
   * 执行一次扫描任务
   */
  private async runJobOnce(): Promise<void> {
    if (this.isRunning) {
      logger.warn('OI alert job is already running, skipping');
      return;
    }

    this.isRunning = true;

    try {
      logger.info('Running Binance OI alert job...');

      // 1. 获取 Binance 交易所的 ticker 列表
      const tickers = await this.getBinanceTickers();
      logger.info({ tickerCount: tickers.length }, 'Fetched Binance tickers');

      if (tickers.length === 0) {
        logger.warn('No Binance tickers found, skipping');
        return;
      }

      // 2. 对每个 ticker 计算信号并筛选
      const alerts: OIAlertData[] = [];
      for (const ticker of tickers) {
        try {
          const alertData = await this.calculateOIAlert(ticker);
          if (alertData) {
            alerts.push(alertData);
          }
        } catch (error) {
          logger.warn({ error, ticker }, 'Failed to calculate OI alert for ticker');
          // 继续处理下一个 ticker
        }
      }

      logger.info({ alertCount: alerts.length }, 'Calculated OI alerts');

      // 3. 通过 cooldown 去重
      const filteredAlerts = await this.filterByCooldown(alerts);
      logger.info({ filteredCount: filteredAlerts.length }, 'Filtered alerts by cooldown');

      // 4. 生成文案 + 推送 Lark
      for (const alert of filteredAlerts) {
        try {
          await this.sendAlert(alert);
          // 记录 cooldown
          await this.recordCooldown(alert);
        } catch (error) {
          logger.error({ error, ticker: alert.ticker }, 'Failed to send OI alert');
          // 继续处理下一个 alert
        }
      }

      logger.info('Binance OI alert job completed');
    } catch (error) {
      logger.error({ error }, 'Failed to run OI alert job');
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 获取 Binance 交易所的 ticker 列表
   */
  private async getBinanceTickers(): Promise<string[]> {
    try {
      // 方法1：尝试从 pairs-markets 获取所有 Binance 交易对（最全面）
      try {
        const allPairs = await this.coinglass.getFuturesPairsMarkets({
          exchange: 'Binance',
          // 不传 symbol 参数，获取所有交易对
        });
        
        if (allPairs && allPairs.length > 0) {
          // 从交易对中提取币种符号（去掉 USDT/USDC 等后缀）
          const tickerSet = new Set<string>();
          for (const pair of allPairs) {
            const symbol = pair.symbol || pair.instrument_id || '';
            // 提取币种符号（例如：BTC/USDT -> BTC, BREVUSDT -> BREV）
            const baseSymbol = symbol
              .replace(/\/USDT$|\/USDC$|\/BUSD$/i, '') // 去掉 /USDT, /USDC, /BUSD
              .replace(/USDT$|USDC$|BUSD$/i, '') // 去掉 USDT, USDC, BUSD 后缀
              .toUpperCase();
            
            if (baseSymbol && baseSymbol.length > 0 && baseSymbol.length <= 10) {
              tickerSet.add(baseSymbol);
            }
          }
          
          const tickers = Array.from(tickerSet);
          logger.info({ tickerCount: tickers.length, sampleTickers: tickers.slice(0, 10) }, 'Got Binance tickers from pairs-markets');
          return tickers;
        }
      } catch (error) {
        logger.debug({ error }, 'Failed to get all pairs from pairs-markets, trying fallback');
      }

      // 方法2：尝试从支持的币种列表获取
      const supportedCoins = await this.coinglass.getFuturesSupportedCoins();
      if (supportedCoins && supportedCoins.length > 0) {
        // 如果支持的币种列表不为空，使用所有支持的币种（不再限制为常见币种）
        const tickers = supportedCoins.map(coin => coin.toUpperCase());
        logger.info({ tickerCount: tickers.length }, 'Got Binance tickers from supported coins');
        return tickers;
      }

      // 方法3：使用扩展的常见币种列表（包含更多币种）
      const fallbackTickers = [
        'BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'ADA', 'DOGE', 'AVAX', 'MATIC', 'DOT',
        'LINK', 'UNI', 'ATOM', 'LTC', 'BCH', 'ETC', 'XLM', 'ALGO', 'FIL', 'ICP',
        'APT', 'ARB', 'OP', 'SUI', 'SEI', 'TIA', 'INJ', 'NEAR', 'FTM', 'AAVE',
        'MKR', 'SNX', 'COMP', 'CRV', 'SUSHI', '1INCH', 'YFI', 'SAND', 'MANA',
        'ENJ', 'GALA', 'AXS', 'CHZ', 'FLOW', 'THETA', 'BAT', 'ZRX', 'EOS', 'TRX',
        'XMR', 'DASH', 'ZEC', 'QTUM', 'ONT', 'VET', 'IOTA', 'NEO', 'WAVES', 'OMG',
        'BREV', 'PEPE', 'SHIB', 'FLOKI', 'BONK', 'WIF', 'JUP', 'PYTH', 'RENDER', 'FET',
        'AGIX', 'OCEAN', 'RNDR', 'AI', 'TAO', 'AKT', 'LPT', 'LRC', 'IMX', 'GRT'
      ];
      
      logger.warn({ fallbackCount: fallbackTickers.length }, 'Using fallback ticker list');
      return fallbackTickers;
    } catch (error) {
      logger.error({ error }, 'Failed to get Binance tickers');
      // 返回扩展的常见币种列表作为最后备选（包含 BREV）
      return [
        'BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'ADA', 'DOGE', 'AVAX', 'MATIC', 'DOT',
        'LINK', 'UNI', 'ATOM', 'LTC', 'BCH', 'ETC', 'XLM', 'ALGO', 'FIL', 'ICP',
        'APT', 'ARB', 'OP', 'SUI', 'SEI', 'TIA', 'INJ', 'NEAR', 'FTM', 'AAVE',
        'BREV', 'PEPE', 'SHIB', 'FLOKI', 'BONK', 'WIF', 'JUP', 'PYTH'
      ];
    }
  }

  /**
   * 计算 OI 异动数据
   */
  private async calculateOIAlert(ticker: string): Promise<OIAlertData | null> {
    try {
      // 获取当前 OI 数据（从 pairs-markets）
      const pairs = await this.coinglass.getFuturesPairsMarkets({
        exchange: 'Binance',
        symbol: ticker,
      });

      if (pairs.length === 0) {
        return null;
      }

      // 只汇总 Binance 交易所的交易对 OI（确保获取完整的 OI 数据）
      // 注意：API 可能返回多个交易所的数据，需要过滤
      const binancePairs = pairs.filter((p: any) => 
        (p.exchange_name || '').toLowerCase() === 'binance'
      );
      
      let totalOiUsd = 0;
      let totalPrice = 0;
      let priceCount = 0;
      
      // 如果找到 Binance 交易对，只汇总 Binance 的
      const pairsToSum = binancePairs.length > 0 ? binancePairs : pairs;
      
      for (const pair of pairsToSum) {
        const oi = parseFloat(pair.open_interest_usd || '0');
        const price = parseFloat(pair.current_price || '0');
        if (oi > 0) {
          totalOiUsd += oi;
        }
        if (price > 0) {
          totalPrice += price;
          priceCount++;
        }
      }
      
      // 使用汇总的 OI，如果汇总为 0 则使用第一个交易对的 OI
      const oiNowUsd = totalOiUsd > 0 ? totalOiUsd : parseFloat(pairs[0].open_interest_usd || '0');
      // 使用平均价格，如果无法计算则使用第一个交易对的价格
      const currentPrice = priceCount > 0 ? totalPrice / priceCount : parseFloat(pairs[0].current_price || '0');
      
      // 选择一个代表性交易对用于后续逻辑（优先 Binance USDT 交易对）
      const currentPair = binancePairs.find((p: any) => 
        p.instrument_id?.endsWith('USDT') || p.symbol?.includes('/USDT')
      ) || binancePairs[0] || pairs[0];

      if (oiNowUsd <= 0 || currentPrice <= 0) {
        return null;
      }

      // 获取 OI 历史数据（用于计算 1h 和 4h 变化）
      // 注意：CoinGlass 可能不支持 1h interval，我们需要通过时间序列计算
      const now = Date.now();
      const oneHourAgo = now - 60 * 60 * 1000;
      const fourHoursAgo = now - 4 * 60 * 60 * 1000;
      const twentyFourHoursAgo = now - 24 * 60 * 60 * 1000;

      // 计算 1h 和 4h 前的 OI（初始值设为当前值）
      let oi1hAgo = oiNowUsd;
      let oi4hAgo = oiNowUsd;

      // 尝试获取 OI 历史（使用 4h interval，然后通过时间点计算）
      let oiHistory: any[] = [];
      try {
        oiHistory = await this.coinglass.getOpenInterestOhlcHistory({
          symbol: ticker,
          exchange: 'Binance',
          interval: '4h',
          limit: 10, // 获取最近 10 条数据
        });
      } catch (error) {
        // API 返回 404 或其他错误，使用 fallback 逻辑
        logger.debug({ error, ticker }, 'Failed to get OI history, using fallback');
      }

      if (oiHistory.length > 0) {
        // 找到最接近 1h 前的时间点（使用最新的历史数据作为近似）
        // 由于 CoinGlass 可能不支持 1h interval，我们使用 4h 数据来估算
        // 如果历史数据中有最近的数据，使用它；否则使用当前值
        const latestHistory = oiHistory[0];
        if (latestHistory) {
          const latestTime = latestHistory.time || latestHistory.timestamp || 0;
          const timeDiff = now - latestTime;
          
          // 如果最新数据是 1-5 小时前的，可以用它来估算 1h 前的值
          if (timeDiff >= 60 * 60 * 1000 && timeDiff <= 5 * 60 * 60 * 1000) {
            oi1hAgo = parseFloat(latestHistory.close || latestHistory.value || oiNowUsd.toString());
          }
        }

        // 找到最接近 4h 前的时间点
        for (const item of oiHistory) {
          const itemTime = item.time || item.timestamp || 0;
          if (itemTime <= fourHoursAgo && itemTime > fourHoursAgo - 2 * 60 * 60 * 1000) {
            oi4hAgo = parseFloat(item.close || item.value || '0');
            break;
          }
        }
      }

      // 如果历史数据不足或 API 失败，使用 pairs-markets 的 24h 变化百分比来估算
      if (currentPair.open_interest_change_percent_24h) {
        const oiChange24hPercent = parseFloat(currentPair.open_interest_change_percent_24h.toString());
        
        // 如果 1h 前的值还是当前值（说明历史数据获取失败），使用 24h 变化估算
        if (oi1hAgo === oiNowUsd && oiChange24hPercent !== 0) {
          // 估算 1h 变化（假设线性变化）
          oi1hAgo = oiNowUsd / (1 + oiChange24hPercent / 100 * (1 / 24));
        }
        
        // 如果 4h 前的值还是当前值（说明历史数据获取失败），使用 24h 变化估算
        if (oi4hAgo === oiNowUsd && oiChange24hPercent !== 0) {
          // 估算 4h 变化（假设线性变化）：4h = 24h * (4/24) = 24h * 1/6
          oi4hAgo = oiNowUsd / (1 + oiChange24hPercent / 100 * (4 / 24));
        }
      }

      // 对于价格变化，尝试从 pairs-markets 获取价格变化百分比
      // 如果 pairs-markets 提供了价格变化百分比，可以使用它
      let priceChange1hPercent = 0;
      let priceChange4hPercent = 0;
      let priceChange24hPercent: number | null = null;
      
      // 尝试从 pairs-markets 获取 24h 价格变化百分比
      if (currentPair.price_change_percent_24h !== undefined && currentPair.price_change_percent_24h !== null) {
        priceChange24hPercent = parseFloat(currentPair.price_change_percent_24h.toString());
        // 估算 4h 价格变化（假设线性变化）：4h = 24h * (4/24) = 24h * 1/6
        if (priceChange24hPercent !== 0) {
          priceChange4hPercent = priceChange24hPercent * (4 / 24);
          // 估算 1h 价格变化（假设线性变化）：1h = 24h * (1/24) = 24h * 1/24
          priceChange1hPercent = priceChange24hPercent * (1 / 24);
        }
      }

      // 计算 OI 变化百分比
      const oiChange1hPercent = oi1hAgo > 0 ? ((oiNowUsd - oi1hAgo) / oi1hAgo) * 100 : 0;
      const oiChange4hPercent = oi4hAgo > 0 ? ((oiNowUsd - oi4hAgo) / oi4hAgo) * 100 : 0;

      // 检查是否满足阈值（使用 4h 变化）
      if (Math.abs(oiChange4hPercent) < this.OI_THRESHOLD_PERCENT) {
        return null;
      }

      // 获取市值（如果可用）
      let marketCapUsd: number | null = null;
      try {
        // 尝试从 pairs-markets 获取市值（如果有）
        // 或者使用其他数据源
        // 这里先返回 null，后续可以扩展
        marketCapUsd = null;
      } catch (error) {
        logger.debug({ error, ticker }, 'Failed to get market cap');
      }

      // 计算 OI/MC 比率
      const oiMcPercent = marketCapUsd && marketCapUsd > 0 
        ? (oiNowUsd / marketCapUsd) * 100 
        : null;

      // 确定方向（使用 4h 变化）
      const direction = oiChange4hPercent > 0 ? 1 : (oiChange4hPercent < 0 ? -1 : 0);

      return {
        ticker,
        oiNowUsd,
        oiChange1hPercent,
        priceChange1hPercent,
        oiChange4hPercent,
        priceChange4hPercent,
        marketCapUsd,
        oiMcPercent,
        priceChange24hPercent,
        direction,
      };
    } catch (error) {
      logger.error({ error, ticker }, 'Failed to calculate OI alert');
      return null;
    }
  }

  /**
   * 通过 cooldown 过滤
   */
  private async filterByCooldown(alerts: OIAlertData[]): Promise<OIAlertData[]> {
    const now = Date.now();
    const filtered: OIAlertData[] = [];

    for (const alert of alerts) {
      const cooldownRecord = this.getCooldownRecord(alert.ticker);
      
      if (!cooldownRecord) {
        // 没有记录，允许推送
        filtered.push(alert);
        continue;
      }

      const timeSinceLastSent = now - cooldownRecord.lastSentAtUtcMs;
      
      // 检查是否在冷却期内
      if (timeSinceLastSent < this.COOLDOWN_MS) {
        // 检查方向反转
        const isDirectionReversed = 
          (cooldownRecord.lastDirection > 0 && alert.direction < 0) ||
          (cooldownRecord.lastDirection < 0 && alert.direction > 0);
        
        if (isDirectionReversed && Math.abs(alert.oiChange4hPercent) >= this.OI_THRESHOLD_PERCENT) {
          // 方向反转且仍满足阈值，允许突破冷却
          logger.info({
            ticker: alert.ticker,
            lastDirection: cooldownRecord.lastDirection,
            currentDirection: alert.direction,
            timeSinceLastSent: timeSinceLastSent / (60 * 1000), // 分钟
          }, 'Direction reversed, allowing alert despite cooldown');
          filtered.push(alert);
        } else {
          // 仍在冷却期内且未反转，跳过
          logger.debug({
            ticker: alert.ticker,
            timeSinceLastSent: timeSinceLastSent / (60 * 1000), // 分钟
            cooldownMinutes: this.COOLDOWN_MS / (60 * 1000),
          }, 'Alert skipped due to cooldown');
        }
      } else {
        // 冷却期已过，允许推送
        filtered.push(alert);
      }
    }

    return filtered;
  }

  /**
   * 获取 cooldown 记录
   */
  private getCooldownRecord(ticker: string): CooldownRecord | null {
    try {
      const stmt = this.db.prepare(`
        SELECT ticker, last_sent_at_utc_ms, last_direction, last_oi_change_percent
        FROM binance_oi_alert_cooldown
        WHERE ticker = ?
      `);
      const row = stmt.get(ticker) as any;
      
      if (!row) {
        return null;
      }

      return {
        ticker: row.ticker,
        lastSentAtUtcMs: row.last_sent_at_utc_ms,
        lastDirection: row.last_direction,
        lastOiChangePercent: row.last_oi_change_percent,
      };
    } catch (error) {
      logger.error({ error, ticker }, 'Failed to get cooldown record');
      return null;
    }
  }

  /**
   * 记录 cooldown
   */
  private async recordCooldown(alert: OIAlertData): Promise<void> {
    try {
      const now = Date.now();
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO binance_oi_alert_cooldown (
          ticker,
          last_sent_at_utc_ms,
          last_direction,
          last_oi_change_percent,
          created_at_utc_ms,
          updated_at_utc_ms
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);

      // 检查是否已存在记录
      const existing = this.getCooldownRecord(alert.ticker);
      const createdAt = existing ? (existing as any).created_at_utc_ms || now : now;

      stmt.run(
        alert.ticker,
        now,
        alert.direction,
        alert.oiChange4hPercent,
        createdAt,
        now
      );

      logger.debug({ ticker: alert.ticker }, 'Cooldown recorded');
    } catch (error) {
      logger.error({ error, ticker: alert.ticker }, 'Failed to record cooldown');
    }
  }

  /**
   * 发送推送
   */
  private async sendAlert(alert: OIAlertData): Promise<void> {
    try {
      // 生成消息
      const message = await this.buildMessage(alert);
      
      // 发送到 Lark Webhook（带重试）
      const success = await RetryUtil.retry(
        async () => {
          return await this.sendToLark(message);
        },
        {
          maxAttempts: 2,
          backoffMs: 500,
          exponential: true,
        }
      );

      if (success) {
        logger.info({
          ticker: alert.ticker,
          oiChange4hPercent: alert.oiChange4hPercent.toFixed(2),
        }, 'OI alert sent to Lark successfully');
      } else {
        logger.warn({ ticker: alert.ticker }, 'Failed to send OI alert to Lark after retries');
      }

      // 发送到统一推送 Webhook（如果配置了）
      if (this.larkWebhookUnified) {
        try {
          const unifiedSuccess = await this.larkWebhookUnified.sendText(message);
          if (unifiedSuccess) {
            logger.info({
              ticker: alert.ticker,
              oiChange4hPercent: alert.oiChange4hPercent.toFixed(2),
            }, 'OI alert sent to unified Lark webhook successfully');
          } else {
            logger.warn({ ticker: alert.ticker }, 'Failed to send OI alert to unified Lark webhook');
          }
        } catch (error) {
          logger.warn({ error, ticker: alert.ticker }, 'Failed to send OI alert to unified Lark webhook');
          // 不影响主流程
        }
      }
    } catch (error) {
      logger.error({ error, ticker: alert.ticker }, 'Failed to send OI alert');
      throw error;
    }
  }

  /**
   * 构建消息
   */
  private async buildMessage(alert: OIAlertData): Promise<string> {
    // 格式化数据（使用 4h 变化作为主要指标）
    const oiNowM = (alert.oiNowUsd / 1_000_000).toFixed(1);
    const oiChange4hPercentStr = alert.oiChange4hPercent >= 0 
      ? `+${alert.oiChange4hPercent.toFixed(2)}` 
      : alert.oiChange4hPercent.toFixed(2);
    const priceChange4hPercentStr = alert.priceChange4hPercent >= 0
      ? `+${alert.priceChange4hPercent.toFixed(2)}`
      : alert.priceChange4hPercent.toFixed(2);
    const oiChange1hPercentStr = alert.oiChange1hPercent >= 0
      ? `+${alert.oiChange1hPercent.toFixed(2)}`
      : alert.oiChange1hPercent.toFixed(2);
    const priceChange1hPercentStr = alert.priceChange1hPercent >= 0
      ? `+${alert.priceChange1hPercent.toFixed(2)}`
      : alert.priceChange1hPercent.toFixed(2);
    const oiMcPercentStr = alert.oiMcPercent !== null 
      ? alert.oiMcPercent.toFixed(2) 
      : '—';
    const priceChange24hPercentStr = alert.priceChange24hPercent !== null
      ? (alert.priceChange24hPercent >= 0 
          ? `+${alert.priceChange24hPercent.toFixed(2)}`
          : alert.priceChange24hPercent.toFixed(2))
      : '—';
    const mcNowM = alert.marketCapUsd !== null 
      ? (alert.marketCapUsd / 1_000_000).toFixed(1) 
      : '—';

    // 确定图标
    const icon = alert.direction < 0 ? '🔴' : (alert.direction > 0 ? '🟢' : '⚪');

    // 生成 DeepSeek 解读
    let interpretation = 'OI 异动明显，关注仓位变化与短线波动。';
    try {
      interpretation = await this.generateInterpretation(alert);
    } catch (error) {
      logger.warn({ error, ticker: alert.ticker }, 'Failed to generate DeepSeek interpretation, using fallback');
    }

    // 构建消息（严格按照模板）
    let message = `${icon} ${alert.ticker} 币安未平仓合约变化 ${oiChange4hPercentStr}%，价格过去4小时变化 ${priceChange4hPercentStr}%，未平仓合约：${oiNowM}M 美元`;
    
    // 只在有数据时显示 24h 价格变化
    if (priceChange24hPercentStr !== '—') {
      message += `，24小时价格变化：${priceChange24hPercentStr}%`;
    }
    message += '\n\n';
    
    message += `解读：${interpretation}\n\n`;
    message += `备注：如果是未平仓合约是下降的 icon 是 🔴，上升的是 🟢`;

    return message;
  }

  /**
   * 生成 DeepSeek 解读（20-30 字）
   */
  private async generateInterpretation(alert: OIAlertData): Promise<string> {
    const systemPrompt = `你是一名专业的加密货币市场分析师。请根据未平仓合约（OI）异动数据，生成一段 20-30 个中文字符的简短市场解读。

要求：
1. 客观、简短、偏交易信号提示
2. 不要给投资建议
3. 不要使用多段落
4. 严格控制在 20-30 个中文字符之间
5. 重点关注 OI 变化与价格变化的关联性`;

    const userPrompt = `币种：${alert.ticker}
4小时 OI 变化：${alert.oiChange4hPercent >= 0 ? '+' : ''}${alert.oiChange4hPercent.toFixed(2)}%
4小时价格变化：${alert.priceChange4hPercent >= 0 ? '+' : ''}${alert.priceChange4hPercent.toFixed(2)}%
1小时 OI 变化：${alert.oiChange1hPercent >= 0 ? '+' : ''}${alert.oiChange1hPercent.toFixed(2)}%
1小时价格变化：${alert.priceChange1hPercent >= 0 ? '+' : ''}${alert.priceChange1hPercent.toFixed(2)}%
24小时价格变化：${alert.priceChange24hPercent !== null ? (alert.priceChange24hPercent >= 0 ? '+' : '') + alert.priceChange24hPercent.toFixed(2) : '—'}%

请生成 20-30 个中文字符的市场解读。`;

    try {
      const response = await this.deepseek.analyzeWithPrompt(
        systemPrompt,
        userPrompt,
        { temperature: 0.7, maxTokens: 100 }
      );

      let interpretation = response.trim();
      
      // 确保长度在 20-30 字之间
      if (interpretation.length < 20) {
        interpretation = 'OI 异动明显，关注仓位变化与短线波动。';
      } else if (interpretation.length > 30) {
        interpretation = interpretation.substring(0, 30);
        // 尝试在句号处截断
        const lastPeriod = interpretation.lastIndexOf('。');
        if (lastPeriod >= 20) {
          interpretation = interpretation.substring(0, lastPeriod + 1);
        }
      }

      return interpretation;
    } catch (error) {
      logger.error({ error, ticker: alert.ticker }, 'Failed to generate DeepSeek interpretation');
      return 'OI 异动明显，关注仓位变化与短线波动。';
    }
  }

  /**
   * 发送到 Lark Webhook
   */
  private async sendToLark(text: string): Promise<boolean> {
    try {
      const payload = {
        msg_type: 'text',
        content: {
          text: text,
        },
      };

      const response = await axios.post(this.LARK_WEBHOOK_URL, payload, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 10000, // 10秒超时
      });

      if (response.status === 200) {
        logger.info({ textLength: text.length }, 'Lark webhook OI alert sent successfully');
        return true;
      } else {
        logger.warn({ status: response.status, statusText: response.statusText }, 'Lark webhook returned non-200 status');
        return false;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMsg }, 'Failed to send message to Lark webhook');
      return false;
    }
  }
}

