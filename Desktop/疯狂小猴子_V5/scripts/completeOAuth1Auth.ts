/**
 * 完成 OAuth 1.0a 授权（使用 PIN 码交换 Access Token）
 * 用法: node -r ts-node/register scripts/completeOAuth1Auth.ts <accountLabel> <PIN码>
 * 例如: node -r ts-node/register scripts/completeOAuth1Auth.ts accountB 1234567
 */

import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

// 加载环境变量
dotenv.config({ path: path.resolve(__dirname, '../.env') });

/**
 * 主函数
 */
async function main() {
  const accountLabel = process.argv[2];
  const pinCode = process.argv[3];

  if (!accountLabel || !pinCode) {
    console.error('❌ 用法: node -r ts-node/register scripts/completeOAuth1Auth.ts <accountLabel> <PIN码>');
    console.error('   例如: node -r ts-node/register scripts/completeOAuth1Auth.ts accountB 1234567');
    process.exit(1);
  }

  console.log(`🔐 完成 OAuth 1.0a 授权（账户: ${accountLabel}）\n`);

  // 读取保存的 Request Token
  const tokenStorePath = path.resolve(`./data/oauth1_request_tokens_${accountLabel}.json`);
  
  if (!fs.existsSync(tokenStorePath)) {
    console.error(`❌ 错误: 找不到 Request Token 文件: ${tokenStorePath}`);
    console.error('   请先运行 generateOAuth1AuthLinks.ts 生成授权链接');
    process.exit(1);
  }

  const requestTokenData = JSON.parse(fs.readFileSync(tokenStorePath, 'utf-8'));
  const { oauthToken, oauthTokenSecret } = requestTokenData;

  console.log(`📋 Request Token: ${oauthToken.substring(0, 20)}...`);
  console.log(`📋 PIN 码: ${pinCode}\n`);

  try {
    // 交换 Access Token
    const { exchangeOAuth1AccessToken, saveOAuth1TokenStore } = await import('../src/services/xOAuth1.service');
    
    console.log('🔄 正在交换 Access Token...');
    const tokenStore = await exchangeOAuth1AccessToken(oauthToken, oauthTokenSecret, pinCode);
    
    // 保存 Access Token（根据账户标签保存到不同文件）
    const storePath = path.resolve(`./data/x_oauth1_tokens_${accountLabel}.json`);
    const storeDir = path.dirname(storePath);
    if (!fs.existsSync(storeDir)) {
      fs.mkdirSync(storeDir, { recursive: true });
    }
    
    // 添加账户标签
    const storeWithLabel = {
      ...tokenStore,
      accountLabel,
    };
    
    fs.writeFileSync(storePath, JSON.stringify(storeWithLabel, null, 2), 'utf-8');
    
    console.log('\n✅ 授权成功！');
    console.log(`📄 Access Token 已保存到: ${storePath}`);
    console.log(`👤 用户 ID: ${tokenStore.userId}`);
    console.log(`👤 用户名: ${tokenStore.screenName}`);
    console.log(`📅 授权时间: ${new Date(tokenStore.obtainedAt).toLocaleString('zh-CN')}`);
    
    // 删除 Request Token 文件（已使用）
    fs.unlinkSync(tokenStorePath);
    console.log(`\n🗑️  已删除 Request Token 文件: ${tokenStorePath}`);
    
  } catch (error: any) {
    console.error('\n❌ 授权失败:', error.message);
    if (error.response?.data) {
      console.error('   错误详情:', error.response.data);
    }
    process.exit(1);
  }
}

main().catch(error => {
  console.error('❌ 完成授权失败:', error);
  process.exit(1);
});



