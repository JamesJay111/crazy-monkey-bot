/**
 * OI 异动扫描系统 - 类型定义
 */

/**
 * 扫描结果
 */
export interface ScanResult {
  symbol: string;
  oiUsd: number | null;
  oiChange4hPercent: number | null;
  oiChange24hPercent: number | null;
  priceChange1hPercent: number | null; // 新增：1小时价格变化
  priceChange4hPercent: number | null;
  priceChange24hPercent: number | null;
  marketCapUsd: number | null;
  oiMcPercent: number | null;
  direction: 'up' | 'down' | 'unknown';
  timestamp: number; // 检测时间戳（毫秒）
  raw?: any; // 原始数据
  errorType?: 'rate_limit' | 'no_data' | 'fatal_error' | null;
  errorMessage?: string;
}

/**
 * 标准化事件对象（用于多渠道推送）
 */
export interface OIAlertEvent {
  eventId: string; // 用于去重：hash(symbol + interval + direction + floor(detectedAt/cooldownWindow))
  symbol: string;
  market: string; // 例如 "BinanceFutures"
  interval: '4h' | '24h';
  oiUsd: number | null;
  oiChangePct: number | null;
  direction: 'up' | 'down' | 'unknown';
  detectedAt: string; // ISO 时间戳
  priceChange1hPct: number | null; // 新增：1小时价格变化
  priceChangePct: number | null; // 4h 或 24h 价格变化
  priceChange24hPct: number | null; // 新增：24小时价格变化
  marketCapUsd: number | null;
  oiMcPercent: number | null;
  meta?: Record<string, any>; // 额外元数据
}

/**
 * 候选池记录
 */
export interface CandidateRecord {
  key: string; // symbol + interval
  symbol: string;
  interval: '4h' | '24h';
  firstDetectedAt: number; // 首次检测到满足阈值的时间
  lastCheckedAt: number; // 最后检查时间
  lastKnownChange: number; // 最后已知的变化百分比
  status: 'candidate' | 'confirmed_sent' | 'dropped';
  retryPendingCount: number; // 限流重试次数
  lastErrorType: 'rate_limit' | 'no_data' | 'fatal_error' | null;
  direction: 'up' | 'down' | 'unknown';
}

/**
 * 扫描统计
 */
export interface ScanStats {
  totalTickers: number;
  successCount: number;
  noDataCount: number;
  rateLimitCount: number;
  fatalErrorCount: number;
  candidateCount: number;
  confirmedCount: number;
  droppedCount: number;
}

/**
 * 推送结果
 */
export interface NotificationResult {
  channel: 'lark' | 'twitter';
  success: boolean;
  eventId: string;
  error?: string;
  tweetId?: string; // Twitter 推文 ID
  url?: string; // Twitter 推文 URL
}

