/**
 * 오더의 **진료 맥락 분류** — 순수 로직.
 *
 * 처방관리 화면은 지금까지 "누구의 오더인가"만 구분했다. 그런데 실제 처리 우선순위와 처리 시간대는
 * 환자가 **어디에 있는가**로 갈린다: 외래는 진료시간 내, 입원은 병동 라운드, 응급·중환자는 즉시.
 * 야간 당직이 "지금 내가 처리해야 할 것"을 고르려면 이 구분이 화면에 있어야 한다.
 *
 * 판정 근거는 전부 기존 데이터다(새 입력 요구 없음):
 *  - 입원: encounter.admissionId
 *  - 중환자: 배정 병상의 병동 이름(ICU·중환자 등) — 🔴 Ward 에 유형 필드가 없어 **이름으로 판정**한다.
 *    운영에서 병동 이름이 다르면 SystemConfig `ward.icuNames` 로 목록을 덮어쓴다.
 *  - 응급: encounter.visitType('ER_CONSULT') 또는 진행 중 응급 방문
 *  - 외래: 그 외
 */

export type CareContext = 'OUTPATIENT' | 'INPATIENT' | 'ICU' | 'ER';

export const CARE_CONTEXT_LABEL: Record<CareContext, string> = {
  OUTPATIENT: '외래',
  INPATIENT: '입원',
  ICU: '중환자',
  ER: '응급',
};

/** 기본 중환자 병동 이름 패턴 — 운영 병동명이 다르면 config 로 대체한다 */
export const DEFAULT_ICU_WARD_PATTERNS = ['ICU', 'CCU', 'NICU', 'SICU', 'MICU', '중환자'];

/** 응급 방문이 '진행 중'인 상태들 — 종결(COMPLETED)은 더 이상 응급 맥락이 아니다 */
const ACTIVE_ER_STATUS = new Set([
  'PENDING_TRIAGE', 'TRIAGED', 'PENDING_DOCTOR', 'IN_TREATMENT',
  'PENDING_RESULT', 'UNDER_OBSERVATION', 'PENDING_DISPOSITION',
]);

export interface CareContextInput {
  /** 진료의 입원 연결 */
  admissionId?: string | null;
  visitType?: string | null;
  /** 배정 병상의 병동 이름(입원일 때만 의미) */
  wardName?: string | null;
  /** 이 환자의 진행 중 응급 방문 상태(없으면 undefined) */
  erStatus?: string | null;
}

export function isIcuWard(wardName: string | null | undefined, patterns: string[] = DEFAULT_ICU_WARD_PATTERNS): boolean {
  if (!wardName) return false;
  const upper = wardName.toUpperCase();
  return patterns.some((p) => p && upper.includes(p.toUpperCase()));
}

/**
 * 맥락 판정. 우선순위는 **처리 긴급도 순**이다: 중환자 > 응급 > 입원 > 외래.
 * 응급실에 있다가 중환자실로 올라간 환자는 ICU 로 본다(현재 위치가 처리 방식을 정한다).
 */
export function careContextOf(i: CareContextInput, icuPatterns?: string[]): CareContext {
  if (i.admissionId && isIcuWard(i.wardName, icuPatterns)) return 'ICU';
  if (i.erStatus && ACTIVE_ER_STATUS.has(i.erStatus)) return 'ER';
  if ((i.visitType ?? '').toUpperCase().startsWith('ER')) return 'ER';
  if (i.admissionId) return 'INPATIENT';
  return 'OUTPATIENT';
}

/** 야간 시간대(KST) — 22:00 ~ 06:00. 컨테이너가 UTC 라 KST 로 환산해서 판정한다. */
export const NIGHT_START_HOUR = 22;
export const NIGHT_END_HOUR = 6;

export function kstHour(at: Date): number {
  return new Date(at.getTime() + 9 * 3600_000).getUTCHours();
}

export function isNightHour(at: Date): boolean {
  const h = kstHour(at);
  return h >= NIGHT_START_HOUR || h < NIGHT_END_HOUR;
}

/**
 * **야간에 처리 대상인가** — 야간 당직이 지금 처리해야 할 오더인지.
 *
 * 외래 루틴 오더는 다음 진료일에 처리하는 게 정상이라 야간 대상이 아니다. 반대로 입원·응급·중환자는
 * 시간대와 무관하게 상시 처리 대상이고, 긴급도(STAT/URGENT)는 어디서 나왔든 즉시 처리한다.
 * "야간에 발행된 것"과 "야간에 처리해야 하는 것"은 다르다 — 후자가 당직에게 필요한 값이다.
 */
export function isNightHandled(ctx: CareContext, priority?: string | null): boolean {
  if (ctx === 'ICU' || ctx === 'ER' || ctx === 'INPATIENT') return true;
  return priority === 'STAT' || priority === 'URGENT';
}

export interface CareContextResult {
  careContext: CareContext;
  careContextLabel: string;
  /** 야간 당직 처리 대상 */
  nightHandled: boolean;
  /** 야간 시간대에 발행된 오더(발행 시각 기준) */
  issuedAtNight: boolean;
}

export function buildCareContext(
  i: CareContextInput & { priority?: string | null; createdAt?: Date | null },
  icuPatterns?: string[],
): CareContextResult {
  const ctx = careContextOf(i, icuPatterns);
  return {
    careContext: ctx,
    careContextLabel: CARE_CONTEXT_LABEL[ctx],
    nightHandled: isNightHandled(ctx, i.priority),
    issuedAtNight: i.createdAt ? isNightHour(i.createdAt) : false,
  };
}
