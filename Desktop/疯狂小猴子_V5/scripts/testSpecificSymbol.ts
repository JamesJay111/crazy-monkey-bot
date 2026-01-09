/**
 * 测试指定币种的 Twitter 发推
 * 用法: node -r ts-node/register scripts/testSpecificSymbol.ts ZEROBASE
 */

import * as path from 'path';
import * as dotenv from 'dotenv';

// 加载环境变量
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { CoinGlassClient } from '../src/clients/coinglass.client';
import { DeepSeekClient } from '../src/clients/deepseek.client';
import { ContractSnapshotService } from '../src/services/contractSnapshot.service';
import { TweetContentService, HistoricalData } from '../src/services/tweetContent.service';
import { XTweetService } from '../src/services/xTweet.service';
import { XTweetOAuth1Service } from '../src/services/xTweetOAuth1.service';
import { LiquidationService } from '../src/services/liquidation.service';
import { SnapshotValidator } from '../src/utils/snapshotValidator';
import { PreflightLogger } from '../src/utils/preflightLogger';
import { RetryUtil } from '../src/utils/retry';
import { CoinGlassGuard } from '../src/utils/coinglassGuard';
import { RawDebugLogger } from '../src/utils/rawDebugLogger';
import { env } from '../src/config/env';
import { logger } from '../src/utils/logger';
import { hasValidOAuth1Token } from '../src/services/xOAuth1.service';

