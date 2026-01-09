import { Bot, InlineKeyboard } from 'grammy';
import { SqueezeScanService } from '../services/squeezeScan.service';
import { SqueezeCacheService } from '../services/squeezeCache.service';
import { ContractService } from '../services/contract.service';
import { squeezeLabelEngine } from '../services/squeezeLabelEngine.service';
import { squeezeRiskEngine } from '../services/squeezeRiskEngine.service';
import { DeepSeekClient } from '../clients/deepseek.client';
import { EntitlementGuard } from '../guards/entitlement.guard';
import { handleTickerDetailsEntry } from './tickerDetails';
import { logger } from '../utils/logger';
import { buildSqueezePrompt, SQUEEZE_SYSTEM_PROMPT } from '../prompts/squeeze.prompt';
import { SqueezeAnalysis } from '../types';
import { formatPercent } from '../utils/formatter';
import { handleDataError } from '../utils/errorHandler';

export function registerSqueezeRoute(
  bot: Bot,
  scanService: SqueezeScanService,
  cacheService: SqueezeCacheService,
  contractService: ContractService,
  deepseek: DeepSeekClient,
  guard: EntitlementGuard
) {
  // /squeeze 命令入口
  bot.command('squeeze', async (ctx) => {
    await handleSqueezeScan(ctx, cacheService);
  });

  // 主菜单按钮回调
  bot.callbackQuery('squeeze', async (ctx) => {
    await ctx.answerCallbackQuery();
    await handleSqueezeScan(ctx, cacheService);
  });

  // 蓝筹/山寨选择回调
  bot.callbackQuery(/^squeeze_universe_(bluechip|alt)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const universeType = ctx.match[1] as 'bluechip' | 'alt';
    await handleSqueezeList(ctx, scanService, guard, universeType);
  });

  // 查看单个 ticker 详情（仅在用户点击具体 ticker 后触发新逻辑）
  bot.callbackQuery(/^squeeze_detail_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const symbol = ctx.match[1];
    // 使用统一的 ticker 详情入口
    await handleTickerDetailsEntry(ctx, symbol, 'squeeze', contractService, guard);
  });

  // 输入邀请码（从详情页触发）
  bot.callbackQuery(/^squeeze_code_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const symbol = ctx.match[1];
    await ctx.reply(
      `🎫 请输入邀请码\n\n` +
      `有效邀请码：Ocean001\n\n` +
      `输入邀请码后自动解锁分析功能。`,
      {
        reply_markup: new InlineKeyboard()
          .text('❌ 取消', `squeeze_detail_${symbol}`),
      }
    );
  });

  // funding_ticker_ 回调已移至 funding.ts 中处理，不再跳转到 squeeze
}

/**
 * 处理庄家轧空扫描（新流程：从缓存读取）
 */
async function handleSqueezeScan(ctx: any, cacheService: SqueezeCacheService) {
  try {
    // 从缓存读取结果（不再实时扫描）
    const cache = cacheService.getCache();

    if (!cache || cache.list.length === 0) {
      await ctx.reply(
        '暂无有效结构信号（最近 4h）',
        {
          reply_markup: new InlineKeyboard()
            .text('🔄 刷新', 'squeeze')
            .row()
            .text('🔙 返回主菜单', 'main_menu'),
        }
      );
      return;
    }

    // 格式化推荐 List（固定模板，保持原有文案）
    let message = `🧨 庄家轧空监测（Binance · 4h）\n\n`;
    message += `以下合约按「庄家轧空结构变化强度」排序：\n`;
    message += `（基于最近 4 小时大户持仓结构）\n\n`;

    cache.list.forEach((item, index) => {
      const emoji = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'][index] || `${index + 1}.`;
      
      // 使用 Label Engine 生成标签
      const listLabel = squeezeLabelEngine.generateListLabel(item);
      
      // 使用 Risk Engine 生成风险&可信度（F5.1：推荐List简洁格式）
      const riskDisplay = squeezeRiskEngine.generateListDisplay(item);
      
      // 格式化：BTC ｜空转多（强）｜🔴 极高 ｜⭐⭐⭐
      message += `${emoji} ${item.ticker}｜${listLabel}${riskDisplay ? '｜' + riskDisplay : ''}\n`;
    });

    message += `\n请选择你想进一步查看的合约 👇`;

    // 构建 Inline Keyboard
    const keyboard = new InlineKeyboard();
    cache.list.forEach((item, index) => {
      if (index % 2 === 0) {
        keyboard.text(`${item.ticker}`, `squeeze_detail_${item.ticker}`);
      } else {
        keyboard.text(`${item.ticker}`, `squeeze_detail_${item.ticker}`).row();
      }
    });
    keyboard.row().text('🔄 刷新', 'squeeze').text('🔙 返回主菜单', 'main_menu');

    await ctx.reply(message, { reply_markup: keyboard });
  } catch (error) {
    logger.error({ error }, 'Failed to handle squeeze scan from cache');
    const prompt = handleDataError(error, {
      retryAction: 'squeeze',
      backAction: 'main_menu',
    });
    await ctx.reply(prompt.message, { reply_markup: prompt.keyboard });
  }
}

