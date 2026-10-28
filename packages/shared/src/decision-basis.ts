/**
 * 결정 **근거** 어휘 정본 — "이 기능이 무슨 근거로 이렇게 동작하는가" (2026-08-27).
 *
 * 사람 지시: *"해당 기능들이 어떤 근거로 동작시켜야 하는지에 대해서 기록이 남아야 함."*
 *
 * 🔴 세 갈래를 **섞지 않는다.** 법령은 지켜야 하는 것이고, 인증 기준은 받으려는 것이고,
 *    원내 실측은 우리 데이터다. 한 배열에 뭉치면 "법으로 정해진 것"과 "우리가 그렇게 하기로 한 것"이
 *    구분되지 않는다 — 그 구분이 사라지면 나중에 아무도 무엇을 바꿔도 되는지 모른다.
 *
 * 🔴 **비어 있음이 기본 상태다.** 실측(2026-08-27): 결정 등록부 35항목 중 `legalReview` 가
 *    **13항목(37%)에서 비어 있다.** 근거의 유입원 자체가 비어 있으므로, 이 구조는
 *    "채워질 것"을 전제하면 안 된다.
 */

/** 근거 갈래 — 정본. 여기 없는 키는 저장하지 않는다(어휘를 지어내지 않는다) */
export const BASIS_KINDS = ['legal', 'accreditation', 'evidence'] as const;
export type BasisKind = (typeof BASIS_KINDS)[number];

export const BASIS_KIND_LABEL: Record<BasisKind, string> = {
  legal: '법령·고시',
  accreditation: '인증 기준',
  evidence: '원내 실측',
};

export const BASIS_KIND_HINT: Record<BasisKind, string> = {
  legal: '지켜야 하는 것 — 예: 의료법 §22, 환자안전법 §17',
  accreditation: '받으려는 것 — 예: 의료기관 인증 Ver.5.0 IPSG.3',
  evidence: '우리 데이터 — 예: 게이트 위반 30일 12건',
};

/**
 * 근거 묶음.
 *
 * 🔴 `undefined`(키 없음) = **미기재** · `[]`(빈 배열) = **검토했고 해당 없음**.
 *    이 둘은 다른 사실이다. 뭉개면 "법적 검토를 안 한 것"과 "법적 근거가 없다고 판단한 것"이 같아진다.
 */
export type DecisionBasis = Partial<Record<BasisKind, string[]>>;

export interface BasisSummary {
  /** 갈래별 건수. 미기재는 `null`, 해당 없음은 `0` */
  counts: Record<BasisKind, number | null>;
  /** 하나라도 근거가 적힌 갈래가 있는가 */
  hasAny: boolean;
  /** 🔴 아무 갈래도 손대지 않았는가(전부 미기재) — 화면이 "근거 없음"이라 말할 수 있는 유일한 상태 */
  untouched: boolean;
}

export function summarizeBasis(basis: DecisionBasis | null | undefined): BasisSummary {
  const counts = {} as Record<BasisKind, number | null>;
  let hasAny = false;
  let untouched = true;
  for (const k of BASIS_KINDS) {
    const v = basis?.[k];
    if (v === undefined) {
      counts[k] = null;            // 미기재
    } else {
      untouched = false;           // 손을 댔다(빈 배열이어도 "해당 없음"이라는 판단이다)
      const n = Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).length : 0;
      counts[k] = n;
      if (n > 0) hasAny = true;
    }
  }
  return { counts, hasAny, untouched };
}

/** 저장된 Json 을 근거로 안전하게 읽는다 — 정본에 없는 키는 **버린다** */
export function readBasis(raw: unknown): DecisionBasis | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const out: DecisionBasis = {};
  let touched = false;
  for (const k of BASIS_KINDS) {
    if (!(k in src)) continue;
    const v = src[k];
    if (!Array.isArray(v)) continue;
    out[k] = v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((x) => x.trim());
    touched = true;
  }
  return touched ? out : null;
}

/**
 * 표면이 지금 값인 **근거 상태** — 3상.
 *
 * 🔴 종전 조회는 결정 체인이 비면 빈 배열만 돌려줬고, 그러면 소비처가
 *    "결정이 없다"와 "이 표면은 애초에 결정 대상이 아니다"를 **구분할 수 없다.**
 *    구분하지 못하면 화면은 둘 다 똑같이 조용히 그린다 — 기본값을 정책처럼 보이게 하는 그 경로다.
 */
export type BasisState =
  /** 결정으로 정해졌다 */
  | 'DECIDED'
  /** 🔴 거버넌스 대상인데 아무도 정하지 않았다 — 지금 값은 코드 기본값이다 */
  | 'NO_DECISION'
  /** 담당도 규칙도 없다 — 결정 대상으로 등재된 적이 없다 */
  | 'NOT_GOVERNED';

export const BASIS_STATE_LABEL: Record<BasisState, string> = {
  DECIDED: '결정으로 정해짐',
  NO_DECISION: '의결 근거 없음',
  NOT_GOVERNED: '거버넌스 미등재',
};
