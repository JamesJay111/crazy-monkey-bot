import { Bot, InlineKeyboard } from 'grammy';
import { SqueezeCacheItem } from './squeezeCache.service';
import { squeezeLabelEngine } from './squeezeLabelEngine.service';
import { squeezeRiskEngine } from './squeezeRiskEngine.service';
import { strategyChannelEngine, SqueezeEvent } from './strategyChannelEngine.service';
import { SubscriptionService } from './subscriptionService.service';
import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 推送触发类型
 */
export type PushTriggerType = 'NEW_ENTRY' | 'SCORE_JUMP' | 'REVERSAL_EVENT';

/**
 * 推送候选
 */
interface PushCandidate {
  ticker: string;
  type: PushTriggerType;
  priority: number; // 1: 最高（多空反转）, 2: 中（新强信号）, 3: 低（强度升级）
  oldItem?: SqueezeCacheItem;
  newItem: SqueezeCacheItem;
  delta?: {
    score: number;
    longPercent?: number;
    shortPercent?: number;
    ratio?: number;
  };
}

/**
 * 推送通知状态存储
 */
interface NotificationState {
  last_notified_at: Record<string, number>; // ticker -> timestamp
  user_push_count: Record<string, { count: number; resetAt: number }>; // userId -> { count, resetAt }
}

/**
 * 庄家轧空推送服务
 * 负责检测结构异动并发送推送
 */
export class SqueezePushService {
  private readonly COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4小时冷却
  private readonly STRONG_THRESHOLD = 8; // 强信号阈值
  private readonly MAX_PUSHES_PER_SCAN = 3; // 单次扫描最多推送3条
  private readonly MAX_PUSHES_PER_USER = 3; // 单用户4h内最多推送3条（G7）
  private readonly USER_PUSH_WINDOW_MS = 4 * 60 * 60 * 1000; // 4小时窗口
  private readonly stateFilePath: string;
  private notificationState: NotificationState;

  constructor(
    private bot: Bot,
    private subscriptionService: SubscriptionService,
    stateDir: string = './cache'
  ) {
    // 确保目录存在
    if (!fs.existsSync(stateDir)) {
      fs.mkdirSync(stateDir, { recursive: true });
    }
    this.stateFilePath = path.join(stateDir, 'squeeze_push_state.json');
    this.notificationState = this.loadState();
  }

  /**
   * 检测并推送结构异动
   * 在 onSqueezeListUpdated hook 中调用
   */
  async detectAndPush(oldList: SqueezeCacheItem[], newList: SqueezeCacheItem[]): Promise<void> {
    try {
      // 检测触发条件
      const candidates = this.detectTriggers(oldList, newList);
      
      if (candidates.length === 0) {
        logger.debug('No push candidates detected');
        return;
      }

      // 应用冷却和去重
      const filteredCandidates = this.applyCooldown(candidates);
      
      if (filteredCandidates.length === 0) {
        logger.debug('All candidates filtered by cooldown');
        return;
      }

      // 按优先级排序，取前N条
      const sortedCandidates = filteredCandidates
        .sort((a, b) => a.priority - b.priority)
        .slice(0, this.MAX_PUSHES_PER_SCAN);

      // 推送消息（集成频道匹配和订阅分发，G4）
      for (const candidate of sortedCandidates) {
        await this.sendPushWithChannelFilter(candidate);
      }

      logger.info({
        totalCandidates: candidates.length,
        filteredCount: filteredCandidates.length,
        pushedCount: sortedCandidates.length,
        pushedTickers: sortedCandidates.map(c => c.ticker),
      }, 'Squeeze push completed');

    } catch (error) {
      logger.error({ error }, 'Failed to detect and push squeeze alerts');
      // 不影响后续扫描
    }
  }

