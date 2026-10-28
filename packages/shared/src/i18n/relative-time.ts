/**
 * 상대시각 표기 정본 — "언제 갱신됐나"를 로케일별로 말한다.
 *
 * 🔴 종전에는 각 화면이 템플릿 리터럴로 조립했다(`${Math.floor(age/1000)}초 전`).
 *    그래서 화면 언어를 English 로 둬도 `갱신 23초 전` 이 한국어로 남았다(2026-09-10 운영 실측).
 *    조각으로 배선할 수도 없다 — 숫자와 단위의 순서·띄어쓰기가 언어마다 다르기 때문이다
 *    (`23초 전` / `23s ago` / `23秒前`). 그래서 **키와 파라미터**로 돌려주고 소비처가 `<Tf>` 로 그린다.
 *
 * 🔴 임계값은 표시 정책이지 데이터가 아니다 — 여기 한 곳에서만 정한다(소비처가 각자 정하면 갈라진다).
 */
export interface RelativeTimeText {
  /** 카탈로그 키(한국어 원문 · 자리표시자 포함) */
  key: string;
  /** 자리표시자 값 */
  params: Record<string, number>;
}

/** 데이터 신선도 배지용 — 5초 미만은 '방금', 그 뒤 초·분·시간 */
export function freshnessRelative(ageMs: number): RelativeTimeText {
  if (!Number.isFinite(ageMs) || ageMs < 0) return { key: '방금', params: {} };
  if (ageMs < 5_000) return { key: '방금', params: {} };
  if (ageMs < 60_000) return { key: '{초}초 전', params: { 초: Math.floor(ageMs / 1_000) } };
  if (ageMs < 3_600_000) return { key: '{분}분 전', params: { 분: Math.floor(ageMs / 60_000) } };
  return { key: '{시}시간 전', params: { 시: Math.floor(ageMs / 3_600_000) } };
}
