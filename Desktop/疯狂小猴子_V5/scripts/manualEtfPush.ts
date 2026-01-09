/**
 * 手动触发 ETF Twitter 推送
 * 用于测试或立即发送 ETF 推文
 */

import * as path from 'path';
import * as dotenv from 'dotenv';

// 加载环境变量
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { CoinGlassClient } from '../src/clients/coinglass.client';
import { DeepSeekClient } from '../src/clients/deepseek.client';
import { ETFService } from '../src/services/etf.service';
import { ETFTwitterPushService } from '../src/services/etfTwitterPush.service';
import { XTweetOAuth1Service } from '../src/services/xTweetOAuth1.service';
import { initDatabase } from '../src/db/init';
import { env } from '../src/config/env';
import { logger } from '../src/utils/logger';

async function triggerEtfPush() {
  try {
    console.log('🚀 正在手动触发 ETF Twitter 推送...\n');

    // 初始化数据库
    const db = initDatabase(env.DB_PATH);

    // 初始化客户端
    const coinglassClient = new CoinGlassClient();
    const deepseek = new DeepSeekClient(
      env.DEEPSEEK_API_KEY,
      env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions'
    );

    // 初始化服务
    const etfService = new ETFService(coinglassClient, deepseek);
    const xTweetOAuth1Service = new XTweetOAuth1Service();
    const etfTwitterPushService = new ETFTwitterPushService(
      etfService,
      xTweetOAuth1Service,
      db
    );

    // 清除今天的推送记录（如果存在），以便强制推送
    const today = new Date();
    today.setUTCDate(today.getUTCDate() - 1);
    const targetDateStr = today.toISOString().split('T')[0];
    
    try {
      const stmt = db.prepare('DELETE FROM etf_twitter_push_log WHERE date = ?');
      const result = stmt.run(targetDateStr);
      if (result.changes > 0) {
        console.log(`🗑️  已清除日期 ${targetDateStr} 的推送记录，将强制推送\n`);
      }
    } catch (error) {
      console.log('⚠️  清除推送记录时出错（可能记录不存在），继续推送...\n');
    }

    // 重试推送，直到成功或达到最大重试次数
    const MAX_RETRIES = 5;
    const WAIT_MINUTES = 15; // 每次等待 15 分钟
    let retryCount = 0;
    let success = false;

    while (retryCount < MAX_RETRIES && !success) {
      if (retryCount > 0) {
        console.log(`\n⏳ 等待 ${WAIT_MINUTES} 分钟以缓解 Twitter API 限流...`);
        await new Promise(resolve => setTimeout(resolve, WAIT_MINUTES * 60 * 1000));
        console.log('✅ 等待完成，准备重试推送...\n');
      }

      console.log(`📊 开始执行 ETF 推送任务（尝试 ${retryCount + 1}/${MAX_RETRIES}）...\n`);
      
      try {
        await etfTwitterPushService.runDailyPush();
        
        // 检查推送结果
        const checkStmt = db.prepare(`
          SELECT account_a_status, account_b_status, account_c_status, 
                 account_a_tweet_id, account_b_tweet_id, account_c_tweet_id
          FROM etf_twitter_push_log 
          WHERE date = ? 
          ORDER BY pushed_at_utc_ms DESC 
          LIMIT 1
        `);
        const result = checkStmt.get(targetDateStr) as any;
        
        if (result) {
          const allSuccess = result.account_a_status === 'sent' && 
                            result.account_b_status === 'sent' && 
                            result.account_c_status === 'sent';
          
          if (allSuccess) {
            console.log('\n✅ ETF 推送任务成功完成！');
            console.log(`   - 账户 A (中文): ${result.account_a_tweet_id ? '✅ 已发送' : '❌ 失败'}`);
            console.log(`   - 账户 B (英文): ${result.account_b_tweet_id ? '✅ 已发送' : '❌ 失败'}`);
            console.log(`   - 账户 C (韩语): ${result.account_c_tweet_id ? '✅ 已发送' : '❌ 失败'}`);
            success = true;
          } else {
            const failedAccounts = [];
            if (result.account_a_status !== 'sent') failedAccounts.push('A (中文)');
            if (result.account_b_status !== 'sent') failedAccounts.push('B (英文)');
            if (result.account_c_status !== 'sent') failedAccounts.push('C (韩语)');
            
            console.log(`\n⚠️  部分账户推送失败: ${failedAccounts.join(', ')}`);
            console.log('   将等待后重试...');
            
            // 清除失败的记录以便重试
            const deleteStmt = db.prepare('DELETE FROM etf_twitter_push_log WHERE date = ?');
            deleteStmt.run(targetDateStr);
          }
        } else {
          console.log('\n⚠️  未找到推送记录，可能推送失败，将重试...');
        }
        
        retryCount++;
        
      } catch (error) {
        console.error(`\n❌ 推送任务出错 (尝试 ${retryCount + 1}/${MAX_RETRIES}):`, error);
        retryCount++;
      }
    }

    if (!success) {
      console.log(`\n❌ 经过 ${MAX_RETRIES} 次尝试后仍未成功，请稍后手动重试或等待自动推送（每天北京时间 15:00）`);
    }

    // 关闭数据库连接
    db.close();

  } catch (error) {
    console.error('❌ ETF 推送任务失败:', error);
    logger.error({ error }, 'Manual ETF push failed');
    process.exit(1);
  }
}

// 执行
triggerEtfPush();
