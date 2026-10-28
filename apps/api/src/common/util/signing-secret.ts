/**
 * HMAC 서명 시크릿 파생 — 2026-07 시크릿 수명주기 전수.
 *
 * 🔴 종전 파일 토큰·스크라이브 오디오·의무기록 사본·업로드 서명이 전부
 *    `process.env.JWT_SECRET ?? 'hospital-run-secret'` 를 썼는데,
 *    **운영 .env 에 JWT_SECRET 이 없어 공개된 하드코딩 시크릿으로 서명**되고 있었다.
 *    소스가 공개돼 있으면 누구나 유효한 토큰을 위조할 수 있다.
 *
 * 로그인 JWT 는 `AUTH_SECRET`(getOrThrow·env.validation 에서 32자 필수)을 쓰므로 안전했다.
 * 나머지 서명도 **AUTH_SECRET 기반 + 용도별 도메인 분리**로 통일한다
 * (step-up 은 이미 `AUTH_SECRET + ':stepup'`, SSO 는 `':sso'` 를 쓰고 있었다).
 *
 * 하드코딩 폴백은 제거한다 — 미설정이면 서명이 아니라 **부팅이 실패**해야 안전하다(fail-closed).
 */
export function signingSecret(purpose: string): string {
  const base = process.env.AUTH_SECRET;
  if (!base || base.length < 32) {
    // env.validation 이 AUTH_SECRET 을 필수 32자로 검증하므로 정상 부팅에서는 도달하지 않는다.
    // 여기 도달했다면 환경이 잘못된 것이므로 하드코딩으로 서명하지 않고 즉시 실패시킨다.
    throw new Error('AUTH_SECRET 이 설정되지 않아 서명 토큰을 발급할 수 없습니다');
  }
  return `${base}:${purpose}`;
}
