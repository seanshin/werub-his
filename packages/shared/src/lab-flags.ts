/**
 * 검사 결과 flag 판정 정본 (lab-critical-flag-lis-contract.md).
 *
 * HIS flag 집합 = referenceRange.computeFlag 산출: LL/HH(위급)·L/H(이상)·A(정성 이상)·N(정상)·null(미판정).
 * 🔴 화면·전달이 flag 를 **부분 매칭(H/L 만)** 하면 위급값(HH·LL)이 정상처럼 새어 임상 안전 사고가 된다.
 *    표시·경보·FHIR 전달이 모두 이 정본을 쓴다. (FE 인라인 헬퍼 3곳·BE lab.service·fhir.controller 수렴)
 */

export type LabFlag = 'N' | 'NORMAL' | 'H' | 'L' | 'HH' | 'LL' | 'A' | 'AA' | 'C' | 'CC' | 'CRITICAL' | 'PANIC';

/**
 * 위급 flag — HIS 는 HH/LL(·정성 AA)를 낸다. C·CC·CRITICAL·PANIC 은 외부·구데이터 방어.
 * 🔴 export 하는 이유: DB 질의(`flag: { in: … }`)가 이 목록을 손으로 다시 적으면 정본이 둘이 된다.
 *    "원자료에 위급 flag 가 있는데 경보가 없다"를 세는 지표가 이 목록으로 원자료를 훑는다.
 */
export const CRITICAL_LAB_FLAGS = ['HH', 'LL', 'AA', 'C', 'CC', 'CRITICAL', 'PANIC'] as const;
const CRITICAL_FLAGS: readonly string[] = CRITICAL_LAB_FLAGS;

/** 이상(정상 아님) — null/N/NORMAL 만 정상. 그 외 flag 는 전부 이상으로 본다(오정상 방지). */
export function isAbnormalFlag(f?: string | null): boolean {
  return !!f && f !== 'N' && f !== 'NORMAL';
}

/**
 * 🔴 **판정됐는가** — `null`/빈 flag 는 "정상"이 아니라 **판정하지 못한 것**이다.
 *
 * 2026-09-21 외부 점검: HIS 기준치 마스터에 그 검사가 없으면 `flagValue()` 가 `null` 을 돌려준다
 * (서버는 옳다 — `'N'` 으로 강제하지 않는다). 그런데 화면이 `null` 과 `'N'` 을 똑같이 아무것도 안 그려
 * 검증하는 사람이 **정상으로 읽었다.** 세 상태다: 정상(N) / 이상(H·L·HH·LL…) / **미판정(null)**.
 * 미판정은 초록으로도 빨강으로도 그리지 않는다 — 원인(기준치 미등록·정성 정상값 미설정)은 단정하지 않는다.
 */
export function isJudgedFlag(f?: string | null): boolean {
  return f != null && String(f).trim() !== '';
}

/** 미판정 표시 문구 정본 — 화면·인쇄물이 같은 말을 쓴다(i18n 카탈로그 키 = 이 원문). */
export const LAB_FLAG_UNJUDGED_TEXT = '판정 불가';
export const LAB_FLAG_UNJUDGED_HINT = '기준치가 등록되지 않아 정상·이상을 판정하지 못했습니다 — 정상이라는 뜻이 아닙니다.';

/** 위급(패닉값) — 즉시 통보 대상. */
export function isCriticalFlag(f?: string | null): boolean {
  return !!f && CRITICAL_FLAGS.includes(f);
}

/** 높음 방향(H·HH) */
export function isHighFlag(f?: string | null): boolean {
  return f === 'H' || f === 'HH';
}

/** 낮음 방향(L·LL) */
export function isLowFlag(f?: string | null): boolean {
  return f === 'L' || f === 'LL';
}

/**
 * HIS flag → FHIR R4 ObservationInterpretation 코드(system v3-ObservationInterpretation).
 * 🔴 위급(HH/LL)을 표준 위급 코드 그대로 전달한다 — H/L 로 격하하면 LIS·외부가 위급을 못 받는다.
 */
export function toFhirInterpretation(f?: string | null): string {
  if (f === 'HH') return 'HH'; // Critical high
  if (f === 'LL') return 'LL'; // Critical low
  if (f === 'H') return 'H';
  if (f === 'L') return 'L';
  if (f === 'AA' || f === 'C' || f === 'CC' || f === 'CRITICAL' || f === 'PANIC') return 'AA'; // Critical abnormal
  if (f === 'A') return 'A';
  return 'N';
}

/**
 * FHIR ObservationInterpretation 코드 → HIS flag (LIS 수신 fallback).
 * 🔴 정성 위급(값 없는 배양·항체 등, HIS 기준치 마스터 없음)은 computeFlag/textNormal 로 판정 불가 →
 *    LIS interpretation(HH/LL/AA)을 fallback 으로 써야 위급을 놓치지 않는다. 알 수 없는 코드는 null(미판정).
 */
export function fromFhirInterpretation(code?: string | null): LabFlag | null {
  if (!code) return null;
  const c = code.toUpperCase();
  if (c === 'HH') return 'HH';
  if (c === 'LL') return 'LL';
  if (c === 'H' || c === 'HU') return 'H';
  if (c === 'L' || c === 'LU') return 'L';
  if (c === 'AA') return 'AA'; // Critical abnormal(정성 위급) — isCriticalFlag 가 인식
  if (c === 'A') return 'A';
  if (c === 'N') return 'N';
  return null;
}

/**
 * 🔴 위급검사값(critical value) 통보를 **받고 확인(read-back)할 수 있는 역할** — FE·API 공용 정본.
 *
 * 2026-08-21 실측: 위급검사값 배너가 `(main)` 레이아웃에 있어 **모든 직군의 모든 화면**에 렌더됐는데,
 * EP `/api/v1/lab/critical-values/pending` 은 `LAB_TECH·ADMIN·DOCTOR·NURSE` 전용이었다.
 * 그래서 **14역할 중 9역할(급양·원무·의무기록·검진·CRM×2·행정·경영·조회)이
 * 모든 화면에서 "Forbidden resource" 빨간 배너**를 봤다.
 *
 * 🔴 EP 를 여는 것은 답이 아니다 — 위급검사값은 임상 정보이고 read-back 은 임상 행위다.
 *    화면이 부르지 않아야 한다. 그래서 **역할 목록을 한 곳에 두고** FE·API 가 같은 것을 본다
 *    (양쪽에 따로 적으면 갈라진다 — 이 저장소에서 반복된 유형).
 */
export const CRITICAL_VALUE_ACK_ROLES = ['LAB_TECH', 'ADMIN', 'DOCTOR', 'NURSE'] as const;
export type CriticalValueAckRole = (typeof CRITICAL_VALUE_ACK_ROLES)[number];

/** 이 역할이 위급검사값 통보 대상인가 — 아니면 화면이 조회조차 하지 않는다 */
export const canAckCriticalValue = (role: string | null | undefined): boolean =>
  !!role && (CRITICAL_VALUE_ACK_ROLES as readonly string[]).includes(role);
