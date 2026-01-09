#!/bin/bash

echo "🔍 Twitter OAuth 配置检查"
echo "================================"
echo ""

# 检查环境变量
echo "1️⃣  检查环境变量..."
if grep -q "X_REDIRECT_URI=http://localhost:8787/x/callback" .env; then
    echo "   ✅ X_REDIRECT_URI 配置正确"
else
    echo "   ❌ X_REDIRECT_URI 配置错误"
    echo "   当前值: $(grep X_REDIRECT_URI .env)"
    echo "   应该是: X_REDIRECT_URI=http://localhost:8787/x/callback"
fi

if grep -q "X_CLIENT_ID=" .env; then
    echo "   ✅ X_CLIENT_ID 已配置"
else
    echo "   ❌ X_CLIENT_ID 未配置"
fi

echo ""

# 检查 OAuth Server
echo "2️⃣  检查 OAuth Server..."
if lsof -ti:8787 > /dev/null 2>&1; then
    echo "   ✅ OAuth Server 正在运行（端口 8787）"
else
    echo "   ❌ OAuth Server 未运行"
    echo "   请运行: npm run oauth"
fi

echo ""

# 检查 Token 文件
echo "3️⃣  检查 Token 文件..."
if [ -f "./data/x_tokens.json" ]; then
    echo "   ✅ Token 文件存在"
    echo "   文件大小: $(ls -lh ./data/x_tokens.json | awk '{print $5}')"
else
    echo "   ⚠️  Token 文件不存在（这是正常的，如果还未授权）"
fi

echo ""
echo "================================"
echo "📋 下一步操作："
echo ""
echo "1. 访问 Twitter Developer Portal:"
echo "   https://developer.twitter.com/en/portal/dashboard"
echo ""
echo "2. 检查以下设置："
echo "   - Callback URI: http://localhost:8787/x/callback"
echo "   - App Type: Web App, Automated App or Bot"
echo "   - App Permissions: Read and write"
echo "   - OAuth 2.0: 已启用"
echo ""
echo "3. 保存设置后等待 5-10 分钟"
echo ""
echo "4. 使用授权链接进行授权"
echo ""
