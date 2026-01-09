import { Bot, InlineKeyboard } from 'grammy';
import { EntitlementGuard } from '../guards/entitlement.guard';

const PAY_MESSAGE = `💳 付费说明

解锁全部功能需要 2999 Telegram Stars

解锁后可使用：
✅ 轧空结构详细分析
✅ ETF 30 天历史数据
✅ 合约完整状态查询 + AI 分析
✅ 当前市场结构检测

或输入邀请码免费体验：
输入 /code 或点击下方按钮`;

export function registerPayRoute(bot: Bot, guard: EntitlementGuard) {
  // /pay 和 /pricing 都指向同一个处理函数
  const handlePay = async (ctx: any) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    if (guard.isUnlocked(userId)) {
      await ctx.reply('✅ 您已解锁全部功能！');
      return;
    }

    const keyboard = new InlineKeyboard()
      .text('💎 支付 2999 Stars', 'pay_stars')
      .row()
      .text('🎫 输入邀请码', 'code')
      .row()
      .text('🔙 返回主菜单', 'main_menu');

    await ctx.reply(PAY_MESSAGE, {
      reply_markup: keyboard,
    });
  };

  bot.command('pay', handlePay);
  bot.command('pricing', handlePay);

  bot.callbackQuery('pay_stars', async (ctx) => {
    await ctx.answerCallbackQuery();
    // 发送支付发票
    // 注意：Telegram Stars 支付需要配置支付提供者
    // 这里先提示用户手动支付或使用邀请码
    await ctx.reply(
      '💎 Telegram Stars 支付功能需要配置支付提供者\n\n' +
      '当前可以使用邀请码免费解锁：\n' +
      '输入 /code 或发送邀请码：Ocean001',
      {
        reply_markup: new InlineKeyboard()
          .text('🎫 使用邀请码', 'code')
          .row()
          .text('🔙 返回', 'pay'),
      }
    );
  });
}
