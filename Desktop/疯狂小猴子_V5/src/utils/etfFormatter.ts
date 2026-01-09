/**
 * ETF 金额格式化工具
 */

/**
 * 将金额格式化为 M 单位（百万美元）
 * @param valueUsd 原始金额（美元）
 * @returns 格式化后的字符串，例如：+211.4M、-35.2M、0.0M
 */
export function formatEtfAmountM(valueUsd: number | null | undefined): string {
  if (valueUsd === null || valueUsd === undefined || isNaN(valueUsd)) {
    return '—';
  }

  const valueInM = Math.abs(valueUsd) / 1_000_000;
  const sign = valueUsd >= 0 ? '+' : '-';
  
  // 如果值为 0，返回 0.0M
  if (valueInM === 0) {
    return '0.0M';
  }

  // 保留 1 位小数
  return `${sign}${valueInM.toFixed(1)}M`;
}

