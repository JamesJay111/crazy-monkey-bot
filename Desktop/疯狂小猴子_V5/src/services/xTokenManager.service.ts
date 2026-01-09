import * as fs from 'fs';
import * as path from 'path';
import { xConfig } from '../config/x';
import { logger } from '../utils/logger';
import { refreshAccessToken, XTokenStore, formatTokenForLog } from './xOAuth.service';

/**
 * Token 管理器
 * 提供自动刷新机制，实现"永久"token（通过自动刷新）
 */
export class XTokenManager {
  private tokenStore: XTokenStore | null = null;
  private refreshPromise: Promise<string | null> | null = null;

  constructor() {
    this.loadTokenStore();
  }

  /**
   * 加载 Token Store
   */
  private loadTokenStore(): void {
    try {
      const storePath = path.resolve(xConfig.X_TOKEN_STORE);
      if (!fs.existsSync(storePath)) {
        logger.warn('Token store file not found');
        return;
      }

      const content = fs.readFileSync(storePath, 'utf-8');
      this.tokenStore = JSON.parse(content) as XTokenStore;
      logger.info({
        tokenPreview: formatTokenForLog(this.tokenStore.access_token),
        expiresAt: new Date(this.tokenStore.expiresAt).toISOString(),
        hasRefreshToken: !!this.tokenStore.refresh_token,
      }, 'Token store loaded');
    } catch (error) {
      logger.error({ error }, 'Failed to load token store');
    }
  }

  /**
   * 获取有效的 Access Token（自动刷新）
   * 这是"永久"token 的核心：通过自动刷新实现长期使用
   */
  async getValidAccessToken(): Promise<string | null> {
    if (!this.tokenStore) {
      logger.warn('No token store available');
      return null;
    }

    // 如果正在刷新，等待刷新完成
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    const now = Date.now();
    const bufferTime = 5 * 60 * 1000; // 提前 5 分钟刷新

    // 检查是否需要刷新
    if (now >= this.tokenStore.expiresAt - bufferTime) {
      if (!this.tokenStore.refresh_token) {
        logger.error('Token expired and no refresh_token available');
        return null;
      }

      // 开始刷新
      this.refreshPromise = this.refreshToken();
      const newToken = await this.refreshPromise;
      this.refreshPromise = null;
      return newToken;
    }

    return this.tokenStore.access_token;
  }

  /**
   * 刷新 Token
   */
  private async refreshToken(): Promise<string | null> {
    if (!this.tokenStore?.refresh_token) {
      return null;
    }

    try {
      logger.info('Refreshing access token...');
      const newStore = await refreshAccessToken(this.tokenStore.refresh_token);
      
      // 保存新的 token
      this.saveTokenStore(newStore);
      this.tokenStore = newStore;

      logger.info({
        tokenPreview: formatTokenForLog(newStore.access_token),
        expiresAt: new Date(newStore.expiresAt).toISOString(),
      }, 'Token refreshed successfully');

      return newStore.access_token;
    } catch (error) {
      logger.error({ error }, 'Failed to refresh token');
      return null;
    }
  }

  /**
   * 保存 Token Store
   */
  private saveTokenStore(store: XTokenStore): void {
    try {
      const storePath = path.resolve(xConfig.X_TOKEN_STORE);
      const dir = path.dirname(storePath);
      
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf-8');
      logger.info({ storePath }, 'Token store saved');
    } catch (error) {
      logger.error({ error }, 'Failed to save token store');
    }
  }

  /**
   * 检查 Token 是否有效
   */
  isTokenValid(): boolean {
    if (!this.tokenStore) {
      return false;
    }

    const now = Date.now();
    return now < this.tokenStore.expiresAt;
  }

  /**
   * 获取 Token 信息
   */
  getTokenInfo(): {
    hasToken: boolean;
    hasRefreshToken: boolean;
    expiresAt: string | null;
    isExpired: boolean;
    timeUntilExpiry: number | null;
  } {
    if (!this.tokenStore) {
      return {
        hasToken: false,
        hasRefreshToken: false,
        expiresAt: null,
        isExpired: true,
        timeUntilExpiry: null,
      };
    }

    const now = Date.now();
    const isExpired = now >= this.tokenStore.expiresAt;
    const timeUntilExpiry = isExpired ? 0 : Math.floor((this.tokenStore.expiresAt - now) / 1000);

    return {
      hasToken: true,
      hasRefreshToken: !!this.tokenStore.refresh_token,
      expiresAt: new Date(this.tokenStore.expiresAt).toISOString(),
      isExpired,
      timeUntilExpiry,
    };
  }
}

// 单例实例
let tokenManagerInstance: XTokenManager | null = null;

/**
 * 获取 Token Manager 实例
 */
export function getTokenManager(): XTokenManager {
  if (!tokenManagerInstance) {
    tokenManagerInstance = new XTokenManager();
  }
  return tokenManagerInstance;
}

