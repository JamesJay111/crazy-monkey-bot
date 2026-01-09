/**
 * 轧空分析 DeepSeek Prompt 模板（新标准）
 */

export const SQUEEZE_SYSTEM_PROMPT = `你是衍生品结构分析助手。只基于输入数据解释结构变化，不预测价格，不给交易建议。

你的任务是：
1. 分析当前市场结构（是否构成轧空/挤压）
2. 解释为什么会出现这种结构（必须引用量化数值）
3. 指出需要关注的关键点
4. 明确说明这不是投资建议

输出必须是严格的 JSON 格式，包含所有必需字段。`;

/**
 * 构建轧空分析 Prompt
 */
export function buildSqueezePrompt(
  ticker: string,
  features: any,
  scoreBreakdown: any,
  squeezeType: string
): string {
  // 构建量化证据
  const evidence: string[] = [];
  
  if (scoreBreakdown.oi_rhythm >= 16) {
    evidence.push(`OI: drawdown=${(features.oi_drawdown_pct * 100).toFixed(2)}%, rebound=${(features.oi_rebound_from_min_pct * 100).toFixed(2)}%`);
  }
  if (scoreBreakdown.ls_ratio_reversal >= 14) {
    const ls_min_14d = features.ls_ratio_p10; // 简化：用 p10 近似最低值
    const ls_jump = features.ls_ratio_last / ls_min_14d;
    evidence.push(`LS: min14d=${ls_min_14d.toFixed(2)} → last=${features.ls_ratio_last.toFixed(2)} (jump=${ls_jump.toFixed(2)}x)`);
  }
  if (scoreBreakdown.basis_expansion >= 10) {
    const basis_3days_ago = features.basis_last * 0.7; // 简化估算
    const basis_jump_3d = features.basis_last - basis_3days_ago;
    evidence.push(`Basis: last=${(features.basis_last * 100).toFixed(4)}%, jump3d=${(basis_jump_3d * 100).toFixed(4)}%`);
  }
  if (scoreBreakdown.taker_buy_bias >= 16) {
    evidence.push(`Taker: buy_ratio=${(features.taker_buy_ratio_last * 100).toFixed(2)}%`);
  }

  // 计算缺失指标数量
  const missingCount = Object.values(features.missing || {}).filter(Boolean).length;

  const inputData = {
    ticker,
    structure: squeezeType,
    score: scoreBreakdown.total,
    features: {
      oi: {
        drawdown_pct: features.oi_drawdown_pct,
        rebound_pct: features.oi_rebound_from_min_pct,
        clean_then_build_flag: features.oi_clean_then_build_flag,
      },
      ls_ratio: {
        last: features.ls_ratio_last,
        p10: features.ls_ratio_p10,
        p90: features.ls_ratio_p90,
        reversal_flag: features.ls_ratio_reversal_flag,
      },
      taker: {
        buy_ratio_last: features.taker_buy_ratio_last,
        buy_bias_flag: features.taker_buy_bias_flag,
      },
      basis: {
        last: features.basis_last,
        jump_flag: features.basis_jump_flag,
      },
    },
    scoreBreakdown: {
      oi_rhythm: scoreBreakdown.oi_rhythm,
      ls_ratio_reversal: scoreBreakdown.ls_ratio_reversal,
      taker_buy_bias: scoreBreakdown.taker_buy_bias,
      basis_expansion: scoreBreakdown.basis_expansion,
      total: scoreBreakdown.total,
    },
    missingData: Object.keys(features.missing || {}).filter(key => (features.missing || {})[key]),
  };

  const userPrompt = `请基于以下数据进行结构分析，输出严格 JSON：

{
  "ticker": "${ticker}",
  "structure": "short_squeeze_like | long_squeeze_like | neutral",
  "score": ${scoreBreakdown.total},
  "confidence": 0-100,
  "evidence": [
    ${evidence.map(e => `"${e}"`).join(',\n    ')}
  ],
  "interpretation": "不超过140字，解释当前结构意味着什么（不预测价格）",
  "whatToWatch": ["关注点1", "关注点2", "关注点3"],
  "disclaimer": "非投资建议"
}

输入数据：
${JSON.stringify(inputData, null, 2)}

规则：
- 若缺失指标 >= 2，confidence ≤ 70
- 若信号互相矛盾，必须说明并降低 confidence
- 必须引用至少 2 个关键数值（例如 drawdown_pct、rebound_pct、ls_ratio_last、basis_last）
- 不喊单，不预测未来价格
- evidence 必须包含 liquidation 相关的描述（如果有数据）`;

  return userPrompt;
}
