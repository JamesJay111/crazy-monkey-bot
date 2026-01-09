// 用户状态类型
export enum UserState {
  IDLE = 'idle',
  WAITING_TICKER_INPUT = 'waiting_ticker_input',
  WAITING_INVITE_CODE = 'waiting_invite_code',
  VIEWING_SHORT_SQUEEZE = 'viewing_short_squeeze',
  VIEWING_ETF = 'viewing_etf',
  VIEWING_FUNDING = 'viewing_funding',
}

// CoinGlass 数据类型
export interface CoinGlassOHLC {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CoinGlassOI {
  time: number;
  value: number;
  change: number;
}

export interface CoinGlassFunding {
  symbol: string;
  fundingRate: number;
  nextFundingTime: number;
}

export interface CoinGlassLongShortRatio {
  symbol: string;
  longRate: number;
  shortRate: number;
  longAccount: number;
  shortAccount: number;
}

export interface CoinGlassETF {
  symbol: string;
  netFlow: number;
  netFlow24h: number;
  totalAssets: number;
}

export interface CoinGlassTickerData {
  symbol: string;
  price: number;
  oi: number;
  oiChange24h: number;
  fundingRate: number;
  longShortRatio: number;
  basis: number;
  volume24h: number;
  isBinanceFutures: boolean;
}

// 用户数据
export interface UserData {
  userId: number;
  username?: string;
  isUnlocked: boolean;
  unlockMethod?: 'stars' | 'invite';
  unlockTime?: number;
  currentState: UserState;
  context?: Record<string, any>;
}

// 付费相关
export interface PaymentInfo {
  userId: number;
  amount: number;
  method: 'stars' | 'invite';
  timestamp: number;
}

