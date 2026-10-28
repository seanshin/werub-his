/**
 * 처방 투여기간·조제 진행 단계 정본 — 2026-08-26.
 *
 * 🔴 이 파일이 생긴 이유 두 가지.
 *
 * ① **`PrescriptionStatus` 는 {ACTIVE, CANCELLED} 두 값뿐이었다**(2026-09-30 DISCONTINUED 추가 — 중단 시각은 `discontinuedAt` 으로 받는다).
 *    처방을 COMPLETED 로 바꾸는 코드 경로가 전역에 **0건**이다 — 즉 약을 다 먹었는지를
 *    상태로 아는 방법이 없다. 그런데 화면은 `'ACTIVE'|'COMPLETED'|'CANCELLED'|'SUSPENDED'`
 *    를 선언하고 **'완료' 탭**을 그렸다(구조적으로 영원히 0건).
 *    결과: 운영 실측 **활성 594건 중 306건(51.5%)이 이미 투여기간이 끝난 약**인데
 *    "현재 복용 중"으로 AI 약물상호작용 검사·간호 사이드레일·무균조제 대상에 흘렀다.
 *
 *    → **상태 전이를 바꾸지 않는다**(다른 소비처가 깨진다). 대신 이미 원장에 있는 사실
 *      (`createdAt` + `duration` 일)로 **투여기간을 계산해 화면이 사실을 말하게** 한다.
 *
 * ② **오더는 조제 완료 시점에 이미 `COMPLETED`** 로 닫힌다(`pharmacy.service.completeDispensing`).
 *    검수(VERIFIED)·불출(ISSUED)은 그 뒤에 온다. 그래서 `order.status` 만 읽는 화면은
 *    **검수 전·불출 전인데 '완료'** 라고 말한다(실측 5건 진행 중).
 *    → 조제가 있으면 **조제 단계가 정본**이다. 여기서 한 번만 판정한다.
 *
 * 규약:
 *  - 세 상태다. `DOSING`(투여 중) · `ENDED`(기간 종료) · `UNKNOWN`(기간 미상).
 *    **`duration` 이 없으면 `ENDED` 도 `DOSING` 도 아니다** — 모르는 것을 아는 척하지 않는다
 *    (운영 활성 594건 중 186건이 기간 미기재다. 이것을 '복용 중'이라 단정하면 거짓,
 *     '종료'라 단정하면 실제 복용 중인 약을 안전점검에서 떨어뜨린다).
 *  - **표시**와 **안전 점검**은 다른 질문이다. 표시는 `UNKNOWN` 을 그대로 '기간 미상'으로
 *    말하고, 상호작용·중복 점검은 `UNKNOWN` 을 **포함**한다(빠뜨리는 쪽이 더 위험하다).
 *    두 함수를 갈라 둔 이유가 이것이다 — 한 함수로 합치면 한쪽이 반드시 거짓이 된다.
 */

export type DosingState = 'DOSING' | 'ENDED' | 'UNKNOWN';

export interface DosingWindow {
  state: DosingState;
  /** 투여 종료 예정 시각(ISO). `duration` 이 없으면 **null** — 모르는 시각을 지어내지 않는다. */
  endsAt: string | null;
  /** 기간 종료 후 경과일. `ENDED` 일 때만 채워진다. */
  daysSinceEnd: number | null;
  /** 투여일수(원장 값 그대로). 없으면 null. */
  durationDays: number | null;
}

const DAY_MS = 86_400_000;

/**
 * 처방 한 건의 투여기간 상태.
 *
 * @param input.createdAt 처방 시각(원장). 파싱 불가면 `UNKNOWN` — 추정하지 않는다.
 * @param input.duration  투여일수. null·0·음수·비정수는 "기재되지 않음"으로 본다.
 * @param now             판정 기준 시각(테스트 주입용). 기본 현재.
 */
export function dosingWindow(
  input: { createdAt?: string | Date | null; duration?: number | null; discontinuedAt?: string | Date | null },
  now: Date = new Date(),
): DosingWindow {
  // 🔴 중단(2026-09-30)은 기간보다 먼저다 — 중단 시각이 지났으면 기간이 남았어도 '종료'다(그 뒤로 투여하지 않는다).
  //    기간을 몰라도 중단 시각은 안다 → endsAt 은 중단 시각(지어내지 않는다).
  const stop = input.discontinuedAt ? new Date(input.discontinuedAt) : null;
  if (stop && !Number.isNaN(stop.getTime()) && stop.getTime() <= now.getTime()) {
    const d = input.duration;
    const hasD = typeof d === 'number' && Number.isFinite(d) && d > 0;
    const startedAt = input.createdAt ? new Date(input.createdAt) : null;
    const plannedEnd = hasD && startedAt && !Number.isNaN(startedAt.getTime()) ? startedAt.getTime() + d! * DAY_MS : null;
    const endMs = plannedEnd != null ? Math.min(plannedEnd, stop.getTime()) : stop.getTime();
    return { state: 'ENDED', endsAt: new Date(endMs).toISOString(), daysSinceEnd: Math.floor((now.getTime() - endMs) / DAY_MS), durationDays: hasD ? d! : null };
  }
  const days = input.duration;
  const hasDuration = typeof days === 'number' && Number.isFinite(days) && days > 0;
  const start = input.createdAt ? new Date(input.createdAt) : null;
  const startValid = !!start && !Number.isNaN(start.getTime());

  // 시작 시각을 모르거나 투여일수가 없으면 기간을 말할 수 없다.
  if (!startValid || !hasDuration) {
    return { state: 'UNKNOWN', endsAt: null, daysSinceEnd: null, durationDays: hasDuration ? days! : null };
  }

  const endMs = start!.getTime() + days! * DAY_MS;
  const endsAt = new Date(endMs).toISOString();
  if (now.getTime() < endMs) {
    return { state: 'DOSING', endsAt, daysSinceEnd: null, durationDays: days! };
  }
  return {
    state: 'ENDED',
    endsAt,
    daysSinceEnd: Math.floor((now.getTime() - endMs) / DAY_MS),
    durationDays: days!,
  };
}

