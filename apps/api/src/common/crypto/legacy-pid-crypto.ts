import { createDecipheriv, randomBytes, createCipheriv, createHmac } from 'crypto';
import { decryptField } from './field-encryption';

/**
 * 🔴 레거시 PID 복호 헬퍼 — PatientService 가 쓰는 **원시 hex 키** 계열.
 *
 * 배경(key_rotation_tool): 이 저장소의 PHI 필드는 키 파생이 **두 갈래**다.
 *   ① PatientService(insuranceNumber·nationalId·ci·passportNumber·alienRegistrationNo):
 *      `Buffer.from(ENCRYPTION_KEY, 'hex')` — 원시 hex 키
 *   ② EncryptionService / common/crypto/field-encryption(decryptField):
 *      `getKeyCustody().getSymmetricKey(ENCRYPTION_KEY)` — 파생 키
 * 포맷은 둘 다 `iv:authTag:cipher`(hex, aes-256-gcm)로 같지만 **키가 다르다.**
 * 그래서 ①로 암호화한 insuranceNumber 를 `decryptField`(②)로 풀면
 * authTag 검증에서 조용히 실패해 **ciphertext 를 그대로 반환**한다(field-encryption 의 catch→원본).
 *
 * 청구 EDI 같은 ①의 소비처는 이 헬퍼(원시 hex 키)로만 정상 복호된다.
 * 멱등: 암호화 형식이 아니면(평문 레거시/빈값) 그대로 통과, 복호 실패 시 원본 유지(손상 방지).
 * 정본 암복호는 여전히 PatientService(private) — 이 헬퍼는 그 키 계열의 **읽기 전용 복호**만 제공한다.
 */

const ENC_RE = /^[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]*$/i; // iv(16B):tag(16B):cipher

let cachedKey: Buffer | null = null;
function rawKey(): Buffer {
  if (cachedKey) return cachedKey;
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex) throw new Error('ENCRYPTION_KEY 미설정 — 레거시 PID 복호 불가');
  cachedKey = Buffer.from(hex, 'hex');
  return cachedKey;
}

/** 원시 hex 키 계열 암호화 형식인지(iv:tag:cipher hex) */
export function isLegacyPidEncrypted(value: unknown): boolean {
  return typeof value === 'string' && ENC_RE.test(value);
}

/**
 * 멱등 복호 — PatientService(원시 hex 키)로 암호화된 값을 복호한다.
 * 암호화 형식이 아니면 그대로, 복호 실패(키 회전 등)면 원본 유지.
 */
export function decryptLegacyPid(value: unknown): string {
  if (!isLegacyPidEncrypted(value)) return typeof value === 'string' ? value : '';
  const [ivHex, tagHex, encHex] = (value as string).split(':');
  try {
    const decipher = createDecipheriv('aes-256-gcm', rawKey(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    let out = decipher.update(encHex, 'hex', 'utf8');
    out += decipher.final('utf8');
    return out;
  } catch {
    return value as string; // 복호 실패 시 원본(손상 방지) — 소비처는 형식으로 실패를 감지
  }
}

/** 테스트/가드용 — 원시 hex 키 계열 암호화(PatientService 와 동일 포맷). 운영 쓰기 경로 아님. */
export function encryptLegacyPidForTest(text: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', rawKey(), iv);
  let enc = cipher.update(text, 'utf8', 'hex');
  enc += cipher.final('hex');
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc}`;
}

// ── 2026-09-01 전진 정합: nationalId 쓰기 경로를 원시 hex 키로 통일 ──
// 정본은 PatientService(private encrypt/hashNationalId). NICE 가입·포털 자가등록이
// 파생 키(EncryptionService.encrypt)로 같은 컬럼에 써서 **직원 차트가 복호 못 하던** 것을
// 이 헬퍼로 원시 키에 수렴시킨다(hash 도 원시 키 HMAC 로 동시 기록해 중복확인 일치).

/** 원시 hex 키 암호화 — PatientService.encrypt 와 동일 포맷/키(운영 쓰기 경로 정본). */
export function encryptLegacyPid(text: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', rawKey(), iv);
  let enc = cipher.update(text, 'utf8', 'hex');
  enc += cipher.final('hex');
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc}`;
}

/** 주민번호 블라인드 인덱스 — PatientService.hashNationalId 와 동일(원시 키 HMAC). */
export function hashNationalIdLegacy(rrn: string): string {
  const normalized = rrn.replace(/\D/g, '');
  return createHmac('sha256', rawKey()).update('rrn:' + normalized).digest('hex');
}

/** 복호된 주민번호 마스킹 — "860513-1******"(PatientService.maskNationalId 규칙). */
export function maskRrn(plain: string): string {
  const d = (plain || '').replace(/\D/g, '');
  return d.length >= 7 ? `${d.slice(0, 6)}-${d[6]}******` : '******-*******';
}

/**
 * 전환기 혼재 컬럼(patient.nationalId) 복호 — **원시 키 우선, 파생 키 폴백**.
 * 통일 후 신규는 전부 원시 키지만, 마이그레이션 전 기존 파생-키 값(NICE·포털)도 읽어야 한다.
 * 복호 불가면 빈 문자열(소비처는 마스킹 placeholder 로 처리).
 */
export function decryptNationalIdTolerant(value: unknown): string {
  if (value == null || typeof value !== 'string' || value === '') return '';
  const raw = decryptLegacyPid(value);
  if (!isLegacyPidEncrypted(raw)) return raw; // 원시 키로 복호 성공(또는 평문)
  // 원시 실패(여전히 ciphertext) → 파생 키 시도
  try {
    const viaDerived = decryptField(value);
    if (typeof viaDerived === 'string' && !isLegacyPidEncrypted(viaDerived)) return viaDerived;
  } catch {
    /* 파생 복호 실패 — 아래 빈값 */
  }
  return '';
}

/**
 * 외국인 식별자(여권번호·외국인등록번호) 블라인드 인덱스 — 원시 키 HMAC.
 * 여권은 영숫자·대소문자 무시라 정규화는 trim + 대문자(숫자만 남기는 nationalId 규칙과 다르다).
 * 암호화(encryptLegacyPid)로 값은 감추되 정확 일치 조회/중복확인은 이 해시로 한다.
 */
export function hashForeignId(value: string): string {
  const normalized = (value || '').trim().toUpperCase();
  return createHmac('sha256', rawKey()).update('fid:' + normalized).digest('hex');
}
