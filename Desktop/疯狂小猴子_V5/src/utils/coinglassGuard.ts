import { logger } from './logger';
import { isFiniteNumber } from './number';

/**
 * CoinGlass API 响应元数据
 */
export interface CoinGlassMeta {
  success?: boolean;
  code?: string | number;
  msg?: string;
  error?: string;
  traceId?: string;
}

/**
 * CoinGlass 响应守卫
 * 识别 HTTP 200 但业务失败的响应
 */
export class CoinGlassGuard {
  /**
   * 断言业务响应成功
   * @param resp CoinGlass API 响应
   * @param context 上下文信息（用于日志）
   * @throws 如果业务失败则抛出错误
   */
  static assertBusinessOk(resp: any, context: { endpoint: string; symbol?: string; pairSymbol?: string; interval?: string }): void {
    const meta = this.extractMeta(resp);

    // 检查业务失败标志
    if (meta.success === false) {
      const error = new Error(`CoinGlass business error: ${meta.msg || meta.error || 'Unknown error'}`);
      (error as any).meta = meta;
      (error as any).context = context;
      throw error;
    }

    // 检查错误码（code != 0 或 code == '400'/'500' 等）
    if (meta.code !== undefined && meta.code !== null) {
      const codeNum = typeof meta.code === 'string' ? parseInt(meta.code, 10) : meta.code;
      if (!isNaN(codeNum) && codeNum !== 0 && codeNum !== 200) {
        const error = new Error(`CoinGlass error code: ${codeNum}, msg: ${meta.msg || 'Unknown error'}`);
        (error as any).meta = meta;
        (error as any).context = context;
        throw error;
      }
    }

    // 检查错误消息（msg 包含 'error'/'fail'/'限流' 等关键词）
    if (meta.msg) {
      const msgLower = meta.msg.toLowerCase();
      if (msgLower.includes('error') || 
          msgLower.includes('fail') || 
          msgLower.includes('限流') || 
          msgLower.includes('too many requests') ||
          msgLower.includes('rate limit')) {
        const error = new Error(`CoinGlass business error: ${meta.msg}`);
        (error as any).meta = meta;
        (error as any).context = context;
        throw error;
      }
    }
  }

  /**
   * 提取响应元数据
   * @param resp CoinGlass API 响应
   * @returns 元数据
   */
  static extractMeta(resp: any): CoinGlassMeta {
    const meta: CoinGlassMeta = {};

    // 尝试从不同位置提取元数据
    if (resp && typeof resp === 'object') {
      // 顶层字段
      if ('success' in resp) meta.success = resp.success;
      if ('code' in resp) meta.code = resp.code;
      if ('msg' in resp) meta.msg = resp.msg;
      if ('error' in resp) meta.error = resp.error;
      if ('traceId' in resp) meta.traceId = resp.traceId;

      // data 字段内的元数据
      if (resp.data && typeof resp.data === 'object') {
        if ('success' in resp.data) meta.success = resp.data.success;
        if ('code' in resp.data) meta.code = resp.data.code;
        if ('msg' in resp.data) meta.msg = resp.data.msg;
        if ('error' in resp.data) meta.error = resp.data.error;
      }

      // rawResponse 字段（错误响应）
      if (resp.rawResponse && typeof resp.rawResponse === 'object') {
        if ('code' in resp.rawResponse) meta.code = resp.rawResponse.code;
        if ('msg' in resp.rawResponse) meta.msg = resp.rawResponse.msg;
      }
    }

    return meta;
  }

  /**
   * 检查响应是否为有效数据
   * @param resp 响应数据
   * @returns 是否为有效数据
   */
  static isValidData(resp: any): boolean {
    if (!resp) return false;
    
    // 检查是否为数组（历史数据）
    if (Array.isArray(resp)) {
      return resp.length > 0;
    }

    // 检查是否为对象
    if (typeof resp === 'object') {
      // 如果有 data 字段，检查 data
      if ('data' in resp) {
        const data = resp.data;
        if (Array.isArray(data)) {
          return data.length > 0;
        }
        return data !== null && data !== undefined;
      }
      // 否则检查对象本身是否有有效字段
      return Object.keys(resp).length > 0;
    }

    return false;
  }
}



