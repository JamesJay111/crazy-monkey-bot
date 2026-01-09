/**
 * Lark Incoming Webhook 推送服务（支持自定义 URL）
 * 用于发送消息到指定的 Lark Webhook
 */

import axios from 'axios';
import { logger } from '../utils/logger';

/**
 * Lark Webhook 推送服务（支持自定义 URL）
 */
export class LarkWebhookCustomService {
  private webhookUrl: string;

  constructor(webhookUrl: string) {
    this.webhookUrl = webhookUrl;
  }

  /**
   * 发送文本消息到 Lark Webhook
   * @param text 消息文本
   * @returns 是否发送成功
   */
  async sendText(text: string): Promise<boolean> {
    try {
      const payload = {
        msg_type: 'text',
        content: {
          text: text,
        },
      };

      const response = await axios.post(this.webhookUrl, payload, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 10000, // 10秒超时
      });

      if (response.status === 200) {
        logger.info({ textLength: text.length, webhookUrl: this.maskWebhookUrl() }, 'Lark webhook message sent successfully');
        return true;
      } else {
        logger.warn({ status: response.status, statusText: response.statusText, webhookUrl: this.maskWebhookUrl() }, 'Lark webhook returned non-200 status');
        return false;
      }
    } catch (error) {
      // 只记录错误，不抛出异常，不影响主流程
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMsg, webhookUrl: this.maskWebhookUrl() }, 'Failed to send message to Lark webhook');
      return false;
    }
  }

  /**
   * 脱敏 Webhook URL（用于日志）
   */
  private maskWebhookUrl(): string {
    if (!this.webhookUrl) return 'N/A';
    const parts = this.webhookUrl.split('/');
    if (parts.length > 0) {
      const lastPart = parts[parts.length - 1];
      return `.../${lastPart.substring(0, 8)}...`;
    }
    return '...';
  }
}

