/**
 * 宏观事件 Lark Webhook 推送服务
 * 每 10 分钟执行一次，仅推送到 Lark Webhook，不影响 Twitter 推送
 */

import { CoinGlassClient } from '../clients/coinglass.client';
import { DeepSeekClient } from '../clients/deepseek.client';
import Database from 'better-sqlite3';
import { logger } from '../utils/logger';
import { CoinGlassMacroEvent } from '../types/macroEvent';
import { EventDTO } from '../types/macroEvent';
import { normalizeEvents } from '../utils/macroEventNormalizer';
import { LarkWebhookService } from './larkWebhook.service';
import { LarkWebhookCustomService } from './larkWebhookCustom.service';
import { MacroUsTweetJobService } from './macroUsTweetJob.service';
import { env } from '../config/env';

/**
 * 宏观事件 Lark 推送服务
 * 独立于 Twitter 推送，每 10 分钟执行一次
 */
export class MacroLarkPushService {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private readonly POLL_INTERVAL_MS = 10 * 60 * 1000; // 10 分钟
  private readonly TIME_WINDOW_HOURS = { past: 6, future: 24 }; // 过去6小时 + 未来24小时
  private larkWebhook: LarkWebhookService;
  private larkWebhookUnified: LarkWebhookCustomService | null = null;
  private larkWebhookMacroNews: LarkWebhookCustomService | null = null; // 新增：宏观事件专用 Webhook
  private macroUsTweetJob: MacroUsTweetJobService;
  private readonly MACRO_NEWS_WEBHOOK_URL = 'https://open.larksuite.com/open-apis/bot/v2/hook/65eb21dc-9053-4e91-9a8b-9945a049c051';

  constructor(
    private coinglass: CoinGlassClient,
    private deepseek: DeepSeekClient,
    private db: Database.Database,
    macroUsTweetJob: MacroUsTweetJobService
  ) {
    this.larkWebhook = new LarkWebhookService();
    
    // 初始化统一推送 Webhook（如果配置了）
    if (env.LARK_WEBHOOK_UNIFIED) {
      this.larkWebhookUnified = new LarkWebhookCustomService(env.LARK_WEBHOOK_UNIFIED);
      logger.info({ webhookUrl: env.LARK_WEBHOOK_UNIFIED.substring(0, 50) + '...' }, 'Unified Lark webhook initialized for macro events');
    }
    
    // 初始化宏观事件专用 Webhook（新增）
    this.larkWebhookMacroNews = new LarkWebhookCustomService(this.MACRO_NEWS_WEBHOOK_URL);
    logger.info({ webhookUrl: this.MACRO_NEWS_WEBHOOK_URL.substring(0, 50) + '...' }, 'Macro event news webhook initialized');
    
    // 复用 MacroUsTweetJobService 的方法来获取事件和生成推文
    this.macroUsTweetJob = macroUsTweetJob;
  }

  /**
   * 启动 Job（每 10 分钟执行一次）
   */
  start(): void {
    if (this.intervalId) {
      logger.warn('Macro Lark push job is already running');
      return;
    }

    logger.info({
      pollIntervalMs: this.POLL_INTERVAL_MS,
      pollIntervalMinutes: this.POLL_INTERVAL_MS / (60 * 1000),
    }, 'Starting macro Lark push job (10 minutes interval)');

    // 立即执行一次
    this.runLarkPushOnce().catch(error => {
      logger.error({ error }, 'Failed to run initial macro Lark push job');
    });

    // 每 10 分钟执行一次
    this.intervalId = setInterval(() => {
      this.runLarkPushOnce().catch(error => {
        logger.error({ error }, 'Failed to run scheduled macro Lark push job');
      });
    }, this.POLL_INTERVAL_MS);

    logger.info('Macro Lark push job started');
  }

  /**
   * 停止 Job
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('Macro Lark push job stopped');
    }
  }

  /**
   * 执行一次 Lark 推送任务
   */
  private async runLarkPushOnce(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Macro Lark push job is already running, skipping');
      return;
    }

    this.isRunning = true;

