import { Bot, InlineKeyboard } from 'grammy';
import { logger } from '../utils/logger';

const START_MESSAGE = `你正在使用一个 「合约行为感知」工具

这个 Bot 不预测价格，也不喊单
它只做一件事：
通过合约数据的变化，判断「市场结构是否正在发生变化」

你可以用它来：

发现是否正在发生 庄家轧空 / 多空挤压
1️⃣ 发现是否正在发生 庄家轧空 / 多空挤压
2️⃣ 查看 ETF 的真实资金流向
3️⃣ 扫描 资金费率异常 的合约
4️⃣ 查询某个合约的 真实交易状态

适合人群：
1️⃣ 合约交易者
2️⃣ 关注 OI / 资金费率 / 基差 的人
3️⃣ 不想只靠 K 线 做判断的人

▶ 使用方式

点击下方按钮开始

💳 付费说明

2999 Stars：终身解锁全部功能
或 Twitter 私信 @Ocean_Jackon 获取邀请码免费体验

———
由 Ocean 开发 | 湄南河畔`;

export function registerStartRoute(bot: Bot) {
  bot.command('start', async (ctx) => {
    const userId = ctx.from?.id;
    const username = ctx.from?.username;
    
    logger.info({ userId, username }, '收到 /start 命令');
    
    try {
      const keyboard = new InlineKeyboard()
        .text('🔍 庄家轧空/多空挤压', 'squeeze')
        .row()
        .text('📊 ETF 流入流出', 'etf')
        .row()
        .text('💹 资金费率扫描', 'funding')
        .row()
        .text('🔎 合约查询（Ticker）', 'contract')
        .row()
        .text('📡 结构订阅', 'subscription');

      await ctx.reply(START_MESSAGE, {
        reply_markup: keyboard,
      });
      
      logger.info({ userId }, '✅ /start 命令处理成功');
    } catch (error) {
      logger.error({ error, userId }, '❌ /start 命令处理失败');
      await ctx.reply('❌ 发生错误，请稍后重试或联系管理员').catch(() => {});
    }
  });

  // 主菜单按钮回调
  bot.callbackQuery('main_menu', async (ctx) => {
    await ctx.answerCallbackQuery();
    const keyboard = new InlineKeyboard()
      .text('🔍 庄家轧空/多空挤压', 'squeeze')
      .row()
      .text('📊 ETF 流入流出', 'etf')
      .row()
      .text('💹 资金费率扫描', 'funding')
      .row()
      .text('🔎 合约查询（Ticker）', 'contract')
      .row()
      .text('📡 结构订阅', 'subscription');

    await ctx.editMessageText(START_MESSAGE, {
      reply_markup: keyboard,
    });
  });
}
