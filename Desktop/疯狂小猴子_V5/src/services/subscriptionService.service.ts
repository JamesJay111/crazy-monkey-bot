import Database from 'better-sqlite3';
import { logger } from '../utils/logger';

/**
 * 用户订阅数据
 */
export interface UserSubscription {
  userId: number;
  channels: string[]; // Channel ID 列表
  createdAt?: number;
  updatedAt?: number;
}

/**
 * 订阅管理服务
 * 负责用户订阅的存储和查询
 */
export class SubscriptionService {
  constructor(private db: Database.Database) {
    // 确保 metadata 字段存在（如果数据库已存在，需要手动添加列）
    this.initDatabase();
  }

  /**
   * 初始化数据库（添加 metadata 列如果不存在）
   */
  private initDatabase(): void {
    try {
      // 检查 metadata 列是否存在
      const tableInfo = this.db.prepare("PRAGMA table_info(users)").all() as any[];
      const hasMetadata = tableInfo.some(col => col.name === 'metadata');
      
      if (!hasMetadata) {
        this.db.exec('ALTER TABLE users ADD COLUMN metadata TEXT');
        logger.info('Added metadata column to users table');
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to init subscription database');
    }
  }

  /**
   * 获取用户订阅的频道列表（G3.2）
   */
  getUserSubscriptions(userId: number): string[] {
    try {
      const stmt = this.db.prepare('SELECT metadata FROM users WHERE id = ?');
      const result = stmt.get(userId) as any;
      
      if (!result || !result.metadata) {
        return [];
      }

      // 解析 JSON metadata
      const metadata = JSON.parse(result.metadata);
      return metadata.channels || [];
    } catch (error) {
      logger.warn({ error, userId }, 'Failed to get user subscriptions');
      return [];
    }
  }

  /**
   * 设置用户订阅的频道列表
   */
  setUserSubscriptions(userId: number, channels: string[]): void {
    try {
      // 检查用户是否存在
      const checkStmt = this.db.prepare('SELECT id FROM users WHERE id = ?');
      const user = checkStmt.get(userId);
      
      if (!user) {
        logger.warn({ userId }, 'User not found, cannot set subscriptions');
        return;
      }

      // 读取现有 metadata
      const selectStmt = this.db.prepare('SELECT metadata FROM users WHERE id = ?');
      const result = selectStmt.get(userId) as any;
      let metadata: any = {};
      
      if (result && result.metadata) {
        try {
          metadata = JSON.parse(result.metadata);
        } catch (e) {
          metadata = {};
        }
      }

      // 更新订阅信息
      metadata.channels = channels;
      metadata.subscriptionUpdatedAt = Date.now();

      // 保存到数据库
      const updateStmt = this.db.prepare('UPDATE users SET metadata = ?, updated_at = ? WHERE id = ?');
      updateStmt.run(JSON.stringify(metadata), Date.now(), userId);
      
      logger.info({ userId, channels }, 'User subscriptions updated');
    } catch (error) {
      logger.error({ error, userId, channels }, 'Failed to set user subscriptions');
      throw error;
    }
  }

  /**
   * 切换用户订阅状态（添加或移除频道）
   */
  toggleChannel(userId: number, channelId: string): boolean {
    try {
      const currentChannels = this.getUserSubscriptions(userId);
      const isSubscribed = currentChannels.includes(channelId);

      let newChannels: string[];
      if (isSubscribed) {
        // 取消订阅
        newChannels = currentChannels.filter(id => id !== channelId);
      } else {
        // 订阅
        newChannels = [...currentChannels, channelId];
      }

      this.setUserSubscriptions(userId, newChannels);
      return !isSubscribed; // 返回新的订阅状态
    } catch (error) {
      logger.error({ error, userId, channelId }, 'Failed to toggle channel');
      throw error;
    }
  }

  /**
   * 获取所有订阅了指定频道的用户ID列表
   * 用于推送分发（G4）
   */
  getUsersSubscribedToChannels(channelIds: string[]): number[] {
    try {
      // 获取所有用户
      const stmt = this.db.prepare('SELECT id, metadata FROM users');
      const allUsers = stmt.all() as any[];
      const subscribedUsers: number[] = [];

      for (const user of allUsers) {
        let userChannels: string[] = [];
        
        if (user.metadata) {
          try {
            const metadata = JSON.parse(user.metadata);
            userChannels = metadata.channels || [];
          } catch (e) {
            // 忽略解析错误
          }
        }
        
        // 检查用户订阅的频道与目标频道是否有交集
        const hasMatch = channelIds.some(channelId => userChannels.includes(channelId));
        
        if (hasMatch) {
          subscribedUsers.push(user.id);
        }
      }

      return subscribedUsers;
    } catch (error) {
      logger.error({ error, channelIds }, 'Failed to get users subscribed to channels');
      return [];
    }
  }

  /**
   * 检查用户是否订阅了指定频道
   */
  isUserSubscribedTo(userId: number, channelId: string): boolean {
    const channels = this.getUserSubscriptions(userId);
    return channels.includes(channelId);
  }
}

