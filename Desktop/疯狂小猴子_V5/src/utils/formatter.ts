/**
 * 格式化工具
 */

/**
 * 格式化数字，保留小数位
 */
export function formatNumber(value: string | number, decimals: number = 2): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return 'N/A';
  return num.toFixed(decimals);
}

/**
 * 格式化大数字（添加千分位）
 */
export function formatLargeNumber(value: string | number): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return 'N/A';
  return num.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

/**
 * 格式化百分比
 */
export function formatPercent(value: string | number, decimals: number = 2): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return 'N/A';
  const sign = num >= 0 ? '+' : '';
  return `${sign}${(num * 100).toFixed(decimals)}%`;
}

/**
 * 格式化时间戳为北京时间（UTC+7）
 */
export function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  // UTC+7 (Asia/Bangkok)
  const utc7 = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return utc7.toISOString().replace('T', ' ').substring(0, 19) + ' (UTC+7)';
}

/**
 * 格式化日期
 */
export function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const utc7 = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  return utc7.toISOString().substring(0, 10);
}

/**
 * 规范化 Ticker（去空格、转大写）
 */
export function normalizeTicker(ticker: string): string {
  return ticker.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

