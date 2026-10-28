/**
 * 화면 접근 역할 정본 — **사이드바(nav)와 API `@Roles` 가 같은 목록 하나를 쓴다.**
 *
 * 🔴 발단(2026-08-27 · nav↔EP 전수 프로브 7,584회): `nav 숨김 ≠ 권한 회수` 의 반대 방향도 있었다 —
 *    **nav 는 여는데 API 가 막는** (화면×역할) 조합이 34건(화면 20개)이었다.
 *    사용자는 화면을 열 수 있으니 자기 계정이 고장난 것으로 읽는다.
 *      · `/transfer`·`/transfer/incoming`·`/transfer/history` — nav 는 NURSE 를 여는데 API 는 `@Roles(DOCTOR, ADMIN)`
 *        → **간호사에게는 전 패널 403**(화면이 통째로 사문)
 *      · `/patients` — nav 는 원무·검진까지 여는데 차트 EP 대부분이 403
 *
 * 🔴 **두 곳에 적으면 갈라진다.** 역할을 더 열거나 좁힐 때는 이 파일만 고치고,
 *    가드(`screen-access-parity.spec.ts`)가 nav 와 API 가 여전히 같은지 대조한다.
 */

/**
 * 환자 차트 — **의무기록·의료차트**다(2026-08-27 사람 결정).
 * 관련 직무를 가진 역할만 연다. 원무(RECEPTIONIST)·검진(CHECKUP)은 자기 화면
 * (`/reception`·`/billing`·`/checkup`)에서 일하고 차트는 열지 않는다.
 */
export const CHART_ACCESS_ROLES = ['ADMIN', 'DOCTOR', 'NURSE', 'MEDICAL_RECORDS'] as const;

/**
 * 환자 차트의 **임상 내용**(알레르기·문제목록·활성투약·최근활력)을 받을 수 있는 역할.
 * 🔴 약사는 차트 화면을 열지 않지만 조제·DUR 을 위해 임상 내용을 본다 —
 *    화면 접근과 내용 접근은 다른 축이다.
 */
export const CHART_CLINICAL_ROLES = ['ADMIN', 'DOCTOR', 'NURSE', 'PHARMACIST', 'MEDICAL_RECORDS'] as const;

/**
 * 전원(전과·전원 이송) — API `transfer.controller` 의 `@Roles` 와 같은 목록.
 * 🔴 nav 는 NURSE 까지 열고 있었으나 API 가 막아 **간호사에게는 열자마자 403** 이었다.
 */
export const TRANSFER_ACCESS_ROLES = ['ADMIN', 'DOCTOR'] as const;

export const canAccessChart = (role?: string | null): boolean =>
  !!role && (CHART_ACCESS_ROLES as readonly string[]).includes(role);

export const canReadChartClinical = (role?: string | null): boolean =>
  !!role && (CHART_CLINICAL_ROLES as readonly string[]).includes(role);

export const canAccessTransfer = (role?: string | null): boolean =>
  !!role && (TRANSFER_ACCESS_ROLES as readonly string[]).includes(role);
