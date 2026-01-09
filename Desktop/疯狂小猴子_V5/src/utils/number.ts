/**
 * 数值解析工具
 * 严格区分缺失值与有效数值，避免用 0 代表缺失
 */

/**
 * 检查是否为有限数值
 */
export function isFiniteNumber(value: any): boolean {
  if (typeof value !== 'number') return false;
  return isFinite(value) && !isNaN(value);
}

/**
 * 严格解析数值（三态：undefined / number）
 * - undefined/null/空字符串/'—'/'-'/NaN/Infinity → undefined
 * - 合法可解析数值 → number
 */
export function parseNumberStrict(value: any): number | undefined {
  // null/undefined
  if (value === null || value === undefined) {
    return undefined;
  }

  // 字符串处理
  if (typeof value === 'string') {
    const trimmed = value.trim();
    // 空字符串或占位符
    if (trimmed === '' || trimmed === '—' || trimmed === '-' || trimmed === 'null' || trimmed === 'undefined') {
      return undefined;
    }
    // 尝试解析
    const parsed = parseFloat(trimmed);
    if (isNaN(parsed) || !isFinite(parsed)) {
      return undefined;
    }
    return parsed;
  }

  // 数值类型
  if (typeof value === 'number') {
    if (isNaN(value) || !isFinite(value)) {
      return undefined;
    }
    return value;
  }

  // 其他类型
  return undefined;
}

/**
 * 安全解析数值（带默认值，用于非关键字段）
 */
export function parseNumberSafe(value: any, defaultValue: number = 0): number {
  const parsed = parseNumberStrict(value);
  return parsed !== undefined ? parsed : defaultValue;
}



