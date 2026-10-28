/**
 * 결정 등록부 배치 O (2026-09-30) — **환자 교육 기록**.
 *
 * 코드는 교육 기록 원장(누가·누구에게·무엇을·어떻게·이해도)과 다른 기록에 적힌 교육을 한 화면에 모은다.
 * 이해도 평가를 필수로 할지, 교육 기록을 퇴원 가능 조건에 넣을지는 **원내 규정**(인증 기준 해석 포함)이라 코드가 정하지 않는다.
 * `statusQuo` 는 배포한 코드를 다시 읽고 적었다. 🔴 등재 ≠ 결정 — 선택지와 결과만, 권고 없음.
 */
import type { DecisionDef } from './decision.registry';

const REF = '`apps/api/src/modules/patient-education/patient-education.service.ts` · `apps/api/src/modules/inpatient/inpatient.service.ts` getDischargeReadiness() · `docs/01-plan/features/patient-education-record.plan.md`';

export const DECISION_BATCH_2026_09_O: DecisionDef[] = [
  {
    key: 'education.understandingRequired',
    track: 'CLINICAL',
    title: '환자 교육 기록에 이해도 평가를 필수로 할 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '의료기관 인증은 교육 후 이해 정도 확인을 요구한다고 알려져 있으나, 필수로 강제하면 평가하지 않은 교육에도 아무 값이나 골라 통과시키는 거짓 기록이 생길 수 있다. ' +
      '선택으로 두면 "이해도 미기록"이 그대로 드러난다. 인증 기준 해석과 원내 교육 절차에 달린 일이다.',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: '간호부 · 진료부 · QI(인증)',
    options: [
      { value: 'OPTIONAL', label: '현행 — 선택(평가한 경우에만 기록 · 비우면 "이해도 미기록" 표시)', effect: '미기록 건수가 그대로 보인다. 거짓 "이해함"은 생기지 않는다.', enact: null },
      { value: 'REQUIRED_WITH_NOT_ASSESSED', label: '필수 — 단, "평가 안 함" 선택지를 함께 둔다', effect: '코드 변경 — 어휘에 NOT_ASSESSED 추가·저장 시 필수 검사. 모든 기록에 이해도 칸이 채워진다.', enact: null },
    ],
    statusQuo: '이해도(understanding)는 선택 입력 — 보내지 않으면 null 로 저장되고 화면은 "이해도 미기록"이라 말한다.',
    verifyHow: [REF],
    afterDecision: 'REQUIRED_WITH_NOT_ASSESSED 면 어휘·DTO·화면 변경 개발.',
    owner: '간호부',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'discharge.educationForReady',
    track: 'CLINICAL',
    title: '환자 교육 기록을 "퇴원 가능" 판정 조건에 넣을 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '퇴원 준비 현황은 이 입원의 교육 기록 건수와 출처(교육 기록 / 퇴원요약 글자뿐)를 보여 주지만, "퇴원 가능"은 퇴원요약 서명과 정산만 본다. ' +
      '조건에 넣으면 교육 누락을 줄이지만 교육 기록이 늦으면 퇴원이 묶인다.',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: '간호부 · 진료부 · 원무팀',
    options: [
      { value: 'SHOW_ONLY', label: '현행 — 보여 주기만(판정에 넣지 않음)', effect: '체크리스트에 "환자 교육 기록 n건" 또는 "퇴원요약 글자뿐"이 보인다.', enact: null },
      { value: 'REQUIRE_RECORD', label: '이 입원의 유효한 교육 기록이 1건 이상이어야 퇴원 가능', effect: '코드 변경 — readyToDischarge 조건 추가. 퇴원요약 글자만으로는 충족되지 않는다.', enact: null },
    ],
    statusQuo: 'GET /inpatient/:id/discharge-readiness 가 education{records, summaryText, source}를 싣고, readyToDischarge 는 요약 서명·정산만 본다.',
    verifyHow: [REF],
    afterDecision: 'REQUIRE_RECORD 면 판정 조건 추가 개발.',
    owner: '간호부',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
];
