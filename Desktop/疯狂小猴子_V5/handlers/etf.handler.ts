import { Context } from 'telegraf';
import { CoinGlassService } from '../services/coinglass.service';
import { DeepSeekService } from '../services/deepseek.service';
import { PaymentService } from '../payment/payment.service';
import { userStateManager } from '../state/user.state';

/**
 * ETF 资金流功能处理器
 */
export class ETFHandler {
  constructor(
    private coinglass: CoinGlassService,
    private deepseek: DeepSeekService,
    private payment: PaymentService
  ) {}

  /**
   * 显示 ETF 选择菜单
   */
  async showMenu(ctx: Context): Promise<void> {
    const keyboard = {
      inline_keyboard: [
        [
          { text: '₿ BTC', callback_data: 'etf_btc' },
          { text: 'Ξ ETH', callback_data: 'etf_eth' },
        ],
        [
          { text: '◎ SOL', callback_data: 'etf_sol' },
        ],
        [
          { text: '🔙 返回主菜单', callback_data: 'main_menu' },
        ],
      ],
    };

    await ctx.reply('📊 选择要查看的 ETF：', { reply_markup: keyboard });
  }

  /**
   * 显示 ETF 数据
   */
  async showData(ctx: Context, symbol: 'BTC' | 'ETH' | 'SOL'): Promise<void> {
    try {
      await ctx.reply(`📊 正在获取 ${symbol} ETF 数据...`);

      const data = await this.coinglass.getETFData(symbol);

      if (!data) {
        await ctx.reply(`❌ 无法获取 ${symbol} 的 ETF 数据`);
        return;
      }

      const netFlow24h = data.netFlow24h || 0;
      const totalAssets = data.totalAssets || 0;

      let message = `📊 ${symbol} ETF 资金流\n\n`;
      message += `💰 24小时净流入: ${netFlow24h > 0 ? '+' : ''}${netFlow24h.toLocaleString()} USD\n`;
      message += `💎 总资产: ${totalAssets.toLocaleString()} USD\n\n`;
      message += `数据来源: CoinGlass API`;

      const keyboard = {
        inline_keyboard: [
          [
            {
              text: '📈 查看过去 30 天历史',
              callback_data: `etf_history_${symbol}`,
            },
          ],
          [
            {
              text: '🔙 返回',
              callback_data: 'etf_menu',
            },
          ],
        ],
      };

      await ctx.reply(message, { reply_markup: keyboard });
    } catch (error: any) {
      await ctx.reply(`❌ 错误: ${error.message}`);
    }
  }

  /**
   * 显示 ETF 历史数据（需要解锁）
   */
  async showHistory(ctx: Context, symbol: 'BTC' | 'ETH' | 'SOL'): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) return;

    if (!this.payment.isUnlocked(userId)) {
      await ctx.reply(this.payment.getUnlockMessage(), {
        reply_markup: this.payment.getUnlockKeyboard(),
      });
      userStateManager.setUserContext(userId, { pendingAction: 'etf_history', symbol });
      return;
    }

    try {
      await ctx.reply(`📊 正在获取 ${symbol} ETF 历史数据...`);

      const history = await this.coinglass.getETFHistory(symbol, 30);

      if (!history || history.length === 0) {
        await ctx.reply(`❌ 无法获取 ${symbol} 的 ETF 历史数据`);
        return;
      }

      // 使用 DeepSeek 分析历史数据
      const analysis = await this.deepseek.analyzeETF({
        symbol,
        history,
      });

      let message = `📈 ${symbol} ETF 过去 30 天资金流分析\n\n`;
      message += analysis;
      message += `\n\n数据来源: CoinGlass API\n分析引擎: DeepSeek AI`;

      await ctx.reply(message, {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🔙 返回',
                callback_data: `etf_${symbol.toLowerCase()}`,
              },
            ],
          ],
        },
      });
    } catch (error: any) {
      await ctx.reply(`❌ 错误: ${error.message}`);
    }
  }
}

