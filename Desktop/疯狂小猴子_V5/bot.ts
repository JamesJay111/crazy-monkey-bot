import { Telegraf, Context, Markup } from 'telegraf';
import * as dotenv from 'dotenv';
import { CoinGlassService } from './services/coinglass.service';
import { DeepSeekService } from './services/deepseek.service';
import { PaymentService } from './payment/payment.service';
import { userStateManager } from './state/user.state';
import { UserState } from './types';
import { ShortSqueezeHandler } from './handlers/short-squeeze.handler';
import { ETFHandler } from './handlers/etf.handler';
import { FundingHandler } from './handlers/funding.handler';
import { TickerHandler } from './handlers/ticker.handler';

// 加载环境变量
dotenv.config();

// 验证必要的环境变量
const requiredEnvVars = [
  'TELEGRAM_BOT_TOKEN',
  'DEEPSEEK_API_KEY',
  'COINGLASS_API_KEY',
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    console.error(`❌ 缺少必要的环境变量: ${envVar}`);
    process.exit(1);
  }
}

// 初始化服务
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!);
const coinglass = new CoinGlassService(process.env.COINGLASS_API_KEY!);
const deepseek = new DeepSeekService(
  process.env.DEEPSEEK_API_KEY!,
  process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions'
);
const payment = new PaymentService(
  parseInt(process.env.PAYMENT_STARS_AMOUNT || '2999'),
  process.env.INVITE_CODE || 'Ocean001'
);

// 初始化处理器
const shortSqueezeHandler = new ShortSqueezeHandler(coinglass, deepseek, payment);
const etfHandler = new ETFHandler(coinglass, deepseek, payment);
const fundingHandler = new FundingHandler(coinglass, payment);
const tickerHandler = new TickerHandler(coinglass, deepseek, payment);

/**
 * 显示主菜单
 */
function showMainMenu(ctx: Context) {
  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('🔍 庄家是否在轧空？', 'short_squeeze'),
    ],
    [
      Markup.button.callback('📊 ETF 资金流入 / 流出', 'etf'),
    ],
    [
      Markup.button.callback('💹 资金费率异常扫描', 'funding'),
    ],
    [
      Markup.button.callback('🔎 查询指定 Ticker 合约', 'ticker'),
    ],
  ]);

  return ctx.reply('📱 主菜单', { reply_markup: keyboard.reply_markup });
}

/**
 * /start 命令 - 开场白
 */
bot.command('start', async (ctx) => {
  const welcomeMessage = `你正在使用一个「合约行为感知」工具

这个 Bot 不预测价格，也不喊单

它做的事情只有一件：
通过合约数据的变化，判断"市场结构是否正在发生变化"

你可以用它来：

发现是否正在发生「庄家轧空 / 多空挤压」

查看 ETF 的真实资金流向

快速扫描资金费率异常的项目

查询某个具体合约的真实交易状态

适合人群：

合约交易者

关注 OI / 资金费率 / 基差的人

不想只靠 K 线做判断的人

使用方式：
👉 点击下方按钮开始

付费说明：

2999 Stars：终身解锁全部功能

或 Twitter 私信 @Ocean_Jackon 获取邀请码免费体验

———
由 Ocean 开发 | 湄南河畔`;

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('👉 开始使用', 'main_menu')],
  ]);

  await ctx.reply(welcomeMessage, { reply_markup: keyboard.reply_markup });
});

/**
 * /cancel 命令 - 取消当前操作
 */
bot.command('cancel', async (ctx) => {
  const userId = ctx.from?.id;
  if (userId) {
    userStateManager.resetUserState(userId);
  }
  await ctx.reply('✅ 已取消', { reply_markup: { remove_keyboard: true } });
  await showMainMenu(ctx);
});

/**
 * 主菜单回调
 */
bot.action('main_menu', async (ctx) => {
  await ctx.answerCbQuery();
  await showMainMenu(ctx);
});

/**
 * 功能一：庄家轧空判断
 */
bot.action('short_squeeze', async (ctx) => {
  await ctx.answerCbQuery();
  await shortSqueezeHandler.showCandidates(ctx);
});

bot.action(/^squeeze_detail_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const symbol = ctx.match[1];
  await shortSqueezeHandler.showDetail(ctx, symbol);
});

bot.action('squeeze_list', async (ctx) => {
  await ctx.answerCbQuery();
  await shortSqueezeHandler.showCandidates(ctx);
});

bot.action('squeeze_current', async (ctx) => {
  await ctx.answerCbQuery();
  await shortSqueezeHandler.checkCurrent(ctx);
});

/**
 * 功能二：ETF 资金流
 */
bot.action('etf', async (ctx) => {
  await ctx.answerCbQuery();
  await etfHandler.showMenu(ctx);
});

bot.action('etf_menu', async (ctx) => {
  await ctx.answerCbQuery();
  await etfHandler.showMenu(ctx);
});

bot.action('etf_btc', async (ctx) => {
  await ctx.answerCbQuery();
  await etfHandler.showData(ctx, 'BTC');
});

bot.action('etf_eth', async (ctx) => {
  await ctx.answerCbQuery();
  await etfHandler.showData(ctx, 'ETH');
});

