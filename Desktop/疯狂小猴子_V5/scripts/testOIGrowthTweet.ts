import * as dotenv from 'dotenv';
import { CoinGlassClient } from '../src/clients/coinglass.client';
import { BinanceUniverseService } from '../src/services/binanceUniverse.service';
import { OIGrowthService } from '../src/services/oiGrowthService';
import { ContractSnapshotService } from '../src/services/contractSnapshot.service';
import { TweetContentService } from '../src/services/tweetContent.service';
import { XTweetOAuth1Service } from '../src/services/xTweetOAuth1.service';
import { SnapshotValidator } from '../src/utils/snapshotValidator';
import { logger } from '../src/utils/logger';
import { LiquidationService } from '../src/services/liquidation.service';
import { DeepSeekClient } from '../src/clients/deepseek.client';
import { env } from '../src/config/env';

// 加载环境变量
dotenv.config();

/**
 * 测试新的 OI 增长选币逻辑并发布推文
 */
async function testOIGrowthTweet() {
  try {
    logger.info('🧪 开始测试 OI 增长选币逻辑...');

    // 初始化服务
    const coinglassClient = new CoinGlassClient();
    const binanceUniverseService = new BinanceUniverseService(coinglassClient);
    const oiGrowthService = new OIGrowthService(coinglassClient, binanceUniverseService);
    const liquidationService = new LiquidationService(coinglassClient);
    const contractSnapshotService = new ContractSnapshotService(coinglassClient, liquidationService);
    const deepseek = new DeepSeekClient(
      env.DEEPSEEK_API_KEY,
      env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions'
    );
    const tweetContentService = new TweetContentService(deepseek, coinglassClient);
    const oauth1TweetService = new XTweetOAuth1Service();

    // 1. 选择最佳候选
    logger.info('📊 选择 4h OI 增长最大的候选...');
    const selected = await oiGrowthService.selectBestCandidate();

    if (!selected) {
      logger.warn('❌ 未找到符合条件的候选，测试结束');
      return;
    }

    logger.info({
      symbol: selected.symbol,
      instrumentId: selected.instrumentId,
      exchangeName: selected.exchangeName,
      oiDeltaUsd: selected.oiDeltaUsd,
      currentOIUsd: selected.currentOIUsd,
      prevOIUsd: selected.prevOIUsd,
    }, '✅ 选中的候选');

    // 2. 获取合约快照
    logger.info({ symbol: selected.symbol }, '📸 获取合约快照...');
    const snapshot = await contractSnapshotService.getContractSnapshot(selected.symbol);

    // 3. 数据完整性校验
    const validation = SnapshotValidator.validate(snapshot);
    if (!validation.isValid) {
      logger.error({
        symbol: selected.symbol,
        missingFields: validation.missingFields,
        invalidFields: validation.invalidFields,
      }, '❌ 数据校验失败');
      return;
    }

    logger.info('✅ 数据校验通过');

    // 4. 获取历史数据（使用与 xAutoTweetJob 相同的方法）
    logger.info('📊 获取历史数据...');
    const pairSymbol = `${selected.symbol}USDT`;
    const [fundingRateHistory, positionRatioHistory, takerHistory] = await Promise.all([
      coinglassClient.getFundingRateOhlcHistory({
        symbol: selected.symbol.toUpperCase(),
        exchange: 'Binance',
        interval: '4h',
        limit: 6,
      }),
      coinglassClient.getTopLongShortPositionRatioHistory({
        exchange: 'Binance',
        symbol: pairSymbol,
        interval: '4h',
        limit: 2,
      }),
      coinglassClient.getTakerBuySellVolumeHistory({
        exchange: 'Binance',
        symbol: pairSymbol,
        interval: '4h',
        limit: 1,
      }),
    ]);

    const historicalData = {
      fundingRateHistory: fundingRateHistory || [],
      positionRatioHistory: positionRatioHistory || [],
      takerHistory: takerHistory || [],
    };

    // 5. 生成推文内容
    logger.info('✍️ 生成推文内容...');
    const tweetContent = await tweetContentService.generateTweet(
      snapshot,
      historicalData
    );

    logger.info({ contentLength: tweetContent.length }, '✅ 推文内容生成完成');

    // 6. 显示推文内容（预览）
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('📝 推文内容预览:');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(tweetContent);
    console.log('═══════════════════════════════════════════════════════════\n');

    // 7. 询问是否发送（如果是测试模式，可以设置为 PREFLIGHT_MODE）
    if (env.PREFLIGHT_MODE) {
      logger.info('⚠️ PREFLIGHT_MODE=true，仅预览，不发送推文');
      return;
    }

    // 8. 发送推文（账户 A）
    logger.info('🚀 发送推文到账户 A...');
    try {
      const result = await oauth1TweetService.sendTweet(tweetContent, 'accountA');

      logger.info({
        tweetId: result.tweetId,
        url: result.url,
      }, '✅ 推文发送成功');
      
      console.log(`\n✅ 推文已发布！`);
      console.log(`📱 Tweet ID: ${result.tweetId}`);
      console.log(`🔗 URL: ${result.url}\n`);
    } catch (error: any) {
      logger.error({ error: error.message }, '❌ 推文发送失败');
      console.log(`\n❌ 推文发送失败: ${error.message}\n`);
    }

  } catch (error) {
    logger.error({ error }, '❌ 测试失败');
    console.error('❌ 测试失败:', error);
    process.exit(1);
  }
}

// 运行测试
testOIGrowthTweet()
  .then(() => {
    logger.info('✅ 测试完成');
    process.exit(0);
  })
  .catch((error) => {
    logger.error({ error }, '❌ 测试异常');
    process.exit(1);
  });

