import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';
import { v4 as uuidv4 } from 'uuid';
import { logger } from './logger';
import { withRetry } from './retry';

/**
 * HTTP 错误
 */
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    public errorMessage: string,
    public traceId: string,
    public rawResponse?: any
  ) {
    super(errorMessage);
    this.name = 'HttpError';
  }
}

/**
 * HTTP 客户端配置
 */
export interface HttpClientConfig {
  baseURL: string;
  apiKey: string;
  timeout: number;
  maxRetries: number;
}

/**
 * 请求选项
 */
export interface RequestOptions {
  signal?: AbortSignal;
  skipRetry?: boolean;
}

/**
 * HTTP 响应（包含响应头）
 */
export interface HttpResponse<T> {
  data: T;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * HTTP 客户端
 */
export class HttpClient {
  constructor(private config: HttpClientConfig) {}

  /**
   * 通用请求方法（返回数据和响应头）
   */
  async requestWithHeaders<T>(
    path: string,
    params?: Record<string, string | number | boolean>,
    options: RequestOptions = {}
  ): Promise<HttpResponse<T>> {
    const traceId = uuidv4();
    const url = `${this.config.baseURL}${path}`;

    const requestConfig: AxiosRequestConfig = {
      url,
      method: 'GET',
      params,
      headers: {
        'accept': 'application/json',
        'CG-API-KEY': this.config.apiKey,
      },
      timeout: this.config.timeout,
      signal: options.signal,
    };

    logger.debug({ traceId, url, params }, 'HTTP Request');

    const makeRequest = async (): Promise<AxiosResponse<T>> => {
      try {
        const response = await axios.request<T>(requestConfig);
        return response;
      } catch (error) {
        if (axios.isAxiosError(error)) {
          const axiosError = error as AxiosError;
          
          // 记录错误
          logger.error({
            traceId,
            status: axiosError.response?.status,
            statusText: axiosError.response?.statusText,
            message: axiosError.message,
            url,
          }, 'HTTP Request Error');

          // 401/403: API Key 错误
          if (axiosError.response?.status === 401 || axiosError.response?.status === 403) {
            throw new HttpError(
              axiosError.response.status,
              'CoinGlass API 鉴权失败，请检查 API Key',
              traceId,
              axiosError.response.data
            );
          }

          // 429: 限流
          if (axiosError.response?.status === 429) {
            // 将响应头也传递给 HttpError，以便提取 Retry-After
            const responseData = axiosError.response.data && typeof axiosError.response.data === 'object' 
              ? axiosError.response.data 
              : { data: axiosError.response.data };
            throw new HttpError(
              429,
              'CoinGlass API 请求频率超限，请稍后重试',
              traceId,
              {
                ...responseData,
                headers: axiosError.response.headers,
              }
            );
          }

          // 其他 HTTP 错误
          if (axiosError.response) {
            const errorMsg = (axiosError.response.data as any)?.msg || axiosError.message;
            throw new HttpError(
              axiosError.response.status,
              errorMsg,
              traceId,
              axiosError.response.data
            );
          }

          // 网络错误
          throw new HttpError(
            0,
            `网络错误: ${axiosError.message}`,
            traceId
          );
        }

        throw new HttpError(0, String(error), traceId);
      }
    };

    try {
      // 如果需要重试
      if (!options.skipRetry) {
        const response = await withRetry(makeRequest, {
          maxRetries: this.config.maxRetries,
          retryable: (error) => {
            // 只对网络错误、5xx、429 重试
            if (error instanceof HttpError) {
              return error.statusCode === 0 || 
                     (error.statusCode >= 500 && error.statusCode < 600) ||
                     error.statusCode === 429;
            }
            return false;
          },
        });

        logger.debug({ traceId, status: response.status }, 'HTTP Request Success');
        
        return {
          data: response.data,
          headers: response.headers as Record<string, string | string[] | undefined>,
        };
      } else {
        const response = await makeRequest();
        return {
          data: response.data,
          headers: response.headers as Record<string, string | string[] | undefined>,
        };
      }
    } catch (error) {
      if (error instanceof HttpError) {
        throw error;
      }
      throw new HttpError(0, String(error), traceId);
    }
  }

  /**
   * 通用请求方法（仅返回数据，兼容旧接口）
   */
  async request<T>(
    path: string,
    params?: Record<string, string | number | boolean>,
    options: RequestOptions = {}
  ): Promise<T> {
    const response = await this.requestWithHeaders<T>(path, params, options);
    return response.data;
  }
}
