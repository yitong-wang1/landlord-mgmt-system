/**
 * 根因定位：年付/季付「预收整周期」是否真正生效（走真实 generateBill 路径）。
 */
const store = new Map<string, string>();
(globalThis as never as { localStorage: Storage }).localStorage = {
  get length() { return store.size; },
  key: (i: number) => [...store.keys()][i] ?? null,
  getItem: (k: string) => (store.get(k) as string) ?? null,
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
} as never as Storage;

import { computeMonthlyBill } from '../src/services/billingEngine';
import { generateBill } from '../src/services/billGenerator';
import { repository } from '../src/db/repository';
import { listMonths } from '../src/utils/date';

const NOW = '2026-01-01T00:00:00.000Z';
const S = { id: 'app', electricityUnitPrice: 80, landlordName: 'x', schemaVersion: 1 };

// 年付租户 + 一笔覆盖 2026-01~2026-12 的预收租金
repository.create('rooms', {
  id: 'R1', name: '101', monthlyRent: 150000, status: 'rented', photoIds: [], createdAt: NOW,
});
repository.create('tenants', {
  id: 'T1', name: '年付租户', idCard: 'x', idCardMasked: 'x', phone: '1',
  paymentCycle: 'yearly', depositMonths: 1, depositType: 'refundable',
  depositDeductibleOnExit: true, roomId: 'R1', createdAt: NOW, updatedAt: NOW,
});
repository.create('payments', {
  id: 'P1', tenantId: 'T1', roomId: 'R1', billMonth: '2026-01', amount: 1800000,
  category: 'rent', prepaid: true, periodStart: '2026-01', periodEnd: '2026-12', paidAt: NOW,
});
repository.saveSettings(S);

console.log('=== 通过真实 generateBill 生成 2026-06 账单（年付预收 2026-01~2026-12）===');
const bill = generateBill('T1', '2026-06')!;
console.log('账单明细：');
for (const it of bill.items) {
  const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - s.length));
  const num = String(it.amount).padStart(8);
  console.log(`   ${pad(it.feeName, 10)} ${num} 分   ${it.note ?? ''}`);
}
console.log(`\n应收合计 = ${bill.totalReceivable} 分`);

console.log('\n=== 直接调用 computeMonthlyBill（绕过 repository）===');
const ctx = {
  tenant: repository.getById('tenants', 'T1')!,
  room: repository.getById('rooms', 'R1')!,
  month: '2026-06',
  feeTypes: repository.getFeeTypes(),
  meterRecords: [],
  heatingFees: [],
  payments: repository.getPayments('T1'),
  settings: repository.getSettings(),
};
console.log(
  '传入 ctx.payments =',
  ctx.payments.map((p) => `${p.id}(prepaid=${p.prepaid},${p.periodStart}~${p.periodEnd})`).join(',') || '(空)',
);
const items = computeMonthlyBill(ctx);
console.log('明细:', items.map((i) => `${i.feeName}=${i.amount}`).join(' | '));

console.log('\n=== 逐月扫描 2026 全年（真实 generateBill）===');
let wrong = 0;
for (const m of listMonths('2026-01', '2026-12')) {
  const b = generateBill('T1', m)!;
  const rent = b.items.find((i) => i.feeTypeId === 'builtin-rent')!;
  const isZero = rent.amount === 0;
  if (!isZero) wrong += 1;
  console.log(`  ${m}  租金=${String(rent.amount).padStart(7)}分  ${isZero ? '已覆盖(正确)' : '未覆盖(应为0)'}  ${rent.note ?? ''}`);
}
console.log(`\n结论：12 个月中有 ${wrong} 个月的租金未按预收抵扣（正确应为 0）。`);

console.log('\n=== 对照：paymentCycle=monthly 时同样预收记录的租金 ===');
const ctxMonthly = { ...ctx, tenant: { ...ctx.tenant, paymentCycle: 'monthly' as const } };
console.log('  租金 =', computeMonthlyBill(ctxMonthly)[0].amount, '分（月付按设计本就全额计费）');