#!/bin/bash

# 合约行为感知 Bot 启动脚本

echo "🚀 启动合约行为感知 Bot..."

# 检查 .env 文件
if [ ! -f .env ]; then
    echo "❌ 未找到 .env 文件"
    echo "请复制 .env.example 并配置必要的环境变量"
    exit 1
fi

# 停止旧的 bot 进程
echo "🛑 停止旧的 Bot 进程..."
pkill -f "ts-node.*bot" || pkill -f "node.*index" || true

# 等待进程完全停止
sleep 2

# 检查 node_modules
if [ ! -d node_modules ]; then
    echo "📦 安装依赖..."
    npm install
fi

# 重新编译 better-sqlite3（修复 macOS 代码签名问题）
echo "🔧 重新编译 better-sqlite3..."
npm rebuild better-sqlite3 > /dev/null 2>&1 || true

# 启动 Bot（使用开发模式，直接运行 TypeScript）
echo "✅ 启动 Bot..."
node node_modules/ts-node/dist/bin.js src/bot/index.ts > bot.log 2>&1 &

# 等待启动
sleep 3

# 显示启动日志
echo "📋 Bot 启动日志："
tail -10 bot.log

echo ""
echo "✅ Bot 已在后台启动"
echo "📝 查看日志: tail -f bot.log"
echo "🛑 停止 Bot: pkill -f 'node.*index'"

