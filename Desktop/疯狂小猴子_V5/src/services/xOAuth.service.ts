import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { xConfig, xScopes } from '../config/x';
import { logger } from '../utils/logger';

/**
 * PKCE Code Verifier 和 Challenge 生成
 */
export function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  // 生成 43-128 字符的随机字符串（Base64URL 安全）
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  
  // 生成 code_challenge = base64url(sha256(code_verifier))
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  
  return { codeVerifier, codeChallenge };
}

/**
 * 生成随机 state
 */
export function generateState(): string {
  return crypto.randomBytes(16).toString('base64url');
}

/**
 * 生成授权 URL
 */
export function buildAuthorizeUrl(state: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: xConfig.X_CLIENT_ID,
    redirect_uri: xConfig.X_REDIRECT_URI,
    scope: xScopes.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  
  return `https://twitter.com/i/oauth2/authorize?${params.toString()}`;
}

/**
 * Token 存储结构
 */
export interface XTokenStore {
  accountLabel?: string; // 未来可扩展多账号
  access_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
  scope: string;
  obtainedAt: number; // 获取时间戳（毫秒）
  expiresAt: number; // 过期时间戳（毫秒）
}

/**
 * 读取 Token Store
 */
export function readTokenStore(): XTokenStore | null {
  try {
    const storePath = path.resolve(xConfig.X_TOKEN_STORE);
    
    // 确保目录存在
    const dir = path.dirname(storePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    if (!fs.existsSync(storePath)) {
      return null;
    }
    
    const content = fs.readFileSync(storePath, 'utf-8');
    const store = JSON.parse(content) as XTokenStore;
    
    return store;
  } catch (error) {
    logger.warn({ error }, 'Failed to read token store');
    return null;
  }
}

/**
 * 保存 Token Store
 */
export function saveTokenStore(store: XTokenStore): void {
  try {
    const storePath = path.resolve(xConfig.X_TOKEN_STORE);
    
    // 确保目录存在
    const dir = path.dirname(storePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf-8');
    logger.info({ storePath }, 'Token store saved');
  } catch (error) {
    logger.error({ error }, 'Failed to save token store');
    throw error;
  }
}

/**
 * 交换 Authorization Code 为 Access Token
 */
export async function exchangeCodeForToken(
  code: string,
  codeVerifier: string
): Promise<XTokenStore> {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: xConfig.X_REDIRECT_URI,
    client_id: xConfig.X_CLIENT_ID,
    code_verifier: codeVerifier,
  });
  
  // 构建请求头
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  
  // 如果有 client_secret，使用 Basic Auth
  if (xConfig.X_CLIENT_SECRET) {
    const credentials = Buffer.from(
      `${xConfig.X_CLIENT_ID}:${xConfig.X_CLIENT_SECRET}`
    ).toString('base64');
    headers['Authorization'] = `Basic ${credentials}`;
  }
  
  try {
    const response = await axios.post(
      'https://api.twitter.com/2/oauth2/token',
      params.toString(),
      { headers }
    );
    
    const data = response.data;
    const now = Date.now();
    const expiresIn = data.expires_in || 7200; // 默认 2 小时
    
    const store: XTokenStore = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_type: data.token_type || 'bearer',
      expires_in: expiresIn,
      scope: data.scope || xScopes.join(' '),
      obtainedAt: now,
      expiresAt: now + expiresIn * 1000,
    };
    
    logger.info({
      tokenType: store.token_type,
      expiresIn,
      hasRefreshToken: !!store.refresh_token,
      scope: store.scope,
    }, 'Token exchange successful');
    
    return store;
  } catch (error: any) {
    logger.error({ 
      error: error.response?.data || error.message,
      status: error.response?.status,
    }, 'Failed to exchange code for token');
    throw error;
  }
}

/**
 * 刷新 Access Token
 */
export async function refreshAccessToken(refreshToken: string): Promise<XTokenStore> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: xConfig.X_CLIENT_ID,
  });
  
  // 构建请求头
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  
  // 如果有 client_secret，使用 Basic Auth
  if (xConfig.X_CLIENT_SECRET) {
    const credentials = Buffer.from(
      `${xConfig.X_CLIENT_ID}:${xConfig.X_CLIENT_SECRET}`
    ).toString('base64');
    headers['Authorization'] = `Basic ${credentials}`;
  }
  
  try {
    const response = await axios.post(
      'https://api.twitter.com/2/oauth2/token',
      params.toString(),
      { headers }
    );
    
    const data = response.data;
    const now = Date.now();
    const expiresIn = data.expires_in || 7200;
    
    const store: XTokenStore = {
      access_token: data.access_token,
      refresh_token: data.refresh_token || refreshToken, // 保留原 refresh_token（如果新 token 没有提供）
      token_type: data.token_type || 'bearer',
      expires_in: expiresIn,
      scope: data.scope || xScopes.join(' '),
      obtainedAt: now,
      expiresAt: now + expiresIn * 1000,
    };
    
    logger.info({
      tokenType: store.token_type,
      expiresIn,
      hasRefreshToken: !!store.refresh_token,
    }, 'Token refresh successful');
    
    return store;
  } catch (error: any) {
    logger.error({ 
      error: error.response?.data || error.message,
      status: error.response?.status,
    }, 'Failed to refresh token');
    throw error;
  }
}

/**
 * 检查并刷新 Token（如果需要）
 */
export async function refreshAccessTokenIfNeeded(): Promise<string | null> {
  const store = readTokenStore();
  
  if (!store) {
    logger.warn('No token store found');
    return null;
  }
  
  // 检查是否过期（提前 5 分钟刷新）
  const now = Date.now();
  const bufferTime = 5 * 60 * 1000; // 5 分钟
  
  if (now >= store.expiresAt - bufferTime) {
    if (!store.refresh_token) {
      logger.warn('Token expired and no refresh_token available');
      return null;
    }
    
    logger.info('Token expired or near expiry, refreshing...');
    const newStore = await refreshAccessToken(store.refresh_token);
    saveTokenStore(newStore);
    return newStore.access_token;
  }
  
  return store.access_token;
}

/**
 * 获取有效的 Access Token（自动刷新）
 */
export async function getValidAccessToken(): Promise<string | null> {
  return refreshAccessTokenIfNeeded();
}

/**
 * 格式化 Token 用于日志（只显示前6位+后4位）
 */
export function formatTokenForLog(token: string): string {
  if (token.length <= 10) {
    return '***';
  }
  return `${token.substring(0, 6)}...${token.substring(token.length - 4)}`;
}