/**
 * 处理币池选择（蓝筹 vs 山寨）- 保留用于向后兼容
 */
async function handleSqueezeUniverseSelection(ctx: any) {
  await ctx.reply(
    `🔍 庄家轧空/多空挤压分析\n\n` +
    `请选择要分析的币池类型：`,
    {
      reply_markup: new InlineKeyboard()
        .text('📊 分析蓝筹币', 'squeeze_universe_bluechip')
        .text('🪙 分析山寨币', 'squeeze_universe_alt')
        .row()
        .text('🔙 返回主菜单', 'main_menu'),
    }
  );
}

/**
 * 处理轧空列表（Top 15，免费阶段）
 */
async function handleSqueezeList(ctx: any, scanService: SqueezeScanService, guard: EntitlementGuard, universeType: 'bluechip' | 'alt' = 'alt') {
  try {
    const universeTypeText = universeType === 'bluechip' ? '蓝筹币' : '山寨币';
    await ctx.reply(`🔍 正在扫描过去 30 天的轧空结构（${universeTypeText}）...`);

    const results = await scanService.scanTopN(15, 30, universeType);

    if (results.length === 0) {
      await ctx.reply(
        '📊 过去 30 天内未检测到明显的轧空结构。\n\n' +
        '可能原因：\n' +
        '• 市场结构相对稳定\n' +
        '• 数据源暂时不可用\n\n' +
        '建议稍后重试或查看其他功能。',
        {
          reply_markup: new InlineKeyboard()
            .text('🔄 重新扫描', 'squeeze')
            .row()
            .text('🔙 返回主菜单', 'main_menu'),
        }
      );
      return;
    }

    // 格式化列表输出
    let message = `📌 过去30天「疑似 Short Squeeze（轧空）」Top ${results.length}\n\n`;
    
    results.forEach((item, index) => {
      const summary = scanService.generateSummary(item.features, item.scoreBreakdown);
      const typeEmoji = item.squeezeType === 'short_squeeze_like' ? '🔺' : 
                       item.squeezeType === 'long_squeeze_like' ? '🔻' : '➡️';
      message += `${index + 1}) ${item.symbol} | ${item.score} | ${typeEmoji} ${summary}\n`;
    });

    message += `\n💡 点击任意币种查看"详细结构报告"（需解锁）`;

    // 构建 Inline Keyboard
    const keyboard = new InlineKeyboard();
    results.forEach((item, index) => {
      if (index % 2 === 0) {
        keyboard.text(`${item.symbol} (${item.score})`, `squeeze_detail_${item.symbol}`);
      } else {
        keyboard.text(`${item.symbol} (${item.score})`, `squeeze_detail_${item.symbol}`).row();
      }
    });
    keyboard.row().text('🔄 重新扫描', 'squeeze').text('🔙 返回主菜单', 'main_menu');

    await ctx.reply(message, { reply_markup: keyboard });
  } catch (error) {
    logger.error({ error }, 'Failed to handle squeeze list');
    const prompt = handleDataError(error, {
      retryAction: 'squeeze',
      backAction: 'main_menu',
    });
    await ctx.reply(prompt.message, { reply_markup: prompt.keyboard });
  }
}

