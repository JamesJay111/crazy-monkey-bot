import { Context } from 'telegraf';
import { CoinGlassService } from '../services/coinglass.service';
import { DeepSeekService } from '../services/deepseek.service';
import { PaymentService } from '../payment/payment.service';
import { userStateManager } from '../state/user.state';
import { UserState } from '../types';

/**
 * Ticker 查询功能处理器
 */
export class TickerHandler {
  constructor(
    private coinglass: CoinGlassService,
    private deepseek: DeepSeekService,
    private payment: PaymentService
  ) {}

  /**
   * 请求用户输入 Ticker
   */
  async requestInput(ctx: Context): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) return;

    userStateManager.setUserState(userId, UserState.WAITING_TICKER_INPUT);

    await ctx.reply(
      `📊 查询指定 Ticker 合约\n\n` +
      `请输入 Ticker 符号（例如：BTC、ETH、SOL）\n\n` +
      `⚠️ 注意：\n` +
      `- 请输入 Ticker，不要输入项目全名\n` +
      `- 如果存在歧义，系统会询问确认\n\n` +
      `输入 /cancel 取消`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '❌ 取消',
                callback_data: 'cancel_ticker',
              },
            ],
          ],
        },
      }
    );
  }

  /**
   * 处理 Ticker 输入
   */
  async handleInput(ctx: Context, ticker: string): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) return;

    // 验证输入
    const cleanTicker = ticker.trim().toUpperCase();
    
    if (!cleanTicker || cleanTicker.length === 0) {
      await ctx.reply('❌ Ticker 不能为空，请重新输入');
      return;
    }

    // 检查是否已解锁
    if (!this.payment.isUnlocked(userId)) {
      await ctx.reply(this.payment.getUnlockMessage(), {
        reply_markup: this.payment.getUnlockKeyboard(),
      });
      userStateManager.setUserContext(userId, { pendingAction: 'ticker_query', ticker: cleanTicker });
      userStateManager.resetUserState(userId);
      return;
    }

    try {
      await ctx.reply(`📊 正在查询 ${cleanTicker} 的合约数据...`);

      // 获取 CoinGlass 数据
      const data = await this.coinglass.getTickerData(cleanTicker);

      // 调用 DeepSeek 分析
      const analysis = await this.deepseek.analyzeTickerStatus(data);

      // 格式化返回数据
      let message = `📈 ${cleanTicker} 合约状态\n\n`;
      message += `💰 当前价格: ${data.price ? `$${data.price.toLocaleString()}` : '数据不可用'}\n`;
      message += `📊 当前 OI: ${data.oi ? data.oi.toLocaleString() : '数据不可用'}\n`;
      message += `📈 24h OI 增量: ${data.oiChange24h ? (data.oiChange24h > 0 ? '+' : '') + data.oiChange24h.toLocaleString() : '数据不可用'}\n`;
      message += `💹 资金费率: ${data.fundingRate !== null ? (data.fundingRate * 100).toFixed(4) + '%' : '数据不可用'}\n`;
      message += `⚖️ 多空比: ${data.longShortRatio ? data.longShortRatio.toFixed(2) : '数据不可用'}\n`;
      message += `📊 多空账户比: ${data.longRate && data.shortRate ? `${(data.longRate * 100).toFixed(1)}% / ${(data.shortRate * 100).toFixed(1)}%` : '数据不可用'}\n`;
      message += `🏦 Binance Futures: ${data.isBinanceFutures ? '✅' : '❌'}\n\n`;
      message += `---\n\n`;
      message += `🤖 AI 分析：\n\n${analysis}\n\n`;
      message += `数据来源: CoinGlass API\n分析引擎: DeepSeek AI`;

      userStateManager.resetUserState(userId);

      await ctx.reply(message, {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🔄 重新查询',
                callback_data: 'ticker_query',
              },
            ],
            [
              {
                text: '🔙 返回主菜单',
                callback_data: 'main_menu',
              },
            ],
          ],
        },
      });
    } catch (error: any) {
      userStateManager.resetUserState(userId);
      await ctx.reply(`❌ 查询失败: ${error.message}\n\n请检查 Ticker 是否正确，或稍后重试。`);
    }
  }

  /**
   * 验证 Ticker 格式
   */
  private validateTicker(ticker: string): { valid: boolean; message?: string } {
    const clean = ticker.trim().toUpperCase();
    
    if (clean.length === 0) {
      return { valid: false, message: 'Ticker 不能为空' };
    }

    if (clean.length > 10) {
      return { valid: false, message: 'Ticker 长度过长，请检查输入' };
    }

    // 简单验证：只允许字母和数字
    if (!/^[A-Z0-9]+$/.test(clean)) {
      return { valid: false, message: 'Ticker 格式不正确，只能包含字母和数字' };
    }

    return { valid: true };
  }
}

