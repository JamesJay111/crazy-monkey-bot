import { Bot, InlineKeyboard } from 'grammy';
import { logger } from '../utils/logger';
import { initDatabase } from '../db/init';
import { env } from '../config/env';
import { CoinGlassClient } from '../clients/coinglass.client';
import { CoinGlassService } from '../services/coinglass.service';
import { DeepSeekClient } from '../clients/deepseek.client';
import { UserRepository } from '../repositories/user.repository';
import { EntitlementGuard } from '../guards/entitlement.guard';
import { SqueezeService } from '../services/squeeze.service';
import { SignalEngine } from '../services/signalEngine.service';
import { SqueezeScanService } from '../services/squeezeScan.service';
import { SqueezeCacheService } from '../services/squeezeCache.service';
import { SqueezeSchedulerService } from '../services/squeezeScheduler.service';
import { SqueezePushService } from '../services/squeezePush.service';
import { SubscriptionService } from '../services/subscriptionService.service';
import { ETFService } from '../services/etf.service';
import { ETFDailyReportService } from '../services/etfDailyReport.service';
import { FundingService } from '../services/funding.service';
import { ContractService } from '../services/contract.service';
import { registerStartRoute } from '../routes/start';
import { registerHelpRoute } from '../routes/help';
import { registerPayRoute } from '../routes/pay';
import { registerCodeRoute } from '../routes/code';
import { registerSqueezeRoute } from '../routes/squeeze';
import { registerETFRoute } from '../routes/etf';
import { registerFundingRoute } from '../routes/funding';
import { registerContractRoute } from '../routes/contract';
import { registerTickerDetailsCallbacks } from '../routes/tickerDetails';
import { registerBalanceRoute } from '../routes/balance';
import { registerSupportRoute } from '../routes/support';
import { registerSubscriptionRoute } from '../routes/subscription';
import { registerCoinGlassCommands } from '../commands/coinglass.commands';
import { registerBotCommands } from '../commands/menu.commands';
import { isValidInviteCode, isValidTicker, normalizeTicker } from '../utils/validator';
import { BinanceUniverseService } from '../services/binanceUniverse.service';
import { TakerGrowthService } from '../services/takerGrowth.service';
import { ContractSnapshotService } from '../services/contractSnapshot.service';
import { TweetContentService } from '../services/tweetContent.service';
import { XTweetService } from '../services/xTweet.service';
import { XAutoTweetJobService } from '../services/xAutoTweetJob.service';
import { TweetForwardJobService } from '../services/tweetForwardJob.service';
import { MacroUsTweetJobService } from '../services/macroUsTweetJob.service';
import { XTweetOAuth1Service } from '../services/xTweetOAuth1.service';
import { MacroLarkPushService } from '../services/macroLarkPush.service';
import { BinanceOILarkAlertService } from '../services/binanceOILarkAlert.service';
import { OIAlertOrchestrator } from '../services/oiAlert/orchestrator';
import { ETFTwitterPushService } from '../services/etfTwitterPush.service';
import { MacroNewsPushService } from '../services/macroNewsPush.service';
import { MacroNewsWebhookPushService } from '../services/macroNewsWebhookPush.service';

// 初始化数据库
const db = initDatabase(env.DB_PATH);

// 初始化客户端（使用新的生产级 Client）
const coinglassClient = new CoinGlassClient();
const coinglassService = new CoinGlassService(coinglassClient);
const deepseek = new DeepSeekClient(
  env.DEEPSEEK_API_KEY,
  env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions'
);

// 初始化 Repository
const userRepo = new UserRepository(db);

// 初始化 Guard
const guard = new EntitlementGuard(userRepo);

// 初始化 Services（使用新的 CoinGlassService）
const squeezeScanService = new SqueezeScanService(coinglassClient);
const squeezeCacheService = new SqueezeCacheService('./cache');

// 创建 Bot（推送服务需要）
const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

// 初始化订阅服务
const subscriptionService = new SubscriptionService(db);

// 初始化推送服务
const squeezePushService = new SqueezePushService(bot, subscriptionService, './cache');

