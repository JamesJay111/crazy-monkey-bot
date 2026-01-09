# API Key 配置指南

## 🔐 安全提示

**⚠️ 重要：不要在对话中直接输入 API Key！**

请按照以下步骤在本地配置文件中安全地设置 API Key。

## 📝 配置步骤

### 1. 创建 .env 文件

在项目根目录创建 `.env` 文件：

```bash
cp .env.template .env
```

或者直接创建 `.env` 文件，复制 `.env.template` 的内容。

### 2. 获取并配置 API Key

#### 🔵 Telegram Bot Token

1. 在 Telegram 搜索 `@BotFather`
2. 发送 `/newbot` 命令
3. 按提示设置 Bot 名称（例如：`合约行为感知 Bot`）
4. 设置 Bot 用户名（必须以 `bot` 结尾，例如：`contract_behavior_bot`）
5. 获取 Token（格式类似：`123456789:ABCdefGHIjklMNOpqrsTUVwxyz`）
6. 将 Token 填入 `.env` 文件的 `TELEGRAM_BOT_TOKEN`

#### 🟢 DeepSeek API Key

1. 访问 [DeepSeek 官网](https://www.deepseek.com/)
2. 注册/登录账号
3. 进入 API 管理页面
4. 创建新的 API Key
5. 将 API Key 填入 `.env` 文件的 `DEEPSEEK_API_KEY`

**注意**：确保账户有足够余额用于 API 调用。

#### 🟡 CoinGlass API Key

1. 访问 [CoinGlass 官网](https://www.coinglass.com/)
2. 注册/登录账号
3. 进入 API 管理页面
4. 申请 API Key（可能需要审核）
5. 参考文档：https://docs.coinglass.com/v4.0-zh/reference/fr-ohlc-histroy
6. 将 API Key 填入 `.env` 文件的 `COINGLASS_API_KEY`

**注意**：
- 确认 API Key 有访问所需端点的权限
- 注意 API 调用频率限制

### 3. 验证配置

配置完成后，`.env` 文件应该类似这样：

```env
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxx
COINGLASS_API_KEY=your_coinglass_key_here
DEEPSEEK_API_URL=https://api.deepseek.com/v1/chat/completions
COINGLASS_API_URL=https://open-api.coinglass.com/public/v2
PAYMENT_STARS_AMOUNT=2999
INVITE_CODE=Ocean001
```

### 4. 测试配置

启动 Bot 测试配置是否正确：

```bash
npm install
npm run build
npm start
```

如果配置正确，Bot 会正常启动。如果缺少任何必要的 API Key，启动时会显示错误信息。

## 🔒 安全建议

1. **永远不要**将 `.env` 文件提交到 Git
   - `.env` 已在 `.gitignore` 中，不会被提交

2. **不要**在对话、聊天、邮件中分享 API Key

3. **定期轮换** API Key，特别是发现泄露时

4. **限制权限**：如果可能，为 API Key 设置最小必要权限

5. **监控使用**：定期检查 API 使用情况，发现异常及时处理

## ❓ 常见问题

### Q: 我没有 CoinGlass API Key 怎么办？

A: 
1. 访问 CoinGlass 官网注册账号
2. 申请 API Key（可能需要等待审核）
3. 或者先使用其他数据源进行测试（需要修改代码）

### Q: DeepSeek API 调用失败？

A: 
1. 检查 API Key 是否正确
2. 确认账户余额是否充足
3. 检查网络连接
4. 查看 DeepSeek API 文档确认端点 URL 是否正确

### Q: Telegram Bot 无法启动？

A: 
1. 检查 Bot Token 格式是否正确
2. 确认 Token 没有过期或被撤销
3. 检查网络连接
4. 查看 Bot 日志错误信息

## 📞 需要帮助？

如果配置过程中遇到问题，可以：
1. 检查各 API 提供商的官方文档
2. 查看项目 README.md
3. 检查 Bot 启动时的错误日志

---

**配置完成后，就可以启动 Bot 开始使用了！** 🚀

