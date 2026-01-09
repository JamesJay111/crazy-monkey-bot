import { Bot, InlineKeyboard } from 'grammy';
import { SubscriptionService } from '../services/subscriptionService.service';
import { strategyChannelEngine } from '../services/strategyChannelEngine.service';
import { logger } from '../utils/logger';

/**
 * 注册订阅管理路由
 */
export function registerSubscriptionRoute(
  bot: Bot,
  subscriptionService: SubscriptionService
) {
  // 📡 结构订阅 命令/按钮
  bot.command('subscription', async (ctx) => {
    await handleSubscriptionMenu(ctx, subscriptionService);
  });

  bot.callbackQuery('subscription', async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleSubscriptionMenu(ctx, subscriptionService);
  });

  // 切换频道订阅状态
  bot.callbackQuery(/^sub_toggle_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const channelId = ctx.match[1];
    const userId = ctx.from?.id;
    
    if (!userId) return;

    try {
      const isSubscribed = subscriptionService.toggleChannel(userId, channelId);
      const channelName = strategyChannelEngine.getChannelDisplayName(channelId);
      
      if (isSubscribed) {
        await ctx.answerCallbackQuery(`✅ 已开启：${channelName}`);
      } else {
        await ctx.answerCallbackQuery(`❌ 已关闭：${channelName}`);
      }
      
      // 刷新菜单
      await handleSubscriptionMenu(ctx, subscriptionService);
    } catch (error) {
      logger.error({ error, userId, channelId }, 'Failed to toggle channel subscription');
      await ctx.answerCallbackQuery('❌ 操作失败，请稍后重试');
    }
  });
}

/**
 * 处理订阅菜单（G6.1）
 */
async function handleSubscriptionMenu(ctx: any, subscriptionService: SubscriptionService) {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    // 获取用户当前订阅
    const userChannels = subscriptionService.getUserSubscriptions(userId);
    
    // 获取所有可用频道
    const allChannels = strategyChannelEngine.getAllChannels();

    // 构建消息
    let message = `📡 结构订阅\n\n`;
    message += `请选择你关注的结构主题（可多选）：\n\n`;

    // 显示频道列表，标记已订阅的
    allChannels.forEach(channel => {
      const isSubscribed = userChannels.includes(channel.id);
      const status = isSubscribed ? '✅' : '☐';
      message += `${status} ${channel.displayName}\n`;
      message += `   ${channel.description}\n\n`;
    });

    if (userChannels.length === 0) {
      message += `💡 提示：订阅后，当结构信号命中对应频道时，你将收到推送通知。`;
    } else {
      message += `\n当前已订阅：${userChannels.map(id => strategyChannelEngine.getChannelDisplayName(id)).join('、')}`;
    }

    // 构建 Inline Keyboard
    const keyboard = new InlineKeyboard();
    
    // 每个频道一行按钮
    allChannels.forEach((channel, index) => {
      const isSubscribed = userChannels.includes(channel.id);
      const buttonText = `${isSubscribed ? '✅' : '☐'} ${channel.displayName}`;
      
      if (index % 2 === 0) {
        keyboard.text(buttonText, `sub_toggle_${channel.id}`);
      } else {
        keyboard.text(buttonText, `sub_toggle_${channel.id}`).row();
      }
    });

    keyboard.row().text('🔙 返回主菜单', 'main_menu');

    await ctx.reply(message, { reply_markup: keyboard });
  } catch (error) {
    logger.error({ error, userId }, 'Failed to show subscription menu');
    await ctx.reply('❌ 加载订阅设置失败，请稍后重试', {
      reply_markup: new InlineKeyboard().text('🔙 返回主菜单', 'main_menu'),
    });
  }
}

