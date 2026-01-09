/**
 * ETF 日期匹配工具
 * 支持区间匹配和日线点匹配两种方式
 */

/**
 * 匹配目标日期的数据
 * @param timestamp 数据时间戳（毫秒）
 * @param targetDateStart 目标日期开始时间戳（毫秒）
 * @param targetDateEnd 目标日期结束时间戳（毫秒）
 * @returns 是否匹配
 */
export function matchTargetDate(
  timestamp: number,
  targetDateStart: number,
  targetDateEnd: number
): boolean {
  // 方式1：区间匹配（timestamp 在目标日期范围内）
  const inRange = timestamp >= targetDateStart && timestamp <= targetDateEnd;
  
  // 方式2：日线点匹配（timestamp 等于目标日期的开始或结束点）
  // 很多 API 返回的是日线点（00:00:00 UTC），而不是区间内的任意点
  const isStartPoint = timestamp === targetDateStart;
  const isEndPoint = timestamp === targetDateEnd;
  
  // 方式3：日线点匹配（允许 ±1 秒的误差）
  const tolerance = 1000; // 1秒
  const nearStartPoint = Math.abs(timestamp - targetDateStart) <= tolerance;
  const nearEndPoint = Math.abs(timestamp - targetDateEnd) <= tolerance;
  
  return inRange || isStartPoint || isEndPoint || nearStartPoint || nearEndPoint;
}

/**
 * 获取数据的最新可用日期（UTC）
 * @param history 历史数据数组
 * @returns 最新可用日期的 UTC 时间戳（毫秒）和日期字符串（YYYY-MM-DD）
 */
export function getLatestAvailableDate(history: Array<{ timestamp: number }>): {
  timestamp: number;
  dateStr: string;
} | null {
  if (!history || history.length === 0) {
    return null;
  }
  
  // 找到最大时间戳
  const maxTimestamp = Math.max(...history.map(item => item.timestamp));
  
  // 转换为 UTC 日期字符串
  const date = new Date(maxTimestamp);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${day}`;
  
  return {
    timestamp: maxTimestamp,
    dateStr,
  };
}

/**
 * 获取 UTC+0 目标日期的时间范围（毫秒时间戳）
 * @param targetDate 目标日期（Date 对象，可选，默认昨日）
 * @returns { start: 目标日期00:00:00, end: 目标日期23:59:59.999 } (UTC时间戳，毫秒)
 */
export function getTargetDateUTCRange(targetDate?: Date): { start: number; end: number; dateStr: string } {
  const now = targetDate || new Date();
  
  // 获取当前UTC时间
  const utcYear = now.getUTCFullYear();
  const utcMonth = now.getUTCMonth();
  const utcDate = now.getUTCDate();
  
  // 计算目标日期（默认昨日）
  const target = new Date(Date.UTC(utcYear, utcMonth, utcDate - 1, 0, 0, 0, 0));
  const targetEnd = new Date(Date.UTC(utcYear, utcMonth, utcDate - 1, 23, 59, 59, 999));
  
  // 返回UTC时间戳（毫秒）
  const start = target.getTime();
  const end = targetEnd.getTime();
  const dateStr = target.toISOString().split('T')[0]; // YYYY-MM-DD
  
  return { start, end, dateStr };
}

/**
 * 检查数据是否可用（基于最新可用日期）
 * @param latestAvailableDate 最新可用日期（YYYY-MM-DD）
 * @param targetDate 目标日期（YYYY-MM-DD）
 * @returns 是否可用
 */
export function isDataAvailable(latestAvailableDate: string, targetDate: string): boolean {
  // 比较日期字符串（YYYY-MM-DD 格式可以直接比较）
  return latestAvailableDate >= targetDate;
}