/**
 * 处理单个 ticker 详情（付费阶段）
 */
async function handleSqueezeDetail(
  ctx: any,
  symbol: string,
  scanService: SqueezeScanService,
  cacheService: SqueezeCacheService,
  deepseek: DeepSeekClient,
  guard: EntitlementGuard
) {
  const userId = ctx.from?.id;
  if (!userId) return;

  // 检查权限
  if (!guard.isUnlocked(userId)) {
    await ctx.reply(
      `🔒 查看 ${symbol} 的详细结构分析需要解锁\n\n` +
      `💳 解锁方式：\n` +
      `• 2999 Stars：终身解锁全部功能\n` +
      `• 或 Twitter 私信 @Ocean_Jackon 获取邀请码免费体验\n\n` +
      `输入邀请码：Ocean001`,
      {
        reply_markup: new InlineKeyboard()
          .text('💎 解锁（Stars）', 'pay')
          .text('🎫 输入邀请码', `squeeze_code_${symbol}`)
          .row()
          .text('🔙 返回列表', 'squeeze'),
      }
    );
    return;
  }

  try {
    await ctx.reply(`📊 正在分析 ${symbol} 的详细结构...`);

    // 获取详细特征和得分
    const { features, breakdown, squeezeType } = await scanService.getTickerDetails(symbol, 30);

    // 调用 DeepSeek 分析
    const analysis = await generateDeepSeekAnalysis(
      symbol,
      features,
      breakdown,
      squeezeType,
      deepseek
    );

    // 格式化输出（包含标签Summary）
    const message = formatSqueezeAnalysis(analysis, breakdown, symbol, cacheService);

    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: new InlineKeyboard()
        .text('🔄 重新分析', `squeeze_detail_${symbol}`)
        .text('🔙 返回列表', 'squeeze'),
    });
  } catch (error) {
    logger.error({ error, symbol }, 'Failed to analyze squeeze detail');
    const prompt = handleDataError(error, {
      retryAction: `squeeze_detail_${symbol}`,
      backAction: 'squeeze',
    });
    await ctx.reply(prompt.message, { reply_markup: prompt.keyboard });
  }
}

/**
 * 生成 DeepSeek 分析
 */
async function generateDeepSeekAnalysis(
  symbol: string,
  features: any,
  breakdown: any,
  squeezeType: string,
  deepseek: DeepSeekClient
): Promise<SqueezeAnalysis> {
  try {
    const prompt = buildSqueezePrompt(symbol, features, breakdown, squeezeType);
    const response = await deepseek.analyzeWithPrompt(SQUEEZE_SYSTEM_PROMPT, prompt);

    // 解析 JSON 响应
    let analysis: SqueezeAnalysis;
    try {
      const parsed = JSON.parse(response);
      analysis = {
        ticker: parsed.ticker || symbol,
        squeezeType: parsed.structure || squeezeType,
        score: parsed.score || breakdown.total,
        confidence: parsed.confidence || 70,
        keySignals: parsed.evidence || parsed.keySignals || [],
        why: parsed.interpretation || '基于量化指标计算得出',
        whatToWatch: parsed.whatToWatch || [],
        missingData: parsed.missingData || [],
        disclaimer: parsed.disclaimer || '非投资建议',
      };
    } catch (parseError) {
      logger.warn({ parseError, response }, 'Failed to parse DeepSeek response');
      // 降级：使用规则判断
      analysis = {
        ticker: symbol,
        squeezeType: squeezeType as any,
        score: breakdown.total,
        confidence: 60,
        keySignals: generateFallbackSignals(features, breakdown),
        why: '基于量化指标计算得出，AI 分析暂时不可用',
        whatToWatch: ['关注 OI 变化', '关注多空比', '关注基差'],
        missingData: [],
        disclaimer: '非投资建议',
      };
    }

    return analysis;
  } catch (error) {
    logger.error({ error, symbol }, 'Failed to generate DeepSeek analysis');
    throw error;
  }
}

/**
 * 格式化分析结果
 */
