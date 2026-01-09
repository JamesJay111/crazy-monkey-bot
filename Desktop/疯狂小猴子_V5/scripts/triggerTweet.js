/**
 * 手动触发 Twitter 发推任务
 * 用于测试或立即发送推文
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// 动态导入 TypeScript 模块
require('ts-node/register');

async function triggerTweet() {
  try {
    console.log('🚀 正在触发 Twitter 发推任务...\n');

    // 导入必要的模块
    const { CoinGlassClient } = require('../dist/src/clients/coinglass.client');
    const { DeepSeekClient } = require('../dist/src/clients/deepseek.client');
    const { BinanceUniverseService } = require('../dist/src/services/binanceUniverse.service');
    const { TakerGrowthService } = require('../dist/src/services/takerGrowth.service');
    const { ContractSnapshotService } = require('../dist/src/services/contractSnapshot.service');
    const { TweetContentService } = require('../dist/src/services/tweetContent.service');
    const { XTweetService } = require('../dist/src/services/xTweet.service');
    const { XAutoTweetJobService } = require('../dist/src/services/xAutoTweetJob.service');
    const { LiquidationService } = require('../dist/src/services/liquidation.service');
    const { env } = require('../dist/src/config/env');

    // 初始化服务
    const coinglassClient = new CoinGlassClient();
    const deepseek = new DeepSeekClient(
      env.DEEPSEEK_API_KEY,
      env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions'
    );
    const liquidationService = new LiquidationService(coinglassClient);
    const contractSnapshotService = new ContractSnapshotService(coinglassClient, liquidationService);
    const binanceUniverseService = new BinanceUniverseService(coinglassClient);
    const takerGrowthService = new TakerGrowthService(coinglassClient);
    const tweetContentService = new TweetContentService(deepseek);
    const xTweetService = new XTweetService();
    const xAutoTweetJob = new XAutoTweetJobService(
      binanceUniverseService,
      takerGrowthService,
      contractSnapshotService,
      tweetContentService,
      xTweetService
    );

    // 立即执行一次发推任务
    console.log('📊 开始执行发推任务...\n');
    await xAutoTweetJob.runTweetJobOnce();
    console.log('\n✅ 发推任务完成！');

  } catch (error) {
    console.error('❌ 发推任务失败:', error);
    process.exit(1);
  }
}

triggerTweet();

