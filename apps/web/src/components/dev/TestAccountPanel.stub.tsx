/**
 * 운영 빌드용 대체 모듈 — 테스트 계정 패널 자리에 들어간다.
 *
 * 🔴 조건부 렌더나 `dynamic(import())` 의 false 분기만으로는 **청크가 그대로 생성된다**
 *    (2026-08-24 실측: 빌드 산출물에 계정 목록과 공용 비밀번호가 남아 있었다).
 *    그래서 `next.config.ts` 가 운영 빌드에서 이 파일로 **모듈을 치환**한다 —
 *    데이터가 모듈 그래프에 아예 들어오지 않는다.
 */
export default function TestAccountPanelStub(): null {
  return null;
}
