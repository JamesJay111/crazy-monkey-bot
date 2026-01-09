/**
 * OI Alert Dry-Run 脚本
 * 用于测试新的模块化架构，不真实发送推送
 */

import * as path from 'path';
import * as dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { CoinGlassClient } from '../src/clients/coinglass.client';
import { DeepSeekClient } from '../src/clients/deepseek.client';
import { initDatabase } from '../src/db/init';
import { env } from '../src/config/env';
import { OIAlertOrchestrator } from '../src/services/oiAlert/orchestrator';

async function main() {
  console.log('🔍 OI Alert Dry-Run 模式\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  // 初始化
  const db = initDatabase(env.DB_PATH);
  const coinglass = new CoinGlassClient(env.COINGLASS_API_KEY);
  const deepseek = new DeepSeekClient(
    env.DEEPSEEK_API_KEY,
    env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions'
  );

  // 创建 Orchestrator（dry-run 模式）
  const orchestrator = new OIAlertOrchestrator(
    coinglass,
    deepseek,
    db,
    {
      scanIntervalMs: 10 * 60 * 1000, // 10 分钟
      thresholdPercent: env.OI_ALERT_THRESHOLD_PERCENT || 10,
      cooldownWindowMs: env.OI_ALERT_COOLDOWN_WINDOW_MS || 2 * 60 * 60 * 1000,
      interval: '4h',
      scanTopN: env.OI_ALERT_SCAN_TOP_N || 200,
      scanGroups: env.OI_ALERT_SCAN_GROUPS?.split(',') || ['major', 'meme', 'topOI'],
      useDynamicList: env.OI_ALERT_USE_DYNAMIC_LIST !== false,
      dryRun: true, // 启用 dry-run
      concurrency: env.OI_ALERT_CONCURRENCY || 5,
    }
  );

  console.log('📋 配置：');
  console.log('  - 阈值:', env.OI_ALERT_THRESHOLD_PERCENT || 10, '%');
  console.log('  - 扫描间隔:', (env.OI_ALERT_POLL_INTERVAL_MS || 600000) / (60 * 1000), '分钟');
  console.log('  - 冷却窗口:', (env.OI_ALERT_COOLDOWN_WINDOW_MS || 7200000) / (60 * 60 * 1000), '小时');
  console.log('  - 扫描 Top N:', env.OI_ALERT_SCAN_TOP_N || 200);
  console.log('  - 扫描组:', env.OI_ALERT_SCAN_GROUPS || 'major,meme,topOI');
  console.log('  - 并发数:', env.OI_ALERT_CONCURRENCY || 5);
  console.log('  - Dry-Run: ✅ 启用（不会真实发送推送）\n');

  console.log('开始执行一次扫描...\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  // 执行一次扫描
  await orchestrator['runScan']();

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('✅ Dry-Run 完成！');
  console.log('\n💡 说明：');
  console.log('  - 所有检测到的事件都会打印出来，但不会真实发送');
  console.log('  - 要启用真实推送，设置 USE_NEW_OI_ALERT_ORCHESTRATOR=true');
  console.log('  - 要禁用 dry-run，设置 OI_ALERT_DRY_RUN=false');

  db.close();
  process.exit(0);
}

main().catch(error => {
  console.error('❌ 执行失败:', error);
  process.exit(1);
});

