/**
 * 敏感信息加密工具（Web Crypto API，AES-GCM）。
 *
 * ⚠️ 产品决策明确：MVP 身份证号「明文存储、不实现 AES 加密」。
 * 因此本模块当前未被业务代码接入（idCard 走明文 + 脱敏展示）。
 * 保留它是为了「未来可选云端同步」时，能就地加密敏感字段后再上传，
 * 不破坏本机隐私红线。请勿在 MVP 中直接用于身份证存储。
 *
 * 设计要点：
 * - 密钥由口令经 PBKDF2 派生（未来由房东设置「主密码」）。MVP 未启用口令体系，
 *   故这里仅暴露纯函数，调用方需自行管理 key。
 * - 所有输出均为 base64 字符串，便于 JSON 存储/传输。
 */

const enc = new TextEncoder();
const dec = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** 由口令派生 AES-GCM 256 位密钥（PBKDF2 + SHA-256） */
export async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations: 100_000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * 加密文本，返回 { iv, data } 两个 base64 字段。
 */
export async function encryptText(
  plaintext: string,
  key: CryptoKey,
): Promise<{ iv: string; data: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(plaintext),
  );
  return { iv: toBase64(iv), data: toBase64(new Uint8Array(cipher)) };
}

/** 解密 */
export async function decryptText(
  payload: { iv: string; data: string },
  key: CryptoKey,
): Promise<string> {
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(payload.iv) as unknown as BufferSource },
    key,
    fromBase64(payload.data) as unknown as BufferSource,
  );
  return dec.decode(plain);
}

/** 生成随机盐（用于密钥派生） */
export function randomSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}