  /**
   * 检测触发条件
   */
  private detectTriggers(oldList: SqueezeCacheItem[], newList: SqueezeCacheItem[]): PushCandidate[] {
    const candidates: PushCandidate[] = [];
    const oldMap = new Map(oldList.map(item => [item.ticker, item]));

    for (const newItem of newList) {
      const oldItem = oldMap.get(newItem.ticker);

      // D2.1 新出现的强结构信号（NEW ENTRY）
      if (!oldItem && newItem.score >= this.STRONG_THRESHOLD) {
        candidates.push({
          ticker: newItem.ticker,
          type: 'NEW_ENTRY',
          priority: 2,
          newItem,
        });
      }

      // D2.2 结构强度显著升级（SCORE JUMP）
      if (oldItem) {
        const scoreDelta = newItem.score - oldItem.score;
        if (scoreDelta >= 4 && newItem.score >= this.STRONG_THRESHOLD) {
          candidates.push({
            ticker: newItem.ticker,
            type: 'SCORE_JUMP',
            priority: 3,
            oldItem,
            newItem,
            delta: { score: scoreDelta },
          });
        }
      }

      // D2.3 多空反转信号出现（REVERSAL EVENT）
      if (newItem.signal.reversal && newItem.signal.reversal !== 'none') {
        const isReversal =
          !oldItem ||
          !oldItem.signal.reversal ||
          oldItem.signal.reversal === 'none' ||
          oldItem.signal.reversal !== newItem.signal.reversal;

        if (isReversal) {
          candidates.push({
            ticker: newItem.ticker,
            type: 'REVERSAL_EVENT',
            priority: 1, // 最高优先级
            oldItem,
            newItem,
          });
        }
      }
    }

    return candidates;
  }

  /**
   * 应用冷却时间
   */
  private applyCooldown(candidates: PushCandidate[]): PushCandidate[] {
    const now = Date.now();
    return candidates.filter(candidate => {
      const lastNotified = this.notificationState.last_notified_at[candidate.ticker] || 0;
      const age = now - lastNotified;
      
      if (age < this.COOLDOWN_MS) {
        logger.debug({ ticker: candidate.ticker, ageHours: age / (60 * 60 * 1000) }, 'Ticker in cooldown');
        return false;
      }
      
      return true;
    });
  }

  /**
   * 发送推送消息（集成频道匹配和订阅分发，G4）
   */
  private async sendPushWithChannelFilter(candidate: PushCandidate): Promise<void> {
    try {
      // 生成标签和风险信息
      const label = squeezeLabelEngine.generatePushTitleLabel(candidate.newItem);
      const risk = squeezeRiskEngine.evaluateFromCacheItem(candidate.newItem);

      // 构建事件对象
      const event: SqueezeEvent = strategyChannelEngine.buildEventFromCacheItem(
        candidate.newItem,
        label,
        risk
      );

      // 匹配频道（G2.2）
      const matchedChannels = strategyChannelEngine.matchChannels(event);

      if (matchedChannels.length === 0) {
        logger.debug({ ticker: candidate.ticker }, 'Event matches no channels, skipping');
        return;
      }

      // 获取所有订阅了匹配频道的用户（G4）
      const subscribedUserIds = this.subscriptionService.getUsersSubscribedToChannels(matchedChannels);

      if (subscribedUserIds.length === 0) {
        logger.debug({ ticker: candidate.ticker, matchedChannels }, 'No users subscribed to matched channels');
        return;
      }

      // 格式化推送消息（包含频道信息，G5）
      const message = this.formatPushMessageWithChannels(candidate, matchedChannels, label, risk);

      // 发送给订阅用户（应用防骚扰规则，G7）
      // 按频道优先级排序用户推送（确保高优先级事件先推送）
      const sortedChannels = strategyChannelEngine.sortChannelsByPriority(matchedChannels);
      
      for (const userId of subscribedUserIds) {
        // 检查用户推送限额（传入匹配的频道用于优先级判断）
        if (!this.canPushToUser(userId, candidate.ticker, matchedChannels)) {
          logger.debug({ userId, ticker: candidate.ticker, matchedChannels }, 'User push limit reached, skipping');
          continue;
        }

        try {
          const keyboard = new InlineKeyboard()
            .text('🔍 查看结构详情', `squeeze_detail_${candidate.ticker}`);

          await this.bot.api.sendMessage(userId, message, {
            reply_markup: keyboard,
            parse_mode: 'Markdown',
          });

          // 更新通知状态（包含ticker级别的冷却和用户级别的计数）
          this.recordUserPush(userId, candidate.ticker);
          this.saveState();

          logger.info({
            userId,
            ticker: candidate.ticker,
            type: candidate.type,
            matchedChannels,
          }, 'Push sent with channel filter');
        } catch (error: any) {
          // 处理用户屏蔽Bot等情况
          if (error.error_code === 403) {
            logger.warn({ userId, ticker: candidate.ticker }, 'User blocked bot');
          } else {
            logger.warn({ error, userId, ticker: candidate.ticker }, 'Failed to send push to user');
          }
        }
      }
    } catch (error) {
      logger.error({ error, ticker: candidate.ticker }, 'Failed to send push with channel filter');
      // 不影响后续推送
    }
  }