// 初始化定时扫描服务
const squeezeSchedulerService = new SqueezeSchedulerService(
  squeezeScanService,
  squeezeCacheService,
  coinglassClient,
  squeezePushService
);
const squeezeService = new SqueezeService(coinglassClient, deepseek); // 保留旧服务以兼容
const etfService = new ETFService(coinglassClient, deepseek);
// 【新增】传递 DeepSeek 客户端以支持分析文本生成
const etfDailyReportService = new ETFDailyReportService(etfService, deepseek);
const fundingService = new FundingService(coinglassClient);
const contractService = new ContractService(coinglassClient, deepseek);

// 初始化 X 自动发推 Job 相关服务
import { LiquidationService } from '../services/liquidation.service';
import { FundingNegativeOIService } from '../services/fundingNegativeOIService';
import { OIGrowthService } from '../services/oiGrowthService';
const liquidationService = new LiquidationService(coinglassClient);
const contractSnapshotService = new ContractSnapshotService(coinglassClient, liquidationService);
const binanceUniverseService = new BinanceUniverseService(coinglassClient);
const fundingNegativeOIService = new FundingNegativeOIService(coinglassClient, binanceUniverseService);
const oiGrowthService = new OIGrowthService(coinglassClient, binanceUniverseService);
const tweetContentService = new TweetContentService(deepseek, coinglassClient);
const xTweetService = new XTweetService();
const xAutoTweetJob = new XAutoTweetJobService(
  binanceUniverseService,
  fundingNegativeOIService,
  oiGrowthService,
  contractSnapshotService,
  tweetContentService,
  xTweetService,
  coinglassClient
);

// 初始化推文转发 Job（账户A → B/C）
const tweetForwardJob = new TweetForwardJobService();

// 初始化宏观事件自动推送 Job（Twitter，每 2 小时）
const xTweetOAuth1ServiceInstance = new XTweetOAuth1Service();
const macroUsTweetJob = new MacroUsTweetJobService(
  coinglassClient,
  deepseek,
  xTweetOAuth1ServiceInstance,
  db
);

// 初始化宏观事件 Lark 推送服务（每 10 分钟）
const macroLarkPushService = new MacroLarkPushService(
  coinglassClient,
  deepseek,
  db,
  macroUsTweetJob
);

// 初始化 Binance OI 异动推送服务（每 10 分钟）
const binanceOILarkAlertService = new BinanceOILarkAlertService(
  coinglassClient,
  deepseek,
  db
);

// 初始化 ETF Twitter 多语言推送服务（每天北京时间 15:00）
const etfTwitterPushService = new ETFTwitterPushService(
  etfService,
  xTweetOAuth1ServiceInstance,
  db
);

// 初始化宏观新闻推送服务（每 2 小时扫描一次）
// 生产模式：推送到 Twitter 三账户（中文/英文/韩语）
const macroNewsPushService = new MacroNewsPushService(
  coinglassClient,
  deepseek,
  xTweetOAuth1ServiceInstance,
  db,
  { testMode: false } // 生产模式，推送到 Twitter
);

// 初始化宏观新闻 Webhook 实时推送服务（每 10 分钟扫描一次）
// 实时推送所有新闻类型到 Webhook（中文/英文/韩语分开发送）
const macroNewsWebhookPushService = new MacroNewsWebhookPushService(
  coinglassClient,
  deepseek,
  db
);

// 新架构 Orchestrator（如果启用）
let oiAlertOrchestrator: OIAlertOrchestrator | null = null;

// Bot 已在上面创建（用于推送服务）

// 注册路由（必须在注册命令菜单之前）
registerStartRoute(bot);
registerHelpRoute(bot);
registerPayRoute(bot, guard);
registerCodeRoute(bot, guard, userRepo);
registerBalanceRoute(bot, userRepo, guard);
registerSupportRoute(bot);
registerSubscriptionRoute(bot, subscriptionService);
registerSqueezeRoute(bot, squeezeScanService, squeezeCacheService, contractService, deepseek, guard);
registerETFRoute(bot, etfService, guard);
registerFundingRoute(bot, fundingService, contractService, guard);
registerContractRoute(bot, contractService, guard);

// 注册统一的 ticker 详情 callback 处理
registerTickerDetailsCallbacks(bot, contractService, guard);

// 注册 CoinGlass 命令
registerCoinGlassCommands(bot, coinglassService);

