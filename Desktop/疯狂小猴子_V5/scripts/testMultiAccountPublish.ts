/**
 * 测试多账户发布流程
 * 1. 检查 Token 授权状态
 * 2. 账户A发布"测试"
 * 3. 检查账户B和C是否有翻译和发出内容
 * 4. 检查账户A是否按照最新文案模板逻辑产出
 */

import * as path from 'path';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

// 加载环境变量
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { logger } from '../src/utils/logger';
import { XTweetOAuth1Service } from '../src/services/xTweetOAuth1.service';
import { XTweetService } from '../src/services/xTweet.service';
import { TweetTranslationService } from '../src/services/tweetTranslation.service';
import { TweetPublishCacheService } from '../src/services/tweetPublishCache.service';
import { hasValidOAuth1Token } from '../src/services/xOAuth1.service';
import { smartTruncate } from '../src/utils/textTruncate';
import { CoinGlassClient } from '../src/clients/coinglass.client';
import { BinanceUniverseService } from '../src/services/binanceUniverse.service';
import { FundingNegativeOIService } from '../src/services/fundingNegativeOIService';
import { ContractSnapshotService } from '../src/services/contractSnapshot.service';
import { LiquidationService } from '../src/services/liquidation.service';
import { TweetContentService } from '../src/services/tweetContent.service';
import { DeepSeekClient } from '../src/clients/deepseek.client';
import { env } from '../src/config/env';

/**
 * 检查 Token 授权状态
 */