  /**
   * 发送推送消息（旧方法，保留用于兼容）
   */
  private async sendPush(candidate: PushCandidate): Promise<void> {
    try {
      const message = this.formatPushMessage(candidate);
      const keyboard = new InlineKeyboard()
        .text('🔍 查看结构详情', `squeeze_detail_${candidate.ticker}`);

      // 这个方法已废弃，使用 sendPushWithChannelFilter 代替
      logger.warn('sendPush called, but should use sendPushWithChannelFilter');

    } catch (error) {
      logger.error({ error, ticker: candidate.ticker }, 'Failed to send push');
      // 不影响后续推送
    }
  }

  /**
   * 格式化推送消息（固定模板）
   */
  private formatPushMessage(candidate: PushCandidate): string {
    const { ticker, type, oldItem, newItem, delta } = candidate;
    
    // 构建结构变化描述
    let changeDesc = '';
    let strengthDesc = '';
    
    if (type === 'REVERSAL_EVENT') {
      if (newItem.signal.reversal === 'short_to_long') {
        changeDesc = '空→多';
      } else if (newItem.signal.reversal === 'long_to_short') {
        changeDesc = '多→空';
      }
      strengthDesc = this.getStrengthText(newItem.signal.reversal_strength);
    } else if (type === 'NEW_ENTRY') {
      changeDesc = '强化';
      strengthDesc = '强';
    } else if (type === 'SCORE_JUMP') {
      changeDesc = '强化';
      strengthDesc = this.getStrengthText(newItem.signal.reversal_strength);
    }

    // 构建主要依据
    let basisText = '';
    
    // 根据信号类型显示详细信息
    if (type === 'REVERSAL_EVENT' && newItem.signal.reversal) {
      // 多空反转：显示反转方向和强度
      const reversalText = newItem.signal.reversal === 'short_to_long' ? '空→多反转' : '多→空反转';
      basisText += `• ${reversalText}（${strengthDesc}）\n`;
      
      if (newItem.signal.position_bias) {
        const biasText = newItem.signal.position_bias === 'long_stronger' ? '多头加速' : 
                        newItem.signal.position_bias === 'short_stronger' ? '空头加速' : '均衡';
        basisText += `• 持仓倾向：${biasText}\n`;
      }
    } else if (type === 'NEW_ENTRY') {
      // 新强信号
      basisText += `• 首次出现强结构信号\n`;
      if (newItem.signal.position_bias) {
        const biasText = newItem.signal.position_bias === 'long_stronger' ? '多头加速' : 
                        newItem.signal.position_bias === 'short_stronger' ? '空头加速' : '均衡';
        basisText += `• 持仓倾向：${biasText}\n`;
      }
    } else if (type === 'SCORE_JUMP') {
      // 强度升级
      basisText += `• 结构强度显著提升\n`;
      if (newItem.signal.position_bias) {
        const biasText = newItem.signal.position_bias === 'long_stronger' ? '多头加速' : 
                        newItem.signal.position_bias === 'short_stronger' ? '空头加速' : '均衡';
        basisText += `• 持仓倾向：${biasText}\n`;
      }
    } else {
      // 默认显示
      basisText += `• 结构信号强度：${strengthDesc}\n`;
      if (newItem.signal.position_bias) {
        const biasText = newItem.signal.position_bias === 'long_stronger' ? '多头加速' : 
                        newItem.signal.position_bias === 'short_stronger' ? '空头加速' : '均衡';
        basisText += `• 持仓倾向：${biasText}\n`;
      }
    }

    // 这个方法已废弃，使用 formatPushMessageWithChannels 代替
    return '';
  }

