import { Bot, InlineKeyboard } from 'grammy';
import { ETFService } from '../services/etf.service';
import { EntitlementGuard } from '../guards/entitlement.guard';
import { logger } from '../utils/logger';
import { handleDataError } from '../utils/errorHandler';

export function registerETFRoute(bot: Bot, service: ETFService, guard: EntitlementGuard) {
  bot.command('etf', async (ctx) => {
    await handleETFMenu(ctx);
  });

  bot.callbackQuery('etf', async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleETFMenu(ctx);
  });

  bot.callbackQuery(/^etf_(BTC|ETH|SOL|XRP)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const symbol = ctx.match[1] as 'BTC' | 'ETH' | 'SOL' | 'XRP';
    await handleETFData(ctx, symbol, service, guard);
  });

  bot.callbackQuery(/^etf_history_(BTC|ETH|SOL|XRP)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const symbol = ctx.match[1] as 'BTC' | 'ETH' | 'SOL' | 'XRP';
    await handleETFHistory(ctx, symbol, service, guard);
  });

  // ETF 解读分析（新增）
  bot.callbackQuery(/^etf_analysis_(BTC|ETH|SOL|XRP)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const symbol = ctx.match[1] as 'BTC' | 'ETH' | 'SOL' | 'XRP';
    await handleETFAnalysis(ctx, symbol, service, guard);
  });

  // ETF 列表
  bot.callbackQuery('etf_list', async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleETFList(ctx, service);
  });

  // 快速查看（仅最新数据，不获取历史）
  bot.callbackQuery(/^etf_quick_(BTC|ETH|SOL|XRP)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const symbol = ctx.match[1] as 'BTC' | 'ETH' | 'SOL' | 'XRP';
    await handleETFQuick(ctx, symbol, service);
  });
}

async function handleETFMenu(ctx: any) {
  const keyboard = new InlineKeyboard()
    .text('₿ BTC', 'etf_BTC')
    .text('Ξ ETH', 'etf_ETH')
    .row()
    .text('◎ SOL', 'etf_SOL')
    .text('💧 XRP', 'etf_XRP')
    .row()
    .text('📋 查看支持的 ETF 列表', 'etf_list')
    .row()
    .text('🔙 返回主菜单', 'main_menu');

  await ctx.reply(
    '📊 选择要查看的 ETF：\n\n' +
    '💡 提示：\n' +
    '• BTC/ETH ETF 数据可用\n' +
    '• SOL/XRP ETF 可能受 API 限制\n' +
    '• 如遇限流，请稍后重试',
    {
      reply_markup: keyboard,
    }
  );
}

async function handleETFData(ctx: any, symbol: 'BTC' | 'ETH' | 'SOL' | 'XRP', service: ETFService, guard: EntitlementGuard) {
  try {
    await ctx.reply(`📊 正在获取 ${symbol} ETF 数据...`);

    const flow = await service.getLatestFlow(symbol);

    if (!flow) {
      // 数据为空，视为 Bug/异常
      const prompt = handleDataError(
        new Error('ETF 数据为空'),
        {
          retryAction: `etf_${symbol}`,
          alternativeAction: 'etf_list',
          alternativeLabel: '📋 查看列表',
          backAction: 'etf',
        }
      );
      
      await ctx.reply(prompt.message, {
        reply_markup: prompt.keyboard,
      });
      return;
    }

    const message = service.formatLatestFlow(flow, symbol);

    const keyboard = new InlineKeyboard()
      .text('📈 查看过去 30 天历史', `etf_history_${symbol}`)
      .text('🧠 ETF 解读分析', `etf_analysis_${symbol}`)
      .row()
      .text('🔄 刷新', `etf_${symbol}`)
      .row()
      .text('🔙 返回', 'etf');

    await ctx.reply(message, {
      reply_markup: keyboard,
    });
  } catch (error) {
    const prompt = handleDataError(error, {
      retryAction: `etf_${symbol}`,
      alternativeAction: `etf_quick_${symbol}`,
      alternativeLabel: '⚡ 快速查看',
      backAction: 'etf',
    });
    
    await ctx.reply(prompt.message, {
      reply_markup: prompt.keyboard,
    });
  }
}

async function handleETFHistory(ctx: any, symbol: 'BTC' | 'ETH' | 'SOL' | 'XRP', service: ETFService, guard: EntitlementGuard) {
  const userId = ctx.from?.id;
  if (!userId) return;

  if (!guard.isUnlocked(userId)) {
    await ctx.reply(
      '🔒 历史数据需要解锁\n\n输入 /pay 解锁',
      {
        reply_markup: new InlineKeyboard()
          .text('💎 解锁', 'pay')
          .text('🔙 返回', `etf_${symbol}`),
      }
    );
    return;
  }

  try {
    await ctx.reply(`📊 正在获取 ${symbol} ETF 历史数据...`);

    const history = await service.getFlowHistory(symbol, 30);
    const message = service.formatHistorySummary(history, symbol);

    await ctx.reply(message, {
      reply_markup: new InlineKeyboard()
        .text('🔄 刷新', `etf_history_${symbol}`)
        .text('🔙 返回', `etf_${symbol}`),
    });
  } catch (error) {
    const prompt = handleDataError(error, {
      retryAction: `etf_history_${symbol}`,
      alternativeAction: `etf_${symbol}`,
      alternativeLabel: '📊 查看最新数据',
      backAction: 'etf',
    });
    
    await ctx.reply(prompt.message, {
      reply_markup: prompt.keyboard,
    });
  }
}

