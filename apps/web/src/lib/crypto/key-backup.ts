/**
 * Key backup/restore as .hrkb (Hospital Run Key Backup) file.
 */

import type { StoredKey, KeyAlgorithm } from './key-manager';
import { kstToday } from '@/lib/kst-today';

export interface HrkbFile {
  version: 1;
  algorithm: KeyAlgorithm;
  encryptedPrivateKey: string; // base64
  publicKey: string; // JWK JSON string
  salt: string; // base64
  iv: string; // base64
  createdAt: string;
  owner: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bufferToBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function base64ToBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

// ---------------------------------------------------------------------------
// Create backup
// ---------------------------------------------------------------------------

/**
 * Create a downloadable .hrkb backup blob from a StoredKey.
 */
export function createBackupFile(storedKey: StoredKey, ownerName: string): Blob {
  const hrkb: HrkbFile = {
    version: 1,
    algorithm: storedKey.algorithm,
    encryptedPrivateKey: bufferToBase64(storedKey.encryptedPrivateKey),
    publicKey: JSON.stringify(storedKey.publicKey),
    salt: bufferToBase64(storedKey.salt),
    iv: bufferToBase64(storedKey.iv),
    createdAt: storedKey.createdAt,
    owner: ownerName,
  };

  const json = JSON.stringify(hrkb, null, 2);
  return new Blob([json], { type: 'application/json' });
}

// ---------------------------------------------------------------------------
// Parse backup
// ---------------------------------------------------------------------------

/**
 * Parse a .hrkb file and validate its structure.
 */
export async function parseBackupFile(file: File): Promise<HrkbFile> {
  const text = await file.text();
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('유효하지 않은 백업 파일 형식입니다.');
  }

  const hrkb = parsed as Record<string, unknown>;

  if (hrkb.version !== 1) {
    throw new Error('지원하지 않는 백업 파일 버전입니다.');
  }

  const requiredFields = [
    'algorithm',
    'encryptedPrivateKey',
    'publicKey',
    'salt',
    'iv',
    'createdAt',
    'owner',
  ];

  for (const field of requiredFields) {
    if (!(field in hrkb) || typeof hrkb[field] !== 'string') {
      throw new Error(`백업 파일에 필수 필드 '${field}'가 누락되었습니다.`);
    }
  }

  const algorithm = hrkb.algorithm as string;
  if (algorithm !== 'ECDSA-P256' && algorithm !== 'RSA-2048') {
    throw new Error(`지원하지 않는 알고리즘: ${algorithm}`);
  }

  // Validate base64 fields can be decoded
  try {
    base64ToBuffer(hrkb.encryptedPrivateKey as string);
    base64ToBuffer(hrkb.salt as string);
    base64ToBuffer(hrkb.iv as string);
    JSON.parse(hrkb.publicKey as string);
  } catch {
    throw new Error('백업 파일 데이터가 손상되었습니다.');
  }

  return parsed as HrkbFile;
}

/**
 * Convert an HrkbFile back to a StoredKey for import into IndexedDB.
 */
export function hrkbToStoredKey(hrkb: HrkbFile, id: string): StoredKey {
  return {
    id,
    encryptedPrivateKey: base64ToBuffer(hrkb.encryptedPrivateKey),
    publicKey: JSON.parse(hrkb.publicKey) as JsonWebKey,
    algorithm: hrkb.algorithm,
    salt: base64ToBuffer(hrkb.salt),
    iv: base64ToBuffer(hrkb.iv),
    createdAt: hrkb.createdAt,
    authMethod: 'PIN', // Backup files are always PIN-based (biometric is device-specific)
  };
}

// ---------------------------------------------------------------------------
// Filename
// ---------------------------------------------------------------------------

/**
 * Generate a backup filename: hospitalrun-key-{name}-{YYYYMMDD}.hrkb
 */
export function getBackupFilename(ownerName: string): string {
  const safeName = ownerName.replace(/[^a-zA-Z0-9가-힣]/g, '-').toLowerCase();
  const date = kstToday().replace(/-/g, '');
  return `hospitalrun-key-${safeName}-${date}.hrkb`;
}