  /**
   * 格式化推送消息（包含频道信息，G5）
   */
  private formatPushMessageWithChannels(
    candidate: PushCandidate,
    matchedChannels: string[],
    titleLabel: string,
    risk: any
  ): string {
    const { ticker, type, newItem, oldItem, delta } = candidate;
    
    // 格式化频道列表（G5）
    const channelList = strategyChannelEngine.formatChannelList(matchedChannels);

    // 构建结构变化描述
    let changeDesc = '';
    let strengthDesc = '';
    
    if (type === 'REVERSAL_EVENT') {
      if (newItem.signal.reversal === 'short_to_long') {
        changeDesc = '空→多';
      } else if (newItem.signal.reversal === 'long_to_short') {
        changeDesc = '多→空';
      }
      strengthDesc = this.getStrengthText(newItem.signal.reversal_strength);
    } else if (type === 'NEW_ENTRY') {
      changeDesc = '强化';
      strengthDesc = '强';
    } else if (type === 'SCORE_JUMP') {
      changeDesc = '强化';
      strengthDesc = this.getStrengthText(newItem.signal.reversal_strength);
    }

    // 构建主要依据
    let basisText = '';
    
    // 根据信号类型显示详细信息
    if (type === 'REVERSAL_EVENT' && newItem.signal.reversal) {
      // 多空反转：显示反转方向和强度
      const reversalText = newItem.signal.reversal === 'short_to_long' ? '空→多反转' : '多→空反转';
      basisText += `• ${reversalText}（${strengthDesc}）\n`;
      
      if (newItem.signal.position_bias) {
        const biasText = newItem.signal.position_bias === 'long_stronger' ? '多头加速' : 
                        newItem.signal.position_bias === 'short_stronger' ? '空头加速' : '均衡';
        basisText += `• 持仓倾向：${biasText}\n`;
      }
    } else if (type === 'NEW_ENTRY') {
      // 新强信号
      basisText += `• 首次出现强结构信号\n`;
      if (newItem.signal.position_bias) {
        const biasText = newItem.signal.position_bias === 'long_stronger' ? '多头加速' : 
                        newItem.signal.position_bias === 'short_stronger' ? '空头加速' : '均衡';
        basisText += `• 持仓倾向：${biasText}\n`;
      }
    } else if (type === 'SCORE_JUMP') {
      // 强度升级
      basisText += `• 结构强度显著提升\n`;
      if (newItem.signal.position_bias) {
        const biasText = newItem.signal.position_bias === 'long_stronger' ? '多头加速' : 
                        newItem.signal.position_bias === 'short_stronger' ? '空头加速' : '均衡';
        basisText += `• 持仓倾向：${biasText}\n`;
      }
    } else {
      // 默认显示
      basisText += `• 结构信号强度：${strengthDesc}\n`;
      if (newItem.signal.position_bias) {
        const biasText = newItem.signal.position_bias === 'long_stronger' ? '多头加速' : 
                        newItem.signal.position_bias === 'short_stronger' ? '空头加速' : '均衡';
        basisText += `• 持仓倾向：${biasText}\n`;
      }
    }

    // 使用 Risk Engine 生成风险&可信度（F5.2：自动推送克制格式）
    const riskDisplay = squeezeRiskEngine.generatePushDisplay(newItem);

    // 构建完整消息（G5：频道感知版）
    let message = `🧨 结构异动｜${ticker}
${titleLabel}`;

    // 添加频道信息
    if (channelList) {
      message += `\n\n命中频道：${channelList}`;
    }

    message += `\n\n- 结构变化：${changeDesc}
- 强度等级：${strengthDesc}
- 主要依据：
${basisText}
${riskDisplay}

点击查看完整结构分析 👇`;

    return message;
  }

  /**
   * 获取强度文本
   */
  private getStrengthText(strength?: 'weak' | 'medium' | 'strong'): string {
    switch (strength) {
      case 'strong':
        return '强';
      case 'medium':
        return '中';
      case 'weak':
        return '弱';
      default:
        return '中';
    }
  }


