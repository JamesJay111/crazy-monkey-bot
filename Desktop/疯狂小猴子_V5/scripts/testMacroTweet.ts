/**
 * 测试宏观事件推送（手动触发一次）
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

async function testMacroTweet() {
  try {
    console.log('🧪 测试宏观事件推送\n');
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

    console.log('📊 正在执行一次宏观事件推送 Job...\n');
    
    // 手动触发一次（使用私有方法，需要类型断言）
    const jobAny = macroUsTweetJob as any;
    await jobAny.runJobOnce();

    console.log('\n✅ 测试完成！');
    
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

testMacroTweet();

