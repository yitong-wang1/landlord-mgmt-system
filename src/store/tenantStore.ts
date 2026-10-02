/**
 * 租户状态管理（Zustand）。
 * 规则：store 只通过 repository 读写，绝不直接碰 localStorage/IndexedDB。
 */
import { create } from 'zustand';
import type { Tenant } from '../types';
import { repository } from '../db/repository';
import { maskIdCard } from '../utils/mask';
import { uuid } from '../utils/format';
import { registerStore, reloadAll } from './sync';

/** 新增租户入参（自动补全 id/时间戳/脱敏） */
export type TenantInput = Omit<
  Tenant,
  'id' | 'createdAt' | 'updatedAt' | 'idCardMasked'
> & { idCardMasked?: string; id?: string };

interface TenantState {
  tenants: Tenant[];
  load: () => void;
  addTenant: (input: TenantInput) => Tenant;
  updateTenant: (id: string, patch: Partial<Tenant>) => void;
  removeTenant: (id: string) => void;
  getTenant: (id: string) => Tenant | undefined;
  /** 维护房间 <-> 租户 双向引用 */
  linkRoom: (tenantId: string, roomId: string | undefined) => void;
}

/** 计算脱敏身份证号（若为空则留空） */
function withMasked(input: TenantInput): TenantInput {
  return {
    ...input,
    idCardMasked: input.idCard ? maskIdCard(input.idCard) : '',
  };
}

/**
 * 原子地重新分配租户的房间归属，保证「一房一租户 + 双向引用一致」不变量。
 *
 * 覆盖全部归属变更路径（新增绑定 / 换房 / 清空绑定 / 退租）：
 *  1. 目标房间若被**其他**租户占用，先解除那些租户的绑定（一房一租户，被顶替方变为无房间）；
 *  2. 释放旧房间——仅当旧房间的 tenantId 确实指向本租户时，置 vacant 并清空 tenantId；
 *  3. 写入新归属：目标房间 -> rented + tenantId；本租户 -> roomId。
 *
 * @param tenantId 本租户 id
 * @param targetRoomId 目标房间 id；传 undefined / '' 表示解除绑定（退租）
 */
function assignRoom(tenantId: string, targetRoomId?: string): void {
  const tenant = repository.getById('tenants', tenantId);
  if (!tenant) return;

  const oldRoomId = tenant.roomId;
  const nextRoomId = targetRoomId || undefined;

  // 1. 目标房间若被其他租户占用，解除其绑定（排除自己，避免把自己当成占用者）
  if (nextRoomId) {
    const others = repository
      .getAll('tenants')
      .filter((t) => t.id !== tenantId && t.roomId === nextRoomId);
    for (const other of others) {
      repository.update('tenants', other.id, { roomId: undefined });
    }
  }

  // 2. 释放旧房间（换房 / 退租时）
  if (oldRoomId && oldRoomId !== nextRoomId) {
    const oldRoom = repository.getById('rooms', oldRoomId);
    if (oldRoom && oldRoom.tenantId === tenantId) {
      repository.update('rooms', oldRoomId, {
        tenantId: undefined,
        status: 'vacant',
      });
    }
  }

  // 3. 写入新归属
  if (nextRoomId) {
    repository.update('rooms', nextRoomId, {
      tenantId,
      status: 'rented',
    });
  }
  repository.update('tenants', tenantId, { roomId: nextRoomId });
}

export const useTenantStore = create<TenantState>((set) => ({
  tenants: [],

  load: () => set({ tenants: repository.getAll('tenants') }),

  addTenant: (input) => {
    // 创建时不带 roomId，统一由 assignRoom 建立双向引用，避免半初始化状态
    const { roomId, ...rest } = input;
    const tenant = repository.create('tenants', {
      ...withMasked({ ...rest, roomId: undefined } as TenantInput),
      id: input.id ?? uuid(),
      roomId: undefined,
    } as Tenant);
    if (roomId) {
      assignRoom(tenant.id, roomId);
    }
    set({ tenants: repository.getAll('tenants') });
    // 绑定房间会同时改动 rooms（status/tenantId）→ 必须让 roomStore 同步，否则房间页仍显示空置
    reloadAll();
    return repository.getById('tenants', tenant.id) as Tenant;
  },

  updateTenant: (id, patch) => {
    // roomId 走 assignRoom 统一处理（换房/清空绑定），其余字段正常更新。
    // 关键：必须把 roomId 从普通字段更新中剥离，否则 repository.update 会先覆盖
    // roomId，导致后续读到的是「新值」而丢失「旧房间」信息。
    if ('roomId' in patch) {
      const { roomId, ...rest } = patch;
      if (Object.keys(rest).length > 0) {
        repository.update('tenants', id, rest as Partial<Tenant>);
      }
      assignRoom(id, roomId || undefined);
      set({ tenants: repository.getAll('tenants') });
      reloadAll();
      return;
    }
    repository.update('tenants', id, patch);
    set({ tenants: repository.getAll('tenants') });
    reloadAll();
  },

  removeTenant: (id) => {
    const tenant = repository.getById('tenants', id);
    if (tenant?.roomId) {
      const room = repository.getById('rooms', tenant.roomId);
      if (room && room.tenantId === id) {
        repository.update('rooms', tenant.roomId, {
          tenantId: undefined,
          status: 'vacant',
        });
      }
    }
    repository.remove('tenants', id);
    set({ tenants: repository.getAll('tenants') });
    // 释放了房间 → 同步 roomStore
    reloadAll();
  },

  getTenant: (id) => repository.getById('tenants', id),

  linkRoom: (tenantId, roomId) => {
    assignRoom(tenantId, roomId);
    set({ tenants: repository.getAll('tenants') });
    reloadAll();
  },
}));

// 注册到跨 store 同步表：其他 store 变动后可被 reloadAll() 一并刷新
registerStore('tenants', () => useTenantStore.getState().load());