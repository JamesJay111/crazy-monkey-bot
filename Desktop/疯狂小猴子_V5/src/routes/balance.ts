import { Bot, InlineKeyboard } from 'grammy';
import { UserRepository } from '../repositories/user.repository';
import { EntitlementGuard } from '../guards/entitlement.guard';
import { logger } from '../utils/logger';

export function registerBalanceRoute(bot: Bot, userRepo: UserRepository, guard: EntitlementGuard) {
  bot.command('balance', async (ctx) => {
    const userId = ctx.from?.id;
    if (!userId) return;

    try {
      const user = userRepo.getUser(userId);
      if (!user) {
        await ctx.reply('❌ 用户信息不存在，请先发送 /start');
        return;
      }

      const isUnlocked = guard.isUnlocked(userId);
      
      let message = '📊 账户状态\n\n';
      
      if (isUnlocked) {
        message += '✅ 账户状态：已解锁\n';
        message += `🔓 解锁方式：${user.unlockMethod === 'stars' ? 'Telegram Stars' : '邀请码'}\n`;
        if (user.unlockTime) {
          const unlockDate = new Date(user.unlockTime);
          message += `📅 解锁时间：${unlockDate.toLocaleDateString('zh-CN')}\n`;
        }
        message += '\n💎 功能权限：\n';
        message += '• ✅ 全部功能已解锁\n';
        message += '• ✅ 无使用次数限制\n';
        message += '• ✅ 可查看历史数据\n';
        message += '• ✅ 可查看详细分析\n';
      } else {
        message += '🔒 账户状态：未解锁\n\n';
        message += '📊 可用功能：\n';
        message += '• ✅ 基础数据查询\n';
        message += '• ✅ ETF 最新数据\n';
        message += '• ✅ 资金费率扫描\n';
        message += '• ❌ 历史数据分析（需解锁）\n';
        message += '• ❌ 详细分析报告（需解锁）\n';
        message += '\n💡 解锁方式：\n';
        message += '• 2999 Telegram Stars（终身解锁）\n';
        message += '• 或输入邀请码免费体验\n';
      }

      const keyboard = new InlineKeyboard();
      
      if (!isUnlocked) {
        keyboard
          .text('💎 解锁全部功能', 'pay')
          .row()
          .text('🎫 输入邀请码', 'code');
      }
      
      keyboard.text('🔙 返回主菜单', 'main_menu');

      await ctx.reply(message, {
        reply_markup: keyboard,
      });
    } catch (error) {
      logger.error({ error, userId }, 'Failed to get balance');
      await ctx.reply('❌ 获取账户信息失败，请稍后重试');
    }
  });
}