  /**
   * 检查是否可以推送给用户（防骚扰规则，G7）
   * 单用户4h内最多3条推送
   * 若超过：按优先级丢弃（强结构反转 > 高风险挤压 > 高可信结构 > 其他）
   */
  private canPushToUser(userId: number, ticker: string, matchedChannels: string[]): boolean {
    const userKey = userId.toString();
    const now = Date.now();

    // 检查ticker级别冷却（4小时）- 同一事件对同一用户只推送一次（G4）
    const tickerKey = `${userId}:${ticker}`;
    const lastNotified = this.notificationState.last_notified_at[tickerKey] || 0;
    if (now - lastNotified < this.COOLDOWN_MS) {
      return false;
    }

    // 检查用户推送计数
    const userPushInfo = this.notificationState.user_push_count[userKey];
    if (!userPushInfo) {
      return true; // 首次推送
    }

    // 检查窗口是否过期（4小时）
    if (now >= userPushInfo.resetAt) {
      return true; // 窗口过期，重置
    }

    // 检查是否超过限额
    if (userPushInfo.count >= this.MAX_PUSHES_PER_USER) {
      // G7：按优先级丢弃
      // 如果当前事件的最高优先级频道优先级较低，则丢弃
      const sortedChannels = strategyChannelEngine.sortChannelsByPriority(matchedChannels);
      if (sortedChannels.length > 0) {
        const currentPriority = strategyChannelEngine.getChannelPriority(sortedChannels[0]);
        // 优先级 > 3 的事件会被丢弃（如果已达到限额）
        if (currentPriority > 3) {
          return false;
        }
      }
      return false; // 超过限额
    }

    return true;
  }

  /**
   * 记录用户推送（G7）
   */
  private recordUserPush(userId: number, ticker: string): void {
    const userKey = userId.toString();
    const tickerKey = `${userId}:${ticker}`;
    const now = Date.now();

    // 更新ticker级别冷却
    this.notificationState.last_notified_at[tickerKey] = now;

    // 更新用户推送计数
    const userPushInfo = this.notificationState.user_push_count[userKey];
    if (!userPushInfo || now >= userPushInfo.resetAt) {
      // 首次推送或窗口过期，重置计数
      this.notificationState.user_push_count[userKey] = {
        count: 1,
        resetAt: now + this.USER_PUSH_WINDOW_MS,
      };
    } else {
      // 增加计数
      userPushInfo.count += 1;
    }
  }

  /**
   * 加载通知状态
   */
  private loadState(): NotificationState {
    try {
      if (!fs.existsSync(this.stateFilePath)) {
        return {
          last_notified_at: {},
          user_push_count: {},
        };
      }

      const content = fs.readFileSync(this.stateFilePath, 'utf-8');
      const state = JSON.parse(content) as NotificationState;
      
      // 清理过期的通知记录（超过7天）
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const cleaned: Record<string, number> = {};
      for (const [key, timestamp] of Object.entries(state.last_notified_at || {})) {
        if (timestamp > sevenDaysAgo) {
          cleaned[key] = timestamp;
        }
      }
      state.last_notified_at = cleaned;

      // 清理过期的用户推送计数（超过4小时窗口）
      const now = Date.now();
      const cleanedUserCount: Record<string, { count: number; resetAt: number }> = {};
      for (const [userKey, pushInfo] of Object.entries(state.user_push_count || {})) {
        if (now < pushInfo.resetAt) {
          cleanedUserCount[userKey] = pushInfo;
        }
      }
      state.user_push_count = cleanedUserCount;

      // 确保有 user_push_count 字段
      if (!state.user_push_count) {
        state.user_push_count = {};
      }

      return state;
    } catch (error) {
      logger.warn({ error }, 'Failed to load push state, using empty state');
      return {
        last_notified_at: {},
        user_push_count: {},
      };
    }
  }

  /**
   * 保存通知状态
   */
  private saveState(): void {
    try {
      fs.writeFileSync(this.stateFilePath, JSON.stringify(this.notificationState, null, 2), 'utf-8');
    } catch (error) {
      logger.warn({ error }, 'Failed to save push state');
    }
  }
}

