/**
 * CoinGlass 宏观事件相关类型定义
 */

/**
 * CoinGlass API 返回的原始事件数据
 */
export interface CoinGlassMacroEvent {
  calendar_name: string;
  country_code: string;
  country_name?: string;
  publish_timestamp: number; // 可能是秒或毫秒
  importance_level: number; // 1/2/3
  has_exact_publish_time: number; // 1/2
  forecast_value?: string;
  previous_value?: string;
  published_value?: string; // 可能为空（未公布）
  revised_previous_value?: string;
  data_effect?: string;
}

/**
 * CoinGlass API 响应结构
 */
export interface CoinGlassMacroEventResponse {
  code: string;
  data: CoinGlassMacroEvent[];
}

/**
 * 统一事件模型（Normalized）
 */
export interface EventDTO {
  event_key: string; // SHA1(country_code + '|' + calendar_name + '|' + publish_timestamp)
  calendar_name: string;
  country_code: string;
  country_name?: string;
  publish_time_utc_ms: number; // 统一成毫秒
  importance_level: number; // 1/2/3
  has_exact_publish_time: number; // 1/2
  forecast_value?: string;
  previous_value?: string;
  published_value?: string;
  revised_previous_value?: string;
  data_effect?: string;
  status: 'UPCOMING' | 'RELEASED'; // published_value 非空 => RELEASED
}

/**
 * 推文发布状态
 */
export type TweetStatus = 'sent' | 'failed';

/**
 * 推送日志记录
 */
export interface MacroEventPushLog {
  event_key: string;
  calendar_name: string;
  publish_time_utc_ms: number;
  importance_level: number;
  status: 'UPCOMING' | 'RELEASED';
  sent_at_utc_ms: number;
  tw_a_status: TweetStatus | null;
  tw_b_status: TweetStatus | null;
  tw_c_status: TweetStatus | null;
  tw_a_tweet_id: string | null;
  tw_b_tweet_id: string | null;
  tw_c_tweet_id: string | null;
  last_error: string | null;
}

