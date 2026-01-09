/**
 * 完成账户A的 OAuth 1.0a 授权
 * 使用 PIN 码交换 Access Token
 */

import * as path from 'path';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

// 加载环境变量
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { exchangeOAuth1AccessToken } from '../src/services/xOAuth1.service';
import { logger } from '../src/utils/logger';

/**
 * 完成账户A的OAuth 1.0a授权
 */
async function completeAccountAAuth() {
  try {
    const pinCode = process.argv[2];

    if (!pinCode) {
      console.error('❌ 请提供 PIN 码');
      console.log('用法: node -r ts-node/register scripts/completeAccountAOAuth1Auth.ts <PIN码>');
      process.exit(1);
    }

    console.log('🔐 完成账户A (@CrazyMonkeyPerp) 的 OAuth 1.0a 授权\n');
    console.log('═══════════════════════════════════════════════════════════\n');

    // 读取 Request Token
    const requestTokenPath = path.resolve('./data/oauth1_request_tokens_accountA.json');
    if (!fs.existsSync(requestTokenPath)) {
      console.error('❌ Request Token 文件不存在，请先运行 generateAccountAOAuth1Link.ts');
      process.exit(1);
    }

    const requestTokenData = JSON.parse(fs.readFileSync(requestTokenPath, 'utf-8'));
    console.log(`📋 Request Token: ${requestTokenData.oauthToken.substring(0, 20)}...`);
    console.log(`📋 PIN 码: ${pinCode}\n`);

    // 交换 Access Token
    console.log('🔄 正在交换 Access Token...\n');
    const tokenStore = await exchangeOAuth1AccessToken(
      requestTokenData.oauthToken,
      requestTokenData.oauthTokenSecret,
      pinCode
    );

    // 保存 Access Token（保存到默认路径，作为账户A的Token）
    const tokenPath = path.resolve('./data/x_oauth1_tokens.json');
    const dir = path.dirname(tokenPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // 添加账户标识
    const tokenData = {
      ...tokenStore,
      accountLabel: 'accountA',
    };

    fs.writeFileSync(tokenPath, JSON.stringify(tokenData, null, 2), 'utf-8');

    console.log('✅ 授权成功！');
    console.log(`📄 Access Token 已保存到: ${tokenPath}`);
    console.log(`👤 用户 ID: ${tokenStore.userId}`);
    console.log(`👤 用户名: ${tokenStore.screenName}`);
    console.log(`📅 授权时间: ${new Date(tokenStore.obtainedAt).toLocaleString('zh-CN')}\n`);

    // 删除 Request Token 文件
    fs.unlinkSync(requestTokenPath);
    console.log(`🗑️  已删除 Request Token 文件: ${requestTokenPath}\n`);

    // 验证用户名
    if (tokenStore.screenName !== 'CrazyMonkeyPerp') {
      console.log('⚠️  警告: 用户名不匹配！');
      console.log(`   期望: CrazyMonkeyPerp`);
      console.log(`   实际: ${tokenStore.screenName}`);
      console.log(`   请确认这是账户A的Token\n`);
    } else {
      console.log('✅ 用户名验证通过: @CrazyMonkeyPerp\n');
    }

    console.log('✅ 账户A授权完成！');

  } catch (error) {
    console.error('❌ 授权失败:', error);
    logger.error({ error }, 'Failed to complete OAuth 1.0a auth for account A');
    process.exit(1);
  }
}

// 运行
completeAccountAAuth();



