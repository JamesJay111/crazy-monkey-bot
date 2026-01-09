import Database from 'better-sqlite3';
import { User } from '../types';
import { logger } from '../utils/logger';

export class UserRepository {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * 获取或创建用户
   */
  getOrCreate(userId: number, username?: string): User {
    const stmt = this.db.prepare('SELECT * FROM users WHERE id = ?');
    let user = stmt.get(userId) as any;

    if (!user) {
      const now = Date.now();
      const insertStmt = this.db.prepare(`
        INSERT INTO users (id, username, is_unlocked, created_at, updated_at)
        VALUES (?, ?, 0, ?, ?)
      `);
      insertStmt.run(userId, username || null, now, now);
      
      user = { id: userId, username, is_unlocked: 0, created_at: now, updated_at: now };
      logger.info({ userId }, 'User created');
    } else if (username && user.username !== username) {
      // 更新用户名
      const updateStmt = this.db.prepare('UPDATE users SET username = ?, updated_at = ? WHERE id = ?');
      updateStmt.run(username, Date.now(), userId);
      user.username = username;
    }

    return {
      id: user.id,
      username: user.username,
      isUnlocked: Boolean(user.is_unlocked),
      unlockMethod: user.unlock_method as 'stars' | 'invite' | undefined,
      unlockTime: user.unlock_time,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    };
  }

  /**
   * 解锁用户
   */
  unlockUser(userId: number, method: 'stars' | 'invite'): void {
    const now = Date.now();
    const stmt = this.db.prepare(`
      UPDATE users 
      SET is_unlocked = 1, unlock_method = ?, unlock_time = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(method, now, now, userId);
    logger.info({ userId, method }, 'User unlocked');
  }

  /**
   * 检查用户是否已解锁
   */
  isUnlocked(userId: number): boolean {
    const stmt = this.db.prepare('SELECT is_unlocked FROM users WHERE id = ?');
    const result = stmt.get(userId) as any;
    return Boolean(result?.is_unlocked);
  }

  /**
   * 获取用户
   */
  getUser(userId: number): User | null {
    const stmt = this.db.prepare('SELECT * FROM users WHERE id = ?');
    const user = stmt.get(userId) as any;
    
    if (!user) return null;

    return {
      id: user.id,
      username: user.username,
      isUnlocked: Boolean(user.is_unlocked),
      unlockMethod: user.unlock_method as 'stars' | 'invite' | undefined,
      unlockTime: user.unlock_time,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
    };
  }
}

