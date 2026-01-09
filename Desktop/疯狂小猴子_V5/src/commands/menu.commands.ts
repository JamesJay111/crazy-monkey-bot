import { Bot } from 'grammy';
import { logger } from '../utils/logger';

/**
 * Telegram Bot 命令菜单配置
 * 
 * 这些命令会在用户输入 / 时显示在命令菜单中
 * 
 * 注意：
 * - 命令描述必须是用户可读的中文
 * - 命令名称简短、语义明确
 * - 不要暴露内部状态管理命令
 * - 命令菜单 = 产品导航，而不是调试入口
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
 * 
 * Telegram API 说明：
 * - setMyCommands 会将命令注册到默认作用域（私聊）
 * - 用户在任何聊天中输入 / 都能看到这些命令
 * - 命令会按照数组顺序显示
 */
export async function registerBotCommands(bot: Bot): Promise<void> {
  try {
    // 注册命令菜单到默认作用域（私聊）
    await bot.api.setMyCommands(BOT_COMMANDS);
    
    logger.info({ 
      commandCount: BOT_COMMANDS.length,
      commands: BOT_COMMANDS.map(c => c.command).join(', ')
    }, 'Bot commands registered successfully');

    // 可选：也可以注册到其他作用域
    // 例如：群组、频道等
    // await bot.api.setMyCommands(BOT_COMMANDS, { 
    //   scope: { type: 'all_group_chats' } 
    // });
  } catch (error) {
    logger.error({ error }, 'Failed to register bot commands');
    // 不抛出错误，避免影响 Bot 启动
    // 命令注册失败不影响 Bot 功能，只是菜单不显示
  }
}

/**
 * 获取命令列表（用于帮助信息等）
 */
export function getCommandList(): string {
  const coreCommands = BOT_COMMANDS.slice(0, 5);
  const paymentCommands = BOT_COMMANDS.slice(5, 8);
  const helpCommands = BOT_COMMANDS.slice(8);

  let message = '📖 命令列表\n\n';
  
  message += '🔹 核心功能：\n';
  coreCommands.forEach(cmd => {
    message += `/${cmd.command} - ${cmd.description}\n`;
  });

  message += '\n🔹 付费与解锁：\n';
  paymentCommands.forEach(cmd => {
    message += `/${cmd.command} - ${cmd.description}\n`;
  });

  message += '\n🔹 帮助与支持：\n';
  helpCommands.forEach(cmd => {
    message += `/${cmd.command} - ${cmd.description}\n`;
  });

  return message;
}

