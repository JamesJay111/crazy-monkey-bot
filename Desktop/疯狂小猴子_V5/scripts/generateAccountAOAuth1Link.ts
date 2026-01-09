/**
 * 为账户A生成 OAuth 1.0a 授权链接
 * 账户A: @CrazyMonkeyPerp
 */

import * as path from 'path';
import * as dotenv from 'dotenv';

// 加载环境变量
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { getRequestToken, buildOAuth1AuthorizeUrl } from '../src/services/xOAuth1.service';
import { logger } from '../src/utils/logger';
import * as fs from 'fs';

/**
 * 生成账户A的OAuth 1.0a授权链接
 */
async function generateAccountALink() {
  try {
    console.log('🔐 为账户A (@CrazyMonkeyPerp) 生成 OAuth 1.0a 授权链接\n');
    console.log('═══════════════════════════════════════════════════════════\n');

    // 获取 Request Token
    console.log('1️⃣ 获取 Request Token...');
    const requestToken = await getRequestToken();
    console.log(`   ✅ Request Token 获取成功\n`);

    // 保存 Request Token（用于后续交换 Access Token）
    const requestTokenPath = path.resolve('./data/oauth1_request_tokens_accountA.json');
    const requestTokenData = {
      oauthToken: requestToken.oauthToken,
      oauthTokenSecret: requestToken.oauthTokenSecret,
      createdAt: Date.now(),
      accountLabel: 'accountA',
    };

    const dir = path.dirname(requestTokenPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(requestTokenPath, JSON.stringify(requestTokenData, null, 2), 'utf-8');
    console.log(`   📄 Request Token 已保存到: ${requestTokenPath}\n`);

    // 生成授权 URL
    const authorizeUrl = buildOAuth1AuthorizeUrl(requestToken.oauthToken);
    console.log('2️⃣ 授权链接已生成\n');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📱 账户A (@CrazyMonkeyPerp) - OAuth 1.0a 授权链接');
    console.log('═══════════════════════════════════════════════════════════\n');
    console.log(authorizeUrl);
    console.log('\n═══════════════════════════════════════════════════════════\n');

    console.log('💡 OAuth 1.0a 授权流程（3步）\n');
    console.log('步骤 1: 获取授权链接（已完成 ✅）');
    console.log('步骤 2: 在浏览器中打开上述链接，使用账户A (@CrazyMonkeyPerp) 登录并授权');
    console.log('步骤 3: 获取 PIN 码后，运行以下命令完成授权：');
    console.log(`   node -r ts-node/register scripts/completeAccountAOAuth1Auth.ts <PIN码>\n`);

    // 保存到桌面文件
    const desktopPath = path.join(process.env.HOME || '', 'Desktop');
    const linkFile = path.join(desktopPath, 'Twitter_OAuth1_授权链接_账户A.txt');
    const linkContent = `账户A (@CrazyMonkeyPerp) - OAuth 1.0a 授权链接

授权链接:
${authorizeUrl}

授权流程:
1. 在浏览器中打开上述链接
2. 使用账户A (@CrazyMonkeyPerp) 登录并授权
3. 获取 PIN 码
4. 运行命令完成授权:
   node -r ts-node/register scripts/completeAccountAOAuth1Auth.ts <PIN码>

Request Token 已保存到:
${requestTokenPath}

生成时间: ${new Date().toLocaleString('zh-CN')}
`;

    fs.writeFileSync(linkFile, linkContent, 'utf-8');
    console.log(`📄 授权链接已保存到桌面文件: ${linkFile}\n`);

    console.log('✅ 授权链接生成完成！\n');

  } catch (error) {
    console.error('❌ 生成授权链接失败:', error);
    logger.error({ error }, 'Failed to generate OAuth 1.0a link for account A');
    process.exit(1);
  }
}

// 运行
generateAccountALink();



