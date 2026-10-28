import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { getKeyCustody } from './key-custody';

// 필드 단위 암호화 — 멱등 헬퍼 (security-governance G3 / FR-S5)
// AES-256-GCM(encryption.service와 동일 포맷 `iv:authTag:ciphertext` hex).
// ⚠️ 멱등성 핵심: 이미 암호화된 값은 재암호화 안 함, 평문은 복호 시 그대로 통과(혼재 레거시 안전).
// 전역 Prisma 미들웨어 자동화는 필드별 평문→암호문 백필 동반 — 별도 게이트(여기선 헬퍼·레지스트리만).

let cachedKey: Buffer | null = null;
function key(): Buffer {
  if (cachedKey) return cachedKey;
  const secret = process.env.ENCRYPTION_KEY;
  if (!secret) throw new Error('ENCRYPTION_KEY 미설정 — 필드 암호화 불가');
  cachedKey = getKeyCustody().getSymmetricKey(secret);
  return cachedKey;
}

const ENC_RE = /^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]*$/i; // iv(16B):tag(16B):cipher

/** 이미 암호화된 형식인지(iv:tag:cipher hex) */
export function isEncrypted(value: unknown): boolean {
  return typeof value === 'string' && ENC_RE.test(value);
}

/** 멱등 암호화 — 이미 암호화면 그대로, 빈값/비문자열은 그대로. */
export function encryptField(value: unknown): unknown {
  if (value == null || typeof value !== 'string' || value === '') return value;
  if (isEncrypted(value)) return value; // 이중암호화 방지
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

/** 멱등 복호 — 암호화 형식이면 복호, 아니면(평문 레거시) 그대로 통과. */
export function decryptField(value: unknown): unknown {
  if (!isEncrypted(value)) return value; // 평문 레거시 안전 통과
  const [ivHex, tagHex, encHex] = (value as string).split(':');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString('utf8');
  } catch {
    return value; // 복호 실패 시 원본(키 회전 등 — 손상 방지)
  }
}

// PHI 암호화 대상 필드 레지스트리 — SoT. 전역 자동화 활성 시 이 목록을 소비(필드별 백필 후).
// 현재는 선언만(자동 적용 X) — 기존 수동 암호화(encryption.service)와 병행, 점진 이관.
export const ENCRYPTED_FIELDS: Record<string, string[]> = {
  // model: [field, ...]  — 예: Patient: ['nationalId'] (현재 수동 암호화 중 → 이관 대상)
  // 신규 PHI 필드는 여기 등록 후 헬퍼로 암복호.
};