bot.action('etf_sol', async (ctx) => {
  await ctx.answerCbQuery();
  await etfHandler.showData(ctx, 'SOL');
});

bot.action(/^etf_history_(BTC|ETH|SOL)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const symbol = ctx.match[1] as 'BTC' | 'ETH' | 'SOL';
  await etfHandler.showHistory(ctx, symbol);
});

/**
 * 功能三：资金费率异常扫描
 */
bot.action('funding', async (ctx) => {
  await ctx.answerCbQuery();
  await fundingHandler.showMenu(ctx);
});

bot.action('funding_menu', async (ctx) => {
  await ctx.answerCbQuery();
  await fundingHandler.showMenu(ctx);
});

bot.action('funding_positive', async (ctx) => {
  await ctx.answerCbQuery();
  await fundingHandler.scanAnomalies(ctx, 'positive');
});

bot.action('funding_negative', async (ctx) => {
  await ctx.answerCbQuery();
  await fundingHandler.scanAnomalies(ctx, 'negative');
});

/**
 * 功能四：查询指定 Ticker
 */
bot.action('ticker', async (ctx) => {
  await ctx.answerCbQuery();
  await tickerHandler.requestInput(ctx);
});

bot.action('ticker_query', async (ctx) => {
  await ctx.answerCbQuery();
  await tickerHandler.requestInput(ctx);
});

bot.action('cancel_ticker', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from?.id;
  if (userId) {
    userStateManager.resetUserState(userId);
  }
  await showMainMenu(ctx);
});

/**
 * 处理文本输入（Ticker 查询）
 */
bot.on('text', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  const user = userStateManager.getUser(userId);
  const text = ctx.message.text;

  // 处理 Ticker 输入
  if (user.currentState === UserState.WAITING_TICKER_INPUT) {
    await tickerHandler.handleInput(ctx, text);
    return;
  }

  // 处理邀请码输入
  if (user.currentState === UserState.WAITING_INVITE_CODE) {
    if (payment.unlockByInviteCode(userId, text)) {
      userStateManager.resetUserState(userId);
      await ctx.reply('✅ 解锁成功！现在可以使用全部功能了。');
      await showMainMenu(ctx);
    } else {
      await ctx.reply('❌ 邀请码错误，请重新输入或取消');
    }
    return;
  }

  // 其他文本消息
  await ctx.reply('请使用菜单按钮进行操作，或输入 /start 查看帮助');
});

/**
 * 付费相关回调
 */
bot.action('unlock_stars', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from?.id;
  if (userId) {
    await payment.unlockByStars(ctx, userId);
  }
});

bot.action('unlock_invite', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from?.id;
  if (!userId) return;

  userStateManager.setUserState(userId, UserState.WAITING_INVITE_CODE);
  await ctx.reply(
    '🎫 请输入邀请码：\n\n输入 /cancel 取消',
    {
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: '❌ 取消',
              callback_data: 'cancel_unlock',
            },
          ],
        ],
      },
    }
  );
});

bot.action('cancel_unlock', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from?.id;
  if (userId) {
    userStateManager.resetUserState(userId);
  }
  await showMainMenu(ctx);
});

/**
 * 处理支付成功回调
 */
bot.on('pre_checkout_query', async (ctx) => {
  await ctx.answerPreCheckoutQuery(true);
});

bot.on('successful_payment', async (ctx) => {
  const userId = ctx.from?.id;
  if (userId) {
    payment.handlePaymentSuccess(userId);
    await ctx.reply('✅ 支付成功！已解锁全部功能。');
    await showMainMenu(ctx);
  }
});

/**
 * 处理解锁后的待执行操作
 */
async function handlePendingAction(ctx: Context, userId: number) {
  const context = userStateManager.getUserContext(userId);
  const pendingAction = context.pendingAction;

  if (!pendingAction) return;

  // 清除待执行操作
  delete context.pendingAction;
  userStateManager.setUserContext(userId, context);

  // 执行待执行的操作
  switch (pendingAction) {
    case 'squeeze_detail':
      if (context.symbol) {
        await shortSqueezeHandler.showDetail(ctx, context.symbol);
      }
      break;
    case 'squeeze_current':
      await shortSqueezeHandler.checkCurrent(ctx);
      break;
    case 'etf_history':
      if (context.symbol) {
        await etfHandler.showHistory(ctx, context.symbol as 'BTC' | 'ETH' | 'SOL');
      }
      break;
    case 'ticker_query':
      if (context.ticker) {
        await tickerHandler.handleInput(ctx, context.ticker);
      }
      break;
  }
}

// 在解锁成功后处理待执行操作
bot.action(/^unlock_success_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from?.id;
  if (userId) {
    await handlePendingAction(ctx, userId);
  }
});

/**
 * 错误处理
 */
bot.catch((err, ctx) => {
  console.error('Bot Error:', err);
  ctx.reply('❌ 发生错误，请稍后重试或联系管理员');
});

/**
 * 启动 Bot
 */
async function start() {
  try {
    console.log('🤖 Bot 启动中...');
    await bot.launch();
    console.log('✅ Bot 已启动');
  } catch (error) {
    console.error('❌ Bot 启动失败:', error);
    process.exit(1);
  }
}

// 优雅关闭
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

// 启动
start();

