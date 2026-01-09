/**
 * 为账户B和账户C生成 Twitter OAuth 1.0a 授权链接
 * OAuth 1.0a 使用 "oob" (out-of-band) 模式，不需要回调 URL
 * 账户B：英文推文
 * 账户C：韩语推文
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
  console.log('🔗 生成 Twitter OAuth 1.0a 授权链接（账户B和账户C）\n');

  const { getRequestToken, buildOAuth1AuthorizeUrl } = await import('../src/services/xOAuth1.service');

  // 账户B（英文）
  console.log('📝 生成账户B（英文）OAuth 1.0a 授权链接...');
  let oauth1UrlB = '';
  let oauthTokenB = '';
  let oauthTokenSecretB = '';
  
  try {
    const requestTokenB = await getRequestToken();
    oauth1UrlB = buildOAuth1AuthorizeUrl(requestTokenB.oauthToken);
    oauthTokenB = requestTokenB.oauthToken;
    oauthTokenSecretB = requestTokenB.oauthTokenSecret;
    
    // 保存 request token 以便后续交换
    const tokenStorePathB = path.resolve('./data/oauth1_request_tokens_accountB.json');
    const tokenDirB = path.dirname(tokenStorePathB);
    if (!fs.existsSync(tokenDirB)) {
      fs.mkdirSync(tokenDirB, { recursive: true });
    }
    
    fs.writeFileSync(tokenStorePathB, JSON.stringify({
      oauthToken: requestTokenB.oauthToken,
      oauthTokenSecret: requestTokenB.oauthTokenSecret,
      accountLabel: 'accountB',
      createdAt: Date.now(),
    }, null, 2), 'utf-8');
    
    console.log('✅ 账户B OAuth 1.0a 链接已生成');
  } catch (error) {
    console.error('❌ 账户B OAuth 1.0a 链接生成失败:', (error as Error).message);
  }

  // 账户C（韩语）
  console.log('📝 生成账户C（韩语）OAuth 1.0a 授权链接...');
  let oauth1UrlC = '';
  let oauthTokenC = '';
  let oauthTokenSecretC = '';
  
  try {
    const requestTokenC = await getRequestToken();
    oauth1UrlC = buildOAuth1AuthorizeUrl(requestTokenC.oauthToken);
    oauthTokenC = requestTokenC.oauthToken;
    oauthTokenSecretC = requestTokenC.oauthTokenSecret;
    
    // 保存 request token 以便后续交换
    const tokenStorePathC = path.resolve('./data/oauth1_request_tokens_accountC.json');
    const tokenDirC = path.dirname(tokenStorePathC);
    if (!fs.existsSync(tokenDirC)) {
      fs.mkdirSync(tokenDirC, { recursive: true });
    }
    
    fs.writeFileSync(tokenStorePathC, JSON.stringify({
      oauthToken: requestTokenC.oauthToken,
      oauthTokenSecret: requestTokenC.oauthTokenSecret,
      accountLabel: 'accountC',
      createdAt: Date.now(),
    }, null, 2), 'utf-8');
    
    console.log('✅ 账户C OAuth 1.0a 链接已生成');
  } catch (error) {
    console.error('❌ 账户C OAuth 1.0a 链接生成失败:', (error as Error).message);
  }

  // 保存到桌面
  const desktopPath = path.join(process.env.HOME || '', 'Desktop');
  const filePath = path.join(desktopPath, 'Twitter_OAuth1_授权链接_账户B和C.txt');
  
  const content = `Twitter OAuth 1.0a 授权链接（账户B和账户C）
生成时间: ${new Date().toLocaleString('zh-CN')}

═══════════════════════════════════════════════════════════
📱 账户B（英文推文）- OAuth 1.0a 授权链接
═══════════════════════════════════════════════════════════

授权链接:
${oauth1UrlB}

使用说明:
1. 确保你已登录 Twitter 账户B（英文账户）
2. 复制上面的授权链接到浏览器打开
3. 授权后会显示一个 PIN 码（Verifier）
4. 将 PIN 码保存下来，后续需要用它来交换 Access Token

技术信息:
- OAuth Token: ${oauthTokenB}
- Request Token 已保存到: ./data/oauth1_request_tokens_accountB.json
- 授权后需要 PIN 码来完成授权流程

⚠️  重要提示:
- OAuth 1.0a 使用 "oob" (out-of-band) 模式
- 不需要配置 Callback URL
- 授权后会显示 PIN 码，需要手动输入完成授权


═══════════════════════════════════════════════════════════
📱 账户C（韩语推文）- OAuth 1.0a 授权链接
═══════════════════════════════════════════════════════════

授权链接:
${oauth1UrlC}

使用说明:
1. 确保你已登录 Twitter 账户C（韩语账户）
2. 复制上面的授权链接到浏览器打开
3. 授权后会显示一个 PIN 码（Verifier）
4. 将 PIN 码保存下来，后续需要用它来交换 Access Token

技术信息:
- OAuth Token: ${oauthTokenC}
- Request Token 已保存到: ./data/oauth1_request_tokens_accountC.json
- 授权后需要 PIN 码来完成授权流程

⚠️  重要提示:
- OAuth 1.0a 使用 "oob" (out-of-band) 模式
- 不需要配置 Callback URL
- 授权后会显示 PIN 码，需要手动输入完成授权


═══════════════════════════════════════════════════════════
💡 OAuth 1.0a 授权流程说明
═══════════════════════════════════════════════════════════

OAuth 1.0a 授权流程（3步）：

步骤 1: 获取授权链接（已完成）
  ✅ 已生成授权链接
  ✅ Request Token 已保存

步骤 2: 用户授权并获取 PIN 码
  1. 在浏览器中打开授权链接
  2. 登录 Twitter 账户
  3. 点击 "Authorize app" 授权
  4. 授权后会显示一个 PIN 码（例如：1234567）
  5. 复制并保存这个 PIN 码

步骤 3: 使用 PIN 码交换 Access Token
  访问 OAuth Server 的 PIN 码提交页面：
  http://localhost:8787/x/oauth1/verify
  
  或者使用命令行工具完成授权


═══════════════════════════════════════════════════════════
🔧 完成授权的方法
═══════════════════════════════════════════════════════════

方法 1: 使用 OAuth Server Web 界面（推荐）
  1. 确保 OAuth Server 正在运行：npm run oauth
  2. 访问：http://localhost:8787/x/oauth1/auth
  3. 点击授权链接
  4. 授权后输入 PIN 码
  5. 完成授权

方法 2: 使用命令行工具
  运行以下命令完成授权：
  
  账户B:
  node -r ts-node/register scripts/completeOAuth1Auth.ts accountB <PIN码>
  
  账户C:
  node -r ts-node/register scripts/completeOAuth1Auth.ts accountC <PIN码>


═══════════════════════════════════════════════════════════
⚠️  重要提示
═══════════════════════════════════════════════════════════

1. OAuth 1.0a 不需要配置 Callback URL
2. 授权后会显示 PIN 码，必须保存并输入才能完成授权
3. Request Token 有效期为 5 分钟，请尽快完成授权
4. 每个账户需要单独授权
5. 账户A（当前自动化发推）的 Token 不受影响
6. OAuth 1.0a Token 是永久的，不会过期

═══════════════════════════════════════════════════════════
`;

  fs.writeFileSync(filePath, content, 'utf-8');
  
  console.log('\n✅ OAuth 1.0a 授权链接已生成并保存到桌面');
  console.log(`📄 文件路径: ${filePath}`);
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('📱 账户B（英文推文）- OAuth 1.0a 授权链接');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`\n${oauth1UrlB}\n`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('📱 账户C（韩语推文）- OAuth 1.0a 授权链接');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`\n${oauth1UrlC}\n`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('\n💡 提示:');
  console.log('1. OAuth 1.0a 使用 "oob" 模式，不需要回调 URL');
  console.log('2. 授权后会显示 PIN 码，需要输入 PIN 码完成授权');
  console.log('3. 访问 http://localhost:8787/x/oauth1/auth 可以使用 Web 界面完成授权');
  console.log('4. Request Token 已保存，有效期为 5 分钟');
}

main().catch(error => {
  console.error('❌ 生成 OAuth 1.0a 授权链接失败:', error);
  process.exit(1);
});



