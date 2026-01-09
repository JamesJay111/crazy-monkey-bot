import * as dotenv from 'dotenv';
dotenv.config();

import { CoinGlassClient } from '../src/clients/coinglass.client';
import { BinanceUniverseService } from '../src/services/binanceUniverse.service';
import { FundingNegativeOIService } from '../src/services/fundingNegativeOIService';
import { OIGrowthService } from '../src/services/oiGrowthService';
import { ContractSnapshotService } from '../src/services/contractSnapshot.service';
import { TweetContentService } from '../src/services/tweetContent.service';
import { XTweetService } from '../src/services/xTweet.service';
import { XAutoTweetJobService } from '../src/services/xAutoTweetJob.service';
import { LiquidationService } from '../src/services/liquidation.service';
import { DeepSeekClient } from '../src/clients/deepseek.client';
import { logger } from '../src/utils/logger';
import { env } from '../src/config/env';

/**
 * 测试 XAutoTweetJob 服务（实际发送推文）
 */
async function testXAutoTweet() {
  try {
    logger.info('🧪 开始测试 XAutoTweetJob 推文发送...');

    // 初始化服务（与 bot/index.ts 保持一致）
    const coinglassClient = new CoinGlassClient();
    const deepseek = new DeepSeekClient(
      env.DEEPSEEK_API_KEY,
      env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions'
    );
    const liquidationService = new LiquidationService(coinglassClient);
    const binanceUniverseService = new BinanceUniverseService(coinglassClient);
    const fundingNegativeOIService = new FundingNegativeOIService(coinglassClient, binanceUniverseService);
    const oiGrowthService = new OIGrowthService(coinglassClient, binanceUniverseService);
    const contractSnapshotService = new ContractSnapshotService(coinglassClient, liquidationService);
    const tweetContentService = new TweetContentService(deepseek, coinglassClient);
    const xTweetService = new XTweetService();

    // 创建 XAutoTweetJob 服务
    const xAutoTweetJob = new XAutoTweetJobService(
      binanceUniverseService,
      fundingNegativeOIService,
      oiGrowthService,
      contractSnapshotService,
      tweetContentService,
      xTweetService,
      coinglassClient
    );

    // 强制设置为非预发布模式
    process.env.PREFLIGHT_MODE = 'false';
    env.PREFLIGHT_MODE = false;

    logger.info('🚀 开始执行推文任务（强制运行，跳过幂等性检查）...');
    
    // 强制运行一次（跳过幂等性检查）
    await xAutoTweetJob.runTweetJobOnce(true);

    logger.info('✅ 推文任务执行完成');
  } catch (error) {
    logger.error({ error }, '❌ 测试失败');
    console.error('❌ 测试失败:', error);
    process.exit(1);
  }
}

// 运行测试
testXAutoTweet()
  .then(() => {
    logger.info('✅ 测试完成');
    process.exit(0);
  })
  .catch((error) => {
    logger.error({ error }, '❌ 测试异常');
    process.exit(1);
  });

