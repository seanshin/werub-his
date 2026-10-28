import { Platform } from 'react-native';

/**
 * 플랫폼별 보안 스토리지 래퍼
 * - Native: expo-secure-store (암호화 저장)
 * - Web: localStorage (개발용)
 */

let _secureStore: typeof import('expo-secure-store') | null = null;

async function getSecureStore() {
  if (Platform.OS !== 'web' && !_secureStore) {
    _secureStore = await import('expo-secure-store');
  }
  return _secureStore;
}

export async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return localStorage.getItem(key);
  }
  const store = await getSecureStore();
  return store!.getItemAsync(key);
}

export async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    localStorage.setItem(key, value);
    return;
  }
  const store = await getSecureStore();
  await store!.setItemAsync(key, value);
}

/** 디바이스 식별용 UUID(비-암호). 디바이스 바인딩/멀티디바이스 관리용 안정 식별자. */
function genDeviceId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 안정 deviceId 획득 — 없으면 생성·영속(SecureStore). 종전 `getItem('deviceId')`가
 * setItem 없이 항상 null/web-timestamp를 반환해 디바이스 바인딩이 무력화되던 것을 교정.
 */
export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await getItem('deviceId');
  if (existing) return existing;
  const id = genDeviceId();
  await setItem('deviceId', id);
  return id;
}

export async function deleteItem(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    localStorage.removeItem(key);
    return;
  }
  const store = await getSecureStore();
  await store!.deleteItemAsync(key);
}
