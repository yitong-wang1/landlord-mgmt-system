/**
 * 费用引擎：计算单个租户某月的「应收」明细（BillItem[]）。
 *
 * 覆盖：
 * - 租金：月付正常计；季付/年付采用「预收整周期」——若当月被一笔预收租金覆盖，则租金为 0（已付）。
 * - 电费：用量 × 设置中的单价（分/度）。
 * - 供暖费：按供暖季将「剩余未缴额」平摊到 6 个供暖月。
 * - 自定义固定费用：按 scope(global/tenant/room) + appliesTo 匹配后计入固定月金额。
 *
 * 该模块为纯函数，仅依赖传入的 BillingContext，不直接访问存储。
 */
import type {
  BillItem,
  BillingContext,
  FeeType,
  HeatingFee,
  MeterRecord,
  PaymentCycle,
  Room,
  Tenant,
} from '../types';
import { heatingMonthsOf, heatingYearOf, isHeatingMonth, monthInRange } from '../utils/date';

/** 周期中文标签 */
export function cycleLabel(cycle: PaymentCycle): string {
  switch (cycle) {
    case 'monthly':
      return '月付';
    case 'quarterly':
      return '季付';
    case 'yearly':
      return '年付';
  }
}

/** 是否存在覆盖该月的预收租金支付 */
function isCoveredByPrepaid(
  payments: BillingContext['payments'],
  month: string,
): boolean {
  return payments.some(
    (p) =>
      p.category === 'rent' &&
      p.prepaid === true &&
      p.periodStart != null &&
      p.periodEnd != null &&
      monthInRange(month, p.periodStart, p.periodEnd),
  );
}

/** 租金明细 */
function computeRent(
  tenant: Tenant,
  room: Room,
  month: string,
  payments: BillingContext['payments'],
): BillItem {
  const covered = isCoveredByPrepaid(payments, month);
  if (tenant.paymentCycle === 'monthly') {
    return {
      feeTypeId: 'builtin-rent',
      feeName: '租金',
      amount: room.monthlyRent,
      note: '月付',
    };
  }
  if (covered) {
    return {
      feeTypeId: 'builtin-rent',
      feeName: '租金',
      amount: 0,
      periodCovered: '预收整周期已覆盖',
      note: `${cycleLabel(tenant.paymentCycle)}：预收已付，本期租金为 0`,
    };
  }
  return {
    feeTypeId: 'builtin-rent',
    feeName: '租金',
    amount: room.monthlyRent,
    note: `${cycleLabel(tenant.paymentCycle)}：尚未记录预收，按整月计租`,
  };
}

/** 电费明细 */
function computeElectricity(
  room: Room,
  month: string,
  meterRecords: MeterRecord[],
  unitPriceCents: number,
): BillItem {
  const rec =
    meterRecords.find((m) => m.roomId === room.id && m.month === month) ?? null;
  if (!rec || rec.usage <= 0) {
    return {
      feeTypeId: 'builtin-electricity',
      feeName: '电费',
      amount: 0,
      note: '本月未抄表',
    };
  }
  const amount = Math.round(rec.usage * unitPriceCents);
  return {
    feeTypeId: 'builtin-electricity',
    feeName: '电费',
    amount,
    note: `用量 ${rec.usage} 度 × ${(unitPriceCents / 100).toFixed(2)} 元/度`,
  };
}

/** 供暖费明细（仅供暖月计入，按季分摊剩余额） */
function computeHeating(
  tenant: Tenant,
  room: Room,
  month: string,
  heatingFees: HeatingFee[],
): BillItem | null {
  if (!isHeatingMonth(month)) return null;
  const year = heatingYearOf(month);
  const hf = heatingFees.find(
    (h) =>
      h.roomId === room.id &&
      h.tenantId === tenant.id &&
      h.year === year,
  );
  if (!hf || hf.amount <= 0) {
    return {
      feeTypeId: 'builtin-heating',
      feeName: '供暖费',
      amount: 0,
      note: `${year}-${year + 1} 供暖季未登记`,
    };
  }
  const remaining = Math.max(0, hf.amount - hf.paidAmount);
  if (remaining <= 0) {
    return {
      feeTypeId: 'builtin-heating',
      feeName: '供暖费',
      amount: 0,
      note: '供暖费已缴清',
    };
  }
  const months = heatingMonthsOf(year);
  const idx = months.indexOf(month);
  const base = Math.floor(remaining / months.length);
  const rem = remaining - base * months.length;
  const share = base + (idx >= 0 && idx < rem ? 1 : 0);
  return {
    feeTypeId: 'builtin-heating',
    feeName: '供暖费',
    amount: share,
    note: `供暖季分摊（剩余 ${(remaining / 100).toFixed(2)} 元 ÷ ${months.length} 月）`,
  };
}

/** 自定义固定费用是否适用于该租户/房间 */
function appliesToScope(
  fee: FeeType,
  tenant: Tenant,
  room: Room,
): boolean {
  if (fee.scope === 'global') return true;
  const targets = fee.appliesTo ?? [];
  if (targets.length === 0) return true; // 空 = 该 scope 下全部
  if (fee.scope === 'tenant') return targets.includes(tenant.id);
  if (fee.scope === 'room') return targets.includes(room.id);
  return false;
}

/** 自定义固定费用明细 */
function computeCustomFees(
  tenant: Tenant,
  room: Room,
  feeTypes: FeeType[],
): BillItem[] {
  return feeTypes
    .filter((f) => f.category === 'custom' && f.billingMode === 'fixed')
    .filter((f) => appliesToScope(f, tenant, room))
    .map((f) => ({
      feeTypeId: f.id,
      feeName: f.name,
      amount: f.fixedAmount ?? 0,
      note: '自定义固定费用',
    }));
}

/**
 * 计算某租户某月的账单明细。
 * @returns BillItem[]（按 租金→电费→供暖费→自定义 顺序）
 */
export function computeMonthlyBill(ctx: BillingContext): BillItem[] {
  const { tenant, room, month, feeTypes, meterRecords, heatingFees, settings } =
    ctx;
  const items: BillItem[] = [];

  items.push(computeRent(tenant, room, month, ctx.payments));
  items.push(
    computeElectricity(room, month, meterRecords, settings.electricityUnitPrice),
  );

  const heating = computeHeating(tenant, room, month, heatingFees);
  if (heating) items.push(heating);

  items.push(...computeCustomFees(tenant, room, feeTypes));

  return items;
}
