import express from 'express';
import axios from 'axios';
import { xConfig } from '../config/x';
import {
  generatePKCE,
  generateState,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  saveTokenStore,
  readTokenStore,
  getValidAccessToken,
  formatTokenForLog,
  XTokenStore,
} from '../services/xOAuth.service';
import {
  getRequestToken,
  buildOAuth1AuthorizeUrl,
  exchangeOAuth1AccessToken,
  saveOAuth1TokenStore,
  readOAuth1TokenStore,
  hasValidOAuth1Token,
} from '../services/xOAuth1.service';
import { logger } from '../utils/logger';

/**
 * PKCE 临时存储（内存，5分钟过期）
 */
interface PKCETempStore {
  codeVerifier: string;
  createdAt: number;
}

const pkceStore = new Map<string, PKCETempStore>();
const PKCE_TTL_MS = 5 * 60 * 1000; // 5 分钟

/**
 * OAuth 1.0a Request Token 临时存储（内存，5分钟过期）
 */
interface OAuth1RequestTokenStore {
  oauthToken: string;
  oauthTokenSecret: string;
  createdAt: number;
}

const oauth1RequestTokenStore = new Map<string, OAuth1RequestTokenStore>();
const OAUTH1_TTL_MS = 5 * 60 * 1000; // 5 分钟

/**
 * 清理过期的 PKCE 记录
 */
function cleanupExpiredPKCE(): void {
  const now = Date.now();
  for (const [state, store] of pkceStore.entries()) {
    if (now - store.createdAt > PKCE_TTL_MS) {
      pkceStore.delete(state);
    }
  }
}

// 每 1 分钟清理一次过期记录
setInterval(cleanupExpiredPKCE, 60 * 1000);

/**
 * 创建 X OAuth HTTP Server
 */
