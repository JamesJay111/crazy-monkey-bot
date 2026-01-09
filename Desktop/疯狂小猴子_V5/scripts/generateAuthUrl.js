const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

/**
 * 生成 PKCE Code Verifier 和 Challenge
 */
function generatePKCE() {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  
  return { codeVerifier, codeChallenge };
}

/**
 * 生成随机 state
 */
function generateState() {
  return crypto.randomBytes(16).toString('base64url');
}

/**
 * 生成授权 URL
 */
function buildAuthorizeUrl(clientId, redirectUri, scopes, state, codeChallenge) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: scopes.join(' '),
    state: state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  
  return `https://twitter.com/i/oauth2/authorize?${params.toString()}`;
}

/**
 * 主函数
 */
function main() {
  const clientId = process.env.X_CLIENT_ID;
  const redirectUri = process.env.X_REDIRECT_URI || 'http://localhost:8787/x/callback';
  const scopes = (process.env.X_SCOPES || 'tweet.write users.read offline.access').split(/\s+/).filter(s => s.length > 0);
  
  if (!clientId) {
    console.error('❌ 错误: X_CLIENT_ID 未设置');
    process.exit(1);
  }
  
  // 生成 PKCE 和 state
  const { codeVerifier, codeChallenge } = generatePKCE();
  const state = generateState();
  
  // 生成授权 URL
  const authorizeUrl = buildAuthorizeUrl(clientId, redirectUri, scopes, state, codeChallenge);
  
  // 保存到桌面
  const desktopPath = path.join(process.env.HOME || '', 'Desktop');
  const filePath = path.join(desktopPath, 'X_OAuth_Authorize_URL.txt');
  
  const content = `X (Twitter) OAuth 授权链接
生成时间: ${new Date().toLocaleString('zh-CN')}

授权链接:
${authorizeUrl}

使用说明:
1. 确保你已登录 Twitter B 账号
2. 复制上面的授权链接到浏览器打开
3. 授权后会自动跳转到回调地址
4. Token 将保存到: ${process.env.X_TOKEN_STORE || './data/x_tokens.json'}

技术信息:
- State: ${state}
- Code Verifier: ${codeVerifier}
- Code Challenge: ${codeChallenge}
- Redirect URI: ${redirectUri}
- Scopes: ${scopes.join(', ')}
`;

  fs.writeFileSync(filePath, content, 'utf-8');
  
  console.log('✅ 授权链接已生成并保存到桌面');
  console.log(`📄 文件路径: ${filePath}`);
  console.log(`\n🔗 授权链接:\n${authorizeUrl}\n`);
  console.log('💡 提示: 请确保在已登录 Twitter B 的浏览器中打开此链接');
}

main();

