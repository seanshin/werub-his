/**
 * QI 측정 원장 읽기 정본(2026-10-08 · QI 흐름).
 *
 * 🔴 측정은 **지우지 않고 무효화**한다(`voidedAt`) — 그런데 무효 행을 거르는 곳이 `/quality` 대시보드 하나뿐이라
 *    `/admin/qi` 지표 대시보드·`/qi/report`·`/safety-quality-board`·상황판은 무효 처리한 값을 그대로 달성률·추이에 썼다.
 * 🔴 병원 전체 값(층 '')만 대시보드·판정에 쓴다 — 병동별 층 행이 섞이면 같은 달이 여러 값이 된다.
 * 🔴 같은 달에 수기·자동 행이 나란히 있을 수 있다(출처 칸 sourceKey) — 정본은 `pickPrimaryMeasurement`(결정 qi.autoManual.precedence).
 * 읽는 쪽은 모두 이 조건을 쓴다 — 구조 가드 `test/quality-flow/qi-flow-p0.spec.ts` 가 직접 읽기를 막는다.
 */
import { normalizeQiPrecedence, pickPrimaryMeasurement, type QiPrecedence } from '@hospital-run/shared';

export const ACTIVE_MEASUREMENT = { voidedAt: null, stratumKey: '' } as const;

/** 기간별로 정본 한 행씩(최신 기간 먼저) — 자동 행은 alternate 로 병기 */
export function primaryPerPeriod<T extends { period: string; sourceKey?: string | null }>(rows: T[], precedence: QiPrecedence): Array<{ period: string; primary: T; alternate: T | null }> {
  const byPeriod = new Map<string, T[]>();
  for (const r of rows) byPeriod.set(r.period, [...(byPeriod.get(r.period) ?? []), r]);
  return [...byPeriod.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([period, list]) => {
      const { primary, alternate } = pickPrimaryMeasurement(list, precedence);
      return { period, primary: primary as T, alternate };
    })
    .filter((x) => x.primary);
}

/**
 * 정본 선택 설정 읽기 — 설정을 못 읽으면 기본 BOTH(수기 정본·자동 병기).
 * 🔴 기본으로 떨어진 것은 판정을 바꾸지 않는 쪽이다(현행과 같은 수기 정본) — 실패를 숨기려는 폴백이 아니다.
 */
export async function readQiPrecedence(config?: { get(key: string): Promise<unknown> } | null): Promise<QiPrecedence> {
  if (!config) return 'BOTH';
  try { return normalizeQiPrecedence(await config.get('qi.autoManual.precedence')); } catch { return 'BOTH'; }
}
