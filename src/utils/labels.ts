/**
 * 通用中文标签映射（状态/枚举 -> 文案）。
 */
import type {
  BillStatus,
  FeeCategory,
  FeeScope,
  HeatingStatus,
  PaymentCategory,
  PaymentCycle,
  RoomStatus,
} from '../types';

export function billStatusLabel(s: BillStatus): string {
  switch (s) {
    case 'settled':
      return '已结清';
    case 'owed':
      return '欠费';
    case 'partial':
      return '部分缴纳';
  }
}

export function roomStatusLabel(s: RoomStatus): string {
  return s === 'rented' ? '已出租' : '空置';
}

export function heatingStatusLabel(s: HeatingStatus): string {
  switch (s) {
    case 'paid':
      return '已缴';
    case 'unpaid':
      return '未缴';
    case 'partial':
      return '部分缴纳';
  }
}

export function feeCategoryLabel(c: FeeCategory): string {
  switch (c) {
    case 'rent':
      return '租金';
    case 'electricity':
      return '电费';
    case 'heating':
      return '供暖费';
    case 'custom':
      return '自定义';
  }
}

export function feeScopeLabel(s: FeeScope): string {
  switch (s) {
    case 'tenant':
      return '按租户';
    case 'room':
      return '按房间';
    case 'global':
      return '全局';
  }
}

export function paymentCategoryLabel(c: PaymentCategory): string {
  switch (c) {
    case 'rent':
      return '租金';
    case 'deposit':
      return '押金';
    case 'other':
      return '其他';
  }
}

export function paymentCycleLabel(c: PaymentCycle): string {
  switch (c) {
    case 'monthly':
      return '月付';
    case 'quarterly':
      return '季付';
    case 'yearly':
      return '年付';
  }
}