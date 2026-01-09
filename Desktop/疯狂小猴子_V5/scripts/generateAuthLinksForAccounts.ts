/**
 * 为账户B和账户C生成Twitter授权链接
 * 账户B：英文推文
 * 账户C：韩语推文
 */

import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import * as crypto from 'crypto';

// 加载环境变量
dotenv.config({ path: path.resolve(__dirname, '../.env') });

/**
 * 生成 PKCE
 */
function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  return { codeVerifier, codeChallenge };
}

/**
 * 生成 State
 */
function generateState(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * 生成授权 URL (OAuth 2.0)
 */
function buildAuthorizeUrl(
  clientId: string,
  redirectUri: string,
  scopes: string[],
  state: string,
  codeChallenge: string,
  accountLabel: string
): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes.join(' '),
    state: `${accountLabel}_${state}`, // 在 state 中包含账户标识
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  
  return `https://twitter.com/i/oauth2/authorize?${params.toString()}`;
}

/**
 * 生成 OAuth 1.0a 授权链接
 */
async function generateOAuth1AuthLink(accountLabel: string): Promise<{
  authorizeUrl: string;
  oauthToken: string;
  oauthTokenSecret: string;
}> {
  const { getRequestToken, buildOAuth1AuthorizeUrl } = await import('../src/services/xOAuth1.service');
  
  const requestToken = await getRequestToken();
  const authorizeUrl = buildOAuth1AuthorizeUrl(requestToken.oauthToken);
  
  // 保存 request token 以便后续交换
  const tokenStorePath = path.resolve(`./data/oauth1_request_tokens_${accountLabel}.json`);
  const tokenDir = path.dirname(tokenStorePath);
  if (!fs.existsSync(tokenDir)) {
    fs.mkdirSync(tokenDir, { recursive: true });
  }
  
  fs.writeFileSync(tokenStorePath, JSON.stringify({
    oauthToken: requestToken.oauthToken,
    oauthTokenSecret: requestToken.oauthTokenSecret,
    accountLabel,
    createdAt: Date.now(),
  }, null, 2), 'utf-8');
  
  return {
    authorizeUrl,
    oauthToken: requestToken.oauthToken,
    oauthTokenSecret: requestToken.oauthTokenSecret,
  };
}

/**
 * 主函数
 */
