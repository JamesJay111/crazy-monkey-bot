/**
 * Lark Incoming Webhook 推送服务
 * 仅用于发送消息到指定的 Lark Webhook，不影响其他推送逻辑
 */

import axios from 'axios';
import { logger } from '../utils/logger';

/**
 * Lark Webhook 配置（写死，仅此一个生效）
 */
const LARK_WEBHOOK_URL = 'https://open.larksuite.com/open-apis/bot/v2/hook/f182517d-8c87-4a09-adc9-be40730b0506';

/**
 * Lark Webhook 推送服务
 */
export class LarkWebhookService {
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

      const response = await axios.post(LARK_WEBHOOK_URL, payload, {
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: 10000, // 10秒超时
      });

      if (response.status === 200) {
        logger.info({ textLength: text.length }, 'Lark webhook message sent successfully');
        return true;
      } else {
        logger.warn({ status: response.status, statusText: response.statusText }, 'Lark webhook returned non-200 status');
        return false;
      }
    } catch (error) {
      // 只记录错误，不抛出异常，不影响主流程
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error({ error: errorMsg }, 'Failed to send message to Lark webhook');
      return false;
    }
  }
}

