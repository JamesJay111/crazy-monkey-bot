/**
 * DecisionEngine - 阈值判断 + 候选池 + 去重
 */

import { logger } from '../../utils/logger';
import { ScanResult, OIAlertEvent, CandidateRecord, ScanStats } from './types';
import { CandidatePool } from './candidatePool';
import * as crypto from 'crypto';

export interface DecisionEngineConfig {
  thresholdPercent: number; // 默认 10%
  cooldownWindowMs: number; // 默认 2 小时
  interval: '4h' | '24h'; // 使用哪个周期
}

export class DecisionEngine {
  constructor(
    private candidatePool: CandidatePool,
    private config: DecisionEngineConfig
  ) {}

  /**
   * 处理扫描结果，返回需要推送的事件
   */
  async processScanResults(results: ScanResult[]): Promise<{
    events: OIAlertEvent[];
    stats: ScanStats;
  }> {
    const stats: ScanStats = {
      totalTickers: results.length,
      successCount: 0,
      noDataCount: 0,
      rateLimitCount: 0,
      fatalErrorCount: 0,
      candidateCount: 0,
      confirmedCount: 0,
      droppedCount: 0,
    };

    const events: OIAlertEvent[] = [];

    for (const result of results) {
      // 统计
      if (result.errorType === 'no_data') {
        stats.noDataCount++;
      } else if (result.errorType === 'rate_limit') {
        stats.rateLimitCount++;
      } else if (result.errorType === 'fatal_error') {
        stats.fatalErrorCount++;
      } else if (result.oiUsd !== null) {
        stats.successCount++;
      }

      // 跳过有错误的（但保留候选池中的记录）
      if (result.errorType !== null) {
        // 如果是限流，保留候选池中的记录
        if (result.errorType === 'rate_limit') {
          const key = this.getCandidateKey(result.symbol, this.config.interval);
          const existing = this.candidatePool.getCandidate(key);
          if (existing && existing.status === 'candidate') {
            // 更新重试计数
            existing.retryPendingCount++;
            existing.lastErrorType = 'rate_limit';
            existing.lastCheckedAt = Date.now();
            this.candidatePool.upsertCandidate(existing);
          }
        }
        continue;
      }

      // 检查是否满足阈值
      const oiChange = result.oiChange4hPercent ?? result.oiChange24hPercent;
      if (oiChange === null || Math.abs(oiChange) < this.config.thresholdPercent) {
        // 不满足阈值，检查是否需要丢弃候选
        const key = this.getCandidateKey(result.symbol, this.config.interval);
        const existing = this.candidatePool.getCandidate(key);
        if (existing && existing.status === 'candidate') {
          // 之前是候选，现在不满足了，标记为丢弃
          this.candidatePool.markAsDropped(key);
          stats.droppedCount++;
        }
        continue;
      }

      // 满足阈值，处理候选池逻辑
      const key = this.getCandidateKey(result.symbol, this.config.interval);
      const existing = this.candidatePool.getCandidate(key);

      if (!existing) {
        // 首次满足阈值，进入候选池（不推送）
        const candidate: CandidateRecord = {
          key,
          symbol: result.symbol,
          interval: this.config.interval,
          firstDetectedAt: Date.now(),
          lastCheckedAt: Date.now(),
          lastKnownChange: oiChange,
          status: 'candidate',
          retryPendingCount: 0,
          lastErrorType: null,
          direction: result.direction,
        };
        this.candidatePool.upsertCandidate(candidate);
        stats.candidateCount++;
        logger.info({
          symbol: result.symbol,
          oiChange: oiChange.toFixed(2),
          direction: result.direction,
        }, 'New candidate detected');
      } else if (existing.status === 'candidate') {
        // 二次确认，触发推送事件
        const event = this.createEvent(result, existing);
        events.push(event);
        
        // 标记为已发送
        this.candidatePool.markAsSent(key);
        stats.confirmedCount++;
        
        logger.info({
          symbol: result.symbol,
          eventId: event.eventId,
          oiChange: oiChange.toFixed(2),
        }, 'Candidate confirmed, event created');
      } else if (existing.status === 'confirmed_sent') {
        // 已发送过，检查是否需要更新（方向反转等）
        // 这里可以根据需要实现方向反转逻辑
        logger.debug({ symbol: result.symbol }, 'Already sent, skipping');
      }
    }

    return { events, stats };
  }

  /**
   * 创建事件对象
   */
  private createEvent(result: ScanResult, candidate: CandidateRecord): OIAlertEvent {
    const detectedAt = Date.now();
    const cooldownWindow = this.config.cooldownWindowMs;
    const timeBucket = Math.floor(detectedAt / cooldownWindow);
    
    // 生成 eventId：hash(symbol + interval + direction + timeBucket)
    const eventId = crypto
      .createHash('sha256')
      .update(`${result.symbol}:${this.config.interval}:${result.direction}:${timeBucket}`)
      .digest('hex')
      .substring(0, 16);

    return {
      eventId,
      symbol: result.symbol,
      market: 'BinanceFutures',
      interval: this.config.interval,
      oiUsd: result.oiUsd,
      oiChangePct: result.oiChange4hPercent ?? result.oiChange24hPercent,
      direction: result.direction,
      detectedAt: new Date(detectedAt).toISOString(),
      priceChange1hPct: result.priceChange1hPercent,
      priceChangePct: result.priceChange4hPercent ?? result.priceChange24hPercent,
      priceChange24hPct: result.priceChange24hPercent,
      marketCapUsd: result.marketCapUsd,
      oiMcPercent: result.oiMcPercent,
      meta: {
        firstDetectedAt: new Date(candidate.firstDetectedAt).toISOString(),
        retryPendingCount: candidate.retryPendingCount,
      },
    };
  }

  /**
   * 获取候选键
   */
  private getCandidateKey(symbol: string, interval: '4h' | '24h'): string {
    return `${symbol}:${interval}`;
  }
}

