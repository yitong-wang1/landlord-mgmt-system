/**
 * 房间状态管理（Zustand）。store 只通过 repository 读写。
 */
import { create } from 'zustand';
import type { Room } from '../types';
import { repository } from '../db/repository';
import { uuid } from '../utils/format';
import { registerStore, reloadAll } from './sync';

export type RoomInput = Omit<Room, 'id' | 'createdAt'> & { id?: string };

interface RoomState {
  rooms: Room[];
  load: () => void;
  addRoom: (input: RoomInput) => Room;
  updateRoom: (id: string, patch: Partial<Room>) => void;
  removeRoom: (id: string) => void;
  getRoom: (id: string) => Room | undefined;
  /** 房间照片管理 */
  addRoomPhoto: (roomId: string, photoId: string) => void;
  removeRoomPhoto: (roomId: string, photoId: string) => void;
}

export const useRoomStore = create<RoomState>((set) => ({
  rooms: [],

  load: () => set({ rooms: repository.getAll('rooms') }),

  addRoom: (input) => {
    const room = repository.create('rooms', {
      ...input,
      id: input.id ?? uuid(),
      photoIds: input.photoIds ?? [],
    } as Room);
    set({ rooms: repository.getAll('rooms') });
    return room;
  },

  updateRoom: (id, patch) => {
    repository.update('rooms', id, patch);
    set({ rooms: repository.getAll('rooms') });
  },

  removeRoom: (id) => {
    // 解绑占用该房间的租户
    const tenant = repository.getTenantByRoom(id);
    if (tenant) {
      repository.update('tenants', tenant.id, { roomId: undefined });
      repository.update('rooms', id, { tenantId: undefined, status: 'vacant' });
    }
    repository.remove('rooms', id);
    set({ rooms: repository.getAll('rooms') });
    // 解绑了租户 → 必须让 tenantStore 同步，否则租户卡片仍显示已删除的房间
    reloadAll();
  },

  getRoom: (id) => repository.getById('rooms', id),

  addRoomPhoto: (roomId, photoId) => {
    const room = repository.getById('rooms', roomId);
    if (!room) return;
    const photoIds = room.photoIds.includes(photoId)
      ? room.photoIds
      : [...room.photoIds, photoId];
    repository.update('rooms', roomId, { photoIds });
    set({ rooms: repository.getAll('rooms') });
  },

  removeRoomPhoto: (roomId, photoId) => {
    const room = repository.getById('rooms', roomId);
    if (!room) return;
    repository.update('rooms', roomId, {
      photoIds: room.photoIds.filter((p) => p !== photoId),
    });
    set({ rooms: repository.getAll('rooms') });
  },
}));

// 注册到跨 store 同步表
registerStore('rooms', () => useRoomStore.getState().load());
