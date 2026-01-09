/**
 * 生成指定日期的 ETF 每日报告
 */

import * as path from 'path';
import * as dotenv from 'dotenv';

// 加载环境变量
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { ETFService } from '../src/services/etf.service';
import { ETFDailyReportService } from '../src/services/etfDailyReport.service';
import { CoinGlassClient } from '../src/clients/coinglass.client';
import { DeepSeekClient } from '../src/clients/deepseek.client';

async function generateReportForDate(targetDate: string) {
  try {
    console.log(`🧪 生成 ${targetDate} 的 ETF 每日报告\n`);
    console.log('═══════════════════════════════════════════════════════════\n');

    const coinglass = new CoinGlassClient();
    const deepseekApiKey = process.env.DEEPSEEK_API_KEY || '';
    const deepseek = deepseekApiKey ? new DeepSeekClient(deepseekApiKey) : undefined;
    const etfService = new ETFService(coinglass, deepseek || new DeepSeekClient(''));
    const reportService = new ETFDailyReportService(etfService, deepseek);

    // 解析目标日期
    const dateParts = targetDate.split(/[-./]/);
    if (dateParts.length !== 3) {
      throw new Error(`无效的日期格式: ${targetDate}。请使用 YYYY-MM-DD 格式`);
    }
    
    const year = parseInt(dateParts[0], 10);
    const month = parseInt(dateParts[1], 10) - 1; // JavaScript Date 月份从0开始
    const day = parseInt(dateParts[2], 10);
    
    if (isNaN(year) || isNaN(month) || isNaN(day)) {
      throw new Error(`无效的日期: ${targetDate}`);
    }
    
    // 创建目标日期对象（UTC+0）
    const targetDateObj = new Date(Date.UTC(year, month, day, 12, 0, 0, 0)); // 使用中午12点避免时区问题
    
    console.log(`📅 目标日期: ${targetDate} (UTC+0)\n`);
    console.log(`📊 目标币种: BTC, ETH, SOL, XRP\n`);
    console.log('正在生成报告...\n');

    // 调用私有方法生成报告（通过反射访问）
    // 由于 generateReport 是私有方法，我们使用 triggerReport 但需要修改日期
    // 实际上，我们需要直接调用 generateReport，但它是私有的
    // 让我们创建一个公共方法来生成指定日期的报告
    
    // 使用反射调用私有方法 generateReport
    const reportServiceAny = reportService as any;
    await reportServiceAny.generateReport(targetDateObj);

    // 查找生成的文件
    const os = require('os');
    const desktopDir = path.join(os.homedir(), 'Desktop');
    const fs = require('fs');
    
    // 查找最新的报告文件
    const files = fs.readdirSync(desktopDir)
      .filter((f: string) => f.startsWith('etf_daily_report_') && f.endsWith('.txt'))
      .map((f: string) => ({
        name: f,
        path: path.join(desktopDir, f),
        mtime: fs.statSync(path.join(desktopDir, f)).mtime
      }))
      .sort((a: any, b: any) => b.mtime - a.mtime);
    
    if (files.length > 0) {
      const latestFile = files[0].path;
      console.log('✅ 报告生成成功！');
      console.log(`📄 文件路径: ${latestFile}\n`);
      
      const content = fs.readFileSync(latestFile, 'utf-8');
      console.log('📋 报告内容预览（前1000字符）:');
      console.log('─'.repeat(60));
      console.log(content.substring(0, 1000));
      console.log('...\n');
    } else {
      console.log('⚠️  报告可能已生成，但未找到文件。请检查桌面目录。');
    }

    console.log('✅ 完成！');

  } catch (error) {
    console.error('\n❌ 生成报告失败:', error);
    if (error instanceof Error) {
      console.error('错误详情:', error.message);
      console.error('堆栈:', error.stack);
    }
    process.exit(1);
  }
}

// 从命令行参数获取日期，默认为 2026-01-04
const targetDate = process.argv[2] || '2026-01-04';
generateReportForDate(targetDate);

