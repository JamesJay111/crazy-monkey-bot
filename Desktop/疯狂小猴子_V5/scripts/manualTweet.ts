/**
 * 手动触发 Twitter 发推任务
 * 用于测试或立即发送推文
 */

import * as path from 'path';
import * as dotenv from 'dotenv';

// 加载环境变量
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { CoinGlassClient } from '../src/clients/coinglass.client';
import { DeepSeekClient } from '../src/clients/deepseek.client';
import { BinanceUniverseService } from '../src/services/binanceUniverse.service';
import { FundingNegativeOIService } from '../src/services/fundingNegativeOIService';
import { ContractSnapshotService } from '../src/services/contractSnapshot.service';
import { TweetContentService } from '../src/services/tweetContent.service';
import { XTweetService } from '../src/services/xTweet.service';
import { XAutoTweetJobService } from '../src/services/xAutoTweetJob.service';
import { LiquidationService } from '../src/services/liquidation.service';
import { env } from '../src/config/env';
import { logger } from '../src/utils/logger';

async function triggerTweet() {
  try {
    console.log('🚀 正在触发 Twitter 发推任务...\n');

    // 初始化服务
    const coinglassClient = new CoinGlassClient();
    const deepseek = new DeepSeekClient(
      env.DEEPSEEK_API_KEY,
      env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions'
    );
    const liquidationService = new LiquidationService(coinglassClient);
    const contractSnapshotService = new ContractSnapshotService(coinglassClient, liquidationService);
    const binanceUniverseService = new BinanceUniverseService(coinglassClient);
    const fundingNegativeOIService = new FundingNegativeOIService(coinglassClient, binanceUniverseService);
    const tweetContentService = new TweetContentService(deepseek, coinglassClient);
    const xTweetService = new XTweetService();
    const xAutoTweetJob = new XAutoTweetJobService(
      binanceUniverseService,
      fundingNegativeOIService,
      contractSnapshotService,
      tweetContentService,
      xTweetService,
      coinglassClient
    );

    // 立即执行一次发推任务（强制发推，跳过幂等性检查）
    console.log('📊 开始执行发推任务（强制模式）...\n');
    await xAutoTweetJob.runTweetJobOnce(true);
    console.log('\n✅ 发推任务完成！');

  } catch (error) {
    console.error('❌ 发推任务失败:', error);
    logger.error({ error }, 'Manual tweet trigger failed');
    process.exit(1);
  }
}

triggerTweet();