// 处理文本消息（邀请码和 Ticker 查询）
bot.on('message:text', async (ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId) {
    await next();
    return;
  }

  // 确保用户存在
  userRepo.getOrCreate(userId, ctx.from.username);

  const text = ctx.message.text.trim();

  // 检查是否是邀请码
  if (isValidInviteCode(text)) {
    guard.unlockByInviteCode(userId);
    await ctx.reply('✅ 解锁成功！现在可以使用全部功能了。');
    return;
  }

  // 检查是否是有效的 Ticker（用于合约查询）
  if (isValidTicker(text)) {
    const ticker = normalizeTicker(text);
    // 调用合约查询处理（从 contract 路由导入）
    const { handleContractQuery } = await import('../routes/contract');
    await handleContractQuery(ctx, ticker, contractService, guard);
    return;
  }

  // 其他文本消息继续传递
  await next();
});

// 处理支付成功
bot.on('pre_checkout_query', async (ctx) => {
  await ctx.answerPreCheckoutQuery(true);
});

// 处理支付成功（使用 update 过滤器）
bot.on('message:successful_payment', async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  guard.unlockByStars(userId);
  await ctx.reply('✅ 支付成功！已解锁全部功能。');
});

// 错误处理（全局兜底）
bot.catch(async (err) => {
  const ctx = err.ctx;
  logger.error({ err: err.error, update: ctx.update }, 'Bot Error');
  
  // 使用统一的错误处理
  const { handleDataError } = await import('../utils/errorHandler');
  const prompt = handleDataError(err.error, {
    backAction: 'main_menu',
  });
  
  ctx.reply(prompt.message, {
    reply_markup: prompt.keyboard,
  }).catch(() => {
    // 忽略回复失败
  });
});

