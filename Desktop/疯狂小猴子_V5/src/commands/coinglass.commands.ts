import { Bot, InlineKeyboard } from 'grammy';
import { CoinGlassService } from '../services/coinglass.service';
import { formatLargeNumber, formatPercent } from '../utils/formatter';
import { logger } from '../utils/logger';
import { normalizeTicker } from '../utils/validator';

/**
 * 处理 cg_demo 命令
 */
async function handleCgDemo(ctx: any, ticker: string, service: CoinGlassService) {
  try {
    const normalizedTicker = normalizeTicker(ticker);
    await ctx.reply(`📊 正在获取 ${normalizedTicker} 的合约数据...`);

    // 检查币种是否支持
    const supportedCoins = await service.getFuturesSupportedCoins();
    if (!supportedCoins.includes(normalizedTicker)) {
      await ctx.reply(
        `❌ ${normalizedTicker} 不在支持的币种列表中\n\n` +
        `支持的币种示例: ${supportedCoins.slice(0, 10).join(', ')}\n\n` +
        `请检查 Ticker 是否正确，或输入 /cg_ping 查看完整列表`,
        {
          reply_markup: new InlineKeyboard().text('🔙 返回主菜单', 'main_menu'),
        }
      );
      return;
    }

    // 并行获取数据
    const [oiList, fundingList, longShortRatio] = await Promise.all([
      service.getOpenInterestExchangeList(normalizedTicker).catch(() => []),
      service.getFundingRateExchangeList(normalizedTicker).catch(() => []),
      service.getGlobalLongShortRatioHistory(normalizedTicker, '1h', 1).catch(() => []),
    ]);

    // 构建消息
    let message = `📊 ${normalizedTicker}（演示数据）\n\n`;

    // OI 数据
    if (oiList.length > 0) {
      const oiData = oiList[0];
      const oiUsd = parseFloat(oiData.open_interest_usd || '0');
      const oiChange = parseFloat(oiData.open_interest_change_percent_24h || '0');
      const exchange = oiData.exchange || '聚合';
      
      message += `📈 当前 OI（${exchange}）: ${formatLargeNumber(oiUsd)} USD\n`;
      message += `📊 OI 24h 变化: ${formatPercent(oiChange)}\n`;
    } else {
      message += `📈 当前 OI: 数据不可用\n`;
    }

    message += `\n`;

    // Funding Rate 数据
    if (fundingList.length > 0) {
      const fundingData = fundingList[0];
      const fundingRate = parseFloat(fundingData.funding_rate || '0');
      const exchange = fundingData.exchange || '聚合';
      
      message += `💹 当前资金费率（${exchange}）: ${formatPercent(fundingRate, 4)}\n`;
    } else {
      message += `💹 当前资金费率: 数据不可用\n`;
    }

    message += `\n`;

    // 多空比数据
    if (longShortRatio.length > 0) {
      const ratioData = longShortRatio[0];
      const ratio = parseFloat(ratioData.global_account_long_short_ratio || '1.0');
      
      message += `⚖️ 全网账户多空比（最新）: ${ratio.toFixed(2)}\n`;
    } else {
      message += `⚖️ 全网账户多空比: 数据不可用\n`;
    }

    message += `\n数据源: CoinGlass`;

    await ctx.reply(message, {
      reply_markup: new InlineKeyboard()
        .text('🔄 重新查询', `cg_demo_${normalizedTicker}`)
        .row()
        .text('🔙 返回主菜单', 'main_menu'),
    });
  } catch (error) {
    logger.error({ error, ticker }, 'cg_demo failed');
    await ctx.reply(
      `❌ 获取失败: ${error instanceof Error ? error.message : '未知错误'}\n\n` +
      `请检查 Ticker 是否正确，或稍后重试。`,
      {
        reply_markup: new InlineKeyboard().text('🔙 返回主菜单', 'main_menu'),
      }
    );
  }
}

