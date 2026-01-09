/**
 * 测试发布流程（FLOW/USDT）
 * 测试多账户直接发布系统
 */

import * as path from 'path';
import * as dotenv from 'dotenv';

// 加载环境变量
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { logger } from '../src/utils/logger';
import { CoinGlassClient } from '../src/clients/coinglass.client';
import { BinanceUniverseService } from '../src/services/binanceUniverse.service';
import { FundingNegativeOIService } from '../src/services/fundingNegativeOIService';
import { ContractSnapshotService } from '../src/services/contractSnapshot.service';
import { LiquidationService } from '../src/services/liquidation.service';
import { TweetContentService } from '../src/services/tweetContent.service';
import { DeepSeekClient } from '../src/clients/deepseek.client';
import { env } from '../src/config/env';
import { TweetPublishCacheService } from '../src/services/tweetPublishCache.service';
import { XTweetOAuth1Service } from '../src/services/xTweetOAuth1.service';
import { XTweetService } from '../src/services/xTweet.service';
import { TweetTranslationService } from '../src/services/tweetTranslation.service';
import { hasValidOAuth1Token } from '../src/services/xOAuth1.service';
import { smartTruncate } from '../src/utils/textTruncate';
import { SnapshotValidator } from '../src/utils/snapshotValidator';

/**
 * 测试发布 FLOW/USDT
 */
