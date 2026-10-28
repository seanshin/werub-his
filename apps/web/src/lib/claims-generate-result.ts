/**
 * 청구 일괄 생성 결과 문장 — `POST /api/v1/claims/generate` 가 돌려주는 세 수를 **갈라서** 말한다(2026-09-30).
 *
 * 🔴 종전 화면은 응답을 읽지 않고 늘 "청구 데이터가 생성되었습니다"였다 — 0건이어도, 전부 다른 창에서 이미
 *    청구돼 건너뛰었어도 같은 성공 문장(P16 — 실행 결과와 무관한 성공 표시). 서버는 이미 `skipped` 를 주고 있었다.
 */
export interface ClaimGenerateResult {
  generated: number | null;
  skipped: number | null;
  excludedSelfPay: number | null;
  /** 산재·자동차보험 — 청구처가 달라 이 청구로 만들지 않은 수(P2-2 · 구 서버는 없음 = null) */
  excludedOtherPayer?: number | null;
}

/** 응답 모양(이중 래핑·구 서버 excludedSelfPay 없음)을 받아낸다 — 못 읽은 수는 null(0 으로 채우지 않는다) */
export function readClaimGenerateResult(res: unknown): ClaimGenerateResult {
  const outer = (res as { data?: unknown })?.data ?? res;
  const d = ((outer as { data?: unknown })?.data ?? outer) as Record<string, unknown> | null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return { generated: num(d?.generated), skipped: num(d?.skipped), excludedSelfPay: num(d?.excludedSelfPay), excludedOtherPayer: num(d?.excludedOtherPayer) };
}

export type ClaimGenerateTone = 'success' | 'warning' | 'info';

/** 사람이 읽을 요약 — 한 문장에 사실을 섞지 않고 조각으로 돌려준다(화면이 번역·조립) */
export function describeClaimGenerate(r: ClaimGenerateResult): { tone: ClaimGenerateTone; parts: { key: string; n?: number }[] } {
  if (r.generated == null) return { tone: 'warning', parts: [{ key: '청구 생성 결과를 확인하지 못했습니다 — 목록을 새로고침해 확인하세요.' }] };
  const parts: { key: string; n?: number }[] = [];
  if (r.generated > 0) parts.push({ key: '청구 생성', n: r.generated });
  if ((r.skipped ?? 0) > 0) parts.push({ key: '이미 청구가 있어 건너뜀', n: r.skipped! });
  if ((r.excludedSelfPay ?? 0) > 0) parts.push({ key: '자비 수납 제외', n: r.excludedSelfPay! });
  if (r.excludedOtherPayer != null && r.excludedOtherPayer > 0) parts.push({ key: '산재·자동차보험 제외(청구처 다름)', n: r.excludedOtherPayer });
  if (r.generated > 0) return { tone: 'success', parts };
  if (parts.length > 0) return { tone: 'warning', parts: [{ key: '새로 만든 청구 0건' }, ...parts] };
  return { tone: 'info', parts: [{ key: '청구할 수납이 없습니다(수납 완료·미청구 0건).' }] };
}
