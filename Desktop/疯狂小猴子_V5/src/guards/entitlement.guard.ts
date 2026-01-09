import { UserRepository } from '../repositories/user.repository';
import { logger } from '../utils/logger';

/**
 * 权限守卫 - 检查用户是否已解锁
 */
export class EntitlementGuard {
  constructor(private userRepo: UserRepository) {}

  /**
   * 检查用户是否已解锁
   */
  isUnlocked(userId: number): boolean {
    return this.userRepo.isUnlocked(userId);
  }

  /**
   * 要求解锁，如果未解锁则抛出错误
   */
  requireUnlocked(userId: number): void {
    if (!this.isUnlocked(userId)) {
      logger.warn({ userId }, 'Access denied: user not unlocked');
      throw new Error('UNLOCK_REQUIRED');
    }
  }

  /**
   * 解锁用户（通过 Stars 支付）
   */
  unlockByStars(userId: number): void {
    this.userRepo.unlockUser(userId, 'stars');
    logger.info({ userId }, 'User unlocked by Stars');
  }

  /**
   * 解锁用户（通过邀请码）
   */
  unlockByInviteCode(userId: number): void {
    this.userRepo.unlockUser(userId, 'invite');
    logger.info({ userId }, 'User unlocked by invite code');
  }
}

