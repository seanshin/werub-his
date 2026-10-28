/**
 * 결정 등록부 배치 10-I(2026-10-14) — 수납·청구 결함 발굴의 사람 결정(P3-3 감면 권한 · P5-1 미등재 단가 라인 · P1-5/P5 선수금 환불).
 *
 * 출처: 보고서 `docs/04-report/defect-hunt-2026-10-14-billing/README.md` P3-3(🔴 그 표는 정본이 아니다 — 이 키가 정본).
 * 감면액을 누가·어디까지·무엇을 근거로 줄 수 있는지는 원내 정책이다 — 코드가 정하지 않는다. 시스템은 권고하지 않는다.
 */
import type { DecisionDef } from './decision.registry';

const REPORT = '`docs/04-report/defect-hunt-2026-10-14-billing/README.md` P3-3';

export const DECISION_BATCH_2026_10_I: DecisionDef[] = [
  {
    key: 'billing.discountAuthorization',
    track: 'BILLING',
    title: '수납 감면액을 누가·어디까지 줄 수 있는가 (지금은 수납 권한자가 금액을 직접 적는다)',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '🔴 실측: 수납(`POST billings/:id/pay`)은 감면액을 화면 값 그대로 받는다 — 0 이상이면 통과하고, 사유는 고르지 않아도 되며, ' +
      '설정된 감면율·환자 자격과 대조하지 않는다. 수납 권한(원무·간호사·관리자)이면 전액 감면(0원 완납)도 된다. 남는 것은 감사 로그뿐이다. ' +
      '감면은 병원 수입을 줄이는 결정이라 누가·얼마까지·무슨 근거로 할 수 있는지가 원내 규정이어야 한다.',
    legalReview: ['원내 진료비 감면 규정(직원·경로·사회사업 감면 기준)', '의료법상 본인부담 할인·면제의 환자 유인 금지 조항(원문 확인 필요)'],
    approvalPath: 'CODE_CHANGE',
    authority: '운영위원회(OPS) · 원무팀장 · 재무·회계 책임자',
    options: [
      { value: 'KEEP_CASHIER_ENTRY', label: '현행 유지 — 수납 권한자가 직접 적고 감사 로그로 본다', effect: '업무 속도를 지킨다. 대신 감면 내역을 정기 점검하는 사람이 있어야 한다(누가 얼마를 감면했는지는 감사 로그·청구에 남는다).', enact: null },
      { value: 'REASON_AND_CAP', label: '사유 필수 + 설정 감면율 상한', effect: '코드 변경 — 감면 사유를 고르지 않으면 거부 · 사유별 감면율 설정을 넘는 금액은 거부. 상한을 넘는 특례는 아래 결재로.', enact: null },
      { value: 'APPROVAL_ABOVE_LIMIT', label: '한도 넘는 감면은 결재', effect: '코드 변경 — 정한 금액·비율을 넘으면 전자결재 승인 뒤에만 감면이 적용된다(그동안 수납 보류). 결재선은 별도로 정한다.', enact: null },
    ],
    statusQuo: '`PayBillingDto.discountAmount` 는 0 이상만 검사 · 사유 선택 · 수납 권한 = NURSE·ADMIN·RECEPTIONIST · 감면은 처음 적용한 값이 유지된다(P1-3).',
    verifyHow: ['apps/api `modules/billing/dto/pay-billing.dto.ts` · `billing.service.ts pay()`', REPORT],
    afterDecision: '현행 외를 고르면 감면 검증(사유·상한)·결재 연결 개발.',
    owner: '원무팀 · 운영위원회',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'billing.unpricedLinePolicy',
    track: 'BILLING',
    title: '약가·수가가 등록되지 않은 처방을 청구에서 어떻게 할 것인가 (지금은 0원 급여 라인으로 들어간다)',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '🔴 실측: 단가가 없는 약·행위(운영 약가 미등재 2,041 — 주석 기준)는 실청구에 **0원 급여** 라인으로 들어간다. ' +
      '환자·보험자 어느 쪽에도 청구되지 않고, 영수증·EDI 에는 "0원 급여"로 남는다. 막으면 수납이 멈추고, 빼면 진료 사실이 청구에서 사라진다. ' +
      '정하기 전에는 현행대로 두되 경고를 남기고 수납 상세가 "단가 0원 항목"을 말한다(2026-10-14 P5-1).',
    legalReview: ['요양급여비용 청구 — 미등재 약제·행위의 청구 방법(원문 확인 필요)'],
    approvalPath: 'CODE_CHANGE',
    authority: '운영위원회(OPS) · 약사위원회(약가) · 원무팀장',
    options: [
      { value: 'KEEP_ZERO_LINE_WARN', label: '현행 — 0원 라인 + 경고·화면 표시', effect: '수납은 멈추지 않는다. 수가 마스터 보정은 사람이 경고를 보고 한다.', enact: null },
      { value: 'HOLD_BILLING', label: '청구 보류', effect: '코드 변경 — 미등재 라인이 있으면 청구를 보류(DEFERRED)로 만들고 마스터 보정 뒤 재산정한다. 그동안 수납이 늦어진다.', enact: null },
      { value: 'EXCLUDE_AND_LIST', label: '라인 제외 + 미청구 목록', effect: '코드 변경 — 미등재 라인을 청구에서 빼고 "미청구 처방" 목록에 남긴다(마스터 보정 뒤 추가 청구).', enact: null },
    ],
    statusQuo: '`buildPrescriptionLineItem` 이 `unitPrice ?? 0` — 0원 급여 라인 · 청구 생성 응답 `unpricedLines`·경고 로그 · 수납 상세 "단가 0원 항목" 표시.',
    verifyHow: ['apps/api `modules/billing/billing.service.ts buildPrescriptionLineItem`', REPORT.replace('P3-3', 'P5-1')],
    afterDecision: '현행 외를 고르면 보류·제외 경로와 재산정 개발.',
    owner: '원무팀 · 약제팀 · 운영위원회',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'billing.depositRefundRestore',
    track: 'BILLING',
    title: '선수금(예치금)으로 낸 수납을 환불할 때 그 몫을 예치금으로 되돌릴 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '🔴 실측: 수납 환불은 선수금으로 낸 몫도 "환자에게 돌려준 돈"(수납 원장 환불 줄)으로 기록하고 예치금 잔액은 되살리지 않는다. ' +
      '창구가 그 몫을 현금으로 돌려주면 맞고, 예치금으로 돌려주기로 했다면 잔액이 사라진 채 남는다. 어느 쪽인지는 원내 규정이다. ' +
      '정하기 전에는 자동으로 되살리지 않고, 환불 응답이 선수금 몫(`depositPortion`)을 밝힌다(2026-10-14).',
    legalReview: ['선수금(예치금) 반환 규정 — 원내 회계 규정'],
    approvalPath: 'CODE_CHANGE',
    authority: '운영위원회(OPS) · 원무팀장 · 재무·회계 책임자',
    options: [
      { value: 'REFUND_TO_PATIENT', label: '현행 — 환자에게 돌려준 돈으로(예치금 되살리지 않음)', effect: '창구가 선수금 몫을 현금 등으로 돌려준다. 응답의 선수금 몫을 보고 처리한다.', enact: null },
      { value: 'RESTORE_DEPOSIT', label: '선수금 몫은 예치금으로 되살린다', effect: '코드 변경 — 환불 중 선수금 몫은 예치금 잔액에 되돌리고 현금 환불 줄에서 뺀다(예치금 원장 행 추가).', enact: null },
      { value: 'PER_CASE', label: '건마다 창구가 고른다', effect: '코드 변경 — 환불 창에 "예치금으로 / 현금으로" 선택을 둔다.', enact: null },
    ],
    statusQuo: '`refund()` 가 선수금 몫을 응답 `depositPortion` 으로만 밝힌다 · 예치금 잔액은 그대로 · 수납 원장 환불 줄에 전액.',
    verifyHow: ['apps/api `modules/billing/billing.service.ts refund()`', REPORT.replace('P3-3', 'P1-5·P5')],
    afterDecision: '현행 외를 고르면 예치금 복원 경로(·환불 창 선택) 개발.',
    owner: '원무팀 · 재무팀 · 운영위원회',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
];
