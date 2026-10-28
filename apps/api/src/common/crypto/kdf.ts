import { scryptSync } from 'crypto';

// 대칭 필드 암호화용 KDF 공용 헬퍼 (code-analyzer 잔여: scrypt salt 일원화)
// ⚠️ 단일 마스터키(ENCRYPTION_KEY) 설계라 salt는 "결정적"이어야 한다 —
//    salt를 바꾸면 도출 키가 달라져 기존 암호문(Patient.nationalId 등) 복호 불가(데이터 손실).
//    따라서 기본값은 레거시와 동일한 'salt'를 유지(하위호환). 신규 배포는 ENCRYPTION_KDF_SALT로 강화 가능.
//    salt 변경 시 전 필드 재암호화 마이그레이션 동반 필수.
// field-encryption.ts / patient-auth encryption.service / terminal-draft / onboarding 가 공유 — 키 일치 보장.

const LEGACY_SALT = 'salt';

/** ENCRYPTION_KEY(+선택 ENCRYPTION_KDF_SALT)에서 AES-256 키(32B)를 도출. salt 기본값은 레거시 호환. */
export function deriveAesKey(secret: string): Buffer {
  const salt = process.env.ENCRYPTION_KDF_SALT || LEGACY_SALT;
  return scryptSync(secret, salt, 32);
}