async function testSpecificSymbol(symbol: string) {
  try {
    console.log(`🚀 正在测试币种: ${symbol}\n`);

    // 初始化服务
    const coinglassClient = new CoinGlassClient();
    const deepseek = new DeepSeekClient(
      env.DEEPSEEK_API_KEY,
      env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1/chat/completions'
    );
    const liquidationService = new LiquidationService(coinglassClient);
    const contractSnapshotService = new ContractSnapshotService(coinglassClient, liquidationService);
    const tweetContentService = new TweetContentService(deepseek, coinglassClient);
    const xTweetService = new XTweetService();
    const oauth1TweetService = new XTweetOAuth1Service();

    // 1. 获取合约快照（带重试）
    console.log('📊 获取合约快照数据...\n');
    const snapshot = await RetryUtil.retry(
      async () => {
        const snap = await contractSnapshotService.getContractSnapshot(symbol);
        
        // 尝试获取 8h 数据（简化版，直接调用）
        const pairSymbol = symbol.endsWith('USDT') ? symbol : `${symbol}USDT`;
        try {
          const [taker8h, top8h] = await Promise.all([
            coinglassClient.getTakerBuySellVolumeHistory({
              exchange: 'Binance',
              symbol: pairSymbol,
              interval: '8h',
              limit: 1,
            })
              .then((resp: any) => {
                try {
                  CoinGlassGuard.assertBusinessOk(resp, { endpoint: 'getTakerBuySellVolumeHistory', pairSymbol, interval: '8h' });
                  RawDebugLogger.log('getTakerBuySellVolumeHistory (8h)', { pairSymbol, interval: '8h' }, resp, { ok: true });
                  return resp;
                } catch (error) {
                  RawDebugLogger.log('getTakerBuySellVolumeHistory (8h)', { pairSymbol, interval: '8h' }, resp, { ok: false, reason: (error as Error).message });
                  throw error;
                }
              })
              .catch(() => null),
            
            coinglassClient.getTopLongShortPositionRatioHistory({
              exchange: 'Binance',
              symbol: pairSymbol,
              interval: '8h',
              limit: 1,
            })
              .then((resp: any) => {
                try {
                  CoinGlassGuard.assertBusinessOk(resp, { endpoint: 'getTopLongShortPositionRatioHistory', pairSymbol, interval: '8h' });
                  RawDebugLogger.log('getTopLongShortPositionRatioHistory (8h)', { pairSymbol, interval: '8h' }, resp, { ok: true });
                  return resp;
                } catch (error) {
                  RawDebugLogger.log('getTopLongShortPositionRatioHistory (8h)', { pairSymbol, interval: '8h' }, resp, { ok: false, reason: (error as Error).message });
                  throw error;
                }
              })
              .catch(() => null),
          ]);

          // 更新 8h 数据（简化版）
          if (taker8h && Array.isArray(taker8h) && taker8h.length > 0) {
            const latest = taker8h[0];
            const { parseNumberStrict } = require('../src/utils/number');
            const takerBuy = parseNumberStrict(latest.taker_buy_volume_usd);
            const takerSell = parseNumberStrict(latest.taker_sell_volume_usd);
            if (takerBuy !== undefined && takerBuy > 0) snap.takerBuyVolUsd = takerBuy;
            if (takerSell !== undefined && takerSell > 0) snap.takerSellVolUsd = takerSell;
          }

          if (top8h && Array.isArray(top8h) && top8h.length > 0) {
            const latest = top8h[0];
            const { parseNumberStrict } = require('../src/utils/number');
            const topLong = parseNumberStrict(latest.top_position_long_percent || latest.top_account_long_percent);
            const topShort = parseNumberStrict(latest.top_position_short_percent || latest.top_account_short_percent);
            const topRatio = parseNumberStrict(latest.top_position_long_short_ratio || latest.top_account_long_short_ratio);
            if (topLong !== undefined && topLong > 0) snap.topAccountLongPercent = topLong;
            if (topShort !== undefined && topShort > 0) snap.topAccountShortPercent = topShort;
            if (topRatio !== undefined && topRatio > 0) snap.topAccountLongShortRatio = topRatio;
          }
        } catch (error) {
          logger.warn({ error, symbol }, 'Failed to update 8h data');
        }
        
        return snap;
      },
      {
        maxAttempts: env.DATA_RETRY_MAX,
        backoffMs: env.DATA_RETRY_BACKOFF_MS,
        exponential: true,
      }
    );

    console.log('📋 快照数据：');
    console.log(`- Symbol: ${snapshot.symbol}`);
    console.log(`- OI: $${(snapshot.oiUsd / 1e6).toFixed(2)}M`);
    console.log(`- Funding Rate: ${snapshot.fundingRate !== null && snapshot.fundingRate !== undefined ? (snapshot.fundingRate * 100).toFixed(4) + '%' : 'N/A'} ${snapshot.fundingRateError ? '(Error: ' + snapshot.fundingRateError + ')' : ''}`);
    console.log(`- Taker Buy: $${(snapshot.takerBuyVolUsd / 1e3).toFixed(2)}K`);
    console.log(`- Taker Sell: $${(snapshot.takerSellVolUsd / 1e3).toFixed(2)}K`);
    console.log(`- Top Long: ${snapshot.topAccountLongPercent.toFixed(2)}%`);
    console.log(`- Top Short: ${snapshot.topAccountShortPercent.toFixed(2)}%`);
    console.log(`- Top Ratio: ${snapshot.topAccountLongShortRatio.toFixed(4)}\n`);

    // 2. 数据完整性校验
    console.log('🔍 数据完整性校验...\n');
    const validation = SnapshotValidator.validate(snapshot);
    
    if (!validation.isValid) {
      console.log('❌ 数据不完整，无法发送推文：');
      console.log(`- 缺失字段: ${validation.missingFields.length > 0 ? validation.missingFields.join(', ') : '无'}`);
      console.log(`- 无效字段: ${validation.invalidFields.length > 0 ? validation.invalidFields.join(', ') : '无'}\n`);
      
      if (env.PREFLIGHT_MODE) {
        const skipReason = `数据不完整: 缺失字段=[${validation.missingFields.join(', ')}], 无效字段=[${validation.invalidFields.join(', ')}]`;
        PreflightLogger.log(symbol, '8H', null, skipReason, {
          oiSource: '4h',
          takerSource: '4h',
          topSource: '4h',
          fundingSource: snapshot.fundingRateError ? 'error' : '4h',
        });
      }
      
      return;
    }

    console.log('✅ 数据完整性校验通过\n');

    // 3. 获取历史数据（用于深度分析）
    console.log('📈 获取历史数据...\n');
    let historicalData: HistoricalData | undefined;
    try {
      const pairSymbol = snapshot.pairSymbol || `${symbol}USDT`;
      const [fundingRateHistory, positionRatioHistory, takerHistory] = await Promise.all([
        coinglassClient.getFundingRateOhlcHistory({
          symbol: symbol.toUpperCase(),
          interval: '8h',
          limit: 6,
        })
          .then((resp: any) => {
            try {
              CoinGlassGuard.assertBusinessOk(resp, { endpoint: 'getFundingRateOhlcHistory', symbol, interval: '8h' });
              return resp;
            } catch (error) {
              throw error;
            }
          })
          .catch(() => []),
        
        coinglassClient.getTopLongShortPositionRatioHistory({
          exchange: 'Binance',
          symbol: pairSymbol,
          interval: '8h',
          limit: 2,
        })
          .then((resp: any) => {
            try {
              CoinGlassGuard.assertBusinessOk(resp, { endpoint: 'getTopLongShortPositionRatioHistory', pairSymbol, interval: '8h' });
              return resp;
            } catch (error) {
              throw error;
            }
          })
          .catch(() => []),
        
        coinglassClient.getTakerBuySellVolumeHistory({
          exchange: 'Binance',
          symbol: pairSymbol,
          interval: '8h',
          limit: 1,
        })
          .then((resp: any) => {
            try {
              CoinGlassGuard.assertBusinessOk(resp, { endpoint: 'getTakerBuySellVolumeHistory', pairSymbol, interval: '8h' });
              return resp;
            } catch (error) {
              throw error;
            }
          })
          .catch(() => []),
      ]);

      historicalData = {
        fundingRateHistory: fundingRateHistory || [],
        positionRatioHistory: positionRatioHistory || [],
        takerHistory: takerHistory || [],
      };
      
      console.log(`- 资金费率历史: ${historicalData.fundingRateHistory.length} 条`);
      console.log(`- 持仓比历史: ${historicalData.positionRatioHistory.length} 条`);
      console.log(`- Taker 历史: ${historicalData.takerHistory.length} 条\n`);
    } catch (error) {
      logger.warn({ error, symbol }, 'Failed to fetch historical data, will use base data only');
    }

    // 4. 生成推文内容
    console.log('✍️  生成推文内容...\n');
    const tweetContent = await tweetContentService.generateTweet(snapshot, historicalData);
    console.log('📝 推文内容：');
    console.log('─'.repeat(50));
    console.log(tweetContent);
    console.log('─'.repeat(50));
    console.log(`\n字符数: ${tweetContent.length}\n`);

    // 5. 预发布模式：只写日志（支持命令行参数覆盖）
    const forcePreflight = process.argv.includes('--preflight');
    // 优先使用命令行环境变量，然后是 .env 文件
    const preflightEnv = process.env.PREFLIGHT_MODE || (env.PREFLIGHT_MODE ? 'true' : 'false');
    const preflightMode = forcePreflight || preflightEnv === 'true';
    
    console.log(`📋 当前模式: ${preflightMode ? '预发布模式（只写日志）' : '正常模式（实际发推）'}\n`);
    
    if (preflightMode) {
      PreflightLogger.log(symbol, '8H', tweetContent, undefined, {
        oiSource: '4h',
        takerSource: '4h',
        topSource: '4h',
        fundingSource: snapshot.fundingRateError ? 'error' : '4h',
      });
      console.log('✅ 预发布模式：推文已记录到日志，未实际发送\n');
      return;
    }

    // 6. 发送推文
    console.log('🐦 发送推文到 Twitter...\n');
    let result: { tweetId: string; url: string } | null = null;

    try {
      if (hasValidOAuth1Token()) {
        console.log('使用 OAuth 1.0a 发送...\n');
        result = await oauth1TweetService.sendTweet(tweetContent);
      } else {
        console.log('使用 OAuth 2.0 发送...\n');
        result = await xTweetService.sendTweet(tweetContent);
      }

      console.log('✅ 推文发送成功！');
      console.log(`- Tweet ID: ${result.tweetId}`);
      console.log(`- URL: ${result.url}\n`);
    } catch (error) {
      console.error('❌ 推文发送失败:', error);
      logger.error({ error, symbol }, 'Failed to send tweet');
      throw error;
    }

  } catch (error) {
    console.error('❌ 测试失败:', error);
    logger.error({ error, symbol }, 'Test failed');
    process.exit(1);
  }
}

// 获取命令行参数
const symbol = process.argv[2]?.toUpperCase() || 'ZEROBASE';
testSpecificSymbol(symbol);

