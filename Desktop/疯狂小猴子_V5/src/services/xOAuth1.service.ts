import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { xConfig } from '../config/x';
import { logger } from '../utils/logger';

/**
 * OAuth 1.0a Token 存储结构
 */
export interface XOAuth1TokenStore {
  accessToken: string;
  accessTokenSecret: string;
  userId?: string;
  screenName?: string;
  obtainedAt: number;
}

/**
 * OAuth 1.0a 签名生成
 */
function generateOAuthSignature(
  method: string,
  url: string,
  params: Record<string, string>,
  consumerSecret: string,
  tokenSecret: string = ''
): string {
  // 1. 参数排序
  const sortedParams = Object.keys(params)
    .sort()
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');

  // 2. 构建签名基础字符串
  const signatureBaseString = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(sortedParams),
  ].join('&');

  // 3. 构建签名密钥
  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;

  // 4. HMAC-SHA1 签名
  const signature = crypto
    .createHmac('sha1', signingKey)
    .update(signatureBaseString)
    .digest('base64');

  return signature;
}

/**
 * 生成 OAuth 1.0a 授权头
 */
function generateOAuthHeader(
  method: string,
  url: string,
  params: Record<string, string>,
  consumerKey: string,
  consumerSecret: string,
  token?: string,
  tokenSecret?: string
): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_version: '1.0',
  };

  if (token) {
    oauthParams.oauth_token = token;
  }

  // 合并所有参数用于签名
  const allParams = { ...oauthParams, ...params };
  
  // 生成签名
  const signature = generateOAuthSignature(
    method,
    url,
    allParams,
    consumerSecret,
    tokenSecret || ''
  );

  oauthParams.oauth_signature = signature;

  // 构建 Authorization 头
  const authParams = Object.keys(oauthParams)
    .sort()
    .map(key => `${encodeURIComponent(key)}="${encodeURIComponent(oauthParams[key])}"`)
    .join(', ');

  return `OAuth ${authParams}`;
}

/**
 * 读取 OAuth 1.0a Token Store（支持多账户）
 * @param accountKey 账户标识（如 'accountB', 'accountC'），如果未指定则使用默认路径
 */
