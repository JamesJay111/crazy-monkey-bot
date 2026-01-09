/**
 * 宏观新闻 Webhook 实时推送服务
 * 
 * 功能：
 * - 每 10 分钟扫描一次 CoinGlass 新闻（实时推送）
 * - 支持所有新闻类型：经济数据、财经事件、央行动态、新闻文章、快讯
 * - 只要有新增新闻就推送到 Webhook
 * - 分开发送三条消息（中文/英文/韩语各一条）
 * - 调用 DeepSeek 生成解读（关于加密货币宏观市场影响）
 * 
 * 实现文档：docs/MACRO_NEWS_IMPLEMENTATION.md
 * CoinGlass 字段映射：docs/COINGLASS_FIELD_MAPPING.md
 */

import Database from 'better-sqlite3';
import { logger } from '../utils/logger';
import { CoinGlassClient } from '../clients/coinglass.client';
import { DeepSeekClient } from '../clients/deepseek.client';
import axios from 'axios';

type NewsType = 'economic-data' | 'financial-events' | 'central-bank' | 'article' | 'newsflash';

interface NewsItem {
  id: string;
  type: NewsType;
  title: string;
  content?: string;
  publishTime: number;
  url?: string;
  source?: string;
  countryCode?: string;
  countryName?: string;
}

const NEWS_TYPE_LABELS = {
  'economic-data': { zh: '[经济数据]', en: '[Economic Data]', ko: '[경제 데이터]' },
  'financial-events': { zh: '[财经事件]', en: '[Financial Events]', ko: '[금융 이벤트]' },
  'central-bank': { zh: '[央行动态]', en: '[Central Bank]', ko: '[중앙은행]' },
  'article': { zh: '[新闻和快讯]', en: '[News]', ko: '[뉴스]' },
  'newsflash': { zh: '[新闻和快讯]', en: '[News Flash]', ko: '[속보]' },
} as const;

const NEWS_TYPE_ICONS = {
  'economic-data': '📊',
  'financial-events': '💼',
  'central-bank': '🏦',
  'article': '📰',
  'newsflash': '⚡',
} as const;

export class MacroNewsWebhookPushService {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private readonly POLL_INTERVAL_MS = 10 * 60 * 1000; // 10 分钟（实时推送）
  private readonly TIME_WINDOW_MS = 10 * 60 * 1000; // 只获取过去 10 分钟内的新闻
  private readonly WEBHOOK_URL = 'https://open.larksuite.com/open-apis/bot/v2/hook/f182517d-8c87-4a09-adc9-be40730b0506';

  constructor(
    private coinglass: CoinGlassClient,
    private deepseek: DeepSeekClient,
    private db: Database.Database
  ) {
    this.initDatabase();
  }

