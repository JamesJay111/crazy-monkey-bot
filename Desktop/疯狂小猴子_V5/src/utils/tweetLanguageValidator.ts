/**
 * 推文语言校验工具
 * 用于确保推文内容符合指定语言要求
 */

/**
 * 语言类型
 */
export type TweetLanguage = 'zh' | 'ko' | 'en';

/**
 * 语言校验结果
 */
export interface LanguageValidationResult {
  isValid: boolean;
  reason?: string;
  detectedLanguage?: string;
}

/**
 * 检测文本中的中文字符
 */
function hasChinese(text: string): boolean {
  // CJK 统一汉字范围：\u4e00-\u9fff
  return /[\u4e00-\u9fff]/.test(text);
}

/**
 * 检测文本中的韩文字符
 */
function hasKorean(text: string): boolean {
  // 韩文音节范围：\uac00-\ud7a3 (가-힣)
  return /[\uac00-\ud7a3]/.test(text);
}

/**
 * 检测文本是否主要由 ASCII 字符组成（英文）
 */
function isMainlyASCII(text: string): boolean {
  // 移除空格、标点、emoji 后，检查是否主要是 ASCII
  const cleaned = text.replace(/[\s\p{P}\p{Emoji}]/gu, '');
  if (cleaned.length === 0) return false;
  
  // 计算 ASCII 字符比例（A-Z, a-z, 0-9）
  const asciiCount = (cleaned.match(/[A-Za-z0-9]/g) || []).length;
  return asciiCount / cleaned.length >= 0.8; // 至少 80% 是 ASCII
}

/**
 * 校验推文语言
 * @param text 推文文本
 * @param expectedLanguage 期望的语言
 * @returns 校验结果
 */
export function validateTweetLanguage(
  text: string,
  expectedLanguage: TweetLanguage
): LanguageValidationResult {
  const hasZh = hasChinese(text);
  const hasKo = hasKorean(text);
  const isEn = isMainlyASCII(text);

  // 检测实际语言
  let detectedLanguage: string | undefined;
  if (hasZh) detectedLanguage = 'zh';
  else if (hasKo) detectedLanguage = 'ko';
  else if (isEn) detectedLanguage = 'en';

  // 根据期望语言进行校验
  switch (expectedLanguage) {
    case 'zh':
      if (!hasZh) {
        return {
          isValid: false,
          reason: '推文不包含中文字符',
          detectedLanguage,
        };
      }
      if (hasKo) {
        return {
          isValid: false,
          reason: '推文包含韩文字符（中文推文不应包含韩文）',
          detectedLanguage,
        };
      }
      // 如果主要是 ASCII（英文），但包含中文，可能是混排，需要检查中文比例
      if (isEn && hasZh) {
        const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
        const totalChars = text.replace(/[\s\p{P}\p{Emoji}]/gu, '').length;
        if (totalChars > 0 && chineseChars / totalChars < 0.3) {
          return {
            isValid: false,
            reason: '推文主要是英文，中文比例过低（中文推文应主要为中文）',
            detectedLanguage,
          };
        }
      }
      return { isValid: true, detectedLanguage: 'zh' };

    case 'ko':
      if (!hasKo) {
        return {
          isValid: false,
          reason: '推文不包含韩文字符',
          detectedLanguage,
        };
      }
      if (hasZh) {
        return {
          isValid: false,
          reason: '推文包含中文字符（韩文推文不应包含中文）',
          detectedLanguage,
        };
      }
      // 如果主要是 ASCII（英文），但包含韩文，可能是混排，需要检查韩文比例
      if (isEn && hasKo) {
        const koreanChars = (text.match(/[\uac00-\ud7a3]/g) || []).length;
        const totalChars = text.replace(/[\s\p{P}\p{Emoji}]/gu, '').length;
        if (totalChars > 0 && koreanChars / totalChars < 0.3) {
          return {
            isValid: false,
            reason: '推文主要是英文，韩文比例过低（韩文推文应主要为韩文）',
            detectedLanguage,
          };
        }
      }
      return { isValid: true, detectedLanguage: 'ko' };

    case 'en':
      if (!isEn) {
        return {
          isValid: false,
          reason: '推文不是主要由 ASCII 字符组成（英文推文应主要为英文）',
          detectedLanguage,
        };
      }
      if (hasZh || hasKo) {
        return {
          isValid: false,
          reason: `推文包含非英文字符（${hasZh ? '中文' : ''}${hasZh && hasKo ? '和' : ''}${hasKo ? '韩文' : ''}）`,
          detectedLanguage,
        };
      }
      return { isValid: true, detectedLanguage: 'en' };

    default:
      return {
        isValid: false,
        reason: `未知的语言类型: ${expectedLanguage}`,
      };
  }
}

