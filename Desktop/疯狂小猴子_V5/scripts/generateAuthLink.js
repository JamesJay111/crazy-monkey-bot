const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

function base64URLEncode(str) {
  return str.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest();
}

const codeVerifier = base64URLEncode(crypto.randomBytes(32));
const codeChallenge = base64URLEncode(sha256(Buffer.from(codeVerifier)));
const state = base64URLEncode(crypto.randomBytes(16));

const CLIENT_ID = process.env.X_CLIENT_ID;
const REDIRECT_URI = process.env.X_REDIRECT_URI || 'http://localhost:8787/x/callback';
const SCOPES = process.env.X_SCOPES || 'tweet.write users.read offline.access';

const authorizeUrl = new URL('https://twitter.com/i/oauth2/authorize');
authorizeUrl.searchParams.append('response_type', 'code');
authorizeUrl.searchParams.append('client_id', CLIENT_ID);
authorizeUrl.searchParams.append('redirect_uri', REDIRECT_URI);
authorizeUrl.searchParams.append('scope', SCOPES);
authorizeUrl.searchParams.append('state', state);
authorizeUrl.searchParams.append('code_challenge', codeChallenge);
authorizeUrl.searchParams.append('code_challenge_method', 'S256');

const desktopPath = path.join(os.homedir(), 'Desktop');
const filePath = path.join(desktopPath, 'Twitter_Auth_Link_Ready.txt');

const content = `🔧 Twitter App 权限修复 - 授权链接已准备就绪
生成时间: ${new Date().toLocaleString()}

📋 修复步骤：
==============================

1️⃣  首先，访问 Twitter Developer Portal：
   https://developer.twitter.com/en/portal/dashboard

2️⃣  找到你的 App（Client ID: ${CLIENT_ID.substring(0, 20)}...）

3️⃣  进入 "User authentication settings" 或 "App permissions"

4️⃣  修改权限设置：
   - App permissions: 从 "Read only" 改为 "Read and write"
   - App Type: 确保是 "Web App, Automated App or Bot"
   - OAuth 2.0: 确保已启用

5️⃣  保存设置，等待 1-2 分钟让设置生效

6️⃣  然后，在浏览器中打开以下授权链接：

${authorizeUrl.toString()}

   或者直接访问: http://localhost:8787/x/auth

7️⃣  授权时检查：
   - 授权页面应该显示 "Read and write" 权限
   - 如果显示 "Read only"，等待几分钟后重试

8️⃣  授权成功后，运行测试：
   node -r ts-node/register scripts/manualTweet.ts

==============================
📝 技术信息:
- State: ${state}
- Code Verifier: ${codeVerifier}
- Code Challenge: ${codeChallenge}
- Redirect URI: ${REDIRECT_URI}
- Scopes: ${SCOPES.split(' ').join(', ')}

⚠️  重要提示:
- 修改权限后必须重新授权（旧 token 已删除）
- 授权链接有时效性，请尽快使用
- 确保 OAuth Server 在授权过程中保持运行
`;

fs.writeFileSync(filePath, content);

console.log('✅ 授权链接已生成并保存到桌面');
console.log(`📄 文件路径: ${filePath}`);
console.log(`\n🔗 授权链接:\n${authorizeUrl.toString()}\n`);

