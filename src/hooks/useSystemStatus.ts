/**
 * useSystemStatus：读取「相机 / 定位」授权状态 + 本机时间是否准确。
 *
 * 只**读取**状态、不主动申请权限，供设置页做简洁的状态展示。
 *
 * - 相机：原生端用 @capacitor/camera 的 checkPermissions()；Web 端用 Permissions API。
 * - 定位：用 Permissions API（浏览器与 Android WebView 均支持 geolocation 查询）。
 * - 时间：无法读取系统「自动对时」开关，改为**用网络时间比对本机时钟**——
 *   结果是"准不准"这个真正影响水印有效性的信息。离线时如实显示"未校验"。
 */
import { useEffect, useState } from 'react';
import { isNativePlatform } from './usePhoto';

export type PermState = 'granted' | 'denied' | 'prompt' | 'unknown';
export type TimeState = 'checking' | 'ok' | 'off' | 'unknown';

const PERM_LABEL: Record<PermState, string> = {
  granted: '已开启',
  denied: '已拒绝',
  prompt: '未授权',
  unknown: '未检测',
};

export function permLabel(state: PermState): string {
  return PERM_LABEL[state];
}

/** 时间偏差容忍上限：超过该值认为本机时间不可信（影响水印取证） */
const TIME_TOLERANCE_MS = 120_000;

async function fetchWithTimeout(url: string, ms = 5000): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timer);
  }
}

async function queryWebPermission(name: string): Promise<PermState> {
  try {
    const perms = (navigator as Navigator).permissions;
    if (!perms?.query) return 'unknown';
    const status = await perms.query({ name } as PermissionDescriptor);
    return status.state as PermState;
  } catch {
    // 部分浏览器/内核不支持查询该权限名 → 如实返回未知
    return 'unknown';
  }
}

async function queryCameraPermission(): Promise<PermState> {
  if (isNativePlatform()) {
    try {
      const mod = await import('@capacitor/camera');
      const res = await mod.Camera.checkPermissions();
      const c = (res as { camera?: string }).camera;
      if (c === 'granted') return 'granted';
      if (c === 'denied') return 'denied';
      return 'prompt';
    } catch {
      return 'unknown';
    }
  }
  return queryWebPermission('camera');
}

/** 缓存时间校验结果，避免每次进入设置页都发网络请求 */
let cachedTimeState: TimeState | null = null;

async function checkTimeAccuracy(): Promise<TimeState> {
  const sources: Array<() => Promise<number>> = [
    async () => {
      const r = await fetchWithTimeout('https://worldtimeapi.org/api/ip');
      const j = (await r.json()) as { unixtime?: number };
      return Number(j?.unixtime) * 1000;
    },
    async () => {
      const r = await fetchWithTimeout('https://timeapi.io/api/Time/current/zone?timeZone=UTC');
      const j = (await r.json()) as { dateTime?: string };
      return new Date(String(j?.dateTime)).getTime();
    },
  ];

  for (const source of sources) {
    try {
      const remoteMs = await source();
      if (!Number.isFinite(remoteMs) || remoteMs <= 0) continue;
      cachedTimeState = Math.abs(Date.now() - remoteMs) > TIME_TOLERANCE_MS ? 'off' : 'ok';
      return cachedTimeState;
    } catch {
      /* 换下一个时间源 */
    }
  }
  cachedTimeState = 'unknown';
  return 'unknown';
}

export interface SystemStatus {
  camera: PermState;
  location: PermState;
  time: TimeState;
}

export function useSystemStatus(): SystemStatus {
  const [camera, setCamera] = useState<PermState>('unknown');
  const [location, setLocation] = useState<PermState>('unknown');
  const [time, setTime] = useState<TimeState>('checking');

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [c, l] = await Promise.all([
        queryCameraPermission(),
        queryWebPermission('geolocation'),
      ]);
      if (!alive) return;
      setCamera(c);
      setLocation(l);
    })();
    void (async () => {
      const t = cachedTimeState ?? (await checkTimeAccuracy());
      if (alive) setTime(t);
    })();
    return () => {
      alive = false;
    };
  }, []);

  return { camera, location, time };
}
