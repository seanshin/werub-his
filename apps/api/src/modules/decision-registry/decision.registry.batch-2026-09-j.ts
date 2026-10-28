/**
 * 결정 등록부 배치 J (2026-09-29) — **응급 도착 상황 기록 축**(기획 `docs/01-plan/features/er-arrival-record.plan.md` §3).
 *
 * 도착 상황 기록(첫 기록 + 추가 기록)은 배포됐지만(`ff6f71698`), 그 기록이 다루는 **소지품 보관 절차**와
 * **제3자(동행인) 개인정보 보존**, **기록을 필수로 할지**는 원내 규정이라 코드가 정할 수 없다.
 * `statusQuo` 는 배포된 코드를 다시 읽고 적었다.
 *
 * 🔴 등재 ≠ 결정. 선택지와 결과만 적고 권고·기본 선택은 하지 않는다. 모든 선택지의 `enact` 는 `null`(CODE_CHANGE).
 * 🔴 법령은 "적용 여부 검토"로만 적는다 — 조문·기간은 조사하지 않았으므로 적지 않는다(판정 규칙 §7).
 */
import type { DecisionDef } from './decision.registry';

const PLAN = '`docs/01-plan/features/er-arrival-record.plan.md` §3';

export const DECISION_BATCH_2026_09_J: DecisionDef[] = [
  {
    key: 'er.arrival.belongingsCustody',
    track: 'CLINICAL',
    title: '신원 미상 환자의 소지품을 병원이 보관할 때 어떤 절차로 남길 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '응급 미확인 환자는 지갑·휴대전화처럼 신원을 밝힐 단서를 지니고 오는 경우가 많고, 분실·도난 분쟁이 생기면 병원이 보관 사실을 증명해야 한다. ' +
      '지금 시스템은 도착 기록에 "품목 + 보관(환자 소지·병원 보관·경찰 인계·보호자 인계·모름)"을 적을 수 있을 뿐, ' +
      '보관 장소·인수인계자 서명·반환 기록을 남기는 대장은 없다.',
    legalReview: ['유실물·습득물 처리 절차 적용 여부 — 원내 법무 검토', '보관 중 분실 시 병원 책임 범위 — 원내 규정'],
    approvalPath: 'CODE_CHANGE',
    authority: '응급의료센터장 · 간호부 · 원무 · 법무',
    options: [
      { value: 'RECORD_ONLY', label: '도착 기록의 품목·보관 칸만 쓴다(현행)', effect: '보관했다는 사실은 남지만 보관 장소·인계자 서명·반환은 종이나 기억에 맡긴다.', enact: null },
      { value: 'CUSTODY_LEDGER', label: '소지품 보관 대장을 만든다(보관 장소·인계자 서명·반환 기록)', effect: '품목마다 보관·인계·반환 이력이 시스템에 남는다. 대장 화면·서명 흐름 개발이 필요하다.', enact: null },
      { value: 'PAPER_FORM', label: '원내 종이 서식으로 운용하고 시스템은 서식 번호만 적는다', effect: '개발 없이 바로 운용한다. 서식과 시스템 기록을 사람이 맞춰야 한다.', enact: null },
    ],
    statusQuo:
      '`EmergencyArrivalNote.belongings`(JSON `[{ item, custody }]`) 에 품목과 보관 상태만 적는다. 보관 장소·인수인계·반환을 남기는 모델·화면은 없다. ' +
      '추가 기록으로 "보호자 인계"를 덧붙일 수는 있지만 서명은 없다.',
    verifyHow: ['`apps/api/prisma/schema.prisma` 의 `EmergencyArrivalNote`(belongings 칸)를 읽는다', PLAN],
    afterDecision: 'RECORD_ONLY 외에는 대장 모델·화면 또는 서식 번호 칸 개발이 남는다.',
    owner: '응급의료센터 · 간호부',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'er.arrival.thirdPartyRetention',
    track: 'PRIVACY',
    title: '도착 기록에 적은 동행인·신고자의 이름·연락처를 얼마나, 어떻게 보관할 것인가',
    // 🔴 개인정보 보존은 원내 직원이 정할 수 없다 — 위치 보존기간(location.retentionDays)과 같은 층·개시 전 필수
    layer: 'LICENSE_HOLDER',
    why:
      '도착 기록은 환자가 아닌 사람(동행인·목격자·신고자)의 이름·연락처와 경찰 담당자 연락처를 담는다. ' +
      '신원 확인이 끝나면 대부분 쓸모가 줄지만, 사건·분쟁이 생기면 다시 필요할 수 있다. 보존기간·가림 시점은 개인정보 처리 방침의 문제라 코드가 정할 수 없다.',
    legalReview: ['제3자 개인정보 수집·보존 근거와 기간 — 개인정보 처리 방침', '진료기록 보존 의무와의 관계(도착 기록을 진료기록으로 볼지) — 원내 법무 검토'],
    approvalPath: 'CODE_CHANGE',
    authority: '개인정보보호책임자 · 병원장',
    options: [
      { value: 'WITH_MEDICAL_RECORD', label: '진료기록과 같은 기간 보관한다(현행 동작과 같음)', effect: '가림·삭제 없이 남는다. 보존기간은 진료기록 보존 정책을 따른다.', enact: null },
      { value: 'MASK_AFTER_IDENTIFIED', label: '신원 확인 후 정한 기간이 지나면 이름·연락처를 가린다(기록은 남김)', effect: '가림 작업(크론)과 가림 이력 개발이 필요하다. 가린 뒤에는 연락할 수 없다.', enact: null },
      { value: 'NO_CONTACT_STORE', label: '연락처는 도착 기록에 적지 않고 보호자 등록(환자 연락처)으로만 받는다', effect: '도착 기록 화면에서 연락처 칸을 없앤다. 보호자가 아닌 목격자 연락처는 남지 않는다.', enact: null },
    ],
    statusQuo:
      '`EmergencyArrivalNote` 의 `companionName`·`companionContact`·`companionRelation`·`policeOfficer` 가 기간 제한·가림 없이 남는다(추가만 · 수정·삭제 경로 없음). ' +
      '법적 보존명령·보존기간 스윕(`retention`)의 대상 목록에 이 테이블은 없다.',
    verifyHow: ['`apps/api/prisma/schema.prisma` 의 `EmergencyArrivalNote` 를 읽는다', '`apps/api/src/modules/retention` 에 `emergency_arrival_notes` 가 없는지 grep', PLAN],
    afterDecision: 'WITH_MEDICAL_RECORD 외에는 가림 작업 또는 화면 칸 제거 개발이 남는다.',
    owner: '개인정보 보호팀 · 의무기록팀',
    dueBy: 'BEFORE_GO_LIVE',
    goLive: 'REQUIRED_BEFORE',
  },
  {
    key: 'er.arrival.recordRequirement',
    track: 'CLINICAL',
    title: '응급 미확인 환자 등록 때 도착 상황 기록을 필수로 할 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '도착 상황은 신원 확인과 사건 처리의 거의 유일한 단서지만, 소생술 중에는 적을 사람이 없다. ' +
      '필수로 막으면 "모름"만 찍고 넘어가는 거짓 기록이 생기고(판정 규칙 §4 — 필수 강제는 거짓 데이터가 된다), 막지 않으면 빠진 채로 남을 수 있다.',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: '응급의료센터장 · 간호부',
    options: [
      { value: 'OPTIONAL_VISIBLE', label: '선택 — 없으면 ER 보드에 "도착 기록 없음"으로 드러낸다(현행)', effect: '등록을 막지 않는다. 기록이 없는 신원미상 환자는 접수 트랙에 빨간 표식으로 남는다.', enact: null },
      { value: 'REQUIRED_LATER', label: '등록은 막지 않되 정한 시간 안에 첫 기록이 없으면 담당에게 알린다', effect: '미기록 알림(시간 기준·수신자) 개발이 필요하다.', enact: null },
      { value: 'REQUIRED_AT_REGISTRATION', label: '등록 때 첫 기록이 없으면 등록하지 못한다', effect: '소생 중 등록이 늦어질 수 있고, 형식만 채운 기록이 늘 수 있다.', enact: null },
    ],
    statusQuo:
      '등록은 도착 기록 없이도 된다(빈 기록은 만들지 않는다). ER 베드 보드 접수 트랙에 신원미상 환자마다 `arrivalNoteCount` 로 "도착 기록 없음 — 기록" 또는 "도착 기록 n건"을 보인다(2026-09-29).',
    verifyHow: ['`apps/api/src/modules/emergency/er-bed.service.ts` 의 `arrivalNoteCount`', '`apps/web/src/app/(main)/emergency/components/BedBoard.tsx` 접수 트랙', PLAN],
    afterDecision: 'OPTIONAL_VISIBLE 외에는 알림 또는 등록 검사 개발이 남는다.',
    owner: '응급의료센터 · 간호부',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
];
