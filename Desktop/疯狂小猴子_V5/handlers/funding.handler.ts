import { Context } from 'telegraf';
import { CoinGlassService } from '../services/coinglass.service';
import { PaymentService } from '../payment/payment.service';

/**
 * 资金费率异常扫描功能处理器
 */
export class FundingHandler {
  constructor(
    private coinglass: CoinGlassService,
    private payment: PaymentService
  ) {}

  /**
   * 显示资金费率扫描菜单
   */
  async showMenu(ctx: Context): Promise<void> {
    const keyboard = {
      inline_keyboard: [
        [
          {
            text: '📈 正资金费率最高',
            callback_data: 'funding_positive',
          },
        ],
        [
          {
            text: '📉 负资金费率最高',
            callback_data: 'funding_negative',
          },
        ],
        [
          {
            text: '🔙 返回主菜单',
            callback_data: 'main_menu',
          },
        ],
      ],
    };

    await ctx.reply('📊 选择扫描类型：', { reply_markup: keyboard });
  }

  /**
   * 扫描资金费率异常
   */
  async scanAnomalies(ctx: Context, type: 'positive' | 'negative'): Promise<void> {
    try {
      const typeText = type === 'positive' ? '正资金费率最高' : '负资金费率最高';
      await ctx.reply(`🔍 正在扫描${typeText}的项目...`);

      const anomalies = await this.coinglass.scanFundingAnomalies(type, 10);

      if (anomalies.length === 0) {
        await ctx.reply('❌ 未找到符合条件的项目');
        return;
      }

      let message = `📊 ${typeText} Top 10\n\n`;
      message += `筛选条件：\n`;
      message += `- 市值排名前 5000\n`;
      message += `- 剔除极低流动性项目\n\n`;
      message += `结果：\n\n`;

      anomalies.forEach((item, index) => {
        const rate = parseFloat(item.fundingRatePercent);
        const emoji = rate > 0.1 ? '🔥' : rate > 0.05 ? '⚡' : '📊';
        message += `${index + 1}. ${emoji} ${item.symbol}: ${rate > 0 ? '+' : ''}${item.fundingRatePercent}%\n`;
      });

      message += `\n数据来源: CoinGlass API`;

      await ctx.reply(message, {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🔄 重新扫描',
                callback_data: `funding_${type}`,
              },
            ],
            [
              {
                text: '🔙 返回',
                callback_data: 'funding_menu',
              },
            ],
          ],
        },
      });
    } catch (error: any) {
      await ctx.reply(`❌ 扫描失败: ${error.message}`);
    }
  }
}