/**
 * 移除推文中的 ST/MT 标签
 */
export function removeSTMTLabels(text: string): string {
  // 移除各种可能的 ST/MT 标签变体
  return text
    .replace(/ST\s*[:：]\s*/gi, '')
    .replace(/MT\s*[:：]\s*/gi, '')
    .replace(/短周期\s*[:：]\s*/g, '')
    .replace(/中周期\s*[:：]\s*/g, '')
    .replace(/단기\s*\(ST\)\s*[:：]\s*/gi, '')
    .replace(/중기\s*\(MT\)\s*[:：]\s*/gi, '')
    .replace(/Short-term\s*[:：]\s*/gi, '')
    .replace(/Medium-term\s*[:：]\s*/gi, '')
    .trim();
}

/**
 * 移除多余的 Icon（只保留第一行开头的）
 * @param text 推文文本
 * @param allowedIcons 允许的 Icon 列表
 * @returns 处理后的文本
 */
export function deduplicateIcons(text: string, allowedIcons: string[] = ['🚨', '⚠️', 'ℹ️', '⏱️', '✅']): string {
  const lines = text.split('\n');
  if (lines.length === 0) return text;

  // 第一行：保留第一个 icon，移除后续的 icon
  const firstLine = lines[0];
  let firstLineProcessed = firstLine;
  let firstIconIndex = -1;
  let firstIconChar = '';

  // 找到第一个出现的 icon（按位置排序）
  const iconPositions: Array<{ icon: string; index: number }> = [];
  for (const icon of allowedIcons) {
    const index = firstLine.indexOf(icon);
    if (index !== -1) {
      iconPositions.push({ icon, index });
    }
  }

  if (iconPositions.length > 0) {
    // 按位置排序，找到第一个
    iconPositions.sort((a, b) => a.index - b.index);
    firstIconChar = iconPositions[0].icon;
    firstIconIndex = iconPositions[0].index;

    // 移除第一行中除第一个 icon 外的所有其他 icon
    for (const icon of allowedIcons) {
      if (icon !== firstIconChar) {
        // 移除其他 icon
        firstLineProcessed = firstLineProcessed.replace(new RegExp(icon.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '');
      } else {
        // 对于第一个 icon，只保留第一次出现，移除后续出现
        const escapedIcon = icon.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(escapedIcon, 'g');
        let count = 0;
        firstLineProcessed = firstLineProcessed.replace(regex, (match) => {
          count++;
          return count === 1 ? match : ''; // 只保留第一次出现
        });
      }
    }
  } else {
    // 如果第一行没有 icon，移除所有 icon（以防万一）
    for (const icon of allowedIcons) {
      firstLineProcessed = firstLineProcessed.replace(new RegExp(icon.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '');
    }
  }

  // 清理第一行的多余空格
  firstLineProcessed = firstLineProcessed.replace(/\s+/g, ' ').trim();

  // 其他行：移除所有 icon
  const otherLines = lines.slice(1).map(line => {
    let processedLine = line;
    for (const icon of allowedIcons) {
      processedLine = processedLine.replace(new RegExp(icon.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '');
    }
    return processedLine.trim();
  });

  // 重新组合，保留换行符
  return [firstLineProcessed, ...otherLines].filter(l => l.length > 0).join('\n');
}

