import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

/**
 * 转发状态结构
 */
export interface ForwardState {
  lastSeenTweetId: string | null;
  processed: Record<string, {
    b?: { tweetId: string; url: string; timestamp: number };
    c?: { tweetId: string; url: string; timestamp: number };
  }>;
}

/**
 * 转发状态管理服务
 */
export class TweetForwardStateService {
  private readonly STATE_FILE = path.resolve('./data/x_forward_state.json');

  /**
   * 读取状态
   */
  readState(): ForwardState {
    try {
      const dir = path.dirname(this.STATE_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      if (!fs.existsSync(this.STATE_FILE)) {
        return {
          lastSeenTweetId: null,
          processed: {},
        };
      }

      const content = fs.readFileSync(this.STATE_FILE, 'utf-8');
      return JSON.parse(content) as ForwardState;
    } catch (error) {
      logger.warn({ error }, 'Failed to read forward state, using default');
      return {
        lastSeenTweetId: null,
        processed: {},
      };
    }
  }

  /**
   * 保存状态
   */
  saveState(state: ForwardState): void {
    try {
      const dir = path.dirname(this.STATE_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.writeFileSync(this.STATE_FILE, JSON.stringify(state, null, 2), 'utf-8');
    } catch (error) {
      logger.error({ error }, 'Failed to save forward state');
      throw error;
    }
  }

  /**
   * 检查推文是否已处理
   */
  isProcessed(tweetId: string): boolean {
    const state = this.readState();
    return !!state.processed[tweetId];
  }

  /**
   * 检查推文是否已转发到指定账户
   */
  isForwardedTo(tweetId: string, accountKey: 'b' | 'c'): boolean {
    const state = this.readState();
    return !!state.processed[tweetId]?.[accountKey];
  }

  /**
   * 标记推文已转发到指定账户
   */
  markForwarded(tweetId: string, accountKey: 'b' | 'c', forwardedTweetId: string, url: string): void {
    const state = this.readState();
    
    if (!state.processed[tweetId]) {
      state.processed[tweetId] = {};
    }

    state.processed[tweetId][accountKey] = {
      tweetId: forwardedTweetId,
      url,
      timestamp: Date.now(),
    };

    this.saveState(state);
  }

  /**
   * 更新最后看到的推文 ID
   */
  updateLastSeenTweetId(tweetId: string): void {
    const state = this.readState();
    state.lastSeenTweetId = tweetId;
    this.saveState(state);
  }

  /**
   * 清理旧的状态记录（可选，避免文件过大）
   */
  cleanupOldRecords(keepDays: number = 30): void {
    const state = this.readState();
    const cutoffTime = Date.now() - keepDays * 24 * 60 * 60 * 1000;
    
    let cleaned = 0;
    for (const tweetId in state.processed) {
      const record = state.processed[tweetId];
      const oldestTimestamp = Math.min(
        record.b?.timestamp || Infinity,
        record.c?.timestamp || Infinity
      );
      
      if (oldestTimestamp < cutoffTime) {
        delete state.processed[tweetId];
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.saveState(state);
      logger.info({ cleaned }, 'Cleaned up old forward state records');
    }
  }
}



