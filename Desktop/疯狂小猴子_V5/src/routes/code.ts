import { Bot, InlineKeyboard } from 'grammy';
import { EntitlementGuard } from '../guards/entitlement.guard';
import { isValidInviteCode } from '../utils/validator';
import { UserRepository } from '../repositories/user.repository';

export function registerCodeRoute(bot: Bot, guard: EntitlementGuard, userRepo: UserRepository) {
  // /code 和 /redeem 都指向同一个处理函数
  const handleCode = async (ctx: any) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    if (guard.isUnlocked(userId)) {
      await ctx.reply('✅ 您已解锁全部功能！');
      return;
    }

    await ctx.reply(
      '🎫 请输入邀请码：\n\n' +
      '输入邀请码后即可免费解锁全部功能\n\n' +
      '输入 /cancel 取消',
      {
        reply_markup: new InlineKeyboard().text('❌ 取消', 'cancel_code'),
      }
    );

    // 邀请码输入处理在 bot/index.ts 中统一处理
  };

  bot.command('code', handleCode);
  bot.command('redeem', handleCode);

  bot.callbackQuery('cancel_code', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('已取消');
  });
}

