  /**
   * CoinGlass 多国宏观事件 → Twitter 三语言多账户自动推送服务
   * 
   * 功能：
   * - 每 2 小时轮询一次 CoinGlass 宏观事件
   * - 推送多国事件：美国、中国、俄罗斯、英国、南美洲等
   * - 每次最多推送 1 条事件
   * - 三账户分别发布：A(中文)、B(英文)、C(韩语)
   * - 使用 DeepSeek 生成推文内容
   * - 字符数限制：<=200 characters
   */

import Database from 'better-sqlite3';
import { logger } from '../utils/logger';
import { CoinGlassClient } from '../clients/coinglass.client';
import { DeepSeekClient } from '../clients/deepseek.client';
import { XTweetOAuth1Service } from './xTweetOAuth1.service';
import { CoinGlassMacroEvent } from '../types/macroEvent';
import { EventDTO, MacroEventPushLog } from '../types/macroEvent';
import { normalizeEvents } from '../utils/macroEventNormalizer';
import { RetryUtil } from '../utils/retry';
import { 
  validateTweetLanguage, 
  removeSTMTLabels, 
  deduplicateIcons,
  type TweetLanguage 
} from '../utils/tweetLanguageValidator';
import { LarkWebhookService } from './larkWebhook.service';

/**
 * 账户配置（强绑定：账户 -> 语言）
 * 映射关系：
 * - accountA (CrazyMonkeyPerp) -> zh (中文) - 主账户，首先生成
 * - accountB (CrazyMonkeyEN) -> en (英文) - 从中文翻译
 * - accountC (CrazyMonkeyKR) -> ko (韩语) - 从中文翻译
 */
const ACCOUNT_CONFIG = {
  A: { 
    key: 'accountA', 
    language: 'zh' as const, // 中文（主账户）
    name: 'CrazyMonkeyPerp (Chinese)' 
  },
  B: { 
    key: 'accountB', 
    language: 'en' as const, // 英文（从中文翻译）
    name: 'CrazyMonkeyEN (English)' 
  },
  C: { 
    key: 'accountC', 
    language: 'ko' as const, // 韩语（从中文翻译）
    name: 'CrazyMonkeyKR (Korean)' 
  },
} as const;

/**
 * 重要性级别对应的 Icon
 */
const IMPORTANCE_ICONS: Record<number, string> = {
  3: '🚨',
  2: '⚠️',
  1: 'ℹ️',
};

/**
 * 宏观事件自动推送 Job 服务
 */
export class MacroUsTweetJobService {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private readonly POLL_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 小时
  private readonly TIME_WINDOW_HOURS = { past: 6, future: 24 }; // 过去6小时 + 未来24小时
  private readonly MAX_TWEET_LENGTH = 200;
  private larkWebhook: LarkWebhookService;

  constructor(
    private coinglass: CoinGlassClient,
    private deepseek: DeepSeekClient,
    private tweetService: XTweetOAuth1Service,
    private db: Database.Database
  ) {
    this.initDatabase();
    // 初始化 Lark Webhook 服务（仅用于该 Webhook）
    this.larkWebhook = new LarkWebhookService();
  }

  /**
   * 初始化数据库表
   */
  private initDatabase(): void {
    try {
      // 表已在 init.sql 中创建，这里只做验证
      const tableInfo = this.db.prepare("PRAGMA table_info(macro_event_push_log)").all();
      if (tableInfo.length === 0) {
        logger.warn('macro_event_push_log table not found, please check db/init.sql');
      }
    } catch (error) {
      logger.error({ error }, 'Failed to init macro event push log database');
    }
  }

  /**
   * 启动 Job（每 2 小时执行一次）
   */
  start(): void {
    if (this.intervalId) {
      logger.warn('Macro US tweet job is already running');
      return;
    }

    logger.info({
      pollIntervalMs: this.POLL_INTERVAL_MS,
      pollIntervalHours: this.POLL_INTERVAL_MS / (60 * 60 * 1000),
    }, 'Starting macro US tweet job');

    // 立即执行一次
    this.runJobOnce().catch(error => {
      logger.error({ error }, 'Failed to run initial macro US tweet job');
    });

    // 每 2 小时执行一次
    this.intervalId = setInterval(() => {
      this.runJobOnce().catch(error => {
        logger.error({ error }, 'Failed to run scheduled macro US tweet job');
      });
    }, this.POLL_INTERVAL_MS);

    logger.info('Macro US tweet job started');
  }

  /**
   * 停止 Job
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('Macro US tweet job stopped');
    }
  }

  /**
   * 执行一次 Job
   */
  private async runJobOnce(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Macro US tweet job is already running, skipping');
      return;
    }

    this.isRunning = true;

    try {
      logger.info('Running macro US tweet job...');

      // 1. 拉取事件
      const events = await this.fetchEvents();
      logger.info({ totalEvents: events.length }, 'Fetched events from CoinGlass');

      // 2. 过滤美国事件
      const usaEvents = this.filterUSAEvents(events);
      logger.info({ usaEventsCount: usaEvents.length }, 'Filtered USA events');

      // 3. 去重（排除已推送的）
      const candidates = await this.deduplicateEvents(usaEvents);
      logger.info({ candidatesCount: candidates.length }, 'Deduplicated events');

      if (candidates.length === 0) {
        logger.info('No candidate events to push');
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
      }, 'Selected event for push');

      // 5. 检查是否有相关新闻（文章或快讯），如果有则转发
      const relatedNews = await this.findRelatedNews(selectedEvent);
      if (relatedNews && relatedNews.tweetId) {
        logger.info({
          eventKey: selectedEvent.event_key,
          newsType: relatedNews.type,
          tweetId: relatedNews.tweetId,
        }, 'Found related news, will quote tweet instead of generating new tweet');
        
        // 6. 转发新闻推文到三账户
        const results = await this.quoteNewsTweets(selectedEvent, relatedNews);
        
        // 7. 记录推送日志
        await this.logPush(selectedEvent, results);
        
        logger.info({
          eventKey: selectedEvent.event_key,
          results: {
            accountA: results.accountA.status,
            accountB: results.accountB.status,
            accountC: results.accountC.status,
          },
        }, 'Macro event news quote tweet job completed');
        return;
      }

