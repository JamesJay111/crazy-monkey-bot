/**
 * Notifier 基类接口
 */

import { OIAlertEvent, NotificationResult } from '../types';

/**
 * Notifier 接口
 */
export interface INotifier {
  /**
   * 发送事件通知
   */
  send(event: OIAlertEvent): Promise<NotificationResult>;

  /**
   * Notifier 名称
   */
  getName(): string;
}

