/**
 * 测试宏观事件推送（使用模拟数据）
 */

import * as path from 'path';
import * as dotenv from 'dotenv';

// 加载环境变量
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import Database from 'better-sqlite3';
import { initDatabase } from '../src/db/init';
import { env } from '../src/config/env';
import { CoinGlassClient } from '../src/clients/coinglass.client';
import { DeepSeekClient } from '../src/clients/deepseek.client';
import { XTweetOAuth1Service } from '../src/services/xTweetOAuth1.service';
import { MacroUsTweetJobService } from '../src/services/macroUsTweetJob.service';
import { EventDTO } from '../src/types/macroEvent';

async function testMacroTweetWithMock() {
  try {
    console.log('🧪 测试宏观事件推送（使用模拟数据）\n');
    console.log('═══════════════════════════════════════════════════════════\n');

    // 初始化数据库
    const db = initDatabase(env.DB_PATH);
    
    // 初始化客户端
    const coinglass = new CoinGlassClient();
    const deepseek = new DeepSeekClient(
      env.DEEPSEEK_API_KEY,
      env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions'
    );
    const tweetService = new XTweetOAuth1Service();
    
    // 初始化服务
    const macroUsTweetJob = new MacroUsTweetJobService(
      coinglass,
      deepseek,
      tweetService,
      db
    );

    // 创建模拟事件数据
    const mockEvent: EventDTO = {
      event_key: 'test_' + Date.now(),
      calendar_name: 'Non-Farm Payrolls',
      country_code: 'USA',
      country_name: 'United States',
      publish_time_utc_ms: Date.now() + 2 * 60 * 60 * 1000, // 2小时后
      importance_level: 3,
      has_exact_publish_time: 1,
      forecast_value: '200K',
      previous_value: '199K',
      published_value: undefined, // 未公布
      revised_previous_value: undefined,
      data_effect: 'High impact on USD',
      status: 'UPCOMING',
    };

    console.log('📊 使用模拟事件数据：');
    console.log(`   事件: ${mockEvent.calendar_name}`);
    console.log(`   时间: ${new Date(mockEvent.publish_time_utc_ms).toISOString()}`);
    console.log(`   重要性: ${mockEvent.importance_level}/3\n`);

    // 手动调用生成和发布方法（使用类型断言访问私有方法）
    const jobAny = macroUsTweetJob as any;
    
    console.log('📝 正在生成三语言推文...\n');
    const tweets = await jobAny.generateTweets(mockEvent);
    
    console.log('✅ 推文生成成功！\n');
    console.log('📱 中文推文 (Account A - CrazyMonkeyPerp):');
    console.log('─'.repeat(60));
    console.log(tweets.zh);
    console.log(`   字符数: ${tweets.zh.length}\n`);
    
    console.log('📱 英文推文 (Account B - CrazyMonkeyEN):');
    console.log('─'.repeat(60));
    console.log(tweets.en);
    console.log(`   字符数: ${tweets.en.length}\n`);
    
    console.log('📱 韩语推文 (Account C - CrazyMonkeyKR):');
    console.log('─'.repeat(60));
    console.log(tweets.kr);
    console.log(`   字符数: ${tweets.kr.length}\n`);

    console.log('🚀 正在发布到 Twitter...\n');
    const results = await jobAny.publishTweets(mockEvent, tweets);

    console.log('📊 发布结果：');
    console.log(`   Account A (ZH - CrazyMonkeyPerp): ${results.accountA.status}${results.accountA.tweetId ? ` (Tweet ID: ${results.accountA.tweetId})` : ''}${results.accountA.error ? ` - ${results.accountA.error}` : ''}`);
    console.log(`   Account B (EN - CrazyMonkeyEN): ${results.accountB.status}${results.accountB.tweetId ? ` (Tweet ID: ${results.accountB.tweetId})` : ''}${results.accountB.error ? ` - ${results.accountB.error}` : ''}`);
    console.log(`   Account C (KO - CrazyMonkeyKR): ${results.accountC.status}${results.accountC.tweetId ? ` (Tweet ID: ${results.accountC.tweetId})` : ''}${results.accountC.error ? ` - ${results.accountC.error}` : ''}\n`);

    // 记录推送日志
    await jobAny.logPush(mockEvent, results);

    console.log('✅ 测试完成！');
    
    // 关闭数据库
    db.close();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ 测试失败:', error);
    if (error instanceof Error) {
      console.error('错误详情:', error.message);
      console.error('堆栈:', error.stack);
    }
    process.exit(1);
  }
}

testMacroTweetWithMock();

