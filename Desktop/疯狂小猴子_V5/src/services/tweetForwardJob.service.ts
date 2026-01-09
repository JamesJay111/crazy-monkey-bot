import axios from 'axios';
import { logger } from '../utils/logger';
import { env } from '../config/env';
import { TweetTranslationService } from './tweetTranslation.service';
import { XTweetOAuth1Service } from './xTweetOAuth1.service';
import { TweetForwardStateService } from './tweetForwardState.service';
import { generateOAuth1AuthHeader, readOAuth1TokenStore } from './xOAuth1.service';
import { xConfig } from '../config/x';
import { smartTruncate } from '../utils/textTruncate';

/**
 * Twitter API 推文响应
 */
interface TwitterTweet {
  id: string;
  text: string;
  created_at: string;
}

interface TwitterTimelineResponse {
  data?: TwitterTweet[];
  meta?: {
    result_count: number;
    newest_id?: string;
    oldest_id?: string;
  };
}

/**
 * 推文转发 Job 服务
 * ⚠️ 已废弃：不再从 Twitter API 读取推文
 * 现在使用后端生成 → 缓存 → 多账户直接发布的流程
 * 此服务保留用于向后兼容，但不再启动
 * 
 * @deprecated 使用 xAutoTweetJob 的多账户发布功能替代
 */
export class TweetForwardJobService {
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning = false;
  private translationService: TweetTranslationService;
  private tweetService: XTweetOAuth1Service;
  private stateService: TweetForwardStateService;

  constructor() {
    this.translationService = new TweetTranslationService();
    this.tweetService = new XTweetOAuth1Service();
    this.stateService = new TweetForwardStateService();
  }

  /**
   * 启动转发 Job
   * ⚠️ 已废弃：不再从 Twitter API 读取推文
   * 现在使用后端生成 → 缓存 → 多账户直接发布的流程
   */
  start(): void {
    logger.warn('TweetForwardJobService is deprecated. Multi-account publishing is now handled by XAutoTweetJobService.');
    logger.warn('This service will not start. Please use the new publish cache system instead.');
    // 不再启动，直接返回
    return;
  }