/** 화면 라벨 정본 — 로컬 Record 재정의 금지(UX 규약: 라벨이 갈라지면 같은 사실을 두 이름으로 부른다). */
export const DOSING_STATE_LABEL: Record<DosingState, string> = {
  DOSING: '투여 중',
  ENDED: '기간 종료',
  UNKNOWN: '기간 미상',
};

/**
 * **표시**용 판정 — "지금 복용 중이라고 화면에 써도 되는가".
 * `UNKNOWN` 은 false 다. 모르는 것을 '복용 중'이라 쓰지 않는다.
 */
export function isKnownDosing(state: DosingState): boolean {
  return state === 'DOSING';
}

/**
 * **안전 점검**용 판정 — 약물상호작용·중복·알레르기 대조 대상에 넣는가.
 * `UNKNOWN` 은 **포함**한다. 기간이 안 적힌 약을 점검에서 빼면 진짜 상호작용을 놓친다.
 * 반대로 기간이 확실히 끝난 약을 넣으면 거짓 경보가 되고, 거짓 경보는 진짜 경보를 죽인다.
 */
export function isScreenedForInteraction(state: DosingState): boolean {
  return state !== 'ENDED';
}

// ── 조제 진행 단계 ──

/**
 * 조제 체인의 단계. `order.status` 가 아니라 **`dispensing.status`** 가 정본이다.
 * (오더는 조제 완료에서 이미 COMPLETED 로 닫히므로 그 뒤 두 단계를 표현하지 못한다.)
 */
export type DispensingStage =
  | 'NOT_STARTED' // 조제 시작 전 — 오더만 있다
  | 'PREPARING'   // 조제 중 (Dispensing.PENDING)
  | 'DISPENSED'   // 조제 완료 · **검수 전**
  | 'VERIFIED'    // 검수 완료 · **불출 전**
  | 'ISSUED'      // 불출(교부) 완료
  | 'CANCELLED';  // 조제 취소

export const DISPENSING_STAGE_LABEL: Record<DispensingStage, string> = {
  NOT_STARTED: '조제 대기',
  PREPARING: '조제 중',
  DISPENSED: '조제 완료 · 검수 대기',
  VERIFIED: '검수 완료 · 불출 대기',
  ISSUED: '불출 완료',
  CANCELLED: '조제 취소',
};

/**
 * 오더 + 조제로부터 실제 단계를 판정한다.
 *
 * 🔴 **조제가 있으면 조제가 정본이다.** `order.status === 'COMPLETED'` 를 '완료'로 읽으면
 *    검수·불출 전인 건이 차트에서 끝난 일이 된다(이 함수가 생긴 이유).
 *
 * @returns 조제 이력이 아예 없으면 오더 상태로만 판정. 오더가 취소면 null 이 아니라 CANCELLED.
 */
export function dispensingStage(input: {
  orderStatus?: string | null;
  dispensingStatus?: string | null;
}): DispensingStage {
  const d = input.dispensingStatus;
  if (d === 'CANCELLED') return 'CANCELLED';
  if (d === 'ISSUED') return 'ISSUED';
  if (d === 'VERIFIED') return 'VERIFIED';
  if (d === 'DISPENSED') return 'DISPENSED';
  if (d === 'PENDING') return 'PREPARING';
  // 조제 기록이 없다 — 오더 상태로만 말할 수 있다.
  if (input.orderStatus === 'CANCELLED') return 'CANCELLED';
  if (input.orderStatus === 'IN_PROGRESS') return 'PREPARING';
  return 'NOT_STARTED';
}

/**
 * 🔴 "오더는 COMPLETED 인데 조제는 끝나지 않았다" — 차트가 '완료'라 말하면 거짓이 되는 조건.
 * 이 조건이 참인 동안 화면은 반드시 남은 단계를 밝혀야 한다.
 */
export function orderClaimsCompleteButNot(input: {
  orderStatus?: string | null;
  dispensingStatus?: string | null;
}): boolean {
  if (input.orderStatus !== 'COMPLETED') return false;
  const stage = dispensingStage(input);
  return stage === 'PREPARING' || stage === 'DISPENSED' || stage === 'VERIFIED';
}
