import { startXOAuthServer } from './xOAuth.server';
import { logger } from '../utils/logger';

/**
 * 启动独立的 OAuth Server
 * 不影响 Telegram Bot 的运行
 */
export function startOAuthServer(): void {
  try {
    startXOAuthServer();
  } catch (error) {
    logger.error({ error }, 'Failed to start OAuth server');
    process.exit(1);
  }
}

// 如果直接运行此文件，启动 server
if (require.main === module) {
  startOAuthServer();
}

