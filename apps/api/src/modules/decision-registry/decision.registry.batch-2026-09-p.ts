/**
 * 결정 등록부 배치 P (2026-09-30) — **원외처방전 전자 전송**.
 *
 * 코드는 처방전을 발급 원장에 남기고(교부번호·진위 확인 QR) 종이로 교부한다. 약국으로 **전송하지 않는다** —
 * 국내에는 병원→약국 공용 전송망이 없고, 제3자 전달 서비스·팩스 등을 쓸지는 법률 검토가 필요한 허가권자 결정이다.
 * `statusQuo` 는 배포한 코드를 다시 읽고 적었다. 🔴 등재 ≠ 결정 — 선택지와 결과만, 권고 없음. 조문·수수료는 적지 않는다(확인 필요).
 */
import type { DecisionDef } from './decision.registry';

const REF = '`apps/api/src/modules/prescription-issue/` (발급·external-rx-transmission.ts) · `apps/api/src/modules/document/document.service.ts` verify() · `docs/01-plan/features/external-prescription-issue.plan.md`';

export const DECISION_BATCH_2026_09_P: DecisionDef[] = [
  {
    key: 'rx.external.transmission',
    track: 'CLINICAL',
    title: '원외처방전을 약국으로 전자 전송할 것인가 — 한다면 어떤 경로로',
    layer: 'LICENSE_HOLDER',
    why:
      '지금 원외처방전은 종이로 교부되고 약국은 인쇄물의 발급번호·QR 로 진위를 확인한다. 전자 전송을 하려면 전달 서비스(제3자)·팩스 등 경로를 골라야 하고, ' +
      '환자가 약국을 고를 권리와 특정 약국 유도 금지, 처방 내용(민감정보)의 제3자 제공이 걸린다. 병원 안에서 정할 수 없는 법적 판단이 먼저다.',
    legalReview: [
      '의료법·시행규칙상 처방전 교부 및 전자처방전 요건(조문 확인 필요)',
      '특정 약국으로 환자를 유도하는 행위의 금지(의료법·약사법 — 전달 경로 설계가 여기에 걸리는지)',
      '개인정보 보호법상 민감정보 제3자 제공·위탁(전달 서비스 사업자와의 계약)',
    ],
    approvalPath: 'AUTHORIZED_ROLE',
    authority: '개설자·원장 · 법무 · 약제부',
    options: [
      { value: 'PAPER_ONLY', label: '현행 — 종이 교부만(발급번호·진위 확인 QR)', effect: '전송 없음. 약국은 종이와 공개 진위 확인으로 받는다. 관제(/admin/outbound-channels)에 채널이 "미구현"으로 보인다.', enact: null },
      { value: 'THIRD_PARTY_SERVICE', label: '전자처방전 전달 서비스(제3자)와 연동', effect: '코드 변경 — 전송 함수·환자 동의·약국 선택(환자 지정)·전송 결과 원장 개발. 사업자 계약·법률 검토 선행.', enact: null },
      { value: 'PATIENT_APP', label: '환자 앱으로만 전달(환자가 약국에 제시)', effect: '코드 변경 — 포털/앱에 처방전·QR 제공. 병원→약국 전송은 없다.', enact: null },
    ],
    statusQuo: '전자 전송 없음. POST /encounters/:id/prescription-issue 가 발급 원장(issued_documents, 유형 PRESCRIPTION)에 번호를 남기고 응답에 transmission{implemented:false, transmitted:false}를 싣는다. 인쇄물은 "종이 처방전 — 약국으로 전자 전송되지 않았습니다"라고 적는다.',
    verifyHow: [REF, '관제 /admin/outbound-channels 의 EPRESCRIPTION 채널'],
    afterDecision: 'PAPER_ONLY 외를 고르면 채널 구현·동의·전송 결과 원장 개발(대외 발신 3조건: 구현 + 설정 기본 OFF + 승인).',
    owner: '법무팀 · 약제부',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'rx.external.verifyDisclosure',
    track: 'CLINICAL',
    title: '공개 진위 확인 화면이 처방전 내용(약품·수량)까지 보여 줄 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '지금 공개 진위 확인은 발급번호·유형·발급 시각·유효 여부·기관명만 보여 준다(환자 정보 없음). 그래서 약국은 "진짜 번호"인지는 알지만 ' +
      '종이의 약품·수량이 발급 당시와 같은지는 확인할 수 없다(번호를 베낀 위조). 약품·수량을 보여 주면 위조를 막지만, 번호만 알면 누구나 처방 내용을 본다.',
    legalReview: ['공개 화면에 처방 내용(환자 식별 정보 없이)을 싣는 것의 개인정보 판단'],
    approvalPath: 'CODE_CHANGE',
    authority: '약제부 · 정보보호 · 진료부',
    options: [
      { value: 'ISSUE_ONLY', label: '현행 — 발급 정보·유효 여부만', effect: '처방 내용은 보이지 않는다. 내용 위조는 확인할 수 없다.', enact: null },
      { value: 'ITEMS_NO_PATIENT', label: '약품명·용량·수량까지(환자 식별 정보 없이)', effect: '코드 변경 — 공개 확인 응답에 발급 스냅샷의 약품 목록을 싣는다.', enact: null },
    ],
    statusQuo: 'GET /documents/verify/:issueNo 가 issueNo·documentType·issuedAt·status·hospital(설정 hospital.name, 없으면 null)만 답한다. 내용이 바뀌어 재발급되면 이전 번호는 SUPERSEDED(무효)로 답한다.',
    verifyHow: [REF],
    afterDecision: 'ITEMS_NO_PATIENT 면 verify 응답·화면 개발.',
    owner: '약제부',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
];
