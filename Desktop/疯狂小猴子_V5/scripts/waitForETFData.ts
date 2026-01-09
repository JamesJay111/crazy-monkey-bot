/**
 * 等待并获取所有 ETF 数据，直到所有币种都有数据
 */

import * as path from 'path';
import * as dotenv from 'dotenv';

// 加载环境变量
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { ETFService } from '../src/services/etf.service';
import { ETFDailyReportService } from '../src/services/etfDailyReport.service';
import { CoinGlassClient } from '../src/clients/coinglass.client';
import { DeepSeekClient } from '../src/clients/deepseek.client';
import { logger } from '../src/utils/logger';
import { matchTargetDate, getLatestAvailableDate, getTargetDateUTCRange, isDataAvailable } from '../src/utils/etfDateMatcher';

const SYMBOLS: Array<'BTC' | 'ETH' | 'SOL' | 'XRP'> = ['BTC', 'ETH', 'SOL', 'XRP'];
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 每5分钟检查一次
const MAX_WAIT_MINUTES = 90; // 【修复D】最多等待90分钟
const MAX_CHECKS = 30; // 【修复D】最多检查30次
const MIN_SYMBOLS_FOR_REPORT = 1; // 【修复C】至少需要1个币种的数据

async function waitForAllETFData() {
  try {
    console.log('🔄 开始等待 ETF 数据可用（支持降级策略）...\n');
    console.log(`📊 目标币种: ${SYMBOLS.join(', ')}\n`);
    console.log(`⏱️  检查间隔: ${CHECK_INTERVAL_MS / 1000 / 60} 分钟\n`);
    console.log(`⏰ 最长等待时间: ${MAX_WAIT_MINUTES} 分钟（${MAX_CHECKS} 次检查）\n`);
    console.log(`📉 降级策略: 至少 ${MIN_SYMBOLS_FOR_REPORT} 个币种有数据即可生成报告\n`);
    console.log('═══════════════════════════════════════════════════════════\n');

    const coinglass = new CoinGlassClient();
    const deepseekApiKey = process.env.DEEPSEEK_API_KEY || '';
    const deepseek = deepseekApiKey ? new DeepSeekClient(deepseekApiKey) : undefined;
    const etfService = new ETFService(coinglass, deepseek || new DeepSeekClient(''));
    const reportService = new ETFDailyReportService(etfService, deepseek);

    const startTime = Date.now();
    const maxWaitTime = MAX_WAIT_MINUTES * 60 * 1000; // 转换为毫秒
    let attempt = 0;

    // 【修复A】获取目标日期（UTC+0 昨日）
    const { start, end, dateStr: targetDateStr } = getTargetDateUTCRange();
    console.log(`📅 目标日期: ${targetDateStr} (UTC+0)\n`);

    while (true) {
      attempt++;
      const elapsed = Date.now() - startTime;
      const elapsedMinutes = Math.floor(elapsed / (60 * 1000));
      const elapsedSeconds = Math.floor((elapsed % (60 * 1000)) / 1000);

      console.log(`\n[尝试 #${attempt}/${MAX_CHECKS}] ${new Date().toLocaleString('zh-CN')}`);
      console.log(`⏱️  已等待: ${elapsedMinutes} 分钟 ${elapsedSeconds} 秒\n`);

      // 【修复D】检查轮询上限
      if (elapsed > maxWaitTime || attempt > MAX_CHECKS) {
        const reason = elapsed > maxWaitTime ? `已等待超过 ${MAX_WAIT_MINUTES} 分钟` : `已检查 ${MAX_CHECKS} 次`;
        console.warn(`⚠️  ${reason}，使用降级策略生成报告...\n`);
        
        // 生成降级报告
        try {
          const filePath = await reportService.triggerReport();
          console.log('✅ 降级报告生成成功！');
          console.log(`📄 文件路径: ${filePath}\n`);
          process.exit(0);
        } catch (error) {
          console.error('\n❌ 降级报告生成失败:', error);
          process.exit(1);
        }
      }

      // 【修复A+B】检查每个币种是否有数据（使用改进的日期匹配逻辑）
      const availableSymbols: Array<{ symbol: string; dateStr: string; flow: number }> = [];
      const missingSymbols: Array<{ symbol: string; latestDate: string | null; reason: string }> = [];
      const latestAvailableDates: Map<string, string> = new Map();

      for (const symbol of SYMBOLS) {
        try {
          const history = await etfService.getFlowHistory(symbol, 7);
          
          if (history && history.length > 0) {
            // 【修复B】探测最新可用日期
            const latestAvailable = getLatestAvailableDate(history);
            if (latestAvailable) {
              latestAvailableDates.set(symbol, latestAvailable.dateStr);
            }
            
            // 【修复A】使用改进的日期匹配逻辑（区间匹配 + 日线点匹配）
            const matchedData = history.filter(item => {
              return matchTargetDate(item.timestamp, start, end);
            });

            if (matchedData.length > 0) {
              const flow = parseFloat(matchedData[0].flow_usd || '0');
              availableSymbols.push({
                symbol,
                dateStr: targetDateStr,
                flow,
              });
              console.log(`✅ ${symbol}: 有数据 (日期: ${targetDateStr}, 净流入: ${flow >= 0 ? '+' : ''}${flow.toLocaleString('en-US', { maximumFractionDigits: 0 })} USD)`);
            } else {
              // 【修复B】检查最新可用日期是否早于目标日期
              const latestDate = latestAvailable?.dateStr || null;
              const isAvailable = latestDate ? isDataAvailable(latestDate, targetDateStr) : false;
              const reason = isAvailable 
                ? `数据存在但时间戳不匹配（最新: ${latestDate}）`
                : `API 尚未更新到目标日期（最新: ${latestDate || 'N/A'}）`;
              
              missingSymbols.push({
                symbol,
                latestDate,
                reason,
              });
              console.log(`⏳ ${symbol}: 暂无目标日期数据 (${reason})`);
            }
          } else {
            missingSymbols.push({
              symbol,
              latestDate: null,
              reason: '无历史数据',
            });
            console.log(`⏳ ${symbol}: 无历史数据`);
          }

          // 添加小延迟避免限流
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (error) {
          missingSymbols.push({
            symbol,
            latestDate: null,
            reason: error instanceof Error ? error.message.substring(0, 50) : String(error),
          });
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.log(`❌ ${symbol}: 获取失败 (${errorMsg.substring(0, 50)})`);
        }
      }

      console.log(`\n📊 当前状态: ${availableSymbols.length}/${SYMBOLS.length} 个币种有数据`);
      console.log(`✅ 已有数据: ${availableSymbols.length > 0 ? availableSymbols.map(s => `${s.symbol}(${s.dateStr})`).join(', ') : '无'}`);
      console.log(`⏳ 等待数据: ${missingSymbols.length > 0 ? missingSymbols.map(s => `${s.symbol}(${s.latestDate || 'N/A'})`).join(', ') : '无'}`);
      
      // 【修复B】显示各币种最新可用日期
      if (latestAvailableDates.size > 0) {
        console.log(`📅 最新可用日期: ${Array.from(latestAvailableDates.entries()).map(([sym, date]) => `${sym}:${date}`).join(', ')}`);
      }

      // 【修复C】降级策略判断
      // 1. 如果所有币种都有目标日期数据，生成完整报告
      // 2. 如果所有币种的最新可用日期都早于目标日期，使用降级策略立即生成报告
      // 3. 如果部分币种有数据，也生成报告
      
      const allSymbolsHaveTargetDate = availableSymbols.length === SYMBOLS.length;
      
      // 【修复C】检查是否所有币种的最新可用日期都早于目标日期
      // 需要所有币种都有最新日期信息，且都早于目标日期
      const allSymbolsBehindTarget = missingSymbols.length === SYMBOLS.length && 
        missingSymbols.every(m => {
          if (!m.latestDate) return false;
          return !isDataAvailable(m.latestDate, targetDateStr);
        });
      
      const hasSomeData = availableSymbols.length >= MIN_SYMBOLS_FOR_REPORT;
      
      if (allSymbolsHaveTargetDate) {
        console.log('\n🎉 所有币种数据已就绪！正在生成完整报告...\n');
        console.log('═══════════════════════════════════════════════════════════\n');
      } else if (allSymbolsBehindTarget) {
        // 所有币种的最新可用日期都早于目标日期，立即使用降级策略生成报告
        console.log(`\n⚠️  所有币种的最新可用日期都早于目标日期 ${targetDateStr}，使用降级策略立即生成报告...\n`);
        console.log('═══════════════════════════════════════════════════════════\n');
      } else if (hasSomeData && attempt >= 3) {
        // 如果已经检查了至少3次，且有部分数据，也生成报告
        console.log(`\n⚠️  部分币种数据可用（${availableSymbols.length}/${SYMBOLS.length}），使用降级策略生成报告...\n`);
        console.log('═══════════════════════════════════════════════════════════\n');
      } else {
        // 继续等待
        const waitMinutes = CHECK_INTERVAL_MS / 1000 / 60;
        const remainingChecks = MAX_CHECKS - attempt;
        const remainingMinutes = Math.floor((maxWaitTime - elapsed) / (60 * 1000));
        console.log(`\n⏳ ${waitMinutes} 分钟后再次检查...`);
        console.log(`📊 剩余检查次数: ${remainingChecks} 次`);
        console.log(`⏰ 剩余等待时间: ${remainingMinutes} 分钟\n`);
        console.log('═══════════════════════════════════════════════════════════\n');
        await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL_MS));
        continue;
      }
      
      // 生成报告
      if (allSymbolsHaveTargetDate || allSymbolsBehindTarget || (hasSomeData && attempt >= 3)) {

        try {
          const filePath = await reportService.triggerReport();
          console.log('✅ 报告生成成功！');
          console.log(`📄 文件路径: ${filePath}\n`);

          // 读取并显示报告内容预览
          const fs = require('fs');
          if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            console.log('📋 报告内容预览（前800字符）:');
            console.log('─'.repeat(60));
            console.log(content.substring(0, 800));
            console.log('...\n');
          } else {
            // 尝试查找桌面上的最新文件
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
              const latestFile = files[0].path;
              console.log(`📄 最新报告文件: ${latestFile}\n`);
              const content = fs.readFileSync(latestFile, 'utf-8');
              console.log('📋 报告内容预览（前800字符）:');
              console.log('─'.repeat(60));
              console.log(content.substring(0, 800));
              console.log('...\n');
            }
          }

          console.log('✅ 所有任务完成！');
          process.exit(0);
        } catch (error) {
          console.error('\n❌ 报告生成失败:', error);
          process.exit(1);
        }
      } else {
        // 等待一段时间后再次检查
        const waitMinutes = CHECK_INTERVAL_MS / 1000 / 60;
        console.log(`\n⏳ ${waitMinutes} 分钟后再次检查...\n`);
        console.log('═══════════════════════════════════════════════════════════\n');
        await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL_MS));
      }
    }
  } catch (error) {
    console.error('\n❌ 程序执行失败:', error);
    process.exit(1);
  }
}

waitForAllETFData();

