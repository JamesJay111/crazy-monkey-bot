# Slash Command Menu 实现完成 ✅

## 📋 一、BotFather 配置（手动设置）

### 步骤
1. 打开 Telegram，搜索 `@BotFather`
2. 发送 `/mybots`，选择你的 Bot
3. 点击 `Edit Bot` → `Edit Commands`
4. 复制粘贴以下内容：

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

5. 确认保存

---

## 💻 二、代码实现（自动注册）

### 文件结构

```
src/
├── commands/
│   └── menu.commands.ts          # 命令菜单配置和注册
├── routes/
│   ├── balance.ts                # /balance 命令处理
│   └── support.ts                # /support 命令处理
└── bot/
    └── index.ts                  # Bot 主入口（调用注册函数）
```

### 核心代码

#### 1. 命令菜单配置 (`src/commands/menu.commands.ts`)

```typescript
import { Bot } from 'grammy';
import { logger } from '../utils/logger';

export const BOT_COMMANDS = [
  // 核心功能
  { command: 'start', description: '开始使用｜功能总览' },
  { command: 'squeeze', description: '庄家轧空 / 多空挤压分析' },
  { command: 'etf', description: 'ETF 资金流向' },
  { command: 'funding', description: '资金费率异常扫描' },
  { command: 'contract', description: '查询指定合约（Ticker）' },

  // 付费与解锁
  { command: 'pricing', description: '解锁全部功能（Telegram Stars）' },
  { command: 'redeem', description: '输入邀请码' },
  { command: 'balance', description: '查看剩余分析次数' },

  // 帮助与支持
  { command: 'help', description: '使用说明' },
  { command: 'support', description: '支付与问题支持' },
] as const;

export async function registerBotCommands(bot: Bot): Promise<void> {
  try {
    await bot.api.setMyCommands(BOT_COMMANDS);
    logger.info({ commandCount: BOT_COMMANDS.length }, 'Bot commands registered successfully');
  } catch (error) {
    logger.error({ error }, 'Failed to register bot commands');
    throw error;
  }
}
```

#### 2. Bot 启动时注册 (`src/bot/index.ts`)

```typescript
import { registerBotCommands } from '../commands/menu.commands';

// 在注册路由之前注册命令菜单
registerBotCommands(bot).catch(error => {
  logger.error({ error }, 'Failed to register bot commands');
});
```

#### 3. 新增命令处理

**`/balance` 命令** (`src/routes/balance.ts`)
- 显示用户账户状态
- 显示解锁状态和剩余次数
- 提供解锁入口

**`/support` 命令** (`src/routes/support.ts`)
- 显示常见问题
- 提供联系方式
- 提供支付和邀请码入口

**命令别名**：
- `/pricing` = `/pay` （解锁功能）
- `/redeem` = `/code` （输入邀请码）

---

## ✅ 三、验收标准

### 测试步骤

1. **启动 Bot**
   ```bash
   npm start
   ```

2. **在 Telegram 中测试**
   - 打开与 Bot 的聊天窗口
   - 输入 `/`（斜杠）
   - 应该能看到完整的 10 个命令列表

3. **测试每个命令**
   - `/start` - 显示主菜单
   - `/squeeze` - 进入轧空分析
   - `/etf` - 进入 ETF 功能
   - `/funding` - 进入资金费率扫描
   - `/contract` - 进入合约查询
   - `/pricing` - 显示付费说明
   - `/redeem` - 输入邀请码
   - `/balance` - 查看账户状态
   - `/help` - 显示帮助信息
   - `/support` - 显示支持信息

---

## 📝 四、命令说明

### 核心功能（5个）
| 命令 | 描述 | 功能 |
|------|------|------|
| `/start` | 开始使用｜功能总览 | 显示欢迎信息和主菜单 |
| `/squeeze` | 庄家轧空 / 多空挤压分析 | 分析过去 30 天的轧空结构 |
| `/etf` | ETF 资金流向 | 查看 BTC/ETH/SOL ETF 资金流 |
| `/funding` | 资金费率异常扫描 | 扫描资金费率异常的项目 |
| `/contract` | 查询指定合约（Ticker） | 查询指定 Ticker 的合约状态 |

### 付费与解锁（3个）
| 命令 | 描述 | 功能 |
|------|------|------|
| `/pricing` | 解锁全部功能（Telegram Stars） | 显示付费说明和支付入口 |
| `/redeem` | 输入邀请码 | 输入邀请码解锁功能 |
| `/balance` | 查看剩余分析次数 | 查看账户状态和权限 |

### 帮助与支持（2个）
| 命令 | 描述 | 功能 |
|------|------|------|
| `/help` | 使用说明 | 显示使用说明和命令列表 |
| `/support` | 支付与问题支持 | 显示常见问题和联系方式 |

---

## 🎯 五、实现特点

### ✅ 已完成
1. **命令菜单自动注册** - Bot 启动时自动注册到 Telegram
2. **命令别名支持** - `/pricing` = `/pay`, `/redeem` = `/code`
3. **新增功能** - `/balance` 和 `/support` 命令
4. **中文描述** - 所有命令描述都是用户可读的中文
5. **代码与配置同步** - 代码自动注册，无需手动维护

### 📋 文件清单
- ✅ `src/commands/menu.commands.ts` - 命令菜单配置
- ✅ `src/routes/balance.ts` - 账户状态查询
- ✅ `src/routes/support.ts` - 支持与帮助
- ✅ `src/bot/index.ts` - Bot 启动时注册命令
- ✅ `BOTFATHER_COMMANDS.md` - BotFather 配置指南

---

## 🚀 六、部署说明

### 开发环境
命令会在 Bot 启动时自动注册，无需额外操作。

### 生产环境
1. **推荐方式**：代码自动注册（已实现）
2. **备选方式**：在 BotFather 中手动设置（见 `BOTFATHER_COMMANDS.md`）

### 更新命令
修改 `src/commands/menu.commands.ts` 中的 `BOT_COMMANDS` 数组，重启 Bot 即可。

---

## 📚 七、相关文档

- `BOTFATHER_COMMANDS.md` - BotFather 手动配置指南
- `src/commands/menu.commands.ts` - 命令菜单源代码

---

**实现完成！用户在输入 `/` 时就能看到完整的功能列表了！** 🎉

