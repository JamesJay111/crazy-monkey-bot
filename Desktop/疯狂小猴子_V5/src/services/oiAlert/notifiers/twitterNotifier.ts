/**
 * TwitterNotifier - Twitter 自动化推送（支持多语言）
 */

import { logger } from '../../../utils/logger';
import { XTweetOAuth1Service } from '../../../services/xTweetOAuth1.service';
import { DeepSeekClient } from '../../../clients/deepseek.client';
import { OIAlertEvent, NotificationResult } from '../types';
import { INotifier } from './base';
import { env } from '../../../config/env';

/**
 * 账户配置（强绑定：账户 -> 语言）
 * 映射关系：
 * - accountA (CrazyMonkeyPerp) -> zh (中文)
 * - accountB (CrazyMonkeyPerpEN) -> en (英文)
 * - accountC (CrazyMonkeyPerpKR) -> ko (韩语)
 */
const ACCOUNT_LANGUAGE_MAP: Record<string, 'zh' | 'en' | 'ko'> = {
  'accountA': 'zh', // CrazyMonkeyPerp -> 中文
  'accountB': 'en', // CrazyMonkeyPerpEN -> 英文
  'accountC': 'ko', // CrazyMonkeyPerpKR -> 韩语
};

export interface TwitterNotifierConfig {
  accountKey?: string; // 账户标识，如 'accountA', 'accountB', 'accountC'
  onlyUpDirection?: boolean; // 是否只推送上升异动
  deepseek?: DeepSeekClient; // DeepSeek 客户端（用于翻译）
}

export class TwitterNotifier implements INotifier {
  private twitterService: XTweetOAuth1Service;
  private deepseek: DeepSeekClient | null;
  private config: TwitterNotifierConfig;
  private targetLanguage: 'zh' | 'en' | 'ko';

  constructor(config: TwitterNotifierConfig = {}) {
    this.twitterService = new XTweetOAuth1Service();
    this.deepseek = config.deepseek || null;
    this.config = {
      accountKey: config.accountKey || 'accountA', // 默认账户A
      onlyUpDirection: config.onlyUpDirection ?? false,
    };
    
    // 根据账户确定目标语言
    this.targetLanguage = ACCOUNT_LANGUAGE_MAP[this.config.accountKey || 'accountA'] || 'zh';
  }

  getName(): string {
    return `Twitter-${this.config.accountKey || 'default'}`;
  }

  /**
   * 发送到 Twitter
   */
  async send(event: OIAlertEvent): Promise<NotificationResult> {
    try {
      // 检查方向过滤
      if (this.config.onlyUpDirection && event.direction !== 'up') {
        return {
          channel: 'twitter',
          success: true, // 视为成功（因为是有意跳过）
          eventId: event.eventId,
        };
      }

      // 生成推文内容（中文模板，包含解读）
      const zhTweetText = await this.formatTweet(event, 'zh');

      // 根据目标语言翻译推文
      let tweetText = zhTweetText;
      if (this.targetLanguage !== 'zh' && this.deepseek) {
        try {
          tweetText = await this.translateTweet(zhTweetText, 'zh', this.targetLanguage);
          logger.debug({
            accountKey: this.config.accountKey,
            targetLanguage: this.targetLanguage,
            originalLength: zhTweetText.length,
            translatedLength: tweetText.length,
          }, 'Tweet translated');
        } catch (error) {
          logger.warn({
            error: error instanceof Error ? error.message : String(error),
            accountKey: this.config.accountKey,
            targetLanguage: this.targetLanguage,
          }, 'Failed to translate tweet, using Chinese version');
          // 翻译失败时使用中文版本
          tweetText = zhTweetText;
        }
      }

      // 发送推文
      const result = await this.twitterService.sendTweet(tweetText, this.config.accountKey);

      logger.info({
        eventId: event.eventId,
        symbol: event.symbol,
        channel: 'twitter',
        tweetId: result.tweetId,
        accountKey: this.config.accountKey,
        language: this.targetLanguage,
      }, 'Twitter notification sent successfully');

      return {
        channel: 'twitter',
        success: true,
        eventId: event.eventId,
        tweetId: result.tweetId,
        url: result.url,
      };
    } catch (error: any) {
      logger.error({
        error: error.message,
        eventId: event.eventId,
        symbol: event.symbol,
        accountKey: this.config.accountKey,
      }, 'Failed to send Twitter notification');

      return {
        channel: 'twitter',
        success: false,
        eventId: event.eventId,
        error: error.message,
      };
    }
  }

