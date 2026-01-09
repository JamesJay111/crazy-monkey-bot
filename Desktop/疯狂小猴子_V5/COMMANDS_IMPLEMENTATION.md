# Telegram Bot Slash Command Menu 实现文档

## ✅ 实现完成

已为 Telegram Bot 正确配置 Slash Command Menu，用户输入 `/` 时可以看到完整、清晰的功能列表。

---

## 📋 一、BotFather 配置（手动设置）

### 设置步骤

1. **打开 BotFather**
   - 在 Telegram 中搜索 `@BotFather`
   - 发送 `/mybots`
   - 选择你的 Bot

2. **进入命令设置**
   - 选择 `Edit Bot` → `Edit Commands`

3. **粘贴命令列表**
   将以下内容**完整复制粘贴**到 BotFather：

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

4. **确认设置**
   - BotFather 会回复确认信息
   - 表示命令已设置成功

---

## 💻 二、代码实现（自动注册）

### 文件位置

**`src/commands/menu.commands.ts`**

### 核心代码

```typescript
import { Bot } from 'grammy';
import { logger } from '../utils/logger';

/**
 * Telegram Bot 命令菜单配置
 * 
 * 这些命令会在用户输入 / 时显示在命令菜单中
 */
export const BOT_COMMANDS = [
  // ========== 核心功能 ==========
  { command: 'start', description: '开始使用｜功能总览' },
  { command: 'squeeze', description: '庄家轧空 / 多空挤压分析' },
  { command: 'etf', description: 'ETF 资金流向' },
  { command: 'funding', description: '资金费率异常扫描' },
  { command: 'contract', description: '查询指定合约（Ticker）' },

  // ========== 付费与解锁 ==========
  { command: 'pricing', description: '解锁全部功能（Telegram Stars）' },
  { command: 'redeem', description: '输入邀请码' },
  { command: 'balance', description: '查看剩余分析次数' },

  // ========== 帮助与支持 ==========
  { command: 'help', description: '使用说明' },
  { command: 'support', description: '支付与问题支持' },
] as const;

/**
 * 注册命令菜单到 Telegram
 * 
 * 这会在 Bot 启动时自动注册命令，使用户在输入 / 时能看到完整菜单
 */
export async function registerBotCommands(bot: Bot): Promise<void> {
  try {
    // 注册命令菜单到默认作用域（私聊）
    await bot.api.setMyCommands(BOT_COMMANDS);
    
    logger.info({ 
      commandCount: BOT_COMMANDS.length,
      commands: BOT_COMMANDS.map(c => c.command).join(', ')
    }, 'Bot commands registered successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to register bot commands');
    // 不抛出错误，避免影响 Bot 启动
  }
}
```

### 在 Bot 启动时调用

**`src/bot/index.ts`** 中已包含：

```typescript
import { registerBotCommands } from '../commands/menu.commands';

// 创建 Bot
const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

// 注册命令菜单（必须在注册路由之前）
registerBotCommands(bot).catch(error => {
  logger.error({ error }, 'Failed to register bot commands');
});

// 注册路由
registerStartRoute(bot);
// ... 其他路由
```

---

## 📊 三、命令列表详情

### 核心功能（5个）

| 命令 | 描述 | 功能 |
|------|------|------|
| `/start` | 开始使用｜功能总览 | 显示欢迎信息和主菜单 |
| `/squeeze` | 庄家轧空 / 多空挤压分析 | 检测市场轧空结构 |
| `/etf` | ETF 资金流向 | 查看 BTC/ETH/SOL ETF 资金流 |
| `/funding` | 资金费率异常扫描 | 扫描异常资金费率项目 |
| `/contract` | 查询指定合约（Ticker） | 查询单个合约的详细状态 |

### 付费与解锁（3个）

| 命令 | 描述 | 功能 |
|------|------|------|
| `/pricing` | 解锁全部功能（Telegram Stars） | 显示付费说明和支付入口 |
| `/redeem` | 输入邀请码 | 输入邀请码解锁功能 |
| `/balance` | 查看剩余分析次数 | 查看用户剩余使用次数 |

### 帮助与支持（2个）

| 命令 | 描述 | 功能 |
|------|------|------|
| `/help` | 使用说明 | 显示帮助信息和命令列表 |
| `/support` | 支付与问题支持 | 显示支付和问题支持信息 |

---

## ✅ 四、验收标准

### 功能验证

1. ✅ **命令菜单显示**
   - 用户在任意聊天中输入 `/`
   - 能看到完整的 10 个命令列表
   - 命令按顺序显示（核心功能 → 付费解锁 → 帮助支持）

2. ✅ **命令功能**
   - 每个命令点击后，进入对应功能流程
   - 所有命令都有对应的处理函数

3. ✅ **命令描述**
   - 所有描述都是用户可读的中文
   - 描述简洁明了，不超过 32 字符

4. ✅ **自动注册**
   - Bot 启动时自动调用 `setMyCommands`
   - 无需手动在 BotFather 设置（但建议也设置，作为备份）

---

## 🔧 五、技术细节

### Telegram API

- **方法**：`bot.api.setMyCommands(commands)`
- **作用域**：默认作用域（私聊）
- **限制**：最多 100 个命令，每个描述最多 32 字符
- **更新**：每次调用会覆盖之前的命令列表

### 实现特点

1. **自动注册**：Bot 启动时自动注册，无需手动操作
2. **错误处理**：注册失败不影响 Bot 启动
3. **日志记录**：记录注册成功/失败信息
4. **类型安全**：使用 TypeScript `as const` 确保类型安全

---

## 📝 六、更新命令

### 方法 1：代码更新（推荐）

1. 修改 `src/commands/menu.commands.ts` 中的 `BOT_COMMANDS`
2. 重新编译：`npm run build`
3. 重启 Bot：`npm start`
4. 命令会自动更新

### 方法 2：BotFather 手动更新

1. 打开 `@BotFather`
2. 选择 `Edit Bot` → `Edit Commands`
3. 粘贴新的命令列表
4. 确认更新

**推荐使用方法 1**，因为代码会自动注册，更可靠。

---

## 🎯 七、最佳实践

1. **命令顺序**：按功能分组，核心功能在前
2. **描述简洁**：每个描述不超过 32 字符
3. **中文友好**：所有描述使用中文，符合产品定位
4. **避免暴露**：不暴露内部调试命令（如 `/cg_ping`）
5. **定期更新**：根据产品迭代更新命令列表

---

## 📚 相关文件

- **命令配置**：`src/commands/menu.commands.ts`
- **Bot 启动**：`src/bot/index.ts`
- **路由注册**：`src/routes/*.ts`
- **BotFather 配置**：`BOTFATHER_COMMANDS.md`

---

**实现完成时间**：2024  
**状态**：✅ 已实现并测试通过

