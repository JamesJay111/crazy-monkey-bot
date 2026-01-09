import * as dotenv from 'dotenv';
import { z } from 'zod';

// 加载环境变量
dotenv.config();

/**
 * X (Twitter) OAuth 配置 Schema
 */
const xEnvSchema = z.object({
  // OAuth 2.0 PKCE (保留，用于其他端点)
  X_CLIENT_ID: z.string().min(1, 'X_CLIENT_ID 是必填项'),
  X_CLIENT_SECRET: z.string().optional(), // PKCE 通常不需要，但预留
  X_REDIRECT_URI: z.string().url('X_REDIRECT_URI 必须是有效的 URL'),
  X_SCOPES: z.string().default('tweet.write users.read offline.access'),
  X_OAUTH_PORT: z.coerce.number().default(8787),
  X_TOKEN_STORE: z.string().default('./data/x_tokens.json'),
  
  // OAuth 1.0a (用于发推)
  X_CONSUMER_KEY: z.string().min(1, 'X_CONSUMER_KEY 是必填项'),
  X_CONSUMER_SECRET: z.string().min(1, 'X_CONSUMER_SECRET 是必填项'),
  X_OAUTH1_TOKEN_STORE: z.string().default('./data/x_oauth1_tokens.json'),
});

export type XOAuthConfig = z.infer<typeof xEnvSchema>;

let xConfig: XOAuthConfig;

try {
  xConfig = xEnvSchema.parse({
    X_CLIENT_ID: process.env.X_CLIENT_ID,
    X_CLIENT_SECRET: process.env.X_CLIENT_SECRET,
    X_REDIRECT_URI: process.env.X_REDIRECT_URI,
    X_SCOPES: process.env.X_SCOPES,
    X_OAUTH_PORT: process.env.X_OAUTH_PORT,
    X_TOKEN_STORE: process.env.X_TOKEN_STORE,
    X_CONSUMER_KEY: process.env.X_CONSUMER_KEY,
    X_CONSUMER_SECRET: process.env.X_CONSUMER_SECRET,
    X_OAUTH1_TOKEN_STORE: process.env.X_OAUTH1_TOKEN_STORE,
  });
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error('❌ X OAuth 环境变量配置错误:');
    error.errors.forEach(err => {
      console.error(`  - ${err.path.join('.')}: ${err.message}`);
    });
    process.exit(1);
  }
  throw error;
}

// 解析 scopes（按空格分割）
export const xScopes = xConfig.X_SCOPES.split(/\s+/).filter(s => s.length > 0);

export { xConfig };
