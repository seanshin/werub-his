/**
 * 사유(自由文) 입력 보조 프리셋 정본 (2026-08-24 · 입력 보조 UX P2 — input-assist-ux.plan.md §4)
 *
 * 🔴 **여기가 정하는 것은 입력 보조이지 허용 목록이 아니다.**
 *    정본 전례 `MEAL_UNDELIVERED_REASON_PRESET`(shared `diet.ts`)의 규약을 그대로 따른다:
 *    프리셋에 없는 값을 막지 않는다. 강제하는 것은 하나뿐 — **필수 자리면 비어 있으면 안 된다.**
 *    (급양 축에서 미배식 사유를 영문 enum 으로 강제하려다 철회했다. 아무도 쓰지 않는 어휘를
 *     지어내면 기존 화면이 깨지고 이미 남은 기록이 고아가 된다.)
 *
 * ## 🔴 2026-08-24 운영 DB 실측 — 어휘를 지어내지 않기 위해 먼저 센 것
 *
 * `information_schema` 로 `%reason%` 컬럼 **86개**를 뽑아 비어 있지 않은 행을 전수로 셌다.
 * 결과: **실사용(비시드) 쓰기가 5건 이상인 사유 도메인은 하나도 없다.**
 *
 * | 컬럼 | 비어있지 않은 행 | 판정 |
 * |---|---:|---|
 * | `waiting_queue.reason` | 903 | 688 = 롤포워드 배치 문장 · 나머지는 **증상**(방문 사유) → 아래 ①분류로 보류 |
 * | `appointments.reason` | 607 | 전량 시드 생성기의 8문안(90·90·90·90·60·60·60·60) → 방문 사유, 보류 |
 * | `emergency_reassessments.reason` | 51 | `[시연]` 2문안뿐(응급도 상향/하향) → ①분류, 보류 |
 * | `rrt_activations.reason` | 35 | `[시연]` NEWS2 서술 → ①분류, 보류 |
 * | `admissions.admit_reason` / `icu_admissions.admit_reason` | 33 / 25 | `[시연]` 임상 서술(폐렴·패혈증·DKA…) → ①분류, 보류 |
 * | `patient_flags.reason` | 21 | 전 23행이 **2026-06-05 한 날 생성**(시드 군집) → 보류(사유는 아래) |
 * | `supply_transactions.reason` | 21 | 16 = '초기 재고'(부트스트랩) · 나머지 E2E 문자열 → 보류 |
 * | `inventory_transactions.reason` | 10 | 시드 UUID·**물류 표준 어휘 4종이 반복** → 🟢 **유일한 채택** |
 * | `medication_administrations.hold_reason` | 10 | `[시연]` 3문안 + 실쓰기 1 → 보류(사유는 아래) |
 * | 취소·반려·보류·환불·변경 사유 전 컬럼 | **0~4** | `appointments.cancel_reason` 4(전부 '테스트 정리'류) · `billings.refund_reason` 2(E2E) · `billings.deferred_reason`·`billings.discount_reason`·`claims.reject_reason`·`document_requests.reject_reason`·`compounding_orders.cancel_reason`·`qi_measurements.void_reason` = **전부 0행** → 프리셋 없이 시작 |
 *
 * ## 🔴 채택하지 않은 두 건의 사유 — 문안이 자연스럽다고 다 채택하지는 않는다
 *
 * 1. **`medication_administrations.hold_reason` (투약 보류)** — 미배식 사유와 성격이 같아 가장 유력했다.
 *    그런데 저장된 문안이 `금식 중으로 **담당의 확인 후** 보류` · `환자 복용 거부 — **담당의 보고함**` 이다.
 *    🔴 이것을 한 번 클릭으로 고르게 만들면 **하지 않은 행위를 기록이 주장한다**(P16 — 실행하지 않고
 *    성공 상태만 기록). 문장을 잘라 '금식 중' 만 남기면 그건 내가 어휘를 지어낸 것이다. 둘 다 안 된다
 *    → 문안 확정은 기획서 §6 사람 게이트(각 부서장).
 * 2. **`patient_flags.reason` (환자 플래그)** — `진료 중 폭언·위협`·`반복 무단취소·노쇼` 등 행정 어휘이고
 *    반복도 있다. 그러나 이 기록은 **환자에게 불리하게 남는 낙인**이다. 한 번 클릭으로 붙일 수 있게
 *    만드는 것은 입력 보조가 아니라 **기록의 문턱을 낮추는 일**이다 → 자유 입력으로 남긴다.
 *
 * ## 나머지 도메인이 빈 배열인 이유
 *
 * 실사용 어휘가 아직 없다(대부분 **0행**). 지금 채우면 그건 실측이 아니라 창작이다.
 * 도메인 키는 **미리 등재해 둔다** — 운영이 쌓이면 이 파일 한 곳만 고치면 되고(정본이 둘이 되지 않는다),
 * 그때까지 화면은 프리셋 없는 자유 입력으로 정확히 지금과 같이 동작한다.
 * 채택률(기획서 §3-6)을 잴 때 분모가 되는 것도 이 키 목록이다.
 *
 * 🔴 shared(`packages/shared`) 승격은 **하지 않았다** — `packages/shared/src/index.ts` 는 이 축에서
 *    수정 금지 파일이다. 서버가 이 어휘를 읽어야 할 이유도 아직 없다(서버는 사유를 검증하지 않고,
 *    검증해서도 안 된다). 승격 판단은 코디네이터에게 넘긴다.
 */

