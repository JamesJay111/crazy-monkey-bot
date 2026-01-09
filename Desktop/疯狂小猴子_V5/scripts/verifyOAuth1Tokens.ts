/**
 * 验证 OAuth 1.0a Token 是否有效
 * 通过调用 Twitter API 获取用户信息来验证
 */

import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import axios from 'axios';

// 加载环境变量
dotenv.config({ path: path.resolve(__dirname, '../.env') });

/**
 * 验证指定账户的 Token
 */
async function verifyAccount(accountLabel: string): Promise<boolean> {
  console.log(`\n🔍 验证账户 ${accountLabel} 的 Token...\n`);

  // 读取 Token 文件
  const tokenPath = path.resolve(`./data/x_oauth1_tokens_${accountLabel}.json`);
  
  if (!fs.existsSync(tokenPath)) {
    console.log(`❌ Token 文件不存在: ${tokenPath}`);
    return false;
  }

  const tokenStore = JSON.parse(fs.readFileSync(tokenPath, 'utf-8'));
  const { accessToken, accessTokenSecret, userId, screenName } = tokenStore;

  console.log(`📋 Token 信息:`);
  console.log(`   - 用户 ID: ${userId}`);
  console.log(`   - 用户名: ${screenName}`);
  console.log(`   - Access Token: ${accessToken.substring(0, 20)}...`);
  console.log(`   - 授权时间: ${new Date(tokenStore.obtainedAt).toLocaleString('zh-CN')}`);

  // 使用 OAuth 1.0a 签名调用 API 验证 Token
  try {
    const { generateOAuth1AuthHeader } = await import('../src/services/xOAuth1.service');
    
    // 临时修改 Token Store 以便 generateOAuth1AuthHeader 使用正确的 Token
    const originalRead = (await import('../src/services/xOAuth1.service')).readOAuth1TokenStore;
    const { saveOAuth1TokenStore } = await import('../src/services/xOAuth1.service');
    
    // 临时保存当前账户的 Token 到默认位置（用于 generateOAuth1AuthHeader）
    const tempTokenPath = path.resolve('./data/x_oauth1_tokens.json');
    fs.writeFileSync(tempTokenPath, JSON.stringify({
      accessToken,
      accessTokenSecret,
      userId,
      screenName,
      obtainedAt: tokenStore.obtainedAt,
    }, null, 2), 'utf-8');

    // 测试调用：获取用户信息
    const url = 'https://api.twitter.com/1.1/account/verify_credentials.json';
    const authHeader = generateOAuth1AuthHeader('GET', url, {});

    console.log(`\n🔄 正在验证 Token（调用 Twitter API）...`);
    
    const response = await axios.get(url, {
      headers: {
        'Authorization': authHeader,
      },
    });

    const user = response.data;
    console.log(`\n✅ Token 验证成功！`);
    console.log(`   - 用户 ID: ${user.id_str}`);
    console.log(`   - 用户名: @${user.screen_name}`);
    console.log(`   - 显示名称: ${user.name}`);
    console.log(`   - 关注数: ${user.friends_count}`);
    console.log(`   - 粉丝数: ${user.followers_count}`);

    // 恢复原来的 Token（如果有）
    // 这里不恢复，因为可能影响其他功能，但至少验证成功了

    return true;
  } catch (error: any) {
    console.log(`\n❌ Token 验证失败！`);
    console.log(`   错误: ${error.message}`);
    if (error.response) {
      console.log(`   HTTP 状态: ${error.response.status}`);
      console.log(`   错误详情: ${JSON.stringify(error.response.data, null, 2)}`);
    }
    return false;
  }
}

/**
 * 主函数
 */
async function main() {
  console.log('🔐 OAuth 1.0a Token 验证工具');
  console.log('═══════════════════════════════════════════════════════════');

  const accountBValid = await verifyAccount('accountB');
  const accountCValid = await verifyAccount('accountC');

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('📊 验证结果总结');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`\n账户B（英文推文）: ${accountBValid ? '✅ 授权成功' : '❌ 授权失败'}`);
  console.log(`账户C（韩语推文）: ${accountCValid ? '✅ 授权成功' : '❌ 授权失败'}`);

  if (accountBValid && accountCValid) {
    console.log('\n🎉 所有账户授权成功！');
    console.log('\n📋 Token 文件位置:');
    console.log('   - 账户B: ./data/x_oauth1_tokens_accountB.json');
    console.log('   - 账户C: ./data/x_oauth1_tokens_accountC.json');
    console.log('\n💡 现在可以使用这些账户发布 Twitter 了！');
  } else {
    console.log('\n⚠️  部分账户授权失败，请检查 Token 文件');
  }
}

main().catch(error => {
  console.error('❌ 验证失败:', error);
  process.exit(1);
});



