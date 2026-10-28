import { createHash, timingSafeEqual } from 'crypto';

/**
 * SMART 클라이언트 시크릿 해싱 — 고엔트로피(32B 랜덤) API 시크릿이므로 SHA-256(무염) 저장.
 * (저속 해시 불필요: 무차별 대입 불가능한 256-bit 랜덤. GitHub/Stripe 등 API 키와 동일 관행)
 * DB 유출 시에도 저장 해시로 원문 시크릿 복원 불가.
 */
export function hashClientSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** 길이 가드 + timing-safe 비교. */
export function safeSecretEqual(stored: string, candidate: string): boolean {
  const a = Buffer.from(stored);
  const b = Buffer.from(candidate);
  return a.length === b.length && timingSafeEqual(a, b);
}
