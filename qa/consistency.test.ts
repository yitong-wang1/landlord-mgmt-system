/**
 * 租户 <-> 房间 一致性不变量测试（QA 补充检查点）。
 *
 * 覆盖「任何修改租户房间归属的路径」：
 *   新增绑定(addTenant) / 换房(updateTenant 改 roomId) / 清空绑定(roomId=undefined，退租)
 *   / linkRoom 直接调用 / removeTenant(退租删除)
 *
 * 每条路径结束后统一断言三条不变量：
 *   I1 每个房间至多 1 个租户声称占用（一房一租户）
 *   I2 双向一致：tenant.roomId === rid  <=>  room.tenantId === tenant.id
 *   I3 占用状态自洽：有 tenantId 必为 rented；无 tenantId 必为 vacant（被腾出的房间为 vacant）
 */
import { repository } from '../src/db/repository';
import { useTenantStore } from '../src/store/tenantStore';
import { useRoomStore } from '../src/store/roomStore';
import type { Room, Tenant } from '../src/types';
import { describe, test, ok, eq } from './harness';
import { resetStorage } from './env';

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
    monthlyRent: 150000,
    status: 'vacant',
    photoIds: [],
    createdAt: NOW,
    ...over,
  };
}

/**
 * 全量一致性断言。任一不变量被破坏即抛错。
 * @param stage 当前操作阶段名，用于定位失败原因
 */
function assertInvariants(stage: string): void {
  const tenants = repository.getAll('tenants');
  const rooms = repository.getAll('rooms');

  for (const room of rooms) {
    // I1：一个房间至多 1 个租户声称占用
    const claimers = tenants.filter((t) => t.roomId === room.id);
    ok(
      claimers.length <= 1,
      `[${stage}] I1 破坏：房间 ${room.id} 被 ${claimers.length} 个租户同时占用（${claimers
        .map((t) => t.id)
        .join(',')}）`,
    );

    // I2：双向一致
    if (room.tenantId) {
      const owner = tenants.find((t) => t.id === room.tenantId);
      ok(owner, `[${stage}] I2 破坏：房间 ${room.id}.tenantId=${room.tenantId} 指向不存在的租户`);
      eq(
        owner?.roomId,
        room.id,
        `[${stage}] I2 破坏：房间 ${room.id} 指向 ${room.tenantId}，但该租户.roomId=${String(
          owner?.roomId,
        )}`,
      );
    }

    // I3：占用状态自洽
    if (room.tenantId) {
      eq(room.status, 'rented', `[${stage}] I3 破坏：房间 ${room.id} 已被 ${room.tenantId} 占用但状态非 rented`);
    } else {
      eq(room.status, 'vacant', `[${stage}] I3 破坏：房间 ${room.id} 无人占用却为 ${room.status}（应为 vacant）`);
    }
  }

  // 反向 I2：租户指向的房间必须回指该租户
  for (const t of tenants) {
    if (!t.roomId) continue;
    const room = rooms.find((r) => r.id === t.roomId);
    ok(room, `[${stage}] I2 反向破坏：租户 ${t.id}.roomId=${t.roomId} 指向不存在的房间`);
    eq(
      room?.tenantId,
      t.id,
      `[${stage}] I2 反向破坏：租户 ${t.id} 占用 ${t.roomId}，但该房间.tenantId=${String(room?.tenantId)}`,
    );
  }
}

/** 建 3 房间 + 3 租户各占一间的初始场景 */
function seedThreeRooms(): void {
  for (const id of ['RA', 'RB', 'RC']) {
    repository.create('rooms', makeRoom({ id, name: id, status: 'vacant' }));
  }
  repository.create('tenants', makeTenant({ id: 'TA', name: '租户A', roomId: undefined }));
  repository.create('tenants', makeTenant({ id: 'TB', name: '租户B', roomId: undefined }));
  repository.create('tenants', makeTenant({ id: 'TC', name: '租户C', roomId: undefined }));
}

