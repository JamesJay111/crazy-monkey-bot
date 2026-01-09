# 快速开始指南

## 5 分钟快速部署

### 步骤 1: 安装依赖

```bash
npm install
```

### 步骤 2: 配置环境变量

创建 `.env` 文件（参考 `.env.example`）：

```env
TELEGRAM_BOT_TOKEN=你的Telegram_Bot_Token
DEEPSEEK_API_KEY=你的DeepSeek_API_Key
COINGLASS_API_KEY=你的CoinGlass_API_Key
```

### 步骤 3: 编译并启动

```bash
npm run build
npm start
```

或使用启动脚本：

```bash
./start.sh
```

## 获取 API Key

### Telegram Bot Token

1. 在 Telegram 搜索 `@BotFather`
2. 发送 `/newbot` 创建新 Bot
3. 按提示设置 Bot 名称和用户名
4. 获取 Bot Token

### DeepSeek API Key

1. 访问 DeepSeek 官网
2. 注册账号并获取 API Key
3. 确保账户有足够余额

### CoinGlass API Key

1. 访问 CoinGlass 官网
2. 注册账号并申请 API Key
3. 参考文档：https://docs.coinglass.com/v4.0-zh/reference/fr-ohlc-histroy

## 测试 Bot

1. 在 Telegram 中找到你的 Bot
2. 发送 `/start` 命令
3. 测试各个功能模块

## 常见问题

### Q: Bot 无法启动？

A: 检查：
- `.env` 文件是否存在且配置正确
- 所有 API Key 是否有效
- Node.js 版本是否 >= 16

### Q: API 调用失败？

A: 检查：
- CoinGlass API Key 是否有效
- 网络连接是否正常
- API 调用频率是否超限

### Q: 付费功能无法使用？

A: 检查：
- Telegram Stars 支付是否已配置
- Bot 是否已设置为可接收支付

## 下一步

- 阅读 `README.md` 了解完整功能
- 查看 `API_EXAMPLES.md` 了解 API 使用
- 根据实际需求调整代码逻辑

