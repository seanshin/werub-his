/**
 * 결정 등록부 배치 M (2026-09-30) — **지속 처방 갱신·만료**.
 *
 * 코드는 갱신 대기 목록(곧 만료·만료됨·기간 없음)과 갱신(새 처방으로 잇고 원처방 중단)을 제공한다.
 * 기간이 끝난 처방을 자동으로 끊을지, 기간 없는 처방을 며칠마다 재검토할지는 **원내 규정**이라 코드가 정하지 않는다.
 * `statusQuo` 는 배포한 코드를 다시 읽고 적었다. 🔴 등재 ≠ 결정 — 선택지와 결과만, 권고 없음.
 */
import type { DecisionDef } from './decision.registry';

const REF = '`apps/api/src/modules/prescription/prescription.service.ts` renewalsDue()·renew() · `docs/01-plan/features/order-renewal.plan.md`';

export const DECISION_BATCH_2026_09_M: DecisionDef[] = [
  {
    key: 'order.renewal.autoExpire',
    track: 'CLINICAL',
    title: '투여 기간이 끝난 처방을 시스템이 자동으로 중단(만료)할 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '기간이 끝난 처방은 투여기간 판정으로 "종료"라 표시되지만 상태는 활성으로 남는다. 자동으로 끊으면 갱신을 깜빡한 사이 필요한 약이 멈출 수 있고, ' +
      '끊지 않으면 의사가 갱신 대기 목록에서 직접 갱신·중단해야 한다. 자동으로 끊는 방향은 사람 판단이다.',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: '진료부 · 약제부 · 간호부',
    options: [
      { value: 'MANUAL', label: '현행 — 자동 중단 없음(갱신 대기 목록에서 사람이 갱신·중단)', effect: '만료된 처방은 목록 "만료됨"에 남고, 투여기간 판정은 종료로 보인다. 상태는 활성이다.', enact: null },
      { value: 'AUTO_AFTER_GRACE', label: '종료 후 유예 시간이 지나면 자동 중단(사유 "기간 만료")', effect: '코드 변경 — 크론이 유예 시간 뒤 중단(discontinue)을 부른다. 유예 시간 값도 정해야 한다.', enact: null },
    ],
    statusQuo: '자동 중단 없음. GET /prescriptions/renewals/due 가 만료됨(EXPIRED)으로 보여 주고 의사가 갱신(POST /renew) 또는 중단(POST /discontinue)한다.',
    verifyHow: [REF],
    afterDecision: 'AUTO_AFTER_GRACE 면 크론·유예 설정 개발.',
    owner: '진료부',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'order.renewal.noEndReviewDays',
    track: 'CLINICAL',
    title: '기간 없는 처방(PRN·지속 지시)을 며칠마다 재검토하게 할 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '투여일수 없이 낸 처방(필요 시 투여 PRN 등)은 끝이 없다. 재검토 기한을 두면 그 기한이 지난 것만 갱신 대기 목록에 오르고, ' +
      '두지 않으면 기간 없는 처방이 전부 목록에 오른다. 기한 값은 원내 규정이다(마약성 진통제 PRN 등은 더 짧을 수 있다).',
    legalReview: [],
    // 2026-10-10 설정만 바꾸는 결정인데 경로가 CODE_CHANGE·선택지 enact null 이라 고르면 아무것도 바뀌지 않았다(prescription.service 는 이 설정을 읽는다)
    approvalPath: 'AUTHORIZED_ROLE',
    authority: '진료부 · 약제부',
    options: [
      { value: 'UNSET', label: '현행 — 기한 미설정(기간 없는 처방 전부를 목록에 올림)', effect: '목록이 길 수 있다. 화면이 "기한 미설정"이라 밝힌다.', enact: null },
      { value: 'DAYS_3', label: '3일', effect: '설정 order.renewal.noEndReviewDays = 3', enact: { key: 'order.renewal.noEndReviewDays', newValue: 3 } },
      { value: 'DAYS_7', label: '7일', effect: '설정 order.renewal.noEndReviewDays = 7', enact: { key: 'order.renewal.noEndReviewDays', newValue: 7 } },
    ],
    configKey: 'order.renewal.noEndReviewDays',
    enactKind: 'CONFIG_CHANGE',
    statusQuo: '설정 order.renewal.noEndReviewDays 미설정(null) — 기간 없는 활성 약 처방 전부가 "기간 없음"으로 목록에 오른다.',
    verifyHow: [REF, '설정 `order.renewal.noEndReviewDays`'],
    afterDecision: '값을 정하면 설정만 바꾼다(코드 변경 불필요).',
    owner: '진료부',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
];
