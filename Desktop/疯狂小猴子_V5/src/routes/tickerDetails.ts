import { Bot, InlineKeyboard } from 'grammy';
import { ContractService } from '../services/contract.service';
import { EntitlementGuard } from '../guards/entitlement.guard';
import { ContractSnapshot } from '../types';
import { logger } from '../utils/logger';
import { handleDataError } from '../utils/errorHandler';

/**
 * Snapshot 缓存（用于"是否进一步分析"按钮点击时使用）
 * key: {userId}:{source}:{ticker}
 * value: { snapshot, timestamp }
 */
const snapshotCache = new Map<string, {
  snapshot: ContractSnapshot;
  timestamp: number;
}>();

const CACHE_TTL_MS = 30 * 60 * 1000; // 30分钟过期

/**
 * 统一的 Ticker 详情入口函数
 * 当用户点击任意模块中的某个具体 Token/Ticker 时调用
 * 复用合约查询的逻辑（handleContractQuery）
 * 
 * @param ctx - Telegram context
 * @param ticker - Ticker 符号（如 BTC）
 * @param source - 来源模块（如 'funding', 'squeeze', 'contract'）
 * @param contractService - 合约服务
 * @param guard - 权限守卫
 */
export async function handleTickerDetailsEntry(
  ctx: any,
  ticker: string,
  source: string,
  contractService: ContractService,
  guard: EntitlementGuard
): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    // 复用合约查询逻辑：使用相同的查询流程
    await ctx.reply(`📊 正在查询 ${ticker} 的合约数据...`);

    // Step 1: 获取合约快照并展示数据（使用合约查询的格式化方法）
    const snapshot = await contractService.getContractSnapshot(ticker);
    const message = contractService.formatContractSnapshot(snapshot);
    
    // 缓存 snapshot（供后续分析使用）
    const cacheKey = `${userId}:${source}:${ticker}`;
    snapshotCache.set(cacheKey, {
      snapshot,
      timestamp: Date.now(),
    });

    // Step 1: 输出数据（数据缺失 → 显示为空，不报错）
    await ctx.reply(message);

    // Step 2: 询问是否需要进一步分析（使用统一的回调格式）
    await ctx.reply(
      `是否需要进一步分析？`,
      {
        reply_markup: new InlineKeyboard()
          .text('🔍 Yes，进行分析', `analysis:ask:${source}:${ticker}`)
          .text('❌ No', `analysis:no:${source}:${ticker}`),
      }
    );

  } catch (error) {
    logger.error({ error, ticker, source }, 'Failed to query contract');
    
    const prompt = handleDataError(error, {
      retryAction: source === 'funding' ? 'funding' : source === 'squeeze' ? 'squeeze' : 'contract',
      backAction: 'main_menu',
    });
    
    await ctx.reply(prompt.message, {
      reply_markup: prompt.keyboard,
    });
  }
}


/**
 * 处理"是否需要进一步分析"按钮点击
 */
export async function handleAnalysisAsk(
  ctx: any,
  source: string,
  ticker: string,
  contractService: ContractService,
  guard: EntitlementGuard
): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  await ctx.answerCallbackQuery();

  // 检查权限
  if (!guard.isUnlocked(userId)) {
    await ctx.reply(
      `💳 需要解锁分析功能\n\n` +
      `2999 Stars：终身解锁全部功能\n` +
      `或 Twitter 私信 @Ocean_Jackon 获取邀请码免费体验\n\n` +
      `输入邀请码：Ocean001`,
      {
        reply_markup: new InlineKeyboard()
          .text('💎 解锁（Stars）', 'pay')
          .text('🎫 输入邀请码', `analysis:code:${source}:${ticker}`)
          .row()
          .text('❌ 暂不需要', `analysis:no:${source}:${ticker}`),
      }
    );
    return;
  }

  // 已解锁：执行分析
  await handleAnalysisRun(ctx, source, ticker, contractService);
}