export function createXOAuthServer(): express.Application {
  const app = express();
  
  // 解析 JSON 和 URL 编码
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  
  /**
   * GET /x/auth - 生成授权链接
   */
  app.get('/x/auth', (req, res) => {
    try {
      const state = generateState();
      const { codeVerifier, codeChallenge } = generatePKCE();
      const authorizeUrl = buildAuthorizeUrl(state, codeChallenge);
      
      // 保存到临时存储
      pkceStore.set(state, {
        codeVerifier,
        createdAt: Date.now(),
      });
      
      logger.info({ state, authorizeUrl }, 'Authorization URL generated');
      
      // 返回 HTML 页面
      res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>X OAuth 授权</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 800px;
      margin: 50px auto;
      padding: 20px;
      background: #f5f5f5;
    }
    .container {
      background: white;
      padding: 30px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    h1 { color: #1da1f2; }
    .url-box {
      background: #f8f9fa;
      padding: 15px;
      border-radius: 4px;
      word-break: break-all;
      margin: 20px 0;
      border: 1px solid #e1e8ed;
    }
    .button {
      display: inline-block;
      padding: 12px 24px;
      background: #1da1f2;
      color: white;
      text-decoration: none;
      border-radius: 4px;
      margin-top: 10px;
    }
    .button:hover {
      background: #1a91da;
    }
    .warning {
      background: #fff3cd;
      border: 1px solid #ffc107;
      padding: 15px;
      border-radius: 4px;
      margin-top: 20px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🐦 X (Twitter) OAuth 授权</h1>
    <p>请按以下步骤操作：</p>
    <ol>
      <li>确保你已登录 Twitter B 账号</li>
      <li>点击下方链接或复制 URL 到浏览器打开</li>
      <li>授权后会自动跳转回本地回调地址</li>
    </ol>
    
    <div class="url-box">
      <strong>授权链接：</strong><br>
      <a href="${authorizeUrl}" target="_blank">${authorizeUrl}</a>
    </div>
    
    <a href="${authorizeUrl}" class="button" target="_blank">🚀 打开授权页面</a>
    
    <div class="warning">
      <strong>⚠️ 注意：</strong>
      <ul>
        <li>此链接 5 分钟内有效</li>
        <li>请确保在登录 Twitter B 的浏览器中打开</li>
        <li>授权后 token 将保存到：<code>${xConfig.X_TOKEN_STORE}</code></li>
      </ul>
    </div>
  </div>
</body>
</html>
      `);
    } catch (error) {
      logger.error({ error }, 'Failed to generate authorization URL');
      res.status(500).json({ error: 'Failed to generate authorization URL' });
    }
  });
  
  /**
   * GET /x/callback - OAuth 回调处理
   */
  app.get('/x/callback', async (req, res) => {
    try {
      const { code, state, error } = req.query;
      
      if (error) {
        logger.error({ error }, 'OAuth authorization error');
        res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>授权失败</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 600px;
      margin: 50px auto;
      padding: 20px;
      background: #fee;
    }
    .container {
      background: white;
      padding: 30px;
      border-radius: 8px;
      border: 2px solid #f00;
    }
    h1 { color: #d00; }
  </style>
</head>
<body>
  <div class="container">
    <h1>❌ 授权失败</h1>
    <p>错误信息：${error}</p>
    <p><a href="/x/auth">重新尝试</a></p>
  </div>
</body>
</html>
        `);
        return;
      }
      
      if (!code || !state) {
        res.status(400).send('Missing code or state parameter');
        return;
      }
      
      // 验证 state
      const pkceData = pkceStore.get(state as string);
      if (!pkceData) {
        logger.warn({ state }, 'Invalid or expired state');
        res.status(400).send('Invalid or expired state. Please try again from /x/auth');
        return;
      }
      
      // 检查是否过期
      const age = Date.now() - pkceData.createdAt;
      if (age > PKCE_TTL_MS) {
        pkceStore.delete(state as string);
        logger.warn({ state, age }, 'PKCE state expired');
        res.status(400).send('Authorization expired. Please try again from /x/auth');
        return;
      }
      
      // 交换 token
      logger.info({ state }, 'Exchanging code for token');
      const tokenStore = await exchangeCodeForToken(code as string, pkceData.codeVerifier);
      
      // 保存 token
      saveTokenStore(tokenStore);
      
      // 清理临时存储
      pkceStore.delete(state as string);
      
      logger.info({
        tokenPreview: formatTokenForLog(tokenStore.access_token),
        hasRefreshToken: !!tokenStore.refresh_token,
        expiresAt: new Date(tokenStore.expiresAt).toISOString(),
      }, 'Token saved successfully');
      
      // 返回成功页面
      res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>授权成功</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 600px;
      margin: 50px auto;
      padding: 20px;
      background: #efe;
    }
    .container {
      background: white;
      padding: 30px;
      border-radius: 8px;
      border: 2px solid #0a0;
    }
    h1 { color: #0a0; }
    .button {
      display: inline-block;
      padding: 12px 24px;
      background: #1da1f2;
      color: white;
      text-decoration: none;
      border-radius: 4px;
      margin: 10px 5px;
    }
    .button:hover {
      background: #1a91da;
    }
    .info {
      background: #f8f9fa;
      padding: 15px;
      border-radius: 4px;
      margin: 20px 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>✅ 授权成功</h1>
    <p>Token 已保存到：<code>${xConfig.X_TOKEN_STORE}</code></p>
    
    <div class="info">
      <strong>下一步：</strong>
      <ul>
        <li><a href="/x/me" class="button">验证 Token</a> - 查看当前授权账号信息</li>
        <li><a href="/x/test-tweet" class="button">测试发推</a> - 发送一条测试推文（可选）</li>
      </ul>
    </div>
  </div>
</body>
</html>
      `);
    } catch (error: any) {
      logger.error({ error: error.response?.data || error.message }, 'Failed to handle callback');
      res.status(500).send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>错误</title>
</head>
<body>
  <h1>❌ 处理回调时出错</h1>
  <p>${error.message || 'Unknown error'}</p>
  <p><a href="/x/auth">重新尝试</a></p>
</body>
</html>
      `);
    }
  });
  
  /**
   * GET /x/me - 验证当前 token 并获取用户信息
   */
  app.get('/x/me', async (req, res) => {
    try {
      const accessToken = await getValidAccessToken();
      
      if (!accessToken) {
        res.status(401).json({ error: 'No valid access token. Please authorize first at /x/auth' });
        return;
      }
      
      const response = await axios.get('https://api.twitter.com/2/users/me', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
        params: {
          'user.fields': 'id,name,username,created_at',
        },
      });
      
      const user = response.data.data;
      
      logger.info({
        userId: user.id,
        username: user.username,
      }, 'User info retrieved');
      
      res.json({
        success: true,
        user: {
          id: user.id,
          name: user.name,
          username: user.username,
          createdAt: user.created_at,
        },
        tokenPreview: formatTokenForLog(accessToken),
      });
    } catch (error: any) {
      if (error.response?.status === 401) {
        logger.warn('Token expired, attempting refresh');
        // 尝试刷新 token
        const store = readTokenStore();
        if (store?.refresh_token) {
          try {
            const { refreshAccessToken } = await import('../services/xOAuth.service');
            const newStore = await refreshAccessToken(store.refresh_token);
            saveTokenStore(newStore);
            
            // 重试请求
            const retryResponse = await axios.get('https://api.twitter.com/2/users/me', {
              headers: {
                'Authorization': `Bearer ${newStore.access_token}`,
              },
              params: {
                'user.fields': 'id,name,username,created_at',
              },
            });
            
            const user = retryResponse.data.data;
            res.json({
              success: true,
              user: {
                id: user.id,
                name: user.name,
                username: user.username,
                createdAt: user.created_at,
              },
              tokenPreview: formatTokenForLog(newStore.access_token),
              note: 'Token was automatically refreshed',
            });
            return;
          } catch (refreshError) {
            logger.error({ error: refreshError }, 'Failed to refresh token');
          }
        }
      }
      
      logger.error({ error: error.response?.data || error.message }, 'Failed to get user info');
      res.status(error.response?.status || 500).json({
        error: 'Failed to get user info',
        details: error.response?.data || error.message,
      });
    }
  });
  
  /**
   * POST /x/test-tweet - 发送测试推文
   */
  app.post('/x/test-tweet', async (req, res) => {
    try {
      const accessToken = await getValidAccessToken();
      
      if (!accessToken) {
        res.status(401).json({ error: 'No valid access token. Please authorize first at /x/auth' });
        return;
      }
      
      const testText = 'CrazyMonkeyPerpBot OAuth connected';
      
      const response = await axios.post(
        'https://api.twitter.com/2/tweets',
        {
          text: testText,
        },
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );
      
      const tweet = response.data.data;
      
      logger.info({
        tweetId: tweet.id,
        text: testText,
      }, 'Test tweet sent');
      
      res.json({
        success: true,
        tweet: {
          id: tweet.id,
          text: testText,
        },
        url: `https://twitter.com/i/web/status/${tweet.id}`,
      });
    } catch (error: any) {
      if (error.response?.status === 401) {
        // 尝试刷新 token
        const store = readTokenStore();
        if (store?.refresh_token) {
          try {
            const { refreshAccessToken } = await import('../services/xOAuth.service');
            const newStore = await refreshAccessToken(store.refresh_token);
            saveTokenStore(newStore);
            
            // 重试请求
            const retryResponse = await axios.post(
              'https://api.twitter.com/2/tweets',
              {
                text: 'CrazyMonkeyPerpBot OAuth connected',
              },
              {
                headers: {
                  'Authorization': `Bearer ${newStore.access_token}`,
                  'Content-Type': 'application/json',
                },
              }
            );
            
            const tweet = retryResponse.data.data;
            res.json({
              success: true,
              tweet: {
                id: tweet.id,
                text: 'CrazyMonkeyPerpBot OAuth connected',
              },
              url: `https://twitter.com/i/web/status/${tweet.id}`,
              note: 'Token was automatically refreshed',
            });
            return;
          } catch (refreshError) {
            logger.error({ error: refreshError }, 'Failed to refresh token');
          }
        }
      }
      
      logger.error({ error: error.response?.data || error.message }, 'Failed to send test tweet');
      res.status(error.response?.status || 500).json({
        error: 'Failed to send test tweet',
        details: error.response?.data || error.message,
      });
    }
  });
  
  /**
   * GET /x/status - 查看 token 状态
   */
  app.get('/x/status', (req, res) => {
    const store = readTokenStore();
    const oauth1Store = readOAuth1TokenStore();
    
    res.json({
      oauth2: store ? {
        authorized: true,
        tokenPreview: formatTokenForLog(store.access_token),
        hasRefreshToken: !!store.refresh_token,
        expiresAt: new Date(store.expiresAt).toISOString(),
        isExpired: Date.now() >= store.expiresAt,
        scope: store.scope,
      } : {
        authorized: false,
        message: 'No OAuth 2.0 token found',
      },
      oauth1: oauth1Store ? {
        authorized: true,
        userId: oauth1Store.userId,
        screenName: oauth1Store.screenName,
        obtainedAt: new Date(oauth1Store.obtainedAt).toISOString(),
      } : {
        authorized: false,
        message: 'No OAuth 1.0a token found',
      },
    });
  });

  /**
   * GET /x/oauth1/auth - OAuth 1.0a 授权入口
   */
  app.get('/x/oauth1/auth', async (req, res) => {
    try {
      // 获取 Request Token
      const requestToken = await getRequestToken();
      
      // 保存到临时存储
      oauth1RequestTokenStore.set(requestToken.oauthToken, {
        oauthToken: requestToken.oauthToken,
        oauthTokenSecret: requestToken.oauthTokenSecret,
        createdAt: Date.now(),
      });
      
      // 生成授权 URL
      const authorizeUrl = buildOAuth1AuthorizeUrl(requestToken.oauthToken);
      
      logger.info({ 
        oauthToken: requestToken.oauthToken,
        authorizeUrl 
      }, 'OAuth 1.0a authorization URL generated');
      
      // 返回 HTML 页面（oob 模式说明）
      res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>X OAuth 1.0a 授权</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 800px;
      margin: 50px auto;
      padding: 20px;
      background: #f5f5f5;
    }
    .container {
      background: white;
      padding: 30px;
      border-radius: 8px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    }
    h1 { color: #1da1f2; }
    .url-box {
      background: #f8f9fa;
      padding: 15px;
      border-radius: 4px;
      word-break: break-all;
      margin: 20px 0;
      border: 1px solid #e1e8ed;
    }
    .button {
      display: inline-block;
      padding: 12px 24px;
      background: #1da1f2;
      color: white;
      text-decoration: none;
      border-radius: 4px;
      margin-top: 10px;
    }
    .button:hover {
      background: #1a91da;
    }
    .warning {
      background: #fff3cd;
      border: 1px solid #ffc107;
      padding: 15px;
      border-radius: 4px;
      margin-top: 20px;
    }
    .verifier-form {
      background: #e7f3ff;
      border: 2px solid #1da1f2;
      padding: 20px;
      border-radius: 4px;
      margin-top: 20px;
    }
    input[type="text"] {
      width: 100%;
      padding: 10px;
      border: 1px solid #ccc;
      border-radius: 4px;
      font-size: 14px;
      margin: 10px 0;
    }
    .submit-btn {
      background: #1da1f2;
      color: white;
      padding: 10px 20px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 14px;
    }
    .submit-btn:hover {
      background: #1a91da;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🐦 X (Twitter) OAuth 1.0a 授权</h1>
    <p>请按以下步骤操作：</p>
    <ol>
      <li>确保你已登录 Twitter B 账号</li>
      <li>点击下方链接或复制 URL 到浏览器打开</li>
      <li>授权后会显示一个 PIN 码（Verifier）</li>
      <li>将 PIN 码输入到下方表单中完成授权</li>
    </ol>
    
    <div class="url-box">
      <strong>授权链接：</strong><br>
      <a href="${authorizeUrl}" target="_blank">${authorizeUrl}</a>
    </div>
    
    <a href="${authorizeUrl}" class="button" target="_blank">🚀 打开授权页面</a>
    
    <div class="verifier-form">
      <h3>📝 输入授权 PIN 码</h3>
      <p>授权后，Twitter 会显示一个 PIN 码，请复制并粘贴到下方：</p>
      <form action="/x/oauth1/verify" method="POST">
        <input type="hidden" name="oauth_token" value="${requestToken.oauthToken}">
        <input type="text" name="oauth_verifier" placeholder="粘贴 PIN 码（Verifier）" required>
        <br>
        <button type="submit" class="submit-btn">✅ 完成授权</button>
      </form>
    </div>
    
    <div class="warning">
      <strong>⚠️ 注意：</strong>
      <ul>
        <li>此链接 5 分钟内有效</li>
        <li>请确保在登录 Twitter B 的浏览器中打开</li>
        <li>授权后 token 将保存到：<code>${xConfig.X_OAUTH1_TOKEN_STORE}</code></li>
      </ul>
    </div>
  </div>
</body>
</html>
      `);
    } catch (error) {
      logger.error({ error }, 'Failed to generate OAuth 1.0a authorization URL');
      res.status(500).json({ error: 'Failed to generate authorization URL' });
    }
  });

  /**
   * POST /x/oauth1/verify - OAuth 1.0a 手动验证（oob 模式）
   */
  app.post('/x/oauth1/verify', async (req, res) => {
    try {
      const { oauth_token, oauth_verifier } = req.body;
      
      if (!oauth_token || !oauth_verifier) {
        res.status(400).send('Missing oauth_token or oauth_verifier');
        return;
      }
      
      // 验证 Request Token
      const requestTokenData = oauth1RequestTokenStore.get(oauth_token as string);
      if (!requestTokenData) {
        logger.warn({ oauth_token }, 'Invalid or expired OAuth 1.0a request token');
        res.status(400).send('Invalid or expired request token. Please try again from /x/oauth1/auth');
        return;
      }
      
      // 检查是否过期
      const age = Date.now() - requestTokenData.createdAt;
      if (age > OAUTH1_TTL_MS) {
        oauth1RequestTokenStore.delete(oauth_token as string);
        logger.warn({ oauth_token, age }, 'OAuth 1.0a request token expired');
        res.status(400).send('Authorization expired. Please try again from /x/oauth1/auth');
        return;
      }
      
      // 交换 Access Token
      logger.info({ oauth_token }, 'Exchanging OAuth 1.0a access token');
      const tokenStore = await exchangeOAuth1AccessToken(
        requestTokenData.oauthToken,
        requestTokenData.oauthTokenSecret,
        oauth_verifier as string
      );
      
      // 保存 token
      saveOAuth1TokenStore(tokenStore);
      
      // 清理临时存储
      oauth1RequestTokenStore.delete(oauth_token as string);
      
      logger.info({
        userId: tokenStore.userId,
        screenName: tokenStore.screenName,
      }, 'OAuth 1.0a token saved successfully');
      
      // 返回成功页面
      res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>授权成功</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 600px;
      margin: 50px auto;
      padding: 20px;
      background: #efe;
    }
    .container {
      background: white;
      padding: 30px;
      border-radius: 8px;
      border: 2px solid #0a0;
    }
    h1 { color: #0a0; }
    .button {
      display: inline-block;
      padding: 12px 24px;
      background: #1da1f2;
      color: white;
      text-decoration: none;
      border-radius: 4px;
      margin: 10px 5px;
    }
    .button:hover {
      background: #1a91da;
    }
    .info {
      background: #f8f9fa;
      padding: 15px;
      border-radius: 4px;
      margin: 20px 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>✅ OAuth 1.0a 授权成功</h1>
    <p>Token 已保存到：<code>${xConfig.X_OAUTH1_TOKEN_STORE}</code></p>
    ${tokenStore.userId ? `<p>用户 ID: ${tokenStore.userId}</p>` : ''}
    ${tokenStore.screenName ? `<p>用户名: @${tokenStore.screenName}</p>` : ''}
    
    <div class="info">
      <strong>下一步：</strong>
      <ul>
        <li><a href="/x/status" class="button">查看状态</a> - 查看授权状态</li>
        <li><a href="/x/oauth1/test-tweet" class="button">测试发推</a> - 发送一条测试推文（可选）</li>
      </ul>
    </div>
  </div>
</body>
</html>
      `);
    } catch (error: any) {
      logger.error({ error: error.response?.data || error.message }, 'Failed to handle OAuth 1.0a verification');
      res.status(500).send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>错误</title>
</head>
<body>
  <h1>❌ 处理授权时出错</h1>
  <p>${error.message || 'Unknown error'}</p>
  <p><a href="/x/oauth1/auth">重新尝试</a></p>
</body>
</html>
      `);
    }
  });

  /**
   * GET /x/oauth1/callback - OAuth 1.0a 回调处理（保留用于未来支持 callback URL）
   */
  app.get('/x/oauth1/callback', async (req, res) => {
    try {
      const { oauth_token, oauth_verifier, denied } = req.query;
      
      if (denied) {
        logger.error({ denied }, 'OAuth 1.0a authorization denied');
        res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>授权被拒绝</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 600px;
      margin: 50px auto;
      padding: 20px;
      background: #fee;
    }
    .container {
      background: white;
      padding: 30px;
      border-radius: 8px;
      border: 2px solid #f00;
    }
    h1 { color: #d00; }
  </style>
</head>
<body>
  <div class="container">
    <h1>❌ 授权被拒绝</h1>
    <p>用户拒绝了授权请求</p>
    <p><a href="/x/oauth1/auth">重新尝试</a></p>
  </div>
</body>
</html>
        `);
        return;
      }
      
      if (!oauth_token || !oauth_verifier) {
        res.status(400).send('Missing oauth_token or oauth_verifier parameter');
        return;
      }
      
      // 验证 Request Token
      const requestTokenData = oauth1RequestTokenStore.get(oauth_token as string);
      if (!requestTokenData) {
        logger.warn({ oauth_token }, 'Invalid or expired OAuth 1.0a request token');
        res.status(400).send('Invalid or expired request token. Please try again from /x/oauth1/auth');
        return;
      }
      
      // 检查是否过期
      const age = Date.now() - requestTokenData.createdAt;
      if (age > OAUTH1_TTL_MS) {
        oauth1RequestTokenStore.delete(oauth_token as string);
        logger.warn({ oauth_token, age }, 'OAuth 1.0a request token expired');
        res.status(400).send('Authorization expired. Please try again from /x/oauth1/auth');
        return;
      }
      
      // 交换 Access Token
      logger.info({ oauth_token }, 'Exchanging OAuth 1.0a access token');
      const tokenStore = await exchangeOAuth1AccessToken(
        requestTokenData.oauthToken,
        requestTokenData.oauthTokenSecret,
        oauth_verifier as string
      );
      
      // 保存 token
      saveOAuth1TokenStore(tokenStore);
      
      // 清理临时存储
      oauth1RequestTokenStore.delete(oauth_token as string);
      
      logger.info({
        userId: tokenStore.userId,
        screenName: tokenStore.screenName,
      }, 'OAuth 1.0a token saved successfully');
      
      // 返回成功页面（oob 模式会直接显示 verifier，需要手动输入）
      res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>授权成功</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 600px;
      margin: 50px auto;
      padding: 20px;
      background: #efe;
    }
    .container {
      background: white;
      padding: 30px;
      border-radius: 8px;
      border: 2px solid #0a0;
    }
    h1 { color: #0a0; }
    .button {
      display: inline-block;
      padding: 12px 24px;
      background: #1da1f2;
      color: white;
      text-decoration: none;
      border-radius: 4px;
      margin: 10px 5px;
    }
    .button:hover {
      background: #1a91da;
    }
    .info {
      background: #f8f9fa;
      padding: 15px;
      border-radius: 4px;
      margin: 20px 0;
    }
    .verifier-box {
      background: #fff3cd;
      border: 2px solid #ffc107;
      padding: 15px;
      border-radius: 4px;
      margin: 20px 0;
      word-break: break-all;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>✅ OAuth 1.0a 授权成功</h1>
    <p>Token 已保存到：<code>${xConfig.X_OAUTH1_TOKEN_STORE}</code></p>
    ${tokenStore.userId ? `<p>用户 ID: ${tokenStore.userId}</p>` : ''}
    ${tokenStore.screenName ? `<p>用户名: @${tokenStore.screenName}</p>` : ''}
    
    <div class="info">
      <strong>下一步：</strong>
      <ul>
        <li><a href="/x/status" class="button">查看状态</a> - 查看授权状态</li>
        <li><a href="/x/oauth1/test-tweet" class="button">测试发推</a> - 发送一条测试推文（可选）</li>
      </ul>
    </div>
  </div>
</body>
</html>
      `);
    } catch (error: any) {
      logger.error({ error: error.response?.data || error.message }, 'Failed to handle OAuth 1.0a callback');
      res.status(500).send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>错误</title>
</head>
<body>
  <h1>❌ 处理回调时出错</h1>
  <p>${error.message || 'Unknown error'}</p>
  <p><a href="/x/oauth1/auth">重新尝试</a></p>
</body>
</html>
      `);
    }
  });

  /**
   * POST /x/oauth1/test-tweet - 使用 OAuth 1.0a 发送测试推文
   */
  app.post('/x/oauth1/test-tweet', async (req, res) => {
    try {
      if (!hasValidOAuth1Token()) {
        res.status(401).json({ error: 'No valid OAuth 1.0a token. Please authorize first at /x/oauth1/auth' });
        return;
      }

      const { XTweetOAuth1Service } = await import('../services/xTweetOAuth1.service');
      const tweetService = new XTweetOAuth1Service();
      
      const testText = `🧪 OAuth 1.0a 测试推文 - ${new Date().toLocaleString('zh-CN')}`;
      
      const result = await tweetService.sendTweet(testText);
      
      logger.info({
        tweetId: result.tweetId,
        text: testText,
      }, 'OAuth 1.0a test tweet sent');
      
      res.json({
        success: true,
        tweet: {
          id: result.tweetId,
          text: testText,
        },
        url: result.url,
      });
    } catch (error: any) {
      logger.error({ error: error.response?.data || error.message }, 'Failed to send OAuth 1.0a test tweet');
      res.status(error.response?.status || 500).json({
        error: 'Failed to send test tweet',
        details: error.response?.data || error.message,
      });
    }
  });
  
  return app;
}

/**
 * 启动 X OAuth Server
 */
export function startXOAuthServer(): void {
  const app = createXOAuthServer();
  const port = xConfig.X_OAUTH_PORT;
  
  app.listen(port, () => {
    logger.info({
      port,
      redirectUri: xConfig.X_REDIRECT_URI,
      tokenStore: xConfig.X_TOKEN_STORE,
    }, 'X OAuth server started');
    
    console.log(`\n✅ X OAuth Server 已启动`);
    console.log(`📍 访问 http://localhost:${port}/x/auth 开始授权\n`);
  });
}

