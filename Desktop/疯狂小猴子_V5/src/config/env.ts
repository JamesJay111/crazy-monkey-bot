import * as dotenv from 'dotenv';
import { z } from 'zod';

// 加载环境变量
dotenv.config();

/**
 * 环境变量配置 Schema
 */
const envSchema = z.object({
  // Telegram Bot
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  
  // DeepSeek
  DEEPSEEK_API_KEY: z.string().min(1),
  DEEPSEEK_API_URL: z.string().url().optional(),
  
  // CoinGlass API
  COINGLASS_API_KEY: z.string().min(1),
  COINGLASS_BASE_URL: z.string().url().default('https://open-api-v4.coinglass.com'),
  COINGLASS_TIMEOUT_MS: z.coerce.number().default(10000),
  COINGLASS_MAX_RETRIES: z.coerce.number().default(2),
  COINGLASS_CONCURRENCY: z.coerce.number().default(3),
  // CoinGlass 限流配置
  COINGLASS_RPS: z.coerce.number().default(2), // 每秒请求数限制
  COINGLASS_BURST: z.coerce.number().default(2), // 突发请求容量
  COINGLASS_MAX_RETRY: z.coerce.number().default(5), // 最大重试次数（用于 429/5xx）
  COINGLASS_MAX_BACKOFF_MS: z.coerce.number().default(30000), // 最大退避时间（毫秒）
  COINGLASS_STALE_TTL_MS: z.coerce.number().default(1800000), // Stale 缓存 TTL（30分钟）
  
  // Database
  DB_PATH: z.string().default('./db/bot.db'),
  
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  
  // X (Twitter) OAuth (可选)
  X_CLIENT_ID: z.string().optional(),
  X_CLIENT_SECRET: z.string().optional(),
  X_REDIRECT_URI: z.string().url().optional(),
  X_SCOPES: z.string().optional(),
  X_OAUTH_PORT: z.coerce.number().optional(),
  X_TOKEN_STORE: z.string().optional(),
  
  // Twitter 自动推送配置
  PREFLIGHT_MODE: z.coerce.boolean().default(false),
  DATA_RETRY_MAX: z.coerce.number().default(3),
  DATA_RETRY_BACKOFF_MS: z.coerce.number().default(10000),
  // 轮询配置
  POLL_INTERVAL_MS: z.coerce.number().default(300000), // 5 分钟
  // 资金费率阈值（decimal，-0.05% = -0.0005）
  FUNDING_THRESHOLD_DECIMAL: z.coerce.number().default(-0.0005),
  // 每日推文限额
  DAILY_TWEET_LIMIT: z.coerce.number().default(3),
  // OI 增长选币配置
  OI_GROWTH_CANDIDATE_TOPN: z.coerce.number().default(200), // Top N 候选数量
  
  // Twitter 转发配置
  ENABLE_FORWARDING: z.coerce.boolean().default(false),
  FORWARD_FROM_ACCOUNT_A_HANDLE: z.string().optional(), // 账户A的用户名（不含@）
  FORWARD_TO_ACCOUNT_B_KEY: z.string().default('accountB'),
  FORWARD_TO_ACCOUNT_C_KEY: z.string().default('accountC'),
  FORWARD_POLL_INTERVAL_MS: z.coerce.number().default(120000), // 2 分钟
  
  // Binance OI 异动推送配置
  OI_ALERT_POLL_INTERVAL_MS: z.coerce.number().default(600000), // 10 分钟
  OI_ALERT_THRESHOLD_PERCENT: z.coerce.number().default(10), // 10%
  OI_ALERT_COOLDOWN_MS: z.coerce.number().default(3600000), // 60 分钟
  LARK_WEBHOOK_OI_ALERT: z.string().url().optional(), // OI 异动专用 Webhook URL
  LARK_WEBHOOK_URL: z.string().url().optional(), // 通用 Lark Webhook URL（fallback）
  LARK_WEBHOOK_UNIFIED: z.string().url().optional(), // 统一推送 Webhook URL（ETF、宏观事件、OI 异动）
  
  // OI Alert Orchestrator 配置
  USE_NEW_OI_ALERT_ORCHESTRATOR: z.coerce.boolean().default(false), // 是否使用新的模块化架构
  OI_ALERT_DRY_RUN: z.coerce.boolean().default(false), // dry-run 模式，不真实发送
  OI_ALERT_COOLDOWN_WINDOW_MS: z.coerce.number().default(7200000), // 事件去重窗口（默认 2 小时）
  OI_ALERT_SCAN_TOP_N: z.coerce.number().default(200), // 扫描 Top N 个币种
  OI_ALERT_SCAN_GROUPS: z.string().optional(), // 扫描组，逗号分隔：major,meme,topOI
  OI_ALERT_USE_DYNAMIC_LIST: z.coerce.boolean().default(true), // 是否使用动态列表
  OI_ALERT_CONCURRENCY: z.coerce.number().default(5), // 扫描并发数
  
  // Twitter OAuth 1.0a 配置（用于 OI Alert Twitter 推送）
  TW_A_API_KEY: z.string().optional(),
  TW_A_API_SECRET: z.string().optional(),
  TW_A_ACCESS_TOKEN: z.string().optional(),
  TW_A_ACCESS_TOKEN_SECRET: z.string().optional(),
  TW_B_API_KEY: z.string().optional(),
  TW_B_API_SECRET: z.string().optional(),
  TW_B_ACCESS_TOKEN: z.string().optional(),
  TW_B_ACCESS_TOKEN_SECRET: z.string().optional(),
  TW_C_API_KEY: z.string().optional(),
  TW_C_API_SECRET: z.string().optional(),
  TW_C_ACCESS_TOKEN: z.string().optional(),
  TW_C_ACCESS_TOKEN_SECRET: z.string().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

let env: EnvConfig;

try {
  env = envSchema.parse({
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
    DEEPSEEK_API_URL: process.env.DEEPSEEK_API_URL,
    COINGLASS_API_KEY: process.env.COINGLASS_API_KEY,
    COINGLASS_BASE_URL: process.env.COINGLASS_BASE_URL,
    COINGLASS_TIMEOUT_MS: process.env.COINGLASS_TIMEOUT_MS,
    COINGLASS_MAX_RETRIES: process.env.COINGLASS_MAX_RETRIES,
    COINGLASS_CONCURRENCY: process.env.COINGLASS_CONCURRENCY,
    COINGLASS_RPS: process.env.COINGLASS_RPS,
    COINGLASS_BURST: process.env.COINGLASS_BURST,
    COINGLASS_MAX_RETRY: process.env.COINGLASS_MAX_RETRY,
    COINGLASS_MAX_BACKOFF_MS: process.env.COINGLASS_MAX_BACKOFF_MS,
    COINGLASS_STALE_TTL_MS: process.env.COINGLASS_STALE_TTL_MS,
    DB_PATH: process.env.DB_PATH,
    NODE_ENV: process.env.NODE_ENV,
    LOG_LEVEL: process.env.LOG_LEVEL,
    PREFLIGHT_MODE: process.env.PREFLIGHT_MODE,
    DATA_RETRY_MAX: process.env.DATA_RETRY_MAX,
    DATA_RETRY_BACKOFF_MS: process.env.DATA_RETRY_BACKOFF_MS,
    POLL_INTERVAL_MS: process.env.POLL_INTERVAL_MS,
    FUNDING_THRESHOLD_DECIMAL: process.env.FUNDING_THRESHOLD_DECIMAL,
    DAILY_TWEET_LIMIT: process.env.DAILY_TWEET_LIMIT,
    OI_GROWTH_CANDIDATE_TOPN: process.env.OI_GROWTH_CANDIDATE_TOPN,
    ENABLE_FORWARDING: process.env.ENABLE_FORWARDING,
    FORWARD_FROM_ACCOUNT_A_HANDLE: process.env.FORWARD_FROM_ACCOUNT_A_HANDLE,
    FORWARD_TO_ACCOUNT_B_KEY: process.env.FORWARD_TO_ACCOUNT_B_KEY,
    FORWARD_TO_ACCOUNT_C_KEY: process.env.FORWARD_TO_ACCOUNT_C_KEY,
    FORWARD_POLL_INTERVAL_MS: process.env.FORWARD_POLL_INTERVAL_MS,
    OI_ALERT_POLL_INTERVAL_MS: process.env.OI_ALERT_POLL_INTERVAL_MS,
    OI_ALERT_THRESHOLD_PERCENT: process.env.OI_ALERT_THRESHOLD_PERCENT,
    OI_ALERT_COOLDOWN_MS: process.env.OI_ALERT_COOLDOWN_MS,
    LARK_WEBHOOK_OI_ALERT: process.env.LARK_WEBHOOK_OI_ALERT,
    LARK_WEBHOOK_URL: process.env.LARK_WEBHOOK_URL,
    LARK_WEBHOOK_UNIFIED: process.env.LARK_WEBHOOK_UNIFIED,
    USE_NEW_OI_ALERT_ORCHESTRATOR: process.env.USE_NEW_OI_ALERT_ORCHESTRATOR,
    OI_ALERT_DRY_RUN: process.env.OI_ALERT_DRY_RUN,
    OI_ALERT_COOLDOWN_WINDOW_MS: process.env.OI_ALERT_COOLDOWN_WINDOW_MS,
    OI_ALERT_SCAN_TOP_N: process.env.OI_ALERT_SCAN_TOP_N,
    OI_ALERT_SCAN_GROUPS: process.env.OI_ALERT_SCAN_GROUPS,
    OI_ALERT_USE_DYNAMIC_LIST: process.env.OI_ALERT_USE_DYNAMIC_LIST,
    OI_ALERT_CONCURRENCY: process.env.OI_ALERT_CONCURRENCY,
    TW_A_API_KEY: process.env.TW_A_API_KEY,
    TW_A_API_SECRET: process.env.TW_A_API_SECRET,
    TW_A_ACCESS_TOKEN: process.env.TW_A_ACCESS_TOKEN,
    TW_A_ACCESS_TOKEN_SECRET: process.env.TW_A_ACCESS_TOKEN_SECRET,
    TW_B_API_KEY: process.env.TW_B_API_KEY,
    TW_B_API_SECRET: process.env.TW_B_API_SECRET,
    TW_B_ACCESS_TOKEN: process.env.TW_B_ACCESS_TOKEN,
    TW_B_ACCESS_TOKEN_SECRET: process.env.TW_B_ACCESS_TOKEN_SECRET,
    TW_C_API_KEY: process.env.TW_C_API_KEY,
    TW_C_API_SECRET: process.env.TW_C_API_SECRET,
    TW_C_ACCESS_TOKEN: process.env.TW_C_ACCESS_TOKEN,
    TW_C_ACCESS_TOKEN_SECRET: process.env.TW_C_ACCESS_TOKEN_SECRET,
  });
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error('❌ 环境变量配置错误:');
    error.errors.forEach(err => {
      console.error(`  - ${err.path.join('.')}: ${err.message}`);
    });
    process.exit(1);
  }
  throw error;
}

export { env };

