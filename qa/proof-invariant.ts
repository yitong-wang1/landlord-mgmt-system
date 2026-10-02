/**
 * 证明脚本：QA 用例「【重点】A 换到 B 所在房间」中的 I1 断言在逻辑上不可满足。
 *
 * 该用例自身先断言：
 *   a.roomId === 'RC'   （A 已从 RA 搬到 RC）
 *   c.roomId === undefined（C 被顶替，变为无房间）
 * 而租户集合固定为 { TA, TB, TC }，其中 TB.roomId === 'RB'。
 * 由此房间 RA 的占用者必然为空集，claimers.length === 0。
 * 但该用例随后对 ['RA','RB','RC'] 逐个断言 eq(claimers.length, 1)，
 * 对 RA 而言要求恰好 1 个占用者 —— 与上述两条断言直接矛盾，任何正确实现都无法通过。
 *
 * 报错文案「被 N 个租户同时占用…一房一租户被破坏」表明其真实意图是
 * 「不得超过 1 个」，即 ok(claimers.length <= 1)。本脚本输出实测证据。
 */
import { repository } from '../src/db/repository';
import { useTenantStore } from '../src/store/tenantStore';
import type { Room, Tenant } from '../src/types';
import { installLocalStorage, installCrypto, installDom } from './env';

const NOW = '2026-01-01T00:00:00.000Z';
installLocalStorage();
installCrypto();
installDom();

function makeTenant(over: Partial<Tenant> = {}): Tenant {
  return {
    id: 'T1', name: '张三', idCard: '110101199001011234',
    idCardMasked: '110***********1234', phone: '13800000000',
    paymentCycle: 'monthly', depositMonths: 1, depositType: 'refundable',
    depositDeductibleOnExit: true, createdAt: NOW, updatedAt: NOW, ...over,
  };
}
function makeRoom(over: Partial<Room> = {}): Room {
  return { id: 'R1', name: '101', monthlyRent: 150000, status: 'vacant', photoIds: [], createdAt: NOW, ...over };
}

for (const id of ['RA', 'RB', 'RC']) {
  repository.create('rooms', makeRoom({ id, name: id, status: 'vacant' }));
}
repository.create('tenants', makeTenant({ id: 'TA', name: '租户A', roomId: 'RA' }));
repository.create('tenants', makeTenant({ id: 'TB', name: '租户B', roomId: 'RB' }));
repository.create('tenants', makeTenant({ id: 'TC', name: '租户C', roomId: 'RC' }));
repository.update('rooms', 'RA', { tenantId: 'TA', status: 'rented' });
repository.update('rooms', 'RB', { tenantId: 'TB', status: 'rented' });
repository.update('rooms', 'RC', { tenantId: 'TC', status: 'rented' });
useTenantStore.getState().load();

// 执行 A: RA -> RC
useTenantStore.getState().updateTenant('TA', { roomId: 'RC' });

const tenants = repository.getAll('tenants');
const rooms = repository.getAll('rooms');

console.log('=== 换房后真实仓储状态 ===');
for (const t of tenants) {
  console.log(`  租户 ${t.id}(${t.name}) -> roomId=${String(t.roomId)}`);
}
for (const r of rooms) {
  console.log(`  房间 ${r.id}: status=${r.status}, tenantId=${String(r.tenantId)}`);
}

console.log('\n=== 逐房间占用者数（I1 断言 eq(claimers.length, 1)）===');
let contradiction = false;
for (const rid of ['RA', 'RB', 'RC']) {
  const claimers = tenants.filter((t) => t.roomId === rid);
  const expect = 1;
  const pass = claimers.length === expect;
  if (!pass) contradiction = true;
  console.log(
    `  ${rid}: claimers=${claimers.length} [${claimers.map((t) => t.id).join(',')}] ` +
      `-> eq(...,${expect}) ${pass ? 'PASS' : 'FAIL'}`,
  );
}

console.log('\n=== 真实不变量（至多 1 个占用者）是否成立 ===');
let maxClaim = 0;
for (const rid of ['RA', 'RB', 'RC']) {
  const n = tenants.filter((t) => t.roomId === rid).length;
  maxClaim = Math.max(maxClaim, n);
  console.log(`  ${rid}: ${n} 个占用者 -> ${n <= 1 ? 'OK（不变量成立）' : '破坏一房一租户'}`);
}
for (const r of rooms) {
  if (!r.tenantId) {
    console.log(`  房间 ${r.id} 已释放: status=${r.status} -> ${r.status === 'vacant' ? 'OK(vacant)' : '脏数据!'}`);
  }
}
console.log(`\n最大同时占用者数 = ${maxClaim}（一房一租户要求 <= 1，满足）`);

if (contradiction) {
  console.log(
    '\n结论：RA 的 claimers 必然为 0（因 TA 已搬到 RC、TC 被顶替为 undefined），' +
      '而用例断言 RA 必须恰好 1 个占用者。\n' +
      '=> 该断言与其自身前两条断言矛盾，不可满足；正确写法应为 ok(claimers.length <= 1)。',
  );
}