describe('租户-房间一致性不变量（新增绑定/换房/清空绑定/退租）', () => {
  test('新增绑定：addTenant 绑定房间后不变量成立', () => {
    resetStorage();
    useTenantStore.getState().load();
    repository.create('rooms', makeRoom({ id: 'RA', name: 'A房', status: 'vacant' }));

    useTenantStore.getState().addTenant(makeTenant({ id: 'TA', name: '租户A', roomId: 'RA' }));

    eq(repository.getById('rooms', 'RA')?.tenantId, 'TA', '新绑定：房间应归属该租户');
    eq(repository.getById('rooms', 'RA')?.status, 'rented', '新绑定：房间应为 rented');
    assertInvariants('新增绑定');
  });

  test('换房：TA 从 RA 搬到空房 RNEW 后不变量成立（旧房 vacant）', () => {
    resetStorage();
    useTenantStore.getState().load();
    repository.create('rooms', makeRoom({ id: 'RA', name: 'A房', status: 'rented', tenantId: 'TA' }));
    repository.create('rooms', makeRoom({ id: 'RNEW', name: '新房', status: 'vacant' }));
    repository.create('tenants', makeTenant({ id: 'TA', roomId: 'RA' }));

    useTenantStore.getState().updateTenant('TA', { roomId: 'RNEW' });

    eq(repository.getById('rooms', 'RA')?.status, 'vacant', '换房：旧房应 vacant');
    eq(repository.getById('rooms', 'RA')?.tenantId, undefined, '换房：旧房 tenantId 应清空');
    eq(repository.getById('rooms', 'RNEW')?.tenantId, 'TA', '换房：新房归属 TA');
    assertInvariants('换房-到空房');
  });

  test('换房：TA 搬到 TA2 占用的房间（顶替）后不变量成立', () => {
    resetStorage();
    seedThreeRooms();
    // 先用 store 建立合法绑定，避免手写脏状态
    useTenantStore.getState().updateTenant('TA', { roomId: 'RA' });
    useTenantStore.getState().updateTenant('TB', { roomId: 'RB' });
    useTenantStore.getState().updateTenant('TC', { roomId: 'RC' });
    assertInvariants('换房-初始');

    // TA 顶替到 RC
    useTenantStore.getState().updateTenant('TA', { roomId: 'RC' });

    eq(repository.getById('rooms', 'RC')?.tenantId, 'TA', '顶替后 RC 归 TA');
    eq(repository.getById('tenants', 'TC')?.roomId, undefined, '被顶替方 TC 应变为无房间');
    assertInvariants('换房-顶替');
  });

  test('换房：无关租户完全不受影响，且不变量成立', () => {
    resetStorage();
    seedThreeRooms();
    useTenantStore.getState().updateTenant('TA', { roomId: 'RA' });
    useTenantStore.getState().updateTenant('TB', { roomId: 'RB' });
    useTenantStore.getState().updateTenant('TC', { roomId: 'RC' });
    repository.create('rooms', makeRoom({ id: 'RNEW', name: '新房', status: 'vacant' }));

    // 换房 + 同时改其它字段
    useTenantStore.getState().updateTenant('TA', { roomId: 'RNEW', name: '租户A改名' });

    eq(repository.getById('tenants', 'TB')?.roomId, 'RB', 'TB 不受影响');
    eq(repository.getById('rooms', 'RB')?.tenantId, 'TB', 'TB 的房间不受影响');
    eq(repository.getById('tenants', 'TA')?.name, '租户A改名', '换房同时改名应生效');
    eq(repository.getById('rooms', 'RNEW')?.tenantId, 'TA', '新房归 TA');
    assertInvariants('换房-无关租户');
  });

  test('清空绑定（退租，UI 清空下拉）：房间必须释放为 vacant', () => {
    resetStorage();
    useTenantStore.getState().load();
    repository.create('rooms', makeRoom({ id: 'RA', name: 'A房', status: 'rented', tenantId: 'TA' }));
    repository.create('tenants', makeTenant({ id: 'TA', roomId: 'RA' }));

    // 对应 TenantForm 的 `roomId: roomId || undefined`
    useTenantStore.getState().updateTenant('TA', { roomId: undefined });

    eq(repository.getById('tenants', 'TA')?.roomId, undefined, '清空绑定：租户应无房间');
    eq(repository.getById('rooms', 'RA')?.tenantId, undefined, '清空绑定：房间 tenantId 应清空');
    eq(repository.getById('rooms', 'RA')?.status, 'vacant', '清空绑定：房间应 vacant');
    assertInvariants('清空绑定');
  });

  test('linkRoom 直接换房：旧房释放 + 不变量成立', () => {
    resetStorage();
    useTenantStore.getState().load();
    repository.create('rooms', makeRoom({ id: 'RA', name: 'A房', status: 'rented', tenantId: 'TA' }));
    repository.create('rooms', makeRoom({ id: 'RNEW', name: '新房', status: 'vacant' }));
    repository.create('tenants', makeTenant({ id: 'TA', roomId: 'RA' }));

    useTenantStore.getState().linkRoom('TA', 'RNEW');

    eq(repository.getById('rooms', 'RA')?.status, 'vacant', 'linkRoom：旧房应 vacant');
    eq(repository.getById('rooms', 'RNEW')?.tenantId, 'TA', 'linkRoom：新房归 TA');
    assertInvariants('linkRoom 换房');
  });

  test('linkRoom 解除绑定（undefined）：房间释放为 vacant', () => {
    resetStorage();
    useTenantStore.getState().load();
    repository.create('rooms', makeRoom({ id: 'RA', name: 'A房', status: 'rented', tenantId: 'TA' }));
    repository.create('tenants', makeTenant({ id: 'TA', roomId: 'RA' }));

    useTenantStore.getState().linkRoom('TA', undefined);

    eq(repository.getById('rooms', 'RA')?.status, 'vacant', 'linkRoom 解绑：房间应 vacant');
    eq(repository.getById('rooms', 'RA')?.tenantId, undefined, 'linkRoom 解绑：tenantId 应清空');
    assertInvariants('linkRoom 解绑');
  });

  test('退租删除（removeTenant）：房间释放为 vacant 且不变量成立', () => {
    resetStorage();
    useTenantStore.getState().load();
    repository.create('rooms', makeRoom({ id: 'RA', name: 'A房', status: 'rented', tenantId: 'TA' }));
    repository.create('tenants', makeTenant({ id: 'TA', roomId: 'RA' }));

    useTenantStore.getState().removeTenant('TA');

    eq(repository.getAll('tenants').length, 0, '退租：租户应已删除');
    eq(repository.getById('rooms', 'RA')?.status, 'vacant', '退租：房间应 vacant');
    eq(repository.getById('rooms', 'RA')?.tenantId, undefined, '退租：tenantId 应清空');
    assertInvariants('退租删除');
  });

  test('多租户连续换房 10 次后不变量始终成立（压力/幂等）', () => {
    resetStorage();
    useTenantStore.getState().load();
    for (const id of ['RA', 'RB', 'RC']) {
      repository.create('rooms', makeRoom({ id, name: id, status: 'vacant' }));
    }
    repository.create('tenants', makeTenant({ id: 'TA', roomId: undefined }));

    const seq = ['RA', 'RB', 'RC', 'RA', 'RB', 'RC', undefined, 'RA', undefined, 'RC'];
    for (let i = 0; i < seq.length; i++) {
      useTenantStore.getState().updateTenant('TA', { roomId: seq[i] });
      assertInvariants(`连续换房第 ${i + 1} 步(->${String(seq[i])})`);
    }
    eq(repository.getById('rooms', 'RC')?.tenantId, 'TA', '末态：RC 归 TA');
    eq(repository.getById('tenants', 'TA')?.roomId, 'RC', '末态：TA 在 RC');
  });

  test('房间删除后不残留悬挂 tenantId 引用', () => {
    resetStorage();
    useTenantStore.getState().load();
    repository.create('rooms', makeRoom({ id: 'RA', name: 'A房', status: 'rented', tenantId: 'TA' }));
    repository.create('tenants', makeTenant({ id: 'TA', roomId: 'RA' }));

    // 删除房间应同步解除租户绑定，避免悬挂引用
    useRoomStore.getState().load();
    useRoomStore.getState().removeRoom('RA');

    eq(repository.getById('tenants', 'TA')?.roomId, undefined, '删房后租户不应悬挂引用已删房间');
    assertInvariants('删除房间');
  });
});