// 启动 Bot
async function start() {
  try {
    logger.info('🤖 Bot 启动中...');

    // 注册命令菜单（在启动前完成）
    try {
      await registerBotCommands(bot);
      logger.info('✅ 命令菜单注册成功');
    } catch (error) {
      logger.warn({ error }, '命令菜单注册失败，但继续启动');
    }

    // 健康检查（使用 /cg_ping 命令测试）
    try {
      const coins = await coinglassService.getFuturesSupportedCoins();
      logger.info({ coinCount: coins.length }, '✅ CoinGlass API 连接正常');
    } catch (error) {
      logger.warn({ error }, 'CoinGlass API 健康检查失败，但继续启动');
    }

    // 验证 bot 信息
    try {
      const botInfo = await bot.api.getMe();
      logger.info({ botInfo: { id: botInfo.id, username: botInfo.username } }, '✅ Bot Token 验证成功');
    } catch (error) {
      logger.error({ error }, '❌ Bot Token 验证失败');
      throw error;
    }

    // 启动 Bot
    logger.info('正在连接 Telegram API 并开始接收消息...');
    
    // bot.start() 会启动长轮询，不会立即返回
    // 使用 Promise 包装以确保启动完成
    bot.start().then(() => {
      logger.info('✅ Bot 已启动并开始接收消息');
    }).catch((error) => {
      logger.error({ error }, 'Bot start() 执行失败');
      throw error;
    });
    
    // 等待一小段时间确保启动完成
    await new Promise(resolve => setTimeout(resolve, 1000));
    logger.info('✅ Bot 启动流程完成');
    
    // 启动后台定时扫描任务（每4小时执行一次）
    squeezeSchedulerService.start(4 * 60 * 60 * 1000);
    logger.info('✅ 庄家轧空定时扫描任务已启动');
    
    // 启动 X 自动发推 Job（每8小时执行一次，启动后立即执行一次）
    xAutoTweetJob.start();
    logger.info('✅ X 自动发推任务已启动');
    
    // 启动 ETF Twitter 多语言推送服务（每天北京时间 15:00）
    etfTwitterPushService.start();
    logger.info('✅ ETF Twitter 多语言推送服务已启动（每天北京时间 15:00）');
    
    // 启动宏观事件自动推送 Job（Twitter，每2小时执行一次）
    macroUsTweetJob.start();
    logger.info('✅ 宏观事件自动推送任务已启动（Twitter，每2小时）');
    
    // 启动宏观事件 Lark 推送服务（每10分钟执行一次）
    macroLarkPushService.start();
    logger.info('✅ 宏观事件 Lark 推送任务已启动（每10分钟）');
    
    // 启动宏观新闻推送服务（每2小时扫描一次，推送所有新增新闻到 Twitter 三账户）
    macroNewsPushService.start();
    logger.info('✅ 宏观新闻推送服务已启动（每2小时扫描，推送到 Twitter 三账户）');
    
    // 启动宏观新闻 Webhook 实时推送服务（每10分钟扫描一次，实时推送所有新闻类型到 Webhook）
    macroNewsWebhookPushService.start();
    logger.info('✅ 宏观新闻 Webhook 实时推送服务已启动（每10分钟扫描，实时推送到 Webhook）');
    
    // 启动 Binance OI 异动推送服务（每10分钟执行一次）
    // 使用新的模块化 OI Alert Orchestrator（如果启用）
    const useNewOrchestrator = env.USE_NEW_OI_ALERT_ORCHESTRATOR === true;
    
    if (useNewOrchestrator) {
      oiAlertOrchestrator = new OIAlertOrchestrator(
        coinglassClient,
        deepseek,
        db,
        {
          scanIntervalMs: env.OI_ALERT_POLL_INTERVAL_MS,
          thresholdPercent: env.OI_ALERT_THRESHOLD_PERCENT,
          cooldownWindowMs: env.OI_ALERT_COOLDOWN_WINDOW_MS || 2 * 60 * 60 * 1000,
          interval: '4h',
          scanTopN: env.OI_ALERT_SCAN_TOP_N || 200,
          scanGroups: env.OI_ALERT_SCAN_GROUPS?.split(',') || ['major', 'meme', 'topOI'],
          useDynamicList: env.OI_ALERT_USE_DYNAMIC_LIST !== false,
          dryRun: env.OI_ALERT_DRY_RUN === true,
          concurrency: env.OI_ALERT_CONCURRENCY || 5,
        }
      );
      oiAlertOrchestrator.start();
      logger.info({
        dryRun: env.OI_ALERT_DRY_RUN === true,
        thresholdPercent: env.OI_ALERT_THRESHOLD_PERCENT,
      }, '✅ OI Alert Orchestrator 已启动（新架构）');
    } else {
      // 保留旧服务（向后兼容）
      binanceOILarkAlertService.start();
      logger.info('✅ Binance OI 异动推送任务已启动（每10分钟，旧架构）');
    }
    
    // 推文转发 Job 已废弃（不再从 Twitter API 读取推文）
    // 现在使用后端生成 → 缓存 → 多账户直接发布的流程（在 xAutoTweetJob 中实现）
    // tweetForwardJob.start(); // 已废弃
    logger.info('✅ 多账户发布功能已集成到自动发推任务中');
  } catch (error) {
    logger.error({ error }, 'Bot 启动失败');
    process.exit(1);
  }
}

// 优雅关闭
process.once('SIGINT', () => {
  logger.info('收到 SIGINT，正在关闭...');
  xAutoTweetJob.stop();
  tweetForwardJob.stop();
  etfTwitterPushService.stop();
  macroUsTweetJob.stop();
  macroLarkPushService.stop();
  macroNewsPushService.stop();
  macroNewsWebhookPushService.stop();
  // 停止服务（根据使用的架构）
  if (env.USE_NEW_OI_ALERT_ORCHESTRATOR === true && oiAlertOrchestrator) {
    oiAlertOrchestrator.stop();
  } else {
    binanceOILarkAlertService.stop();
  }
  bot.stop();
  db.close();
  process.exit(0);
});

process.once('SIGTERM', () => {
  logger.info('收到 SIGTERM，正在关闭...');
  xAutoTweetJob.stop();
  tweetForwardJob.stop();
  etfTwitterPushService.stop();
  macroUsTweetJob.stop();
  macroLarkPushService.stop();
  macroNewsPushService.stop();
  macroNewsWebhookPushService.stop();
  // 停止服务（根据使用的架构）
  if (env.USE_NEW_OI_ALERT_ORCHESTRATOR === true && oiAlertOrchestrator) {
    oiAlertOrchestrator.stop();
  } else {
    binanceOILarkAlertService.stop();
  }
  bot.stop();
  db.close();
  process.exit(0);
});

// 启动
start();