/**
 * 注册 CoinGlass 相关命令
 */
export function registerCoinGlassCommands(bot: Bot, service: CoinGlassService) {
  /**
   * /cg_ping - 连通性验证
   */
  bot.command('cg_ping', async (ctx) => {
    try {
      await ctx.reply('🔍 正在检查 CoinGlass API 连通性...');

      const coins = await service.getFuturesSupportedCoins();
      const rateLimit = service.getRateLimitStatus();

      let message = '✅ CoinGlass 已连通\n\n';
      message += `📊 支持的币种数量: ${coins.length}\n`;
      message += `📋 前 10 个币种: ${coins.slice(0, 10).join(', ')}\n\n`;

      if (rateLimit.maxLimit !== null && rateLimit.useLimit !== null) {
        const usagePercent = ((rateLimit.useLimit / rateLimit.maxLimit) * 100).toFixed(1);
        message += `📈 API 限流状态:\n`;
        message += `   • 最大请求数: ${rateLimit.maxLimit}/分钟\n`;
        message += `   • 已使用: ${rateLimit.useLimit}/分钟\n`;
        message += `   • 使用率: ${usagePercent}%\n`;
      } else {
        message += `📈 API 限流状态: 未获取到限流信息\n`;
      }

      message += `\n数据来源: CoinGlass API v4.0`;

      await ctx.reply(message);
    } catch (error) {
      logger.error({ error }, 'CoinGlass ping failed');
      
      let errorMessage = '❌ CoinGlass 未连通\n\n';
      
      if (error instanceof Error) {
        if (error.message.includes('401') || error.message.includes('403')) {
          errorMessage += '**可能原因：**\n';
          errorMessage += '• API Key 无效或缺失\n';
          errorMessage += '• 请求头中缺少 CG-API-KEY\n';
          errorMessage += '• API Key 权限不足\n\n';
          errorMessage += '**解决方案：**\n';
          errorMessage += '1. 检查 .env 文件中的 COINGLASS_API_KEY\n';
          errorMessage += '2. 确认 API Key 在 CoinGlass 官网有效\n';
          errorMessage += '3. 检查 API Key 是否有访问权限';
        } else if (error.message.includes('429')) {
          errorMessage += '**可能原因：**\n';
          errorMessage += '• 请求频率超限\n\n';
          errorMessage += '**解决方案：**\n';
          errorMessage += '• 请稍后重试';
        } else if (error.message.includes('timeout') || error.message.includes('网络')) {
          errorMessage += '**可能原因：**\n';
          errorMessage += '• 网络连接问题\n';
          errorMessage += '• CoinGlass 服务暂时不可用\n\n';
          errorMessage += '**解决方案：**\n';
          errorMessage += '• 检查网络连接\n';
          errorMessage += '• 稍后重试';
        } else {
          errorMessage += `错误: ${error.message}`;
        }
      } else {
        errorMessage += '未知错误，请稍后重试';
      }

      await ctx.reply(errorMessage);
    }
  });

  /**
   * /cg_demo <ticker> - 演示数据回吐
   */
  bot.command('cg_demo', async (ctx) => {
    if (!ctx.message?.text) return;
    
    const args = ctx.message.text.split(' ').slice(1);
    const ticker = args[0];

    if (!ticker) {
      await ctx.reply(
        '📊 使用方式: /cg_demo <Ticker>\n\n' +
        '示例: /cg_demo BTC\n\n' +
        '⚠️ 请输入 Ticker（如 BTC），不要输入项目名称（如 比特币）',
        {
          reply_markup: new InlineKeyboard().text('🔙 返回主菜单', 'main_menu'),
        }
      );
      return;
    }

    await handleCgDemo(ctx, ticker, service);
  });

  // 处理 cg_demo 回调
  bot.callbackQuery(/^cg_demo_(.+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const ticker = ctx.match[1];
    await handleCgDemo(ctx, ticker, service);
  });
}
