import * as crypto from 'crypto';

/**
 * 상수시간 키 비교 — 타이밍 사이드채널 방지(서버-서버 연동키 검증).
 * expected 미설정(빈값) 또는 길이 불일치 시 false.
 */
export function secureKeyEqual(provided?: string | null, expected?: string | null): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
