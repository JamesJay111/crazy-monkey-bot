import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';

/**
 * 预发布日志工具
 * 用于在 PREFLIGHT_MODE 下记录推文内容而不实际发送
 */
export class PreflightLogger {
  private static readonly LOG_DIR = path.resolve('./logs');
  private static readonly LOG_FILE = path.join(this.LOG_DIR, 'twitter_preflight.log');

  /**
   * 确保日志目录存在
   */
  private static ensureLogDir(): void {
    if (!fs.existsSync(this.LOG_DIR)) {
      fs.mkdirSync(this.LOG_DIR, { recursive: true });
    }
  }

  /**
   * 记录预发布日志
   * @param ticker 币种符号
   * @param interval 时间间隔（如 "8H"）
   * @param content 推文内容
   * @param skipReason 跳过原因（如果数据不完整）
   * @param dataSourceSummary 数据来源摘要（4h/8h 是否更新成功）
   */
  static log(
    ticker: string, 
    interval: string, 
    content: string | null, 
    skipReason?: string,
    dataSourceSummary?: { oiSource?: string; takerSource?: string; topSource?: string; fundingSource?: string }
  ): void {
    try {
      this.ensureLogDir();

      const timestamp = new Date().toISOString();
      const logEntry = [
        '-----',
        `timestamp=${timestamp}`,
        `ticker=${ticker}`,
        `interval=${interval}`,
        skipReason ? `skipReason=${skipReason}` : null,
        dataSourceSummary ? `dataSourceSummary=${JSON.stringify(dataSourceSummary)}` : null,
        content ? `content=\n${content}` : 'content=(skipped)',
        '',
      ]
        .filter(line => line !== null)
        .join('\n');

      fs.appendFileSync(this.LOG_FILE, logEntry, 'utf-8');
      logger.info({ ticker, interval, hasContent: !!content, skipReason, dataSourceSummary }, 'Preflight log written');
    } catch (error) {
      logger.error({ error, ticker }, 'Failed to write preflight log');
    }
  }

  /**
   * 记录数据不完整的情况
   * @param ticker 币种符号
   * @param missingFields 缺失字段列表
   * @param invalidFields 无效字段列表
   */
  static logIncompleteData(ticker: string, missingFields: string[], invalidFields: string[]): void {
    const reason = `数据不完整: 缺失字段=[${missingFields.join(', ')}], 无效字段=[${invalidFields.join(', ')}]`;
    this.log(ticker, '8H', null, reason);
  }
}

