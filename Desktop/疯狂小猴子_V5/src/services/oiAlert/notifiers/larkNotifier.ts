/**
 * LarkNotifier - Lark Webhook 推送
 */

import { logger } from '../../../utils/logger';
import { LarkWebhookCustomService } from '../../../services/larkWebhookCustom.service';
import { DeepSeekClient } from '../../../clients/deepseek.client';
import { OIAlertEvent, NotificationResult } from '../types';
import { INotifier } from './base';
import { env } from '../../../config/env';

export class LarkNotifier implements INotifier {
  private larkWebhook: LarkWebhookCustomService;
  private deepseek: DeepSeekClient;

  constructor(
    webhookUrl: string,
    deepseek: DeepSeekClient
  ) {
    this.larkWebhook = new LarkWebhookCustomService(webhookUrl);
    this.deepseek = deepseek;
  }

  getName(): string {
    return 'Lark';
  }

  /**
   * 发送到 Lark Webhook
   */
  async send(event: OIAlertEvent): Promise<NotificationResult> {
    try {
      // 生成 DeepSeek 解读
      const interpretation = await this.generateInterpretation(event);

      // 格式化消息（保持现有样式）
      const message = this.formatMessage(event, interpretation);

      // 发送
      const success = await this.larkWebhook.sendText(message);

      if (success) {
        logger.info({
          eventId: event.eventId,
          symbol: event.symbol,
          channel: 'lark',
        }, 'Lark notification sent successfully');

        return {
          channel: 'lark',
          success: true,
          eventId: event.eventId,
        };
      } else {
        return {
          channel: 'lark',
          success: false,
          eventId: event.eventId,
          error: 'Failed to send to Lark webhook',
        };
      }
    } catch (error: any) {
      logger.error({
        error: error.message,
        eventId: event.eventId,
        symbol: event.symbol,
      }, 'Failed to send Lark notification');

      return {
        channel: 'lark',
        success: false,
        eventId: event.eventId,
        error: error.message,
      };
    }
  }

  /**
   * 生成 DeepSeek 解读
   */
  private async generateInterpretation(event: OIAlertEvent): Promise<string> {
    try {
      const oiChangeStr = event.oiChangePct !== null && event.oiChangePct !== undefined
        ? (event.oiChangePct >= 0 ? '+' : '') + event.oiChangePct.toFixed(2)
        : '—';
      const priceChange1hStr = event.priceChange1hPct !== null && event.priceChange1hPct !== undefined
        ? (event.priceChange1hPct >= 0 ? '+' : '') + event.priceChange1hPct.toFixed(2)
        : '—';
      const priceChange24hStr = event.priceChange24hPct !== null && event.priceChange24hPct !== undefined
        ? (event.priceChange24hPct >= 0 ? '+' : '') + event.priceChange24hPct.toFixed(2)
        : '—';
      const oiUsdStr = event.oiUsd !== null && event.oiUsd !== undefined
        ? (event.oiUsd / 1_000_000).toFixed(1)
        : '—';
      const oiMcPercentStr = event.oiMcPercent !== null && event.oiMcPercent !== undefined
        ? event.oiMcPercent.toFixed(2)
        : '—';
      const marketCapStr = event.marketCapUsd !== null && event.marketCapUsd !== undefined
        ? (event.marketCapUsd / 1_000_000).toFixed(1)
        : '—';
      
      // 构建 prompt（已删除市值相关信息）
      let prompt = `币安合约 ${event.symbol} 未平仓合约变化 ${oiChangeStr}%，价格过去1小时变化 ${priceChange1hStr}%，未平仓合约：${oiUsdStr}M 美元`;
      
      if (priceChange24hStr !== '—') {
        prompt += `，24小时价格变化：${priceChange24hStr}%`;
      }
      
      prompt += `。\n\n请生成一段专业的市场解读（30-50字），分析 OI 变化与价格走势的关系，市场情绪，以及需要关注的风险点。`;

      const response = await this.deepseek.chat([
        { role: 'user', content: prompt }
      ]);

      // DeepSeek.chat() 传入 messages 数组时返回 DeepSeekResponse 对象，需要提取 content
      if (typeof response === 'string') {
        return response || '市场异动，请关注';
      } else if (response && typeof response === 'object' && 'content' in response) {
        return (response as any).content || '市场异动，请关注';
      } else {
        return String(response) || '市场异动，请关注';
      }
    } catch (error) {
      logger.warn({ error, symbol: event.symbol }, 'Failed to generate DeepSeek interpretation, using fallback');
      return '市场异动，请关注';
    }
  }

  /**
   * 格式化消息（按照用户要求的模板格式）
   */
  private formatMessage(event: OIAlertEvent, interpretation: string): string {
    const icon = event.direction === 'up' ? '🟢' : event.direction === 'down' ? '🔴' : '⚪';
    
    // OI 变化
    const oiChangeStr = event.oiChangePct !== null && event.oiChangePct !== undefined
      ? (event.oiChangePct >= 0 ? '+' : '') + event.oiChangePct.toFixed(2)
      : '—';
    
    // 价格过去1小时变化
    const priceChange1hStr = event.priceChange1hPct !== null && event.priceChange1hPct !== undefined
      ? (event.priceChange1hPct >= 0 ? '+' : '') + event.priceChange1hPct.toFixed(2)
      : '—';
    
    // 未平仓合约
    const oiNowM = event.oiUsd !== null && event.oiUsd !== undefined
      ? (event.oiUsd / 1_000_000).toFixed(1)
      : '—';
    
    // 未平仓合约/市值比率
    const oiMcPercentStr = event.oiMcPercent !== null && event.oiMcPercent !== undefined
      ? event.oiMcPercent.toFixed(2)
      : '—';
    
    // 24小时价格变化
    const priceChange24hStr = event.priceChange24hPct !== null && event.priceChange24hPct !== undefined
      ? (event.priceChange24hPct >= 0 ? '+' : '') + event.priceChange24hPct.toFixed(2)
      : '—';
    
    // 市值
    const marketCapM = event.marketCapUsd !== null && event.marketCapUsd !== undefined
      ? (event.marketCapUsd / 1_000_000).toFixed(1)
      : '—';

    // 按照用户要求的模板格式（删除市值和 OI/MC 比率显示）
    const intervalText = event.interval === '4h' ? '4小时' : '24小时';
    let message = `${icon} ${event.symbol} ${intervalText}币安未平仓合约变化 ${oiChangeStr}%，价格过去${intervalText}变化 ${event.priceChangePct !== null && event.priceChangePct !== undefined ? (event.priceChangePct >= 0 ? '+' : '') + event.priceChangePct.toFixed(2) : '—'}%，未平仓合约：${oiNowM}M 美元`;
    
    // 只在有数据时显示 24h 价格变化
    if (priceChange24hStr !== '—') {
      message += `，24小时价格变化：${priceChange24hStr}%`;
    }
    message += '\n\n';
    
    // 解读部分
    message += `解读：${interpretation}\n\n`;
    
    // 备注部分
    message += `备注：如果是未平仓合约是下降的 icon 是 🔴，上升的是 🟢`;

    return message;
  }
}

