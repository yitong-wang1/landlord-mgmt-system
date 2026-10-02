/**
 * 费用状态管理（Zustand）：费用类型 + 抄表记录 + 供暖费。store 只通过 repository 读写。
 */
import { create } from 'zustand';
import type {
  FeeType,
  HeatingFee,
  MeterRecord,
  MonthStr,
} from '../types';
import { repository } from '../db/repository';
import { uuid, nowISO } from '../utils/format';
import { registerStore } from './sync';

export type FeeTypeInput = Omit<FeeType, 'id' | 'createdAt'> & { id?: string };
export type MeterRecordInput = Omit<MeterRecord, 'id' | 'recordedAt'> & {
  id?: string;
};
export type HeatingFeeInput = Omit<HeatingFee, 'id'> & { id?: string };

interface FeeState {
  feeTypes: FeeType[];
  meterRecords: MeterRecord[];
  heatingFees: HeatingFee[];
  load: () => void;

  addFeeType: (input: FeeTypeInput) => FeeType;
  updateFeeType: (id: string, patch: Partial<FeeType>) => void;
  removeFeeType: (id: string) => void;

  /** 保存抄表记录（同一房间同一月份唯一，自动 upsert） */
  saveMeterRecord: (input: MeterRecordInput) => MeterRecord;
  removeMeterRecord: (id: string) => void;
  getMeterRecord: (roomId: string, month: MonthStr) => MeterRecord | undefined;

  /** 保存供暖费（同一房间+租户+供暖年唯一，自动 upsert） */
  saveHeatingFee: (input: HeatingFeeInput) => HeatingFee;
  updateHeatingFee: (id: string, patch: Partial<HeatingFee>) => void;
  removeHeatingFee: (id: string) => void;

  /** 将自定义费用应用到「该 scope 下全部」目标（appliesTo 置空表示全部） */
  applyCustomFeeToAll: (feeTypeId: string) => void;
}

export const useFeeStore = create<FeeState>((set, get) => ({
  feeTypes: [],
  meterRecords: [],
  heatingFees: [],

  load: () =>
    set({
      feeTypes: repository.getFeeTypes(),
      meterRecords: repository.getAll('meterRecords'),
      heatingFees: repository.getAll('heatingFees'),
    }),

  addFeeType: (input) => {
    const fee = repository.create('feeTypes', {
      ...input,
      id: input.id ?? uuid(),
    } as FeeType);
    set({ feeTypes: repository.getFeeTypes() });
    return fee;
  },

  updateFeeType: (id, patch) => {
    repository.update('feeTypes', id, patch);
    set({ feeTypes: repository.getFeeTypes() });
  },

  removeFeeType: (id) => {
    repository.remove('feeTypes', id);
    set({ feeTypes: repository.getFeeTypes() });
  },

  saveMeterRecord: (input) => {
    const existing = get().meterRecords.find(
      (m) => m.roomId === input.roomId && m.month === input.month,
    );
    let rec: MeterRecord;
    if (existing) {
      rec = repository.update('meterRecords', existing.id, {
        prevReading: input.prevReading,
        currReading: input.currReading,
        usage: input.usage,
        photoId: input.photoId,
        photoHash: input.photoHash,
        capturedAt: input.capturedAt,
        lat: input.lat,
        lng: input.lng,
        recordedAt: nowISO(),
      }) as MeterRecord;
    } else {
      rec = repository.create('meterRecords', {
        ...input,
        id: input.id ?? uuid(),
        recordedAt: nowISO(),
      } as MeterRecord);
    }
    set({ meterRecords: repository.getAll('meterRecords') });
    return rec;
  },

  removeMeterRecord: (id) => {
    repository.remove('meterRecords', id);
    set({ meterRecords: repository.getAll('meterRecords') });
  },

  getMeterRecord: (roomId, month) =>
    repository.getMeterRecords(roomId, month)[0],

  saveHeatingFee: (input) => {
    const existing = get().heatingFees.find(
      (h) =>
        h.roomId === input.roomId &&
        h.tenantId === input.tenantId &&
        h.year === input.year,
    );
    let hf: HeatingFee;
    if (existing) {
      hf = repository.update('heatingFees', existing.id, {
        status: input.status,
        amount: input.amount,
        paidAmount: input.paidAmount,
        paidDate: input.paidDate,
      }) as HeatingFee;
    } else {
      hf = repository.create('heatingFees', {
        ...input,
        id: input.id ?? uuid(),
      } as HeatingFee);
    }
    set({ heatingFees: repository.getAll('heatingFees') });
    return hf;
  },

  updateHeatingFee: (id, patch) => {
    repository.update('heatingFees', id, patch);
    set({ heatingFees: repository.getAll('heatingFees') });
  },

  removeHeatingFee: (id) => {
    repository.remove('heatingFees', id);
    set({ heatingFees: repository.getAll('heatingFees') });
  },

  applyCustomFeeToAll: (feeTypeId) => {
    get().updateFeeType(feeTypeId, { appliesTo: [] });
  },
}));

// 注册到跨 store 同步表
registerStore('fees', () => useFeeStore.getState().load());
