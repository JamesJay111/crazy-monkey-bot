import { logger } from '../utils/logger';
import { CoinGlassETFFlow } from '../types';

/**
 * ETF 资金流聚合结果
 */
export interface EtfFlowAggregateResult {
  /** 净流入（可正可负） */
  netFlowUsd: number;
  /** 总流入（永远为正） */
  inflowUsd: number;
  /** 总流出绝对值（永远为正） */
  outflowAbsUsd: number;
  /** 按 ticker 聚合的 map */
  byTickerMap: Record<string, number>;
  /** 按绝对值排序的 top tickers */
  topTickers: Array<{ ticker: string; flowUsd: number }>;
  /** 数据点数 */
  recordCount: number;
}

/**
 * 统一计算 ETF 资金流汇总
 * 
 * 输入：一组已按日期过滤后的明细记录
 * 输出：净流入、总流入、总流出、按ticker聚合结果
 * 
 * 规则：
 * - flow_usd 缺失/null/NaN -> 视为 0
 * - inflow_usd = Σ max(flow_usd, 0)
 * - outflow_usd_abs = Σ abs(min(flow_usd, 0))
 * - net_flow_usd = inflow_usd - outflow_usd_abs
 * 
 * @param records ETF 资金流记录数组
 * @returns 聚合结果
 */
export function aggregateEtfFlows(records: CoinGlassETFFlow[]): EtfFlowAggregateResult {
  // 初始化
  let totalInflow = 0;
  let totalOutflowAbs = 0;
  const byTickerMap: Record<string, number> = {};
  const tickerSet = new Set<string>();

  // 遍历所有记录，聚合 etf_flows
  for (const record of records) {
    if (!record.etf_flows || !Array.isArray(record.etf_flows)) {
      continue;
    }

    for (const etf of record.etf_flows) {
      if (!etf.etf_ticker) {
        continue;
      }

      const ticker = etf.etf_ticker;
      tickerSet.add(ticker);

      // 解析 flow_usd，缺失/null/NaN -> 0
      let flowUsd = 0;
      if (etf.flow_usd !== undefined && etf.flow_usd !== null && etf.flow_usd !== '') {
        const parsed = parseFloat(String(etf.flow_usd));
        flowUsd = isNaN(parsed) ? 0 : parsed;
      }

      // 累加到 ticker map
      if (!(ticker in byTickerMap)) {
        byTickerMap[ticker] = 0;
      }
      byTickerMap[ticker] += flowUsd;

      // 累加总流入和总流出
      if (flowUsd > 0) {
        totalInflow += flowUsd;
      } else if (flowUsd < 0) {
        totalOutflowAbs += Math.abs(flowUsd);
      }
    }
  }

  // 计算净流入
  const netFlowUsd = totalInflow - totalOutflowAbs;

  // 生成 top tickers（按绝对值排序）
  const topTickers = Array.from(tickerSet)
    .map(ticker => ({
      ticker,
      flowUsd: byTickerMap[ticker] || 0,
    }))
    .sort((a, b) => Math.abs(b.flowUsd) - Math.abs(a.flowUsd));

  return {
    netFlowUsd,
    inflowUsd: totalInflow,
    outflowAbsUsd: totalOutflowAbs,
    byTickerMap,
    topTickers,
    recordCount: records.length,
  };
}

/**
 * 校验聚合结果的一致性
 * 
 * 校验规则：
 * 1. net ≈ sum(flow_usd)（允许极小浮点误差）
 * 2. inflow 与 outflowAbs 与 ticker 聚合结果一致
 * 
 * @param result 聚合结果
 * @param records 原始记录（用于校验）
 * @returns 校验是否通过
 */
export function validateAggregateResult(
  result: EtfFlowAggregateResult,
  records: CoinGlassETFFlow[]
): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];

  // 1. 校验：net ≈ sum(flow_usd)
  let sumFromRecords = 0;
  for (const record of records) {
    if (record.etf_flows && Array.isArray(record.etf_flows)) {
      for (const etf of record.etf_flows) {
        if (etf.flow_usd !== undefined && etf.flow_usd !== null && etf.flow_usd !== '') {
          const parsed = parseFloat(String(etf.flow_usd));
          if (!isNaN(parsed)) {
            sumFromRecords += parsed;
          }
        }
      }
    }
  }

  const netDiff = Math.abs(result.netFlowUsd - sumFromRecords);
  const tolerance = 0.01; // 允许1分钱的误差
  if (netDiff > tolerance) {
    errors.push(
      `Net flow mismatch: calculated=${result.netFlowUsd}, sum=${sumFromRecords}, diff=${netDiff}`
    );
  }

  // 2. 校验：inflow 与 outflowAbs 与 ticker 聚合结果一致
  let sumFromTickers = 0;
  let inflowFromTickers = 0;
  let outflowFromTickers = 0;

  for (const ticker in result.byTickerMap) {
    const flow = result.byTickerMap[ticker];
    sumFromTickers += flow;
    if (flow > 0) {
      inflowFromTickers += flow;
    } else if (flow < 0) {
      outflowFromTickers += Math.abs(flow);
    }
  }

  const inflowDiff = Math.abs(result.inflowUsd - inflowFromTickers);
  const outflowDiff = Math.abs(result.outflowAbsUsd - outflowFromTickers);

  if (inflowDiff > tolerance) {
    errors.push(
      `Inflow mismatch: calculated=${result.inflowUsd}, fromTickers=${inflowFromTickers}, diff=${inflowDiff}`
    );
  }

  if (outflowDiff > tolerance) {
    errors.push(
      `Outflow mismatch: calculated=${result.outflowAbsUsd}, fromTickers=${outflowFromTickers}, diff=${outflowDiff}`
    );
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

