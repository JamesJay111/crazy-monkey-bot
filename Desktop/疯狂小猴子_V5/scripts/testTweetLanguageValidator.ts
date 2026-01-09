/**
 * 测试推文语言校验和 Icon 去重功能
 */

import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import {
  validateTweetLanguage,
  removeSTMTLabels,
  deduplicateIcons,
  type TweetLanguage,
} from '../src/utils/tweetLanguageValidator';

/**
 * 测试用例
 */
const testCases = {
  // 中文测试
  zh: {
    valid: [
      '🚨 US Macro: Non-Farm Payrolls\n⏰ 2026-01-06 12:00 UTC | Impact 3/3\n关注重要事件影响\n监控市场波动',
      '⚠️ US Macro: CPI\n⏰ 2026-01-06 14:00 UTC | Impact 2/3\n数据偏差可能引发波动\n影响中期流动性预期',
    ],
    invalid: [
      '🚨 US Macro: Non-Farm Payrolls\n⏰ 2026-01-06 12:00 UTC | Impact 3/3\n중요 이벤트 주시 필요\n监控市场波动', // 包含韩文
      '🚨 US Macro: Non-Farm Payrolls\n⏰ 2026-01-06 12:00 UTC | Impact 3/3\nMonitor event impact\n监控市场波动', // 包含英文
      '🚨 US Macro: Non-Farm Payrolls\n⏰ 2026-01-06 12:00 UTC | Impact 3/3\nMonitor event impact', // 无中文
    ],
  },
  // 韩文测试
  ko: {
    valid: [
      '🚨 US Macro: Non-Farm Payrolls\n⏰ 2026-01-06 12:00 UTC | Impact 3/3\n중요 이벤트 주시 필요\n시장 변동성 모니터링',
      '⚠️ US Macro: CPI\n⏰ 2026-01-06 14:00 UTC | Impact 2/3\n데이터 편차가 변동성 유발 가능\n중기 유동성 예상에 영향',
    ],
    invalid: [
      '🚨 US Macro: Non-Farm Payrolls\n⏰ 2026-01-06 12:00 UTC | Impact 3/3\n关注重要事件影响\n시장 변동성 모니터링', // 包含中文
      '🚨 US Macro: Non-Farm Payrolls\n⏰ 2026-01-06 12:00 UTC | Impact 3/3\nMonitor event impact\n시장 변동성 모니터링', // 包含英文
      '🚨 US Macro: Non-Farm Payrolls\n⏰ 2026-01-06 12:00 UTC | Impact 3/3\nMonitor event impact', // 无韩文
    ],
  },
  // 英文测试
  en: {
    valid: [
      '🚨 US Macro: Non-Farm Payrolls\n⏰ 2026-01-06 12:00 UTC | Impact 3/3\nMonitor event impact\nWatch market volatility',
      '⚠️ US Macro: CPI\n⏰ 2026-01-06 14:00 UTC | Impact 2/3\nData deviation may trigger volatility\nAffect medium-term liquidity expectations',
    ],
    invalid: [
      '🚨 US Macro: Non-Farm Payrolls\n⏰ 2026-01-06 12:00 UTC | Impact 3/3\n关注重要事件影响\nWatch market volatility', // 包含中文
      '🚨 US Macro: Non-Farm Payrolls\n⏰ 2026-01-06 12:00 UTC | Impact 3/3\n중요 이벤트 주시 필요\nWatch market volatility', // 包含韩文
      '🚨 US Macro: Non-Farm Payrolls\n⏰ 2026-01-06 12:00 UTC | Impact 3/3\n关注重要事件影响\n중요 이벤트 주시 필요', // 无英文
    ],
  },
};

/**
 * 测试 ST/MT 标签移除
 */