async function main() {
  console.log('🔗 生成 Twitter 授权链接（账户B和账户C）\n');

  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  const redirectUri = process.env.X_REDIRECT_URI || 'http://localhost:8787/x/callback';
  const scopes = (process.env.X_SCOPES || 'tweet.write users.read offline.access').split(/\s+/).filter(s => s.length > 0);
  
  if (!clientId) {
    console.error('❌ 错误: X_CLIENT_ID 未设置');
    process.exit(1);
  }

  // 账户B（英文）
  console.log('📝 生成账户B（英文）授权链接...');
  const { codeVerifier: verifierB, codeChallenge: challengeB } = generatePKCE();
  const stateB = generateState();
  const authorizeUrlB = buildAuthorizeUrl(clientId, redirectUri, scopes, stateB, challengeB, 'accountB');
  
  // 保存账户B的PKCE信息
  const pkceBPath = path.resolve('./data/pkce_accountB.json');
  const pkceBDir = path.dirname(pkceBPath);
  if (!fs.existsSync(pkceBDir)) {
    fs.mkdirSync(pkceBDir, { recursive: true });
  }
  fs.writeFileSync(pkceBPath, JSON.stringify({
    accountLabel: 'accountB',
    codeVerifier: verifierB,
    codeChallenge: challengeB,
    state: stateB,
    createdAt: Date.now(),
  }, null, 2), 'utf-8');

  // 账户C（韩语）
  console.log('📝 生成账户C（韩语）授权链接...');
  const { codeVerifier: verifierC, codeChallenge: challengeC } = generatePKCE();
  const stateC = generateState();
  const authorizeUrlC = buildAuthorizeUrl(clientId, redirectUri, scopes, stateC, challengeC, 'accountC');
  
  // 保存账户C的PKCE信息
  const pkceCPath = path.resolve('./data/pkce_accountC.json');
  const pkceCDir = path.dirname(pkceCPath);
  if (!fs.existsSync(pkceCDir)) {
    fs.mkdirSync(pkceCDir, { recursive: true });
  }
  fs.writeFileSync(pkceCPath, JSON.stringify({
    accountLabel: 'accountC',
    codeVerifier: verifierC,
    codeChallenge: challengeC,
    state: stateC,
    createdAt: Date.now(),
  }, null, 2), 'utf-8');

  // 同时生成 OAuth 1.0a 授权链接（备用）
  console.log('\n📝 生成 OAuth 1.0a 授权链接（备用）...');
  let oauth1UrlB = '';
  let oauth1UrlC = '';
  try {
    const oauth1B = await generateOAuth1AuthLink('accountB');
    oauth1UrlB = oauth1B.authorizeUrl;
    console.log('✅ 账户B OAuth 1.0a 链接已生成');
  } catch (error) {
    console.warn('⚠️  账户B OAuth 1.0a 链接生成失败:', (error as Error).message);
  }

  try {
    const oauth1C = await generateOAuth1AuthLink('accountC');
    oauth1UrlC = oauth1C.authorizeUrl;
    console.log('✅ 账户C OAuth 1.0a 链接已生成');
  } catch (error) {
    console.warn('⚠️  账户C OAuth 1.0a 链接生成失败:', (error as Error).message);
  }

  // 保存到桌面
  const desktopPath = path.join(process.env.HOME || '', 'Desktop');
  const filePath = path.join(desktopPath, 'Twitter_OAuth_授权链接_账户B和C.txt');
  
  const content = `Twitter OAuth 授权链接（账户B和账户C）
生成时间: ${new Date().toLocaleString('zh-CN')}

═══════════════════════════════════════════════════════════
📱 账户B（英文推文）- OAuth 2.0 授权链接
═══════════════════════════════════════════════════════════

授权链接:
${authorizeUrlB}

使用说明:
1. 确保你已登录 Twitter 账户B（英文账户）
2. 复制上面的授权链接到浏览器打开
3. 授权后会自动跳转到回调地址
4. Token 将保存到: ${process.env.X_TOKEN_STORE || './data/x_tokens.json'}

技术信息:
- State: ${stateB}
- Code Verifier: ${verifierB}
- Code Challenge: ${challengeB}
- Redirect URI: ${redirectUri}
- Scopes: ${scopes.join(', ')}
- PKCE 信息已保存到: ./data/pkce_accountB.json

${oauth1UrlB ? `\n备用 OAuth 1.0a 授权链接:\n${oauth1UrlB}\n` : ''}

═══════════════════════════════════════════════════════════
📱 账户C（韩语推文）- OAuth 2.0 授权链接
═══════════════════════════════════════════════════════════

授权链接:
${authorizeUrlC}

使用说明:
1. 确保你已登录 Twitter 账户C（韩语账户）
2. 复制上面的授权链接到浏览器打开
3. 授权后会自动跳转到回调地址
4. Token 将保存到: ${process.env.X_TOKEN_STORE || './data/x_tokens.json'}

技术信息:
- State: ${stateC}
- Code Verifier: ${verifierC}
- Code Challenge: ${challengeC}
- Redirect URI: ${redirectUri}
- Scopes: ${scopes.join(', ')}
- PKCE 信息已保存到: ./data/pkce_accountC.json

${oauth1UrlC ? `\n备用 OAuth 1.0a 授权链接:\n${oauth1UrlC}\n` : ''}

═══════════════════════════════════════════════════════════
💡 重要提示
═══════════════════════════════════════════════════════════

1. 请分别在不同的浏览器或隐私窗口中打开授权链接
2. 确保在打开链接前已登录对应的Twitter账户
3. 授权完成后，系统会自动保存Token
4. 账户B用于英文推文，账户C用于韩语推文
5. 当前账户A（自动化发推）的Token不受影响

═══════════════════════════════════════════════════════════
`;

  fs.writeFileSync(filePath, content, 'utf-8');
  
  console.log('\n✅ 授权链接已生成并保存到桌面');
  console.log(`📄 文件路径: ${filePath}`);
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('📱 账户B（英文推文）- OAuth 2.0 授权链接');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`\n${authorizeUrlB}\n`);
  if (oauth1UrlB) {
    console.log('备用 OAuth 1.0a 链接:');
    console.log(`${oauth1UrlB}\n`);
  }
  console.log('═══════════════════════════════════════════════════════════');
  console.log('📱 账户C（韩语推文）- OAuth 2.0 授权链接');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`\n${authorizeUrlC}\n`);
  if (oauth1UrlC) {
    console.log('备用 OAuth 1.0a 链接:');
    console.log(`${oauth1UrlC}\n`);
  }
  console.log('═══════════════════════════════════════════════════════════');
  console.log('\n💡 提示:');
  console.log('1. 请确保在已登录对应Twitter账户的浏览器中打开链接');
  console.log('2. 账户B用于英文推文，账户C用于韩语推文');
  console.log('3. 授权完成后，Token会自动保存');
}

main().catch(error => {
  console.error('❌ 生成授权链接失败:', error);
  process.exit(1);
});