  /**
   * 停止转发 Job
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info('Tweet forward job stopped');
    }
  }

  /**
   * 执行一次转发任务
   */
  private async runForwardJobOnce(): Promise<void> {
    if (this.isRunning) {
      logger.warn('Forward job is already running, skipping');
      return;
    }

    this.isRunning = true;

    try {
      logger.debug('Running forward job...');

      // 1. 获取账户A的最新推文
      const latestTweet = await this.fetchLatestTweet(env.FORWARD_FROM_ACCOUNT_A_HANDLE!);
      
      if (!latestTweet) {
        logger.debug('No tweet found from account A');
        return;
      }

      // 2. 检查是否已处理（如果已转发到B和C，则跳过）
      const state = this.stateService.readState();
      const processed = state.processed[latestTweet.id];
      if (processed && processed.b && processed.c) {
        logger.debug({ tweetId: latestTweet.id }, 'Tweet already forwarded to both accounts, skipping');
        // 更新 lastSeenTweetId（即使已处理，也要更新，避免重复检查）
        this.stateService.updateLastSeenTweetId(latestTweet.id);
        return;
      }

      // 如果只转发到其中一个账户，继续处理未转发的账户

      logger.info({
        tweetId: latestTweet.id,
        textLength: latestTweet.text.length,
        textPreview: latestTweet.text.substring(0, 50) + '...',
      }, 'Found new tweet from account A, starting translation and forwarding');

      // 3. 翻译并转发（失败隔离，只转发未转发的账户）
      const promises: Promise<{ tweetId: string; url: string }>[] = [];
      
      if (!processed?.b) {
        promises.push(this.translateAndForward(latestTweet, 'b', env.FORWARD_TO_ACCOUNT_B_KEY));
      } else {
        logger.debug({ tweetId: latestTweet.id }, 'Tweet already forwarded to account B, skipping');
      }
      
      if (!processed?.c) {
        promises.push(this.translateAndForward(latestTweet, 'c', env.FORWARD_TO_ACCOUNT_C_KEY));
      } else {
        logger.debug({ tweetId: latestTweet.id }, 'Tweet already forwarded to account C, skipping');
      }

      if (promises.length === 0) {
        logger.debug({ tweetId: latestTweet.id }, 'All accounts already forwarded, skipping');
        this.stateService.updateLastSeenTweetId(latestTweet.id);
        return;
      }

      const results = await Promise.allSettled(promises);

      // 4. 记录结果（根据实际执行的账户）
      let resultIndex = 0;
      
      if (!processed?.b) {
        const resultB = results[resultIndex++];
        if (resultB.status === 'fulfilled') {
          this.stateService.markForwarded(
            latestTweet.id,
            'b',
            resultB.value.tweetId,
            resultB.value.url
          );
          logger.info({
            tweetId: latestTweet.id,
            account: 'B',
            forwardedTweetId: resultB.value.tweetId,
          }, 'Tweet forwarded to account B');
        } else {
          logger.error({
            tweetId: latestTweet.id,
            account: 'B',
            error: resultB.reason,
          }, 'Failed to forward tweet to account B');
        }
      }

      if (!processed?.c) {
        const resultC = results[resultIndex++];
        if (resultC.status === 'fulfilled') {
          this.stateService.markForwarded(
            latestTweet.id,
            'c',
            resultC.value.tweetId,
            resultC.value.url
          );
          logger.info({
            tweetId: latestTweet.id,
            account: 'C',
            forwardedTweetId: resultC.value.tweetId,
          }, 'Tweet forwarded to account C');
        } else {
          logger.error({
            tweetId: latestTweet.id,
            account: 'C',
            error: resultC.reason,
          }, 'Failed to forward tweet to account C');
        }
      }

      // 5. 更新最后看到的推文 ID
      this.stateService.updateLastSeenTweetId(latestTweet.id);

    } catch (error) {
      logger.error({ error }, 'Error in forward job');
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * 获取账户A的最新推文
   * 使用 Twitter API v2 的 user timeline 端点
   */
  private async fetchLatestTweet(username: string): Promise<TwitterTweet | null> {
    try {
      // 首先获取用户 ID
      const userId = await this.getUserIdByUsername(username);
      if (!userId) {
        logger.warn({ username }, 'User not found');
        return null;
      }

      // 使用账户A的 token（默认 token）来获取推文
      // 使用 Twitter API v2 的 user timeline 端点
      const url = `https://api.twitter.com/2/users/${userId}/tweets`;
      
      // 构建查询参数
      const params: Record<string, string> = {
        max_results: '5', // 获取最近 5 条
        'tweet.fields': 'created_at,text',
        exclude: 'retweets,replies', // 排除转推和回复，只获取原创推文
      };

      // 使用默认 token（账户A）
      const authHeader = generateOAuth1AuthHeader('GET', url, params);

      const response = await axios.get<TwitterTimelineResponse>(url, {
        params,
        headers: {
          'Authorization': authHeader,
        },
      });

      const tweets = response.data.data || [];
      if (tweets.length === 0) {
        return null;
      }

      // 返回最新的推文
      return tweets[0];
    } catch (error: any) {
      logger.error({
        error: error.response?.data || error.message,
        status: error.response?.status,
        username,
      }, 'Failed to fetch latest tweet');
      throw error;
    }
  }

  /**
   * 根据用户名获取用户 ID
   */
  private async getUserIdByUsername(username: string): Promise<string | null> {
    try {
      const url = `https://api.twitter.com/2/users/by/username/${username}`;
      const params: Record<string, string> = {
        'user.fields': 'id',
      };

      const authHeader = generateOAuth1AuthHeader('GET', url, params);

      const response = await axios.get<{ data?: { id: string } }>(url, {
        params,
        headers: {
          'Authorization': authHeader,
        },
      });

      return response.data.data?.id || null;
    } catch (error: any) {
      logger.error({
        error: error.response?.data || error.message,
        status: error.response?.status,
        username,
      }, 'Failed to get user ID by username');
      return null;
    }
  }

  /**
   * 翻译并转发到指定账户
   */
  private async translateAndForward(
    tweet: TwitterTweet,
    accountKey: 'b' | 'c',
    accountTokenKey: string
  ): Promise<{ tweetId: string; url: string }> {
    // 1. 检查是否已转发到该账户
    if (this.stateService.isForwardedTo(tweet.id, accountKey)) {
      const existing = this.stateService.readState().processed[tweet.id]?.[accountKey];
      if (existing) {
        logger.debug({
          tweetId: tweet.id,
          account: accountKey,
          existingTweetId: existing.tweetId,
        }, 'Tweet already forwarded to this account');
        return {
          tweetId: existing.tweetId,
          url: existing.url,
        };
      }
    }

    // 2. 翻译
    const targetLang = accountKey === 'b' ? 'en' : 'ko';
    logger.debug({ tweetId: tweet.id, targetLang }, 'Translating tweet');
    
    const translated = await this.translationService.translateWithDeepSeek(
      tweet.text,
      targetLang
    );

    // 3. 智能截断（Twitter 限制 280 字符）
    const finalText = smartTruncate(translated, 280);

    // 4. 发送推文
    logger.debug({
      tweetId: tweet.id,
      account: accountKey,
      textLength: finalText.length,
    }, 'Sending translated tweet');

    const result = await this.tweetService.sendTweet(finalText, accountTokenKey);

    return result;
  }
}

