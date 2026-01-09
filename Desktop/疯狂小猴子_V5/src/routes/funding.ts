import { Bot, InlineKeyboard } from 'grammy';
import { FundingService } from '../services/funding.service';
import { ContractService } from '../services/contract.service';
import { EntitlementGuard } from '../guards/entitlement.guard';
import { handleTickerDetailsEntry } from './tickerDetails';
import { logger } from '../utils/logger';
import { normalizeTicker } from '../utils/validator';
import { handleDataError } from '../utils/errorHandler';
import { formatDate } from '../utils/formatter';

/**
 * 资金费率模块状态（简单内存存储，生产环境建议用 Redis）
 */
const fundingStates = new Map<number, {
  step: 'funding_module' | 'funding_direction' | 'funding_result';
  fundingModule?: 'exchange' | 'accumulated' | 'history' | 'vol_weighted' | 'oi_weighted';
  direction?: 'positive' | 'negative';
  symbol?: string;
}>();

export function registerFundingRoute(
  bot: Bot,
  service: FundingService,
  contractService: ContractService,
  guard: EntitlementGuard
) {
  // /funding 命令入口
  bot.command('funding', async (ctx) => {
    await handleFundingModuleMenu(ctx);
  });

  // 一级选择：模块类型
  bot.callbackQuery('funding', async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleFundingModuleMenu(ctx);
  });

  bot.callbackQuery(/^funding_module_(exchange|accumulated|history|vol_weighted|oi_weighted)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const module = ctx.match[1] as 'exchange' | 'accumulated' | 'history' | 'vol_weighted' | 'oi_weighted';
    const userId = ctx.from?.id;
    if (userId) {
      fundingStates.set(userId, {
        step: (module === 'history' || module === 'vol_weighted' || module === 'oi_weighted') ? 'funding_result' : 'funding_direction',
        fundingModule: module,
      });
    }

    if (module === 'history' || module === 'vol_weighted' || module === 'oi_weighted') {
      // 历史类需要输入 Ticker
      const moduleText = {
        history: '资金费率历史',
        vol_weighted: '成交量加权资金费率历史',
        oi_weighted: '持仓加权资金费率历史',
      }[module] || '资金费率历史';
      
      await ctx.reply(
        `📊 请输入要查询的 Ticker（如 BTC）\n\n` +
        `提示：输入 Ticker 后会自动查询 ${moduleText}\n\n` +
        `⚠️ 注意：symbol 必须是币种（BTC），不是交易对（BTCUSDT）`,
        {
          reply_markup: new InlineKeyboard()
            .text('🔙 返回', 'funding'),
        }
      );
    } else {
      // 交易所列表类进入二级选择
      await handleFundingDirectionMenu(ctx, module);
    }
  });

  // 二级选择：正/负方向（仅用于 exchange 和 accumulated）
  bot.callbackQuery(/^funding_direction_(exchange|accumulated)_(positive|negative)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const module = ctx.match[1] as 'exchange' | 'accumulated';
    const direction = ctx.match[2] as 'positive' | 'negative';
    const userId = ctx.from?.id;
    
    if (userId) {
      const existingState = fundingStates.get(userId);
      const state: {
        step: 'funding_module' | 'funding_direction' | 'funding_result';
        fundingModule?: 'exchange' | 'accumulated' | 'history' | 'vol_weighted' | 'oi_weighted';
        direction?: 'positive' | 'negative';
        symbol?: string;
      } = {
        step: 'funding_result',
        fundingModule: existingState?.fundingModule || module,
        direction,
      };
      fundingStates.set(userId, state);
    }

    await handleFundingResult(ctx, module, direction, service);
  });

  // 处理历史查询（文本输入）
  bot.on('message:text', async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) {
      await next();
      return;
    }

    const state = fundingStates.get(userId);
    if (state?.step === 'funding_result' && 
        (state.fundingModule === 'history' || state.fundingModule === 'vol_weighted' || state.fundingModule === 'oi_weighted')) {
      const text = ctx.message.text.trim();
      const ticker = normalizeTicker(text);
      
      // 验证是否是有效的 Ticker（确保是币种，不是交易对）
      if (ticker && ticker.length <= 10 && !ticker.includes('USDT') && !ticker.includes('USDC')) {
        await handleFundingHistory(ctx, state.fundingModule, ticker, service);
        fundingStates.delete(userId); // 清除状态
        return;
      } else if (ticker && (ticker.includes('USDT') || ticker.includes('USDC'))) {
        // 如果用户输入了交易对，提示输入币种
        await ctx.reply(
          `⚠️ 请输入币种符号（如 BTC），不要输入交易对（如 BTCUSDT）\n\n` +
          `请重新输入币种：`,
          {
            reply_markup: new InlineKeyboard()
              .text('🔙 返回', 'funding'),
          }
        );
        return;
      }
    }

    await next();
  });

  // 兼容旧的回调（保持向后兼容）
  bot.callbackQuery('funding_positive', async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleFundingResult(ctx, 'exchange', 'positive', service);
  });

  bot.callbackQuery('funding_negative', async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleFundingResult(ctx, 'exchange', 'negative', service);
  });

  // 处理 ticker 按钮点击（仅在用户点击具体 ticker 后触发新逻辑）
  bot.callbackQuery(/^funding_ticker_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const ticker = ctx.match[1];
    await handleTickerDetailsEntry(ctx, ticker, 'funding', contractService, guard);
  });
}

