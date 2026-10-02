/**
 * 数据访问抽象层（Repository 模式）。
 *
 * 设计要点（系统设计文档第 4 节）：
 * - 所有结构化读写唯一入口；上层（store/service）只依赖本层，绝不直接碰存储。
 * - 结构化数据 -> localStore(localStorage)；照片 Blob -> photoDB(IndexedDB)。
 * - 预留「云端同步 seam」：未来可选同步只替换/扩展本层，上层无感（MVP 不实现）。
 *
 * 实体集合键名与 types.EntityMap 对齐。
 */
import {
  type BackupData,
  type Bill,
  type EntityKey,
  type EntityMap,
  type FeeType,
  type HeatingFee,
  type MeterRecord,
  type Payment,
  type Room,
  type Settings,
  type Tenant,
} from '../types';
import { collection } from './localStore';
import { uuid, nowISO } from '../utils/format';

/** 各实体在 localStorage 的集合键 */
const COLLECTION_KEYS: Record<EntityKey, string> = {
  tenants: 'tenants',
  rooms: 'rooms',
  feeTypes: 'feeTypes',
  meterRecords: 'meterRecords',
  heatingFees: 'heatingFees',
  payments: 'payments',
  bills: 'bills',
};

const SETTINGS_KEY = 'settings';
export const SCHEMA_VERSION = 1;

export const DEFAULT_SETTINGS: Settings = {
  id: 'app',
  electricityUnitPrice: 80, // 0.80 元/度（分）
  landlordName: '房东',
  schemaVersion: SCHEMA_VERSION,
};

/* -------------------- 云端同步 seam（MVP 为空） -------------------- */

export interface SyncAdapter {
  push?: (data: BackupData) => Promise<void>;
  pull?: () => Promise<BackupData | null>;
}

let syncAdapter: SyncAdapter | null = null;

/** 注册可选云端同步适配器（MVP 默认不注册） */
export function setSyncAdapter(adapter: SyncAdapter | null): void {
  syncAdapter = adapter;
}

/** 变更后尝试推送（fire-and-forget，不阻塞主流程） */
function notifySync(): void {
  if (syncAdapter?.push) {
    void syncAdapter.push(repository.getAllEntities()).catch((err) => {
      console.warn('[repository] 云端同步失败（已忽略）', err);
    });
  }
}

/* -------------------- 通用集合读写 -------------------- */

function readCollection<K extends EntityKey>(key: K): EntityMap[K][] {
  return collection.getAll<EntityMap[K]>(COLLECTION_KEYS[key]);
}

function writeCollection<K extends EntityKey>(
  key: K,
  items: EntityMap[K][],
): void {
  collection.setAll(COLLECTION_KEYS[key], items);
  notifySync();
}

/* -------------------- 各实体 CRUD -------------------- */

