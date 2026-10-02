/**
 * 无线 OTA 更新服务
 * 基于 @capgo/capacitor-updater + GitHub Releases（免费托管）。
 *
 * ── 能力边界（重要） ─────────────────────────────────────────────
 * 1. 只更新「网页层」（HTML / JS / CSS）——界面、账单逻辑、水印算法等。
 * 2. 改不了「原生层」——权限、新增插件、AndroidManifest、包名/图标，
 *    这些必须重新编译 APK。
 * 3. 本机数据（localStorage / IndexedDB）不受更新影响，升级后租户数据仍在。
 * 4. 仅在原生 App 内生效；浏览器 / PWA 由 Service Worker 自动更新，不走此逻辑。
 *
 * ── 配置（项目根 .env） ────────────────────────────────────────
 *   VITE_OTA_REPO=owner/repo     GitHub 仓库（必填；留空则关闭 OTA）
 *   VITE_OTA_ASSET=dist.zip      Release 附件名（可选，默认 dist.zip）
 *
 * 任何网络异常都会被静默忽略，绝不影响应用正常启动。
 */
import { Capacitor } from '@capacitor/core';
import { CapacitorUpdater } from '@capgo/capacitor-updater';

/** 注入的构建版本（见 vite.config.ts 的 define） */
declare const __APP_VERSION__: string;
const BUNDLED_VERSION: string =
  typeof __APP_VERSION__ === 'string' && __APP_VERSION__ ? __APP_VERSION__ : '1.0.0';

const REPO = (import.meta.env.VITE_OTA_REPO ?? '').trim();
const ASSET = (import.meta.env.VITE_OTA_ASSET ?? 'dist.zip').trim();
const VERSION_KEY = 'ota.appliedVersion';

/** OTA 状态机阶段 */
export type OtaPhase =
  | 'idle'
  | 'disabled'
  | 'checking'
  | 'downloading'
  | 'applying'
  | 'uptodate'
  | 'updated'
  | 'error';

export interface OtaState {
  phase: OtaPhase;
  /** 当前生效版本 */
  current: string;
  /** 远端最新版本 */
  latest?: string;
  message?: string;
}

type Listener = (s: OtaState) => void;
const listeners = new Set<Listener>();

function getCurrentVersion(): string {
  try {
    return localStorage.getItem(VERSION_KEY) || BUNDLED_VERSION;
  } catch {
    return BUNDLED_VERSION;
  }
}

function setCurrentVersion(v: string): void {
  try {
    localStorage.setItem(VERSION_KEY, v);
  } catch {
    /* 忽略隐私模式等写入失败 */
  }
}

let state: OtaState = { phase: 'idle', current: getCurrentVersion() };

function emit(patch: Partial<OtaState>): void {
  state = { ...state, ...patch };
  listeners.forEach((fn) => {
    try {
      fn(state);
    } catch {
      /* 单个订阅者异常不影响其他订阅者 */
    }
  });
}

/** 订阅 OTA 状态变化（立即回调一次当前状态）。返回取消订阅函数。 */
export function subscribeOta(fn: Listener): () => void {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

export function getOtaState(): OtaState {
  return state;
}

/** 版本号解析："v1.2.3" / "1.2.3-beta.1" → [1,2,3,0] */
function parseVersion(v: string): number[] {
  return String(v)
    .replace(/^v/i, '')
    .split(/[.\-+_]/)
    .map((s) => parseInt(s, 10))
    .map((n) => (Number.isFinite(n) ? n : 0));
}

/** 比较版本：a > b 返回 1，a < b 返回 -1，相等返回 0 */
export function compareVersion(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

interface GitHubAsset {
  name: string;
  browser_download_url: string;
}
interface GitHubRelease {
  tag_name: string;
  assets?: GitHubAsset[];
}

async function fetchLatestRelease(): Promise<GitHubRelease> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!res.ok) throw new Error(`GitHub API 返回 ${res.status}`);
  return (await res.json()) as GitHubRelease;
}

