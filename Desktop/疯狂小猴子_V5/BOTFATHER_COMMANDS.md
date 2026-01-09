# BotFather 命令配置指南

## 📋 一、BotFather 设置步骤

### 步骤 1：打开 BotFather
在 Telegram 中搜索并打开 `@BotFather`

### 步骤 2：选择你的 Bot
发送 `/mybots`，选择你的 Bot

### 步骤 3：设置命令菜单
选择 `Edit Bot` → `Edit Commands`

### 步骤 4：粘贴命令列表
将下面的命令列表**完整复制粘贴**到 BotFather：

```
start - 开始使用｜功能总览
squeeze - 庄家轧空 / 多空挤压分析
etf - ETF 资金流向
funding - 资金费率异常扫描
contract - 查询指定合约（Ticker）
pricing - 解锁全部功能（Telegram Stars）
redeem - 输入邀请码
balance - 查看剩余分析次数
help - 使用说明
support - 支付与问题支持
```

### 步骤 5：确认
BotFather 会回复确认信息，表示命令已设置成功。

---

## 📝 二、命令列表说明

### 核心功能（5个）
- `/start` - 开始使用｜功能总览
- `/squeeze` - 庄家轧空 / 多空挤压分析
- `/etf` - ETF 资金流向
- `/funding` - 资金费率异常扫描
- `/contract` - 查询指定合约（Ticker）

### 付费与解锁（3个）
- `/pricing` - 解锁全部功能（Telegram Stars）
- `/redeem` - 输入邀请码
- `/balance` - 查看剩余分析次数

### 帮助与支持（2个）
- `/help` - 使用说明
- `/support` - 支付与问题支持

---

## ⚠️ 注意事项

1. **命令格式**：每行一个命令，格式为 `command - description`
2. **描述长度**：每个描述不超过 32 个字符（Telegram 限制）
3. **命令数量**：最多 100 个命令（当前 10 个，完全满足）
4. **中文支持**：Telegram 完全支持中文命令描述

---

## ✅ 验证方法

设置完成后：
1. 在任意聊天中输入 `/`
2. 应该能看到完整的命令列表
3. 点击任意命令，应该能触发对应功能

---

## 🔄 更新命令

如果需要更新命令列表：
1. 修改 `src/commands/menu.commands.ts` 中的 `BOT_COMMANDS`
2. 重新部署 Bot（代码会自动调用 `setMyCommands`）
3. 或在 BotFather 中手动更新

**推荐**：代码自动注册更可靠，建议通过代码更新。
