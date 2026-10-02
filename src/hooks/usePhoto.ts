/**
 * usePhoto：取证照片处理（拍照 / 上传 → 叠加时间+经纬度水印 → 计算 SHA-256 哈希 → 存入 photoDB）。
 *
 * 电表照片与证件照统一走这里，保证水印与防篡改口径一致：
 * - 水印：canvas 叠加「拍摄时间 YYYY-MM-DD HH:mm:ss + 经纬度」，GPS 失败标注「定位不可用」。
 * - 哈希：对「带水印后的图片」做 SHA-256，连同拍摄时间戳/经纬度一起写入业务记录，作为校验依据。
 * - photoDB 只存带水印的 Blob，原图不留存。
 *
 * 拍照通道：Android WebView 下优先用 @capacitor/camera 插件，浏览器用 getUserMedia，
 * 两条通道拿到的图片都会经过同一套水印+哈希处理。
 */
import { useCallback, useEffect, useState } from 'react';
import type { EvidenceResult, Photo } from '../types';
import { createEvidencePhoto, formatGeo, sha256Hex } from '../utils/watermark';
import { uuid, nowISO, base64ToBlob } from '../utils/format';
import { savePhoto, getPhoto } from '../db/photoDB';

/** 是否运行在 Capacitor 原生容器中 */
export function isNativePlatform(): boolean {
  const cap = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } })
    .Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

/** 通过 @capacitor/camera 拍照（原生主通道），失败返回 null。 */
export async function captureNativePhoto(): Promise<Blob | null> {
  try {
    const mod = await import('@capacitor/camera');
    const photo = await mod.Camera.getPhoto({
      quality: 90,
      resultType: mod.CameraResultType.Uri,
      source: mod.CameraSource.Camera,
      correctOrientation: true,
    });
    const url = photo.webPath ?? photo.path;
    if (!url) return null;
    const res = await fetch(url);
    return await res.blob();
  } catch (err) {
    console.warn('[usePhoto] 原生相机不可用，回退 Web 通道', err);
    return null;
  }
}

export interface UsePhotoResult {
  /** 是否正在处理（加水印/算哈希/存库） */
  processing: boolean;
  /** 错误信息 */
  error: string | null;
  /**
   * 处理一张取证照片：叠加水印 + 计算哈希 + 存入 photoDB。
   * @param blob 原始图片
   * @param capturedAt “拍照瞬间”时间戳（ISO），缺省用处理时刻
   * @returns photoId 与水印元数据；失败返回 null
   */
  process: (
    blob: Blob,
    capturedAt?: string,
  ) => Promise<{ photoId: string; evidence: EvidenceResult } | null>;
  /** 拍摄并处理（原生优先，回退调用方提供的 Web 抓拍） */
  captureAndProcess: (
    webCapture: () => Promise<Blob | null>,
  ) => Promise<{ photoId: string; evidence: EvidenceResult } | null>;
}

export function usePhoto(): UsePhotoResult {
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const saveEvidence = async (
    blob: Blob,
    capturedAt?: string,
  ): Promise<{ photoId: string; evidence: EvidenceResult } | null> => {
    const evidence = await createEvidencePhoto(blob, capturedAt);
    const photoId = uuid();
    const photo: Photo = {
      id: photoId,
      blob: evidence.blob,
      mimeType: evidence.blob.type || 'image/jpeg',
      createdAt: nowISO(),
    };
    await savePhoto(photo);
    return { photoId, evidence };
  };

  const process = useCallback(
    async (
      blob: Blob,
      capturedAt?: string,
    ): Promise<{ photoId: string; evidence: EvidenceResult } | null> => {
      setProcessing(true);
      setError(null);
      try {
        return await saveEvidence(blob, capturedAt);
      } catch (err) {
        console.error('[usePhoto] 处理照片失败', err);
        setError('照片处理失败，请重试或改用手动录入');
        return null;
      } finally {
        setProcessing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const captureAndProcess = useCallback(
    async (
      webCapture: () => Promise<Blob | null>,
    ): Promise<{ photoId: string; evidence: EvidenceResult } | null> => {
      setProcessing(true);
      setError(null);
      try {
        let blob: Blob | null = null;
        if (isNativePlatform()) {
          blob = await captureNativePhoto();
        }
        if (!blob) {
          blob = await webCapture();
        }
        if (!blob) {
          setError('未获取到照片');
          return null;
        }
        return await saveEvidence(blob);
      } catch (err) {
        console.error('[usePhoto] 拍照处理失败', err);
        setError('拍照处理失败，请重试或改用手动录入');
        return null;
      } finally {
        setProcessing(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return { processing, error, process, captureAndProcess };
}

/**
 * usePhotoUrl：把 photoId 解析为可展示的 object URL，并自动回收。
 */
export function usePhotoUrl(photoId?: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let revoked = false;
    let objectUrl: string | null = null;
    if (!photoId) {
      setUrl(null);
      return;
    }
    (async () => {
      const photo = await getPhoto(photoId);
      if (!photo) {
        setUrl(null);
        return;
      }
      objectUrl = URL.createObjectURL(photo.blob);
      if (!revoked) setUrl(objectUrl);
    })();
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [photoId]);

  return url;
}

/** 校验某取证照片的哈希是否与记录一致（防篡改校验）。 */
export async function verifyPhotoIntegrity(
  photoId: string | undefined,
  expectedHash: string | undefined,
): Promise<{ ok: boolean; reason: string }> {
  if (!photoId || !expectedHash) {
    return { ok: false, reason: '无照片或无哈希记录' };
  }
  const photo = await getPhoto(photoId);
  if (!photo) return { ok: false, reason: '照片缺失' };
  const actual = await sha256Hex(photo.blob);
  if (actual === expectedHash) return { ok: true, reason: '校验通过' };
  return { ok: false, reason: '哈希不一致：图片可能被替换/篡改' };
}

export { base64ToBlob };