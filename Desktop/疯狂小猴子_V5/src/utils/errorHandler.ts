import { InlineKeyboard } from 'grammy';
import { HttpError } from './http';
import { logger } from './logger';

/**
 * 错误类型
 */
export enum ErrorType {
  RATE_LIMIT = 'rate_limit',      // API 限流 / 429
  BUG_OR_EXCEPTION = 'bug',       // Bug / 数据源异常 / 网络错误
}

/**
 * 错误提示结果
 */
export interface ErrorPrompt {
  message: string;
  keyboard: InlineKeyboard;
}

/**
 * 判断错误类型
 */
export function classifyError(error: any): ErrorType {
  // 检查 HTTP 状态码
  if (error instanceof HttpError) {
    if (error.statusCode === 429) {
      return ErrorType.RATE_LIMIT;
    }
    // 5xx 服务器错误
    if (error.statusCode >= 500 && error.statusCode < 600) {
      return ErrorType.BUG_OR_EXCEPTION;
    }
  }

  // 检查错误消息
  const errorMsg = error instanceof Error ? error.message : String(error);
  const lowerMsg = errorMsg.toLowerCase();

  // Rate Limit 关键词
  if (
    lowerMsg.includes('429') ||
    lowerMsg.includes('rate limit') ||
    lowerMsg.includes('too many requests') ||
    lowerMsg.includes('请求频率超限') ||
    lowerMsg.includes('请求过于频繁') ||
    lowerMsg.includes('exceeded')
  ) {
    return ErrorType.RATE_LIMIT;
  }

  // 网络错误（0 状态码通常是网络问题）
  if (error instanceof HttpError && error.statusCode === 0) {
    return ErrorType.BUG_OR_EXCEPTION;
  }

  // 默认视为 Bug/异常
  return ErrorType.BUG_OR_EXCEPTION;
}

/**
 * 生成 Rate Limit 错误提示（情况 A）
 */
function createRateLimitPrompt(context?: {
  retryAction?: string;
  alternativeAction?: string;
  alternativeLabel?: string;
}): ErrorPrompt {
  const message = `😅 数据有点挤不进来了…\n\n` +
    `我们刚刚请求得有点太勤快，触发了数据源的限流。\n` +
    `系统没坏，只是需要喘口气。\n\n` +
    `👉 你可以稍后再试\n` +
    `☕ 或者支持创作者升级更好的 API 服务包：\n\n` +
    `钱包地址：\n` +
    `0x0ad77a6cb6f382822c8dce9732c41b5c5c6b6ae7\n\n` +
    `（一杯咖啡的钱，就能让小猴子跑得更快 🐒）`;

  const keyboard = new InlineKeyboard();
  
  if (context?.retryAction) {
    keyboard.text('🔄 稍后再试', context.retryAction);
  } else {
    keyboard.text('🔄 稍后再试', 'main_menu');
  }

  if (context?.alternativeAction && context?.alternativeLabel) {
    keyboard.text(context.alternativeLabel, context.alternativeAction);
  }

  keyboard.row().text('🔙 返回主菜单', 'main_menu');

  return { message, keyboard };
}

/**
 * 生成 Bug/异常错误提示（情况 B）
 */
function createBugPrompt(context?: {
  retryAction?: string;
  backAction?: string;
}): ErrorPrompt {
  const message = `😵 哎呀，数据暂时拿不到了\n\n` +
    `这不是你的问题，可能是数据源开小差了。\n` +
    `我们已经通知开发者去处理，请稍后再试。`;

  const keyboard = new InlineKeyboard();
  
  if (context?.retryAction) {
    keyboard.text('🔄 稍后重试', context.retryAction);
  }

  if (context?.backAction) {
    keyboard.text('🔙 返回', context.backAction);
  } else {
    keyboard.text('🔙 返回主菜单', 'main_menu');
  }

  return { message, keyboard };
}

/**
 * 统一错误处理入口
 * 
 * @param error - 错误对象
 * @param context - 上下文信息（用于生成按钮）
 * @returns 错误提示（消息 + 键盘）
 */
export function handleDataError(
  error: any,
  context?: {
    // Rate Limit 相关
    retryAction?: string;
    alternativeAction?: string;
    alternativeLabel?: string;
    // Bug 相关
    backAction?: string;
  }
): ErrorPrompt {
  const errorType = classifyError(error);
  
  // 记录错误（用于开发者排查）
  logger.error({ 
    error, 
    errorType,
    errorMessage: error instanceof Error ? error.message : String(error),
    statusCode: error instanceof HttpError ? error.statusCode : undefined,
  }, 'Data error handled');

  if (errorType === ErrorType.RATE_LIMIT) {
    return createRateLimitPrompt({
      retryAction: context?.retryAction,
      alternativeAction: context?.alternativeAction,
      alternativeLabel: context?.alternativeLabel,
    });
  } else {
    return createBugPrompt({
      retryAction: context?.retryAction,
      backAction: context?.backAction,
    });
  }
}

/**
 * 检查错误是否为 Rate Limit
 */
export function isRateLimitError(error: any): boolean {
  return classifyError(error) === ErrorType.RATE_LIMIT;
}

/**
 * 检查错误是否为 Bug/异常
 */
export function isBugError(error: any): boolean {
  return classifyError(error) === ErrorType.BUG_OR_EXCEPTION;
}