/**
 * 快速查看 ETF（仅最新数据，减少 API 调用）
 */
async function handleETFQuick(ctx: any, symbol: 'BTC' | 'ETH' | 'SOL' | 'XRP', service: ETFService) {
  try {
    await ctx.reply(`⚡ 正在快速获取 ${symbol} ETF 最新数据...`);

    // 只获取最近 1 天的数据
    const history = await service.getFlowHistory(symbol, 1);
    
    if (history.length === 0) {
      await ctx.reply(
        `❌ 无法获取 ${symbol} 的最新数据\n\n` +
        `建议稍后重试或查看其他币种`,
        {
          reply_markup: new InlineKeyboard()
            .text('🔄 重试', `etf_quick_${symbol}`)
            .text('📋 查看列表', 'etf_list')
            .row()
            .text('🔙 返回', 'etf'),
        }
      );
      return;
    }

    const latest = history[0];
    const message = service.formatLatestFlow(latest, symbol);
    const quickMessage = `⚡ 快速查看\n\n${message}`;

    await ctx.reply(quickMessage, {
      reply_markup: new InlineKeyboard()
        .text('📊 完整数据', `etf_${symbol}`)
        .text('🔄 刷新', `etf_quick_${symbol}`)
        .row()
        .text('🔙 返回', 'etf'),
    });
  } catch (error) {
    const prompt = handleDataError(error, {
      retryAction: `etf_quick_${symbol}`,
      alternativeAction: `etf_${symbol}`,
      alternativeLabel: '📊 完整数据',
      backAction: 'etf',
    });
    
    await ctx.reply(prompt.message, {
      reply_markup: prompt.keyboard,
    });
  }
}

/**
 * 处理 ETF 解读分析（新增功能）
 */
async function handleETFAnalysis(
  ctx: any,
  symbol: 'BTC' | 'ETH' | 'SOL' | 'XRP',
  service: ETFService,
  guard: EntitlementGuard
) {
  const userId = ctx.from?.id;
  if (!userId) return;

  if (!guard.isUnlocked(userId)) {
    await ctx.reply(
      '🔒 ETF 解读分析需要解锁\n\n输入 /pay 解锁',
      {
        reply_markup: new InlineKeyboard()
          .text('💎 解锁', 'pay')
          .text('🔙 返回', `etf_${symbol}`),
      }
    );
    return;
  }

  try {
    await ctx.reply(`🧠 正在生成 ${symbol} ETF 解读分析...\n\n这可能需要几秒钟，请稍候...`);

    const analysis = await service.generateETFAnalysis(symbol);

    await ctx.reply(analysis, {
      reply_markup: new InlineKeyboard()
        .text('🔄 重新分析', `etf_analysis_${symbol}`)
        .text('📊 查看数据', `etf_${symbol}`)
        .row()
        .text('🔙 返回', 'etf'),
    });
  } catch (error) {
    logger.error({ error, symbol }, 'Failed to generate ETF analysis');
    const prompt = handleDataError(error, {
      retryAction: `etf_analysis_${symbol}`,
      alternativeAction: `etf_${symbol}`,
      alternativeLabel: '📊 查看数据',
      backAction: 'etf',
    });
    
    await ctx.reply(prompt.message, {
      reply_markup: prompt.keyboard,
    });
  }
}

/**
 * 显示支持的 ETF 列表和状态
 */
async function handleETFList(ctx: any, service: ETFService) {
  const etfList = [
    { symbol: 'BTC', name: 'Bitcoin', available: true },
    { symbol: 'ETH', name: 'Ethereum', available: true },
    { symbol: 'SOL', name: 'Solana', available: false }, // SOL 可能受限制
    { symbol: 'XRP', name: 'Ripple', available: false }, // XRP 可能受限制
  ];

  let message = '📋 支持的 ETF 列表\n\n';
  
  for (const etf of etfList) {
    const status = etf.available ? '✅' : '⚠️';
    message += `${status} ${etf.symbol} (${etf.name})\n`;
    if (!etf.available) {
      message += `   可能受 API 限制\n`;
    }
  }

  message += `\n💡 提示：\n`;
  message += `• BTC/ETH 数据通常可用\n`;
  message += `• 如遇限流，请使用"快速查看"功能\n`;
  message += `• 或等待 1-2 分钟后重试`;

  const keyboard = new InlineKeyboard()
    .text('₿ BTC', 'etf_BTC')
    .text('Ξ ETH', 'etf_ETH')
    .row()
    .text('◎ SOL', 'etf_SOL')
    .text('💧 XRP', 'etf_XRP')
    .row()
    .text('🔙 返回', 'etf');

  await ctx.reply(message, {
    reply_markup: keyboard,
  });
}

