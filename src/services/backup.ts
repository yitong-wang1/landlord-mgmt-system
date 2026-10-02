/**
 * 备份服务：导出 / 导入全量 JSON 备份。
 *
 * - 全量备份：结构化数据 + 照片（带水印 Blob 转 base64 内嵌）。
 * - 轻量备份：仅结构化数据（不含照片），体积更小。
 * 导入时校验 schema 版本，覆盖写回 localStorage + IndexedDB。
 */
import {
  type BackupFile,
  type BackupPhoto,
  type BackupKind,
  type LightBackupFile,
  type Photo,
} from '../types';
import { repository, SCHEMA_VERSION } from '../db/repository';
import * as photoDB from '../db/photoDB';
import { blobToDataURL, dataURLToBase64, base64ToBlob, downloadFile, nowISO } from '../utils/format';
import { format } from 'date-fns';

// 方便调用方从 backup 引入类型
export type { BackupKind, BackupFile, LightBackupFile, BackupPhoto } from '../types';

/** 全量导出（含照片 base64） */
export async function exportAll(): Promise<BackupFile> {
  const data = repository.getAllEntities();
  const photos = await photoDB.getAllPhotos();
  const photoMap: Record<string, BackupPhoto> = {};
  for (const p of photos) {
    const dataURL = await blobToDataURL(p.blob);
    photoMap[p.id] = {
      data: dataURLToBase64(dataURL),
      mime: p.mimeType || 'image/jpeg',
    };
  }
  return {
    version: SCHEMA_VERSION,
    exportedAt: nowISO(),
    data,
    photos: photoMap,
  };
}

/** 轻量导出（不含照片） */
export function exportLight(): LightBackupFile {
  return {
    version: SCHEMA_VERSION,
    exportedAt: nowISO(),
    data: repository.getAllEntities(),
  };
}

/** 校验备份数据基本结构 */
function isValidData(d: unknown): d is BackupFile['data'] {
  if (!d || typeof d !== 'object') return false;
  const obj = d as Record<string, unknown>;
  return (
    Array.isArray(obj.tenants) &&
    Array.isArray(obj.rooms) &&
    Array.isArray(obj.feeTypes) &&
    Array.isArray(obj.meterRecords) &&
    Array.isArray(obj.heatingFees) &&
    Array.isArray(obj.payments) &&
    Array.isArray(obj.bills) &&
    obj.settings != null
  );
}

/** 解析并校验全量备份 */
export function parseBackup(text: string): BackupFile | null {
  try {
    const parsed = JSON.parse(text) as BackupFile;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.version !== 'number') return null;
    if (!isValidData(parsed.data)) return null;
    if (!parsed.photos || typeof parsed.photos !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 解析并校验轻量备份 */
export function parseLightBackup(text: string): LightBackupFile | null {
  try {
    const parsed = JSON.parse(text) as LightBackupFile;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.version !== 'number') return null;
    if (!isValidData(parsed.data)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 全量导入（覆盖写回结构化数据 + 照片） */
export async function importAll(text: string): Promise<number> {
  const parsed = parseBackup(text);
  if (!parsed) throw new Error('备份文件格式不正确或已损坏');
  repository.replaceAll(parsed.data);

  // 重写照片：先清空，再批量写入
  await photoDB.clearPhotos();
  const photos: Photo[] = [];
  for (const [id, p] of Object.entries(parsed.photos)) {
    photos.push({
      id,
      blob: base64ToBlob(p.data, p.mime || 'image/jpeg'),
      mimeType: p.mime || 'image/jpeg',
      createdAt: nowISO(),
    });
  }
  await photoDB.savePhotosBulk(photos);
  return photos.length;
}

/** 轻量导入（仅结构化数据，照片保持不变） */
export function importLight(text: string): void {
  const parsed = parseLightBackup(text);
  if (!parsed) throw new Error('轻量备份文件格式不正确或已损坏');
  repository.replaceAll(parsed.data);
}

/** 触发浏览器下载备份文件 */
export async function downloadBackup(kind: BackupKind): Promise<string> {
  const file =
    kind === 'full' ? await exportAll() : exportLight();
  const stamp = format(new Date(), 'yyyyMMdd-HHmm');
  const filename = `landlord-backup-${stamp}.json`;
  downloadFile(filename, JSON.stringify(file, null, 2));
  return filename;
}