      // 5. 如果没有相关新闻，生成三语言推文
      const tweets = await this.generateTweets(selectedEvent);
      logger.info({
        krLength: tweets.kr.length,
        zhLength: tweets.zh.length,
        enLength: tweets.en.length,
      }, 'Generated tweets for three languages');

      // 6. 发布到三账户
      const results = await this.publishTweets(selectedEvent, tweets);

      // 7. 记录推送日志
      await this.logPush(selectedEvent, results);

      logger.info({
        eventKey: selectedEvent.event_key,
        results: {
          accountA: results.accountA.status,
          accountB: results.accountB.status,
          accountC: results.accountC.status,
        },
      }, 'Macro US tweet job completed');

    } catch (error) {
      logger.error({ error }, 'Macro US tweet job failed');
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 拉取事件（时间窗口：过去6小时 + 未来24小时）
   */
  private async fetchEvents(): Promise<CoinGlassMacroEvent[]> {
    const now = Date.now();
    // 注意：CoinGlass v4.0 API 需要毫秒级时间戳，不是秒级
    const startTime = now - this.TIME_WINDOW_HOURS.past * 60 * 60 * 1000; // 毫秒级
    const endTime = now + this.TIME_WINDOW_HOURS.future * 60 * 60 * 1000; // 毫秒级

    try {
      const events = await this.coinglass.getMacroEvents({
        start_time: startTime,
        end_time: endTime,
      });

      return events;
    } catch (error) {
      logger.error({ error, startTime, endTime }, 'Failed to fetch macro events');
      return [];
    }
  }

  /**
   * 过滤多国事件（美国、中国、俄罗斯、英国、南美洲等）
   */
  private filterUSAEvents(events: CoinGlassMacroEvent[]): EventDTO[] {
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
    
    const normalized = normalizeEvents(events);
    return normalized.filter(event => {
      const countryCode = event.country_code.toUpperCase();
      return supportedCountryCodes.includes(countryCode);
    });
  }

  /**
   * 去重（排除已推送的 event_key）
   */
  private async deduplicateEvents(events: EventDTO[]): Promise<EventDTO[]> {
    try {
      const stmt = this.db.prepare(`
        SELECT event_key FROM macro_event_push_log
        WHERE event_key IN (${events.map(() => '?').join(',')})
      `);
      const sentKeys = new Set(
        (stmt.all(...events.map(e => e.event_key)) as any[]).map((row: any) => row.event_key)
      );

      return events.filter(event => !sentKeys.has(event.event_key));
    } catch (error) {
      logger.error({ error }, 'Failed to deduplicate events');
      return events; // 出错时返回全部，避免漏推
    }
  }

  /**
   * 选择最佳事件（只选 1 条）
   * 排序优先级：
   * 1. importance_level 高优先（3 > 2 > 1）
   * 2. 距离当前时间最近（abs(publish_time - now) 最小）
   * 3. 优先 RELEASED 再 UPCOMING
   */
  private selectBestEvent(events: EventDTO[]): EventDTO {
    const now = Date.now();

    return events.sort((a, b) => {
      // 1. importance_level 高优先
      if (a.importance_level !== b.importance_level) {
        return b.importance_level - a.importance_level;
      }

      // 2. 距离当前时间最近
      const distA = Math.abs(a.publish_time_utc_ms - now);
      const distB = Math.abs(b.publish_time_utc_ms - now);
      if (distA !== distB) {
        return distA - distB;
      }

      // 3. 优先 RELEASED
      if (a.status !== b.status) {
        return a.status === 'RELEASED' ? -1 : 1;
      }

      return 0;
    })[0];
  }

  /**
   * 生成三语言推文（先生成中文，然后翻译为英文和韩语）
   */
  private async generateTweets(event: EventDTO): Promise<{ kr: string; zh: string; en: string }> {
    // 1. 首先生成中文推文（账户A - 主账户）
    logger.info({ account: ACCOUNT_CONFIG.A.key, language: ACCOUNT_CONFIG.A.language }, 'Generating Chinese tweet (primary)');
    const zhTweet = await this.generateTweetForAccount(event, ACCOUNT_CONFIG.A);
    
    // 2. 将中文推文翻译为英文（账户B）
    logger.info({ account: ACCOUNT_CONFIG.B.key, language: ACCOUNT_CONFIG.B.language }, 'Translating Chinese tweet to English');
    const enTweet = await this.translateTweetInternal(zhTweet, 'zh', 'en');
    
    // 3. 将中文推文翻译为韩语（账户C）
    logger.info({ account: ACCOUNT_CONFIG.C.key, language: ACCOUNT_CONFIG.C.language }, 'Translating Chinese tweet to Korean');
    const koTweet = await this.translateTweetInternal(zhTweet, 'zh', 'ko');

    return { kr: koTweet, zh: zhTweet, en: enTweet };
  }

  /**
   * 为指定账户生成推文（使用强绑定的语言）
   */
  private async generateTweetForAccount(
    event: EventDTO,
    accountConfig: typeof ACCOUNT_CONFIG.A | typeof ACCOUNT_CONFIG.B | typeof ACCOUNT_CONFIG.C
  ): Promise<string> {
    const language = accountConfig.language; // 'ko' | 'zh' | 'en'
    const icon = IMPORTANCE_ICONS[event.importance_level] || 'ℹ️';
    const timeStr = this.formatTime(event.publish_time_utc_ms);
    
    // 构建状态图标（可选，但只允许一个 icon）
    let statusIcon = '';
    if (event.status === 'UPCOMING') {
      const hoursUntil = (event.publish_time_utc_ms - Date.now()) / (60 * 60 * 1000);
      if (hoursUntil <= 2 && hoursUntil > 0) {
        statusIcon = ' ⏱️';
      }
    } else if (event.status === 'RELEASED') {
      statusIcon = ' ✅';
    }

    const systemPrompt = this.buildSystemPrompt(language);
    const userPrompt = this.buildUserPrompt(event, language, icon, timeStr, statusIcon);

    let maxRetries = 2; // 最多重试 1 次（总共 2 次尝试）
    let lastError: any;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.deepseek.analyzeWithPrompt(
          systemPrompt,
          userPrompt,
          { temperature: 0.7, maxTokens: 300 }
        );

        let tweet = response.trim();
        
        // 移除 ST/MT 标签
        tweet = removeSTMTLabels(tweet);
        
        // 确保第一行包含 ICON（如果还没有）
        const lines = tweet.split('\n');
        if (lines.length > 0 && !lines[0].includes(icon)) {
          lines[0] = `${icon}${statusIcon} ${lines[0]}`;
          tweet = lines.join('\n');
        }

        // Icon 去重（只保留第一行开头的）
        tweet = deduplicateIcons(tweet);

        // 裁剪到 200 字符
        tweet = this.truncateTweet(tweet, icon, statusIcon, event.calendar_name, timeStr);

        // 语言校验
        const validation = validateTweetLanguage(tweet, language);
        if (!validation.isValid) {
          logger.warn({
            account: accountConfig.key,
            language,
            attempt,
            reason: validation.reason,
            detectedLanguage: validation.detectedLanguage,
            tweetPreview: tweet.substring(0, 50),
          }, 'Tweet language validation failed, retrying...');

          if (attempt < maxRetries) {
            // 继续重试
            continue;
          } else {
            // 最后一次尝试失败，使用降级模板
            logger.error({
              account: accountConfig.key,
              language,
              reason: validation.reason,
            }, 'Tweet language validation failed after all retries, using fallback');
            return this.buildFallbackTweet(event, language, icon, timeStr, statusIcon);
          }
        }

        // 校验通过
        logger.info({
          account: accountConfig.key,
          language,
          attempt,
          tweetLength: tweet.length,
          detectedLanguage: validation.detectedLanguage,
        }, 'Tweet generated and validated successfully');

        return tweet;
      } catch (error) {
        lastError = error;
        logger.error({ 
          error, 
          account: accountConfig.key,
          language, 
          attempt,
          eventKey: event.event_key 
        }, `Failed to generate tweet (attempt ${attempt}/${maxRetries})`);

        if (attempt < maxRetries) {
          // 继续重试
          continue;
        }
      }
    }

    // 所有尝试都失败，使用降级模板
    logger.error({
      account: accountConfig.key,
      language,
      error: lastError,
    }, 'Failed to generate tweet after all retries, using fallback');
    return this.buildFallbackTweet(event, language, icon, timeStr, statusIcon);
  }

  /**
   * 翻译推文（使用 DeepSeek）
   * @param tweet 原始推文
   * @param fromLang 源语言
   * @param toLang 目标语言
   * @returns 翻译后的推文
   */
  private async translateTweetInternal(tweet: string, fromLang: 'zh' | 'en' | 'ko', toLang: 'zh' | 'en' | 'ko'): Promise<string> {
    const langNames = {
      zh: '中文',
      en: '英文',
      ko: '韩语',
    };
    
    // 目标语言的固定格式翻译（支持多国家）
    const formatTranslations = {
      zh: {
        'Macro': '宏观',
        'Impact': '影响度',
        'UTC': 'UTC',
      },
      en: {
        'Macro': 'Macro',
        'Impact': 'Impact',
        'UTC': 'UTC',
      },
      ko: {
        'Macro': '거시경제',
        'Impact': '영향도',
        'UTC': 'UTC',
      },
    };

    const systemPrompt = `你是一名专业的推文翻译专家。你的任务是将推文从${langNames[fromLang]}翻译为${langNames[toLang]}。

要求：
1. 保持推文的原始结构和格式（4行结构）
2. 保持 Icon 和特殊符号不变（🚨、⚠️、ℹ️、⏱️、✅、⏰）
3. **重要：第一行和第二行的固定格式也需要翻译**：
   - "US Macro" 翻译为：${formatTranslations[toLang]['US Macro']}
   - "Impact" 翻译为：${formatTranslations[toLang]['Impact']}
   - 事件名称（如 "Non-Farm Payrolls"）需要翻译为${langNames[toLang]}
   - 时间格式保持 "YYYY-MM-DD HH:MM UTC" 格式，但 "UTC" 可以翻译为${formatTranslations[toLang]['UTC']}（如果目标语言需要）
4. 翻译要自然流畅，符合${langNames[toLang]}的表达习惯
5. 不要添加或删除任何内容
6. 不要使用 ST/MT 等标签
7. 只输出翻译后的推文，不要添加任何说明`;

    const userPrompt = `请将以下推文从${langNames[fromLang]}翻译为${langNames[toLang]}，包括第一行和第二行的所有内容：

${tweet}`;

    try {
      const response = await this.deepseek.analyzeWithPrompt(
        systemPrompt,
        userPrompt,
        { temperature: 0.3, maxTokens: 300 }
      );

      let translated = response.trim();
      
      // 移除 ST/MT 标签（如果存在）
      translated = removeSTMTLabels(translated);
      
      // Icon 去重
      translated = deduplicateIcons(translated);
      
      // 裁剪到 200 字符（需要从原始推文中提取信息）
      const lines = tweet.split('\n');
      const firstLine = lines[0] || '';
      let icon = 'ℹ️';
      if (firstLine.includes('🚨')) icon = '🚨';
      else if (firstLine.includes('⚠️')) icon = '⚠️';
      else if (firstLine.includes('ℹ️')) icon = 'ℹ️';
      
      const timeMatch = firstLine.match(/⏰\s*([^\n|]+)/);
      const timeStr = timeMatch ? timeMatch[1].trim() : '2026-01-06 12:00 UTC';
      
      // 支持多国家的匹配模式
      const eventMatch = firstLine.match(/(?:US|美国|미국|China|中国|중국|Russia|俄罗斯|러시아|UK|英国|영국|Brazil|巴西|브라질|Argentina|阿根廷|아르헨티나|Mexico|墨西哥|멕시코|Japan|日本|일본|Germany|德国|독일|France|法国|프랑스|Italy|意大利|이탈리아|Canada|加拿大|캐나다|Australia|澳大利亚|호주|India|印度|인도|South Korea|韩国|한국|Eurozone|欧元区|유로존)\s*(?:Macro|宏观|거시경제):\s*([^\n]+)/);
      const eventName = eventMatch ? eventMatch[1].trim() : 'Macro Event';
      
      translated = this.truncateTweet(translated, icon, '', eventName, timeStr);
      
      // 语言校验
      const validation = validateTweetLanguage(translated, toLang);
      if (!validation.isValid) {
        logger.warn({
          fromLang,
          toLang,
          reason: validation.reason,
          detectedLanguage: validation.detectedLanguage,
          tweetPreview: translated.substring(0, 50),
        }, 'Translated tweet language validation failed');
      }

      logger.info({
        fromLang,
        toLang,
        originalLength: tweet.length,
        translatedLength: translated.length,
        isValid: validation.isValid,
      }, 'Tweet translated successfully');

      return translated;
    } catch (error) {
      logger.error({ error, fromLang, toLang }, 'Failed to translate tweet');
      // 翻译失败时，返回原始推文（降级策略）
      return tweet;
    }
  }

  /**
   * 构建系统 Prompt（移除 ST/MT 标签要求）
   */
  private buildSystemPrompt(language: 'ko' | 'zh' | 'en'): string {
    const prompts = {
      ko: `당신은 암호화폐 트레이더를 위한 미국 거시경제 이벤트 분석가입니다. 
짧고 명확한 트윗을 작성하세요. 
- 단기 트레이더 관점: 변동성/리스크/예상 영향에 집중
- 중기 트레이더 관점: 트렌드/시장 구조 변화에 집중
- 매매 신호나 가격 예측 금지
- 최대 200자 제한
- ST/MT 같은 라벨을 사용하지 마세요
- Icon은 첫 줄에만 한 번 사용하세요`,
      zh: `你是一名面向加密货币交易者的美国宏观经济事件分析师。
撰写简短清晰的推文。
- 短期交易者视角：关注波动性/风险/预期影响
- 中期交易者视角：关注趋势/市场结构变化
- 禁止喊单或价格预测
- 最多200字符限制
- 不要使用 ST/MT 等标签
- Icon 只在第一行出现一次`,
      en: `You are a US macroeconomic event analyst for cryptocurrency traders.
Write short and clear tweets.
- Short-term trader perspective: Focus on volatility/risk/expected impact
- Medium-term trader perspective: Focus on trends/market structure changes
- No trading signals or price predictions
- Maximum 200 characters limit
- Do not use ST/MT labels
- Use icon only once at the beginning of the first line`,
    };

    return prompts[language];
  }

  /**
   * 构建用户 Prompt（移除 ST/MT 标签要求）
   */
  private buildUserPrompt(
    event: EventDTO,
    language: 'ko' | 'zh' | 'en',
    icon: string,
    timeStr: string,
    statusIcon: string
  ): string {
    const labels = {
      ko: {
        event: '이벤트',
        time: '시간',
        importance: '중요도',
        status: '상태',
        forecast: '예상값',
        previous: '이전값',
        published: '공개값',
        revised: '수정된 이전값',
        effect: '영향',
        upcoming: '예정',
        released: '공개됨',
      },
      zh: {
        event: '事件',
        time: '时间',
        importance: '重要性',
        status: '状态',
        forecast: '预期值',
        previous: '前值',
        published: '公布值',
        revised: '修正前值',
        effect: '影响',
        upcoming: '预告',
        released: '已公布',
      },
      en: {
        event: 'Event',
        time: 'Time',
        importance: 'Importance',
        status: 'Status',
        forecast: 'Forecast',
        previous: 'Previous',
        published: 'Published',
        revised: 'Revised Previous',
        effect: 'Effect',
        upcoming: 'Upcoming',
        released: 'Released',
      },
    };

    const l = labels[language];

    let prompt = `${l.event}: ${event.calendar_name}\n`;
    prompt += `${l.time}: ${timeStr} UTC\n`;
    prompt += `${l.importance}: ${event.importance_level}/3\n`;
    prompt += `${l.status}: ${event.status === 'UPCOMING' ? l.upcoming : l.released}\n`;

    if (event.forecast_value) {
      prompt += `${l.forecast}: ${event.forecast_value}\n`;
    }
    if (event.previous_value) {
      prompt += `${l.previous}: ${event.previous_value}\n`;
    }
    if (event.published_value) {
      prompt += `${l.published}: ${event.published_value}\n`;
    }
    if (event.revised_previous_value) {
      prompt += `${l.revised}: ${event.revised_previous_value}\n`;
    }
    if (event.data_effect) {
      prompt += `${l.effect}: ${event.data_effect}\n`;
    }

    const reqLabels = {
      ko: {
        requirements: '요구사항',
        line1: 'Line1',
        line2: 'Line2',
        line3: 'Line3',
        line4: 'Line4',
        shortTerm: '단기 트레이더 관점 한 문장 (ST 라벨 없이)',
        mediumTerm: '중기 트레이더 관점 한 문장 (MT 라벨 없이)',
        maxChars: '최대 200자, 초과 시 자동 자르기',
        noLabels: 'ST/MT 같은 라벨을 사용하지 마세요',
        iconOnce: 'Icon은 첫 줄에만 한 번 사용하세요',
      },
      zh: {
        requirements: '要求',
        line1: 'Line1',
        line2: 'Line2',
        line3: 'Line3',
        line4: 'Line4',
        shortTerm: '短期交易者视角一句话（不要 ST 标签）',
        mediumTerm: '中期交易者视角一句话（不要 MT 标签）',
        maxChars: '最多200字符，超过时自动裁剪',
        noLabels: '不要使用 ST/MT 等标签',
        iconOnce: 'Icon 只在第一行出现一次',
      },
      en: {
        requirements: 'Requirements',
        line1: 'Line1',
        line2: 'Line2',
        line3: 'Line3',
        line4: 'Line4',
        shortTerm: 'One sentence from short-term trader perspective (no ST label)',
        mediumTerm: 'One sentence from medium-term trader perspective (no MT label)',
        maxChars: 'Maximum 200 characters, auto-truncate if exceeded',
        noLabels: 'Do not use ST/MT labels',
        iconOnce: 'Use icon only once at the beginning of the first line',
      },
    };

    const req = reqLabels[language];
    
    // 根据语言设置第一行和第二行的格式
    // 获取国家名称（多语言）
    const countryNameZh = this.getCountryName(event.country_code, 'zh');
    const countryNameEn = this.getCountryName(event.country_code, 'en');
    const countryNameKo = this.getCountryName(event.country_code, 'ko');
    
    const line1Formats = {
      zh: `${icon}${statusIcon} ${countryNameZh}宏观: ${event.calendar_name}`,
      en: `${icon}${statusIcon} ${countryNameEn} Macro: ${event.calendar_name}`,
      ko: `${icon}${statusIcon} ${countryNameKo} 거시경제: ${event.calendar_name}`,
    };
    
    const line2Formats = {
      zh: `⏰ ${timeStr} | 影响度 ${event.importance_level}/3`,
      en: `⏰ ${timeStr} | Impact ${event.importance_level}/3`,
      ko: `⏰ ${timeStr} | 영향도 ${event.importance_level}/3`,
    };
    
    prompt += `\n${req.requirements}:\n`;
    prompt += `- ${req.line1}: ${line1Formats[language]}\n`;
    prompt += `- ${req.line2}: ${line2Formats[language]}\n`;
    prompt += `- ${req.line3}: [${req.shortTerm}]\n`;
    prompt += `- ${req.line4}: [${req.mediumTerm}]\n`;
    prompt += `- ${req.noLabels}\n`;
    prompt += `- ${req.iconOnce}\n`;
    prompt += `- ${req.maxChars}\n`;

    return prompt;
  }

  /**
   * 格式化时间
   */
  private formatTime(timestampMs: number): string {
    const date = new Date(timestampMs);
    const year = date.getUTCFullYear();
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes} UTC`;
  }

  /**
   * 裁剪推文到 200 字符
   * 裁剪顺序：先缩短第4行（中周期），再删除第4行；再缩短第3行（短周期，但不得删除）
   * 必须保留：ICON、事件名、时间、第3行（短周期提示）
   */
  private truncateTweet(
    tweet: string,
    icon: string,
    statusIcon: string,
    calendarName: string,
    timeStr: string
  ): string {
    if (tweet.length <= this.MAX_TWEET_LENGTH) {
      return tweet;
    }

    // 提取各部分
    const lines = tweet.split('\n').filter(l => l.trim());
    let line1 = lines[0] || '';
    let line2 = lines[1] || '';
    let line3 = lines[2] || ''; // ST
    let line4 = lines[3] || ''; // MT

    // 确保 line1 包含 icon 和事件名（支持多国家，这里使用通用格式）
    if (!line1.includes(icon)) {
      line1 = `${icon}${statusIcon} Macro: ${calendarName}`;
    }

    // 确保 line2 包含时间
    if (!line2.includes('⏰')) {
      line2 = `⏰ ${timeStr} | Impact`;
    }

    // 构建基础部分（必须保留）
    const base = `${line1}\n${line2}\n${line3}`;
    const baseLength = base.length;

    // 如果基础部分已超过限制，裁剪 line3
    if (baseLength > this.MAX_TWEET_LENGTH - 20) {
      const maxLine3Length = this.MAX_TWEET_LENGTH - line1.length - line2.length - 10;
      if (line3.length > maxLine3Length) {
        line3 = line3.substring(0, maxLine3Length - 3) + '...';
      }
      return `${line1}\n${line2}\n${line3}`;
    }

    // 尝试包含第4行（中周期提示）
    const withLine4 = `${base}\n${line4}`;
    if (withLine4.length <= this.MAX_TWEET_LENGTH) {
      return withLine4;
    }

    // 裁剪第4行
    const maxLine4Length = this.MAX_TWEET_LENGTH - baseLength - 5;
    if (maxLine4Length > 10) {
      line4 = line4.substring(0, maxLine4Length - 3) + '...';
      return `${base}\n${line4}`;
    }

    // 如果第4行太短，删除第4行（但保留第3行）
    return base;
  }

  /**
   * 降级推文（DeepSeek 失败时使用，移除 ST/MT 标签）
   */
  private buildFallbackTweet(
    event: EventDTO,
    language: 'ko' | 'zh' | 'en',
    icon: string,
    timeStr: string,
    statusIcon: string
  ): string {
    // 获取国家名称（多语言）
    const countryNameZh = this.getCountryName(event.country_code, 'zh');
    const countryNameEn = this.getCountryName(event.country_code, 'en');
    const countryNameKo = this.getCountryName(event.country_code, 'ko');
    
    const templates = {
      ko: `${icon}${statusIcon} ${countryNameKo} 거시경제: ${event.calendar_name}\n⏰ ${timeStr} | Impact ${event.importance_level}/3\n중요 이벤트 주시 필요\n시장 변동성 모니터링`,
      zh: `${icon}${statusIcon} ${countryNameZh}宏观: ${event.calendar_name}\n⏰ ${timeStr} | Impact ${event.importance_level}/3\n关注重要事件影响\n监控市场波动`,
      en: `${icon}${statusIcon} ${countryNameEn} Macro: ${event.calendar_name}\n⏰ ${timeStr} | Impact ${event.importance_level}/3\nMonitor event impact\nWatch market volatility`,
    };

    let tweet = templates[language];
    
    // 移除 ST/MT 标签（如果存在）
    tweet = removeSTMTLabels(tweet);
    
    // Icon 去重
    tweet = deduplicateIcons(tweet);

    return this.truncateTweet(
      tweet,
      icon,
      statusIcon,
      event.calendar_name,
      timeStr
    );
  }

  /**
   * 发布推文到三账户
   */
  private async publishTweets(
    event: EventDTO,
    tweets: { kr: string; zh: string; en: string }
  ): Promise<{
    accountA: { status: 'sent' | 'failed'; tweetId?: string; error?: string };
    accountB: { status: 'sent' | 'failed'; tweetId?: string; error?: string };
    accountC: { status: 'sent' | 'failed'; tweetId?: string; error?: string };
  }> {
    const results: {
      accountA: { status: 'sent' | 'failed'; tweetId?: string; error?: string };
      accountB: { status: 'sent' | 'failed'; tweetId?: string; error?: string };
      accountC: { status: 'sent' | 'failed'; tweetId?: string; error?: string };
    } = {
      accountA: { status: 'failed', error: 'Not attempted' },
      accountB: { status: 'failed', error: 'Not attempted' },
      accountC: { status: 'failed', error: 'Not attempted' },
    };

    // 账户 A (ZH - 中文，主账户)
    try {
      const resultA = await RetryUtil.retry(
        async () => {
          return await this.tweetService.sendTweet(tweets.zh, ACCOUNT_CONFIG.A.key);
        },
        { maxAttempts: 2, backoffMs: 2000, maxBackoffMs: 5000 }
      );
      results.accountA = { status: 'sent' as const, tweetId: resultA.tweetId };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      results.accountA = { status: 'failed' as const, error: errorMsg };
      logger.error({ error, account: 'A', language: 'ZH' }, 'Failed to send tweet to account A');
    }

    // 账户 B (EN - 英文，从中文翻译)
    try {
      const resultB = await RetryUtil.retry(
        async () => {
          return await this.tweetService.sendTweet(tweets.en, ACCOUNT_CONFIG.B.key);
        },
        { maxAttempts: 2, backoffMs: 2000, maxBackoffMs: 5000 }
      );
      results.accountB = { status: 'sent' as const, tweetId: resultB.tweetId };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      results.accountB = { status: 'failed' as const, error: errorMsg };
      logger.error({ error, account: 'B', language: 'EN' }, 'Failed to send tweet to account B');
    }

    // 账户 C (KO - 韩语，从中文翻译)
    try {
      const resultC = await RetryUtil.retry(
        async () => {
          return await this.tweetService.sendTweet(tweets.kr, ACCOUNT_CONFIG.C.key);
        },
        { maxAttempts: 2, backoffMs: 2000, maxBackoffMs: 5000 }
      );
      results.accountC = { status: 'sent' as const, tweetId: resultC.tweetId };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      results.accountC = { status: 'failed' as const, error: errorMsg };
      logger.error({ error, account: 'C', language: 'KO' }, 'Failed to send tweet to account C');
    }

    return results;
  }

  /**
   * 查找相关新闻（文章或快讯）
   * 根据事件的关键词和时间范围查找相关新闻
   */
  private async findRelatedNews(event: EventDTO): Promise<{ type: 'article' | 'newsflash'; tweetId: string; url?: string } | null> {
    try {
      const now = Date.now();
      // 查找过去 24 小时内的新闻
      const startTime = now - 24 * 60 * 60 * 1000;
      const endTime = now;

      // 构建搜索关键词（从事件名称中提取）
      const keywords = this.extractKeywords(event.calendar_name);
      
      // 1. 先查找快讯列表
      const newsflashes = await this.coinglass.getNewsflashList({
        start_time: startTime,
        end_time: endTime,
        limit: 50,
      });

      // 查找匹配的快讯
      for (const newsflash of newsflashes) {
        if (this.isNewsRelated(newsflash, keywords, event)) {
          // 如果有 tweetId 或 URL，返回
          if (newsflash.url) {
            // 从 URL 中提取 tweetId（如果包含 Twitter URL）
            const tweetId = this.extractTweetIdFromUrl(newsflash.url);
            if (tweetId) {
              return { type: 'newsflash', tweetId, url: newsflash.url };
            }
          }
        }
      }

      // 2. 查找文章列表
      const articles = await this.coinglass.getArticleList({
        start_time: startTime,
        end_time: endTime,
        limit: 50,
      });

      // 查找匹配的文章
      for (const article of articles) {
        if (this.isNewsRelated(article, keywords, event)) {
          // 如果有 tweetId 或 URL，返回
          if (article.url) {
            const tweetId = this.extractTweetIdFromUrl(article.url);
            if (tweetId) {
              return { type: 'article', tweetId, url: article.url };
            }
          }
        }
      }

      return null;
    } catch (error) {
      logger.warn({ error, eventKey: event.event_key }, 'Failed to find related news');
      return null;
    }
  }

  /**
   * 从事件名称中提取关键词
   */
  private extractKeywords(calendarName: string): string[] {
    // 提取主要关键词（去除常见停用词）
    const stopWords = ['the', 'of', 'and', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'is', 'are', 'was', 'were'];
    const words = calendarName
      .toLowerCase()
      .split(/[\s\-_]+/)
      .filter(word => word.length > 2 && !stopWords.includes(word));
    
    return words.slice(0, 5); // 最多返回 5 个关键词
  }

  /**
   * 判断新闻是否与事件相关
   */
  private isNewsRelated(
    news: { title?: string; content?: string; [key: string]: any },
    keywords: string[],
    event: EventDTO
  ): boolean {
    const text = `${news.title || ''} ${news.content || ''}`.toLowerCase();
    const eventText = `${event.calendar_name} ${event.country_code}`.toLowerCase();
    
    // 检查关键词匹配
    const keywordMatches = keywords.filter(keyword => text.includes(keyword)).length;
    if (keywordMatches >= 2) {
      return true;
    }
    
    // 检查国家代码匹配
    if (text.includes(event.country_code.toLowerCase())) {
      return true;
    }
    
    // 检查事件名称中的主要词汇
    const eventWords = event.calendar_name.toLowerCase().split(/[\s\-_]+/).filter(w => w.length > 3);
    const eventWordMatches = eventWords.filter(word => text.includes(word)).length;
    if (eventWordMatches >= 1 && keywordMatches >= 1) {
      return true;
    }
    
    return false;
  }

  /**
   * 从 URL 中提取 Twitter 推文 ID
   */
  private extractTweetIdFromUrl(url: string): string | null {
    // 匹配 Twitter/X URL 格式
    // https://twitter.com/username/status/1234567890
    // https://x.com/username/status/1234567890
    const match = url.match(/(?:twitter\.com|x\.com)\/[^/]+\/status\/(\d+)/);
    return match ? match[1] : null;
  }

  /**
   * 转发新闻推文到三账户（Quote Tweet）
   */
  private async quoteNewsTweets(
    event: EventDTO,
    news: { type: 'article' | 'newsflash'; tweetId: string; url?: string }
  ): Promise<{
    accountA: { status: 'sent' | 'failed'; tweetId?: string; error?: string };
    accountB: { status: 'sent' | 'failed'; tweetId?: string; error?: string };
    accountC: { status: 'sent' | 'failed'; tweetId?: string; error?: string };
  }> {
    const results: {
      accountA: { status: 'sent' | 'failed'; tweetId?: string; error?: string };
      accountB: { status: 'sent' | 'failed'; tweetId?: string; error?: string };
      accountC: { status: 'sent' | 'failed'; tweetId?: string; error?: string };
    } = {
      accountA: { status: 'failed', error: 'Not attempted' },
      accountB: { status: 'failed', error: 'Not attempted' },
      accountC: { status: 'failed', error: 'Not attempted' },
    };

    // 生成简短的评论（用于转发）
    const commentZh = this.generateQuoteComment(event, 'zh');
    const commentEn = this.generateQuoteComment(event, 'en');
    const commentKo = this.generateQuoteComment(event, 'ko');

    // 账户 A (ZH - 中文)
    try {
      const resultA = await RetryUtil.retry(
        async () => {
          return await this.tweetService.quoteTweet(news.tweetId, commentZh, ACCOUNT_CONFIG.A.key);
        },
        { maxAttempts: 2, backoffMs: 2000, maxBackoffMs: 5000 }
      );
      results.accountA = { status: 'sent' as const, tweetId: resultA.tweetId };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      results.accountA = { status: 'failed' as const, error: errorMsg };
      logger.error({ error, account: 'A', language: 'ZH' }, 'Failed to quote tweet to account A');
    }

    // 账户 B (EN - 英文)
    try {
      const resultB = await RetryUtil.retry(
        async () => {
          return await this.tweetService.quoteTweet(news.tweetId, commentEn, ACCOUNT_CONFIG.B.key);
        },
        { maxAttempts: 2, backoffMs: 2000, maxBackoffMs: 5000 }
      );
      results.accountB = { status: 'sent' as const, tweetId: resultB.tweetId };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      results.accountB = { status: 'failed' as const, error: errorMsg };
      logger.error({ error, account: 'B', language: 'EN' }, 'Failed to quote tweet to account B');
    }

    // 账户 C (KO - 韩语)
    try {
      const resultC = await RetryUtil.retry(
        async () => {
          return await this.tweetService.quoteTweet(news.tweetId, commentKo, ACCOUNT_CONFIG.C.key);
        },
        { maxAttempts: 2, backoffMs: 2000, maxBackoffMs: 5000 }
      );
      results.accountC = { status: 'sent' as const, tweetId: resultC.tweetId };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      results.accountC = { status: 'failed' as const, error: errorMsg };
      logger.error({ error, account: 'C', language: 'KO' }, 'Failed to quote tweet to account C');
    }

    return results;
  }

  /**
   * 生成转发评论（简短）
   */
  private generateQuoteComment(event: EventDTO, language: 'zh' | 'en' | 'ko'): string {
    const timeStr = new Date(event.publish_time_utc_ms).toISOString().replace('T', ' ').substring(0, 16) + ' UTC';
    const countryName = this.getCountryName(event.country_code, language);
    
    const templates = {
      zh: `📊 ${countryName} ${event.calendar_name}\n⏰ ${timeStr}`,
      en: `📊 ${countryName} ${event.calendar_name}\n⏰ ${timeStr}`,
      ko: `📊 ${countryName} ${event.calendar_name}\n⏰ ${timeStr}`,
    };
    
    // 确保不超过 140 字符（为转发保留空间）
    let comment = templates[language];
    if (comment.length > 140) {
      comment = comment.substring(0, 137) + '...';
    }
    
    return comment;
  }

  /**
   * 记录推送日志
   */
  private async logPush(
    event: EventDTO,
    results: {
      accountA: { status: 'sent' | 'failed'; tweetId?: string; error?: string };
      accountB: { status: 'sent' | 'failed'; tweetId?: string; error?: string };
      accountC: { status: 'sent' | 'failed'; tweetId?: string; error?: string };
    }
  ): Promise<void> {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO macro_event_push_log (
          event_key, calendar_name, publish_time_utc_ms, importance_level, status,
          sent_at_utc_ms,
          tw_a_status, tw_b_status, tw_c_status,
          tw_a_tweet_id, tw_b_tweet_id, tw_c_tweet_id,
          last_error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const errors: string[] = [];
      if (results.accountA.status === 'failed') errors.push(`A: ${results.accountA.error}`);
      if (results.accountB.status === 'failed') errors.push(`B: ${results.accountB.error}`);
      if (results.accountC.status === 'failed') errors.push(`C: ${results.accountC.error}`);

      stmt.run(
        event.event_key,
        event.calendar_name,
        event.publish_time_utc_ms,
        event.importance_level,
        event.status,
        Date.now(),
        results.accountA.status,
        results.accountB.status,
        results.accountC.status,
        results.accountA.tweetId || null,
        results.accountB.tweetId || null,
        results.accountC.tweetId || null,
        errors.length > 0 ? errors.join('; ') : null
      );
    } catch (error) {
      logger.error({ error, eventKey: event.event_key }, 'Failed to log push');
    }
  }

  /**
   * 【Lark 专属逻辑】推送财经新闻到 Lark Webhook
   * 使用中文推文内容（完全复用现有文案）
   * @param event 宏观事件
   * @param tweetText 中文推文内容
   */
  private async sendMacroEventToLark(event: EventDTO, tweetText: string): Promise<void> {
    try {
      // 直接使用中文推文内容发送到 Lark
      const success = await this.larkWebhook.sendText(tweetText);
      
      if (success) {
        logger.info({ 
          eventKey: event.event_key, 
          calendarName: event.calendar_name,
          textLength: tweetText.length 
        }, 'Macro event sent to Lark webhook successfully');
      } else {
        logger.warn({ 
          eventKey: event.event_key, 
          calendarName: event.calendar_name 
        }, 'Failed to send macro event to Lark webhook');
      }
    } catch (error) {
      // Lark 推送失败不影响主流程
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error({ 
        error: errorMsg, 
        eventKey: event.event_key 
      }, 'Failed to send macro event to Lark webhook');
    }
  }

  /**
   * 获取国家名称（支持多语言）
   * @param countryCode 国家代码
   * @param language 语言（可选，默认返回中文）
   */
  private getCountryName(countryCode: string, language?: 'zh' | 'en' | 'ko'): string {
    const code = countryCode.toUpperCase();
    
    // 国家代码到名称的映射（多语言）
    const countryMap: Record<string, { zh: string; en: string; ko: string }> = {
      'US': { zh: '美国', en: 'USA', ko: '미국' },
      'USA': { zh: '美国', en: 'USA', ko: '미국' },
      'UNITED_STATES': { zh: '美国', en: 'USA', ko: '미국' },
      'CN': { zh: '中国', en: 'China', ko: '중국' },
      'CHN': { zh: '中国', en: 'China', ko: '중국' },
      'CHINA': { zh: '中国', en: 'China', ko: '중국' },
      'RU': { zh: '俄罗斯', en: 'Russia', ko: '러시아' },
      'RUS': { zh: '俄罗斯', en: 'Russia', ko: '러시아' },
      'RUSSIA': { zh: '俄罗斯', en: 'Russia', ko: '러시아' },
      'GB': { zh: '英国', en: 'UK', ko: '영국' },
      'GBR': { zh: '英国', en: 'UK', ko: '영국' },
      'UK': { zh: '英国', en: 'UK', ko: '영국' },
      'UNITED_KINGDOM': { zh: '英国', en: 'UK', ko: '영국' },
      'BR': { zh: '巴西', en: 'Brazil', ko: '브라질' },
      'BRA': { zh: '巴西', en: 'Brazil', ko: '브라질' },
      'BRAZIL': { zh: '巴西', en: 'Brazil', ko: '브라질' },
      'JP': { zh: '日本', en: 'Japan', ko: '일본' },
      'JPN': { zh: '日本', en: 'Japan', ko: '일본' },
      'JAPAN': { zh: '日本', en: 'Japan', ko: '일본' },
      'DE': { zh: '德国', en: 'Germany', ko: '독일' },
      'DEU': { zh: '德国', en: 'Germany', ko: '독일' },
      'GERMANY': { zh: '德国', en: 'Germany', ko: '독일' },
      'FR': { zh: '法国', en: 'France', ko: '프랑스' },
      'FRA': { zh: '法国', en: 'France', ko: '프랑스' },
      'FRANCE': { zh: '法国', en: 'France', ko: '프랑스' },
      'CA': { zh: '加拿大', en: 'Canada', ko: '캐나다' },
      'CAN': { zh: '加拿大', en: 'Canada', ko: '캐나다' },
      'CANADA': { zh: '加拿大', en: 'Canada', ko: '캐나다' },
      'AU': { zh: '澳大利亚', en: 'Australia', ko: '호주' },
      'AUS': { zh: '澳大利亚', en: 'Australia', ko: '호주' },
      'AUSTRALIA': { zh: '澳大利亚', en: 'Australia', ko: '호주' },
      'KR': { zh: '韩国', en: 'South Korea', ko: '한국' },
      'KOR': { zh: '韩国', en: 'South Korea', ko: '한국' },
      'SOUTH_KOREA': { zh: '韩国', en: 'South Korea', ko: '한국' },
      'EU': { zh: '欧元区', en: 'Eurozone', ko: '유로존' },
      'EUR': { zh: '欧元区', en: 'Eurozone', ko: '유로존' },
      'EUROZONE': { zh: '欧元区', en: 'Eurozone', ko: '유로존' },
    };
    
    const country = countryMap[code];
    if (!country) {
      // 如果找不到映射，返回原始代码
      return code;
    }
    
    // 根据语言返回对应名称，默认返回中文
    if (language === 'en') {
      return country.en;
    } else if (language === 'ko') {
      return country.ko;
    } else {
      return country.zh;
    }
  }
}

