/**
 * 결정 등록부 배치 L (2026-09-30) — **처방 중단(DISCONTINUED)**.
 *
 * 코드는 취소(무효·발효 전)와 중단(그 시각 이후 멈춤)을 가르고, 발효된 처방의 취소를 거부한다.
 * 청구 수량과 사망 시 처리처럼 **원무·진료 규정이 정할 것**은 코드가 정하지 않는다. `statusQuo` 는 배포한 코드를 다시 읽고 적었다.
 *
 * 🔴 등재 ≠ 결정. 선택지와 결과만 적고 권고하지 않는다. 모든 선택지의 `enact` 는 `null`(CODE_CHANGE).
 */
import type { DecisionDef } from './decision.registry';

const REF = '`apps/api/src/modules/prescription/prescription.service.ts` discontinue() · `docs/01-plan/features/order-discontinue.plan.md`';

export const DECISION_BATCH_2026_09_L: DecisionDef[] = [
  {
    key: 'order.discontinue.billingQuantity',
    track: 'BILLING',
    title: '중단된 처방을 청구할 때 수량을 무엇으로 셀 것인가(처방량 전부 / 실제 조제·투약분)',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '중단은 "그 시각 이후 멈춤"이라 이미 조제·투약된 분량은 청구 대상이다. 그런데 청구 라인은 처방 수량(quantity)을 그대로 쓴다. ' +
      '진료 서명 때 이미 청구된 처방은 그대로이고, 중단 뒤 재청구(정정 재서명)에서는 중단 처방이 빠진다(ACTIVE 만 담는다). ' +
      '처방량 전부를 청구하면 과다청구, 빼면 실제 투약분 누락이다 — 어느 쪽인지는 원무·심사 규정이다.',
    legalReview: ['요양급여 청구 시 중단 처방의 산정 기준 — 원무·심사 검토'],
    approvalPath: 'CODE_CHANGE',
    authority: '원무 · 보험심사 · 약제부',
    options: [
      { value: 'KEEP_CURRENT', label: '현행 — 서명 때 청구된 것은 그대로, 중단 뒤 재청구에서는 제외', effect: '서명 전에 중단되면 그 처방은 청구되지 않는다(실제 투약분이 있으면 누락). 서명 후 중단은 처방량 전부가 청구된 상태로 남는다.', enact: null },
      { value: 'DISPENSED_OR_ADMINISTERED', label: '실제 조제·투약분만 청구', effect: '조제 기록(Dispensing)·투약 기록(MAR ADMINISTERED)으로 수량을 다시 센다 — 코드 변경 필요(재청구 경로·정정 청구 연결).', enact: null },
      { value: 'FULL_QUANTITY', label: '처방량 전부 청구(중단 무관)', effect: '재청구에도 중단 처방을 처방량대로 담는다 — 투약하지 않은 분량까지 청구될 수 있다(환자 부담).', enact: null },
    ],
    statusQuo:
      '청구 생성·재청구·수가 산정은 ACTIVE 처방만 담는다(billing.service recalcFromEncounter·createFromEncounter·calculateBilling · billing-advanced). ' +
      '미청구 채권 집계는 CANCELLED 만 빼므로 중단 처방을 처방량 전부로 센다. 이미 청구된 라인은 중단해도 바뀌지 않는다(소급하지 않는다).',
    verifyHow: [REF, '`apps/api/src/modules/billing/billing.service.ts` 의 `where: { status: \'ACTIVE\' }`'],
    afterDecision: 'KEEP_CURRENT 외에는 청구 경로 개발(수량 재계산·정정 청구 연결)이 필요하다.',
    owner: '원무팀',
    dueBy: 'BEFORE_GO_LIVE',
    goLive: 'REQUIRED_BEFORE',
  },
  {
    key: 'order.discontinue.onDeath',
    track: 'CLINICAL',
    title: '사망 처리 때 그 환자의 활성 처방을 자동으로 중단할 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '사망 처리는 진행 중 오더만 취소하고 처방은 활성으로 남긴다. 자동으로 끊는 방향은 사람 판단이다(판정 규칙 — 자동 중단이 오작동하면 살아 있는 환자의 약이 멈춘다).',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: '진료부 · 약제부',
    options: [
      { value: 'KEEP_MANUAL', label: '현행 — 처방은 사람이 중단', effect: '사망 처리 뒤에도 처방 원장에는 활성으로 남는다(오더는 취소됨).', enact: null },
      { value: 'AUTO_DISCONTINUE', label: '사망 처리 시 활성 처방 일괄 중단(사유 "사망")', effect: '코드 변경 — 사망 처리 트랜잭션에서 discontinue 를 부르고 사망 취소 시 되돌리는 절차가 필요하다.', enact: null },
    ],
    statusQuo: '`patient.service` 사망 처리는 진행 중 오더(ORDERED 등)만 취소한다. 처방 상태는 바꾸지 않는다.',
    verifyHow: ['`apps/api/src/modules/patient/patient.service.ts` 사망 처리'],
    afterDecision: 'AUTO_DISCONTINUE 면 사망 처리·사망 취소 경로 개발.',
    owner: '진료부',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
];