const stmtTestCases = [
  {
    input: '🚨 US Macro: Non-Farm Payrolls\n⏰ 2026-01-06 12:00 UTC | Impact 3/3\nST: Monitor event impact\nMT: Watch market volatility',
    expected: '🚨 US Macro: Non-Farm Payrolls\n⏰ 2026-01-06 12:00 UTC | Impact 3/3\nMonitor event impact\nWatch market volatility',
  },
  {
    input: '🚨 US Macro: Non-Farm Payrolls\n⏰ 2026-01-06 12:00 UTC | Impact 3/3\nST: 关注重要事件影响\nMT: 监控市场波动',
    expected: '🚨 US Macro: Non-Farm Payrolls\n⏰ 2026-01-06 12:00 UTC | Impact 3/3\n关注重要事件影响\n监控市场波动',
  },
  {
    input: '🚨 US Macro: Non-Farm Payrolls\n⏰ 2026-01-06 12:00 UTC | Impact 3/3\n단기(ST): 중요 이벤트 주시 필요\n중기(MT): 시장 변동성 모니터링',
    expected: '🚨 US Macro: Non-Farm Payrolls\n⏰ 2026-01-06 12:00 UTC | Impact 3/3\n중요 이벤트 주시 필요\n시장 변동성 모니터링',
  },
];

/**
 * 测试 Icon 去重
 */
const iconTestCases = [
  {
    input: '🚨 US Macro: Non-Farm Payrolls ⚠️\n⏰ 2026-01-06 12:00 UTC | Impact 3/3\nMonitor event impact ⏱️\nWatch market volatility ✅',
    expected: '🚨 US Macro: Non-Farm Payrolls\n⏰ 2026-01-06 12:00 UTC | Impact 3/3\nMonitor event impact\nWatch market volatility',
  },
  {
    input: '⚠️ US Macro: CPI 🚨\n⏰ 2026-01-06 14:00 UTC | Impact 2/3\n关注重要事件影响',
    expected: '⚠️ US Macro: CPI\n⏰ 2026-01-06 14:00 UTC | Impact 2/3\n关注重要事件影响',
  },
];

function runTests() {
  console.log('🧪 推文语言校验和 Icon 去重测试\n');
  console.log('═══════════════════════════════════════════════════════════\n');

  // 测试语言校验
  console.log('📝 1. 语言校验测试\n');
  for (const [lang, cases] of Object.entries(testCases)) {
    console.log(`\n【${lang.toUpperCase()} 语言】\n`);
    
    console.log('✅ 有效推文测试:');
    for (const tweet of cases.valid) {
      const result = validateTweetLanguage(tweet, lang as TweetLanguage);
      const status = result.isValid ? '✅ PASS' : '❌ FAIL';
      console.log(`  ${status}: ${result.isValid ? '通过' : result.reason}`);
      if (!result.isValid) {
        console.log(`    检测到的语言: ${result.detectedLanguage || '未知'}`);
      }
    }

    console.log('\n❌ 无效推文测试:');
    for (const tweet of cases.invalid) {
      const result = validateTweetLanguage(tweet, lang as TweetLanguage);
      const status = !result.isValid ? '✅ PASS' : '❌ FAIL';
      console.log(`  ${status}: ${!result.isValid ? '正确拒绝' : '错误通过'}`);
      if (result.isValid) {
        console.log(`    应该拒绝但通过了`);
      } else {
        console.log(`    拒绝原因: ${result.reason}`);
      }
    }
  }

  // 测试 ST/MT 标签移除
  console.log('\n\n📝 2. ST/MT 标签移除测试\n');
  for (let i = 0; i < stmtTestCases.length; i++) {
    const testCase = stmtTestCases[i];
    const result = removeSTMTLabels(testCase.input);
    const passed = result === testCase.expected;
    console.log(`测试 ${i + 1}: ${passed ? '✅ PASS' : '❌ FAIL'}`);
    if (!passed) {
      console.log(`  输入: ${testCase.input.substring(0, 60)}...`);
      console.log(`  期望: ${testCase.expected.substring(0, 60)}...`);
      console.log(`  实际: ${result.substring(0, 60)}...`);
    }
  }

  // 测试 Icon 去重
  console.log('\n\n📝 3. Icon 去重测试\n');
  for (let i = 0; i < iconTestCases.length; i++) {
    const testCase = iconTestCases[i];
    const result = deduplicateIcons(testCase.input);
    const passed = result === testCase.expected;
    console.log(`测试 ${i + 1}: ${passed ? '✅ PASS' : '❌ FAIL'}`);
    if (!passed) {
      console.log(`  输入: ${testCase.input}`);
      console.log(`  期望: ${testCase.expected}`);
      console.log(`  实际: ${result}`);
    }
  }

  console.log('\n\n✅ 所有测试完成！\n');
}

runTests();

