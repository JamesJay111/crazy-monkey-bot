#!/bin/bash

# X OAuth Server 启动脚本（简化版，直接使用 npx）

echo "🚀 启动 X OAuth Server..."
echo ""

cd "$(dirname "$0")"

# 检查 .env 文件
if [ ! -f .env ]; then
    echo "❌ 未找到 .env 文件"
    exit 1
fi

# 检查端口是否被占用
if lsof -ti:8787 > /dev/null 2>&1; then
    echo "⚠️  端口 8787 已被占用，正在停止旧进程..."
    lsof -ti:8787 | xargs kill -9 2>/dev/null
    sleep 2
fi

echo "✅ 正在启动 OAuth Server..."
echo ""
echo "📍 授权页面: http://localhost:8787/x/auth"
echo "📍 回调地址: http://localhost:8787/x/callback"
echo ""
echo "💡 提示:"
echo "   - 保持此终端窗口打开"
echo "   - 按 Ctrl+C 停止服务器"
echo ""

# 直接使用 npx 运行（避免权限问题）
npx ts-node src/server/index.ts

