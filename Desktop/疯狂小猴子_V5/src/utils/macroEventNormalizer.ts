/**
 * 宏观事件数据标准化工具
 */

import * as crypto from 'crypto';
import { CoinGlassMacroEvent, EventDTO } from '../types/macroEvent';

/**
 * 国家代码映射（兼容不同格式）
 */
const COUNTRY_CODE_MAP: Record<string, string> = {
  'US': 'USA',
  'UNITED_STATES': 'USA',
  'United States': 'USA',
  'USA': 'USA',
};

/**
 * 标准化国家代码
 */
function normalizeCountryCode(code: string): string {
  const upper = code.toUpperCase().trim();
  return COUNTRY_CODE_MAP[upper] || upper;
}

/**
 * 生成事件唯一键（用于去重）
 * SHA1(country_code + '|' + calendar_name + '|' + publish_timestamp)
 */
function generateEventKey(
  countryCode: string,
  calendarName: string,
  publishTimestamp: number
): string {
  const input = `${countryCode}|${calendarName}|${publishTimestamp}`;
  return crypto.createHash('sha1').update(input).digest('hex');
}

/**
 * 统一时间戳为毫秒
 * 如果 timestamp < 1e12，认为是秒级，否则认为是毫秒级
 */
function normalizeTimestamp(timestamp: number): number {
  // 如果小于 1e12（2001-09-09 的时间戳），认为是秒级
  if (timestamp < 1e12) {
    return timestamp * 1000;
  }
  return timestamp;
}

/**
 * 判断事件状态
 */
function determineStatus(event: CoinGlassMacroEvent): 'UPCOMING' | 'RELEASED' {
  // published_value 非空且不为空字符串 => RELEASED
  if (event.published_value && event.published_value.trim() !== '') {
    return 'RELEASED';
  }
  return 'UPCOMING';
}

/**
 * 标准化事件数据
 */
export function normalizeEvent(event: CoinGlassMacroEvent): EventDTO {
  const normalizedCountryCode = normalizeCountryCode(event.country_code);
  const normalizedTimestamp = normalizeTimestamp(event.publish_timestamp);
  const eventKey = generateEventKey(
    normalizedCountryCode,
    event.calendar_name,
    normalizedTimestamp
  );
  const status = determineStatus(event);

  return {
    event_key: eventKey,
    calendar_name: event.calendar_name,
    country_code: normalizedCountryCode,
    country_name: event.country_name,
    publish_time_utc_ms: normalizedTimestamp,
    importance_level: event.importance_level,
    has_exact_publish_time: event.has_exact_publish_time,
    forecast_value: event.forecast_value,
    previous_value: event.previous_value,
    published_value: event.published_value,
    revised_previous_value: event.revised_previous_value,
    data_effect: event.data_effect,
    status,
  };
}

/**
 * 批量标准化事件
 */
export function normalizeEvents(events: CoinGlassMacroEvent[]): EventDTO[] {
  return events.map(normalizeEvent);
}

