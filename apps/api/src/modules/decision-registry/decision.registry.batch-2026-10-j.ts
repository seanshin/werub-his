/**
 * 결정 등록부 배치 10-J(2026-10-20) — 환자 포털 공개 범위(포털 세련화 P3 · B2·B4·B6·B8).
 *
 * 출처: 기획 `docs/01-plan/features/patient-portal-refinement-2026-10.plan.md` §B(🔴 그 표는 정본이 아니다 — 이 키가 정본).
 * 2026-10-20 사용자 지시로 네 건 모두 선택을 정했고 그대로 구현했다 — 등록부 기록은 개발 시드(DEV-SEED) 형식이라
 * 실결정으로 다시 기록해야 결정으로 센다(판정표 "시드대로 구현됨" · 실결정이 다르면 되돌림).
 * 화면 정본 `packages/shared/src/portal-disclosure.ts`.
 */
import type { DecisionDef } from './decision.registry';

const PLAN = '`docs/01-plan/features/patient-portal-refinement-2026-10.plan.md` §B';

export const DECISION_BATCH_2026_10_J: DecisionDef[] = [
  {
    key: 'portal.visitSummaryScope',
    track: 'CLINICAL',
    title: '환자 포털의 진료 후 요약에 무엇까지 싣는가 (진단명·의사 소견)',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '🔴 실측(2026-10-20): 포털 진료 이력·모바일 앱이 서명된 진료기록의 **의사 소견 원문**(assessment·plan)을 그대로 보여 주고 있었다. ' +
      '진료 후 요약(B2)을 만들면서 환자에게 어디까지 보여 줄지를 정해야 한다 — 감별·배제 진단이나 소견 원문은 환자가 확정으로 읽는다. ' +
      '진료기록 전체는 의료법상 사본 발급 신청으로 받을 수 있다(포털 서류 신청).',
    legalReview: ['의료법 §21(기록 열람·사본 발급)', '원내 의무기록 공개 규정'],
    approvalPath: 'CODE_CHANGE',
    authority: '의무기록위원회(MRC) · 진료부',
    options: [
      { value: 'GENERAL', label: '일반 수준 — 진단명·처방·다음 예약·일반 안내', effect: '감별·배제 진단과 의사 소견 원문은 싣지 않는다. 전체 기록은 사본 발급으로.', enact: null },
      { value: 'WITH_CLINICIAN_NOTE', label: '의사 소견 원문까지', effect: '코드 변경 — 요약에 소견(assessment·plan) 원문을 싣는다(종전 진료 이력처럼).', enact: null },
      { value: 'NONE', label: '요약을 보이지 않는다', effect: '코드 변경 — 진료 이력은 날짜·진료과·의사만.', enact: null },
    ],
    drillDown: '/portal',
    statusQuo: '`GET portal/encounters/:id/summary` — 서명된 진료만 · 진단(감별·배제 제외)·처방·다음 예약·일반 안내 · 진료 이력 목록은 소견 원문을 싣지 않는다(2026-10-20).',
    verifyHow: ['apps/api `modules/portal/portal.service.ts getVisitSummary`', PLAN],
    afterDecision: '일반 수준 외를 고르면 요약·진료 이력 응답을 바꾼다.',
    owner: '의무기록팀 · 진료부',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'portal.patientReportedVitals',
    track: 'CLINICAL',
    title: '환자가 집에서 잰 혈압·혈당을 의료진 화면과 경보에 어떻게 쓰는가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '🔴 실측(2026-10-20): 포털 자가측정 입력은 의료진 측정과 같은 원장(ChronicObservation · 출처 SMBG)에 쌓이고, ' +
      '목표 미달이면 **담당의에게 경보가 바로 갔다**. 추이 중복 정리에서는 같은 분의 외래 측정보다 우선했고, 조절 판정·추적관리 목록도 구분 없이 셌다. ' +
      '측정 기기·방법을 모르는 값이 임상 경보·판정을 움직였다.',
    legalReview: ['원내 환자 입력 자료(PGHD) 활용 규정'],
    approvalPath: 'CODE_CHANGE',
    authority: '질향상·환자안전위원회(QPS) · 의무기록위원회(MRC)',
    options: [
      { value: 'REFERENCE_ONLY', label: '참고용으로 의료진에게 보인다 — 경보·판정에는 쓰지 않는다', effect: '의료진 차트에 "환자 입력·참고용"으로 구분 표시 · 담당의 경보·조절 판정·추적관리에서 뺀다.', enact: null },
      { value: 'HIDE_FROM_CLINICIANS', label: '의료진 화면에 보이지 않는다', effect: '코드 변경 — 환자 본인 추이에만 남긴다.', enact: null },
      { value: 'USE_IN_ALERTS', label: '의료진 측정과 같이 쓴다(경보 포함)', effect: '코드 변경 — 종전처럼 목표 미달 경보가 담당의에게 간다. 기기·방법 검증 절차가 필요하다.', enact: null },
    ],
    drillDown: '/portal',
    statusQuo: '`chronic.service` — 출처 SMBG 는 경보·조절 판정·추적관리·추세 판정에서 빠지고, 의료진 추이 패널은 "환자 입력·참고용"으로 표시한다(2026-10-20).',
    verifyHow: ['apps/api `modules/chronic/chronic.service.ts`', PLAN],
    afterDecision: '참고용 외를 고르면 경보·표시 경로를 바꾼다.',
    owner: '진료부 · 간호부',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'portal.costEstimate',
    track: 'BILLING',
    title: '환자 포털에 예약한 진료의 예상 진료비를 보여 주는가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '진료 전에는 검사·처방이 정해지지 않아 진료비를 확정할 수 없다. 보여 주면 환자가 확정 금액으로 읽을 수 있고, ' +
      '보여 주지 않으면 환자가 비용을 전혀 모른다. 🔴 운영 수가 마스터의 재진 진찰료 단가가 0원·초진 진찰료가 미등재라 계산값이 없는 경우가 많다.',
    legalReview: ['비급여 진료비용 고지 의무(의료법 §45)', '원내 진료비 안내 규정'],
    approvalPath: 'CODE_CHANGE',
    authority: '운영위원회(OPS) · 원무팀장',
    options: [
      { value: 'SHOW_AS_ESTIMATE', label: '예측 자료라고 밝혀서 보인다', effect: '진찰료 본인부담(수납 계산 정본)과 최근 같은 진료과 실제 본인부담 범위 · "예측 자료이며 실제와 다를 수 있음" 고정 표기.', enact: null },
      { value: 'HIDE', label: '보이지 않는다', effect: '코드 변경 — 예약 카드에서 예상 진료비를 뺀다.', enact: null },
    ],
    drillDown: '/portal',
    statusQuo: '`GET portal/appointments/:id/cost-estimate` — 진찰료는 실청구와 같은 함수(진찰료 코드·자격 요율·의료급여 정액) · 단가 0원·미등재는 모름 · 최근 같은 과 범위는 표본 수 병기(2026-10-20).',
    verifyHow: ['apps/api `modules/billing/billing.service.ts estimateVisitCopay`', PLAN],
    afterDecision: '보이지 않기를 고르면 화면·EP 를 닫는다.',
    owner: '원무팀 · 운영위원회',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'portal.labResultRelease',
    track: 'CLINICAL',
    title: '검사 결과를 환자 포털에 언제 공개하는가 (수치·판정)',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '🔴 실측(2026-10-20): 포털은 검사가 끝나면(COMPLETED) 수치와 판정(높음·낮음)을 바로 보였고, 기초검사 결론도 판독 검토 전에 보였다. ' +
      '의사가 결과를 확인하기 전에 환자가 "이상"을 먼저 읽는다. 운영 데이터에서는 끝난 검사 256건 중 의사 결과 확인이 0건이다. ' +
      '위급값은 별도 폐루프(담당의 확인 전 수치 가림 — `policy.criticalValue.patientNotify`)가 계속 적용된다.',
    legalReview: ['의료법 §21(기록 열람)', '원내 검사 결과 공개 규정'],
    approvalPath: 'CODE_CHANGE',
    authority: '의무기록위원회(MRC) · 진단검사의학과 · 질향상·환자안전위원회(QPS)',
    options: [
      { value: 'VALUES_NOW_JUDGMENT_AFTER_REVIEW', label: '수치는 바로 · 판정은 의료진 확인 뒤', effect: '검사 수치는 끝나면 보이고, 높음·낮음·결론은 의사가 결과를 확인한 뒤에 보인다(확인 시각 표시).', enact: null },
      { value: 'ALL_AFTER_REVIEW', label: '전부 의료진 확인 뒤', effect: '코드 변경 — 확인 전에는 "검사 완료 · 의료진 확인 중"만.', enact: null },
      { value: 'ALL_NOW', label: '전부 바로', effect: '코드 변경 — 종전처럼 판정까지 바로 보인다.', enact: null },
    ],
    drillDown: '/portal',
    statusQuo: '`portal.service getLabResults·getDiagnosticTests·getLabTrends` — 판정은 오더 결과 확인(Order.acknowledgedAt)·기초검사 판독 승인(APPROVED) 뒤에만 · 건강검진은 의사 종합판정 서명 뒤에만(종전 그대로)(2026-10-20).',
    verifyHow: ['apps/api `modules/portal/portal.service.ts getLabResults`', PLAN],
    afterDecision: '다른 선택이면 공개 경로를 바꾼다.',
    owner: '진단검사의학과 · 의무기록팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
];
