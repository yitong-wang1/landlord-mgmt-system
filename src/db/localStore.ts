/**
 * localStorage 读写封装（结构化数据）。
 *
 * 所有结构化实体（tenant/room/...）都序列化为 JSON 数组存于 localStorage。
 * 统一加前缀，便于隔离与清空。同步 API，简单可靠（数据量极小）。
 */

const PREFIX = 'llm_'; // landlord-mgmt

function fullKey(key: string): string {
  return `${PREFIX}${key}`;
}

/** 读取 JSON 值，失败时返回 fallback */
export function getJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(fullKey(key));
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch (err) {
    console.error('[localStore] 读取失败', key, err);
    return fallback;
  }
}

/** 写入 JSON 值 */
export function setJSON<T>(key: string, value: T): void {
  try {
    localStorage.setItem(fullKey(key), JSON.stringify(value));
  } catch (err) {
    console.error('[localStore] 写入失败', key, err);
    throw err;
  }
}

/** 删除指定键 */
export function removeKey(key: string): void {
  localStorage.removeItem(fullKey(key));
}

/** 列出本应用命名空间下的所有键（不含前缀） */
export function listKeys(): string[] {
  const result: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(PREFIX)) {
      result.push(k.slice(PREFIX.length));
    }
  }
  return result;
}

/** 清空本应用全部数据（危险操作，导入覆盖前或重置时使用） */
export function clearAll(): void {
  for (const k of listKeys()) {
    removeKey(k);
  }
}

/**
 * 通用集合读写：每个实体集合以数组形式存于一个 key。
 */
export const collection = {
  getAll<T>(key: string): T[] {
    return getJSON<T[]>(key, []);
  },
  setAll<T>(key: string, items: T[]): void {
    setJSON(key, items);
  },
  getRaw<T>(key: string): T | null {
    return getJSON<T | null>(key, null);
  },
  setRaw<T>(key: string, value: T): void {
    setJSON(key, value);
  },
};