/**
 * 执行 DeepSeek 分析
 */
export async function handleAnalysisRun(
  ctx: any,
  source: string,
  ticker: string,
  contractService: ContractService
): Promise<void> {
  const userId = ctx.from?.id;
  if (!userId) return;

  try {
    // 从缓存获取 snapshot
    const cacheKey = `${userId}:${source}:${ticker}`;
    const cached = snapshotCache.get(cacheKey);

    if (!cached) {
      await ctx.reply('❌ 数据已过期，请重新查询');
      return;
    }

    // 检查缓存是否过期
    const age = Date.now() - cached.timestamp;
    if (age > CACHE_TTL_MS) {
      snapshotCache.delete(cacheKey);
      await ctx.reply('❌ 数据已过期，请重新查询');
      return;
    }

    await ctx.reply(`🤖 正在生成 ${ticker} 的结构分析...`);

    // 使用缓存的 snapshot 进行分析（不重新拉取数据）
    const analysis = await contractService.analyzeContract(cached.snapshot);
    const message = contractService.formatContractAnalysis(cached.snapshot, analysis);

    // 清理缓存
    snapshotCache.delete(cacheKey);

    // 根据来源确定返回按钮
    const backButton = source === 'funding' ? 'funding' : source === 'squeeze' ? 'squeeze' : 'contract';

    await ctx.reply(message, {
      reply_markup: new InlineKeyboard()
        .text('🔄 重新查询', backButton)
        .text('🔙 返回', backButton),
    });
  } catch (error) {
    logger.error({ error, ticker, source }, 'Failed to run analysis');
    
    const prompt = handleDataError(error, {
      retryAction: source === 'funding' ? 'funding' : source === 'squeeze' ? 'squeeze' : 'contract',
      backAction: 'main_menu',
    });
    
    await ctx.reply(prompt.message, {
      reply_markup: prompt.keyboard,
    });
  }
}

/**
 * 处理"否"按钮点击
 */
export async function handleAnalysisNo(
  ctx: any,
  source: string,
  ticker: string
): Promise<void> {
  await ctx.answerCallbackQuery();
  
  const userId = ctx.from?.id;
  if (!userId) return;

  // 清理缓存
  const cacheKey = `${userId}:${source}:${ticker}`;
  snapshotCache.delete(cacheKey);
  
  // 不发送消息，静默处理
}

/**
 * 注册统一的 analysis callback 处理
 */
export function registerTickerDetailsCallbacks(
  bot: Bot,
  contractService: ContractService,
  guard: EntitlementGuard
): void {
  // 处理"是否需要进一步分析"按钮
  bot.callbackQuery(/^analysis:ask:(.+):(.+)$/, async (ctx) => {
    const source = ctx.match[1];
    const ticker = ctx.match[2];
    await handleAnalysisAsk(ctx, source, ticker, contractService, guard);
  });

  // 处理"执行分析"按钮（已解锁用户）
  bot.callbackQuery(/^analysis:run:(.+):(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const source = ctx.match[1];
    const ticker = ctx.match[2];
    await handleAnalysisRun(ctx, source, ticker, contractService);
  });

  // 处理"否"按钮
  bot.callbackQuery(/^analysis:no:(.+):(.+)$/, async (ctx) => {
    const source = ctx.match[1];
    const ticker = ctx.match[2];
    await handleAnalysisNo(ctx, source, ticker);
  });

  // 处理"输入邀请码"按钮
  bot.callbackQuery(/^analysis:code:(.+):(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const source = ctx.match[1];
    const ticker = ctx.match[2];
    
    await ctx.reply(
      `🎫 请输入邀请码\n\n` +
      `有效邀请码：Ocean001\n\n` +
      `输入邀请码后自动解锁分析功能。`,
      {
        reply_markup: new InlineKeyboard()
          .text('❌ 取消', `analysis:no:${source}:${ticker}`),
      }
    );
  });
}