/**
 * 一级菜单：模块选择
 */
async function handleFundingModuleMenu(ctx: any) {
  const keyboard = new InlineKeyboard()
    .text('1️⃣ 币种资金费率（交易所实时）', 'funding_module_exchange')
    .row()
    .text('2️⃣ 累计资金费率（交易所）', 'funding_module_accumulated')
    .row()
    .text('3️⃣ 资金费率历史（K 线）', 'funding_module_history')
    .row()
    .text('4️⃣ 持仓加权资金费率历史（K 线）', 'funding_module_oi_weighted')
    .row()
    .text('5️⃣ 成交量加权资金费率历史（K 线）', 'funding_module_vol_weighted')
    .row()
    .text('🔙 返回主菜单', 'main_menu');

  await ctx.reply(
    '📊 请选择你想查看的资金费率类型：\n\n' +
    '1️⃣ 币种资金费率（交易所实时）\n' +
    '   - 查看各币种当前资金费率排名\n' +
    '   - 支持正/负方向筛选\n\n' +
    '2️⃣ 累计资金费率（交易所）\n' +
    '   - 查看累计资金费率排名\n' +
    '   - 反映长期累积成本\n\n' +
    '3️⃣ 资金费率历史（K 线）\n' +
    '   - 查看指定币种的历史趋势\n' +
    '   - 需要输入币种（如 BTC）\n\n' +
    '4️⃣ 持仓加权资金费率历史（K 线）\n' +
    '   - 持仓加权的历史趋势\n' +
    '   - 需要输入币种（如 BTC）\n\n' +
    '5️⃣ 成交量加权资金费率历史（K 线）\n' +
    '   - 成交量加权的历史趋势\n' +
    '   - 需要输入币种（如 BTC）',
    {
      reply_markup: keyboard,
    }
  );
}

/**
 * 二级菜单：正/负方向选择
 */
async function handleFundingDirectionMenu(ctx: any, module: 'exchange' | 'accumulated') {
  const moduleText = module === 'exchange' ? '币种资金费率' : '累计资金费率';
  
  const keyboard = new InlineKeyboard()
    .text('🔺 正资金费率最高（多头拥挤）', `funding_direction_${module}_positive`)
    .row()
    .text('🔻 负资金费率最低（空头拥挤）', `funding_direction_${module}_negative`)
    .row()
    .text('🔙 返回', 'funding');

  await ctx.reply(
    `📊 ${moduleText}\n\n` +
    `你想查看哪一类资金费率排名？\n\n` +
    `🔺 正资金费率高 → 多头支付费用 → 多头拥挤\n` +
    `🔻 负资金费率低 → 空头支付费用 → 空头拥挤\n\n` +
    `💡 这是结构判断信号，不是交易建议`,
    {
      reply_markup: keyboard,
    }
  );
}

/**
 * 显示排名结果
 */
async function handleFundingResult(
  ctx: any,
  module: 'exchange' | 'accumulated',
  direction: 'positive' | 'negative',
  service: FundingService
) {
  try {
    const moduleText = module === 'exchange' ? '币种资金费率' : '累计资金费率';
    await ctx.reply(`📊 正在获取 ${moduleText}（${direction === 'positive' ? '正向' : '负向'}）Top 10...`);

    let items: any[];
    let message: string;

    if (module === 'exchange') {
      items = await service.getExchangeFundingRateTopN(direction, 10);
      message = formatExchangeFundingRateTopN(items, direction);
    } else {
      items = await service.getAccumulatedFundingRateTopN(direction, 10);
      message = formatAccumulatedFundingRateTopN(items, direction);
    }

    // 为每个币种添加按钮（Top10，保持原样）
    const keyboard = new InlineKeyboard();
    items.forEach((item, index) => {
      if (index % 2 === 0) {
        keyboard.text(`📊 ${item.symbol}`, `funding_ticker_${item.symbol}`);
      } else {
        keyboard.text(`📊 ${item.symbol}`, `funding_ticker_${item.symbol}`).row();
      }
    });
    keyboard.row().text('🔙 返回', 'funding');

    await ctx.reply(message, {
      reply_markup: keyboard,
    });
  } catch (error) {
    const prompt = handleDataError(error, {
      retryAction: `funding_direction_${module}_${direction}`,
      backAction: 'funding',
    });
    
    await ctx.reply(prompt.message, {
      reply_markup: prompt.keyboard,
    });
  }
}

