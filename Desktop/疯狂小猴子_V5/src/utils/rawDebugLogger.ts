import * as fs from 'fs';
import * as path from 'path';
import { logger } from './logger';
import { CoinGlassGuard, CoinGlassMeta } from './coinglassGuard';

/**
 * Raw Debug 日志工具
 * 记录 CoinGlass API 请求的原始响应，用于问题定位
 */
export class RawDebugLogger {
  private static readonly LOG_DIR = path.resolve('./logs');
  private static readonly LOG_FILE = path.join(this.LOG_DIR, 'coinglass_raw_debug.log');

  /**
   * 确保日志目录存在
   */
  private static ensureLogDir(): void {
    if (!fs.existsSync(this.LOG_DIR)) {
      fs.mkdirSync(this.LOG_DIR, { recursive: true });
    }
  }

  /**
   * 记录 CoinGlass 请求响应
   * @param endpoint 端点名称
   * @param context 上下文（symbol, pairSymbol, interval 等）
   * @param resp 响应数据
   * @param guardResult guard 判定结果
   */
  static log(
    endpoint: string,
    context: { symbol?: string; pairSymbol?: string; interval?: string; exchange?: string },
    resp: any,
    guardResult: { ok: boolean; reason?: string }
  ): void {
    try {
      this.ensureLogDir();

      const timestamp = new Date().toISOString();
      const meta = CoinGlassGuard.extractMeta(resp);

      // 提取关键字段原始值
      const rawFields: Record<string, any> = {};
      if (Array.isArray(resp) && resp.length > 0) {
        const first = resp[0];
        rawFields['first_item_keys'] = Object.keys(first || {});
        // 提取常见字段
        if (first) {
          rawFields['taker_buy_volume_usd'] = first.taker_buy_volume_usd;
          rawFields['taker_sell_volume_usd'] = first.taker_sell_volume_usd;
          rawFields['top_position_long_percent'] = first.top_position_long_percent;
          rawFields['top_position_short_percent'] = first.top_position_short_percent;
          rawFields['top_position_long_short_ratio'] = first.top_position_long_short_ratio;
          rawFields['funding_rate'] = first.funding_rate;
        }
      } else if (resp && typeof resp === 'object') {
        rawFields['response_keys'] = Object.keys(resp);
        if (resp.data && Array.isArray(resp.data) && resp.data.length > 0) {
          rawFields['data_first_item'] = resp.data[0];
        }
      }

      const logEntry = [
        '-----',
        `timestamp=${timestamp}`,
        `endpoint=${endpoint}`,
        context.symbol ? `symbol=${context.symbol}` : null,
        context.pairSymbol ? `pairSymbol=${context.pairSymbol}` : null,
        context.interval ? `interval=${context.interval}` : null,
        context.exchange ? `exchange=${context.exchange}` : null,
        `meta=${JSON.stringify(meta)}`,
        `dataLength=${Array.isArray(resp) ? resp.length : (resp?.data && Array.isArray(resp.data) ? resp.data.length : 'N/A')}`,
        `isEmpty=${!CoinGlassGuard.isValidData(resp)}`,
        `rawFields=${JSON.stringify(rawFields)}`,
        `guardResult=${guardResult.ok ? 'ok' : `fail: ${guardResult.reason || 'unknown'}`}`,
        '',
      ]
        .filter(line => line !== null)
        .join('\n');

      fs.appendFileSync(this.LOG_FILE, logEntry, 'utf-8');
      logger.debug({ endpoint, context, guardOk: guardResult.ok }, 'Raw debug log written');
    } catch (error) {
      logger.error({ error, endpoint }, 'Failed to write raw debug log');
    }
  }
}



