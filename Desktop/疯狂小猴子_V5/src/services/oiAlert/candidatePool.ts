/**
 * CandidatePool - 候选池管理（持久化）
 */

import Database from 'better-sqlite3';
import { logger } from '../../utils/logger';
import { CandidateRecord } from './types';

export class CandidatePool {
  constructor(private db: Database.Database) {
    this.initDatabase();
  }

  /**
   * 初始化数据库表
   */
  private initDatabase(): void {
    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS oi_alert_candidate_pool (
          key TEXT PRIMARY KEY,
          symbol TEXT NOT NULL,
          interval TEXT NOT NULL CHECK(interval IN ('4h', '24h')),
          first_detected_at_utc_ms INTEGER NOT NULL,
          last_checked_at_utc_ms INTEGER NOT NULL,
          last_known_change REAL NOT NULL,
          status TEXT NOT NULL CHECK(status IN ('candidate', 'confirmed_sent', 'dropped')),
          retry_pending_count INTEGER DEFAULT 0,
          last_error_type TEXT CHECK(last_error_type IN ('rate_limit', 'no_data', 'fatal_error')),
          direction TEXT NOT NULL CHECK(direction IN ('up', 'down', 'unknown')),
          created_at_utc_ms INTEGER NOT NULL,
          updated_at_utc_ms INTEGER NOT NULL
        )
      `);
    } catch (error) {
      logger.error({ error }, 'Failed to init candidate pool database');
    }
  }

  /**
   * 获取候选记录
   */
  getCandidate(key: string): CandidateRecord | null {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM oi_alert_candidate_pool WHERE key = ?
      `);
      const row = stmt.get(key) as any;

      if (!row) {
        return null;
      }

      return {
        key: row.key,
        symbol: row.symbol,
        interval: row.interval as '4h' | '24h',
        firstDetectedAt: row.first_detected_at_utc_ms,
        lastCheckedAt: row.last_checked_at_utc_ms,
        lastKnownChange: row.last_known_change,
        status: row.status as 'candidate' | 'confirmed_sent' | 'dropped',
        retryPendingCount: row.retry_pending_count || 0,
        lastErrorType: row.last_error_type as 'rate_limit' | 'no_data' | 'fatal_error' | null,
        direction: row.direction as 'up' | 'down' | 'unknown',
      };
    } catch (error) {
      logger.error({ error, key }, 'Failed to get candidate');
      return null;
    }
  }

  /**
   * 添加或更新候选记录
   */
  upsertCandidate(record: CandidateRecord): void {
    try {
      const now = Date.now();
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO oi_alert_candidate_pool (
          key, symbol, interval, first_detected_at_utc_ms, last_checked_at_utc_ms,
          last_known_change, status, retry_pending_count, last_error_type,
          direction, created_at_utc_ms, updated_at_utc_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 
          COALESCE((SELECT created_at_utc_ms FROM oi_alert_candidate_pool WHERE key = ?), ?),
          ?
        )
      `);

      stmt.run(
        record.key,
        record.symbol,
        record.interval,
        record.firstDetectedAt,
        record.lastCheckedAt,
        record.lastKnownChange,
        record.status,
        record.retryPendingCount,
        record.lastErrorType,
        record.direction,
        record.key, // 用于 SELECT created_at_utc_ms
        now, // 如果不存在，使用当前时间
        now
      );
    } catch (error) {
      logger.error({ error, record }, 'Failed to upsert candidate');
    }
  }

  /**
   * 标记为已发送
   */
  markAsSent(key: string): void {
    try {
      const stmt = this.db.prepare(`
        UPDATE oi_alert_candidate_pool
        SET status = 'confirmed_sent', updated_at_utc_ms = ?
        WHERE key = ?
      `);
      stmt.run(Date.now(), key);
    } catch (error) {
      logger.error({ error, key }, 'Failed to mark candidate as sent');
    }
  }

  /**
   * 标记为已丢弃
   */
  markAsDropped(key: string): void {
    try {
      const stmt = this.db.prepare(`
        UPDATE oi_alert_candidate_pool
        SET status = 'dropped', updated_at_utc_ms = ?
        WHERE key = ?
      `);
      stmt.run(Date.now(), key);
    } catch (error) {
      logger.error({ error, key }, 'Failed to mark candidate as dropped');
    }
  }

  /**
   * 清理旧的已发送/已丢弃记录（可选，避免表过大）
   */
  cleanupOldRecords(olderThanDays: number = 7): void {
    try {
      const cutoffTime = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
      const stmt = this.db.prepare(`
        DELETE FROM oi_alert_candidate_pool
        WHERE status IN ('confirmed_sent', 'dropped')
        AND updated_at_utc_ms < ?
      `);
      const result = stmt.run(cutoffTime);
      logger.info({ deletedCount: result.changes }, 'Cleaned up old candidate records');
    } catch (error) {
      logger.error({ error }, 'Failed to cleanup old records');
    }
  }
}

