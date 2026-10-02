/**
 * QA 测试环境垫片：在 Node 下模拟浏览器 API，使被测源码（localStore / watermark / repository）可直接运行。
 * 目的：真实执行 src/ 下的业务代码，而不是复制其逻辑重写一遍。
 */

/* ---------------- localStorage 内存实现 ---------------- */
class MemoryStorage {
  private map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }

  getItem(k: string): string | null {
    return this.map.has(k) ? (this.map.get(k) as string) : null;
  }

  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }

  removeItem(k: string): void {
    this.map.delete(k);
  }

  clear(): void {
    this.map.clear();
  }
}

const g = globalThis as Record<string, unknown>;

/** 提供 localStorage（若宿主环境无 localStorage） */
export function installLocalStorage(): void {
  if (!('localStorage' in g) || typeof g.localStorage === 'undefined') {
    g.localStorage = new MemoryStorage();
  }
}

/** 清空本应用命名空间下的全部键，保证用例互相独立 */
export function resetStorage(): void {
  installLocalStorage();
  const ls = g.localStorage as MemoryStorage;
  const keys: string[] = [];
  for (let i = 0; i < ls.length; i++) {
    const k = ls.key(i);
    if (k != null) keys.push(k);
  }
  for (const k of keys) ls.removeItem(k);
}

/* ---------------- crypto.subtle（Node webcrypto） ---------------- */
import { webcrypto } from 'node:crypto';

export function installCrypto(): void {
  if (!g.crypto || !(g.crypto as Crypto).subtle) {
    g.crypto = webcrypto as unknown as Crypto;
  }
}

/* ---------------- Canvas / Image 最小可观测替身 ---------------- */

/** 记录 canvas 上发生过的绘制调用，用于断言「叠加了水印」 */
export interface CanvasCallLog {
  fillRect: Array<{ x: number; y: number; w: number; h: number }>;
  fillText: Array<{ text: string; x: number; y: number; font: string }>;
  drawImage: number;
  toBlobCalls: number;
}

export const canvasLog: CanvasCallLog = {
  fillRect: [],
  fillText: [],
  drawImage: 0,
  toBlobCalls: 0,
};

export function resetCanvasLog(): void {
  canvasLog.fillRect = [];
  canvasLog.fillText = [];
  canvasLog.drawImage = 0;
  canvasLog.toBlobCalls = 0;
}

/** 标记「本次 addWatermark 生成的 blob」身份，用于验证哈希顺序 */
export const watermarkBlobRegistry = new WeakSet<object>();
/** 标记「喂给 addWatermark 的原图」身份 */
export const originalBlobRegistry = new WeakSet<object>();

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 4000;
  naturalHeight = 3000;
  width = 4000;
  height = 3000;
  set src(_v: string) {
    // 模拟异步加载成功
    setTimeout(() => this.onload?.(), 0);
  }
}

class FakeCanvas {
  width = 0;
  height = 0;
  private ctx: FakeCtx;

  constructor() {
    this.ctx = new FakeCtx();
  }

  getContext(kind: string): FakeCtx | null {
    return kind === '2d' ? this.ctx : null;
  }

  toBlob(cb: (b: Blob | null) => void): void {
    canvasLog.toBlobCalls += 1;
    const out = new Blob([`watermarked:${this.width}x${this.height}`], {
      type: 'image/jpeg',
    });
    watermarkBlobRegistry.add(out);
    cb(out);
  }
}

class FakeCtx {
  fillStyle = '';
  font = '';
  textBaseline = '';
  fillRect(x: number, y: number, w: number, h: number): void {
    canvasLog.fillRect.push({ x, y, w, h });
  }
  fillText(text: string, x: number, y: number): void {
    canvasLog.fillText.push({ text, x, y, font: this.font });
  }
  drawImage(): void {
    canvasLog.drawImage += 1;
  }
}

export function installDom(): void {
  g.Image = FakeImage;
  g.document = {
    createElement(tag: string) {
      if (tag === 'canvas') return new FakeCanvas();
      return {};
    },
  };
  // 注意：不能整体替换 globalThis.URL —— 那是 JS 内建类（URL 用 instanceof 判定），
  // 替换成普通对象会让 node:fs 等内部模块抛 "Right-hand side of 'instanceof' is not callable"。
  // 这里只在原生 URL 上补挂缺失的静态方法。
  const u = g.URL as typeof URL & {
    createObjectURL?: (b: Blob) => string;
    revokeObjectURL?: (u: string) => void;
  };
  if (typeof u.createObjectURL !== 'function') {
    u.createObjectURL = () => 'blob:fake';
  }
  if (typeof u.revokeObjectURL !== 'function') {
    u.revokeObjectURL = () => undefined;
  }
  installGeolocation(null);
}

/** 控制 getGeolocation 的返回；geo=null 时模拟「定位不可用/被拒绝」 */
export function installGeolocation(
  geo: { lat: number; lng: number } | null,
): void {
  const nav = {
    geolocation: {
      getCurrentPosition(
        ok: (p: unknown) => void,
        err: (e: unknown) => void,
      ): void {
        setTimeout(() => {
          if (geo) ok({ coords: { latitude: geo.lat, longitude: geo.lng } });
          else err({ code: 1, message: 'denied' });
        }, 0);
      },
    },
  };
  // Node 22 起 globalThis.navigator 是只读访问器，必须用 defineProperty 覆盖
  Object.defineProperty(globalThis, 'navigator', {
    value: nav,
    configurable: true,
    writable: true,
  });
}