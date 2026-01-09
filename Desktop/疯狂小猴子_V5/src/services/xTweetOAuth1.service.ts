import axios from 'axios';
import { logger } from '../utils/logger';
import { generateOAuth1AuthHeader, hasValidOAuth1Token } from './xOAuth1.service';

/**
 * Twitter 发推服务（使用 OAuth 1.0a，支持多账户）
 */
export class XTweetOAuth1Service {
  /**
   * 发送推文（使用 OAuth 1.0a）
   * @param text 推文内容
   * @param accountKey 账户标识（可选，如 'accountB', 'accountC'），默认使用账户A
   * @returns 推文 ID 和 URL
   */
  async sendTweet(text: string, accountKey?: string): Promise<{ tweetId: string; url: string }> {
    if (!hasValidOAuth1Token(accountKey)) {
      const accountInfo = accountKey ? ` for account ${accountKey}` : '';
      throw new Error(`No valid OAuth 1.0a token${accountInfo}. Please authorize first.`);
    }

    const url = 'https://api.twitter.com/2/tweets';
    
    // 对于 POST 请求，需要将 body 参数也包含在签名中
    // 但 Twitter API v2 使用 JSON body，所以这里不需要额外参数
    const params: Record<string, string> = {};

    // 生成 OAuth 1.0a 签名头（支持多账户）
    const authHeader = generateOAuth1AuthHeader('POST', url, params, accountKey);

    try {
      const response = await axios.post(
        url,
        {
          text,
        },
        {
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
          },
        }
      );

      const tweet = response.data.data;
      const tweetUrl = `https://twitter.com/i/web/status/${tweet.id}`;

      logger.info({
        tweetId: tweet.id,
        textLength: text.length,
        url: tweetUrl,
        accountKey: accountKey || 'default',
      }, 'Tweet sent successfully (OAuth 1.0a)');

      return {
        tweetId: tweet.id,
        url: tweetUrl,
      };
    } catch (error: any) {
      logger.error({ 
        error: error.response?.data || error.message,
        status: error.response?.status,
      }, 'Failed to send tweet (OAuth 1.0a)');
      throw new Error(`Failed to send tweet: ${error.response?.data?.detail || error.message}`);
    }
  }

  /**
   * 转发推文（Quote Tweet）
   * @param tweetId 要转发的推文 ID
   * @param text 转发时添加的评论内容（可选）
   * @param accountKey 账户标识（可选，如 'accountB', 'accountC'），默认使用账户A
   * @returns 转发推文 ID 和 URL
   */
  async quoteTweet(tweetId: string, text?: string, accountKey?: string): Promise<{ tweetId: string; url: string }> {
    if (!hasValidOAuth1Token(accountKey)) {
      const accountInfo = accountKey ? ` for account ${accountKey}` : '';
      throw new Error(`No valid OAuth 1.0a token${accountInfo}. Please authorize first.`);
    }

    const url = 'https://api.twitter.com/2/tweets';
    
    // 构建请求体
    const body: any = {
      quote_tweet_id: tweetId,
    };
    
    // 如果有评论内容，添加到 body
    if (text) {
      body.text = text;
    }

    // 生成 OAuth 1.0a 签名头（支持多账户）
    const params: Record<string, string> = {};
    const authHeader = generateOAuth1AuthHeader('POST', url, params, accountKey);

    try {
      const response = await axios.post(
        url,
        body,
        {
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json',
          },
        }
      );

      const tweet = response.data.data;
      const tweetUrl = `https://twitter.com/i/web/status/${tweet.id}`;

      logger.info({
        quoteTweetId: tweet.id,
        originalTweetId: tweetId,
        textLength: text?.length || 0,
        url: tweetUrl,
        accountKey: accountKey || 'default',
      }, 'Quote tweet sent successfully (OAuth 1.0a)');

      return {
        tweetId: tweet.id,
        url: tweetUrl,
      };
    } catch (error: any) {
      logger.error({ 
        error: error.response?.data || error.message,
        status: error.response?.status,
        originalTweetId: tweetId,
      }, 'Failed to send quote tweet (OAuth 1.0a)');
      throw new Error(`Failed to send quote tweet: ${error.response?.data?.detail || error.message}`);
    }
  }
}