async function fetchChecksum(assets: GitHubAsset[]): Promise<string | undefined> {
  const shaAsset = assets.find((a) => a.name === `${ASSET}.sha256`);
  if (!shaAsset) return undefined;
  try {
    const res = await fetch(shaAsset.browser_download_url);
    if (!res.ok) return undefined;
    const text = (await res.text()).trim();
    // 支持 "hash  filename" 或纯 hash
    const hash = text.split(/\s+/)[0];
    return /^[0-9a-f]{64}$/i.test(hash) ? hash : undefined;
  } catch {
    return undefined;
  }
}

export interface CheckOptions {
  /** 检查到新版本时是否自动下载并应用（默认 true）。false 时仅报告有新版本。 */
  apply?: boolean;
}

/**
 * 检查并（可选）应用更新。
 * 返回最终状态；任何异常都会被捕获并转为 error 状态，不会抛出。
 */
export async function checkForUpdate(options: CheckOptions = {}): Promise<OtaState> {
  const apply = options.apply !== false;

  if (!Capacitor.isNativePlatform()) {
    emit({ phase: 'disabled', current: getCurrentVersion(), message: '浏览器 / PWA 由 Service Worker 自动更新，无需 OTA' });
    return state;
  }
  if (!REPO) {
    emit({ phase: 'disabled', current: getCurrentVersion(), message: '未配置 VITE_OTA_REPO，OTA 未启用' });
    return state;
  }

  const current = getCurrentVersion();
  emit({ phase: 'checking', current, message: '正在检查更新…' });

  try {
    const release = await fetchLatestRelease();
    const tag = release.tag_name;
    const assets = release.assets ?? [];
    const asset = assets.find((a) => a.name === ASSET);

    if (!asset) {
      emit({ phase: 'error', current, latest: tag, message: `最新 Release（${tag}）未包含 ${ASSET}` });
      return state;
    }

    if (compareVersion(tag, current) <= 0) {
      emit({ phase: 'uptodate', current, latest: tag, message: `已是最新版本（${current}）` });
      return state;
    }

    if (!apply) {
      emit({ phase: 'uptodate', current, latest: tag, message: `发现新版本 ${tag}（未自动安装）` });
      return state;
    }

    emit({ phase: 'downloading', current, latest: tag, message: `正在下载新版本 ${tag}…` });
    const checksum = await fetchChecksum(assets);
    const bundle = await CapacitorUpdater.download({
      url: asset.browser_download_url,
      version: tag,
      ...(checksum ? { checksum } : {}),
    });

    emit({ phase: 'applying', current, latest: tag, message: '正在应用更新，应用即将重启…' });
    // 先登记为「下次启动生效」，成功后再写入本地版本号，最后 reload 立即生效。
    // 这样即使 reload 失败，下次冷启动也会应用，且版本号与之一致，不会反复下载。
    await CapacitorUpdater.next(bundle);
    setCurrentVersion(tag);
    await CapacitorUpdater.reload();

    emit({ phase: 'updated', current: tag, latest: tag, message: `已更新到 ${tag}，应用重启中…` });
    return state;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emit({ phase: 'error', current, message: `更新失败：${msg}` });
    return state;
  }
}

/**
 * 应用启动时调用（main.tsx）。
 * - 无论是否配置 OTA，都必须尽快调用 notifyAppReady()，
 *   否则已下发的新 bundle 会被判定为「启动失败」并自动回滚。
 * - 随后后台静默检查更新，不阻塞首屏渲染。
 */
export async function initOta(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  try {
    await CapacitorUpdater.notifyAppReady();
  } catch (err) {
    console.warn('[OTA] notifyAppReady 调用失败：', err);
  }

  if (!REPO) {
    emit({ phase: 'disabled', current: getCurrentVersion(), message: '未配置 VITE_OTA_REPO，OTA 未启用' });
    return;
  }

  // 不 await：让首屏正常渲染，更新在后台进行
  void checkForUpdate({ apply: true });
}