async function testPublishFlow() {
  try {
    console.log('🧪 测试发布流程 - FLOW/USDT\n');
    console.log('═══════════════════════════════════════════════════════════\n');

    // 初始化服务
    const coinglassClient = new CoinGlassClient();
    const binanceUniverseService = new BinanceUniverseService(coinglassClient);
    const fundingNegativeOIService = new FundingNegativeOIService(coinglassClient, binanceUniverseService);
    const liquidationService = new LiquidationService(coinglassClient);
    const snapshotService = new ContractSnapshotService(coinglassClient, liquidationService);
    const deepseek = new DeepSeekClient(
      env.DEEPSEEK_API_KEY,
      env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions'
    );
    const contentService = new TweetContentService(deepseek, coinglassClient);
    const publishCache = new TweetPublishCacheService();
    const oauth1TweetService = new XTweetOAuth1Service();
    const tweetService = new XTweetService();
    const translationService = new TweetTranslationService();

    const symbol = 'FLOW';
    console.log(`📊 测试交易对: ${symbol}/USDT\n`);

    // 1. 获取合约快照
    console.log('1️⃣ 获取合约快照数据...');
    const snapshot = await snapshotService.getContractSnapshot(symbol);
    console.log(`   ✅ 快照获取成功`);
    console.log(`   - OI: $${(snapshot.oiUsd / 1_000_000).toFixed(2)}M`);
    console.log(`   - Funding Rate: ${(snapshot.fundingRate * 100).toFixed(4)}%`);
    console.log(`   - Taker Buy: $${(snapshot.takerBuyVolUsd / 1_000_000).toFixed(2)}M`);
    console.log(`   - Taker Sell: $${(snapshot.takerSellVolUsd / 1_000_000).toFixed(2)}M`);
    console.log(`   - Top Long: ${snapshot.topAccountLongPercent.toFixed(2)}%`);
    console.log(`   - Top Short: ${snapshot.topAccountShortPercent.toFixed(2)}%`);
    console.log(`   - Top Ratio: ${snapshot.topAccountLongShortRatio.toFixed(2)}\n`);

    // 2. 数据完整性校验
    console.log('2️⃣ 数据完整性校验...');
    const validation = SnapshotValidator.validate(snapshot);
    if (!validation.isValid) {
      console.log(`   ❌ 校验失败:`);
      console.log(`   - 缺失字段: ${validation.missingFields.join(', ')}`);
      console.log(`   - 无效字段: ${validation.invalidFields.join(', ')}`);
      return;
    }
    console.log(`   ✅ 数据完整性校验通过\n`);

    // 3. 获取历史数据（用于深度分析）
    console.log('3️⃣ 获取历史数据...');
    let historicalData;
    try {
      const pairSymbol = `${symbol}USDT`;
      
      // 获取资金费率历史（6根，4h）
      const fundingHistory = await coinglassClient.getFundingRateOhlcHistory({
        symbol: symbol.toUpperCase(),
        interval: '4h',
        limit: 6,
      });
      
      // 获取持仓比历史（2根，用于对比）
      const positionHistory = await coinglassClient.getTopLongShortPositionRatioHistory({
        exchange: 'Binance',
        symbol: pairSymbol,
        interval: '4h',
        limit: 2,
      });

      historicalData = {
        fundingRateHistory: fundingHistory || [],
        positionRatioHistory: positionHistory || [],
        takerHistory: [],
      };
      console.log(`   ✅ 历史数据获取成功`);
      console.log(`   - 资金费率历史: ${fundingHistory?.length || 0} 根`);
      console.log(`   - 持仓比历史: ${positionHistory?.length || 0} 根\n`);
    } catch (error) {
      console.log(`   ⚠️  历史数据获取失败，将使用基础数据`);
      console.log(`   - 错误: ${error instanceof Error ? error.message : String(error)}\n`);
      historicalData = undefined;
    }

    // 4. 生成推文内容
    console.log('4️⃣ 生成推文内容...');
    const tweetContent = await contentService.generateTweet(snapshot, historicalData);
    console.log(`   ✅ 推文内容生成成功`);
    console.log(`   - 内容长度: ${tweetContent.length} 字符\n`);
    console.log('📝 推文内容预览:');
    console.log('─────────────────────────────────────────────────────────');
    console.log(tweetContent.substring(0, 500) + '...');
    console.log('─────────────────────────────────────────────────────────\n');

    // 5. 创建发布缓存条目
    console.log('5️⃣ 创建发布缓存条目...');
    const publishId = publishCache.createEntry(symbol, '4h', tweetContent);
    console.log(`   ✅ 缓存条目创建成功`);
    console.log(`   - Publish ID: ${publishId}\n`);

    // 6. 检查 Preflight 模式（从环境变量直接读取，优先使用命令行参数）
    const preflightModeEnv = process.env.PREFLIGHT_MODE;
    const preflightMode = preflightModeEnv === 'true' || (preflightModeEnv !== 'false' && env.PREFLIGHT_MODE);
    if (preflightMode) {
      console.log('⚠️  Preflight 模式已启用，不会实际发布到 Twitter\n');
      console.log('📋 缓存条目信息:');
      const cacheEntry = publishCache.getEntry(publishId);
      if (cacheEntry) {
        console.log(`   - Publish ID: ${cacheEntry.publishId}`);
        console.log(`   - Ticker: ${cacheEntry.ticker}`);
        console.log(`   - Created At: ${new Date(cacheEntry.createdAt).toLocaleString('zh-CN')}`);
        console.log(`   - Source Text Length: ${cacheEntry.sourceText.length}`);
        console.log(`   - Published A: ${cacheEntry.published.A}`);
        console.log(`   - Published B: ${cacheEntry.published.B}`);
        console.log(`   - Published C: ${cacheEntry.published.C}\n`);
      }
      console.log('✅ 测试完成（Preflight 模式）');
      return;
    }
    
    console.log('🚀 Preflight 模式已关闭，开始实际发布到 Twitter...\n');

    // 7. 发布到账户 A（中文）
    console.log('6️⃣ 发布到账户 A（中文）...');
    try {
      let resultA;
      if (hasValidOAuth1Token()) {
        resultA = await oauth1TweetService.sendTweet(tweetContent);
      } else {
        resultA = await tweetService.sendTweet(tweetContent);
      }
      publishCache.markPublished(publishId, 'A', resultA.tweetId, resultA.url);
      console.log(`   ✅ 账户 A 发布成功`);
      console.log(`   - Tweet ID: ${resultA.tweetId}`);
      console.log(`   - URL: ${resultA.url}\n`);
    } catch (error) {
      console.log(`   ❌ 账户 A 发布失败: ${error instanceof Error ? error.message : String(error)}\n`);
    }

    // 8. 发布到账户 B（英文）
    console.log('7️⃣ 发布到账户 B（英文）...');
    try {
      // 检查是否有缓存的翻译
      let translatedEn = publishCache.getTranslation(publishId, 'en');
      
      if (!translatedEn) {
        console.log(`   - 翻译为英文...`);
        translatedEn = await translationService.translateWithDeepSeek(tweetContent, 'en');
        publishCache.updateTranslation(publishId, 'en', translatedEn);
        console.log(`   ✅ 翻译完成并缓存`);
      } else {
        console.log(`   - 使用缓存的英文翻译`);
      }

      const finalTextB = smartTruncate(translatedEn, 280);
      const resultB = await oauth1TweetService.sendTweet(finalTextB, 'accountB');
      publishCache.markPublished(publishId, 'B', resultB.tweetId, resultB.url);
      console.log(`   ✅ 账户 B 发布成功`);
      console.log(`   - Tweet ID: ${resultB.tweetId}`);
      console.log(`   - URL: ${resultB.url}\n`);
    } catch (error) {
      console.log(`   ❌ 账户 B 发布失败: ${error instanceof Error ? error.message : String(error)}\n`);
    }

    // 9. 发布到账户 C（韩语）
    console.log('8️⃣ 发布到账户 C（韩语）...');
    try {
      // 检查是否有缓存的翻译
      let translatedKo = publishCache.getTranslation(publishId, 'ko');
      
      if (!translatedKo) {
        console.log(`   - 翻译为韩语...`);
        translatedKo = await translationService.translateWithDeepSeek(tweetContent, 'ko');
        publishCache.updateTranslation(publishId, 'ko', translatedKo);
        console.log(`   ✅ 翻译完成并缓存`);
      } else {
        console.log(`   - 使用缓存的韩语翻译`);
      }

      const finalTextC = smartTruncate(translatedKo, 280);
      const resultC = await oauth1TweetService.sendTweet(finalTextC, 'accountC');
      publishCache.markPublished(publishId, 'C', resultC.tweetId, resultC.url);
      console.log(`   ✅ 账户 C 发布成功`);
      console.log(`   - Tweet ID: ${resultC.tweetId}`);
      console.log(`   - URL: ${resultC.url}\n`);
    } catch (error) {
      console.log(`   ❌ 账户 C 发布失败: ${error instanceof Error ? error.message : String(error)}\n`);
    }

    // 10. 显示最终结果
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📊 发布结果总结');
    console.log('═══════════════════════════════════════════════════════════\n');
    
    const cacheEntry = publishCache.getEntry(publishId);
    if (cacheEntry) {
      console.log(`Publish ID: ${cacheEntry.publishId}`);
      console.log(`Ticker: ${cacheEntry.ticker}`);
      console.log(`\n发布状态:`);
      console.log(`  - 账户 A (中文): ${cacheEntry.published.A ? '✅ 已发布' : '❌ 未发布'}`);
      if (cacheEntry.publishResults?.A) {
        console.log(`    URL: ${cacheEntry.publishResults.A.url}`);
      }
      console.log(`  - 账户 B (英文): ${cacheEntry.published.B ? '✅ 已发布' : '❌ 未发布'}`);
      if (cacheEntry.publishResults?.B) {
        console.log(`    URL: ${cacheEntry.publishResults.B.url}`);
      }
      console.log(`  - 账户 C (韩语): ${cacheEntry.published.C ? '✅ 已发布' : '❌ 未发布'}`);
      if (cacheEntry.publishResults?.C) {
        console.log(`    URL: ${cacheEntry.publishResults.C.url}`);
      }
      console.log(`\n翻译缓存:`);
      console.log(`  - 英文: ${cacheEntry.translations.en ? '✅ 已缓存' : '❌ 未缓存'}`);
      console.log(`  - 韩语: ${cacheEntry.translations.ko ? '✅ 已缓存' : '❌ 未缓存'}`);
    }

    console.log('\n✅ 测试完成！');

  } catch (error) {
    console.error('\n❌ 测试失败:', error);
    logger.error({ error }, 'Test publish flow failed');
    process.exit(1);
  }
}

// 运行测试
testPublishFlow();

