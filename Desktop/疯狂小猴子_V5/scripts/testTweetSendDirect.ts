import * as dotenv from 'dotenv';
import { CoinGlassClient } from '../src/clients/coinglass.client';
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
 * 直接测试推文发送（使用指定币种）
 */
async function testTweetSendDirect(symbol: string = 'BTC') {
  try {
    logger.info({ symbol }, '🧪 开始测试推文发送...');

    // 初始化服务
    const coinglassClient = new CoinGlassClient();
    const liquidationService = new LiquidationService(coinglassClient);
    const contractSnapshotService = new ContractSnapshotService(coinglassClient, liquidationService);
    const deepseek = new DeepSeekClient(
      env.DEEPSEEK_API_KEY,
      env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions'
    );
    const tweetContentService = new TweetContentService(deepseek, coinglassClient);
    const oauth1TweetService = new XTweetOAuth1Service();

    // 1. 获取合约快照（使用基础符号，service 会自动转换为交易对）
    logger.info({ symbol }, '📸 获取合约快照...');
    let snapshot;
    try {
      snapshot = await contractSnapshotService.getContractSnapshot(symbol);
    } catch (error: any) {
      // 如果失败，尝试使用完整交易对名称
      if (error.message && error.message.includes('不支持')) {
        const pairSymbol = `${symbol}USDT`;
        logger.info({ pairSymbol }, '尝试使用完整交易对名称...');
        snapshot = await contractSnapshotService.getContractSnapshot(pairSymbol);
      } else {
        throw error;
      }
    }

    // 2. 数据完整性校验
    const validation = SnapshotValidator.validate(snapshot);
    if (!validation.isValid) {
      logger.error({
        symbol,
        missingFields: validation.missingFields,
        invalidFields: validation.invalidFields,
      }, '❌ 数据校验失败');
      return;
    }

    logger.info('✅ 数据校验通过');

    // 3. 获取历史数据
    logger.info('📊 获取历史数据...');
    const pairSymbol = `${symbol}USDT`;
    const [fundingRateHistory, positionRatioHistory, takerHistory] = await Promise.all([
      coinglassClient.getFundingRateOhlcHistory({
        symbol: symbol.toUpperCase(),
        exchange: 'Binance',
        interval: '4h',
        limit: 6,
      }).catch(() => []),
      coinglassClient.getTopLongShortPositionRatioHistory({
        exchange: 'Binance',
        symbol: pairSymbol,
        interval: '4h',
        limit: 2,
      }).catch(() => []),
      coinglassClient.getTakerBuySellVolumeHistory({
        exchange: 'Binance',
        symbol: pairSymbol,
        interval: '4h',
        limit: 1,
      }).catch(() => []),
    ]);

    const historicalData = {
      fundingRateHistory: fundingRateHistory || [],
      positionRatioHistory: positionRatioHistory || [],
      takerHistory: takerHistory || [],
    };

    // 4. 生成推文内容
    logger.info('✍️ 生成推文内容...');
    const tweetContent = await tweetContentService.generateTweet(
      snapshot,
      historicalData
    );

    logger.info({ contentLength: tweetContent.length }, '✅ 推文内容生成完成');

    // 5. 显示推文内容（预览）
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('📝 推文内容预览:');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(tweetContent);
    console.log('═══════════════════════════════════════════════════════════\n');

    // 6. 检查是否为预发布模式
    if (env.PREFLIGHT_MODE) {
      logger.info('⚠️ PREFLIGHT_MODE=true，仅预览，不发送推文');
      return;
    }

    // 7. 发送推文（账户 A）
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
      throw error;
    }

  } catch (error) {
    logger.error({ error }, '❌ 测试失败');
    console.error('❌ 测试失败:', error);
    process.exit(1);
  }
}

// 从命令行参数获取币种，默认为 BTC
const symbol = process.argv[2] || 'BTC';

// 运行测试
testTweetSendDirect(symbol)
  .then(() => {
    logger.info('✅ 测试完成');
    process.exit(0);
  })
  .catch((error) => {
    logger.error({ error }, '❌ 测试异常');
    process.exit(1);
  });

