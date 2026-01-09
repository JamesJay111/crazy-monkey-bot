import { Context } from 'telegraf';
import { userStateManager } from '../state/user.state';

/**
 * 付费服务
 * 处理 Telegram Stars 支付和邀请码验证
 */
export class PaymentService {
  private starsAmount: number;
  private inviteCode: string;

  constructor(starsAmount: number = 2999, inviteCode: string = 'Ocean001') {
    this.starsAmount = starsAmount;
    this.inviteCode = inviteCode;
  }

  /**
   * 检查用户是否已解锁
   */
  isUnlocked(userId: number): boolean {
    return userStateManager.isUserUnlocked(userId);
  }

  /**
   * 验证邀请码
   */
  validateInviteCode(code: string): boolean {
    return code.trim() === this.inviteCode;
  }

  /**
   * 通过邀请码解锁
   */
  unlockByInviteCode(userId: number, code: string): boolean {
    if (this.validateInviteCode(code)) {
      userStateManager.unlockUser(userId, 'invite');
      return true;
    }
    return false;
  }

  /**
   * 通过 Stars 解锁（需要处理支付回调）
   */
  async unlockByStars(ctx: Context, userId: number): Promise<void> {
    // 发送 Stars 支付请求
    await ctx.reply(
      `💎 解锁全部功能需要 ${this.starsAmount} Stars\n\n` +
      `点击下方按钮完成支付：`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: `💎 支付 ${this.starsAmount} Stars`,
                pay: true,
              },
            ],
            [
              {
                text: '❌ 取消',
                callback_data: 'cancel_payment',
              },
            ],
          ],
        },
      }
    );
  }

  /**
   * 处理支付成功回调
   */
  handlePaymentSuccess(userId: number): void {
    userStateManager.unlockUser(userId, 'stars');
  }

  /**
   * 获取解锁提示消息
   */
  getUnlockMessage(): string {
    return `🔒 此功能需要解锁\n\n` +
      `解锁方式：\n` +
      `1. 支付 ${this.starsAmount} Stars（终身解锁）\n` +
      `2. 输入邀请码免费体验\n\n` +
      `选择解锁方式：`;
  }

  /**
   * 获取解锁按钮
   */
  getUnlockKeyboard() {
    return {
      inline_keyboard: [
        [
          {
            text: `💎 支付 ${this.starsAmount} Stars`,
            callback_data: 'unlock_stars',
          },
        ],
        [
          {
            text: '🎫 输入邀请码',
            callback_data: 'unlock_invite',
          },
        ],
        [
          {
            text: '❌ 取消',
            callback_data: 'cancel_unlock',
          },
        ],
      ],
    };
  }
}

