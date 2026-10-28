/**
 * 결정 등록부 배치 R (2026-09-30) — **병동 간 전동 요청 → 수락**.
 * 코드는 요청·수락·거절·취소와 수락 순간의 병상 이동을 제공한다. 병동 간 즉시 이동을 막을지, 요청 때 병상을 잡을지는 원내 운영 규정이다.
 * 🔴 등재 ≠ 결정 — 선택지와 결과만, 권고 없음.
 */
import type { DecisionDef } from './decision.registry';

const REF = '`apps/api/src/modules/bed-transfer/bed-transfer.service.ts` · `docs/01-plan/features/bed-transfer-request.plan.md`';

export const DECISION_BATCH_2026_09_R: DecisionDef[] = [
  {
    key: 'bedTransfer.requireAcceptance',
    track: 'CLINICAL',
    title: '병동 간 이동은 반드시 받는 병동의 수락을 거치게 할 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '전동 요청→수락 흐름이 생겼지만 종전의 즉시 이동(병상 이동 버튼)도 남아 있어, 보내는 병동이 받는 병동 모르게 다른 병동 병상으로 옮길 수 있다. ' +
      '막으면 받는 병동 확인이 보장되지만 야간·응급에 수락자가 없으면 이동이 묶인다.',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: '간호부 · 원무팀(병상 관리)',
    options: [
      { value: 'OPTIONAL', label: '현행 — 요청·수락은 선택(즉시 이동도 가능)', effect: '병동 간 즉시 이동이 계속 가능하다. 이력에는 사유 TRANSFER(즉시)·TRANSFER_REQUEST(수락)로 갈린다.', enact: null },
      { value: 'REQUIRED_CROSS_WARD', label: '병동 간 이동은 요청·수락만(같은 병동 안은 즉시)', effect: '코드 변경 — 즉시 이동 EP 가 다른 병동 병상을 거부(관리자 예외 여부도 정한다).', enact: null },
    ],
    statusQuo: '즉시 이동(PATCH inpatient/:id/transfer · admissions/:id/transfer-bed)과 요청·수락(POST bed-transfers)이 모두 열려 있다.',
    verifyHow: [REF],
    afterDecision: 'REQUIRED_CROSS_WARD 면 즉시 이동 EP 에 병동 검사 추가 개발.',
    owner: '간호부',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'bedTransfer.reserveOnRequest',
    track: 'CLINICAL',
    title: '전동을 요청할 때 원하는 병상을 예약(RESERVED)해 둘 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '지금 요청은 병상을 잡지 않는다 — 수락 전에 다른 입원이 그 병상을 가져갈 수 있다. 예약하면 자리가 보장되지만 수락·거절이 늦으면 병상이 묶이고, ' +
      '예약을 풀 규칙(거절·취소·시간 초과)도 정해야 한다.',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: '간호부 · 원무팀(병상 관리)',
    options: [
      { value: 'NO_RESERVE', label: '현행 — 잡지 않는다(받는 병동이 수락할 때 비어 있는 병상을 고른다)', effect: '원하는 병상은 참고일 뿐이다.', enact: null },
      { value: 'RESERVE', label: '원하는 병상이 있으면 RESERVED 로 잡는다(거절·취소 때 푼다)', effect: '코드 변경 — 요청·거절·취소·입원 종료에 병상 상태 전이 추가 · 수락은 RESERVED 병상도 잡게.', enact: null },
    ],
    statusQuo: '요청은 bed_transfer_requests 에만 남고 병상 상태는 바뀌지 않는다. 수락은 AVAILABLE 병상만 잡는다.',
    verifyHow: [REF],
    afterDecision: 'RESERVE 면 상태 전이 개발.',
    owner: '간호부',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
];
