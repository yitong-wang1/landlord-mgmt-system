/**
 * 通用格式化工具。
 */

// 统一从 date 暴露的时间戳工具（store/service 常从 format 引入 nowISO）
export { nowISO } from './date';

/** 截断文本，超出用 … */
export function truncate(text: string, max = 20): string {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 楼下安全的字符串取值（防 undefined） */
export function safeStr(v: unknown): string {
  return v == null ? '' : String(v);
}

/** 生成随机 UUID（浏览器原生） */
export function uuid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  // 兜底（极老环境）
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** 下载一个文本/Blob 到本地 */
export function downloadFile(filename: string, content: Blob | string): void {
  const blob =
    typeof content === 'string'
      ? new Blob([content], { type: 'application/json;charset=utf-8' })
      : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 读取用户选择的文件为文本 */
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

/** 读取文件为 DataURL（base64，含头） */
export function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** 把 Blob 转为 DataURL（base64，含头） */
export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** 把 DataURL 转成 Blob */
export function dataURLToBlob(dataURL: string): Blob {
  const [head, body] = dataURL.split(',');
  const mimeMatch = head.match(/:(.*?);/);
  const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/** 把带头的 DataURL 转为纯 base64（去 data:...;base64, 头） */
export function dataURLToBase64(dataURL: string): string {
  const idx = dataURL.indexOf(',');
  return idx >= 0 ? dataURL.slice(idx + 1) : dataURL;
}

/** 把纯 base64 还原为 Blob（需提供 mime） */
export function base64ToBlob(base64: string, mime: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