    try {
      logger.info('Running macro Lark push job...');

      // 1. 拉取事件（复用 MacroUsTweetJobService 的方法）
      const events = await this.fetchEvents();
      logger.info({ totalEvents: events.length }, 'Fetched events from CoinGlass');

      // 2. 过滤多国事件（美国、中国、俄罗斯、英国、南美洲等）
      const filteredEvents = this.filterMultiCountryEvents(events);
      logger.info({ filteredEventsCount: filteredEvents.length }, 'Filtered multi-country events');

      // 3. 去重（排除已推送的，但只检查 Lark 推送记录）
      const candidates = await this.deduplicateEvents(filteredEvents);
      logger.info({ candidatesCount: candidates.length }, 'Deduplicated events for Lark');

      if (candidates.length === 0) {
        logger.info('No candidate events to push to Lark');
        return;
      }

      // 4. 选择最佳事件（只选 1 条）
      const selectedEvent = this.selectBestEvent(candidates);
      logger.info({
        eventKey: selectedEvent.event_key,
        calendarName: selectedEvent.calendar_name,
        publishTime: new Date(selectedEvent.publish_time_utc_ms).toISOString(),
        importanceLevel: selectedEvent.importance_level,
        status: selectedEvent.status,
      }, 'Selected event for Lark push');

      // 5. 生成三语言推文（中文、英文、韩语）
      const zhTweet = await this.macroUsTweetJob['generateTweetForAccount'](
        selectedEvent,
        { key: 'accountA', language: 'zh' as const, name: 'CrazyMonkeyPerp (Chinese)' }
      );
      
      // 使用 MacroUsTweetJobService 的 generateTweets 方法生成三语言推文
      const tweets = await this.macroUsTweetJob['generateTweets'](selectedEvent);
      
      logger.info({
        zhLength: tweets.zh.length,
        enLength: tweets.en.length,
        koLength: tweets.kr.length,
      }, 'Generated tweets for three languages');

      // 6. 推送到原有 Lark Webhook（保持兼容性）
      await this.sendMacroEventToLark(selectedEvent, zhTweet);
      
      // 7. 推送到新增的宏观事件 Webhook（分开发送三语言）
      await this.sendMacroEventToNewWebhook(selectedEvent, { zh: tweets.zh, en: tweets.en, ko: tweets.kr });

      // 7. 记录 Lark 推送日志（可选，如果需要单独记录）
      logger.info({
        eventKey: selectedEvent.event_key,
        calendarName: selectedEvent.calendar_name,
        textLength: zhTweet.length,
      }, 'Macro event Lark push completed');

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      logger.error({ 
        error: errorMsg,
        stack: errorStack,
        errorObject: error 
      }, 'Failed to run macro Lark push job');
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 拉取事件（复用 MacroUsTweetJobService 的逻辑）
   */
  private async fetchEvents(): Promise<CoinGlassMacroEvent[]> {
    const now = Date.now();
    // 注意：CoinGlass v4.0 API 需要毫秒级时间戳，不是秒级
    const startTime = now - this.TIME_WINDOW_HOURS.past * 60 * 60 * 1000; // 毫秒级
    const endTime = now + this.TIME_WINDOW_HOURS.future * 60 * 60 * 1000; // 毫秒级

    try {
      const events = await this.coinglass.getMacroEvents({
        start_time: startTime, // 毫秒级时间戳
        end_time: endTime, // 毫秒级时间戳
      });
      return events || [];
    } catch (error) {
      logger.error({ error }, 'Failed to fetch macro events');
      return [];
    }
  }

  /**
   * 过滤多国事件（美国、中国、俄罗斯、英国、南美洲等）
   */
  private filterMultiCountryEvents(events: CoinGlassMacroEvent[]): EventDTO[] {
    // 支持的国家代码列表
    const supportedCountryCodes = [
      // 美国
      'USA', 'US', 'UNITED_STATES',
      // 中国
      'CN', 'CHN', 'CHINA', 'CNY',
      // 俄罗斯
      'RU', 'RUS', 'RUSSIA', 'RUB',
      // 英国
      'GB', 'GBR', 'UK', 'UNITED_KINGDOM', 'ENGLAND',
      // 南美洲主要国家
      'BR', 'BRA', 'BRAZIL', // 巴西
      'AR', 'ARG', 'ARGENTINA', // 阿根廷
      'MX', 'MEX', 'MEXICO', // 墨西哥
      'CL', 'CHL', 'CHILE', // 智利
      'CO', 'COL', 'COLOMBIA', // 哥伦比亚
      'PE', 'PER', 'PERU', // 秘鲁
      // 其他重要国家
      'JP', 'JPN', 'JAPAN', // 日本
      'DE', 'DEU', 'GERMANY', // 德国
      'FR', 'FRA', 'FRANCE', // 法国
      'IT', 'ITA', 'ITALY', // 意大利
      'CA', 'CAN', 'CANADA', // 加拿大
      'AU', 'AUS', 'AUSTRALIA', // 澳大利亚
      'IN', 'IND', 'INDIA', // 印度
      'KR', 'KOR', 'SOUTH_KOREA', 'KOREA', // 韩国
      'EU', 'EUR', 'EUROZONE', // 欧元区
    ];
    
    const filtered = events.filter(event => {
      const countryCode = event.country_code?.toUpperCase();
      return supportedCountryCodes.includes(countryCode || '');
    });
    return normalizeEvents(filtered);
  }

  /**
   * 去重（检查是否已推送到 Lark）
   * 注意：这里只检查 Lark 推送，不影响 Twitter 推送的去重逻辑
   */
  private async deduplicateEvents(events: EventDTO[]): Promise<EventDTO[]> {
    try {
      // 查询已推送的事件（从 macro_event_push_log 表）
      // 由于 Lark 推送和 Twitter 推送共用同一个表，我们检查是否有任何推送记录
      const stmt = this.db.prepare(`
        SELECT event_key FROM macro_event_push_log
        WHERE event_key = ?
      `);

      const candidates: EventDTO[] = [];
      for (const event of events) {
        const existing = stmt.get(event.event_key);
        // 如果事件已推送过（无论是 Twitter 还是 Lark），则跳过
        // 这样可以避免重复推送
        if (!existing) {
          candidates.push(event);
        }
      }

      return candidates;
    } catch (error) {
      logger.error({ error }, 'Failed to deduplicate events');
      return events; // 出错时返回所有事件
    }
  }

  /**
   * 选择最佳事件（复用 MacroUsTweetJobService 的逻辑）
   */
  private selectBestEvent(events: EventDTO[]): EventDTO {
    if (events.length === 0) {
      throw new Error('No events to select');
    }

    const now = Date.now();
    return events.sort((a, b) => {
      // 1. 重要性级别（3 > 2 > 1）
      if (a.importance_level !== b.importance_level) {
        return b.importance_level - a.importance_level;
      }

      // 2. 距离当前时间最近（abs(publish_time - now) 最小）
      const timeDiffA = Math.abs(a.publish_time_utc_ms - now);
      const timeDiffB = Math.abs(b.publish_time_utc_ms - now);
      if (timeDiffA !== timeDiffB) {
        return timeDiffA - timeDiffB;
      }

      // 3. RELEASED 优先于 UPCOMING
      if (a.status !== b.status) {
        return a.status === 'RELEASED' ? -1 : 1;
      }

      return 0;
    })[0];
  }

  /**
   * 推送财经新闻到 Lark Webhook
   */
  private async sendMacroEventToLark(event: EventDTO, tweetText: string): Promise<void> {
    try {
      // 格式化消息，使其更适合 Lark 显示
      const formattedMessage = this.formatLarkMessage(event, tweetText);
      
      // 发送到 Lark Webhook（原有）
      const success = await this.larkWebhook.sendText(formattedMessage);
      
      if (success) {
        logger.info({ 
          eventKey: event.event_key, 
          calendarName: event.calendar_name,
          textLength: formattedMessage.length 
        }, 'Macro event sent to Lark webhook successfully');
      } else {
        logger.warn({ 
          eventKey: event.event_key, 
          calendarName: event.calendar_name 
        }, 'Failed to send macro event to Lark webhook');
      }

      // 发送到统一推送 Webhook（如果配置了）
      if (this.larkWebhookUnified) {
        try {
          const unifiedSuccess = await this.larkWebhookUnified.sendText(formattedMessage);
          if (unifiedSuccess) {
            logger.info({ 
              eventKey: event.event_key, 
              calendarName: event.calendar_name 
            }, 'Macro event sent to unified Lark webhook successfully');
          } else {
            logger.warn({ 
              eventKey: event.event_key, 
              calendarName: event.calendar_name 
            }, 'Failed to send macro event to unified Lark webhook');
          }
        } catch (error) {
          logger.warn({ error, eventKey: event.event_key }, 'Failed to send macro event to unified Lark webhook');
          // 不影响主流程
        }
      }
      
      // 记录推送日志到数据库（以原有推送结果为准）
      await this.logPushToDatabase(event, formattedMessage, success);
    } catch (error) {
      // Lark 推送失败不影响主流程
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error({ 
        error: errorMsg, 
        eventKey: event.event_key 
      }, 'Failed to send macro event to Lark webhook');
      
      // 记录错误日志
      await this.logPushToDatabase(event, tweetText, false, errorMsg);
    }
  }

  /**
   * 推送宏观事件到新增的 Webhook（分开发送中文/英文/韩语三条消息）
   */
  private async sendMacroEventToNewWebhook(
    event: EventDTO,
    tweets: { zh: string; en: string; ko: string }
  ): Promise<void> {
    if (!this.larkWebhookMacroNews) {
      logger.warn('Macro news webhook not initialized, skipping');
      return;
    }

    try {
      // 分开发送三条消息：中文、英文、韩语各一条
      
      // 1. 发送中文版本
      const zhMessage = `🇨🇳 中文版本\n\n${tweets.zh}`;
      const zhSuccess = await this.larkWebhookMacroNews.sendText(zhMessage);
      if (zhSuccess) {
        logger.info({ eventKey: event.event_key, language: 'zh' }, 'Successfully sent Chinese macro event to new webhook');
      } else {
        logger.warn({ eventKey: event.event_key, language: 'zh' }, 'Failed to send Chinese macro event to new webhook');
      }
      await this.sleep(1000); // 延迟避免限流

      // 2. 发送英文版本
      const enMessage = `🇺🇸 英文版本\n\n${tweets.en}`;
      const enSuccess = await this.larkWebhookMacroNews.sendText(enMessage);
      if (enSuccess) {
        logger.info({ eventKey: event.event_key, language: 'en' }, 'Successfully sent English macro event to new webhook');
      } else {
        logger.warn({ eventKey: event.event_key, language: 'en' }, 'Failed to send English macro event to new webhook');
      }
      await this.sleep(1000); // 延迟避免限流

      // 3. 发送韩语版本
      const koMessage = `🇰🇷 韩语版本\n\n${tweets.ko}`;
      const koSuccess = await this.larkWebhookMacroNews.sendText(koMessage);
      if (koSuccess) {
        logger.info({ eventKey: event.event_key, language: 'ko' }, 'Successfully sent Korean macro event to new webhook');
      } else {
        logger.warn({ eventKey: event.event_key, language: 'ko' }, 'Failed to send Korean macro event to new webhook');
      }

      logger.info({
        eventKey: event.event_key,
        calendarName: event.calendar_name,
        results: {
          zh: zhSuccess ? 'sent' : 'failed',
          en: enSuccess ? 'sent' : 'failed',
          ko: koSuccess ? 'sent' : 'failed',
        },
      }, 'All macro event messages sent to new webhook');

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error({
        error: errorMsg,
        eventKey: event.event_key,
      }, 'Failed to send macro event to new webhook');
      // 不影响主流程
    }
  }

  /**
   * 延迟函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 格式化 Lark 消息
   */
  private formatLarkMessage(event: EventDTO, tweetText: string): string {
    const icon = this.getIcon(event.importance_level, event.status);
    const publishTime = new Date(event.publish_time_utc_ms).toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
    
    // 获取国家名称
    const countryName = this.getCountryName(event.country_code);
    
    // 构建格式化的消息
    let message = `${icon} ${countryName}宏观事件\n\n`;
    message += `📅 事件：${event.calendar_name}\n`;
    message += `🌍 国家：${countryName}\n`;
    message += `⏰ 时间：${publishTime}\n`;
    message += `📊 重要性：${event.importance_level}/3\n`;
    message += `📌 状态：${event.status === 'RELEASED' ? '已发布' : '即将发布'}\n`;
    
    // 如果有预期值或前值，添加这些信息
    if (event.forecast_value) {
      message += `📈 预期值：${event.forecast_value}\n`;
    }
    if (event.previous_value) {
      message += `📉 前值：${event.previous_value}\n`;
    }
    if (event.published_value) {
      message += `✅ 公布值：${event.published_value}\n`;
    }
    
    message += `\n${tweetText}`;
    
    return message;
  }

  /**
   * 获取图标
   */
  private getIcon(importanceLevel: number, status: 'UPCOMING' | 'RELEASED'): string {
    let icon = 'ℹ️';
    if (importanceLevel === 3) icon = '🚨';
    else if (importanceLevel === 2) icon = '⚠️';
    
    // 添加状态图标
    if (status === 'UPCOMING') {
      icon += ' ⏱️';
    } else if (status === 'RELEASED') {
      icon += ' ✅';
    }
    
    return icon;
  }

  /**
   * 获取国家名称（中文）
   */
  private getCountryName(countryCode: string): string {
    const countryMap: Record<string, string> = {
      'USA': '美国',
      'US': '美国',
      'UNITED_STATES': '美国',
      'CN': '中国',
      'CHN': '中国',
      'CHINA': '中国',
      'CNY': '中国',
      'RU': '俄罗斯',
      'RUS': '俄罗斯',
      'RUSSIA': '俄罗斯',
      'RUB': '俄罗斯',
      'GB': '英国',
      'GBR': '英国',
      'UK': '英国',
      'UNITED_KINGDOM': '英国',
      'ENGLAND': '英国',
      'BR': '巴西',
      'BRA': '巴西',
      'BRAZIL': '巴西',
      'AR': '阿根廷',
      'ARG': '阿根廷',
      'ARGENTINA': '阿根廷',
      'MX': '墨西哥',
      'MEX': '墨西哥',
      'MEXICO': '墨西哥',
      'CL': '智利',
      'CHL': '智利',
      'CHILE': '智利',
      'CO': '哥伦比亚',
      'COL': '哥伦比亚',
      'COLOMBIA': '哥伦比亚',
      'PE': '秘鲁',
      'PER': '秘鲁',
      'PERU': '秘鲁',
      'JP': '日本',
      'JPN': '日本',
      'JAPAN': '日本',
      'DE': '德国',
      'DEU': '德国',
      'GERMANY': '德国',
      'FR': '法国',
      'FRA': '法国',
      'FRANCE': '法国',
      'IT': '意大利',
      'ITA': '意大利',
      'ITALY': '意大利',
      'CA': '加拿大',
      'CAN': '加拿大',
      'CANADA': '加拿大',
      'AU': '澳大利亚',
      'AUS': '澳大利亚',
      'AUSTRALIA': '澳大利亚',
      'IN': '印度',
      'IND': '印度',
      'INDIA': '印度',
      'KR': '韩国',
      'KOR': '韩国',
      'SOUTH_KOREA': '韩国',
      'KOREA': '韩国',
      'EU': '欧元区',
      'EUR': '欧元区',
      'EUROZONE': '欧元区',
    };
    
    const upperCode = countryCode.toUpperCase();
    return countryMap[upperCode] || countryCode;
  }

  /**
   * 记录推送日志到数据库
   */
  private async logPushToDatabase(
    event: EventDTO, 
    message: string, 
    success: boolean, 
    error?: string
  ): Promise<void> {
    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO macro_event_push_log (
          event_key,
          calendar_name,
          publish_time_utc_ms,
          importance_level,
          status,
          sent_at_utc_ms,
          tw_a_status,
          tw_b_status,
          tw_c_status,
          lark_status,
          last_error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const now = Date.now();
      stmt.run(
        event.event_key,
        event.calendar_name,
        event.publish_time_utc_ms,
        event.importance_level,
        event.status,
        now,
        null, // tw_a_status
        null, // tw_b_status
        null, // tw_c_status
        success ? 'sent' : 'failed', // lark_status
        error || null
      );

      logger.info({
        eventKey: event.event_key,
        success,
        hasError: !!error
      }, 'Macro event Lark push logged to database');
    } catch (error) {
      logger.error({ error, eventKey: event.event_key }, 'Failed to log macro event Lark push to database');
    }
  }
}

