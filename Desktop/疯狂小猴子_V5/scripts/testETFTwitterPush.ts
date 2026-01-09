/**
 * ETF Twitter 推送测试脚本
 * 用于验证多语言推送功能
 */

import * as path from 'path';
import * as dotenv from 'dotenv';
import { CoinGlassClient } from '../src/clients/coinglass.client';
import { DeepSeekClient } from '../src/clients/deepseek.client';
import { ETFService } from '../src/services/etf.service';
import { XTweetOAuth1Service } from '../src/services/xTweetOAuth1.service';
import { ETFTwitterPushService } from '../src/services/etfTwitterPush.service';
import { initDatabase } from '../src/db/init';
import { env } from '../src/config/env';
import { logger } from '../src/utils/logger';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  console.log('🧪 ETF Twitter 多语言推送测试\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  const db = initDatabase(env.DB_PATH);
  const coinglass = new CoinGlassClient(env.COINGLASS_API_KEY);
  const deepseek = new DeepSeekClient(
    env.DEEPSEEK_API_KEY,
    env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions'
  );
  const etfService = new ETFService(coinglass, deepseek);
  const twitterService = new XTweetOAuth1Service();

  const etfTwitterPushService = new ETFTwitterPushService(etfService, twitterService, db);

  try {
    // 测试手动触发推送
    console.log('📅 触发推送（使用前一天 UTC+0 数据）...\n');
    await etfTwitterPushService.triggerPush(true);

    console.log('\n✅ 测试完成！');
  } catch (error: any) {
    console.error('❌ 测试失败:', error.message);
    if (error.stack) console.error(error.stack);
    process.exit(1);
  } finally {
    db.close();
  }
}

main();

