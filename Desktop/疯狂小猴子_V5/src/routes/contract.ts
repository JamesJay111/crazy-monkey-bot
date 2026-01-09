import { Bot, InlineKeyboard } from 'grammy';
import { ContractService } from '../services/contract.service';
import { EntitlementGuard } from '../guards/entitlement.guard';
import { normalizeTicker, isValidTicker } from '../utils/validator';
import { logger } from '../utils/logger';
import { handleDataError } from '../utils/errorHandler';
import { ContractSnapshot } from '../types';

/**
 * 合约查询状态（用于二次确认）
 */
const contractAnalysisStates = new Map<number, {
  snapshot: ContractSnapshot;
  timestamp: number;
}>();

export function registerContractRoute(bot: Bot, service: ContractService, guard: EntitlementGuard) {
  // /contract 命令入口
  bot.command('contract', async (ctx) => {
    await handleContractInput(ctx);
  });

  // 主菜单按钮回调
  bot.callbackQuery('contract', async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleContractInput(ctx);
  });

  // 二次确认：是否需要分析
  bot.callbackQuery(/^contract_analyze_(yes|no|code)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const action = ctx.match[1];
    const userId = ctx.from?.id;
    
    if (!userId) return;

    const state = contractAnalysisStates.get(userId);
    if (!state) {
      await ctx.reply('❌ 查询已过期，请重新查询');
      return;
    }

    if (action === 'no') {
      // 点击 No → 不做任何事（不发送消息，不删除状态）
      contractAnalysisStates.delete(userId);
      return;
    }

    if (action === 'code') {
      await ctx.reply(
        `🎫 请输入邀请码\n\n` +
        `有效邀请码：Ocean001\n\n` +
        `输入邀请码后自动解锁分析功能。`,
        {
          reply_markup: new InlineKeyboard().text('❌ 取消', 'contract_analyze_no'),
        }
      );
      return;
    }

    // action === 'yes'：检查权限
    if (!guard.isUnlocked(userId)) {
      await ctx.reply(
        `💳 需要解锁分析功能\n\n` +
        `2999 Stars：终身解锁全部功能\n` +
        `或 Twitter 私信 @Ocean_Jackon 获取邀请码免费体验\n\n` +
        `输入邀请码：Ocean001`,
        {
          reply_markup: new InlineKeyboard()
            .text('💎 解锁（Stars）', 'pay')
            .text('🎫 输入邀请码', 'contract_analyze_code')
            .row()
            .text('❌ 暂不需要', 'contract_analyze_no'),
        }
      );
      return;
    }

    // 已解锁：执行分析
    await handleContractAnalysis(ctx, state.snapshot, service);
    contractAnalysisStates.delete(userId);
  });

  // 注意：文本输入处理在 bot/index.ts 中统一处理
}

/**
 * 处理合约输入引导
 */
async function handleContractInput(ctx: any) {
  await ctx.reply(
    `📊 查询指定 Ticker 合约\n\n` +
    `请输入 Ticker 符号（例如：BTC、ETH、SOL）\n\n` +
    `⚠️ 注意：\n` +
    `- 请输入 Ticker，不要输入项目名称（如 比特币）\n` +
    `- 如果存在歧义，系统会询问确认\n\n` +
    `💡 提示：\n` +
    `- 支持交易对格式（如 BTCUSDT）\n` +
    `- 默认使用 Binance 交易所数据`,
    {
      reply_markup: new InlineKeyboard().text('❌ 取消', 'main_menu'),
    }
  );
}

/**
 * 处理合约查询（从 bot/index.ts 调用）
 * 按照新需求：Step 1 展示数据，Step 2 询问是否需要分析（Yes/No）
 */
export async function handleContractQuery(
  ctx: any,
  ticker: string,
  service: ContractService,
  guard: EntitlementGuard
) {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    await ctx.reply(`📊 正在查询 ${ticker} 的合约数据...`);

    // Step 1: 获取合约快照并展示数据
    const snapshot = await service.getContractSnapshot(ticker);
    const message = service.formatContractSnapshot(snapshot);
    
    // 保存快照到状态（用于后续分析）
    contractAnalysisStates.set(userId, {
      snapshot,
      timestamp: Date.now(),
    });

    // Step 1: 输出数据（数据缺失 → 显示为空，不报错）
    await ctx.reply(message);

    // Step 2: 询问是否需要进一步分析
    await ctx.reply(
      `是否需要进一步分析？`,
      {
        reply_markup: new InlineKeyboard()
          .text('🔍 Yes，进行分析', 'contract_analyze_yes')
          .text('❌ No', 'contract_analyze_no'),
      }
    );

  } catch (error) {
    logger.error({ error, ticker }, 'Failed to query contract');
    
    const prompt = handleDataError(error, {
      retryAction: 'contract',
      backAction: 'main_menu',
    });
    
    await ctx.reply(prompt.message, {
      reply_markup: prompt.keyboard,
    });
  }
}

/**
 * 处理合约分析（付费阶段）
 */
async function handleContractAnalysis(
  ctx: any,
  snapshot: ContractSnapshot,
  service: ContractService
) {
  try {
    await ctx.reply(`🤖 正在生成 ${snapshot.symbol} 的结构分析...`);

    const analysis = await service.analyzeContract(snapshot);
    const message = service.formatContractAnalysis(snapshot, analysis);

    await ctx.reply(message, {
      reply_markup: new InlineKeyboard()
        .text('🔄 查询其他 Ticker', 'contract')
        .text('📊 返回合约查询', 'contract'),
    });
  } catch (error) {
    logger.error({ error, symbol: snapshot.symbol }, 'Failed to analyze contract');
    
    const prompt = handleDataError(error, {
      retryAction: 'contract',
      backAction: 'main_menu',
    });
    
    await ctx.reply(prompt.message, {
      reply_markup: prompt.keyboard,
    });
  }
}
