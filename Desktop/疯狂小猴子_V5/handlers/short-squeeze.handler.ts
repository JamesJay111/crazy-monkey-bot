import { Context } from 'telegraf';
import { CoinGlassService } from '../services/coinglass.service';
import { DeepSeekService } from '../services/deepseek.service';
import { PaymentService } from '../payment/payment.service';
import { userStateManager } from '../state/user.state';
import { UserState } from '../types';

/**
 * 轧空判断功能处理器
 * 
 * 判断逻辑（写入代码注释，不可省略）：
 * 
 * 轧空是 多指标同时成立的结构性行为：
 * 1. 空头积累充分
 * 2. OI 上升
 * 3. 空头持仓比高
 * 4. 价格逆势启动
 * 5. 主动买量上升
 * 6. 基差扩大
 * 7. 多空信号反转
 * 8. 多空比从低位快速反转
 * 
 * 典型节奏：
 * - OI 先下降（杠杆清洗）
 * - 随后快速回升（新杠杆入场）
 * 
 * 大户行为：
 * - 大户多空比如 0.3 → 1.5 快速变化
 * 
 * 基差：
 * - 合约价格明显高于现货（例如 +1% 以上）
 */
export class ShortSqueezeHandler {
  constructor(
    private coinglass: CoinGlassService,
    private deepseek: DeepSeekService,
    private payment: PaymentService
  ) {}

  /**
   * 显示轧空候选列表
   */
  async showCandidates(ctx: Context): Promise<void> {
    try {
      await ctx.reply('🔍 正在扫描过去 30 天的轧空结构...');

      const candidates = await this.coinglass.detectShortSqueezeCandidates();

      if (candidates.length === 0) {
        await ctx.reply('📊 过去 30 天内未检测到明显的轧空结构。');
        return;
      }

      let message = `📊 过去 30 天内可能出现过轧空结构的项目：\n\n`;
      candidates.forEach((symbol, index) => {
        message += `${index + 1}. ${symbol}\n`;
      });

      message += `\n👉 选择要查看详细分析的项目：`;

      const keyboard = {
        inline_keyboard: [
          ...candidates.map(symbol => [
            {
              text: `📈 ${symbol}`,
              callback_data: `squeeze_detail_${symbol}`,
            },
          ]),
          [
            {
              text: '🔄 检查当前是否存在类似结构',
              callback_data: 'squeeze_current',
            },
          ],
          [
            {
              text: '🔙 返回主菜单',
              callback_data: 'main_menu',
            },
          ],
        ],
      };

      await ctx.reply(message, { reply_markup: keyboard });
    } catch (error: any) {
      await ctx.reply(`❌ 错误: ${error.message}`);
    }
  }

  /**
   * 显示详细分析（需要解锁）
   */
  async showDetail(ctx: Context, symbol: string): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) return;

    // 检查是否已解锁
    if (!this.payment.isUnlocked(userId)) {
      await ctx.reply(this.payment.getUnlockMessage(), {
        reply_markup: this.payment.getUnlockKeyboard(),
      });
      userStateManager.setUserContext(userId, { pendingAction: 'squeeze_detail', symbol });
      return;
    }

    try {
      await ctx.reply(`📊 正在分析 ${symbol} 的轧空结构...`);

      // 获取 CoinGlass 数据
      const data = await this.coinglass.getShortSqueezeAnalysis(symbol);

      // 调用 DeepSeek 分析
      const analysis = await this.deepseek.analyzeShortSqueeze(data);

      const message = `📈 ${symbol} 轧空结构分析\n\n${analysis}\n\n` +
        `数据来源: CoinGlass API\n` +
        `分析引擎: DeepSeek AI`;

      await ctx.reply(message, {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🔙 返回',
                callback_data: 'squeeze_list',
              },
            ],
          ],
        },
      });
    } catch (error: any) {
      await ctx.reply(`❌ 分析失败: ${error.message}`);
    }
  }

  /**
   * 检查当前是否存在轧空结构
   */
  async checkCurrent(ctx: Context): Promise<void> {
    const userId = ctx.from?.id;
    if (!userId) return;

    if (!this.payment.isUnlocked(userId)) {
      await ctx.reply(this.payment.getUnlockMessage(), {
        reply_markup: this.payment.getUnlockKeyboard(),
      });
      userStateManager.setUserContext(userId, { pendingAction: 'squeeze_current' });
      return;
    }

    try {
      await ctx.reply('🔍 正在扫描当前市场结构...');
      // 实现当前结构检测逻辑
      await ctx.reply('📊 当前市场结构检测功能开发中...');
    } catch (error: any) {
      await ctx.reply(`❌ 错误: ${error.message}`);
    }
  }
}

