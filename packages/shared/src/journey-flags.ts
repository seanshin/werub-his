/**
 * 환자 여정 지연 플래그 정본 — **서버가 붙이는 어휘 그대로**.
 *
 * 🔴 발단(2026-08-26 사람 신고에서 파생): 같은 사실에 정본이 둘이었다.
 *   - 여정 콘솔(`/journey-console`)은 8종을 갖고 있었고,
 *   - 상황판(`/command-center`)은 7종인데 그중 `EXAM_DELAY`·`PHARMACY_DELAY` 는
 *     **서버가 낸 적이 없는 어휘**였고, 정작 **가장 많이 붙는 `WAIT_DELAY`(접수 지연)가 없었다.**
 *     운영 실측에서 지연 198명 중 194명이 `WAIT_DELAY` 였다 —
 *     즉 상황판 지연 목록의 대부분이 **영문 enum 을 그대로 찍고 있었다.**
 *
 * 🔴 그래서 라벨을 화면에서 다시 정의하지 않는다. 여기가 유일한 자리이고,
 *    **서버 소스의 `flags.push('…')` 집합과 기계로 대조**한다(가드).
 */
export type JourneyFlag =
  | 'WAIT_DELAY'
  | 'TRIAGE_DELAY'
  | 'CALL_DELAY'
  | 'CONSULT_DELAY'
  | 'CASHIER_DELAY'
  | 'SETTLE_PENDING'
  | 'LONG_STAY'
  | 'HIGH_UNPAID';

export interface JourneyFlagMeta {
  label: string;
  /** `danger` = 진료가 멈춰 있다 · `warn` = 흐름이 늦다 */
  tone: 'warn' | 'danger';
}

/**
 * 표시 순서 = 흐름 순서(접수 → 트리아지 → 호출 → 진료 → 수납 → 정산) 뒤에 재원·미수.
 * 🔴 **순서가 곧 정본이다** — 화면마다 다시 정렬하지 않는다.
 */
export const JOURNEY_FLAG_ORDER: JourneyFlag[] = [
  'WAIT_DELAY',
  'TRIAGE_DELAY',
  'CALL_DELAY',
  'CONSULT_DELAY',
  'CASHIER_DELAY',
  'SETTLE_PENDING',
  'LONG_STAY',
  'HIGH_UNPAID',
];

export const JOURNEY_FLAG_META: Record<JourneyFlag, JourneyFlagMeta> = {
  WAIT_DELAY: { label: '접수 지연', tone: 'warn' },
  TRIAGE_DELAY: { label: '트리아지 지연', tone: 'danger' },
  CALL_DELAY: { label: '호출 지연', tone: 'warn' },
  CONSULT_DELAY: { label: '진료 지연', tone: 'danger' },
  CASHIER_DELAY: { label: '수납 지연', tone: 'warn' },
  SETTLE_PENDING: { label: '정산 대기', tone: 'warn' },
  LONG_STAY: { label: '장기 재원', tone: 'warn' },
  HIGH_UNPAID: { label: '고액 미수', tone: 'warn' },
};

/**
 * 🔴 모르는 플래그를 **한국어인 척하지 않는다.** 서버가 새 어휘를 내면 그대로 보여주고,
 *    가드가 이 파일을 고치라고 실패한다(조용히 영문이 새는 것보다 낫다).
 */
export function journeyFlagLabel(flag: string): string {
  return JOURNEY_FLAG_META[flag as JourneyFlag]?.label ?? flag;
}

export function journeyFlagTone(flags: string[]): 'warn' | 'danger' {
  return flags.some((f) => JOURNEY_FLAG_META[f as JourneyFlag]?.tone === 'danger') ? 'danger' : 'warn';
}
