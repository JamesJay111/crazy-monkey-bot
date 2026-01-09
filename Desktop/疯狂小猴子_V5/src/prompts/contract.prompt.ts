/**
 * 合约分析 DeepSeek Prompt 模板（深度分析版）
 * 更深入、更像交易员的结构分析
 */

export const CONTRACT_ANALYSIS_SYSTEM_PROMPT = `你是资深量化/交易系统工程师。负责分析合约市场结构，但遵守合规与产品约束：
- 不做价格预测
- 不提供直接交易指令
- 不喊单
- 只做结构解读与风险提示

你的任务是基于输入数据输出"结构画像"，包含：仓位结构、资金费率结构、主动成交结构、结构一致性、风险清单。`;

/**
 * 构建合约分析 Prompt（深度分析版）
 * 按照用户要求的 JSON 输入格式和分析规则
 */
export function buildContractAnalysisPrompt(input: any): string {
  // 构建符合用户要求的 JSON 格式
  const analysisInput = {
    symbol: input.symbol || input.pairSymbol?.replace('USDT', '') || 'UNKNOWN',
    exchange: input.exchange || 'Binance',
    interval: '4h',
    
    // OI（4小时前）
    oi_usd_4h_ago: input.oiUsd || 0,
    
    // 当前资金费率
    funding_rate_current: input.fundingRate || 0,
    funding_exchange_used: input.fundingExchange || 'Binance',
    
    // OI 加权资金费率历史（K线）
    oi_weight_funding_history: (input.fundingRateHistory?.oiWeighted || []).map((item: any) => ({
      time: item.time || 0,
      open: parseFloat(item.open || '0'),
      high: parseFloat(item.high || '0'),
      low: parseFloat(item.low || '0'),
      close: parseFloat(item.close || '0'),
    })),
    
    // 成交量加权资金费率历史（K线）
    vol_weight_funding_history: (input.fundingRateHistory?.volWeighted || []).map((item: any) => ({
      time: item.time || 0,
      open: parseFloat(item.open || '0'),
      high: parseFloat(item.high || '0'),
      low: parseFloat(item.low || '0'),
      close: parseFloat(item.close || '0'),
    })),
    
    // 主动成交数据
    taker_buy_usd_latest: input.takerBuyVolUsd || 0,
    taker_sell_usd_latest: input.takerSellVolUsd || 0,
    taker_time_latest: input.takerTimeLatest || Date.now(),
    
    // 大户多空比（最新）
    top_long_percent_latest: input.topAccountLongPercent || 0,
    top_short_percent_latest: input.topAccountShortPercent || 0,
    top_long_short_ratio_latest: input.topAccountLongShortRatio || 1.0,
    top_ratio_time_latest: input.topRatioTimeLatest || Date.now(),
    
    // 大户多空比历史（至少最近 2-6 根）
    top_ratio_history: (input.topRatioHistory || []).map((item: any) => ({
      time: item.time || 0,
      top_position_long_percent: parseFloat(item.top_position_long_percent || item.top_account_long_percent || '0'),
      top_position_short_percent: parseFloat(item.top_position_short_percent || item.top_account_short_percent || '0'),
      top_position_long_short_ratio: parseFloat(item.top_position_long_short_ratio || item.top_account_long_short_ratio || '1.0'),
    })),
  };

  return `分析以下合约数据，按照固定格式输出结构化分析。

输入数据（JSON）：
${JSON.stringify(analysisInput, null, 2)}

分析要求：

A1. 分析目标（只做结构，不做预测）
输出对交易员有用的"结构画像"，包含以下维度：

1) 仓位结构（Positioning）
- 大户多空比处于偏多/偏空/均衡
- 是否出现"反转"（上一根 vs 最新一根）
- 反转强度（弱/中/强）：依据 ratio 变化幅度

2) 资金费率结构（Carry / Crowdedness）
- 当前 funding 在近几根 K 线中的分位感（偏高/偏低/正常）
- OI 加权 vs 成交量加权 funding 是否分歧（说明市场是"持仓端驱动"还是"成交端驱动"）

3) 主动成交结构（Aggression / Orderflow）
- 主动买卖差值：delta = buy - sell
- 主动方向强弱：imbalance = delta / (buy+sell)
- 用语言解释：买方更激进/卖方更激进/均衡

4) 结构一致性（Confluence）
- 将大户结构、funding、orderflow 三者做一致性判断：一致/分歧
- 一致 → 结构更"顺滑"；分歧 → 结构更"脆弱/易反向挤压"

5) 风险清单（Risk Checklist）
- "拥挤度风险"：funding 高 + 大户偏多（或相反）
- "反转风险"：ratio 在 4h 内反转 + orderflow 同方向
- "噪音风险"：数据不足/分歧过多

A2. 必须实现的定量判定（让输出稳定）

2.1 大户多空反转判定
- ratio_prev = top_ratio_history 倒数第二根的 top_position_long_short_ratio
- ratio_now = 最新一根的 top_position_long_short_ratio
- 若 ratio_prev < 1 且 ratio_now > 1 → "由偏空翻为偏多（反转）"
- 若 ratio_prev > 1 且 ratio_now < 1 → "由偏多翻为偏空（反转）"
- 反转强度：
  * |ratio_now - ratio_prev| < 0.1 → 弱
  * 0.1 ≤ |ratio_now - ratio_prev| < 0.3 → 中
  * |ratio_now - ratio_prev| ≥ 0.3 → 强

2.2 主动成交失衡
- buy = taker_buy_usd_latest, sell = taker_sell_usd_latest
- imbalance = (buy - sell) / (buy + sell)
- |imbalance| < 0.05 → 均衡
- 0.05 ≤ |imbalance| < 0.15 → 轻度失衡
- |imbalance| ≥ 0.15 → 明显失衡
- buy > sell 说明"买方更激进"；sell > buy 说明"卖方更激进"

2.3 Funding 拥挤度（近几根）
- 从 oi_weight_funding_history、vol_weight_funding_history 各取最近 N=6 根 close
- 当前 funding 与历史 close 比：
  * 位于上 1/3 → 偏高
  * 中 1/3 → 正常
  * 下 1/3 → 偏低
- 若 OI 加权偏高但成交量加权不高 → "持仓端更拥挤"
- 若成交量加权偏高但 OI 加权不高 → "成交端短期情绪更热"
- 若历史数据不足（<3 根），必须输出"历史样本不足，结论降级"

A3. 输出格式（固定、短而硬）

你必须严格遵守以下格式输出：

🧠 合约结构深度分析｜{symbol}（{exchange} · {interval}）

1) 仓位结构（大户）
- 当前：多 {top_long_percent}% / 空 {top_short_percent}% ｜比值 {ratio_now}
- 变化：{是否反转 + 强度 + 依据}

2) 资金费率（拥挤度）
- 当前 funding：{funding_rate_current}
- 近6根对比：{偏高/正常/偏低}（样本不足则说明）
- OI加权 vs 成交量加权：{一致/分歧} → {含义一句话}

3) 主动成交（短周期情绪）
- 买：{taker_buy_usd_latest} / 卖：{taker_sell_usd_latest}
- 失衡度：{imbalance} → {均衡/轻度/明显}（买方更激进/卖方更激进）

4) 结构一致性
- 结论：{一致/分歧}
- 解释：一句话指出哪两项一致/冲突

5) 风险清单（仅结构）
- {列 2–4 条，尽量具体}

⚠️ 说明：结构分析不构成投资建议，不预测价格路径。

A4. 禁止
- 不允许给出"做多/做空/止损/目标价"
- 不允许价格预测
- 不允许引用外部新闻或链上数据（除非后端提供）`;
}

// ========== 兼容性（旧 Prompt，保留） ==========

export const CONTRACT_SYSTEM_PROMPT = CONTRACT_ANALYSIS_SYSTEM_PROMPT;

export function buildContractPrompt(status: any): string {
  return JSON.stringify(status, null, 2);
}
