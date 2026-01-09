// 用户相关类型
export interface User {
  id: number;
  username?: string;
  isUnlocked: boolean;
  unlockMethod?: 'stars' | 'invite';
  unlockTime?: number;
  createdAt: number;
  updatedAt: number;
}

// CoinGlass API 类型
export interface CoinGlassOHLC {
  time: number; // 毫秒时间戳
  open: string;
  high: string;
  low: string;
  close: string;
}

export interface CoinGlassOIExchange {
  exchange: string;
  open_interest_usd: string;
  open_interest_change_percent_24h: string;
}

export interface CoinGlassFundingRate {
  exchange: string;
  funding_rate: string;
  funding_rate_interval: number;
  next_funding_time: number;
  stablecoin_margin_list?: CoinGlassFundingRate[];
  token_margin_list?: CoinGlassFundingRate[];
}

export interface CoinGlassLongShortRatio {
  time: number;
  global_account_long_percent: string;
  global_account_short_percent: string;
  global_account_long_short_ratio: string;
}

export interface CoinGlassETFFlow {
  timestamp: number;
  flow_usd: string;
  price_usd: string;
  etf_flows: Array<{
    etf_ticker: string;
    flow_usd?: string; // 某些 ETF 可能没有 flow_usd 字段
  }>;
}

export interface CoinGlassSupportedPair {
  instrument_id: string;
  base_asset: string;
  quote_asset: string;
}

// 业务类型
export interface SqueezeCandidate {
  symbol: string;
  score: number;
  reasons: string[];
}

export interface ContractStatus {
  symbol: string;
  openInterest: string;
  openInterestChange24h: string;
  fundingRate: string;
  longShortRatio: string;
  isBinanceFutures: boolean;
}

// ========== 合约查询相关类型 ==========

/**
 * 币种合约市场数据（Coins Markets）
 * GET /api/futures/coins-markets
 */
export interface CoinGlassCoinsMarket {
  symbol: string;
  open_interest_usd?: string | number;
  open_interest_quantity?: string | number; // 可能只有数量，没有 USD
  funding_rate?: string | number; // 可能缺失
  long_volume_usd?: string | number;
  short_volume_usd?: string | number;
  open_interest_change_percent_24h?: string | number;
  long_short_ratio?: string | number;
}

/**
 * 交易对爆仓历史项
 * GET /api/futures/liquidation/history
 */
export interface CoinGlassLiquidationHistoryItem {
  time: number; // 毫秒时间戳
  long_liquidation_usd: string | number;
  short_liquidation_usd: string | number;
}

/**
 * 合约快照（免费阶段）
 */
export interface ContractSnapshot {
  symbol: string;
  pairSymbol: string; // 如 BTCUSDT
  exchange: string; // 默认 Binance
  
  // 核心状态
  oiUsd: number; // OI 持仓总量（USD）
  fundingRate: number; // 当前资金费率
  nextFundingTime: number; // 下次资金费率结算时间（ms）
  fundingRateError?: string | null; // Funding Rate 错误提示（如果无主流交易对）
  
  // 删除：longIncreaseUsd24h, shortIncreaseUsd24h（不再使用估算字段）
  
  // 新增：大户账户多空比（交易对维度）
  topAccountLongPercent: number; // 大户多军百分比
  topAccountShortPercent: number; // 大户空军百分比
  topAccountLongShortRatio: number; // 大户多空比
  
  // 新增：币种主动买卖比（币种维度）
  takerBuyRatio: number; // 主动买入比例
  takerSellRatio: number; // 主动卖出比例
  takerBuyVolUsd: number; // 主动买入量（USD）
  takerSellVolUsd: number; // 主动卖出量（USD）
  exchangeTakerData: Array<{
    exchange: string;
    buyRatio: number;
    sellRatio: number;
  }>; // 各交易所的主动买卖比
  
  // 爆仓清算（近24h）
  liquidation24h: {
    longUsd24h: number; // 多单爆仓总额（USD）
    shortUsd24h: number; // 空单爆仓总额（USD）
    netLongMinusShortUsd24h: number; // 净爆仓（多-空）
  } | null; // null 表示数据不可用
  
  // 元数据
  isBinanceFutures: boolean;
  dataSource: 'CoinGlass';
}

/**
 * 合约分析结果（DeepSeek）
 */
export interface ContractAnalysis {
  ticker: string;
  structure: 'neutral' | 'long_crowded' | 'short_crowded' | 'squeeze_risk';
  confidence: number; // 0-100
  keyFindings: string[];
  interpretation: string; // 不超过120字
  whatToWatch: string[];
  disclaimer: string;
}

// ========== 资金费率相关类型 ==========