  /**
   * 格式化推文内容（中文模板，按照用户要求的格式）
   */
  private async formatTweet(event: OIAlertEvent, language: 'zh' | 'en' | 'ko' = 'zh'): Promise<string> {
    const icon = event.direction === 'up' ? '🟢' : event.direction === 'down' ? '🔴' : '⚪';
    
    // OI 变化
    const oiChangeStr = event.oiChangePct !== null && event.oiChangePct !== undefined
      ? (event.oiChangePct >= 0 ? '+' : '') + event.oiChangePct.toFixed(2)
      : '—';
    
    // 价格变化（4h 或 24h）
    const priceChangeStr = event.priceChangePct !== null && event.priceChangePct !== undefined
      ? (event.priceChangePct >= 0 ? '+' : '') + event.priceChangePct.toFixed(2)
      : '—';
    
    // 24小时价格变化
    const priceChange24hStr = event.priceChange24hPct !== null && event.priceChange24hPct !== undefined
      ? (event.priceChange24hPct >= 0 ? '+' : '') + event.priceChange24hPct.toFixed(2)
      : '—';
    
    // 未平仓合约
    const oiNowM = event.oiUsd !== null && event.oiUsd !== undefined
      ? (event.oiUsd / 1_000_000).toFixed(1)
      : '—';

    // 生成解读（使用 DeepSeek）
    let interpretation = '市场异动，请关注';
    if (this.deepseek) {
      try {
        interpretation = await this.generateInterpretation(event);
      } catch (error) {
        logger.warn({ error, symbol: event.symbol }, 'Failed to generate interpretation, using fallback');
      }
    }

    // 按照用户要求的模板格式（中文）
    const intervalText = event.interval === '4h' ? '4小时' : '24小时';
    let tweet = `${icon} ${event.symbol} ${intervalText}币安未平仓合约变化 ${oiChangeStr}%，价格过去${intervalText}变化 ${priceChangeStr}%，未平仓合约：${oiNowM}M 美元`;
    
    // 只在有数据时显示 24h 价格变化
    if (priceChange24hStr !== '—') {
      tweet += `，24小时价格变化：${priceChange24hStr}%`;
    }
    tweet += '\n\n';
    
    // 解读部分
    tweet += `解读：${interpretation}\n\n`;
    
    // 备注部分
    tweet += `备注：如果是未平仓合约是下降的 icon 是 🔴，上升的是 🟢`;

    // Twitter 字符限制 280，确保不超过
    if (tweet.length > 280) {
      // 截断，保留关键信息
      const truncated = `${icon} ${event.symbol} OI变化 ${oiChangeStr}%，价格变化 ${priceChangeStr}%，OI：${oiNowM}M\n\n`;
      const remainingChars = 280 - truncated.length - 10; // 保留一些空间
      const truncatedInterpretation = interpretation.length > remainingChars 
        ? interpretation.substring(0, remainingChars - 3) + '...'
        : interpretation;
      tweet = `${truncated}解读：${truncatedInterpretation}`;
    }

    return tweet;
  }

  /**
   * 生成 DeepSeek 解读
   */
  private async generateInterpretation(event: OIAlertEvent): Promise<string> {
    if (!this.deepseek) {
      return '市场异动，请关注';
    }

    try {
      const oiChangeStr = event.oiChangePct !== null && event.oiChangePct !== undefined
        ? (event.oiChangePct >= 0 ? '+' : '') + event.oiChangePct.toFixed(2)
        : '—';
      const priceChangeStr = event.priceChangePct !== null && event.priceChangePct !== undefined
        ? (event.priceChangePct >= 0 ? '+' : '') + event.priceChangePct.toFixed(2)
        : '—';
      const priceChange24hStr = event.priceChange24hPct !== null && event.priceChange24hPct !== undefined
        ? (event.priceChange24hPct >= 0 ? '+' : '') + event.priceChange24hPct.toFixed(2)
        : '—';
      const oiUsdStr = event.oiUsd !== null && event.oiUsd !== undefined
        ? (event.oiUsd / 1_000_000).toFixed(1)
        : '—';
      
      const prompt = `币安合约 ${event.symbol} 未平仓合约变化 ${oiChangeStr}%，价格过去${event.interval === '4h' ? '4小时' : '24小时'}变化 ${priceChangeStr}%，未平仓合约：${oiUsdStr}M 美元，24小时价格变化：${priceChange24hStr}%。

请生成一段专业的市场解读（30-50字），分析 OI 变化与价格走势的关系，市场情绪，以及需要关注的风险点。`;

      const response = await this.deepseek.chat([
        { role: 'user', content: prompt }
      ]);

      // DeepSeek.chat() 传入 messages 数组时返回 DeepSeekResponse 对象，需要提取 content
      if (typeof response === 'string') {
        return response || '市场异动，请关注';
      } else if (response && typeof response === 'object' && 'content' in response) {
        return (response as any).content || '市场异动，请关注';
      } else {
        return String(response) || '市场异动，请关注';
      }
    } catch (error) {
      logger.warn({ error, symbol: event.symbol }, 'Failed to generate DeepSeek interpretation, using fallback');
      return '市场异动，请关注';
    }
  }

  /**
   * 使用 DeepSeek 翻译推文
   */
  private async translateTweet(text: string, fromLang: 'zh' | 'en' | 'ko', toLang: 'zh' | 'en' | 'ko'): Promise<string> {
    if (!this.deepseek) {
      throw new Error('DeepSeek client not available for translation');
    }

    if (fromLang === toLang) {
      return text;
    }

    const langNames: Record<string, string> = {
      'zh': '中文',
      'en': '英文',
      'ko': '韩语',
    };

    const prompt = `请将以下推文从${langNames[fromLang]}翻译为${langNames[toLang]}，保持格式、emoji 和数字不变，只翻译文字内容：

${text}

要求：
1. 保持所有 emoji（🟢、🔴、⚪）不变
2. 保持所有数字和百分比不变
3. 保持推文的结构和格式
4. 只翻译文字内容
5. 确保翻译后的推文长度不超过 280 个字符
6. 只返回翻译后的文本，不要返回任何其他内容或 JSON 格式`;

    try {
      const response = await this.deepseek.chat([
        { role: 'user', content: prompt }
      ]);

      // DeepSeek.chat() 传入 messages 数组时返回 DeepSeekResponse 对象，需要提取 content
      let translatedText: string;
      if (typeof response === 'string') {
        translatedText = response;
      } else if (response && typeof response === 'object' && 'content' in response) {
        // 提取 content 字段
        translatedText = (response as any).content || text;
      } else {
        translatedText = String(response);
      }

      return translatedText.trim() || text;
    } catch (error) {
      logger.warn({ error, fromLang, toLang }, 'Failed to translate tweet using DeepSeek');
      throw error;
    }
  }
}

