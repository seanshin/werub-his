import { formatNum, roundBy } from './numeric-policy';

/**
 * 비율·완결률 정본 — **분모와 함께** 낸다(`clinical-ux-agent-era.plan.md` §2.1·§3.3).
 *
 * 🔴 분모 0이면 완결률은 100% 가 되고(v4.4.0 실측), 표본 부재를 `0%` 로 그리면 "가장 안정적"으로 읽힌다
 *    (ICU NEWS2 위젯이 산출 불가를 `0점` 으로). 손위생 준수율이 관찰 0건에서 `-` 로 나오면 "안 잰 것"과
 *    "진짜 0" 이 같아 보인다. 그래서 비율은 **`n / N (p%)`** 한 덩어리로 다루고, N 이 0·미상이면 **산출 불가**다.
 *
 * `null` 분자 = 분자 자체를 모름(조회 실패·미집계) → 역시 산출 불가(다른 사유).
 */
export const RATIO_UNAVAILABLE = '산출 불가';

export interface RatioValue {
  numerator: number | null;
  denominator: number | null;
  /** 백분율(정책 `percent` 로 반올림) — 산출 불가면 null */
  pct: number | null;
  /** 왜 산출 불가인지 — 화면이 문구가 아니라 코드로 분기하도록 */
  unavailableReason: 'NO_DENOMINATOR' | 'ZERO_DENOMINATOR' | 'NO_NUMERATOR' | null;
}

export function ratioOf(numerator: number | null | undefined, denominator: number | null | undefined): RatioValue {
  const n = typeof numerator === 'number' && Number.isFinite(numerator) ? numerator : null;
  const d = typeof denominator === 'number' && Number.isFinite(denominator) ? denominator : null;
  if (d == null) return { numerator: n, denominator: null, pct: null, unavailableReason: 'NO_DENOMINATOR' };
  if (d <= 0) return { numerator: n, denominator: d, pct: null, unavailableReason: 'ZERO_DENOMINATOR' };
  if (n == null) return { numerator: null, denominator: d, pct: null, unavailableReason: 'NO_NUMERATOR' };
  return { numerator: n, denominator: d, pct: roundBy((n / d) * 100, 'percent'), unavailableReason: null };
}

/** `n / N (p%)` 또는 `산출 불가` — 표·카드 등 문자열이 필요한 곳의 정본 텍스트 */
export function ratioText(numerator: number | null | undefined, denominator: number | null | undefined, opts?: { pctOnly?: boolean; decimals?: number }): string {
  const r = ratioOf(numerator, denominator);
  if (r.pct == null) return RATIO_UNAVAILABLE;
  const pct = formatNum(r.pct, 'percent', { unit: false, override: opts?.decimals != null ? { decimals: opts.decimals } : undefined });
  if (opts?.pctOnly) return `${pct}%`;
  return `${r.numerator} / ${r.denominator} (${pct}%)`;
}
