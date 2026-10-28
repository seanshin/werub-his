/**
 * 방사선치료 상태 어휘 정본 (2026-08-18 · 이연 회수 T2-4)
 *
 * 🔴 실측에서 계획 상태 어휘가 갈라져 있었다:
 *   · 서버는 `APPROVED`(승인 시)·`IN_TREATMENT`(분획 생성 시)를 쓰는데,
 *     서버 자신의 허용 목록 `PLAN_STATUSES` 에는 **APPROVED 가 없었다**(스스로 만든 상태를 못 바꾼다).
 *   · 시드는 같은 파일 안에서 `IN_TREATMENT` 와 `IN_PROGRESS` 를 섞어 넣었다.
 *   · 화면 라벨표는 `ACTIVE`/`PLANNED`/`ON_HOLD`(치료계획 공통 어휘)라 실제 값과 겹치는 게 거의 없어
 *     **운영 5건 중 4건이 영문 원문 회색 배지**로 떴다(치료 중인 계획이 눈에 띄지 않는다).
 *   · 분획은 `DELIVERING`(조사 중) 상태를 서버가 만드는데 라벨표에 없었다.
 *
 * 규약: 방사선 상태는 이 표로만 표기한다(`<StatusBadge domain="radiationPlan" …>`).
 * 화면 로컬 Record 재정의 금지 — 어휘가 갈라지면 치료 중인 환자가 목록에서 안 띈다.
 */

/** 계획 생명주기 — PLANNED → APPROVED → IN_TREATMENT → COMPLETED (중단 CANCELLED·보류 ON_HOLD) */
export const RADIATION_PLAN_STATUS_LABEL: Record<string, string> = {
  PLANNED: '계획',
  APPROVED: '승인',
  IN_TREATMENT: '치료 중',
  COMPLETED: '완료',
  CANCELLED: '취소',
  ON_HOLD: '보류',
};

/** 분획 생명주기 — SCHEDULED → DELIVERING(조사 중) → DELIVERED. 건너뜀/취소는 종료 상태 */
export const RADIATION_FRACTION_STATUS_LABEL: Record<string, string> = {
  SCHEDULED: '예정',
  DELIVERING: '조사 중',
  DELIVERED: '조사 완료',
  SKIPPED: '건너뜀',
  CANCELLED: '취소',
};

export const RADIATION_PLAN_STATUSES: string[] = Object.keys(RADIATION_PLAN_STATUS_LABEL);
export const RADIATION_FRACTION_STATUSES: string[] = Object.keys(RADIATION_FRACTION_STATUS_LABEL);
