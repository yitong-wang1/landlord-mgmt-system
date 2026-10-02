/**
 * 根因定位脚本：复现 updateTenant 换房后的仓储真实状态。
 */
const store = new Map<string, string>();
(globalThis as never as { localStorage: Storage }).localStorage = {
  get length() { return store.size; },
  key: (i: number) => [...store.keys()][i] ?? null,
  getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
} as never as Storage;

import { repository } from '../src/db/repository';
import { useTenantStore } from '../src/store/tenantStore';

const NOW = '2026-01-01T00:00:00.000Z';
const tenant = (id: string, roomId?: string) => ({
  id, name: id, idCard: '110101199001011234', idCardMasked: '110***',
  phone: '13800000000', paymentCycle: 'monthly' as const, depositMonths: 1,
  depositType: 'refundable' as const, depositDeductibleOnExit: true,
  roomId, createdAt: NOW, updatedAt: NOW,
});
const room = (id: string, status: string, tenantId?: string) => ({
  id, name: id, monthlyRent: 150000, status: status as never,
  tenantId, photoIds: [], createdAt: NOW,
});

console.log('=== 场景：A 从 RA 换房到 RC（C 原占用 RC） ===\n');

repository.create('rooms', room('RA', 'rented', 'TA'));
repository.create('rooms', room('RC', 'rented', 'TC'));
repository.create('tenants', tenant('TA', 'RA'));
repository.create('tenants', tenant('TC', 'RC'));

const dump = (label: string) => {
  const t = repository.getAll('tenants').map((x) => `${x.id}->${x.roomId ?? '(空)'}`);
  const r = repository.getAll('rooms').map((x) => `${x.id}:status=${x.status},tenant=${x.tenantId ?? '(空)'}`);
  console.log(`[${label}]`);
  console.log('  租户:', t.join('  |  '));
  console.log('  房间:', r.join('  |  '));
};

dump('换房前');

useTenantStore.getState().updateTenant('TA', { roomId: 'RC' });

console.log('\n--- 执行 updateTenant("TA", { roomId: "RC" }) 后 ---');
dump('换房后');

const rooms = repository.getAll('rooms');
const tenants = repository.getAll('tenants');
const problems: string[] = [];

const ra = rooms.find((r) => r.id === 'RA')!;
if (ra.status !== 'vacant') problems.push(`旧房间 RA 未释放：status=${ra.status}（应为 vacant）`);
if (ra.tenantId !== undefined) problems.push(`旧房间 RA 仍指向已搬走的 TA：tenantId=${ra.tenantId}`);

const rc = rooms.find((r) => r.id === 'RC')!;
const tc = tenants.find((t) => t.id === 'TC')!;
if (tc.roomId === rc.id) {
  problems.push(`房间 RC 一房两户：RC.tenantId=${rc.tenantId} 但租户 TC.roomId 仍为 ${tc.roomId}`);
}
const claimedBy = tenants.filter((t) => t.roomId === 'RC').map((t) => t.id);
if (claimedBy.length > 1) problems.push(`多个租户同时声称占用 RC：${claimedBy.join(',')}`);

console.log('\n=== 结论 ===');
if (problems.length === 0) {
  console.log('PASS：换房后数据一致');
} else {
  console.log('FAIL：检出 ' + problems.length + ' 处数据不一致');
  for (const p of problems) console.log('  * ' + p);
}

console.log('\n=== 根因验证：prev 读取时机 ===');
const before = JSON.parse((globalThis as never as { localStorage: Storage }).localStorage.getItem('llm_tenants')!);
console.log('updateTenant 中 repository.update 先于 prev 读取，');
console.log('故 prev.roomId 已等于新 roomId，旧房间解绑分支永不执行。');
console.log('当前 tenants 快照 roomId:', before.map((t: { id: string; roomId?: string }) => `${t.id}=${t.roomId}`).join(', '));