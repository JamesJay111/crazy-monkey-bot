import * as dotenv from 'dotenv';
dotenv.config();

import { CoinGlassClient } from '../src/clients/coinglass.client';
import { ContractSnapshotService } from '../src/services/contractSnapshot.service';
import { TweetContentService } from '../src/services/tweetContent.service';
import { XTweetOAuth1Service } from '../src/services/xTweetOAuth1.service';
import { SnapshotValidator } from '../src/utils/snapshotValidator';
import { logger } from '../src/utils/logger';
import { LiquidationService } from '../src/services/liquidation.service';
import { DeepSeekClient } from '../src/clients/deepseek.client';
import { env } from '../src/config/env';
import { TweetPublishCacheService } from '../src/services/tweetPublishCache.service';
import { TweetTranslationService } from '../src/services/tweetTranslation.service';

/**
 * 直接测试推文发送（使用 FLOW 币种）
 */
async function testTweetSendFlow() {
  try {
    // 使用 BTC 测试（肯定在 Binance Futures 上）
    const baseSymbol = 'BTC';
    const symbol = 'BTCUSDT';
    logger.info({ symbol, baseSymbol }, '🧪 开始测试推文发送...');

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
    const publishCache = new TweetPublishCacheService();
    const translationService = new TweetTranslationService();

    // 1. 获取合约快照（使用基础符号）
    logger.info({ baseSymbol }, '📸 获取合约快照...');
    const snapshot = await contractSnapshotService.getContractSnapshot(baseSymbol);

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
    const pairSymbol = symbol; // 已经是完整交易对名称
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

    // 7. 创建发布缓存条目
    const publishId = publishCache.createEntry(baseSymbol, '4h', tweetContent);
    logger.info({ publishId, baseSymbol }, 'Created publish cache entry');

    // 8. 发布到账户 A（中文）
    logger.info('🚀 发送推文到账户 A...');
    try {
      const resultA = await oauth1TweetService.sendTweet(tweetContent, 'accountA');
      publishCache.markPublished(publishId, 'A', resultA.tweetId, resultA.url);
      
      logger.info({
        tweetId: resultA.tweetId,
        url: resultA.url,
      }, '✅ 账户 A 推文发送成功');
      
      console.log(`\n✅ 账户 A 推文已发布！`);
      console.log(`📱 Tweet ID: ${resultA.tweetId}`);
      console.log(`🔗 URL: ${resultA.url}\n`);

      // 9. 发布到账户 B（英文翻译）
      logger.info('🚀 翻译并发送推文到账户 B（英文）...');
      try {
        const translatedEn = await translationService.translateWithDeepSeek(tweetContent, 'en');
        const resultB = await oauth1TweetService.sendTweet(translatedEn, 'accountB');
        publishCache.markPublished(publishId, 'B', resultB.tweetId, resultB.url);
        
        logger.info({
          tweetId: resultB.tweetId,
          url: resultB.url,
        }, '✅ 账户 B 推文发送成功');
        
        console.log(`✅ 账户 B 推文已发布！`);
        console.log(`📱 Tweet ID: ${resultB.tweetId}`);
        console.log(`🔗 URL: ${resultB.url}\n`);
      } catch (error: any) {
        logger.error({ error: error.message }, '❌ 账户 B 推文发送失败');
        console.log(`❌ 账户 B 推文发送失败: ${error.message}\n`);
      }

      // 10. 发布到账户 C（韩文翻译）
      logger.info('🚀 翻译并发送推文到账户 C（韩文）...');
      try {
        const translatedKo = await translationService.translateWithDeepSeek(tweetContent, 'ko');
        const resultC = await oauth1TweetService.sendTweet(translatedKo, 'accountC');
        publishCache.markPublished(publishId, 'C', resultC.tweetId, resultC.url);
        
        logger.info({
          tweetId: resultC.tweetId,
          url: resultC.url,
        }, '✅ 账户 C 推文发送成功');
        
        console.log(`✅ 账户 C 推文已发布！`);
        console.log(`📱 Tweet ID: ${resultC.tweetId}`);
        console.log(`🔗 URL: ${resultC.url}\n`);
      } catch (error: any) {
        logger.error({ error: error.message }, '❌ 账户 C 推文发送失败');
        console.log(`❌ 账户 C 推文发送失败: ${error.message}\n`);
      }

    } catch (error: any) {
      logger.error({ error: error.message }, '❌ 账户 A 推文发送失败');
      console.log(`\n❌ 账户 A 推文发送失败: ${error.message}\n`);
      throw error;
    }

  } catch (error) {
    logger.error({ error }, '❌ 测试失败');
    console.error('❌ 测试失败:', error);
    process.exit(1);
  }
}

// 运行测试
testTweetSendFlow()
  .then(() => {
    logger.info('✅ 测试完成');
    process.exit(0);
  })
  .catch((error) => {
    logger.error({ error }, '❌ 测试异常');
    process.exit(1);
  });

