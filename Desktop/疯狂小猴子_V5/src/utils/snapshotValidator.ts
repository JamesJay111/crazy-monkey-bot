import { ContractSnapshot } from '../types';
import { logger } from './logger';
import { isFiniteNumber } from './number';

/**
 * 数据完整性校验结果
 */
export interface ValidationResult {
  isValid: boolean;
  missingFields: string[];
  invalidFields: string[];
}

/**
 * 合约快照数据校验工具
 * 用于在发送推文前确保关键字段完整有效
 */
export class SnapshotValidator {
  /**
   * 校验合约快照数据完整性
   * @param snapshot 合约快照数据
   * @returns 校验结果
   */
  static validate(snapshot: ContractSnapshot): ValidationResult {
    const missingFields: string[] = [];
    const invalidFields: string[] = [];

    // 1⃣ 校验 OI（必须 > 0 且为有限数值）
    if (!isFiniteNumber(snapshot.oiUsd) || snapshot.oiUsd <= 0) {
      if (snapshot.oiUsd === undefined || snapshot.oiUsd === null) {
        missingFields.push('oiUsd');
      } else {
        invalidFields.push('oiUsd (invalid number)');
      }
    }

    // 2⃣ 校验 Funding Rate（允许负值，但必须为有限数值，且不能有错误提示）
    if (!isFiniteNumber(snapshot.fundingRate)) {
      if (snapshot.fundingRate === undefined || snapshot.fundingRate === null) {
        missingFields.push('fundingRate');
      } else {
        invalidFields.push('fundingRate (NaN/Infinity)');
      }
    }
    // fundingRateError 视为硬失败（invalid）
    if (snapshot.fundingRateError) {
      invalidFields.push('fundingRate (has error)');
    }

    // 3⃣ 校验 Taker Buy/Sell（必须 > 0 且为有限数值）
    if (!isFiniteNumber(snapshot.takerBuyVolUsd) || snapshot.takerBuyVolUsd <= 0) {
      if (snapshot.takerBuyVolUsd === undefined || snapshot.takerBuyVolUsd === null) {
        missingFields.push('takerBuyVolUsd');
      } else {
        invalidFields.push('takerBuyVolUsd (invalid or <= 0)');
      }
    }
    if (!isFiniteNumber(snapshot.takerSellVolUsd) || snapshot.takerSellVolUsd <= 0) {
      if (snapshot.takerSellVolUsd === undefined || snapshot.takerSellVolUsd === null) {
        missingFields.push('takerSellVolUsd');
      } else {
        invalidFields.push('takerSellVolUsd (invalid or <= 0)');
      }
    }

    // 4⃣ 校验 Top Account 数据（必须 > 0 且为有限数值）
    if (!isFiniteNumber(snapshot.topAccountLongPercent) || snapshot.topAccountLongPercent <= 0) {
      if (snapshot.topAccountLongPercent === undefined || snapshot.topAccountLongPercent === null) {
        missingFields.push('topAccountLongPercent');
      } else {
        invalidFields.push('topAccountLongPercent (invalid or <= 0)');
      }
    }
    if (!isFiniteNumber(snapshot.topAccountShortPercent) || snapshot.topAccountShortPercent <= 0) {
      if (snapshot.topAccountShortPercent === undefined || snapshot.topAccountShortPercent === null) {
        missingFields.push('topAccountShortPercent');
      } else {
        invalidFields.push('topAccountShortPercent (invalid or <= 0)');
      }
    }
    if (!isFiniteNumber(snapshot.topAccountLongShortRatio) || snapshot.topAccountLongShortRatio <= 0) {
      if (snapshot.topAccountLongShortRatio === undefined || snapshot.topAccountLongShortRatio === null) {
        missingFields.push('topAccountLongShortRatio');
      } else {
        invalidFields.push('topAccountLongShortRatio (invalid or <= 0)');
      }
    }

    const isValid = missingFields.length === 0 && invalidFields.length === 0;

    if (!isValid) {
      logger.warn({
        symbol: snapshot.symbol,
        missingFields,
        invalidFields,
      }, 'Snapshot validation failed');
    }

    return {
      isValid,
      missingFields,
      invalidFields,
    };
  }

  /**
   * 检查字段是否有效（不为空、不为 "-"、为有限数值）
   */
  static isFieldValid(value: any): boolean {
    if (value === undefined || value === null) return false;
    if (typeof value === 'string' && (value.trim() === '' || value.trim() === '—' || value.trim() === '-')) return false;
    if (typeof value === 'number') {
      return isFiniteNumber(value);
    }
    return false;
  }
}

