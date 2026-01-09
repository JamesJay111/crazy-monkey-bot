import axios from 'axios';
import { getTokenManager } from './xTokenManager.service';
import { logger } from '../utils/logger';

/**
 * Twitter 发推服务
 * 封装发推逻辑，自动处理 token 刷新
 */
export class XTweetService {
  private tokenManager = getTokenManager();

  /**
   * 发送推文
   * @param text 推文内容
   * @returns 推文 ID 和 URL
   */
  async sendTweet(text: string): Promise<{ tweetId: string; url: string }> {
    try {
      // 获取有效的 access token（自动刷新）
      const accessToken = await this.tokenManager.getValidAccessToken();
      
      if (!accessToken) {
        throw new Error('No valid access token. Please authorize first.');
      }

      // 发送推文
      const response = await axios.post(
        'https://api.twitter.com/2/tweets',
        {
          text,
        },
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const tweet = response.data.data;
      const url = `https://twitter.com/i/web/status/${tweet.id}`;

      logger.info({
        tweetId: tweet.id,
        textLength: text.length,
        url,
      }, 'Tweet sent successfully');

      return {
        tweetId: tweet.id,
        url,
      };
    } catch (error: any) {
      // 如果是 401，尝试刷新 token 后重试一次
      if (error.response?.status === 401) {
        logger.warn('Token expired, attempting refresh and retry');
        
        // 强制刷新 token
        const tokenManager = getTokenManager();
        const refreshedToken = await tokenManager.getValidAccessToken();
        
        if (!refreshedToken) {
          throw new Error('Failed to refresh token');
        }

        // 重试一次
        try {
          const retryResponse = await axios.post(
            'https://api.twitter.com/2/tweets',
            {
              text,
            },
            {
              headers: {
                'Authorization': `Bearer ${refreshedToken}`,
                'Content-Type': 'application/json',
              },
            }
          );

          const tweet = retryResponse.data.data;
          const url = `https://twitter.com/i/web/status/${tweet.id}`;

          logger.info({
            tweetId: tweet.id,
            textLength: text.length,
            url,
            note: 'Token was automatically refreshed',
          }, 'Tweet sent successfully after token refresh');

          return {
            tweetId: tweet.id,
            url,
          };
        } catch (retryError: any) {
          logger.error({ error: retryError.response?.data || retryError.message }, 'Failed to send tweet after token refresh');
          throw retryError;
        }
      }

      logger.error({ error: error.response?.data || error.message }, 'Failed to send tweet');
      throw error;
    }
  }
}

