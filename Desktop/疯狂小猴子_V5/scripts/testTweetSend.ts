/**
 * 测试 Twitter 发送功能（使用预发布日志中的推文内容）
 */

import * as path from 'path';
import * as dotenv from 'dotenv';

// 加载环境变量
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { XTweetService } from '../src/services/xTweet.service';
import { XTweetOAuth1Service } from '../src/services/xTweetOAuth1.service';
import { hasValidOAuth1Token } from '../src/services/xOAuth1.service';
import { logger } from '../src/utils/logger';

// 从预发布日志中提取的完整推文内容
const testTweetContent = `✏️ 合约结构预警｜ZEC（Binance · 4H）

1⃣ OI（4h）：$1278.35M
2⃣ Funding：-0.48%
3⃣ Taker：买 $39,765.56 / 卖 $49,546.25
4⃣ Top：多 52.43% / 空 47.57%｜比 1.10

📌 结构状态：结构观察

结论：资金费率显著为负，大户持仓结构轻微偏向多头但整体分歧明显。

🧠 合约结构深度分析｜ZEC（Binance · 4h）

🔎 结构总评：结构分歧，需持续观察

1⃣ 仓位结构（大户）
- 当前：多 52.43% / 空 47.57% ｜比值 1.10
- 变化：持平。最新比值 1.10（中性），上一根比值 1.10（中性），变化幅度 0.00%，强度：弱

2⃣ 资金费率（拥挤度）
- 当前 funding：-0.481300%
- 近6根对比：数据不足，暂不展开

3⃣ 主动成交（短周期情绪）
- 买：$39,765.56 / 卖 $49,546.25
- 失衡度：-0.1095 → 偏空

4⃣ 结构一致性
- 结论：分歧
- 解释：仓位结构中性，资金费率相对均衡，主动成交偏空，三者关系存在分歧

5⃣ 风险清单（仅结构）
- 拥挤度风险：资金费率相对均衡
- 反转风险：结构变化需持续观察
- 结构脆弱性风险：当前结构相对稳定

⚠️ 本内容为结构观察，不构成投资或交易建议。`;

async function testSendTweet() {
  try {
    console.log('🐦 测试 Twitter 发送功能...\n');
    console.log('📝 推文内容：');
    console.log('─'.repeat(50));
    console.log(testTweetContent);
    console.log('─'.repeat(50));
    console.log(`\n字符数: ${testTweetContent.length}\n`);

    const xTweetService = new XTweetService();
    const oauth1TweetService = new XTweetOAuth1Service();

    console.log('🚀 发送推文到 Twitter...\n');

    let result: { tweetId: string; url: string } | null = null;

    try {
      if (hasValidOAuth1Token()) {
        console.log('使用 OAuth 1.0a 发送...\n');
        result = await oauth1TweetService.sendTweet(testTweetContent);
      } else {
        console.log('使用 OAuth 2.0 发送...\n');
        result = await xTweetService.sendTweet(testTweetContent);
      }

      console.log('✅ 推文发送成功！');
      console.log(`- Tweet ID: ${result.tweetId}`);
      console.log(`- URL: ${result.url}\n`);
    } catch (error) {
      console.error('❌ 推文发送失败:', error);
      logger.error({ error }, 'Failed to send tweet');
      throw error;
    }

  } catch (error) {
    console.error('❌ 测试失败:', error);
    logger.error({ error }, 'Test failed');
    process.exit(1);
  }
}

testSendTweet();