  private initDatabase(): void {
    try {
      // 使用与 Twitter 推送相同的表，但通过 news_type 区分
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS macro_news_push_log (
          news_id TEXT PRIMARY KEY,
          news_type TEXT NOT NULL,
          title TEXT NOT NULL,
          publish_time_utc_ms INTEGER NOT NULL,
          pushed_at_utc_ms INTEGER NOT NULL,
          account_a_status TEXT CHECK(account_a_status IN ('sent', 'failed', 'skipped')),
          account_b_status TEXT CHECK(account_b_status IN ('sent', 'failed', 'skipped')),
          account_c_status TEXT CHECK(account_c_status IN ('sent', 'failed', 'skipped')),
          account_a_tweet_id TEXT,
          account_b_tweet_id TEXT,
          account_c_tweet_id TEXT,
          last_error TEXT
        )
      `);
      logger.info('Macro news webhook push log table initialized');
    } catch (error) {
      logger.error({ error }, 'Failed to init macro news webhook push log database');
    }
  }

  start(): void {
    if (this.intervalId) {
      logger.warn('Macro news webhook push service is already running');
      return;
    }

    logger.info({
      pollIntervalMs: this.POLL_INTERVAL_MS,
      pollIntervalMinutes: this.POLL_INTERVAL_MS / (60 * 1000),
      webhookUrl: this.WEBHOOK_URL.substring(0, 50) + '...',
    }, 'Starting macro news webhook push service (real-time)');

    this.runScanOnce().catch(error => {
      logger.error({ error }, 'Failed to run initial macro news webhook scan');
    });

    this.intervalId = setInterval(() => {
      this.runScanOnce().catch(error => {
        logger.error({ error }, 'Failed to run scheduled macro news webhook scan');
      });
    }, this.POLL_INTERVAL_MS);

    logger.info('Macro news webhook push service started (real-time, every 10 minutes)');
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('Macro news webhook push service stopped');
    }
  }

  private async runScanOnce(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Macro news webhook scan is already running, skipping');
      return;
    }

    this.isRunning = true;

    try {
      logger.info('Running macro news webhook scan (real-time)...');

      const allNews = await this.fetchAllNews();
      logger.info({ totalNews: allNews.length }, 'Fetched all news from CoinGlass');

      if (allNews.length === 0) {
        logger.info('No news found, skipping');
        return;
      }

      const newNews = await this.deduplicateNews(allNews);
      logger.info({ newNewsCount: newNews.length }, 'Filtered new news');

      if (newNews.length === 0) {
        logger.info('No new news to push');
        return;
      }

      newNews.sort((a, b) => b.publishTime - a.publishTime);

      for (const news of newNews) {
        try {
          await this.pushNews(news);
          await this.sleep(2000);
        } catch (error) {
          logger.error({ error, newsId: news.id, newsType: news.type }, 'Failed to push news to webhook');
        }
      }

      logger.info({ pushedCount: newNews.length }, 'Macro news webhook scan completed');

    } catch (error) {
      logger.error({ error }, 'Macro news webhook scan failed');
    } finally {
      this.isRunning = false;
    }
  }

  private async fetchAllNews(): Promise<NewsItem[]> {
    const now = Date.now();
    const startTime = now - this.TIME_WINDOW_MS;
    const endTime = now;

    const allNews: NewsItem[] = [];

    try {
      // 1. 获取经济数据、财经事件、央行动态
      const economicData = await this.coinglass.getMacroEvents({
        start_time: startTime,
        end_time: endTime,
      });
      
      for (const event of economicData) {
        let type: NewsType = 'economic-data';
        if (event.calendar_name?.toLowerCase().includes('central bank') || 
            event.calendar_name?.toLowerCase().includes('央行')) {
          type = 'central-bank';
        } else if (event.calendar_name?.toLowerCase().includes('financial') ||
                   event.calendar_name?.toLowerCase().includes('财经')) {
          type = 'financial-events';
        }

        allNews.push({
          id: `economic-${event.calendar_name}-${event.publish_timestamp}`,
          type,
          title: event.calendar_name,
          publishTime: event.publish_timestamp,
          countryCode: event.country_code,
          countryName: event.country_name,
        });
      }

      // 2. 获取文章列表
      const articles = await this.coinglass.getArticleList({
        start_time: startTime,
        end_time: endTime,
        limit: 100,
      });

      for (const article of articles) {
        // 支持 API 返回的字段名（article_title, article_release_time）和我们的字段名（title, publish_time）
        // 注意：API 可能没有 article_id，使用 title + release_time 作为唯一标识
        const articleTitle = article.article_title || article.title;
        const articlePublishTime = article.article_release_time || article.publish_time;
        
        if (articleTitle && articlePublishTime) {
          // 使用 title + publish_time 作为唯一 ID（因为 API 可能没有 article_id）
          const articleId = article.article_id || `${articleTitle}-${articlePublishTime}`;
          allNews.push({
            id: `article-${articleId}`,
            type: 'article',
            title: articleTitle,
            content: article.article_content || article.content,
            publishTime: articlePublishTime,
            url: article.url,
            source: article.source_name || article.source,
          });
        } else {
          logger.debug({ article }, 'Article missing required fields (title or publish_time)');
        }
      }

      // 3. 获取快讯列表
      const newsflashes = await this.coinglass.getNewsflashList({
        start_time: startTime,
        end_time: endTime,
        limit: 100,
      });

      for (const newsflash of newsflashes) {
        // 支持 API 返回的字段名（newsflash_title, newsflash_release_time）和我们的字段名（title, publish_time）
        // 注意：API 可能没有 newsflash_id，使用 title + release_time 作为唯一标识
        const newsflashTitle = newsflash.newsflash_title || newsflash.title;
        const newsflashPublishTime = newsflash.newsflash_release_time || newsflash.publish_time;
        
        if (newsflashTitle && newsflashPublishTime) {
          // 使用 title + publish_time 作为唯一 ID（因为 API 可能没有 newsflash_id）
          const newsflashId = newsflash.newsflash_id || `${newsflashTitle}-${newsflashPublishTime}`;
          allNews.push({
            id: `newsflash-${newsflashId}`,
            type: 'newsflash',
            title: newsflashTitle,
            content: newsflash.newsflash_content || newsflash.content,
            publishTime: newsflashPublishTime,
            url: newsflash.url,
            source: newsflash.source_name || newsflash.source,
          });
        } else {
          logger.debug({ newsflash }, 'Newsflash missing required fields (title or publish_time)');
        }
      }

      logger.info({
        economicData: economicData.length,
        articles: articles.length,
        newsflashes: newsflashes.length,
        total: allNews.length,
      }, 'Fetched all news types for webhook push');

    } catch (error) {
      logger.error({ error }, 'Failed to fetch all news for webhook');
    }

    return allNews;
  }

  private async deduplicateNews(news: NewsItem[]): Promise<NewsItem[]> {
    try {
      if (news.length === 0) {
        return [];
      }

      const newsIds = news.map(n => n.id);
      const stmt = this.db.prepare(`
        SELECT news_id FROM macro_news_push_log
        WHERE news_id IN (${newsIds.map(() => '?').join(',')})
      `);
      const sentIds = new Set(
        (stmt.all(...newsIds) as any[]).map((row: any) => row.news_id)
      );

      return news.filter(item => !sentIds.has(item.id));
    } catch (error) {
      logger.error({ error }, 'Failed to deduplicate news');
      return news;
    }
  }

  private async pushNews(news: NewsItem): Promise<void> {
    try {
      logger.info({
        newsId: news.id,
        newsType: news.type,
        title: news.title.substring(0, 50),
      }, 'Pushing news to webhook');

      const tweets = await this.generateTweets(news);
      logger.info({
        zhLength: tweets.zh.length,
        enLength: tweets.en.length,
        koLength: tweets.ko.length,
      }, 'Generated tweets for three languages');

      const results = await this.publishToWebhook(news, tweets);
      await this.logPush(news, results);

      logger.info({
        newsId: news.id,
        results: {
          accountA: results.accountA.status,
          accountB: results.accountB.status,
          accountC: results.accountC.status,
        },
      }, 'News pushed to webhook successfully');

    } catch (error) {
      logger.error({ error, newsId: news.id }, 'Failed to push news to webhook');
      throw error;
    }
  }

  private async generateTweets(news: NewsItem): Promise<{ zh: string; en: string; ko: string }> {
    const zhTweet = await this.generateTweetForAccount(news, 'zh');
    const enTweet = await this.translateTweet(zhTweet, 'zh', 'en');
    const koTweet = await this.translateTweet(zhTweet, 'zh', 'ko');

    return { zh: zhTweet, en: enTweet, ko: koTweet };
  }

  private async generateTweetForAccount(news: NewsItem, language: 'zh' | 'en' | 'ko'): Promise<string> {
    const label = NEWS_TYPE_LABELS[news.type][language];
    const icon = NEWS_TYPE_ICONS[news.type];
    
    const timeStr = new Date(news.publishTime).toISOString().replace('T', ' ').substring(0, 16) + ' UTC';
    
    let baseTweet = `${icon} ${label}\n\n${news.title}`;
    
    if (news.countryName) {
      baseTweet = `${icon} ${label} | ${news.countryName}\n\n${news.title}`;
    }
    
    baseTweet += `\n⏰ ${timeStr}`;
    
    let interpretation = '';
    let background = '';
    try {
      const analysis = await this.generateDeepSeekAnalysis(news, language);
      interpretation = analysis.interpretation;
      background = analysis.background;
    } catch (error) {
      logger.warn({ error, newsId: news.id }, 'Failed to generate DeepSeek analysis, using fallback');
      interpretation = language === 'zh' ? '关注市场动态' : language === 'en' ? 'Monitor market trends' : '시장 동향 모니터링';
      background = '';
    }
    
    if (interpretation) {
      baseTweet += `\n\n💡 ${interpretation}`;
    }
    
    if (background) {
      baseTweet += `\n\n📌 ${background}`;
    }
    
    return baseTweet;
  }

  private async generateDeepSeekAnalysis(news: NewsItem, language: 'zh' | 'en' | 'ko'): Promise<{
    interpretation: string;
    background: string;
  }> {
    const langNames = {
      zh: '中文',
      en: '英文',
      ko: '韩语',
    };

    const systemPrompt = `你是一名专业的加密货币宏观市场分析师。你的任务是根据新闻内容，生成：
1. 一段简短的解读（20-40字），分析该新闻对加密货币宏观市场的影响
2. 一段背景信息补充（30-60字），提供必要的背景上下文

要求：
- 解读要聚焦于对加密货币市场的影响（价格、流动性、情绪等）
- 背景信息要简洁明了，帮助读者理解新闻的重要性
- 使用${langNames[language]}回答
- 不要使用"做多/做空"等交易建议
- 只描述影响，不做价格预测`;

    const userPrompt = `新闻标题：${news.title}
${news.content ? `新闻内容：${news.content.substring(0, 500)}` : ''}
${news.countryName ? `国家/地区：${news.countryName}` : ''}
${news.source ? `来源：${news.source}` : ''}

请生成：
1. 解读：该新闻对加密货币宏观市场的影响（20-40字）
2. 背景：必要的背景信息补充（30-60字）

请用以下格式回答：
解读：[你的解读]
背景：[背景信息]`;

    try {
      const response = await this.deepseek.chat([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ]);

      const content = typeof response === 'string' ? response : (response.content || '');
      
      const interpretationMatch = content.match(/解读[：:]\s*(.+?)(?:\n|背景|$)/);
      const backgroundMatch = content.match(/背景[：:]\s*(.+?)$/);
      
      return {
        interpretation: interpretationMatch ? interpretationMatch[1].trim() : (language === 'zh' ? '关注市场动态' : language === 'en' ? 'Monitor market trends' : '시장 동향 모니터링'),
        background: backgroundMatch ? backgroundMatch[1].trim() : '',
      };
    } catch (error) {
      logger.error({ error, newsId: news.id }, 'Failed to generate DeepSeek analysis');
      return {
        interpretation: language === 'zh' ? '关注市场动态' : language === 'en' ? 'Monitor market trends' : '시장 동향 모니터링',
        background: '',
      };
    }
  }

  private async translateTweet(tweet: string, fromLang: 'zh' | 'en' | 'ko', toLang: 'zh' | 'en' | 'ko'): Promise<string> {
    if (fromLang === toLang) {
      return tweet;
    }

    const langNames = {
      zh: '中文',
      en: '英文',
      ko: '韩语',
    };

    try {
      const response = await this.deepseek.chat([
        {
          role: 'system',
          content: `你是一名专业的推文翻译专家。你的任务是将推文从${langNames[fromLang]}翻译为${langNames[toLang]}。

要求：
- 保持推文的格式和结构
- 保留所有 Icon 和标签
- 保持专业术语的准确性
- 确保翻译自然流畅`,
        },
        {
          role: 'user',
          content: `请将以下推文翻译为${langNames[toLang]}：\n\n${tweet}`,
        },
      ]);

      return typeof response === 'string' ? response : (response.content || tweet);
    } catch (error) {
      logger.warn({ error, fromLang, toLang }, 'Failed to translate tweet, using original');
      return tweet;
    }
  }

  private async publishToWebhook(
    news: NewsItem,
    tweets: { zh: string; en: string; ko: string }
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

    // 分开发送三条消息：中文、英文、韩语各一条
    try {
      // 发送中文版本
      const zhMessage = `🇨🇳 中文版本\n\n${tweets.zh}`;
      const zhSuccess = await this.sendToWebhook(zhMessage);
      if (zhSuccess) {
        results.accountA = { status: 'sent' as const };
        logger.info({ newsId: news.id, language: 'zh' }, 'Successfully sent Chinese news to webhook');
      } else {
        results.accountA = { status: 'failed' as const, error: 'Webhook send failed' };
      }
      await this.sleep(1000);

      // 发送英文版本
      const enMessage = `🇺🇸 英文版本\n\n${tweets.en}`;
      const enSuccess = await this.sendToWebhook(enMessage);
      if (enSuccess) {
        results.accountB = { status: 'sent' as const };
        logger.info({ newsId: news.id, language: 'en' }, 'Successfully sent English news to webhook');
      } else {
        results.accountB = { status: 'failed' as const, error: 'Webhook send failed' };
      }
      await this.sleep(1000);

      // 发送韩语版本
      const koMessage = `🇰🇷 韩语版本\n\n${tweets.ko}`;
      const koSuccess = await this.sendToWebhook(koMessage);
      if (koSuccess) {
        results.accountC = { status: 'sent' as const };
        logger.info({ newsId: news.id, language: 'ko' }, 'Successfully sent Korean news to webhook');
      } else {
        results.accountC = { status: 'failed' as const, error: 'Webhook send failed' };
      }

      logger.info({
        newsId: news.id,
        results: {
          accountA: results.accountA.status,
          accountB: results.accountB.status,
          accountC: results.accountC.status,
        },
      }, 'All news messages sent to webhook');

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      results.accountA = { status: 'failed' as const, error: errorMsg };
      results.accountB = { status: 'failed' as const, error: errorMsg };
      results.accountC = { status: 'failed' as const, error: errorMsg };
      logger.error({ error, newsId: news.id }, 'Failed to send news to webhook');
    }

    return results;
  }

  private async sendToWebhook(text: string): Promise<boolean> {
    try {
      const payload = {
        msg_type: 'text',
        content: {
          text: text,
        },
      };

      const response = await axios.post(this.WEBHOOK_URL, payload, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      });

      if (response.status === 200) {
        logger.info({ textLength: text.length }, 'Webhook message sent successfully');
        return true;
      } else {
        logger.warn({ status: response.status, statusText: response.statusText }, 'Webhook returned non-200 status');
        return false;
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMsg }, 'Failed to send message to webhook');
      return false;
    }
  }

  private async logPush(
    news: NewsItem,
    results: {
      accountA: { status: 'sent' | 'failed'; tweetId?: string; error?: string };
      accountB: { status: 'sent' | 'failed'; tweetId?: string; error?: string };
      accountC: { status: 'sent' | 'failed'; tweetId?: string; error?: string };
    }
  ): Promise<void> {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO macro_news_push_log (
          news_id, news_type, title, publish_time_utc_ms, pushed_at_utc_ms,
          account_a_status, account_b_status, account_c_status,
          account_a_tweet_id, account_b_tweet_id, account_c_tweet_id,
          last_error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const errors: string[] = [];
      if (results.accountA.status === 'failed') errors.push(`A: ${results.accountA.error}`);
      if (results.accountB.status === 'failed') errors.push(`B: ${results.accountB.error}`);
      if (results.accountC.status === 'failed') errors.push(`C: ${results.accountC.error}`);

      stmt.run(
        news.id,
        news.type,
        news.title,
        news.publishTime,
        Date.now(),
        results.accountA.status,
        results.accountB.status,
        results.accountC.status,
        null, // Webhook 没有 tweet_id
        null,
        null,
        errors.length > 0 ? errors.join('; ') : null
      );
    } catch (error) {
      logger.error({ error, newsId: news.id }, 'Failed to log webhook push');
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
