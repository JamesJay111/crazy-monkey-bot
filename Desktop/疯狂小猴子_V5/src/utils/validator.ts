import { normalizeTicker } from './formatter';

/**
 * 验证 Ticker 格式
 */
export function isValidTicker(ticker: string): boolean {
  const normalized = normalizeTicker(ticker);
  return normalized.length > 0 && normalized.length <= 10 && /^[A-Z0-9]+$/.test(normalized);
}

/**
 * 规范化 Ticker（导出供其他模块使用）
 */
export { normalizeTicker };

/**
 * 验证邀请码
 */
export function isValidInviteCode(code: string): boolean {
  return code.trim() === 'Ocean001';
}

