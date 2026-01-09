import axios, { AxiosInstance } from 'axios';

/**
 * DeepSeek API 服务
 * 只用于将 CoinGlass 数据转换为可读的交易行为解释
 */
export class DeepSeekService {
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
      timeout: 30000,
    });
  }

  /**
   * 分析轧空结构
   */
  async analyzeShortSqueeze(data: any): Promise<string> {
    const prompt = `你是一名资深的合约交易行为分析师。基于以下 CoinGlass 返回的合约数据，请判断是否构成典型的 short squeeze（轧空）结构，并说明依据。

**重要约束：**
1. 不要预测价格
2. 只分析结构性的市场行为
3. 所有判断必须基于提供的数据
4. 如果数据不足，明确说明

**分析维度：**
1. OI 变化模式（是否先降后升）
2. 多空比变化（是否从低位快速反转）
3. 价格与 OI 的背离关系
4. 资金费率变化
5. 成交量特征

**数据：**
${JSON.stringify(data, null, 2)}

请用中文输出分析结果，格式如下：
## 结构判断
[是否构成轧空结构]

## 依据分析
[详细说明各项指标的表现]

## 风险提示
[如果数据不足或存在不确定性，请说明]`;

    return await this.callDeepSeek(prompt);
  }

  /**
   * 分析单个 Ticker 的合约状态
   */
  async analyzeTickerStatus(data: any): Promise<string> {
    const prompt = `你是一名资深的合约交易行为分析师。基于以下 CoinGlass 返回的合约数据，请对 ${data.symbol} 的当前合约状态进行总结性分析。

**重要约束：**
1. 不要预测价格
2. 只分析当前的市场结构状态
3. 所有判断必须基于提供的数据
4. 如果数据不可用，明确说明

**分析维度：**
1. 当前 OI 水平及变化趋势
2. 资金费率是否异常
3. 多空比结构
4. 基差情况（如果有）
5. 整体市场结构判断

**数据：**
${JSON.stringify(data, null, 2)}

请用中文输出分析结果，格式如下：
## 合约状态总结
[简要总结]

## 关键指标
[列出关键数据点]

## 结构判断
[市场结构是否发生变化，如何变化]

## 注意事项
[数据限制或风险提示]`;

    return await this.callDeepSeek(prompt);
  }

  /**
   * 分析 ETF 资金流
   */
  async analyzeETF(data: any): Promise<string> {
    const prompt = `你是一名资深的 ETF 资金流分析师。基于以下 CoinGlass 返回的 ETF 数据，请分析资金流向的意义。

**重要约束：**
1. 不要预测价格
2. 只分析资金流的市场含义
3. 所有判断必须基于提供的数据

**数据：**
${JSON.stringify(data, null, 2)}

请用中文输出分析结果，格式如下：
## 资金流总结
[净流入/流出情况]

## 市场含义
[资金流变化的市场意义]

## 历史对比
[如果有历史数据，进行对比分析]`;

    return await this.callDeepSeek(prompt);
  }

  /**
   * 调用 DeepSeek API
   */
  private async callDeepSeek(prompt: string): Promise<string> {
    try {
      const response = await this.api.post('', {
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: '你是一名专业的合约交易行为分析师，擅长通过 OI、资金费率、多空比等指标判断市场结构变化。你从不预测价格，只分析结构性的交易行为。',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.7,
        max_tokens: 2000,
      });

      const content = response.data?.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('DeepSeek API 返回空内容');
      }

      return content;
    } catch (error: any) {
      console.error('DeepSeek API Error:', error.message);
      throw new Error(`AI 分析失败: ${error.message}`);
    }
  }
}

