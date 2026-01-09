/**
 * Twitter API 测试工具
 * 用于诊断 403 错误
 */

import * as path from 'path';
import * as dotenv from 'dotenv';
import axios from 'axios';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { getTokenManager } from '../src/services/xTokenManager.service';
import { logger } from '../src/utils/logger';

async function testTwitterAPI() {
  try {
    console.log('🔍 Twitter API 诊断工具\n');
    console.log('==============================\n');

    // 1. 检查 Token
    const tokenManager = getTokenManager();
    const tokenInfo = tokenManager.getTokenInfo();
    
    console.log('1️⃣  Token 状态:');
    console.log(`   - 有 Token: ${tokenInfo.hasToken ? '✅' : '❌'}`);
    console.log(`   - 有 Refresh Token: ${tokenInfo.hasRefreshToken ? '✅' : '❌'}`);
    console.log(`   - 已过期: ${tokenInfo.isExpired ? '❌' : '✅'}`);
    console.log(`   - 过期时间: ${tokenInfo.expiresAt || 'N/A'}`);
    console.log(`   - 剩余时间: ${tokenInfo.timeUntilExpiry ? `${Math.floor(tokenInfo.timeUntilExpiry / 60)} 分钟` : 'N/A'}`);
    console.log('');

    if (!tokenInfo.hasToken) {
      console.log('❌ 没有 Token，请先授权');
      return;
    }

    // 2. 获取有效 Token
    const accessToken = await tokenManager.getValidAccessToken();
    if (!accessToken) {
      console.log('❌ 无法获取有效 Token');
      return;
    }

    console.log('2️⃣  Token 信息:');
    console.log(`   - Access Token: ${accessToken.substring(0, 20)}...`);
    console.log('');

    // 3. 测试获取用户信息（Read 权限）
    console.log('3️⃣  测试 Read 权限（获取用户信息）...');
    try {
      const userResponse = await axios.get('https://api.twitter.com/2/users/me', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
        params: {
          'user.fields': 'id,name,username',
        },
      });

      const user = userResponse.data.data;
      console.log(`   ✅ Read 权限正常`);
      console.log(`   - 用户 ID: ${user.id}`);
      console.log(`   - 用户名: @${user.username}`);
      console.log(`   - 显示名称: ${user.name}`);
      console.log('');
    } catch (error: any) {
      console.log(`   ❌ Read 权限失败: ${error.response?.status} ${error.response?.statusText}`);
      console.log(`   - 错误详情: ${JSON.stringify(error.response?.data, null, 2)}`);
      console.log('');
    }

    // 4. 测试发送推文（Write 权限）
    console.log('4️⃣  测试 Write 权限（发送推文）...');
    const testTweetText = `🧪 测试推文 - ${new Date().toLocaleString('zh-CN')}`;
    
    try {
      const tweetResponse = await axios.post(
        'https://api.twitter.com/2/tweets',
        {
          text: testTweetText,
        },
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const tweet = tweetResponse.data.data;
      console.log(`   ✅ Write 权限正常`);
      console.log(`   - 推文 ID: ${tweet.id}`);
      console.log(`   - 推文 URL: https://twitter.com/i/web/status/${tweet.id}`);
      console.log(`   - 推文内容: ${testTweetText}`);
      console.log('');
      console.log('🎉 Twitter API 测试成功！');
    } catch (error: any) {
      console.log(`   ❌ Write 权限失败: ${error.response?.status} ${error.response?.statusText}`);
      console.log(`   - 错误详情: ${JSON.stringify(error.response?.data, null, 2)}`);
      console.log('');
      
      if (error.response?.status === 403) {
        console.log('⚠️  403 Forbidden 错误分析:');
        console.log('   可能的原因:');
        console.log('   1. Twitter Developer Portal 中 App permissions 未设置为 "Read and write"');
        console.log('   2. App Type 不是 "Web App, Automated App or Bot"');
        console.log('   3. OAuth 2.0 未启用');
        console.log('   4. 权限修改后未重新授权（需要删除旧 token 并重新授权）');
        console.log('');
        console.log('📋 解决步骤:');
        console.log('   1. 访问 https://developer.twitter.com/en/portal/dashboard');
        console.log('   2. 检查 App permissions = "Read and write"');
        console.log('   3. 检查 App Type = "Web App, Automated App or Bot"');
        console.log('   4. 如果修改了权限，删除旧 token: rm ./data/x_tokens.json');
        console.log('   5. 重新授权: http://localhost:8787/x/auth');
        console.log('');
      }
    }

  } catch (error) {
    console.error('❌ 测试失败:', error);
    logger.error({ error }, 'Twitter API test failed');
  }
}

testTwitterAPI();

