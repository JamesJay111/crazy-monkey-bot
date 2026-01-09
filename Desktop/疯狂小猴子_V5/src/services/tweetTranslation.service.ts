import { DeepSeekClient } from '../clients/deepseek.client';
import { logger } from '../utils/logger';
import { env } from '../config/env';

/**
 * 翻译目标语言
 */
export type TranslationTargetLang = 'en' | 'ko';

/**
 * 翻译服务
 */
export class TweetTranslationService {
  private deepseek: DeepSeekClient;

  constructor() {
    this.deepseek = new DeepSeekClient(
      env.DEEPSEEK_API_KEY,
      env.DEEPSEEK_API_URL
    );
  }

  /**
   * 使用 DeepSeek 翻译推文
   * @param text 原文
   * @param targetLang 目标语言（'en' 英文 | 'ko' 韩语）
   * @returns 翻译后的文本
   */
  async translateWithDeepSeek(text: string, targetLang: TranslationTargetLang): Promise<string> {
    const langName = targetLang === 'en' ? 'English' : 'Korean';
    
    const systemPrompt = `你是专业翻译。保留原格式，不扩写，不添加免责声明，不改变专有名词与数字格式。`;

    const userPrompt = `将以下内容翻译为 ${langName}，保持换行结构与标点。仅输出译文。

${text}`;

    try {
      logger.debug({ targetLang, textLength: text.length }, 'Translating tweet with DeepSeek');
      
      const translated = await this.deepseek.analyzeWithPrompt(
        systemPrompt,
        userPrompt,
        {
          temperature: 0.3, // 降低温度以获得更准确的翻译
          maxTokens: Math.max(2000, text.length * 2), // 确保有足够 token
        }
      );

      // 清理翻译结果（移除可能的 markdown 格式、多余空行等）
      const cleaned = this.cleanTranslation(translated);
      
      logger.info({ 
        targetLang, 
        originalLength: text.length, 
        translatedLength: cleaned.length 
      }, 'Tweet translated successfully');

      return cleaned;
    } catch (error) {
      logger.error({ error, targetLang }, 'Failed to translate tweet');
      throw new Error(`翻译失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 清理翻译结果
   */
  private cleanTranslation(text: string): string {
    return text
      .trim()
      // 移除可能的 markdown 代码块标记
      .replace(/^```[\w]*\n?/gm, '')
      .replace(/```$/gm, '')
      // 移除多余的空行（保留单个空行）
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }
}



