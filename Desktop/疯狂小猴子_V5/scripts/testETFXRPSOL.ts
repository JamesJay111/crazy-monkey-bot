/**
 * 测试 SOL 和 XRP ETF 数据解析和格式化
 * 使用用户提供的 mock 数据验证容错处理
 */

import * as path from 'path';
import * as dotenv from 'dotenv';

// 加载环境变量
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { ETFService } from '../src/services/etf.service';
import { CoinGlassClient } from '../src/clients/coinglass.client';
import { DeepSeekClient } from '../src/clients/deepseek.client';
import { CoinGlassETFFlow } from '../src/types';

/**
 * Mock XRP ETF 数据（用户提供的示例）
 */
const mockXRPData: CoinGlassETFFlow[] = [
  {
    timestamp: 1763078400000,
    flow_usd: '243050000',
    price_usd: '2.3212',
    etf_flows: [
      { etf_ticker: 'XRPC', flow_usd: '243050000' },
      { etf_ticker: 'XRPZ' }, // 缺失 flow_usd
      { etf_ticker: 'XRP' }, // 缺失 flow_usd
      { etf_ticker: 'GXRP' }, // 缺失 flow_usd
    ],
  },
];

/**
 * Mock SOL ETF 数据（用户提供的示例）
 */
const mockSOLData: CoinGlassETFFlow[] = [
  {
    timestamp: 1762473600000,
    flow_usd: '12700000',
    price_usd: '155.2',
    etf_flows: [
      { etf_ticker: 'BSOL', flow_usd: '11700000' },
      { etf_ticker: 'VSOL' }, // 缺失 flow_usd
      { etf_ticker: 'FSOL' }, // 缺失 flow_usd
      { etf_ticker: 'TSOL' }, // 缺失 flow_usd
      { etf_ticker: 'GSOL', flow_usd: '1000000' },
    ],
  },
];

/**
 * 测试格式化输出
 */
async function testFormatting() {
  console.log('🧪 测试 ETF 数据格式化（容错处理）\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  // 创建服务实例（不需要真实的 API 调用）
  const coinglass = new CoinGlassClient();
  const deepseek = new DeepSeekClient();
  const etfService = new ETFService(coinglass, deepseek);

  // 测试 XRP
  console.log('📊 测试 XRP ETF 数据格式化\n');
  const xrpFlow = mockXRPData[0];
  const xrpFormatted = etfService.formatLatestFlow(xrpFlow, 'XRP');
  console.log(xrpFormatted);
  console.log('\n');

  // 验证：应该显示所有 ETF，缺失 flow_usd 的显示为 "—"
  const hasXRPC = xrpFormatted.includes('XRPC');
  const hasXRPZ = xrpFormatted.includes('XRPZ');
  const hasXRP = xrpFormatted.includes('XRP');
  const hasGXRP = xrpFormatted.includes('GXRP');
  const hasDash = xrpFormatted.includes('—');

  console.log('✅ XRP 验证结果:');
  console.log(`   - XRPC (有 flow_usd): ${hasXRPC ? '✅' : '❌'}`);
  console.log(`   - XRPZ (缺失 flow_usd): ${hasXRPZ ? '✅' : '❌'}`);
  console.log(`   - XRP (缺失 flow_usd): ${hasXRP ? '✅' : '❌'}`);
  console.log(`   - GXRP (缺失 flow_usd): ${hasGXRP ? '✅' : '❌'}`);
  console.log(`   - 显示 "—" 符号: ${hasDash ? '✅' : '❌'}`);
  console.log('\n');

  // 测试 SOL
  console.log('📊 测试 SOL ETF 数据格式化\n');
  const solFlow = mockSOLData[0];
  const solFormatted = etfService.formatLatestFlow(solFlow, 'SOL');
  console.log(solFormatted);
  console.log('\n');

  // 验证：应该显示所有 ETF，缺失 flow_usd 的显示为 "—"
  const hasBSOL = solFormatted.includes('BSOL');
  const hasVSOL = solFormatted.includes('VSOL');
  const hasFSOL = solFormatted.includes('FSOL');
  const hasTSOL = solFormatted.includes('TSOL');
  const hasGSOL = solFormatted.includes('GSOL');
  const hasDashSOL = solFormatted.includes('—');

  console.log('✅ SOL 验证结果:');
  console.log(`   - BSOL (有 flow_usd): ${hasBSOL ? '✅' : '❌'}`);
  console.log(`   - VSOL (缺失 flow_usd): ${hasVSOL ? '✅' : '❌'}`);
  console.log(`   - FSOL (缺失 flow_usd): ${hasFSOL ? '✅' : '❌'}`);
  console.log(`   - TSOL (缺失 flow_usd): ${hasTSOL ? '✅' : '❌'}`);
  console.log(`   - GSOL (有 flow_usd): ${hasGSOL ? '✅' : '❌'}`);
  console.log(`   - 显示 "—" 符号: ${hasDashSOL ? '✅' : '❌'}`);
  console.log('\n');

  // 测试历史数据摘要
  console.log('📈 测试历史数据摘要格式化\n');
  const historyFormatted = etfService.formatHistorySummary(mockXRPData, 'XRP');
  console.log(historyFormatted);
  console.log('\n');

  console.log('═══════════════════════════════════════════════════════════');
  console.log('✅ 所有测试完成！');
  console.log('\n💡 验证要点:');
  console.log('   1. 所有 ETF ticker 都应该显示（即使缺失 flow_usd）');
  console.log('   2. 缺失 flow_usd 的项应该显示为 "—"');
  console.log('   3. 有 flow_usd 的项应该正确格式化显示');
  console.log('   4. 日期格式化应该与 BTC/ETH 一致');
}

// 运行测试
testFormatting().catch(console.error);



