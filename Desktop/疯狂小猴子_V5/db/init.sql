-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT,
  is_unlocked INTEGER DEFAULT 0,
  unlock_method TEXT,
  unlock_time INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_users_id ON users(id);
CREATE INDEX IF NOT EXISTS idx_users_unlocked ON users(is_unlocked);

-- 宏观事件推送日志表
CREATE TABLE IF NOT EXISTS macro_event_push_log (
  event_key TEXT PRIMARY KEY,
  calendar_name TEXT NOT NULL,
  publish_time_utc_ms INTEGER NOT NULL,
  importance_level INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('UPCOMING', 'RELEASED')),
  sent_at_utc_ms INTEGER NOT NULL,
  tw_a_status TEXT CHECK(tw_a_status IN ('sent', 'failed')),
  tw_b_status TEXT CHECK(tw_b_status IN ('sent', 'failed')),
  tw_c_status TEXT CHECK(tw_c_status IN ('sent', 'failed')),
  lark_status TEXT CHECK(lark_status IN ('sent', 'failed')),
  tw_a_tweet_id TEXT,
  tw_b_tweet_id TEXT,
  tw_c_tweet_id TEXT,
  last_error TEXT
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_macro_event_publish_time ON macro_event_push_log(publish_time_utc_ms);
CREATE INDEX IF NOT EXISTS idx_macro_event_sent_at ON macro_event_push_log(sent_at_utc_ms);

-- Binance OI 异动推送 cooldown 表
CREATE TABLE IF NOT EXISTS binance_oi_alert_cooldown (
  ticker TEXT PRIMARY KEY,
  last_sent_at_utc_ms INTEGER NOT NULL,
  last_direction INTEGER NOT NULL CHECK(last_direction IN (-1, 0, 1)), -- -1: 下降, 0: 无变化, 1: 上升
  last_oi_change_percent REAL NOT NULL,
  created_at_utc_ms INTEGER NOT NULL,
  updated_at_utc_ms INTEGER NOT NULL
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_oi_alert_ticker ON binance_oi_alert_cooldown(ticker);
CREATE INDEX IF NOT EXISTS idx_oi_alert_last_sent ON binance_oi_alert_cooldown(last_sent_at_utc_ms);

-- ETF Twitter 推送日志表
CREATE TABLE IF NOT EXISTS etf_twitter_push_log (
  date TEXT PRIMARY KEY,
  target_date_utc TEXT NOT NULL,
  pushed_at_utc_ms INTEGER NOT NULL,
  account_a_status TEXT CHECK(account_a_status IN ('sent', 'failed', 'skipped')),
  account_b_status TEXT CHECK(account_b_status IN ('sent', 'failed', 'skipped')),
  account_c_status TEXT CHECK(account_c_status IN ('sent', 'failed', 'skipped')),
  account_a_tweet_id TEXT,
  account_b_tweet_id TEXT,
  account_c_tweet_id TEXT,
  btc_netflow_m TEXT,
  xrp_netflow_m TEXT,
  eth_netflow_m TEXT,
  sol_netflow_m TEXT,
  last_error TEXT
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_etf_twitter_push_date ON etf_twitter_push_log(date);
CREATE INDEX IF NOT EXISTS idx_etf_twitter_push_pushed_at ON etf_twitter_push_log(pushed_at_utc_ms);

