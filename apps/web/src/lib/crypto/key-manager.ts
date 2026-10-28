/**
 * Web Crypto API wrapper for blockchain certificate key management.
 * Keys are stored in IndexedDB, encrypted with a PIN-derived AES key.
 */

const DB_NAME = 'hospital-run-keystore';
const STORE_NAME = 'keys';
const DB_VERSION = 1;
const PBKDF2_ITERATIONS = 600_000;

export type KeyAlgorithm = 'ECDSA-P256' | 'RSA-2048';

export type AuthMethod = 'PIN' | 'BIOMETRIC';

export interface StoredKey {
  id: string;
  encryptedPrivateKey: ArrayBuffer;
  publicKey: JsonWebKey;
  algorithm: KeyAlgorithm;
  salt: ArrayBuffer;
  iv: ArrayBuffer;
  createdAt: string;
  // Auth method
  authMethod: AuthMethod;
  // Biometric: WebAuthn credential + AES key (IndexedDB 저장, same-origin 보호)
  credentialId?: string;        // WebAuthn credential ID (base64url)
  rawAesKey?: ArrayBuffer;      // AES-256 key for biometric mode (stored alongside)
}

// ---------------------------------------------------------------------------
// IndexedDB helpers
// ---------------------------------------------------------------------------

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('IndexedDB 열기 실패'));
  });
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---------------------------------------------------------------------------
// Key generation
// ---------------------------------------------------------------------------

export async function generateKeyPair(algorithm: KeyAlgorithm): Promise<CryptoKeyPair> {
  if (algorithm === 'ECDSA-P256') {
    return crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['sign', 'verify'],
    );
  }

  return crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
}

// ---------------------------------------------------------------------------
// PIN-based key derivation (PBKDF2 → AES-256-GCM)
// ---------------------------------------------------------------------------

export async function deriveKeyFromPin(
  pin: string,
  salt: ArrayBuffer,
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(pin),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// ---------------------------------------------------------------------------
// Private key encryption / decryption
// ---------------------------------------------------------------------------

export async function encryptPrivateKey(
  privateKey: CryptoKey,
  pin: string,
): Promise<{ encrypted: ArrayBuffer; salt: ArrayBuffer; iv: ArrayBuffer }> {
  const salt = crypto.getRandomValues(new Uint8Array(16)).buffer;
  const iv = crypto.getRandomValues(new Uint8Array(12)).buffer;
  const aesKey = await deriveKeyFromPin(pin, salt);

  const exported = await crypto.subtle.exportKey('pkcs8', privateKey);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, exported);

  return { encrypted, salt, iv };
}

export async function decryptPrivateKey(
  encrypted: ArrayBuffer,
  pin: string,
  salt: ArrayBuffer,
  iv: ArrayBuffer,
  algorithm: KeyAlgorithm,
): Promise<CryptoKey> {
  const aesKey = await deriveKeyFromPin(pin, salt);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, encrypted);

  if (algorithm === 'ECDSA-P256') {
    return crypto.subtle.importKey(
      'pkcs8',
      decrypted,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    );
  }

  return crypto.subtle.importKey(
    'pkcs8',
    decrypted,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

// ---------------------------------------------------------------------------
// IndexedDB CRUD
// ---------------------------------------------------------------------------

export async function saveKeyToStore(key: StoredKey): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  await idbRequest(store.put(key));
  db.close();
}

export async function loadKeyFromStore(id: string): Promise<StoredKey | null> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  const result = await idbRequest(store.get(id));
  db.close();
  return result ?? null;
}

export async function deleteKeyFromStore(id: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  await idbRequest(store.delete(id));
  db.close();
}

export async function hasStoredKey(): Promise<boolean> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  const count = await idbRequest(store.count());
  db.close();
  return count > 0;
}

// ---------------------------------------------------------------------------
// Biometric-based key encryption / decryption (WebAuthn)
// ---------------------------------------------------------------------------

/**
 * BIOMETRIC 모드: 랜덤 AES 키로 개인키 암호화.
 * AES 키(rawAesKey)도 IndexedDB StoredKey에 함께 저장.
 * WebAuthn은 접근 게이트(본인확인)로만 사용 — 키 파생 안 함.
 * 보안: same-origin 정책 + WebAuthn 본인확인 이중 보호.
 */
export async function encryptPrivateKeyWithBiometric(
  privateKey: CryptoKey,
): Promise<{ encrypted: ArrayBuffer; salt: ArrayBuffer; iv: ArrayBuffer; rawAesKey: ArrayBuffer }> {
  const aesKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
  const salt = crypto.getRandomValues(new Uint8Array(16)).buffer;
  const iv = crypto.getRandomValues(new Uint8Array(12)).buffer;
  const exported = await crypto.subtle.exportKey('pkcs8', privateKey);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, exported);
  const rawAesKey = await crypto.subtle.exportKey('raw', aesKey);
  return { encrypted, salt, iv, rawAesKey };
}

/**
 * BIOMETRIC 모드: 저장된 rawAesKey로 개인키 복호화.
 * WebAuthn 인증 성공 후에만 이 함수를 호출할 것.
 */
export async function decryptPrivateKeyWithBiometric(
  encrypted: ArrayBuffer,
  iv: ArrayBuffer,
  rawAesKey: ArrayBuffer,
  algorithm: KeyAlgorithm,
): Promise<CryptoKey> {
  const aesKey = await crypto.subtle.importKey('raw', rawAesKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, encrypted);

  if (algorithm === 'ECDSA-P256') {
    return crypto.subtle.importKey('pkcs8', decrypted, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  }
  return crypto.subtle.importKey('pkcs8', decrypted, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

// ---------------------------------------------------------------------------
// Public key export (PEM)
// ---------------------------------------------------------------------------

export async function exportPublicKeyPem(publicKey: CryptoKey): Promise<string> {
  const exported = await crypto.subtle.exportKey('spki', publicKey);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(exported)));
  const lines = b64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;
}