function formatSqueezeAnalysis(
  analysis: SqueezeAnalysis,
  breakdown: any,
  symbol: string,
  cacheService: SqueezeCacheService
): string {
  // 从缓存获取当前ticker的标签和风险&可信度（E5.3 & F5.3：详情页Summary）
  let labelSummary = '';
  let riskSummary = '';
  try {
    const cache = cacheService.getCache();
    if (cache) {
      const cacheItem = cache.list.find(item => item.ticker.toUpperCase() === symbol.toUpperCase());
      if (cacheItem) {
        const label = squeezeLabelEngine.generateLabelFromCacheItem(cacheItem);
        if (label.fullLabel) {
          labelSummary = label.fullLabel + '\n';
        }
        
        // 使用 Risk Engine 生成风险&可信度（F5.3：详情页完整格式）
        riskSummary = squeezeRiskEngine.generateDetailDisplay(cacheItem) + '\n\n';
      }
    }
  } catch (error) {
    logger.debug({ error, symbol }, 'Failed to get label from cache');
  }

  const structureEmoji = {
    short_squeeze_like: '🔺',
    long_squeeze_like: '🔻',
    neutral: '➡️',
  }[analysis.squeezeType] || '➡️';

  const structureText = {
    short_squeeze_like: 'Short Squeeze（轧空倾向）',
    long_squeeze_like: 'Long Squeeze（多头拥挤挤压风险）',
    neutral: 'Neutral（中性）',
  }[analysis.squeezeType] || 'Neutral';

  let message = `📊 ${analysis.ticker} 详细结构分析\n\n`;
  
  // E5.3：详情页顶部Summary（完整但仍一句话）
  if (labelSummary) {
    message += labelSummary;
  }
  
  // F5.3：风险等级 & 可信度
  if (riskSummary) {
    message += riskSummary;
  }
  
  message += `结构：${structureEmoji} ${structureText}\n`;
  message += `总分：${analysis.score}/100\n`;
  message += `置信度：${analysis.confidence}%\n\n`;

  message += `📈 分项得分：\n`;
  message += `• OI 节奏：${breakdown.oi_rhythm}/25\n`;
  message += `• 多空反转：${breakdown.ls_ratio_reversal}/25\n`;
  message += `• 主动买量：${breakdown.taker_buy_bias}/25\n`;
  message += `• 基差扩大：${breakdown.basis_expansion}/25\n\n`;

  message += `🔑 量化证据：\n`;
  analysis.keySignals.forEach((signal, i) => {
    message += `${i + 1}. ${signal}\n`;
  });

  message += `\n💡 解释：\n${analysis.why}\n\n`;

  message += `👀 关注点：\n`;
  analysis.whatToWatch.forEach((watch, i) => {
    message += `${i + 1}. ${watch}\n`;
  });

  if (analysis.missingData.length > 0) {
    message += `\n⚠️ 缺失数据：${analysis.missingData.join(', ')}\n`;
  }

  message += `\n⚠️ ${analysis.disclaimer}\n\n`;
  message += `数据来源: CoinGlass API\n分析引擎: DeepSeek AI`;

  return message;
}

/**
 * 生成降级信号（规则判断）
 */
function generateFallbackSignals(features: any, breakdown: any): string[] {
  const signals: string[] = [];

  if (breakdown.oi_rhythm >= 16) {
    signals.push(`OI: drawdown=${formatPercent(features.oi_drawdown_pct)}, rebound=${formatPercent(features.oi_rebound_from_min_pct)}`);
  }
  if (breakdown.ls_ratio_reversal >= 14) {
    signals.push(`LS: last=${features.ls_ratio_last.toFixed(2)}, p10=${features.ls_ratio_p10.toFixed(2)}`);
  }
  if (breakdown.basis_expansion >= 10) {
    signals.push(`Basis: last=${formatPercent(features.basis_last)}, jump3d=${formatPercent(features.basis_last)}`);
  }
  if (breakdown.taker_buy_bias >= 16) {
    signals.push(`Taker: buy_ratio=${formatPercent(features.taker_buy_ratio_last)}`);
  }

  if (signals.length === 0) {
    signals.push('结构信号较弱，各项指标未达到显著阈值');
  }

  return signals;
}
