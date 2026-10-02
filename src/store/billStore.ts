/**
 * 账单状态管理（Zustand）。账单由 feeStore/billingEngine 派生，非手工录入。
 */
import { create } from 'zustand';
import type { Bill, MonthStr, Payment, PaymentCategory } from '../types';
import { repository } from '../db/repository';
import {
  generateBill,
  regenerateBillsForMonth,
  summarizeMonth,
} from '../services/billGenerator';
import { uuid, nowISO } from '../utils/format';
import { registerStore } from './sync';

/** 新增缴费入参 */
export type PaymentInput = Omit<Payment, 'id' | 'paidAt'> & { id?: string };

interface BillState {
  bills: Bill[];
  payments: Payment[];
  load: () => void;
  /** 重新生成某月全部已出租租户账单 */
  regenerateMonth: (month: MonthStr) => Bill[];
  /** 重新生成单个租户某月账单 */
  regenerateTenantBill: (tenantId: string, month: MonthStr) => Bill | null;
  getBillsForTenant: (tenantId: string) => Bill[];
  getBillsForMonth: (month: MonthStr) => Bill[];
  getBill: (tenantId: string, month: MonthStr) => Bill | undefined;
  /** 某月欠费概览 */
  summarize: (month: MonthStr) => ReturnType<typeof summarizeMonth>;

  /** 登记缴费（含租金/押金/其他；季付年付可预收整周期） */
  addPayment: (input: PaymentInput) => Payment;
  removePayment: (id: string) => void;
  getPaymentsForTenant: (tenantId: string) => Payment[];
}

export const useBillStore = create<BillState>((set, get) => ({
  bills: [],
  payments: [],

  load: () =>
    set({
      bills: repository.getAll('bills'),
      payments: repository.getAll('payments'),
    }),

  regenerateMonth: (month) => {
    const bills = regenerateBillsForMonth(month);
    set({ bills: repository.getAll('bills') });
    return bills;
  },

  regenerateTenantBill: (tenantId, month) => {
    const bill = generateBill(tenantId, month);
    if (bill) repository.upsert('bills', bill);
    set({ bills: repository.getAll('bills') });
    return bill;
  },

  getBillsForTenant: (tenantId) => repository.getBills(tenantId),

  getBillsForMonth: (month) => repository.getBills(undefined, month),

  getBill: (tenantId, month) =>
    repository.getBills(tenantId, month)[0],

  summarize: (month) => {
    // 确保该月账单已生成
    get().regenerateMonth(month);
    return summarizeMonth(month);
  },

  addPayment: (input) => {
    const payment = repository.create('payments', {
      ...input,
      id: input.id ?? uuid(),
      paidAt: nowISO(),
    } as Payment);
    set({ payments: repository.getAll('payments') });
    return payment;
  },

  removePayment: (id) => {
    repository.remove('payments', id);
    set({ payments: repository.getAll('payments') });
  },

  getPaymentsForTenant: (tenantId) => repository.getPayments(tenantId),
}));

// 注册到跨 store 同步表（账单依赖租户/房间归属，需随之刷新）
registerStore('bills', () => useBillStore.getState().load());

// re-export 类型便于外部引用
export type { PaymentCategory };
