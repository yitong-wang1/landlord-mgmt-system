/**
 * IndexedDB 照片 Blob 存取（经 idb 封装）。
 * 照片体积大，不能进 localStorage，必须用 IndexedDB 存 Blob。
 */
import { openDB, type IDBPDatabase } from 'idb';
import type { Photo } from '../types';

const DB_NAME = 'landlord-photos';
const STORE = 'photos';
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

/** 保存一张照片（含 Blob） */
export async function savePhoto(photo: Photo): Promise<void> {
  const db = await getDB();
  await db.put(STORE, photo);
}

/** 批量保存（导入备份时使用） */
export async function savePhotosBulk(photos: Photo[]): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(STORE, 'readwrite');
  for (const p of photos) {
    await tx.store.put(p);
  }
  await tx.done;
}

/** 读取一张照片 */
export async function getPhoto(id: string): Promise<Photo | undefined> {
  const db = await getDB();
  return (await db.get(STORE, id)) as Photo | undefined;
}

/** 读取全部照片 */
export async function getAllPhotos(): Promise<Photo[]> {
  const db = await getDB();
  return (await db.getAll(STORE)) as Photo[];
}

/** 删除一张照片 */
export async function deletePhoto(id: string): Promise<void> {
  const db = await getDB();
  await db.delete(STORE, id);
}

/** 清空全部照片 */
export async function clearPhotos(): Promise<void> {
  const db = await getDB();
  await db.clear(STORE);
}

/** 生成 Blob 的 object URL（用于 <img src>），调用方负责 revoke */
export async function getPhotoURL(id: string): Promise<string | null> {
  const photo = await getPhoto(id);
  if (!photo) return null;
  return URL.createObjectURL(photo.blob);
}
