import * as dotenv from 'dotenv';
// 强制设置为 false（实际发送模式），必须在加载 .env 之前
process.env.PREFLIGHT_MODE = 'false';
// 加载 .env 文件（但 PREFLIGHT_MODE 已经被命令行覆盖）
dotenv.config();
// 再次确保为 false
process.env.PREFLIGHT_MODE = 'false';

import { CoinGlassClient } from '../src/clients/coinglass.client';
import { TweetContentService } from '../src/services/tweetContent.service';
import { XTweetOAuth1Service } from '../src/services/xTweetOAuth1.service';
import { logger } from '../src/utils/logger';
import { DeepSeekClient } from '../src/clients/deepseek.client';
import { env } from '../src/config/env';
import { TweetPublishCacheService } from '../src/services/tweetPublishCache.service';
import { TweetTranslationService } from '../src/services/tweetTranslation.service';
import { ContractSnapshot } from '../src/types';

/**
 * 使用 pairs-markets API 数据测试推文发送
 */
async function testTweetSendWithPairsMarkets() {
  try {
    const symbol = 'BTC';
    logger.info({ symbol }, '🧪 开始测试推文发送（使用 pairs-markets API）...');

    // 初始化服务
    const coinglassClient = new CoinGlassClient();
    const deepseek = new DeepSeekClient(
      env.DEEPSEEK_API_KEY,
      env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions'
    );
    const tweetContentService = new TweetContentService(deepseek, coinglassClient);
    const oauth1TweetService = new XTweetOAuth1Service();
    const publishCache = new TweetPublishCacheService();
    const translationService = new TweetTranslationService();

    // 1. 从 pairs-markets API 获取 BTC 数据
    logger.info({ symbol }, '📊 从 pairs-markets API 获取数据...');
    const pairsData = await coinglassClient.getFuturesPairsMarkets({ symbol });
    
    if (!Array.isArray(pairsData) || pairsData.length === 0) {
      logger.error('No pairs-markets data available');
      return;
    }

    // 找到 Binance 的数据
    const binanceData = pairsData.find((p: any) => p.exchange_name === 'Binance');
    if (!binanceData) {
      logger.error('No Binance data found in pairs-markets');
      return;
    }

    logger.info({
      instrumentId: binanceData.instrument_id,
      oiUsd: binanceData.open_interest_usd,
      fundingRate: binanceData.funding_rate,
    }, 'Got Binance data from pairs-markets');

    // 2. 构建合约快照（使用 pairs-markets 数据）
    const snapshot: ContractSnapshot = {
      symbol: symbol.toUpperCase(),
      pairSymbol: binanceData.instrument_id,
      exchange: 'Binance',
      oiUsd: parseFloat(String(binanceData.open_interest_usd || 0)),
      fundingRate: parseFloat(String(binanceData.funding_rate || 0)),
      nextFundingTime: binanceData.next_funding_time || null,
      fundingRateError: null,
      topAccountLongPercent: 0.5, // pairs-markets 没有这个数据，使用默认值
      topAccountShortPercent: 0.5,
      topAccountLongShortRatio: 1.0,
      takerBuyRatio: 0.5,
      takerSellRatio: 0.5,
      takerBuyVolUsd: parseFloat(String(binanceData.long_volume_usd || 0)),
      takerSellVolUsd: parseFloat(String(binanceData.short_volume_usd || 0)),
      exchangeTakerData: [],
      liquidation24h: {
        longUsd24h: parseFloat(String(binanceData.long_liquidation_usd_24h || 0)),
        shortUsd24h: parseFloat(String(binanceData.short_liquidation_usd_24h || 0)),
        netLongMinusShortUsd24h: parseFloat(String(binanceData.long_liquidation_usd_24h || 0)) - parseFloat(String(binanceData.short_liquidation_usd_24h || 0)),
      },
      isBinanceFutures: true,
      dataSource: 'CoinGlass',
    };

    logger.info('✅ 合约快照构建完成');

    // 3. 获取历史数据（用于深度分析）
    logger.info('📊 获取历史数据...');
    const pairSymbol = binanceData.instrument_id;
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

    // 6. 检查是否为预发布模式（直接读取 process.env，确保命令行参数生效）
    const preflightMode = process.env.PREFLIGHT_MODE === 'true';
    if (preflightMode) {
      logger.info('⚠️ PREFLIGHT_MODE=true，仅预览，不发送推文');
      return;
    }
    
    logger.info('🚀 PREFLIGHT_MODE=false，准备实际发送推文...');

    // 7. 创建发布缓存条目
    const publishId = publishCache.createEntry(symbol, '4h', tweetContent);
    logger.info({ publishId, symbol }, 'Created publish cache entry');

      // 8. 发布到账户 A（中文，使用默认 token，不传 accountKey）
      logger.info('🚀 发送推文到账户 A...');
      try {
        const resultA = await oauth1TweetService.sendTweet(tweetContent); // 不传 accountKey，使用默认账户 A
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
testTweetSendWithPairsMarkets()
  .then(() => {
    logger.info('✅ 测试完成');
    process.exit(0);
  })
  .catch((error) => {
    logger.error({ error }, '❌ 测试异常');
    process.exit(1);
  });

