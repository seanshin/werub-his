/**
 * 🔴 "오늘" 날짜 문자열 정본 (KST) — 2026-09-01.
 *
 * `new Date().toISOString().slice(0, 10)` 은 **UTC 날짜**다 — KST 00:00~09:00 에 어제를 준다.
 * 이 관용구가 FE 56곳에 있었고, 그중 간호 태블릿 급식·입원 타임라인·플로시트·검진 접수 등
 * **조회 키**와 장비 점검일·식이 시작일 등 **쓰기 폼 기본값**이 새벽마다 하루 밀렸다.
 * (같은 부류를 BE 에서 이미 수렴: common/day-range §날짜밀림 — 이것은 그 FE 판이다.)
 *
 * 병원 운영 TZ 는 KST 로 고정이라 브라우저 TZ 와 무관하게 Asia/Seoul 로 계산한다.
 */
export function kstToday(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

/** 오늘부터 n 일 뒤(KST) — `new Date(Date.now()+n*86400000).toISOString()` 대체 */
export function kstTodayPlus(days: number): string {
  return new Date(Date.now() + days * 86400000).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}

/**
 * 시각(ISO·Date) → 그 시각의 KST 날짜(`YYYY-MM-DD`) — 값이 없거나 해석 불가면 null.
 * 🔴 `iso.slice(0, 10)` 은 UTC 날짜다 — KST 00:00~09:00 의 수술·예약이 전날로 떨어진다(2026-10-02 대시보드).
 */
export function kstDateOf(v: string | Date | null | undefined): string | null {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
}
