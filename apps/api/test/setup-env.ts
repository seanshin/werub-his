// 테스트 전역 환경 — 서명 토큰(signingSecret)이 AUTH_SECRET 을 요구하므로 주입.
// 실 시크릿과 무관한 테스트 전용 값(32자 이상).
process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? 'test-auth-secret-32-characters-long-xx';

// 🔴 2026-08-25: 위험한 폴백을 `NODE_ENV` 에 걸던 분기들을 **명시적 옵트인**으로 바꿨다
//    (운영 서버에 NODE_ENV 가 없어 폴백이 열려 있던 사고가 4건). 테스트는 실 시크릿을 쓰지 않으므로
//    그 옵트인을 여기서 준다 — **코드의 기본값을 완화하지 않고 테스트 환경만 명시한다.**
process.env.VOUCHER_SERIAL_SECRET = process.env.VOUCHER_SERIAL_SECRET ?? 'test-voucher-serial-secret-32-chars-xx';
// 🔴 AI egress 는 fail-closed(2026-09-09 P0-A) — 코드 기본값을 완화하지 않고 테스트 환경만 명시한다.
//    example.org=운영 AI 서버 · 10.0.0.5=ai-egress-guard 의 사설 GPU 대조군 · ai.example=voice-emr 하네스.
process.env.AI_EGRESS_ALLOWED_HOSTS = process.env.AI_EGRESS_ALLOWED_HOSTS ?? 'example.org,10.0.0.5,ai.example';