/** 사유 입력 도메인 — 화면이 이 키로 프리셋을 참조한다 */
export type ReasonDomain =
  // 결재·인사
  | 'approvalDelegate'
  | 'approvalReject'
  | 'attendanceCorrection'
  | 'overtime'
  | 'essLeave'
  // 약제
  | 'prescriptionCancel'
  | 'medicationHold'
  | 'medicationRefuse'
  // 물류
  | 'inventoryTxn'
  | 'inventoryCount'
  | 'cssdAction'
  // 원무·청구
  | 'billingCancel'
  | 'billingHold'
  | 'claimAdjust'
  | 'claimReject'
  // 진료 운영
  | 'chemoDelay'
  | 'qiVoid'
  | 'documentReject'
  | 'certRevoke'
  | 'patientEdit'
  | 'patientFlag'
  | 'erReassess'
  | 'erTransfer';

/**
 * 도메인 → 자주 쓰는 사유. **빈 배열 = 실사용 어휘가 아직 없다**(위 §실측).
 * 프리셋이 비면 `<ReasonInput>` 은 datalist 를 렌더하지 않는다 — 지금과 똑같은 자유 입력이다.
 */
export const REASON_PRESETS: Readonly<Record<ReasonDomain, readonly string[]>> = {
  /**
   * 🟢 유일한 채택. `inventory_transactions.reason` 실측 10행의 전 어휘를 **저장된 문자열 그대로**
   *    옮겼다(빈도: 부서 불출 4 · 정기 입고 4 · 재고 실사 조정 1 · 미사용 반납 1).
   *    시드 UUID 로 생성됐지만 ①임상 판단이 아니고 ②행위를 주장하지 않으며 ③물류 표준 어휘라
   *    창작 위험이 없다. 한 글자도 고치지 않았다 — 고치면 기존 10행과 갈라진다.
   */
  inventoryTxn: ['정기 입고', '부서 불출', '재고 실사 조정', '미사용 반납'],

  // ── 아래는 전부 실사용 부족(0~4행)으로 보류. 위 주석의 판정 근거를 참조한다 ──
  approvalDelegate: [],
  approvalReject: [],
  attendanceCorrection: [],
  overtime: [],
  essLeave: [],
  prescriptionCancel: [],
  medicationHold: [], // 보류 근거: 저장 문안이 '담당의 확인 후'·'담당의 보고함' — 행위 주장(P16)
  medicationRefuse: [],
  inventoryCount: [], // 실측 1문안('파손 2건')뿐 — 반복 어휘로 볼 수 없다
  cssdAction: [],
  billingCancel: [],
  billingHold: [],
  claimAdjust: [], // 실측 2행('중복 산정'·'산정기준 초과') — 표본 5 미만
  claimReject: [],
  chemoDelay: [],
  qiVoid: [],
  documentReject: [],
  certRevoke: [],
  patientEdit: [],
  patientFlag: [], // 보류 근거: 환자에게 불리한 낙인 기록의 문턱을 낮추지 않는다
  erReassess: [],
  erTransfer: [],
};

/**
 * 사유가 채워졌는가 — **필수 자리의 판정 정본.**
 *
 * 🔴 실측: `사유(필수)` 라고 적어놓고 게이트는 `!reason` 인 자리가 **21곳**이었다.
 *    공백 한 칸이면 통과하고, 원장에는 `' '` 가 남는다("비어 있으면 안 된다"가 지켜지지 않는다).
 *    화면이 요구한 것과 코드가 검사한 것이 달랐던 자리다.
 */
export function reasonFilled(value: string | null | undefined): boolean {
  return (value ?? '').trim().length > 0;
}
