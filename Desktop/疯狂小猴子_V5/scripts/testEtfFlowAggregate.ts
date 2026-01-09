import { aggregateEtfFlows, validateAggregateResult } from '../src/utils/etfFlowAggregate';
import { CoinGlassETFFlow } from '../src/types';

/**
 * 测试统一汇总逻辑
 */
function testAggregateLogic() {
  console.log('🧪 测试 ETF 资金流统一汇总逻辑\n');

  // 测试用例1：BTCO -10.4M, ARKB -6.7M, FBTC +5.7M
  console.log('测试用例1: BTCO -10.4M, ARKB -6.7M, FBTC +5.7M');
  const testRecords1: CoinGlassETFFlow[] = [{
    timestamp: 1234567890,
    flow_usd: '0',
    price_usd: '87920.4',
    etf_flows: [
      { etf_ticker: 'BTCO', flow_usd: '-10400000' },
      { etf_ticker: 'ARKB', flow_usd: '-6700000' },
      { etf_ticker: 'FBTC', flow_usd: '5700000' },
    ]
  }];

  const result1 = aggregateEtfFlows(testRecords1);
  const validation1 = validateAggregateResult(result1, testRecords1);

  console.log('  净流入:', result1.netFlowUsd);
  console.log('  总流入:', result1.inflowUsd);
  console.log('  总流出:', result1.outflowAbsUsd);
  console.log('  按ticker:', result1.byTickerMap);
  console.log('  校验通过:', validation1.isValid);
  if (!validation1.isValid) {
    console.log('  校验错误:', validation1.errors);
  }
  console.log('  期望: inflow=5.7M, outflowAbs=17.1M, net=-11.4M');
  console.log('  结果:', 
    result1.inflowUsd === 5700000 ? '✅' : '❌',
    result1.outflowAbsUsd === 17100000 ? '✅' : '❌',
    result1.netFlowUsd === -11400000 ? '✅' : '❌'
  );
  console.log('');

  // 测试用例2：多个ETF，包含0值
  console.log('测试用例2: 多个ETF，包含0值和缺失值');
  const testRecords2: CoinGlassETFFlow[] = [{
    timestamp: 1234567890,
    flow_usd: '3700000',
    price_usd: '2949.6',
    etf_flows: [
      { etf_ticker: 'FETH', flow_usd: '3700000' },
      { etf_ticker: 'ETHA', flow_usd: '0' },
      { etf_ticker: 'ETHE', flow_usd: '' }, // 缺失值
    ]
  }];

  const result2 = aggregateEtfFlows(testRecords2);
  const validation2 = validateAggregateResult(result2, testRecords2);

  console.log('  净流入:', result2.netFlowUsd);
  console.log('  总流入:', result2.inflowUsd);
  console.log('  总流出:', result2.outflowAbsUsd);
  console.log('  按ticker:', result2.byTickerMap);
  console.log('  校验通过:', validation2.isValid);
  console.log('  期望: inflow=3.7M, outflowAbs=0, net=3.7M');
  console.log('  结果:', 
    result2.inflowUsd === 3700000 ? '✅' : '❌',
    result2.outflowAbsUsd === 0 ? '✅' : '❌',
    result2.netFlowUsd === 3700000 ? '✅' : '❌'
  );
  console.log('');

  console.log('✅ 测试完成');
}

testAggregateLogic();



