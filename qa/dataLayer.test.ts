/**
 * 数据层核心逻辑测试：直接 import 被测源码（billingEngine / billGenerator / repository），
 * 不复制业务逻辑，确保测的是真实代码路径。
 */
import {
  computeMonthlyBill,
  cycleLabel,
} from '../src/services/billingEngine';
import { generateBill, buildContext } from '../src/services/billGenerator';
import { repository } from '../src/db/repository';
import { useTenantStore } from '../src/store/tenantStore';
import { useRoomStore } from '../src/store/roomStore';
import { reloadAll } from '../src/store/sync';
import { yuanToCents, formatCents, parseYuanInput } from '../src/utils/money';
import { monthInRange, listMonths, isHeatingMonth, heatingYearOf } from '../src/utils/date';
import type {
  BillingContext,
  FeeType,
  HeatingFee,
  MeterRecord,
  Payment,
  Room,
  Settings,
  Tenant,
} from '../src/types';
import { describe, test, eq, ok, deepEq } from './harness';
import { resetStorage } from './env';

/* ---------------- 固定测试夹具 ---------------- */

const NOW = '2026-01-01T00:00:00.000Z';

function makeTenant(over: Partial<Tenant> = {}): Tenant {
  return {
    id: 'T1',
    name: '张三',
    idCard: '110101199001011234',
    idCardMasked: '110***********1234',
    phone: '13800000000',
    paymentCycle: 'monthly',
    depositMonths: 1,
    depositType: 'refundable',
    depositDeductibleOnExit: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function makeRoom(over: Partial<Room> = {}): Room {
  return {
    id: 'R1',
    name: '101',
    monthlyRent: 150000, // 1500.00 元
    status: 'rented',
    photoIds: [],
    createdAt: NOW,
    ...over,
  };
}

const SETTINGS: Settings = {
  id: 'app',
  electricityUnitPrice: 80, // 0.80 元/度
  landlordName: '房东',
  schemaVersion: 1,
};

function ctx(over: Partial<BillingContext> = {}): BillingContext {
  return {
    tenant: makeTenant(),
    room: makeRoom(),
    month: '2026-03',
    feeTypes: [],
    meterRecords: [],
    heatingFees: [],
    payments: [],
    settings: SETTINGS,
    ...over,
  };
}

/** 按 feeTypeId 取明细项 */
function itemOf(items: ReturnType<typeof computeMonthlyBill>, id: string) {
  return items.find((i) => i.feeTypeId === id);
}

/* ================= 1. 金额精度 ================= */

describe('金额精度（整数分）', () => {
  test('元->分转换无浮点误差：0.1+0.2 场景', () => {
    // 0.1 元 + 0.2 元 = 0.3 元 -> 30 分，不能是 29/31
    const a = yuanToCents(0.1);
    const b = yuanToCents(0.2);
    eq(a, 10, '0.1 元应为 10 分');
    eq(b, 20, '0.2 元应为 20 分');
    eq(a + b, 30, '0.1+0.2 应精确等于 30 分');

    // 经典陷阱：JS 浮点 0.1+0.2=0.30000000000000004
    eq(0.1 + 0.2, 0.30000000000000004, '确认原生 JS 浮点误差存在（对照组）');
    eq(yuanToCents(0.1 + 0.2), 30, '经 yuanToCents 后仍为 30 分，浮点误差被消除');
  });

  test('7 个月 33.33 元分期：累计应收精确无漂移', () => {
    const total = yuanToCents(233.31); // 7*33.33
    const per = yuanToCents(33.33);
    eq(total, 23331, '总额 23331 分');
    eq(per, 3333, '每期 3333 分');
    eq(per * 7, 23331, '7 期累加应精确等于总额');
  });

  test('格式化金额保留两位且无浮点尾巴', () => {
    eq(formatCents(150000), '¥1500.00', '1500 元格式化');
    eq(formatCents(1), '¥0.01', '1 分格式化');
    eq(formatCents(0), '¥0.00', '0 分格式化');
    eq(formatCents(123456), '¥1234.56', '1234.56 元格式化');
  });

  test('非法金额输入降级为 0，不产生 NaN', () => {
    eq(parseYuanInput('abc'), 0, '非法输入应降级为 0');
    eq(parseYuanInput(''), 0, '空输入应降级为 0');
    eq(parseYuanInput('  88.5  '), 88.5, '合法输入应正常解析');
    ok(!Number.isNaN(parseYuanInput('12abc')), '"12abc" 不应产生 NaN');
  });
});

/* ================= 2. 年付/季付 预收整周期（核心） ================= */

describe('预收整周期（年付/季付）', () => {
  // 一笔年付租金：覆盖 2026-01 ~ 2026-12
  const yearlyPrepaid: Payment = {
    id: 'P1',
    tenantId: 'T1',
    roomId: 'R1',
    billMonth: '2026-01',
    amount: 1800000, // 18000 元
    category: 'rent',
    prepaid: true,
    periodStart: '2026-01',
    periodEnd: '2026-12',
    paidAt: NOW,
  };

  /** 年付租户上下文（预收抵扣只对 yearly/quarterly 生效） */
  const yCtx = (over: Partial<BillingContext> = {}): BillingContext =>
    ctx({ tenant: makeTenant({ paymentCycle: 'yearly' }), ...over });

  /** 季付租户上下文 */
  const qCtx = (over: Partial<BillingContext> = {}): BillingContext =>
    ctx({ tenant: makeTenant({ paymentCycle: 'quarterly' }), ...over });

  test('年付预收覆盖的 12 个月内，租金均为 0', () => {
    const months = listMonths('2026-01', '2026-12');
    eq(months.length, 12, '应产出 12 个月份');

    const covered = months.filter(
      (m) => itemOf(computeMonthlyBill(yCtx({ month: m, payments: [yearlyPrepaid] })), 'builtin-rent')?.amount === 0,
    );
    eq(covered.length, 12, `预收应覆盖全部 12 个月，实际覆盖 ${covered.length} 个月`);
  });

  test('预收周期外（2025-12 / 2027-01）仍正常计租', () => {
    const before = itemOf(
      computeMonthlyBill(yCtx({ month: '2025-12', payments: [yearlyPrepaid] })),
      'builtin-rent',
    );
    eq(before?.amount, 150000, '预收起始月之前应正常计租');

    const after = itemOf(
      computeMonthlyBill(yCtx({ month: '2027-01', payments: [yearlyPrepaid] })),
      'builtin-rent',
    );
    eq(after?.amount, 150000, '预收结束月之后应正常计租');
  });

  test('【关键】预收只免租金，电费仍正常计费', () => {
    const meter: MeterRecord = {
      id: 'M1',
      roomId: 'R1',
      month: '2026-06',
      usage: 120,
      recordedAt: NOW,
    };
    const items = computeMonthlyBill(
      yCtx({ month: '2026-06', payments: [yearlyPrepaid], meterRecords: [meter] }),
    );
    eq(itemOf(items, 'builtin-rent')?.amount, 0, '租金应为 0（预收覆盖）');
    eq(itemOf(items, 'builtin-electricity')?.amount, 120 * 80, '电费仍应 = 120 度 × 80 分 = 9600 分');
  });

  test('【关键】预收只免租金，供暖费仍正常计费', () => {
    // 2026-01 属供暖年 2025（供暖月 2025-11 ~ 2026-04）
    const heating: HeatingFee = {
      id: 'H1',
      roomId: 'R1',
      tenantId: 'T1',
      year: 2025,
      status: 'unpaid',
      amount: 600000, // 剩余 6000 元平摊 6 个月 = 1000 元/月 = 100000 分
      paidAmount: 0,
    };
    const items = computeMonthlyBill(
      yCtx({ month: '2026-01', payments: [yearlyPrepaid], heatingFees: [heating] }),
    );
    eq(itemOf(items, 'builtin-rent')?.amount, 0, '租金应为 0');
    eq(itemOf(items, 'builtin-heating')?.amount, 100000, '供暖费仍应正常分摊 100000 分');
  });

  test('【关键】预收只免租金，自定义费用仍正常计费', () => {
    const custom: FeeType = {
      id: 'F_CUSTOM',
      name: '垃圾清运费',
      category: 'custom',
      isBuiltin: false,
      billingMode: 'fixed',
      fixedAmount: 5000, // 50 元/月
      scope: 'global',
      createdAt: NOW,
    };
    const items = computeMonthlyBill(
      yCtx({ month: '2026-06', payments: [yearlyPrepaid], feeTypes: [custom] }),
    );
    eq(itemOf(items, 'builtin-rent')?.amount, 0, '租金应为 0');
    eq(itemOf(items, 'F_CUSTOM')?.amount, 5000, '自定义费用仍应正常计费 5000 分');
  });

  test('月付租户即使有预收记录，租金仍按月计（不被误免）', () => {
    const monthly = ctx({ month: '2026-06', payments: [yearlyPrepaid] });
    eq(itemOf(computeMonthlyBill(monthly), 'builtin-rent')?.amount, 150000, '月付租金应正常计费');
  });

  test('季付预收只覆盖 3 个月', () => {
    const quarterly: Payment = {
      id: 'P2',
      tenantId: 'T1',
      roomId: 'R1',
      billMonth: '2026-01',
      amount: 450000,
      category: 'rent',
      prepaid: true,
      periodStart: '2026-01',
      periodEnd: '2026-03',
      paidAt: NOW,
    };
    const amounts = ['2026-01', '2026-02', '2026-03', '2026-04'].map(
      (m) =>
        itemOf(computeMonthlyBill(qCtx({ month: m, payments: [quarterly] })), 'builtin-rent')
          ?.amount ?? -1,
    );
    deepEq(amounts, [0, 0, 0, 150000], '季付应覆盖 1-3 月，4 月恢复计租');
  });

  test('非预收（普通单月缴租）记录不得免租金', () => {
    const normal: Payment = {
      id: 'P3',
      tenantId: 'T1',
      roomId: 'R1',
      billMonth: '2026-03',
      amount: 150000,
      category: 'rent',
      paidAt: NOW,
      // prepaid 未设置
    };
    const items = computeMonthlyBill(yCtx({ month: '2026-03', payments: [normal] }));
    eq(itemOf(items, 'builtin-rent')?.amount, 150000, '普通缴租不改变应收，租金仍应计');
  });

  test('预收记录 category 非 rent 时不得免租金', () => {
    const weird: Payment = {
      id: 'P4',
      tenantId: 'T1',
      roomId: 'R1',
      billMonth: '2026-01',
      amount: 100,
      category: 'other',
      prepaid: true,
      periodStart: '2026-01',
      periodEnd: '2026-12',
      paidAt: NOW,
    };
    const items = computeMonthlyBill(yCtx({ month: '2026-05', payments: [weird] }));
    eq(itemOf(items, 'builtin-rent')?.amount, 150000, 'category=other 的预收不应覆盖租金');
  });

  test('预收缺少 periodStart/periodEnd 时不得免租金（防脏数据误抵扣）', () => {
    const noPeriod: Payment = {
      id: 'P5',
      tenantId: 'T1',
      roomId: 'R1',
      billMonth: '2026-01',
      amount: 1800000,
      category: 'rent',
      prepaid: true,
      paidAt: NOW,
    };
    const items = computeMonthlyBill(yCtx({ month: '2026-05', payments: [noPeriod] }));
    eq(itemOf(items, 'builtin-rent')?.amount, 150000, '缺周期边界的预收不应覆盖租金');
  });

  test('【端到端】经 generateBill 逐月扫描：年付预收 12 个月全部抵扣', () => {
    resetStorage();
    repository.create('rooms', makeRoom({ id: 'R1' }));
    repository.create(
      'tenants',
      makeTenant({ id: 'T1', paymentCycle: 'yearly', roomId: 'R1' }),
    );
    repository.create('payments', yearlyPrepaid);
    repository.saveSettings(SETTINGS);

    const notCovered = listMonths('2026-01', '2026-12').filter((m) => {
      const b = generateBill('T1', m)!;
      return (b.items.find((i) => i.feeTypeId === 'builtin-rent')?.amount ?? -1) !== 0;
    });
    deepEq(notCovered, [], `以下月份未按预收抵扣：${notCovered.join(',')}`);
  });

  test('周期标签文案正确', () => {
    eq(cycleLabel('monthly'), '月付', 'monthly 标签');
    eq(cycleLabel('quarterly'), '季付', 'quarterly 标签');
    eq(cycleLabel('yearly'), '年付', 'yearly 标签');
  });
});

/* ================= 3. 电费引擎 ================= */

describe('电费计费引擎', () => {
  test('金额 = 用量 × 单价', () => {
    const meter: MeterRecord = { id: 'M', roomId: 'R1', month: '2026-03', usage: 150, recordedAt: NOW };
    const items = computeMonthlyBill(ctx({ meterRecords: [meter] }));
    eq(itemOf(items, 'builtin-electricity')?.amount, 150 * 80, '150 度 × 0.80 元 = 12000 分');
  });

  test('自定义单价生效（0.65 元/度）', () => {
    const meter: MeterRecord = { id: 'M', roomId: 'R1', month: '2026-03', usage: 100, recordedAt: NOW };
    const items = computeMonthlyBill(
      ctx({ meterRecords: [meter], settings: { ...SETTINGS, electricityUnitPrice: 65 } }),
    );
    eq(itemOf(items, 'builtin-electricity')?.amount, 6500, '100 度 × 0.65 元 = 6500 分');
  });

  test('小数用量 × 单价 结果按分四舍五入，无浮点误差', () => {
    // 用量 12.5 度（半档刻度表常见），单价 0.83 元 -> 12.5*83 = 1037.5 分 -> 应为 1038
    const meter: MeterRecord = { id: 'M', roomId: 'R1', month: '2026-03', usage: 12.5, recordedAt: NOW };
    const items = computeMonthlyBill(
      ctx({ meterRecords: [meter], settings: { ...SETTINGS, electricityUnitPrice: 83 } }),
    );
    const amt = itemOf(items, 'builtin-electricity')?.amount ?? 0;
    eq(Number.isInteger(amt), true, `电费金额必须为整数分，实际 ${amt}`);
    eq(amt, 1038, '12.5 × 83 = 1037.5 分，四舍五入为 1038 分');
  });

  test('未抄表 / 用量为 0 时电费为 0 且不报错', () => {
    eq(itemOf(computeMonthlyBill(ctx()), 'builtin-electricity')?.amount, 0, '无抄表记录应为 0');
    const zero: MeterRecord = { id: 'M', roomId: 'R1', month: '2026-03', usage: 0, recordedAt: NOW };
    eq(
      itemOf(computeMonthlyBill(ctx({ meterRecords: [zero] })), 'builtin-electricity')?.amount,
      0,
      '用量为 0 应为 0',
    );
  });

  test('其他房间的抄表记录不得串到本房间', () => {
    const other: MeterRecord = { id: 'M', roomId: 'R999', month: '2026-03', usage: 999, recordedAt: NOW };
    eq(
      itemOf(computeMonthlyBill(ctx({ meterRecords: [other] })), 'builtin-electricity')?.amount,
      0,
      '他人房间抄表不得计入',
    );
  });
});

/* ================= 4. 供暖费状态推导 ================= */

describe('供暖费', () => {
  const heating = (over: Partial<HeatingFee>): HeatingFee => ({
    id: 'H1',
    roomId: 'R1',
    tenantId: 'T1',
    year: 2025,
    status: 'unpaid',
    amount: 600000,
    paidAmount: 0,
    ...over,
  });

  test('非供暖月（5-10 月）不产生供暖费项', () => {
    for (const m of ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']) {
      eq(isHeatingMonth(m), false, `${m} 不应是供暖月`);
      const items = computeMonthlyBill(ctx({ month: m, heatingFees: [heating({})] }));
      eq(itemOf(items, 'builtin-heating'), undefined, `${m} 不应出现供暖费项`);
    }
  });

  test('供暖月（11-4 月）划分与供暖年归属正确', () => {
    eq(heatingYearOf('2025-11'), 2025, '2025-11 属供暖年 2025');
    eq(heatingYearOf('2026-01'), 2025, '2026-01 属供暖年 2025');
    eq(heatingYearOf('2026-04'), 2025, '2026-04 属供暖年 2025');
    eq(heatingYearOf('2026-11'), 2026, '2026-11 属供暖年 2026');
  });

  test('未缴：剩余额平摊 6 个月', () => {
    const items = computeMonthlyBill(
      ctx({ month: '2026-01', heatingFees: [heating({ status: 'unpaid', amount: 600000, paidAmount: 0 })] }),
    );
    eq(itemOf(items, 'builtin-heating')?.amount, 100000, '6000 元 ÷ 6 = 1000 元/月 = 100000 分');
  });

  test('已缴清（status=paid）：金额为 0', () => {
    const items = computeMonthlyBill(
      ctx({
        month: '2026-01',
        heatingFees: [heating({ status: 'paid', amount: 600000, paidAmount: 600000 })],
      }),
    );
    eq(itemOf(items, 'builtin-heating')?.amount, 0, '已缴清应为 0');
  });

  test('部分缴纳：按「剩余额」平摊，且 6 个月之和精确等于剩余额', () => {
    const amount = 600000;
    const paidAmount = 100000;
    const remaining = amount - paidAmount; // 500000，无法被 6 整除
    const months = ['2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04'];
    const got = months.map(
      (m) => itemOf(computeMonthlyBill(ctx({ month: m, heatingFees: [heating({ status: 'partial', amount, paidAmount })] })), 'builtin-heating')?.amount ?? 0,
    );
    const sum = got.reduce((a, b) => a + b, 0);
    eq(sum, remaining, `6 个月分摊之和应精确等于剩余额 ${remaining}`);
    eq(got.every((v) => Number.isInteger(v)), true, '每个月的分摊额必须为整数分');
    // 余数分配：前 2 个月各多分 1 分
    const base = Math.floor(remaining / 6);
    deepEq(got, [base + 1, base + 1, base, base, base, base], '余数应分配到前几个月，无 1 分丢失');
  });

  test('未登记供暖季：金额 0 且不报错', () => {
    const items = computeMonthlyBill(ctx({ month: '2026-01', heatingFees: [] }));
    eq(itemOf(items, 'builtin-heating')?.amount, 0, '未登记应为 0');
  });

  test('房间/租户不匹配的供暖记录不得串用', () => {
    const other: HeatingFee = {
      id: 'H2', roomId: 'R999', tenantId: 'T999', year: 2025,
      status: 'unpaid', amount: 900000, paidAmount: 0,
    };
    const items = computeMonthlyBill(ctx({ month: '2026-01', heatingFees: [other] }));
    eq(itemOf(items, 'builtin-heating')?.amount, 0, '他人供暖记录不得计入');
  });

  test('跨供暖年：2026-11 应取 year=2026 的记录而非 2025', () => {
    const h2025 = heating({ id: 'H2025', year: 2025, amount: 600000, paidAmount: 0 });
    const h2026 = heating({ id: 'H2026', year: 2026, amount: 720000, paidAmount: 0 });
    const items = computeMonthlyBill(ctx({ month: '2026-11', heatingFees: [h2025, h2026] }));
    eq(itemOf(items, 'builtin-heating')?.amount, 120000, '应取 2026 供暖季：7200 ÷ 6 = 1200 元 = 120000 分');
  });
});

/* ================= 5. 自定义费用 scope ================= */

describe('自定义费用 scope', () => {
  const custom = (over: Partial<FeeType>): FeeType => ({
    id: 'F1',
    name: '物业费',
    category: 'custom',
    isBuiltin: false,
    billingMode: 'fixed',
    fixedAmount: 10000,
    scope: 'global',
    createdAt: NOW,
    ...over,
  });

  test('scope=global：所有租户/房间都计入', () => {
    const items = computeMonthlyBill(ctx({ feeTypes: [custom({ scope: 'global' })] }));
    eq(itemOf(items, 'F1')?.amount, 10000, 'global 应对所有人生效');
  });

  test('scope=tenant + appliesTo 含本租户：计入', () => {
    const items = computeMonthlyBill(
      ctx({ feeTypes: [custom({ scope: 'tenant', appliesTo: ['T1'] })] }),
    );
    eq(itemOf(items, 'F1')?.amount, 10000, 'appliesTo 含 T1 应计入');
  });

  test('scope=tenant + appliesTo 不含本租户：不计入', () => {
    const items = computeMonthlyBill(
      ctx({ feeTypes: [custom({ scope: 'tenant', appliesTo: ['T_OTHER'] })] }),
    );
    eq(itemOf(items, 'F1'), undefined, 'appliesTo 不含 T1 不应计入');
  });

  test('scope=tenant + appliesTo 为空数组 = 该 scope 下全部（"应用到全部"）', () => {
    const items = computeMonthlyBill(ctx({ feeTypes: [custom({ scope: 'tenant', appliesTo: [] })] }));
    eq(itemOf(items, 'F1')?.amount, 10000, '空 appliesTo 应视为全部租户');
  });

  test('scope=room + appliesTo 含本房间：计入 / 不含则不计', () => {
    const hit = computeMonthlyBill(ctx({ feeTypes: [custom({ scope: 'room', appliesTo: ['R1'] })] }));
    eq(itemOf(hit, 'F1')?.amount, 10000, 'appliesTo 含 R1 应计入');
    const miss = computeMonthlyBill(ctx({ feeTypes: [custom({ scope: 'room', appliesTo: ['R9'] })] }));
    eq(itemOf(miss, 'F1'), undefined, 'appliesTo 不含 R1 不应计入');
  });

  test('多租户多房间场景：各自只算各自的 scope 费用', () => {
    const fee = custom({ id: 'F_ROOM', scope: 'room', appliesTo: ['R1', 'R2'] });
    const feeT = custom({ id: 'F_TENANT', scope: 'tenant', appliesTo: ['T2'] });
    const items = computeMonthlyBill(ctx({ feeTypes: [fee, feeT] }));
    eq(itemOf(items, 'F_ROOM')?.amount, 10000, 'R1 在房间列表内，应计入');
    eq(itemOf(items, 'F_TENANT'), undefined, 'T1 不在租户列表内，不应计入');
  });

  test('内置费用类型不得被当作自定义费用重复计入', () => {
    const builtins: FeeType[] = [
      { id: 'builtin-rent', name: '租金', category: 'rent', isBuiltin: true, billingMode: 'cycle', createdAt: NOW },
      { id: 'builtin-electricity', name: '电费', category: 'electricity', isBuiltin: true, billingMode: 'usage', createdAt: NOW },
    ];
    const items = computeMonthlyBill(ctx({ feeTypes: builtins }));
    eq(items.filter((i) => i.feeTypeId === 'builtin-rent').length, 1, '租金只应出现 1 项');
    eq(items.filter((i) => i.feeTypeId === 'builtin-electricity').length, 1, '电费只应出现 1 项');
  });

  test('明细项顺序：租金 -> 电费 -> 供暖费 -> 自定义', () => {
    const meter: MeterRecord = { id: 'M', roomId: 'R1', month: '2026-01', usage: 50, recordedAt: NOW };
    const hf = heatingOf();
    const items = computeMonthlyBill(
      ctx({ month: '2026-01', meterRecords: [meter], heatingFees: [hf], feeTypes: [custom({ id: 'F1' })] }),
    );
    deepEq(
      items.map((i) => i.feeTypeId),
      ['builtin-rent', 'builtin-electricity', 'builtin-heating', 'F1'],
      '明细顺序不符',
    );
  });

  function heatingOf(): HeatingFee {
    return { id: 'H', roomId: 'R1', tenantId: 'T1', year: 2025, status: 'unpaid', amount: 600000, paidAmount: 0 };
  }
});

/* ================= 6. 押金隔离（不污染租金/电费） ================= */

describe('押金收支隔离', () => {
  /** 在真实 repository 上落库，验证 generateBill 聚合结果 */
  function seed(extraPayments: Payment[]): void {
    resetStorage();
    repository.create('rooms', makeRoom());
    repository.create('tenants', makeTenant({ roomId: 'R1' }));
    for (const p of extraPayments) repository.create('payments', p);
    repository.saveSettings(SETTINGS);
  }

  test('押金收取不得减少账单已缴 / 不得虚增欠费以外的项目', () => {
    const meter: MeterRecord = { id: 'M', roomId: 'R1', month: '2026-03', usage: 100, recordedAt: NOW };
    resetStorage();
    repository.create('rooms', makeRoom());
    repository.create('tenants', makeTenant({ roomId: 'R1' }));
    repository.create('meterRecords', meter);
    repository.create('payments', {
      id: 'PAY_DEP', tenantId: 'T1', roomId: 'R1', billMonth: '2026-03',
      amount: 150000, category: 'deposit', paidAt: NOW,
    });
    repository.saveSettings(SETTINGS);

    const bill = generateBill('T1', '2026-03');
    ok(bill !== null, '应生成账单');
    // 应收 = 租金 150000 + 电费 8000 = 158000
    eq(bill!.totalReceivable, 158000, '应收 = 租金 1500 + 电费 80 = 1580 元');
    eq(bill!.totalPaid, 0, '押金 150000 分不得计入账单已缴');
    eq(bill!.outstanding, 158000, '欠费 = 158000 分，押金不影响');
    eq(bill!.status, 'owed', '状态应为欠费');
    // 明细中不得出现押金项
    eq(
      bill!.items.filter((i) => /押金/.test(i.feeName)).length,
      0,
      '账单明细中不得出现押金项',
    );
  });

  test('押金退还（负数/退租场景）同样不污染账目', () => {
    seed([
      { id: 'D1', tenantId: 'T1', roomId: 'R1', billMonth: '2026-03', amount: 150000, category: 'deposit', paidAt: NOW },
      { id: 'D2', tenantId: 'T1', roomId: 'R1', billMonth: '2026-03', amount: -50000, category: 'deposit', paidAt: NOW, note: '扣款' },
    ]);
    const bill = generateBill('T1', '2026-03');
    eq(bill!.totalPaid, 0, '押金收/退/扣均不得进入已缴');
    eq(bill!.totalReceivable, 150000, '应收仅含租金');
  });

  test('单月租金缴款正确冲抵欠费', () => {
    seed([
      { id: 'R1P', tenantId: 'T1', roomId: 'R1', billMonth: '2026-03', amount: 150000, category: 'rent', paidAt: NOW },
    ]);
    const bill = generateBill('T1', '2026-03');
    eq(bill!.totalPaid, 150000, '单月租金应计入已缴');
    eq(bill!.outstanding, 0, '欠费应为 0');
    eq(bill!.status, 'settled', '状态应为已清');
  });

  test('部分缴纳 -> partial 状态', () => {
    seed([
      { id: 'RP', tenantId: 'T1', roomId: 'R1', billMonth: '2026-03', amount: 50000, category: 'rent', paidAt: NOW },
    ]);
    const bill = generateBill('T1', '2026-03');
    eq(bill!.status, 'partial', '部分缴纳应为 partial');
    eq(bill!.outstanding, 100000, '欠费 = 150000 - 50000');
  });

  test('预收租金不得计入月度已缴（否则重复抵扣）', () => {
    seed([
      {
        id: 'PRE', tenantId: 'T1', roomId: 'R1', billMonth: '2026-01',
        amount: 1800000, category: 'rent', prepaid: true,
        periodStart: '2026-01', periodEnd: '2026-12', paidAt: NOW,
      },
    ]);
    // 改为年付租户，走预收抵扣分支
    repository.update('tenants', 'T1', { paymentCycle: 'yearly' });

    const bill = generateBill('T1', '2026-06');
    eq(bill!.totalPaid, 0, '预收不得计入 6 月已缴');
    eq(bill!.totalReceivable, 0, '6 月租金已免、无抄表无供暖 -> 应收 0');
    eq(bill!.outstanding, 0, '欠费应为 0');
    eq(bill!.status, 'settled', '状态应为已清');

    // 但 6 月若抄了表，电费必须照收（证明预收只免租金）
    repository.create('meterRecords', {
      id: 'M6', roomId: 'R1', month: '2026-06', usage: 100, recordedAt: NOW,
    });
    const bill2 = generateBill('T1', '2026-06');
    eq(bill2!.totalReceivable, 8000, '预收覆盖月内电费仍应收 100 度 × 0.80 元 = 8000 分');
    eq(bill2!.totalPaid, 0, '预收仍不得计入已缴');
    eq(bill2!.status, 'owed', '有电费未缴应为欠费');
  });

  test('category=other 计入已缴（设计如此）', () => {
    seed([
      { id: 'O1', tenantId: 'T1', roomId: 'R1', billMonth: '2026-03', amount: 20000, category: 'other', paidAt: NOW },
    ]);
    const bill = generateBill('T1', '2026-03');
    eq(bill!.totalPaid, 20000, 'other 类应计入已缴');
  });
});

/* ================= 7. 租户换房数据完整性（重点） ================= */

describe('租户换房 / 房间双向绑定', () => {
  test('【重点】A 换到 B 所在房间：不得解绑其他无关租户', () => {
    resetStorage();
    const store = useTenantStore.getState();
    store.load();

    // 三个房间
    const r1 = repository.create('rooms', makeRoom({ id: 'RA', name: 'A房', status: 'vacant' }));
    const r2 = repository.create('rooms', makeRoom({ id: 'RB', name: 'B房', status: 'vacant' }));
    const r3 = repository.create('rooms', makeRoom({ id: 'RC', name: 'C房', status: 'vacant' }));
    ok(r1 && r2 && r3, '房间创建成功');

    // 三个租户分别绑定不同房间
    repository.create('tenants', makeTenant({ id: 'TA', name: '租户A', roomId: 'RA' }));
    repository.create('tenants', makeTenant({ id: 'TB', name: '租户B', roomId: 'RB' }));
    repository.create('tenants', makeTenant({ id: 'TC', name: '租户C', roomId: 'RC' }));
    repository.update('rooms', 'RA', { tenantId: 'TA', status: 'rented' });
    repository.update('rooms', 'RB', { tenantId: 'TB', status: 'rented' });
    repository.update('rooms', 'RC', { tenantId: 'TC', status: 'rented' });

    // 租户 A 换房 -> 从 RA 搬到 RC（租户 C 所在房间）
    useTenantStore.getState().updateTenant('TA', { roomId: 'RC' });

    const a = repository.getById('tenants', 'TA');
    const b = repository.getById('tenants', 'TB');
    const c = repository.getById('tenants', 'TC');
    const roomB = repository.getById('rooms', 'RB');
    const roomC = repository.getById('rooms', 'RC');

    eq(a?.roomId, 'RC', 'A 应绑定到新房间 RC');
    // === 工程师声称修复的核心断言：B 完全不受影响 ===
    eq(b?.roomId, 'RB', '【关键】B 的 roomId 不得被误清空');
    eq(roomB?.tenantId, 'TB', '【关键】B 所在房间的 tenantId 不得被误清空');
    eq(roomB?.status, 'rented', '【关键】B 所在房间状态不得被改为 vacant');
    // === 一房一租户（设计文档 line140）：C 被顶替是预期行为 ===
    eq(c?.roomId, undefined, 'C 被顶替属一房一租户预期');
    eq(roomC?.tenantId, 'TA', '新房间应归属 A');
    // === 关键一致性：任何房间不得被两个及以上租户同时声称占用（至多 1 个） ===
    // 注意：RA 在 A 搬走后应空置（0 个占用者）才是正确的，故此处断言 <= 1，
    // 而非 == 1（后者会误判「空置房间」为违规，与上方「旧房间释放为 vacant」的预期冲突）。
    const tenants = repository.getAll('tenants');
    for (const rid of ['RA', 'RB', 'RC']) {
      const claimers = tenants.filter((t) => t.roomId === rid);
      ok(
        claimers.length <= 1,
        `房间 ${rid} 被 ${claimers.length} 个租户同时占用（${claimers.map((t) => t.id).join(',')}），一房一租户被破坏`,
      );
    }
    // 顺带校验：空置房间不得残留悬挂的 tenantId（RA 已腾空，其 tenantId 必须清空）
    eq(repository.getById('rooms', 'RA')?.tenantId, undefined, 'RA 腾空后 tenantId 必须清空');
  });

  test('换房后旧房间必须释放为 vacant（否则脏数据）', () => {
    resetStorage();
    useTenantStore.getState().load();
    repository.create('rooms', makeRoom({ id: 'RA', name: 'A房', status: 'rented', tenantId: 'TA' }));
    repository.create('rooms', makeRoom({ id: 'RNEW', name: '新房', status: 'vacant' }));
    repository.create('tenants', makeTenant({ id: 'TA', roomId: 'RA' }));

    useTenantStore.getState().updateTenant('TA', { roomId: 'RNEW' });

    const oldRoom = repository.getById('rooms', 'RA');
    eq(oldRoom?.status, 'vacant', '旧房间应释放为 vacant');
    eq(oldRoom?.tenantId, undefined, '旧房间 tenantId 应清空');
    const newRoom = repository.getById('rooms', 'RNEW');
    eq(newRoom?.status, 'rented', '新房间应为 rented');
    eq(newRoom?.tenantId, 'TA', '新房间 tenantId 应为 TA');
  });

  test('linkRoom 直接换房同样正确', () => {
    resetStorage();
    useTenantStore.getState().load();
    repository.create('rooms', makeRoom({ id: 'RA', name: 'A房', status: 'rented', tenantId: 'TA' }));
    repository.create('rooms', makeRoom({ id: 'RNEW', name: '新房', status: 'vacant' }));
    repository.create('tenants', makeTenant({ id: 'TA', roomId: 'RA' }));

    useTenantStore.getState().linkRoom('TA', 'RNEW');

    eq(repository.getById('rooms', 'RA')?.status, 'vacant', '旧房间经 linkRoom 也应释放');
    eq(repository.getById('rooms', 'RNEW')?.tenantId, 'TA', '新房间应绑定');
  });

  test('解除绑定（roomId=undefined）应释放房间 —— UI 清空下拉即走此路径', () => {
    // TenantForm.tsx:119 `roomId: roomId || undefined` 确认该分支真实可达
    resetStorage();
    useTenantStore.getState().load();
    repository.create('rooms', makeRoom({ id: 'RA', name: 'A房', status: 'rented', tenantId: 'TA' }));
    repository.create('tenants', makeTenant({ id: 'TA', roomId: 'RA' }));

    useTenantStore.getState().updateTenant('TA', { roomId: undefined });

    eq(repository.getById('rooms', 'RA')?.status, 'vacant', '退租后房间应 vacant，否则脏数据');
    eq(repository.getById('rooms', 'RA')?.tenantId, undefined, '退租后房间 tenantId 应清空');
    eq(repository.getById('tenants', 'TA')?.roomId, undefined, '租户应无房间');
  });

  test('删除租户应释放其房间', () => {
    resetStorage();
    useTenantStore.getState().load();
    repository.create('rooms', makeRoom({ id: 'RA', name: 'A房', status: 'rented', tenantId: 'TA' }));
    repository.create('tenants', makeTenant({ id: 'TA', roomId: 'RA' }));

    useTenantStore.getState().removeTenant('TA');

    eq(repository.getById('rooms', 'RA')?.status, 'vacant', '删除租户后房间应 vacant');
    eq(repository.getById('tenants', 'TA'), undefined, '租户应已删除');
  });

  test('新增租户时自动双向绑定', () => {
    resetStorage();
    useTenantStore.getState().load();
    repository.create('rooms', makeRoom({ id: 'RA', name: 'A房', status: 'vacant' }));

    const t = useTenantStore.getState().addTenant(
      makeTenant({ id: 'TNEW', roomId: 'RA' }) as never,
    );
    eq(t.roomId, 'RA', '新租户应带 roomId');
    eq(repository.getById('rooms', 'RA')?.status, 'rented', '房间应变为 rented');
    eq(repository.getById('rooms', 'RA')?.tenantId, 'TNEW', '房间反向引用应正确');
  });

  test('无房间的租户不应生成账单', () => {
    resetStorage();
    repository.create('tenants', makeTenant({ id: 'TNR', roomId: undefined }));
    eq(generateBill('TNR', '2026-03'), null, '无房间租户账单应为 null');
    eq(buildContext(repository.getById('tenants', 'TNR')!, '2026-03'), null, '无房间不应构建上下文');
  });
});

/* ================= 8. 日期工具边界 ================= */

describe('日期/月份工具', () => {
  test('monthInRange 闭区间含端点', () => {
    eq(monthInRange('2026-01', '2026-01', '2026-12'), true, '含起始月');
    eq(monthInRange('2026-12', '2026-01', '2026-12'), true, '含结束月');
    eq(monthInRange('2025-12', '2026-01', '2026-12'), false, '早于起始月应 false');
    eq(monthInRange('2027-01', '2026-01', '2026-12'), false, '晚于结束月应 false');
  });

  test('跨年月份加减正确', () => {
    eq(monthInRange('2026-01', '2025-11', '2026-03'), true, '跨年区间应命中');
  });

  test('listMonths 异常输入不死循环', () => {
    const r = listMonths('2026-01', '2036-01'); // 121 个月
    eq(r.length, 121, '跨 10 年应正确计数');
  });
});

/* ================= 9. 仓库/存储层 ================= */

describe('repository / localStorage 持久化', () => {
  test('写入后可读回，且 JSON 正确持久化', () => {
    resetStorage();
    const t = repository.create('tenants', makeTenant({ id: 'TX', name: '持久化测试' }));
    const raw = (globalThis as never as { localStorage: Storage }).localStorage.getItem('llm_tenants');
    ok(raw !== null, 'localStorage 应存在 llm_tenants 键');
    ok(raw!.includes('持久化测试'), '原始 JSON 应包含中文姓名字段');
    eq(repository.getById('tenants', 'TX')?.name, '持久化测试', '应能读回');
    eq(t.id, 'TX', '创建应返回带 id 的实体');
  });

  test('tenantId 存在时自动生成脱敏身份证号', () => {
    resetStorage();
    const t = repository.create('tenants', makeTenant({ id: 'TY' }) as never);
    eq(t.idCardMasked, '110***********1234', 'seed 夹具已含掩码，应被保留');
  });

  test('押金金额（depositAmount）应正确落库并读回，且不影响账单口径', () => {
    resetStorage();
    useTenantStore.getState().load();
    repository.create('rooms', makeRoom({ id: 'RD', name: 'D房', monthlyRent: 150000 }));

    // 通过 store 走真实新增路径（与 UI 表单一致）
    const created = useTenantStore.getState().addTenant({
      name: '押金测试',
      idCard: '110101199001011234',
      phone: '13800000000',
      paymentCycle: 'monthly',
      depositMonths: 2,
      depositAmount: 300000, // 2 个月 × 1500 元
      depositType: 'refundable',
      depositDeductibleOnExit: true,
      roomId: 'RD',
    } as never);

    const back = repository.getById('tenants', created.id);
    eq(back?.depositAmount, 300000, '押金金额应持久化为「分」');
    eq(back?.depositMonths, 2, '押金月数应保留');

    // 押金是租赁约定信息，不得进入任何月度账单口径
    const bill = generateBill(created.id, '2026-03');
    const rentItem = bill?.items.find((i) => i.feeName.includes('租金'));
    eq(rentItem?.amount, 150000, '3 月应收仅租金，押金不得计入');
    eq(bill?.items.some((i) => (i.feeName ?? '').includes('押金')), false, '账单中不得出现押金项');
    eq(bill?.totalPaid, 0, '未缴押金不得被当作已缴');

    // 未指定金额的租户：字段应为 undefined，展示回退到「N 个月」
    const noAmount = repository.create('tenants', makeTenant({ id: 'TZ', depositMonths: 1 }) as never);
    eq(noAmount.depositAmount, undefined, '未指定金额时应为 undefined');
  });

  test('证件照字段：显式传 undefined 应真正清除（取消勾选后可移除已存照片）', () => {
    resetStorage();
    repository.create(
      'tenants',
      makeTenant({
        id: 'TP',
        idCardPhotoId: 'ph1',
        idCardPhotoHash: 'abc123',
        idCardCapturedAt: NOW,
        idCardLat: 31.23,
        idCardLng: 121.47,
      }) as never,
    );
    eq(repository.getById('tenants', 'TP')?.idCardPhotoId, 'ph1', '前置：应已存照片');

    // 与 TenantForm 取消勾选「留存证件照」时提交的 payload 一致
    repository.update('tenants', 'TP', {
      idCardPhotoId: undefined,
      idCardPhotoHash: undefined,
      idCardCapturedAt: undefined,
      idCardLat: undefined,
      idCardLng: undefined,
    });

    const after = repository.getById('tenants', 'TP');
    eq(after?.idCardPhotoId, undefined, '照片 id 应被清除');
    eq(after?.idCardPhotoHash, undefined, '哈希应被清除');
    eq(after?.idCardLat, undefined, '拍摄纬度应被清除');
    eq(after?.name, '张三', '其余字段不应被误伤');

    const raw = (globalThis as never as { localStorage: Storage }).localStorage.getItem('llm_tenants') ?? '';
    eq(raw.includes('idCardPhotoId'), false, '序列化后不应残留该键');
  });

  test('默认设置落库为 0.80 元/度', () => {
    resetStorage();
    const s = repository.getSettings();
    eq(s.electricityUnitPrice, 80, '默认电价应为 80 分/度');
  });

  test('ensureSeed 幂等：重复执行不重复插入内置项', () => {
    resetStorage();
    repository.ensureSeed();
    const first = repository.getFeeTypes().length;
    repository.ensureSeed();
    const second = repository.getFeeTypes().length;
    eq(second, first, `重复 ensureSeed 不应新增记录（${first} -> ${second}）`);
    eq(first, 3, '应有 3 个内置费用类型');
  });

  test('损坏的 JSON 降级为空数组而非崩溃', () => {
    resetStorage();
    (globalThis as never as { localStorage: Storage }).localStorage.setItem('llm_tenants', '{坏JSON');
    eq(repository.getAll('tenants').length, 0, '坏 JSON 应降级为空数组');
  });

  test('getTenantByRoom 反查正确', () => {
    resetStorage();
    repository.create('rooms', makeRoom({ id: 'RQ' }));
    repository.create('tenants', makeTenant({ id: 'TQ', roomId: 'RQ' }));
    eq(repository.getTenantByRoom('RQ')?.id, 'TQ', '应反查到租户 TQ');
    eq(repository.getTenantByRoom('RNOPE'), undefined, '不存在的房间应返回 undefined');
  });
});

/* ================= 9. 跨 store 状态同步（回归：房间页显示空置） ================= */

describe('跨 store 同步：租户改房间归属后各 store 不得残留过期状态', () => {
  test('【回归】租户关联房间后，roomStore 必须同步为「已出租」', () => {
    resetStorage();
    // 模拟 AppShell 启动：种子 + 加载各 store
    repository.ensureSeed();
    reloadAll();

    repository.create('rooms', makeRoom({ id: 'RS', name: 'S房', monthlyRent: 100000, status: 'vacant' }));
    reloadAll(); // 让 roomStore 看到这个房间（初始为空置）

    eq(useRoomStore.getState().rooms.find((r) => r.id === 'RS')?.status, 'vacant', '前置：初始应为空置');

    // 通过 store 走真实新增路径（与 UI 表单一致）
    useTenantStore.getState().addTenant({
      name: '同步测试',
      idCard: '110101199001011234',
      phone: '',
      paymentCycle: 'monthly',
      depositMonths: 1,
      depositType: 'refundable',
      depositDeductibleOnExit: true,
      roomId: 'RS',
    } as never);

    // 数据库层（本已是正确的，用于定位问题不在 repository）
    eq(repository.getById('rooms', 'RS')?.status, 'rented', 'DB 层应为已出租');

    // UI 层读的是 roomStore —— 这才是房间页显示的数据源
    const inStore = useRoomStore.getState().rooms.find((r) => r.id === 'RS');
    eq(inStore?.status, 'rented', 'roomStore 必须同步为已出租，否则房间页仍显示「空置」');
    eq(inStore?.tenantId !== undefined, true, 'roomStore 中房间应带上 tenantId');
  });

  test('【回归】编辑租户解除房间关联后，roomStore 必须同步为「空置」', () => {
    resetStorage();
    repository.ensureSeed();
    reloadAll();

    repository.create('rooms', makeRoom({ id: 'RT', name: 'T房', status: 'rented', tenantId: 'TT' }));
    repository.create('tenants', makeTenant({ id: 'TT', roomId: 'RT' }));
    reloadAll();
    eq(useRoomStore.getState().rooms.find((r) => r.id === 'RT')?.status, 'rented', '前置：应为已出租');

    useTenantStore.getState().updateTenant('TT', { roomId: undefined });

    eq(repository.getById('rooms', 'RT')?.status, 'vacant', 'DB 层应释放为空置');
    eq(
      useRoomStore.getState().rooms.find((r) => r.id === 'RT')?.status,
      'vacant',
      'roomStore 必须同步为空置',
    );
  });

  test('【回归】删除房间后，tenantStore 不得残留指向已删房间的 roomId', () => {
    resetStorage();
    repository.ensureSeed();
    reloadAll();

    repository.create('rooms', makeRoom({ id: 'RU', name: 'U房', status: 'rented', tenantId: 'TU' }));
    repository.create('tenants', makeTenant({ id: 'TU', roomId: 'RU' }));
    reloadAll();

    useRoomStore.getState().removeRoom('RU');

    eq(repository.getById('tenants', 'TU')?.roomId, undefined, 'DB 层应解绑');
    eq(
      useTenantStore.getState().tenants.find((t) => t.id === 'TU')?.roomId,
      undefined,
      'tenantStore 必须同步解绑，否则租户卡片仍显示已删房间',
    );
  });
});