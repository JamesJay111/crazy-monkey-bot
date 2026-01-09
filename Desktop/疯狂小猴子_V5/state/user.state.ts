import { UserData, UserState } from '../types';

/**
 * 用户状态管理
 * 简单的内存存储（生产环境应使用 Redis 或数据库）
 */
export class UserStateManager {
  private users: Map<number, UserData> = new Map();

  /**
   * 获取用户数据
   */
  getUser(userId: number): UserData {
    if (!this.users.has(userId)) {
      this.users.set(userId, {
        userId,
        isUnlocked: false,
        currentState: UserState.IDLE,
        context: {},
      });
    }
    return this.users.get(userId)!;
  }

  /**
   * 更新用户状态
   */
  setUserState(userId: number, state: UserState, context?: Record<string, any>): void {
    const user = this.getUser(userId);
    user.currentState = state;
    if (context) {
      user.context = { ...user.context, ...context };
    }
    this.users.set(userId, user);
  }

  /**
   * 重置用户状态
   */
  resetUserState(userId: number): void {
    const user = this.getUser(userId);
    user.currentState = UserState.IDLE;
    user.context = {};
    this.users.set(userId, user);
  }

  /**
   * 解锁用户
   */
  unlockUser(userId: number, method: 'stars' | 'invite'): void {
    const user = this.getUser(userId);
    user.isUnlocked = true;
    user.unlockMethod = method;
    user.unlockTime = Date.now();
    this.users.set(userId, user);
  }

  /**
   * 检查用户是否已解锁
   */
  isUserUnlocked(userId: number): boolean {
    return this.getUser(userId).isUnlocked;
  }

  /**
   * 设置用户上下文
   */
  setUserContext(userId: number, context: Record<string, any>): void {
    const user = this.getUser(userId);
    user.context = { ...user.context, ...context };
    this.users.set(userId, user);
  }

  /**
   * 获取用户上下文
   */
  getUserContext(userId: number): Record<string, any> {
    return this.getUser(userId).context || {};
  }
}

export const userStateManager = new UserStateManager();

