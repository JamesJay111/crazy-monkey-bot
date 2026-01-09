#!/bin/bash

echo "🔧 Twitter App 权限修复助手"
echo "================================"
echo ""

# 1. 检查当前 token
if [ -f "./data/x_tokens.json" ]; then
    echo "📋 当前 Token Scope:"
    cat ./data/x_tokens.json | python3 -c "import sys, json; data = json.load(sys.stdin); print('  Scope:', data.get('scope', 'N/A'))" 2>/dev/null || echo "  无法读取"
    echo ""
    read -p "是否删除旧 token 并重新授权？(y/n): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        rm ./data/x_tokens.json
        echo "✅ 旧 token 已删除"
    else
        echo "❌ 已取消"
        exit 0
    fi
else
    echo "ℹ️  未找到旧 token，将直接进行新授权"
fi

# 2. 检查 OAuth Server
echo ""
echo "🔍 检查 OAuth Server..."
if lsof -ti:8787 > /dev/null 2>&1; then
    echo "✅ OAuth Server 正在运行 (端口 8787)"
else
    echo "⚠️  OAuth Server 未运行，正在启动..."
    npm run oauth > /dev/null 2>&1 &
    sleep 3
    if lsof -ti:8787 > /dev/null 2>&1; then
        echo "✅ OAuth Server 已启动"
    else
        echo "❌ OAuth Server 启动失败，请手动运行: npm run oauth"
        exit 1
    fi
fi

# 3. 生成授权链接
echo ""
echo "📝 生成新的授权链接..."
node -e "
const crypto = require('crypto');
require('dotenv').config();
function base64URLEncode(str) { return str.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, ''); }
function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest(); }
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
console.log(authorizeUrl.toString());
" > /tmp/twitter_auth_url.txt

AUTH_URL=$(cat /tmp/twitter_auth_url.txt)

# 4. 显示说明
echo ""
echo "================================"
echo "📋 下一步操作："
echo "================================"
echo ""
echo "1️⃣  首先，访问 Twitter Developer Portal："
echo "   https://developer.twitter.com/en/portal/dashboard"
echo ""
echo "2️⃣  检查并修改 App 权限："
echo "   - App permissions: 必须设置为 'Read and write'"
echo "   - App Type: 必须设置为 'Web App, Automated App or Bot'"
echo "   - OAuth 2.0: 必须已启用"
echo ""
echo "3️⃣  修改权限后，等待 1-2 分钟让设置生效"
echo ""
echo "4️⃣  然后，在浏览器中打开以下授权链接："
echo ""
echo "   $AUTH_URL"
echo ""
echo "   或者访问: http://localhost:8787/x/auth"
echo ""
echo "5️⃣  授权后，运行以下命令测试发推："
echo "   node -r ts-node/register scripts/manualTweet.ts"
echo ""
echo "================================"
echo ""

# 尝试在浏览器中打开
read -p "是否在浏览器中打开授权链接？(y/n): " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    if command -v open > /dev/null; then
        open "$AUTH_URL"
        echo "✅ 已在浏览器中打开授权链接"
    else
        echo "⚠️  无法自动打开浏览器，请手动复制上面的链接"
    fi
fi

echo ""
echo "💡 提示：授权时请确保已登录 Twitter B 账号"
echo "💡 授权页面应该显示 'Read and write' 权限"
