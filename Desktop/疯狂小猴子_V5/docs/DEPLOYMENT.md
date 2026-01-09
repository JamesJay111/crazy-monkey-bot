# 部署文档

本文档详细说明如何将系统部署到生产环境。

## 目录

1. [环境要求](#环境要求)
2. [环境变量配置](#环境变量配置)
3. [数据库初始化](#数据库初始化)
4. [服务启动](#服务启动)
5. [监控与日志](#监控与日志)
6. [故障排查](#故障排查)

## 环境要求

### 系统要求

- **Node.js**: 20.x 或更高版本
- **操作系统**: Linux / macOS / Windows
- **内存**: 至少 512MB（推荐 1GB+）
- **磁盘空间**: 至少 1GB（用于数据库和日志）

### 依赖安装

```bash
npm install
```

## 环境变量配置

### 必需的环境变量

创建 `.env` 文件：

```env
# Telegram Bot
TELEGRAM_BOT_TOKEN=your_telegram_bot_token_here

# CoinGlass API
COINGLASS_API_KEY=your_coinglass_api_key_here

# DeepSeek API
DEEPSEEK_API_KEY=your_deepseek_api_key_here

# 数据库路径
DB_PATH=./db/bot.db

# Twitter OAuth 1.0a 配置（多账户）
TWITTER_ACCOUNT_A_CONSUMER_KEY=your_consumer_key_a
TWITTER_ACCOUNT_A_CONSUMER_SECRET=your_consumer_secret_a
TWITTER_ACCOUNT_A_ACCESS_TOKEN=your_access_token_a
TWITTER_ACCOUNT_A_ACCESS_TOKEN_SECRET=your_access_token_secret_a

TWITTER_ACCOUNT_B_CONSUMER_KEY=your_consumer_key_b
TWITTER_ACCOUNT_B_CONSUMER_SECRET=your_consumer_secret_b
TWITTER_ACCOUNT_B_ACCESS_TOKEN=your_access_token_b
TWITTER_ACCOUNT_B_ACCESS_TOKEN_SECRET=your_access_token_secret_b

TWITTER_ACCOUNT_C_CONSUMER_KEY=your_consumer_key_c
TWITTER_ACCOUNT_C_CONSUMER_SECRET=your_consumer_secret_c
TWITTER_ACCOUNT_C_ACCESS_TOKEN=your_access_token_c
TWITTER_ACCOUNT_C_ACCESS_TOKEN_SECRET=your_access_token_secret_c

# Lark Webhook URLs
LARK_WEBHOOK_URL=your_lark_webhook_url_here
LARK_WEBHOOK_UNIFIED=your_unified_webhook_url_here
LARK_WEBHOOK_MACRO_NEWS=https://open.larksuite.com/open-apis/bot/v2/hook/65eb21dc-9053-4e91-9a8b-9945a049c051
```

### 可选的环境变量

```env
# 日志级别
LOG_LEVEL=info  # debug | info | warn | error

# 预发布模式（只记录日志，不实际推送）
PREFLIGHT_MODE=false

# 时区
TZ=Asia/Shanghai
```

## 数据库初始化

数据库会在首次启动时自动创建。如果需要手动初始化：

```bash
# 编译 TypeScript
npm run build

# 运行初始化脚本
node dist/src/db/init.js
```

## 服务启动

### 开发模式

```bash
npm run dev
```

### 生产模式

```bash
# 编译
npm run build

# 启动
npm start
```

### 使用 PM2（推荐）

```bash
# 安装 PM2
npm install -g pm2

# 启动服务
pm2 start dist/src/bot/index.js --name macro-news-bot

# 保存配置
pm2 save

# 设置开机自启
pm2 startup
```

### 使用 Docker

创建 `Dockerfile`:

```dockerfile
FROM node:20-alpine

WORKDIR /app

# 复制依赖文件
COPY package*.json ./

# 安装依赖
RUN npm ci --only=production

# 复制编译后的代码
COPY dist ./dist

# 复制数据库初始化文件
COPY db ./db

# 设置环境变量
ENV NODE_ENV=production

# 启动服务
CMD ["node", "dist/src/bot/index.js"]
```

构建和运行：

```bash
# 构建镜像
docker build -t macro-news-bot .

# 运行容器
docker run -d \
  --name macro-news-bot \
  --env-file .env \
  -v $(pwd)/db:/app/db \
  -v $(pwd)/logs:/app/logs \
  macro-news-bot
```

## 监控与日志

### 日志位置

- **应用日志**: `logs/app.log`
- **错误日志**: `logs/error.log`
- **PM2 日志**: `~/.pm2/logs/`

### 日志查看

```bash
# 实时查看日志
tail -f logs/app.log

# 查看错误日志
tail -f logs/error.log

# PM2 日志
pm2 logs macro-news-bot
```

### 服务状态检查

```bash
# 检查服务是否运行
pm2 status

# 查看服务详细信息
pm2 describe macro-news-bot

# 查看服务资源使用
pm2 monit
```

### 健康检查

服务启动后，检查以下内容：

1. **数据库连接**: 检查 `db/bot.db` 文件是否存在
2. **API 连接**: 检查日志中是否有 API 调用错误
3. **定时任务**: 检查日志中是否有定时任务启动信息

## 故障排查

### 问题 1: 服务无法启动

**症状**: 服务启动后立即退出

**排查步骤**:
1. 检查环境变量是否配置完整
2. 检查数据库文件权限
3. 查看错误日志

```bash
# 查看详细错误
node dist/src/bot/index.js

# 或使用 PM2
pm2 logs macro-news-bot --err
```

### 问题 2: API 调用失败

**症状**: 日志中出现 API 调用错误

**排查步骤**:
1. 检查 API Key 是否正确
2. 检查网络连接
3. 检查 API 配额是否用完

```bash
# 查看 API 调用日志
grep "API request failed" logs/app.log
```

### 问题 3: 定时任务不执行

**症状**: 定时推送没有触发

**排查步骤**:
1. 检查系统时区设置
2. 检查 cron 表达式是否正确
3. 查看定时任务日志

```bash
# 查看定时任务日志
grep "cron" logs/app.log
```

### 问题 4: Twitter 推送失败

**症状**: Twitter 推送返回错误

**排查步骤**:
1. 检查 OAuth 1.0a 配置是否正确
2. 检查 Twitter API 配额
3. 检查推文内容是否符合 Twitter 规则

```bash
# 查看 Twitter 推送日志
grep "Failed to send tweet" logs/app.log
```

### 问题 5: Webhook 推送失败

**症状**: Webhook 没有收到消息

**排查步骤**:
1. 检查 Webhook URL 是否正确
2. 检查网络连接
3. 查看 Webhook 推送日志

```bash
# 查看 Webhook 推送日志
grep "webhook" logs/app.log
```

## 性能优化

### 1. 数据库优化

```sql
-- 创建索引
CREATE INDEX IF NOT EXISTS idx_macro_news_publish_time 
ON macro_news_webhook_push_log(publish_time_ms);

CREATE INDEX IF NOT EXISTS idx_macro_news_id 
ON macro_news_webhook_push_log(news_id);
```

### 2. 缓存优化

CoinGlass API 客户端已实现缓存机制，默认缓存时间为 5 分钟。

### 3. 并发控制

避免同时发送过多请求，使用延迟机制：

```typescript
// 每条消息之间延迟 1 秒
await this.sleep(1000);
```

## 备份与恢复

### 数据库备份

```bash
# 备份数据库
cp db/bot.db db/bot.db.backup.$(date +%Y%m%d)

# 恢复数据库
cp db/bot.db.backup.20240106 db/bot.db
```

### 日志归档

```bash
# 归档旧日志
tar -czf logs/archive_$(date +%Y%m%d).tar.gz logs/*.log

# 清理旧日志（保留最近 7 天）
find logs -name "*.log" -mtime +7 -delete
```

## 安全建议

1. **保护环境变量**: 不要将 `.env` 文件提交到版本控制
2. **API Key 安全**: 定期轮换 API Key
3. **数据库权限**: 限制数据库文件的访问权限
4. **日志脱敏**: 确保日志中不包含敏感信息

## 更新部署

### 更新步骤

1. **备份数据**:
```bash
cp db/bot.db db/bot.db.backup.$(date +%Y%m%d)
```

2. **拉取最新代码**:
```bash
git pull origin main
```

3. **安装依赖**:
```bash
npm install
```

4. **编译代码**:
```bash
npm run build
```

5. **重启服务**:
```bash
pm2 restart macro-news-bot
```

### 回滚步骤

如果更新后出现问题，可以快速回滚：

```bash
# 恢复数据库
cp db/bot.db.backup.20240106 db/bot.db

# 回滚代码
git checkout <previous-commit-hash>

# 重新编译和启动
npm run build
pm2 restart macro-news-bot
```