/**
 * 处理历史查询
 */
async function handleFundingHistory(
  ctx: any,
  module: 'history' | 'vol_weighted' | 'oi_weighted',
  symbol: string,
  service: FundingService
) {
  try {
    const moduleText = {
      history: '资金费率历史',
      vol_weighted: '成交量加权资金费率历史',
      oi_weighted: '持仓加权资金费率历史',
    }[module] || '资金费率历史';
    
    await ctx.reply(`📊 正在获取 ${symbol} 的 ${moduleText}...`);

    let result: {
      history: any[];
      summary: {
        latest: number;
        high: number;
        low: number;
        highTime: number;
        lowTime: number;
      } | null;
    };

    if (module === 'history') {
      result = await service.getFundingRateHistoryOhlc(symbol, '1d', 30);
    } else if (module === 'vol_weighted') {
      result = await service.getVolWeightFundingRateHistoryOhlc(symbol, '1d', 30);
    } else {
      result = await service.getFundingOiWeightOhlcHistory(symbol, '1d', 30);
    }

    if (!result.summary) {
      await ctx.reply(
        `❌ 该币种在该时间间隔下暂无资金费率历史数据\n\n` +
        `请尝试：\n` +
        `• 切换时间间隔（1h/8h/1d）\n` +
        `• 或换一个币种`,
        {
          reply_markup: new InlineKeyboard()
            .text('🔄 查询其他币种', `funding_module_${module}`)
            .row()
            .text('🔙 返回', 'funding'),
        }
      );
      return;
    }

    const message = service.formatFundingHistorySummary(symbol, result.summary, '1d');

    const keyboard = new InlineKeyboard()
      .text('📊 查看合约数据概览', `funding_ticker_${symbol}`)
      .row()
      .text('🔄 查询其他币种', `funding_module_${module}`)
      .row()
      .text('🔙 返回', 'funding');

    await ctx.reply(message, {
      reply_markup: keyboard,
    });
  } catch (error) {
    logger.error({ error, module, symbol }, 'Failed to get funding history');
    
    // 检查是否是 401 错误
    if (error instanceof Error && (error.message.includes('401') || error.message.includes('CG-API-KEY'))) {
      await ctx.reply(
        `❌ API 鉴权失败\n\n` +
        `请检查 CG-API-KEY 配置是否正确。\n` +
        `如果问题持续，请联系开发者。`,
        {
          reply_markup: new InlineKeyboard()
            .text('🔙 返回', 'funding'),
        }
      );
      return;
    }
    
    const prompt = handleDataError(error, {
      retryAction: `funding_module_${module}`,
      backAction: 'funding',
    });
    
    await ctx.reply(prompt.message, {
      reply_markup: prompt.keyboard,
    });
  }
}

/**
 * 格式化币种资金费率 Top N
 */
function formatExchangeFundingRateTopN(
  items: Array<{
    symbol: string;
    exchange: string;
    fundingRate: number;
    fundingRatePercent: string;
    nextFundingTime: number;
  }>,
  direction: 'positive' | 'negative'
): string {
  const directionText = direction === 'positive' ? '正资金费率最高' : '负资金费率最低';
  let message = `📊 币种资金费率（${directionText}）Top ${items.length}\n\n`;
  
  items.forEach((item, index) => {
    const timeStr = item.nextFundingTime > 0 
      ? formatDate(item.nextFundingTime)
      : '未知';
    message += `${index + 1}. ${item.symbol} | ${item.fundingRatePercent} | ${item.exchange} | 下次结算：${timeStr}\n`;
  });
  
  message += `\n数据源：CoinGlass`;
  return message;
}

/**
 * 格式化累计资金费率 Top N
 */
function formatAccumulatedFundingRateTopN(
  items: Array<{
    symbol: string;
    exchange: string;
    accumulatedFundingRate: number;
    accumulatedFundingRatePercent: string;
    nextFundingTime: number;
  }>,
  direction: 'positive' | 'negative'
): string {
  const directionText = direction === 'positive' ? '正累计资金费率最高' : '负累计资金费率最低';
  let message = `📊 累计资金费率（${directionText}）Top ${items.length}\n\n`;
  
  items.forEach((item, index) => {
    const timeStr = item.nextFundingTime > 0 
      ? formatDate(item.nextFundingTime)
      : '未知';
    message += `${index + 1}. ${item.symbol} | ${item.accumulatedFundingRatePercent} | ${item.exchange} | 下次结算：${timeStr}\n`;
  });
  
  message += `\n数据源：CoinGlass`;
  return message;
}
