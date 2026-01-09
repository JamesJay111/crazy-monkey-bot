/**
 * 智能截断文本工具
 * 用于 Twitter 字符限制（280字符）
 */

/**
 * 智能截断文本
 * @param text 原文
 * @param maxLength 最大长度（默认 280，Twitter 限制）
 * @returns 截断后的文本（如果截断，末尾追加 …）
 */
export function smartTruncate(text: string, maxLength: number = 280): string {
  if (text.length <= maxLength) {
    return text;
  }

  // 预留 1 个字符给省略号
  const truncateLength = maxLength - 1;

  // 尝试在单词边界截断（英文）
  let truncated = text.substring(0, truncateLength);
  
  // 如果截断位置不是空格，向前查找最近的空格
  const lastSpace = truncated.lastIndexOf(' ');
  const lastNewline = truncated.lastIndexOf('\n');
  const lastBreak = Math.max(lastSpace, lastNewline);
  
  if (lastBreak > truncateLength * 0.7) {
    // 如果找到的断点位置合理（在 70% 之后），使用该断点
    truncated = truncated.substring(0, lastBreak);
  }

  // 处理韩文字符（韩文通常不需要在单词边界截断，但需要避免截断到半个字符）
  // 检查最后一个字符是否是完整的 Unicode 字符
  const lastChar = truncated[truncated.length - 1];
  if (lastChar && /[\uAC00-\uD7A3]/.test(lastChar)) {
    // 如果是韩文字符，确保是完整的字符（不需要特殊处理，因为 JS 字符串已经是 UTF-16）
    // 但需要检查是否有尾随的不完整字符（通常不会发生）
  }

  // 移除末尾可能的空格或换行
  truncated = truncated.trimEnd();

  return truncated + '…';
}

/**
 * 检查文本是否需要截断
 */
export function needsTruncation(text: string, maxLength: number = 280): boolean {
  return text.length > maxLength;
}



