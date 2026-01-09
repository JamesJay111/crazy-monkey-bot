const fs = require('fs');
const path = require('path');
require('dotenv').config();

console.log('🔍 X OAuth 配置检查\n');

// 检查必填字段
const clientId = process.env.X_CLIENT_ID;
const redirectUri = process.env.X_REDIRECT_URI || 'http://localhost:8787/x/callback';
const clientSecret = process.env.X_CLIENT_SECRET;

console.log('📋 当前配置:');
console.log(`  X_CLIENT_ID: ${clientId ? '✅ 已设置' : '❌ 未设置'}`);
if (clientId) {
  console.log(`    值: ${clientId.substring(0, 10)}...${clientId.substring(clientId.length - 5)}`);
}
console.log(`  X_CLIENT_SECRET: ${clientSecret ? '✅ 已设置' : '⚠️  未设置（PKCE 可能不需要）'}`);
console.log(`  X_REDIRECT_URI: ${redirectUri}`);
console.log(`  X_SCOPES: ${process.env.X_SCOPES || 'tweet.write users.read offline.access'}`);
console.log(`  X_OAUTH_PORT: ${process.env.X_OAUTH_PORT || '8787'}`);

console.log('\n✅ 需要在 Twitter Developer Portal 中检查的设置:');
console.log('  1. Callback URI 必须设置为:');
console.log(`     ${redirectUri}`);
console.log('  2. App Type 必须设置为:');
console.log('     Web App, Automated App or Bot');
console.log('  3. App Permissions 必须设置为:');
console.log('     Read and write');
console.log('  4. OAuth 2.0 必须已启用');

console.log('\n🔗 访问 Portal:');
console.log('  https://developer.twitter.com/en/portal/dashboard');

if (!clientId) {
  console.log('\n❌ 错误: X_CLIENT_ID 未设置，请在 .env 文件中配置');
  process.exit(1);
}

console.log('\n✅ 配置检查完成');
