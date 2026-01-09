/**
 * 快速测试 Twitter API
 * 简化版本，直接测试并给出明确结果
 */

const axios = require('axios');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

async function quickTest() {
  console.log('🧪 Twitter API 快速测试\n');
  console.log('==============================\n');

  // 读取 token
  const tokenFile = path.join(__dirname, '../data/x_tokens.json');
  if (!fs.existsSync(tokenFile)) {
    console.log('❌ 没有找到 Token 文件');
    console.log('请先授权: http://localhost:8787/x/auth\n');
    return;
  }

  const tokenData = JSON.parse(fs.readFileSync(tokenFile, 'utf-8'));
  const accessToken = tokenData.access_token;
  const scope = tokenData.scope || '';

  console.log('1️⃣  Token 信息:');
  console.log(`   - Scope: ${scope}`);
  console.log(`   - 包含 tweet.write: ${scope.includes('tweet.write') ? '✅' : '❌'}\n`);

  if (!scope.includes('tweet.write')) {
    console.log('❌ Token scope 不包含 tweet.write');
    console.log('请重新授权\n');
    return;
  }

  // 测试 Read 权限
  console.log('2️⃣  测试 Read 权限...');
  try {
    const userResponse = await axios.get('https://api.twitter.com/2/users/me', {
      headers: { 'Authorization': `Bearer ${accessToken}` },
      params: { 'user.fields': 'id,name,username' },
    });
    const user = userResponse.data.data;
    console.log(`   ✅ Read 权限正常`);
    console.log(`   - 用户: @${user.username} (${user.name})\n`);
  } catch (error) {
    console.log(`   ❌ Read 权限失败: ${error.response?.status} ${error.response?.statusText}`);
    if (error.response?.status === 403) {
      console.log('   ⚠️  403 错误：App permissions 可能仍然是 "Read only"\n');
    }
    return;
  }

  // 测试 Write 权限
  console.log('3️⃣  测试 Write 权限（发送测试推文）...');
  const testTweet = `🧪 测试推文 - ${new Date().toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  
  try {
    const tweetResponse = await axios.post(
      'https://api.twitter.com/2/tweets',
      { text: testTweet },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const tweet = tweetResponse.data.data;
    console.log(`   ✅ Write 权限正常！`);
    console.log(`   - 推文 ID: ${tweet.id}`);
    console.log(`   - 推文 URL: https://twitter.com/i/web/status/${tweet.id}`);
    console.log(`   - 推文内容: ${testTweet}\n`);
    console.log('🎉 Twitter API 测试成功！可以正常发推了！\n');
  } catch (error) {
    console.log(`   ❌ Write 权限失败: ${error.response?.status} ${error.response?.statusText}`);
    if (error.response?.status === 403) {
      console.log('\n   ⚠️  403 Forbidden 错误分析：\n');
      console.log('   可能的原因：');
      console.log('   1. Twitter Developer Portal 中 App permissions 仍然是 "Read only"');
      console.log('   2. 权限修改后还没有生效（需要等待 5-10 分钟）');
      console.log('   3. 授权时授权页面显示的是 "Read only"（不是 "Read and write"）\n');
      console.log('   📋 解决步骤：');
      console.log('   1. 访问 https://developer.twitter.com/en/portal/dashboard');
      console.log('   2. 确认 App permissions = "Read and write"');
      console.log('   3. 如果刚修改，等待 5-10 分钟');
      console.log('   4. 删除旧 token: rm ./data/x_tokens.json');
      console.log('   5. 重新授权: http://localhost:8787/x/auth');
      console.log('   6. 授权时确认页面显示 "Read and write"\n');
    }
  }
}

quickTest().catch(console.error);

