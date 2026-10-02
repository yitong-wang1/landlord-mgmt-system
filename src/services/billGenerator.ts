/**
 * 账单生成服务：聚合「应收 / 已缴 / 欠费」，产出 Bill。
 *
 * 依赖关系（系统设计）：Service -> Repository。本模块直接查询 repository 组装上下文，
 * 再交 billingEngine 计算明细。
 */
import {
  type Bill,
  type BillStatus,
  type BillingContext,
  type MonthStr,
  type Tenant,
} from '../types';
import { repository, SCHEMA_VERSION } from '../db/repository';
import { computeMonthlyBill } from './billingEngine';
import { nowISO } from '../utils/format';

/** 由 tenant + month 组装计费上下文 */
export function buildContext(
  tenant: Tenant,
  month: MonthStr,
): BillingContext | null {
  if (!tenant.roomId) return null;
  const room = repository.getById('rooms', tenant.roomId);
  if (!room) return null;
  return {
    tenant,
    room,
    month,
    feeTypes: repository.getFeeTypes(),
    meterRecords: repository.getMeterRecords(room.id),
    heatingFees: repository.getHeatingFees(tenant.id),
    payments: repository.getPayments(tenant.id),
    settings: repository.getSettings(),
  };
}

/** 账单状态判定 */
function toStatus(totalReceivable: number, totalPaid: number): BillStatus {
  if (totalReceivable <= 0) return 'settled';
  const outstanding = totalReceivable - totalPaid;
  if (outstanding <= 0) return 'settled';
  if (totalPaid > 0) return 'partial';
  return 'owed';
}

/** 计算某租户某月的账单（不含预收的月度已缴；预收不计入月度已缴） */
export function generateBill(tenantId: string, month: MonthStr): Bill | null {
  const tenant = repository.getById('tenants', tenantId);
  if (!tenant) return null;
  const ctx = buildContext(tenant, month);
  if (!ctx) return null;

  const items = computeMonthlyBill(ctx);
  const totalReceivable = items.reduce((sum, it) => sum + it.amount, 0);

  // 已缴：仅统计单月租金/其他缴费（排除预收与押金）
  const totalPaid = repository
    .getPayments(tenantId, month)
    .filter(
      (p) =>
        (p.category === 'rent' || p.category === 'other') &&
        p.prepaid !== true,
    )
    .reduce((sum, p) => sum + p.amount, 0);

  const outstanding = totalReceivable - totalPaid;

  return {
    id: `bill-${tenantId}-${month}`,
    tenantId,
    roomId: ctx.room.id,
    month,
    items,
    totalReceivable,
    totalPaid,
    outstanding,
    status: toStatus(totalReceivable, totalPaid),
    generatedAt: nowISO(),
  };
}

/** 生成某月全部「已出租」租户的账单（覆盖写入 bills 集合） */
export function regenerateBillsForMonth(month: MonthStr): Bill[] {
  const tenants = repository.getAll('tenants');
  const bills: Bill[] = [];
  for (const t of tenants) {
    const room = t.roomId ? repository.getById('rooms', t.roomId) : undefined;
    if (!room || room.status !== 'rented') continue;
    const bill = generateBill(t.id, month);
    if (bill) {
      repository.upsert('bills', bill);
      bills.push(bill);
    }
  }
  return bills;
}

/** 统计某月整体欠费概览（用于首页） */
export function summarizeMonth(month: MonthStr): {
  totalOutstanding: number;
  owedCount: number;
  partialCount: number;
  tenantCount: number;
} {
  const bills = repository.getBills(undefined, month);
  let totalOutstanding = 0;
  let owedCount = 0;
  let partialCount = 0;
  for (const b of bills) {
    totalOutstanding += Math.max(0, b.outstanding);
    if (b.status === 'owed') owedCount += 1;
    if (b.status === 'partial') partialCount += 1;
  }
  return {
    totalOutstanding,
    owedCount,
    partialCount,
    tenantCount: bills.length,
  };
}

/** 导出 schema 版本供备份引用 */
export const BILL_SCHEMA_VERSION = SCHEMA_VERSION;
