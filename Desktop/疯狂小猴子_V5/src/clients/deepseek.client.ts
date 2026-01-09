import axios, { AxiosInstance, AxiosError } from 'axios';
import { logger } from '../utils/logger';
import { SQUEEZE_SYSTEM_PROMPT } from '../prompts/squeeze.prompt';

export interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface DeepSeekResponse {
  content: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/**
 * DeepSeek API 客户端
 */
export class DeepSeekClient {
  private api: AxiosInstance;
  private apiKey: string;
  private apiUrl: string;

  constructor(apiKey: string, apiUrl: string = 'https://api.deepseek.com/v1/chat/completions') {
    this.apiKey = apiKey;
    this.apiUrl = apiUrl;
    this.api = axios.create({
      baseURL: apiUrl,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000, // 增加到60秒，因为分析可能需要更长时间
    });
  }

  /**
   * 发送聊天请求（重载：支持字符串 prompt 或 messages 数组）
   */
  async chat(prompt: string): Promise<string>;
  async chat(
    messages: DeepSeekMessage[],
    options?: { temperature?: number; maxTokens?: number }
  ): Promise<DeepSeekResponse>;
  async chat(
    messagesOrPrompt: DeepSeekMessage[] | string,
    options?: { temperature?: number; maxTokens?: number }
  ): Promise<DeepSeekResponse | string> {
    // 如果传入的是字符串，转换为 messages
    if (typeof messagesOrPrompt === 'string') {
      const messages: DeepSeekMessage[] = [
        { role: 'system', content: SQUEEZE_SYSTEM_PROMPT },
        { role: 'user', content: messagesOrPrompt },
      ];
      const response = await this.chatInternal(messages, options);
      return response.content;
    }

    return this.chatInternal(messagesOrPrompt, options);
  }

  /**
   * 内部聊天方法
   */
  private async chatInternal(
    messages: DeepSeekMessage[],
    options?: { temperature?: number; maxTokens?: number }
  ): Promise<DeepSeekResponse> {
    try {
      const response = await this.api.post('', {
        model: 'deepseek-chat',
        messages,
        temperature: options?.temperature ?? 0.7,
        max_tokens: options?.maxTokens ?? 2000,
      });

      const content = response.data?.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('DeepSeek API 返回空内容');
      }

      return {
        content,
        usage: response.data?.usage,
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        
        // 处理 HTTP 状态码错误
        if (axiosError.response?.status === 401) {
          logger.error('DeepSeek API 鉴权失败，请检查 API Key');
          throw new Error('AI 分析服务鉴权失败');
        } else if (axiosError.response?.status === 429) {
          logger.error('DeepSeek API 请求频率超限');
          throw new Error('AI 分析服务请求过于频繁，请稍后重试');
        }
        
        // 处理网络错误（连接重置、超时等）
        if (axiosError.code === 'ECONNRESET' || 
            axiosError.code === 'ETIMEDOUT' || 
            axiosError.code === 'ECONNABORTED' ||
            axiosError.message?.includes('aborted') ||
            axiosError.message?.includes('timeout')) {
          logger.warn({ 
            code: axiosError.code, 
            message: axiosError.message 
          }, 'DeepSeek API 网络连接错误，将重试');
          throw new Error('网络连接错误，请重试');
        }
      }
      
      logger.error({ 
        error,
        errorType: error instanceof Error ? error.constructor.name : typeof error,
        errorMessage: error instanceof Error ? error.message : String(error)
      }, 'DeepSeek API Error');
      
      throw new Error('AI 分析失败，请稍后重试');
    }
  }

  /**
   * 使用 Prompt 模板生成分析
   */
  async analyzeWithPrompt(
    systemPrompt: string,
    userPrompt: string,
    options?: { temperature?: number; maxTokens?: number }
  ): Promise<string> {
    const messages: DeepSeekMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const response = await this.chatInternal(messages, options);
    return response.content;
  }
}
