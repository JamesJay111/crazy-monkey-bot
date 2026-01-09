/**
 * 测试账户A发布"测试"，并检查账户B和C是否同步发布
 * 注意：根据当前实现，B和C不会自动从A的推文翻译发布
 * 它们只在后端生成推文内容时一起发布
 */

import * as path from 'path';
import * as dotenv from 'dotenv';

// 加载环境变量
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { logger } from '../src/utils/logger';
import { XTweetOAuth1Service } from '../src/services/xTweetOAuth1.service';
import { XTweetService } from '../src/services/xTweet.service';
import { TweetTranslationService } from '../src/services/tweetTranslation.service';
import { TweetPublishCacheService } from '../src/services/tweetPublishCache.service';
import { hasValidOAuth1Token } from '../src/services/xOAuth1.service';
import { smartTruncate } from '../src/utils/textTruncate';

/**
 * 测试账户A发布"测试"，并同步发布到B和C
 */
async function testAccountAPublishAndSync() {
  try {
    console.log('🧪 测试账户A发布"测试"并同步到B和C\n');
    console.log('═══════════════════════════════════════════════════════════\n');

    const publishCache = new TweetPublishCacheService();
    const translationService = new TweetTranslationService();
    const oauth1Service = new XTweetOAuth1Service();
    const tweetService = new XTweetService();

    // 测试内容
    const testContent = '测试';
    const ticker = 'TEST';

    // 1. 创建缓存条目（模拟后端生成推文内容）
    console.log('1️⃣ 创建发布缓存条目（模拟后端生成推文内容）...');
    const publishId = publishCache.createEntry(ticker, '4h', testContent);
    console.log(`   ✅ 缓存条目创建成功`);
    console.log(`   - Publish ID: ${publishId}\n`);

    // 2. 发布到账户A（中文）
    console.log('2️⃣ 发布到账户A（中文）...');
    try {
      let resultA;
      if (hasValidOAuth1Token()) {
        resultA = await oauth1Service.sendTweet(testContent);
      } else {
        resultA = await tweetService.sendTweet(testContent);
      }
      publishCache.markPublished(publishId, 'A', resultA.tweetId, resultA.url);
      console.log(`   ✅ 账户A发布成功`);
      console.log(`   - Tweet ID: ${resultA.tweetId}`);
      console.log(`   - URL: ${resultA.url}\n`);
    } catch (error) {
      console.log(`   ❌ 账户A发布失败: ${error instanceof Error ? error.message : String(error)}\n`);
      throw error;
    }

    // 3. 发布到账户B（英文）
    console.log('3️⃣ 发布到账户B（英文）...');
    try {
      // 检查是否有缓存的翻译
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
      console.log(`   - 翻译内容: ${translatedEn}\n`);
    } catch (error) {
      console.log(`   ❌ 账户B发布失败: ${error instanceof Error ? error.message : String(error)}\n`);
    }

    // 4. 发布到账户C（韩语）
    console.log('4️⃣ 发布到账户C（韩语）...');
    try {
      // 检查是否有缓存的翻译
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
      console.log(`   - 翻译内容: ${translatedKo}\n`);
    } catch (error) {
      console.log(`   ❌ 账户C发布失败: ${error instanceof Error ? error.message : String(error)}\n`);
    }

    // 5. 显示最终结果
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📊 发布结果总结');
    console.log('═══════════════════════════════════════════════════════════\n');
    
    const cacheEntry = publishCache.getEntry(publishId);
    if (cacheEntry) {
      console.log(`Publish ID: ${cacheEntry.publishId}`);
      console.log(`原文: ${cacheEntry.sourceText}\n`);
      
      console.log(`发布状态:`);
      console.log(`  - 账户A (中文): ${cacheEntry.published.A ? '✅ 已发布' : '❌ 未发布'}`);
      if (cacheEntry.publishResults?.A) {
        console.log(`    Tweet ID: ${cacheEntry.publishResults.A.tweetId}`);
        console.log(`    URL: ${cacheEntry.publishResults.A.url}`);
      }
      
      console.log(`  - 账户B (英文): ${cacheEntry.published.B ? '✅ 已发布' : '❌ 未发布'}`);
      if (cacheEntry.publishResults?.B) {
        console.log(`    Tweet ID: ${cacheEntry.publishResults.B.tweetId}`);
        console.log(`    URL: ${cacheEntry.publishResults.B.url}`);
        if (cacheEntry.translations.en) {
          console.log(`    翻译: ${cacheEntry.translations.en}`);
        }
      }
      
      console.log(`  - 账户C (韩语): ${cacheEntry.published.C ? '✅ 已发布' : '❌ 未发布'}`);
      if (cacheEntry.publishResults?.C) {
        console.log(`    Tweet ID: ${cacheEntry.publishResults.C.tweetId}`);
        console.log(`    URL: ${cacheEntry.publishResults.C.url}`);
        if (cacheEntry.translations.ko) {
          console.log(`    翻译: ${cacheEntry.translations.ko}`);
        }
      }
      
      console.log(`\n翻译缓存:`);
      console.log(`  - 英文: ${cacheEntry.translations.en ? '✅ 已缓存' : '❌ 未缓存'}`);
      console.log(`  - 韩语: ${cacheEntry.translations.ko ? '✅ 已缓存' : '❌ 未缓存'}`);
    }

    console.log('\n✅ 测试完成！');

  } catch (error) {
    console.error('\n❌ 测试失败:', error);
    logger.error({ error }, 'Test account A publish and sync failed');
    process.exit(1);
  }
}

// 运行测试
testAccountAPublishAndSync();