/**
 * 币种资金费率（交易所列表）
 * GET /api/futures/fundingRate/exchange-list
 */
export interface CoinGlassFundingRateExchangeItem {
  symbol: string;
  exchange: string;
  funding_rate: string | number; // 可能是 string 或 number
  funding_rate_interval: number;
  next_funding_time: number;
  instrument_id?: string;
}

/**
 * 累计资金费率（交易所列表）
 * GET /api/futures/fundingRate/accumulated-exchange-list
 */
export interface CoinGlassAccumulatedFundingRate {
  symbol: string;
  exchange: string;
  accumulated_funding_rate: string | number;
  funding_rate_interval: number;
  next_funding_time: number;
}

/**
 * 成交量加权资金费率历史（OHLC）
 * GET /api/futures/fundingRate/vol-weight-ohlc-history
 */
export interface CoinGlassVolWeightFundingRateOHLC {
  time: number; // 毫秒时间戳
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string; // 成交量（如果有）
}

/**
 * 基差历史
 * GET /api/futures/basis/history
 */
export interface CoinGlassBasis {
  time: number; // 毫秒时间戳
  basis: string; // 基差（合约价格 - 现货价格）
  basis_percent?: string; // 基差百分比
}

/**
 * Taker Buy/Sell Volume（交易所列表）
 * GET /api/futures/taker-buy-sell-volume/exchange-list
 */
export interface CoinGlassTakerBuySellVolume {
  symbol: string;
  exchange: string;
  taker_buy_volume: string;
  taker_sell_volume: string;
  taker_buy_ratio?: string; // buy / (buy + sell)
}

// ========== 轧空分析相关类型 ==========

/**
 * 轧空特征数据
 */
export interface SqueezeFeatures {
  symbol: string;
  
  // OI 特征
  oi_min: number;
  oi_max: number;
  oi_last: number;
  oi_drawdown_pct: number; // (last - max) / max
  oi_rebound_from_min_pct: number; // (last - min) / min
  oi_slope_7d: number; // 近7日线性斜率
  oi_clean_then_build_flag: boolean; // 是否存在"先缩后扩"
  
  // Funding 特征
  funding_last: number;
  funding_p10: number; // 10分位
  funding_p90: number; // 90分位
  funding_extreme_side: 'positive_extreme' | 'negative_extreme' | 'normal';
  funding_shift_7d: number; // 近7天均值 - 前7天均值
  
  // Long/Short Ratio 特征
  ls_ratio_last: number;
  ls_ratio_p10: number;
  ls_ratio_p90: number;
  ls_ratio_reversal_flag: boolean; // 从低位抬升是否明显
  
  // Basis 特征
  basis_last: number;
  basis_jump_flag: boolean; // 近7天是否显著抬升
  
  // Taker Buy/Sell 特征
  taker_buy_ratio_last: number;
  taker_buy_bias_flag: boolean;
  
  // 缺失标记
  missing: {
    oi: boolean;
    funding: boolean;
    longShortRatio: boolean;
    basis: boolean;
    takerBuySell: boolean;
  };
}

/**
 * 得分明细（新标准：每类0-25分，总分0-100）
 */
export interface ScoreBreakdown {
  oi_rhythm: number; // 0-25: OI 节奏（先缩后扩）
  ls_ratio_reversal: number; // 0-25: 多空反转（大户/账户多空比从低位抬升）
  taker_buy_bias: number; // 0-25: 主动买量（taker buy 上升）
  basis_expansion: number; // 0-25: 基差（合约溢价扩大）
  total: number; // 0-100
}

/**
 * 轧空类型
 */
export type SqueezeType = 'short_squeeze_like' | 'long_squeeze_like' | 'neutral';

/**
 * DeepSeek 分析结果
 */
export interface SqueezeAnalysis {
  ticker: string;
  squeezeType: SqueezeType;
  score: number;
  confidence: number;
  keySignals: string[];
  why: string;
  whatToWatch: string[];
  missingData: string[];
  disclaimer: string;
}

/**
 * 轧空扫描结果（Top N）
 */
export interface SqueezeScanResult {
  symbol: string;
  score: number;
  squeezeType: SqueezeType;
  features: SqueezeFeatures;
  scoreBreakdown: ScoreBreakdown;
}

// 状态类型
export enum UserState {
  IDLE = 'idle',
  WAITING_TICKER = 'waiting_ticker',
  WAITING_INVITE_CODE = 'waiting_invite_code',
}

/**
 * Funding 模块状态
 */
export interface FundingState {
  step: 'funding_module' | 'funding_direction' | 'funding_result';
  fundingModule?: 'exchange' | 'accumulated' | 'history' | 'vol_weighted';
  direction?: 'positive' | 'negative';
  symbol?: string; // 用于历史查询
}