function checkTokenStatus() {
  console.log('🔍 检查账户 Token 授权状态\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  // 检查账户A（默认Token）
  const tokenA = path.resolve('./data/x_oauth1_tokens.json');
  const hasTokenA = fs.existsSync(tokenA);
  console.log(`账户A (中文):`);
  console.log(`  - Token 文件: ${hasTokenA ? '✅ 存在' : '❌ 不存在'}`);
  if (hasTokenA) {
    try {
      const tokenData = JSON.parse(fs.readFileSync(tokenA, 'utf-8'));
      console.log(`  - 用户 ID: ${tokenData.userId || 'N/A'}`);
      console.log(`  - 用户名: ${tokenData.screenName || 'N/A'}`);
      console.log(`  - 授权时间: ${tokenData.obtainedAt ? new Date(tokenData.obtainedAt).toLocaleString('zh-CN') : 'N/A'}`);
      console.log(`  - Token 验证: ${hasValidOAuth1Token() ? '✅ 有效' : '❌ 无效'}`);
    } catch (error) {
      console.log(`  - 读取错误: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log('');

  // 检查账户B
  const tokenB = path.resolve('./data/x_oauth1_tokens_accountB.json');
  const hasTokenB = fs.existsSync(tokenB);
  console.log(`账户B (英文):`);
  console.log(`  - Token 文件: ${hasTokenB ? '✅ 存在' : '❌ 不存在'}`);
  if (hasTokenB) {
    try {
      const tokenData = JSON.parse(fs.readFileSync(tokenB, 'utf-8'));
      console.log(`  - 用户 ID: ${tokenData.userId || 'N/A'}`);
      console.log(`  - 用户名: ${tokenData.screenName || 'N/A'}`);
      console.log(`  - 授权时间: ${tokenData.obtainedAt ? new Date(tokenData.obtainedAt).toLocaleString('zh-CN') : 'N/A'}`);
      console.log(`  - Token 验证: ${hasValidOAuth1Token('accountB') ? '✅ 有效' : '❌ 无效'}`);
    } catch (error) {
      console.log(`  - 读取错误: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log('');

  // 检查账户C
  const tokenC = path.resolve('./data/x_oauth1_tokens_accountC.json');
  const hasTokenC = fs.existsSync(tokenC);
  console.log(`账户C (韩语):`);
  console.log(`  - Token 文件: ${hasTokenC ? '✅ 存在' : '❌ 不存在'}`);
  if (hasTokenC) {
    try {
      const tokenData = JSON.parse(fs.readFileSync(tokenC, 'utf-8'));
      console.log(`  - 用户 ID: ${tokenData.userId || 'N/A'}`);
      console.log(`  - 用户名: ${tokenData.screenName || 'N/A'}`);
      console.log(`  - 授权时间: ${tokenData.obtainedAt ? new Date(tokenData.obtainedAt).toLocaleString('zh-CN') : 'N/A'}`);
      console.log(`  - Token 验证: ${hasValidOAuth1Token('accountC') ? '✅ 有效' : '❌ 无效'}`);
    } catch (error) {
      console.log(`  - 读取错误: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log('');

  return { hasTokenA, hasTokenB, hasTokenC };
}

/**
 * 测试账户A发布"测试"
 */
async function testAccountAPublish() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('📝 测试账户A发布"测试"\n');

  const testText = '测试';
  const oauth1Service = new XTweetOAuth1Service();
  const tweetService = new XTweetService();

  try {
    let result;
    if (hasValidOAuth1Token()) {
      console.log('使用 OAuth 1.0a 发布...');
      result = await oauth1Service.sendTweet(testText);
    } else {
      console.log('使用 OAuth 2.0 发布...');
      result = await tweetService.sendTweet(testText);
    }

    console.log(`✅ 账户A发布成功`);
    console.log(`  - Tweet ID: ${result.tweetId}`);
    console.log(`  - URL: ${result.url}\n`);
    return result;
  } catch (error) {
    console.log(`❌ 账户A发布失败: ${error instanceof Error ? error.message : String(error)}\n`);
    throw error;
  }
}

/**
 * 测试多账户发布流程（使用缓存系统）
 */
async function testMultiAccountPublishFlow() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('🔄 测试多账户发布流程（使用缓存系统）\n');

  const publishCache = new TweetPublishCacheService();
  const translationService = new TweetTranslationService();
  const oauth1Service = new XTweetOAuth1Service();

  // 创建测试内容
  const testContent = '测试多账户发布系统';
  const ticker = 'TEST';
  const publishId = publishCache.createEntry(ticker, '4h', testContent);
  console.log(`📋 创建缓存条目: ${publishId}\n`);

  // 发布到账户A
  console.log('1️⃣ 发布到账户A（中文）...');
  try {
    let resultA;
    if (hasValidOAuth1Token()) {
      resultA = await oauth1Service.sendTweet(testContent);
    } else {
      const tweetService = new XTweetService();
      resultA = await tweetService.sendTweet(testContent);
    }
    publishCache.markPublished(publishId, 'A', resultA.tweetId, resultA.url);
    console.log(`   ✅ 账户A发布成功`);
    console.log(`   - Tweet ID: ${resultA.tweetId}`);
    console.log(`   - URL: ${resultA.url}\n`);
  } catch (error) {
    console.log(`   ❌ 账户A发布失败: ${error instanceof Error ? error.message : String(error)}\n`);
  }

  // 发布到账户B（英文）
  console.log('2️⃣ 发布到账户B（英文）...');
  try {
    let translatedEn = publishCache.getTranslation(publishId, 'en');
    if (!translatedEn) {
      console.log(`   - 翻译为英文...`);
      translatedEn = await translationService.translateWithDeepSeek(testContent, 'en');
      publishCache.updateTranslation(publishId, 'en', translatedEn);
      console.log(`   ✅ 翻译完成并缓存`);
    } else {
      console.log(`   - 使用缓存的英文翻译`);
    }

    const finalTextB = smartTruncate(translatedEn, 280);
    const resultB = await oauth1Service.sendTweet(finalTextB, 'accountB');
    publishCache.markPublished(publishId, 'B', resultB.tweetId, resultB.url);
    console.log(`   ✅ 账户B发布成功`);
    console.log(`   - Tweet ID: ${resultB.tweetId}`);
    console.log(`   - URL: ${resultB.url}`);
    console.log(`   - 翻译内容: ${translatedEn.substring(0, 100)}...\n`);
  } catch (error) {
    console.log(`   ❌ 账户B发布失败: ${error instanceof Error ? error.message : String(error)}\n`);
  }

  // 发布到账户C（韩语）
  console.log('3️⃣ 发布到账户C（韩语）...');
  try {
    let translatedKo = publishCache.getTranslation(publishId, 'ko');
    if (!translatedKo) {
      console.log(`   - 翻译为韩语...`);
      translatedKo = await translationService.translateWithDeepSeek(testContent, 'ko');
      publishCache.updateTranslation(publishId, 'ko', translatedKo);
      console.log(`   ✅ 翻译完成并缓存`);
    } else {
      console.log(`   - 使用缓存的韩语翻译`);
    }

    const finalTextC = smartTruncate(translatedKo, 280);
    const resultC = await oauth1Service.sendTweet(finalTextC, 'accountC');
    publishCache.markPublished(publishId, 'C', resultC.tweetId, resultC.url);
    console.log(`   ✅ 账户C发布成功`);
    console.log(`   - Tweet ID: ${resultC.tweetId}`);
    console.log(`   - URL: ${resultC.url}`);
    console.log(`   - 翻译内容: ${translatedKo.substring(0, 100)}...\n`);
  } catch (error) {
    console.log(`   ❌ 账户C发布失败: ${error instanceof Error ? error.message : String(error)}\n`);
  }

  // 显示缓存状态
  const cacheEntry = publishCache.getEntry(publishId);
  if (cacheEntry) {
    console.log('📊 缓存状态:');
    console.log(`  - 原文: ${cacheEntry.sourceText}`);
    console.log(`  - 英文翻译: ${cacheEntry.translations.en ? '✅ 已缓存' : '❌ 未缓存'}`);
    console.log(`  - 韩语翻译: ${cacheEntry.translations.ko ? '✅ 已缓存' : '❌ 未缓存'}`);
    console.log(`  - 账户A已发布: ${cacheEntry.published.A ? '✅' : '❌'}`);
    console.log(`  - 账户B已发布: ${cacheEntry.published.B ? '✅' : '❌'}`);
    console.log(`  - 账户C已发布: ${cacheEntry.published.C ? '✅' : '❌'}\n`);
  }
}

/**
 * 检查账户A是否按照最新文案模板逻辑产出
 */
async function checkAccountATemplate() {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('📋 检查账户A是否按照最新文案模板逻辑产出\n');

  // 初始化服务
  const coinglassClient = new CoinGlassClient();
  const deepseek = new DeepSeekClient(
    env.DEEPSEEK_API_KEY,
    env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions'
  );
  const liquidationService = new LiquidationService(coinglassClient);
  const snapshotService = new ContractSnapshotService(coinglassClient, liquidationService);
  const contentService = new TweetContentService(deepseek, coinglassClient);

  // 使用 FLOW 作为测试
  const symbol = 'FLOW';
  console.log(`测试交易对: ${symbol}/USDT\n`);

  try {
    // 获取快照
    console.log('1️⃣ 获取合约快照...');
    const snapshot = await snapshotService.getContractSnapshot(symbol);
    console.log(`   ✅ 快照获取成功\n`);

    // 生成推文内容
    console.log('2️⃣ 生成推文内容（使用最新模板）...');
    const tweetContent = await contentService.generateTweet(snapshot);
    console.log(`   ✅ 推文内容生成成功`);
    console.log(`   - 内容长度: ${tweetContent.length} 字符\n`);

    // 检查模板格式
    console.log('3️⃣ 检查模板格式...');
    const checks = {
      hasHeader: tweetContent.includes('📊 合约数据概览'),
      hasBinance4h: tweetContent.includes('Binance · 4h'),
      hasSeparator: tweetContent.includes('—'),
      hasOI: tweetContent.includes('合约持仓（OI）'),
      hasFunding: tweetContent.includes('资金费率'),
      hasTaker: tweetContent.includes('主动成交方向'),
      hasTop: tweetContent.includes('大户持仓结构'),
      hasDataNote: tweetContent.includes('数据说明'),
      hasStructureAnalysis: tweetContent.includes('结构分析'),
      hasRiskObservation: tweetContent.includes('结构性风险观察'),
      hasDisclaimer: tweetContent.includes('本内容为结构观察，不构成投资或交易建议'),
      noDash: !tweetContent.includes('—') || tweetContent.split('—').length === 3, // 只允许分隔符
      noUndefined: !tweetContent.includes('undefined'),
      noNull: !tweetContent.includes('null'),
    };

    console.log('   模板格式检查结果:');
    for (const [key, value] of Object.entries(checks)) {
      console.log(`   - ${key}: ${value ? '✅' : '❌'}`);
    }
    console.log('');

    // 显示推文内容
    console.log('4️⃣ 推文内容预览:');
    console.log('─────────────────────────────────────────────────────────');
    console.log(tweetContent);
    console.log('─────────────────────────────────────────────────────────\n');

    // 总结
    const allPassed = Object.values(checks).every(v => v);
    if (allPassed) {
      console.log('✅ 账户A按照最新文案模板逻辑产出，格式正确！\n');
    } else {
      console.log('⚠️  账户A模板格式存在问题，请检查上述结果\n');
    }

    return { tweetContent, checks, allPassed };
  } catch (error) {
    console.log(`❌ 检查失败: ${error instanceof Error ? error.message : String(error)}\n`);
    throw error;
  }
}

/**
 * 主函数
 */
async function main() {
  console.log('🧪 多账户发布系统测试\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  try {
    // 1. 检查 Token 状态
    const tokenStatus = checkTokenStatus();

    // 2. 测试账户A发布"测试"
    if (tokenStatus.hasTokenA) {
      try {
        await testAccountAPublish();
      } catch (error) {
        console.log('⚠️  账户A发布测试失败，但继续其他测试\n');
      }
    } else {
      console.log('⚠️  账户A Token 不存在，跳过发布测试\n');
    }

    // 3. 测试多账户发布流程
    if (tokenStatus.hasTokenA && tokenStatus.hasTokenB && tokenStatus.hasTokenC) {
      await testMultiAccountPublishFlow();
    } else {
      console.log('⚠️  部分账户 Token 不存在，跳过多账户发布测试\n');
    }

    // 4. 检查账户A模板逻辑
    await checkAccountATemplate();

    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ 测试完成！\n');

  } catch (error) {
    console.error('\n❌ 测试失败:', error);
    logger.error({ error }, 'Multi-account publish test failed');
    process.exit(1);
  }
}

// 运行测试
main();



