/**
 * 결정 등록부 배치 N (2026-09-30) — **퇴원약 오더화**.
 *
 * 코드는 퇴원약을 처방 원장(dischargeMed)에 남기고 발행 정본(DUR·처방집·사전승인·약국 오더)을 지나게 한다.
 * 퇴원 때 입원 중 약을 자동으로 끊을지, 퇴원약 조제를 퇴원 가능 판정에 넣을지는 **원내 규정**이라 코드가 정하지 않는다.
 * `statusQuo` 는 배포한 코드를 다시 읽고 적었다. 🔴 등재 ≠ 결정 — 선택지와 결과만, 권고 없음.
 */
import type { DecisionDef } from './decision.registry';

const REF = '`apps/api/src/modules/prescription/prescription.service.ts` createDischargePrescription() · `apps/api/src/modules/inpatient/inpatient.service.ts` getDischargeReadiness() · `docs/01-plan/features/discharge-medication-orders.plan.md`';

export const DECISION_BATCH_2026_09_N: DecisionDef[] = [
  {
    key: 'discharge.stopInpatientMedsOnDischarge',
    track: 'CLINICAL',
    title: '퇴원 처리 때 입원 중 활성 약 처방을 시스템이 자동으로 중단할 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '퇴원 뒤에도 입원 중 약 처방이 활성으로 남으면 다음 입원·외래의 "현재 복용약"과 DUR 비교에 섞인다. 자동으로 끊으면 퇴원약으로 옮기지 않은 약이 ' +
      '말없이 멈추고, 끊지 않으면 의사가 하나씩 중단해야 한다. 자동으로 끊는 방향은 사람 판단이다.',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: '진료부 · 약제부 · 간호부',
    options: [
      { value: 'MANUAL', label: '현행 — 자동 중단 없음(의사가 처방별로 중단)', effect: '퇴원 뒤에도 입원 중 약 처방은 상태가 활성으로 남는다(투여기간 판정은 따로 본다).', enact: null },
      { value: 'AUTO_ON_DISCHARGE', label: '퇴원 처리 순간 입원 중 약(퇴원약 제외)을 자동 중단(사유 "퇴원")', effect: '코드 변경 — 퇴원 처리 트랜잭션이 중단(discontinue)을 부른다. 퇴원약은 그대로 남는다.', enact: null },
    ],
    statusQuo: '자동 중단 없음. 퇴원약(dischargeMed=true)만 새로 처방되고, 입원 중 약은 화면(투약 이력·입원 상세)에서 의사가 중단한다.',
    verifyHow: [REF],
    afterDecision: 'AUTO_ON_DISCHARGE 면 퇴원 처리 경로 개발.',
    owner: '진료부',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'discharge.medsDispensedForReady',
    track: 'CLINICAL',
    title: '원내 조제 퇴원약의 조제 완료를 "퇴원 가능" 판정 조건에 넣을 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '퇴원 준비 현황은 퇴원약 처방 건수와 원내 조제 완료 건수를 보여 주지만, "퇴원 가능"은 퇴원요약 서명과 정산만 본다. ' +
      '조제를 조건에 넣으면 약 없이 나가는 일을 줄이지만, 약국이 늦으면 퇴원이 묶인다.',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: '진료부 · 약제부 · 원무팀',
    options: [
      { value: 'SHOW_ONLY', label: '현행 — 보여 주기만(판정에 넣지 않음)', effect: '체크리스트에 "원내 조제 d/i"가 보이고, 퇴원 가능 판정은 바뀌지 않는다.', enact: null },
      { value: 'REQUIRE', label: '원내 조제 퇴원약이 모두 조제 완료여야 퇴원 가능', effect: '코드 변경 — readyToDischarge 에 조건 추가. 퇴원약이 없는 퇴원은 영향 없음.', enact: null },
    ],
    statusQuo: 'GET /inpatient/:id/discharge-readiness 가 dischargeMeds{source, ordered, internal, dispensed}를 싣고, readyToDischarge 는 요약 서명·정산만 본다.',
    verifyHow: [REF],
    afterDecision: 'REQUIRE 면 판정 조건 추가 개발.',
    owner: '진료부',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
];
