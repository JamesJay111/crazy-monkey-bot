/**
 * 测试 ETF 每日报告生成
 */

import * as path from 'path';
import * as dotenv from 'dotenv';

// 加载环境变量
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { ETFService } from '../src/services/etf.service';
import { ETFDailyReportService } from '../src/services/etfDailyReport.service';
import { CoinGlassClient } from '../src/clients/coinglass.client';
import { DeepSeekClient } from '../src/clients/deepseek.client';

async function testReport() {
  try {
    console.log('🧪 测试 ETF 每日报告生成\n');
    console.log('═══════════════════════════════════════════════════════════\n');

    const coinglass = new CoinGlassClient();
    // 【更新】传递 DeepSeek API key 以支持分析生成
    const deepseekApiKey = process.env.DEEPSEEK_API_KEY || '';
    const deepseek = deepseekApiKey ? new DeepSeekClient(deepseekApiKey) : undefined;
    const etfService = new ETFService(coinglass, deepseek || new DeepSeekClient(''));
    const reportService = new ETFDailyReportService(etfService, deepseek);

    console.log('📊 正在生成报告...\n');
    const filePath = await reportService.triggerReport();

    console.log('✅ 报告生成成功！');
    console.log(`📄 文件路径: ${filePath}\n`);

    // 读取并显示报告内容
    const fs = require('fs');
    // 如果文件不存在，尝试查找桌面上的最新文件
    let reportFilePath = filePath;
    if (!fs.existsSync(reportFilePath)) {
      const os = require('os');
      const desktopDir = path.join(os.homedir(), 'Desktop');
      const files = fs.readdirSync(desktopDir)
        .filter((f: string) => f.startsWith('etf_daily_report_') && f.endsWith('.txt'))
        .map((f: string) => ({
          name: f,
          path: path.join(desktopDir, f),
          mtime: fs.statSync(path.join(desktopDir, f)).mtime
        }))
        .sort((a: any, b: any) => b.mtime - a.mtime);
      
      if (files.length > 0) {
        reportFilePath = files[0].path;
        console.log(`📄 使用最新文件: ${reportFilePath}\n`);
      }
    }
    
    const content = fs.readFileSync(reportFilePath, 'utf-8');
    console.log('📋 报告内容预览（前500字符）:');
    console.log('─'.repeat(60));
    console.log(content.substring(0, 500));
    console.log('...\n');

    console.log('✅ 测试完成！');

  } catch (error) {
    console.error('\n❌ 测试失败:', error);
    process.exit(1);
  }
}

testReport();

