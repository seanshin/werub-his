/**
 * 지시 경로(`prescriptions.order_source`) 어휘 정본 — FE·API 공용.
 *
 * 🔴 어휘가 두 곳에 적혀 있었다(2026-08-26 F3 고아 EP 회수에서 발견).
 *    · FE: `components/prescription/PrescriberDelegate.tsx` 의 `isVerbalOrder`
 *    · API: `prescription.service.ts` 안의 인라인 `orderSource === 'VERBAL' || orderSource === 'TELEPHONE'`
 *    두 벌이 우연히 같았을 뿐이고, 한쪽에 값을 늘리면 다른 쪽이 조용히 어긋난다
 *    (v4.6.0 에서 이미 겪은 함정 — FE 에 지어낸 어휘가 서버와 교집합 0 이었다).
 *    복창(read-back) 판정이 이 어휘 하나에 매달려 있으므로 여기 한 벌만 둔다.
 */

export const ORDER_SOURCE_OPTIONS = [
  { value: 'WRITTEN', label: '서면·전자 지시' },
  { value: 'VERBAL', label: '구두 지시 (대면)' },
  { value: 'TELEPHONE', label: '전화 지시' },
] as const;

export type OrderSource = (typeof ORDER_SOURCE_OPTIONS)[number]['value'];

/**
 * 복창(read-back)이 요구되는 지시 경로.
 * 🔴 서면·전자 지시에는 복창 개념 자체가 없다 — 없는 것을 "누락"으로 세지 않는다(분모 오염).
 */
export const VERBAL_ORDER_SOURCES = ['VERBAL', 'TELEPHONE'] as const;

export const isVerbalOrder = (v?: string | null): boolean =>
  v === 'VERBAL' || v === 'TELEPHONE';

/**
 * 구두처방 복창(read-back)을 **확인해 기록할 수 있는 역할** — FE·API 공용 정본.
 *
 * 🔴 `/safety` 는 전 직군 nav 다(사고 보고는 모든 직군의 일). 그러나 복창 확인은 **임상 행위**이고
 *    API 는 `@Roles(DOCTOR, NURSE, ADMIN)` 이다. 화면이 이 목록을 모르면 급양·원무 계정이
 *    탭을 눌렀을 때 403 빨간 배너를 본다(2026-08-21 사람 신고와 같은 함정).
 *    여기 한 벌만 두고 양쪽이 읽는다 — 양쪽에 적으면 갈라진다.
 */
export const READ_BACK_CONFIRM_ROLES = ['DOCTOR', 'NURSE', 'ADMIN'] as const;

export const canConfirmReadBack = (role?: string | null): boolean =>
  !!role && (READ_BACK_CONFIRM_ROLES as readonly string[]).includes(role);