export const repository = {
  /** 读取某实体集合 */
  getAll<K extends EntityKey>(key: K): EntityMap[K][] {
    return readCollection(key);
  },

  /** 按 id 查询 */
  getById<K extends EntityKey>(
    key: K,
    id: string,
  ): EntityMap[K] | undefined {
    return readCollection(key).find((e) => (e as { id: string }).id === id);
  },

  /** 新建（自动补全 id/时间戳） */
  create<K extends EntityKey>(key: K, entity: EntityMap[K]): EntityMap[K] {
    const items = readCollection(key);
    const now = nowISO();
    const withId = {
      ...entity,
      id: (entity as { id?: string }).id ?? uuid(),
    } as EntityMap[K] & { createdAt?: string; updatedAt?: string };
    // 若实体含时间戳字段则补全
    if ('createdAt' in withId && !(withId as { createdAt?: string }).createdAt) {
      (withId as { createdAt: string }).createdAt = now;
    }
    if ('updatedAt' in withId) {
      (withId as { updatedAt: string }).updatedAt = now;
    }
    items.push(withId);
    writeCollection(key, items);
    return withId;
  },

  /** 更新（按 id 全量替换该条） */
  update<K extends EntityKey>(
    key: K,
    id: string,
    patch: Partial<EntityMap[K]>,
  ): EntityMap[K] | undefined {
    const items = readCollection(key);
    const idx = items.findIndex((e) => (e as { id: string }).id === id);
    if (idx < 0) return undefined;
    const updated = {
      ...items[idx],
      ...patch,
      id,
    } as EntityMap[K] & { updatedAt?: string };
    if ('updatedAt' in updated) {
      (updated as { updatedAt: string }).updatedAt = nowISO();
    }
    items[idx] = updated;
    writeCollection(key, items);
    return updated;
  },

  /** 不存在则创建、存在则更新（按 id 判重） */
  upsert<K extends EntityKey>(
    key: K,
    entity: EntityMap[K],
  ): EntityMap[K] {
    const id = (entity as { id?: string }).id;
    if (!id || !repository.getById(key, id)) {
      return repository.create(key, entity);
    }
    // 更新时不覆盖 id
    const patch = { ...(entity as object) } as Partial<EntityMap[K]> & { id?: string };
    delete patch.id;
    return repository.update(key, id, patch) as EntityMap[K];
  },

  /** 删除 */
  remove<K extends EntityKey>(key: K, id: string): void {
    const items = readCollection(key).filter(
      (e) => (e as { id: string }).id !== id,
    );
    writeCollection(key, items);
  },

  /* -------------------- 领域查询 -------------------- */

  /** 通过房间 id 找到占用租户 */
  getTenantByRoom(roomId: string): Tenant | undefined {
    return readCollection('tenants').find((t) => t.roomId === roomId);
  },

  /** 全部费用类型 */
  getFeeTypes(): FeeType[] {
    return readCollection('feeTypes');
  },

  /** 抄表记录（可按房间+月份过滤） */
  getMeterRecords(roomId?: string, month?: string): MeterRecord[] {
    return readCollection('meterRecords').filter(
      (m) =>
        (roomId == null || m.roomId === roomId) &&
        (month == null || m.month === month),
    );
  },

  /** 供暖费（可按租户过滤） */
  getHeatingFees(tenantId?: string): HeatingFee[] {
    if (tenantId == null) return readCollection('heatingFees');
    return readCollection('heatingFees').filter(
      (h) => h.tenantId === tenantId,
    );
  },

  /** 缴费记录（可按租户+月份过滤） */
  getPayments(tenantId?: string, month?: string): Payment[] {
    return readCollection('payments').filter(
      (p) =>
        (tenantId == null || p.tenantId === tenantId) &&
        (month == null || p.billMonth === month),
    );
  },

  /** 账单（可按租户+月份过滤） */
  getBills(tenantId?: string, month?: string): Bill[] {
    return readCollection('bills').filter(
      (b) =>
        (tenantId == null || b.tenantId === tenantId) &&
        (month == null || b.month === month),
    );
  },

  /** 读取设置（缺省返回默认值并落库） */
  getSettings(): Settings {
    const existing = collection.getRaw<Settings>(SETTINGS_KEY);
    if (!existing) {
      collection.setRaw(SETTINGS_KEY, DEFAULT_SETTINGS);
      return { ...DEFAULT_SETTINGS };
    }
    return { ...DEFAULT_SETTINGS, ...existing };
  },

  /** 保存设置 */
  saveSettings(settings: Settings): Settings {
    collection.setRaw(SETTINGS_KEY, settings);
    notifySync();
    return settings;
  },

  /* -------------------- 备份 / 恢复 -------------------- */

  /** 导出全部结构化实体（不含照片 Blob，照片由备份服务单独处理） */
  getAllEntities(): BackupData {
    return {
      tenants: readCollection('tenants'),
      rooms: readCollection('rooms'),
      feeTypes: readCollection('feeTypes'),
      meterRecords: readCollection('meterRecords'),
      heatingFees: readCollection('heatingFees'),
      payments: readCollection('payments'),
      bills: readCollection('bills'),
      settings: repository.getSettings(),
    };
  },

  /** 整体覆盖写入（导入备份时使用） */
  replaceAll(data: BackupData): void {
    writeCollection('tenants', data.tenants ?? []);
    writeCollection('rooms', data.rooms ?? []);
    writeCollection('feeTypes', data.feeTypes ?? []);
    writeCollection('meterRecords', data.meterRecords ?? []);
    writeCollection('heatingFees', data.heatingFees ?? []);
    writeCollection('payments', data.payments ?? []);
    writeCollection('bills', data.bills ?? []);
    if (data.settings) {
      repository.saveSettings(data.settings);
    }
  },

  /* -------------------- 初始化 / 种子数据 -------------------- */

  /** 确保内置费用类型已存在（rent/electricity/heating）。仅需执行一次。 */
  ensureSeed(): void {
    const feeTypes = repository.getFeeTypes();
    const builtins: FeeType[] = [
      {
        id: 'builtin-rent',
        name: '租金',
        category: 'rent',
        isBuiltin: true,
        billingMode: 'cycle',
        createdAt: nowISO(),
      },
      {
        id: 'builtin-electricity',
        name: '电费',
        category: 'electricity',
        isBuiltin: true,
        billingMode: 'usage',
        unit: '度',
        createdAt: nowISO(),
      },
      {
        id: 'builtin-heating',
        name: '供暖费',
        category: 'heating',
        isBuiltin: true,
        billingMode: 'cycle',
        createdAt: nowISO(),
      },
    ];
    const existingIds = new Set(feeTypes.map((f) => f.id));
    const merged = [...feeTypes];
    for (const b of builtins) {
      if (!existingIds.has(b.id)) merged.push(b);
    }
    writeCollection('feeTypes', merged);
  },
};
