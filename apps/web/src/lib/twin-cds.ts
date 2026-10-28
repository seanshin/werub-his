/**
 * 🔴 트윈 CDS 위험 카드 — 화면이 무엇을 말할지(r3 B2 · 2026-09-28).
 *
 * 서버(`GET /api/v1/twin/cds/patient-view/:id`)는 실패(401·5xx·차단·미설정)도 `cards: []` 로 준다(차트 fail-soft).
 * 종전 화면은 0장이면 철회 링크만 그려 "위험 카드 없음"과 "트윈에 물어보지 못함"을 가르지 못했다(P17).
 * 이제 서버가 `status` 를 싣고, 화면은 이 함수 하나로 가른다.
 *
 *  - LOADING      — 아직 응답 전(🔴 "확인 불가"로 말하지 않는다)
 *  - CARDS        — 트윈이 답했고 카드가 있다
 *  - NONE         — 트윈이 답했고 **진짜 0장**(status OK)
 *  - UNCONFIGURED — 트윈 연동 미설정(요청을 보내지 않았다)
 *  - UNCHECKED    — 보냈으나 답을 못 받았거나(UNAVAILABLE) 조회 자체가 실패했다 · status 를 모르는 응답
 */
export type TwinCdsStatus = 'OK' | 'NO_CONSENT' | 'UNCONFIGURED' | 'UNAVAILABLE';
export interface TwinCdsResponse<C = unknown> {
  cards?: C[];
  status?: TwinCdsStatus;
  reason?: string | null;
  upstreamStatus?: number;
}
export type TwinCdsView = 'LOADING' | 'CARDS' | 'NONE' | 'UNCONFIGURED' | 'UNCHECKED';

export function twinCdsView(q: { data: TwinCdsResponse | undefined; isError: boolean }): TwinCdsView {
  if (q.isError) return 'UNCHECKED';
  if (!q.data) return 'LOADING';
  const cards = Array.isArray(q.data.cards) ? q.data.cards : [];
  switch (q.data.status) {
    case 'OK':
      return cards.length ? 'CARDS' : 'NONE';
    case 'UNCONFIGURED':
      return 'UNCONFIGURED';
    default:
      // UNAVAILABLE · NO_CONSENT(동의 조회와 엇갈린 경우) · status 없는 응답 — 0장을 "없음"으로 읽지 않는다
      return cards.length ? 'CARDS' : 'UNCHECKED';
  }
}
