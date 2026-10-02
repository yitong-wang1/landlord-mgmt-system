/**
 * 取证照片水印 + 防篡改工具（电表照片 / 证件照 统一处理）。
 *
 * 用户确认的需求：
 * 1. 拍照瞬间取本机时钟时间 + GPS 经纬度，烧入图片水印（canvas 绘制）。
 * 2. 用 Web Crypto(SHA-256) 计算「带水印图片」的哈希，连同拍摄时间戳一起存记录，
 *    作为日后校验图片未被替换的依据。
 * 3. 水印时间取自本机时钟（不做联网校时）。
 *
 * 说明：photoDB 中只存「带水印后的 Blob」，原图不留存。
 */
import { formatDateTime } from './date';
import type { EvidenceResult } from '../types';

/** 获取当前 GPS 经纬度；失败/不支持返回 null（水印标注「定位不可用」） */
export async function getGeolocation(
  timeoutMs = 8000,
): Promise<{ lat: number; lng: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) return null;
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}

/** 把水印文案拆成多行 */
export function composeWatermarkLines(
  capturedAt: string,
  lat: number | null,
  lng: number | null,
): string[] {
  const time = `拍摄时间：${formatDateTime(capturedAt)}`;
  const geo =
    lat != null && lng != null
      ? `位置：${lat.toFixed(4)}°N, ${lng.toFixed(4)}°E`
      : '位置：定位不可用';
  return [time, geo];
}

/** 友好展示经纬度 */
export function formatGeo(
  lat: number | null | undefined,
  lng: number | null | undefined,
): string {
  if (lat == null || lng == null) return '定位不可用';
  return `${lat.toFixed(4)}°N, ${lng.toFixed(4)}°E`;
}

/** Blob -> HTMLImageElement */
function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片加载失败'));
    };
    img.src = url;
  });
}

/**
 * 在图片底部叠加「时间 + 经纬度」半透明水印，返回新 Blob（JPEG）。
 * 若环境不支持 canvas，则降级返回原图 Blob（不阻塞主流程）。
 */
export async function addWatermark(
  imageBlob: Blob,
  capturedAt: string,
  lat: number | null,
  lng: number | null,
): Promise<Blob> {
  try {
    const img = await blobToImage(imageBlob);
    const canvas = document.createElement('canvas');
    const maxW = 1280;
    let w = img.naturalWidth || img.width || 1280;
    let h = img.naturalHeight || img.height || 960;
    if (w > maxW) {
      h = Math.round(h * (maxW / w));
      w = maxW;
    }
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return imageBlob;

    ctx.drawImage(img, 0, 0, w, h);

    const lines = composeWatermarkLines(capturedAt, lat, lng);
    const barH = Math.max(48, Math.round(h * 0.12));
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, h - barH, w, barH);
    ctx.fillStyle = '#ffffff';
    ctx.font = `${Math.round(barH * 0.32)}px -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.textBaseline = 'middle';
    const pad = Math.round(w * 0.02);
    const lineH = barH / lines.length;
    lines.forEach((line, i) => {
      ctx.fillText(line, pad, h - barH + lineH * (i + 0.5));
    });

    return await new Promise<Blob>((resolve) => {
      canvas.toBlob(
        (b) => resolve(b ?? imageBlob),
        'image/jpeg',
        0.85,
      );
    });
  } catch (err) {
    console.warn('[watermark] 叠加水印失败，降级使用原图', err);
    return imageBlob;
  }
}

/** 计算 Blob 的 SHA-256（hex）。环境不支持 Web Crypto 时降级为简易校验和。 */
export async function sha256Hex(blob: Blob): Promise<string> {
  try {
    if (crypto?.subtle) {
      const buf = await blob.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
  } catch (err) {
    console.warn('[watermark] SHA-256 不可用，降级为校验和', err);
  }
  // 降级：简易校验和（仅用于本地一致性，非密码学安全）
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return ('fallback-' + (h >>> 0).toString(16)).padEnd(64, '0');
}

/**
 * 取证照片流水线：取本机时间 + GPS -> 叠加水印 -> 计算哈希。
 * 返回带水印 Blob 与元数据，供调用方写入 photoDB 与业务记录。
 * @param imageBlob 原始图片
 * @param capturedAtOverride 可选的“拍照瞬间”时间戳（ISO）；不传则取当前时刻
 */
export async function createEvidencePhoto(
  imageBlob: Blob,
  capturedAtOverride?: string,
): Promise<EvidenceResult> {
  const capturedAt = capturedAtOverride ?? new Date().toISOString();
  const geo = await getGeolocation();
  const lat = geo?.lat ?? null;
  const lng = geo?.lng ?? null;
  const watermarked = await addWatermark(imageBlob, capturedAt, lat, lng);
  const hash = await sha256Hex(watermarked);
  return { blob: watermarked, hash, capturedAt, lat, lng };
}

/** 校验某 Blob 哈希是否与预期一致（防篡改校验） */
export async function verifyHash(
  blob: Blob,
  expectedHash: string,
): Promise<boolean> {
  if (!expectedHash) return false;
  const actual = await sha256Hex(blob);
  return actual === expectedHash;
}