export function readOAuth1TokenStore(accountKey?: string): XOAuth1TokenStore | null {
  try {
    let storePath: string;
    
    if (accountKey && accountKey !== 'accountA' && accountKey !== 'default') {
      // 多账户模式：从指定账户文件读取（accountB, accountC 等）
      storePath = path.resolve(`./data/x_oauth1_tokens_${accountKey}.json`);
    } else {
      // 默认模式：使用配置的路径（账户 A 或未指定时）
      storePath = path.resolve(xConfig.X_OAUTH1_TOKEN_STORE);
    }
    
    // 确保目录存在
    const dir = path.dirname(storePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    if (!fs.existsSync(storePath)) {
      return null;
    }
    
    const content = fs.readFileSync(storePath, 'utf-8');
    const store = JSON.parse(content) as XOAuth1TokenStore;
    
    return store;
  } catch (error) {
    logger.warn({ error, accountKey }, 'Failed to read OAuth 1.0a token store');
    return null;
  }
}

/**
 * 保存 OAuth 1.0a Token Store
 */
export function saveOAuth1TokenStore(store: XOAuth1TokenStore): void {
  try {
    const storePath = path.resolve(xConfig.X_OAUTH1_TOKEN_STORE);
    
    // 确保目录存在
    const dir = path.dirname(storePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf-8');
    logger.info({ storePath }, 'OAuth 1.0a token store saved');
  } catch (error) {
    logger.error({ error }, 'Failed to save OAuth 1.0a token store');
    throw error;
  }
}

/**
 * 获取 Request Token
 */
export async function getRequestToken(): Promise<{
  oauthToken: string;
  oauthTokenSecret: string;
  oauthCallbackConfirmed: string;
}> {
  const url = 'https://api.twitter.com/oauth/request_token';
  // 使用 'oob' (out-of-band) 模式，不需要配置 Callback URL
  const callbackUrl = 'oob';

  const params: Record<string, string> = {
    oauth_callback: callbackUrl,
  };

  const authHeader = generateOAuthHeader(
    'POST',
    url,
    params,
    xConfig.X_CONSUMER_KEY,
    xConfig.X_CONSUMER_SECRET
  );

  try {
    // OAuth 1.0a request_token 需要将 callback 作为 body 参数发送
    const bodyParams = new URLSearchParams({
      oauth_callback: callbackUrl,
    });

    const response = await axios.post(
      url,
      bodyParams.toString(),
      {
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    // 解析响应（格式：oauth_token=xxx&oauth_token_secret=yyy&oauth_callback_confirmed=true）
    const responseData = response.data;
    const tokenData: Record<string, string> = {};
    responseData.split('&').forEach((pair: string) => {
      const [key, value] = pair.split('=');
      tokenData[key] = decodeURIComponent(value);
    });

    return {
      oauthToken: tokenData.oauth_token,
      oauthTokenSecret: tokenData.oauth_token_secret,
      oauthCallbackConfirmed: tokenData.oauth_callback_confirmed,
    };
  } catch (error: any) {
    logger.error({ 
      error: error.response?.data || error.message,
      status: error.response?.status,
    }, 'Failed to get request token');
    throw error;
  }
}

/**
 * 生成授权 URL
 */
export function buildOAuth1AuthorizeUrl(oauthToken: string): string {
  return `https://api.twitter.com/oauth/authorize?oauth_token=${oauthToken}`;
}

/**
 * 交换 Access Token
 */
export async function exchangeOAuth1AccessToken(
  oauthToken: string,
  oauthTokenSecret: string,
  oauthVerifier: string
): Promise<XOAuth1TokenStore> {
  const url = 'https://api.twitter.com/oauth/access_token';

  const params: Record<string, string> = {
    oauth_verifier: oauthVerifier,
  };

  const authHeader = generateOAuthHeader(
    'POST',
    url,
    params,
    xConfig.X_CONSUMER_KEY,
    xConfig.X_CONSUMER_SECRET,
    oauthToken,
    oauthTokenSecret
  );

  try {
    // OAuth 1.0a access_token 需要将 verifier 作为 body 参数发送
    const bodyParams = new URLSearchParams({
      oauth_verifier: oauthVerifier,
    });

    const response = await axios.post(
      url,
      bodyParams.toString(),
      {
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      }
    );

    // 解析响应（格式：oauth_token=xxx&oauth_token_secret=yyy&user_id=123&screen_name=username）
    const responseData = response.data;
    const tokenData: Record<string, string> = {};
    responseData.split('&').forEach((pair: string) => {
      const [key, value] = pair.split('=');
      tokenData[key] = decodeURIComponent(value);
    });

    const store: XOAuth1TokenStore = {
      accessToken: tokenData.oauth_token,
      accessTokenSecret: tokenData.oauth_token_secret,
      userId: tokenData.user_id,
      screenName: tokenData.screen_name,
      obtainedAt: Date.now(),
    };

    logger.info({
      userId: store.userId,
      screenName: store.screenName,
    }, 'OAuth 1.0a access token obtained');

    return store;
  } catch (error: any) {
    logger.error({ 
      error: error.response?.data || error.message,
      status: error.response?.status,
    }, 'Failed to exchange OAuth 1.0a access token');
    throw error;
  }
}

/**
 * 生成 OAuth 1.0a 签名请求头（用于 API 调用，支持多账户）
 * @param method HTTP 方法
 * @param url 请求 URL
 * @param params 请求参数
 * @param accountKey 账户标识（可选，如 'accountB', 'accountC'）
 */
export function generateOAuth1AuthHeader(
  method: string,
  url: string,
  params: Record<string, string> = {},
  accountKey?: string
): string {
  const store = readOAuth1TokenStore(accountKey);
  if (!store) {
    const accountInfo = accountKey ? ` for account ${accountKey}` : '';
    throw new Error(`No OAuth 1.0a token found${accountInfo}. Please authorize first.`);
  }

  return generateOAuthHeader(
    method,
    url,
    params,
    xConfig.X_CONSUMER_KEY,
    xConfig.X_CONSUMER_SECRET,
    store.accessToken,
    store.accessTokenSecret
  );
}

/**
 * 检查是否有有效的 OAuth 1.0a Token（支持多账户）
 * @param accountKey 账户标识（可选）
 */
export function hasValidOAuth1Token(accountKey?: string): boolean {
  const store = readOAuth1TokenStore(accountKey);
  return !!store && !!store.accessToken && !!store.accessTokenSecret;
}

