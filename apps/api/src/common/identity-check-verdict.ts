/**
 * 환자 본인확인(IPSG.1) 판정 정본 — **클라이언트의 PASS 선언을 믿지 않는다.**
 *
 * 🔴 2026-09-15 실측(B9 기록분): `verifyIdentity` 는 `result:'PASS'` 만 오면 대조 항목 없이
 *    `verifiedItems: {}` 로 PASS 를 기록했다. 2026-08-18 봉합("항목 없으면 400")이 **명시 PASS 에는
 *    적용되지 않는 구멍**이었다 — 무엇을 대조했는지 아무도 모르는 PASS 가 법정기록에 남고,
 *    환자안전 IPSG.1 식별률의 분자로 세어진다. 같은 구멍이 `POST /safety/identification-check`
 *    (화면 소비처 0·API 전용)에도 있었다: 본문이 `result` 를 그대로 정했다.
 *
 * 규칙(판정은 **실제로 대조한 항목**에서 유도한다):
 *  · 명시 `result:'FAIL'` → FAIL(사유 필수). 확인하기 전에 불일치를 발견한 경우라 항목 0 도 허용한다.
 *  · 불리언 항목이 하나도 없으면 **기록하지 않는다**(400) — 선언된 PASS 는 근거가 아니다.
 *  · 항목 중 하나라도 `false` → FAIL(사유 필수). 선언이 PASS 여도 서버 판정이 이긴다.
 *  · 전부 `true` → PASS.
 * 🔴 `false` 는 "대조했는데 불일치"다. "대조하지 않음"은 **키를 보내지 않는 것**으로 말한다
 *    (호출자가 미대조를 false 로 보내면 불일치로 기록된다 — 화면은 체크한 항목만 보낸다).
 */
export type IdentityVerdict = 'PASS' | 'FAIL';

export type IdentityVerdictProblem = 'ITEMS_REQUIRED' | 'FAIL_REASON_REQUIRED';

export interface IdentityVerdictInput {
  verifiedItems?: unknown;
  result?: string;
  failureReason?: string;
  exceptionReason?: string;
}

export interface IdentityVerdictOutcome {
  /** 서버가 판정한 결과 — 호출자가 선언한 result 가 아니다 */
  verdict: IdentityVerdict;
  /** 불리언 값만 남긴 대조 항목(그대로 저장한다 · 기본값 주입 금지) */
  items: Record<string, boolean>;
  /** 실패·예외 사유(없으면 null) */
  reason: string | null;
  /** 구두확인 등 예외 — 오류(FAIL)로 세지 않되 사유를 `[예외]` 로 표식 */
  exception: boolean;
  /** 판정 불가 사유 — 있으면 호출자가 400 으로 거절한다(기록하지 않는다) */
  problem: IdentityVerdictProblem | null;
}

/** 불리언 값만 남긴다 — 문자열 `"false"`·숫자 0 은 항목으로 세지 않는다(모르는 것을 아는 척하지 않는다). */
export function booleanItems(verifiedItems: unknown): Record<string, boolean> {
  if (!verifiedItems || typeof verifiedItems !== 'object' || Array.isArray(verifiedItems)) return {};
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(verifiedItems as Record<string, unknown>)) {
    if (typeof v === 'boolean') out[k] = v;
  }
  return out;
}

export function identityVerdict(input: IdentityVerdictInput, opts: { method?: string } = {}): IdentityVerdictOutcome {
  const items = booleanItems(input.verifiedItems);
  const entries = Object.entries(items);
  const explicitFail = String(input.result ?? '').toUpperCase() === 'FAIL';
  const reason = input.failureReason?.trim() || input.exceptionReason?.trim() || null;

  // 불일치 신고(명시 FAIL)는 대조 항목 없이도 남길 수 있다 — 사유가 근거다.
  if (explicitFail) {
    return { verdict: 'FAIL', items, reason, exception: false, problem: reason ? null : 'FAIL_REASON_REQUIRED' };
  }

  // 🔴 선언만으로 PASS 를 만들지 않는다 — 대조 항목이 근거다.
  if (entries.length === 0) {
    return { verdict: 'FAIL', items, reason, exception: false, problem: 'ITEMS_REQUIRED' };
  }

  const mismatched = entries.some(([, v]) => v === false);
  if (mismatched) {
    return { verdict: 'FAIL', items, reason, exception: false, problem: reason ? null : 'FAIL_REASON_REQUIRED' };
  }

  const exception = opts.method === 'VERBAL_EXCEPTION' || !!input.exceptionReason?.trim();
  return { verdict: 'PASS', items, reason, exception, problem: null };
}

/** 저장용 사유 — 예외는 `[예외]` 로 표식(오류 통계와 구분된다) */
export function identityReasonForStore(o: IdentityVerdictOutcome): string | null {
  if (!o.reason) return null;
  return o.exception ? `[예외] ${o.reason}` : o.reason;
}

export const IDENTITY_PROBLEM_CODE: Record<IdentityVerdictProblem, string> = {
  ITEMS_REQUIRED: 'IDENTITY_ITEMS_REQUIRED',
  FAIL_REASON_REQUIRED: 'IDENTITY_FAIL_REASON_REQUIRED',
};

export const IDENTITY_PROBLEM_MESSAGE: Record<IdentityVerdictProblem, string> = {
  ITEMS_REQUIRED:
    '본인확인 기록에는 실제로 대조한 항목(verifiedItems)이 필요합니다. 확인하지 않은 항목을 확인한 것으로 기록할 수 없습니다.',
  FAIL_REASON_REQUIRED: '본인확인 실패는 사유(failureReason)가 필요합니다.',
};
