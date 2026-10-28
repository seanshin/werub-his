/**
 * 결정 등록부 배치 10-C (2026-10-05) — **수술방 녹화**(수술실 CCTV · 수술 장비 영상).
 * 수술방 차트(`/or-chart/:id`)를 만들며 녹화 기능을 요청받았으나 HIS 에는 촬영·녹화 장치 연동이 **전혀 없다**(코드 0).
 * 녹화는 법적 요건(허가권자)·동의 절차·보관·열람 권한이 먼저이고, 그 전에 화면이 "녹화 중"을 그리면 거짓이다.
 * 🔴 등재 ≠ 결정 — 선택지와 결과만, 권고 없음. 🔴 조문·보관 일수는 옮겨 적지 않았다(원문 대조 안 함 — 확인은 법무 몫).
 * 인증 기준 CCTV 운영 대장(`policy.accreditation.cctv`, 배치 C)과는 다른 질문이다 — 그것은 인증 항목의 운영 대장, 이것은 수술실 촬영 자체.
 */
import type { DecisionDef } from './decision.registry';

const REF = '`apps/web/src/app/or-chart/[surgeryId]/panels.tsx`(머리 "녹화 연동 없음") · `apps/api/src/modules/surgery/or-chart.service.ts`';

export const DECISION_BATCH_2026_10_C: DecisionDef[] = [
  {
    key: 'or.recording.cctvOperation',
    track: 'PRIVACY',
    title: '수술실 촬영(CCTV)을 어디서 운영할 것인가 — HIS 가 무엇을 맡는가',
    layer: 'LICENSE_HOLDER',
    why:
      '수술실 내 촬영은 의료법에 별도 조항이 있는 법적 운영 요건이다(대상 수술·촬영 요청·보관·열람 조건). HIS 에는 촬영 장치 연동도, 촬영 요청·거부 기록도 없다. ' +
      '시설 영상 시스템에 맡길지, HIS 가 요청·거부·열람 대장만 둘지, 녹화 상태까지 연동할지를 법적 검토와 함께 정해야 한다.',
    legalReview: [
      '의료법 제38조의2(수술실 내 폐쇄회로 텔레비전의 설치·운영) 및 시행규칙 — 원문 확인 필요(이 등재에 조문·기간을 옮겨 적지 않았다)',
      '개인정보 보호법상 영상정보처리기기 운영·열람 제공',
    ],
    approvalPath: 'AUTHORIZED_ROLE',
    authority: '개설자·원장 · 법무 · 개인정보보호책임자',
    options: [
      { value: 'FACILITY_SYSTEM', label: '시설 영상 시스템에서 운영(HIS 는 관여 안 함)', effect: '촬영·요청·열람은 시설 시스템과 서면 절차가 갖는다. 수술방 차트는 "녹화 연동 없음"을 계속 말한다.', enact: null },
      { value: 'HIS_LEDGER', label: 'HIS 에 촬영 요청·거부·열람 요청 대장을 둔다(영상은 시설 시스템)', effect: '코드 변경 — 수술 단위 촬영 요청/거부 사유/열람 요청·승인 원장과 화면 개발. 영상 자체는 HIS 밖.', enact: null },
      { value: 'HIS_INTEGRATED', label: '대장 + 녹화 장치 상태 연동(차트에 실제 녹화 여부)', effect: '코드 변경 — 장치 공급사 연동 계약·API 선행. 장치가 녹화를 확인해 준 때만 "녹화 중"을 그린다.', enact: null },
    ],
    statusQuo: 'HIS 코드에 수술실 촬영 연동·요청 기록 없음. 수술방 차트 머리는 "녹화 연동 없음 — 이 화면은 영상을 녹화하지 않습니다"라고 적는다. 인증 운영 대장 결정(policy.accreditation.cctv)도 미결.',
    verifyHow: [REF, '결정 policy.accreditation.cctv(배치 C)'],
    afterDecision: 'FACILITY_SYSTEM 외를 고르면 대장·화면(·연동) 개발. 어느 쪽이든 서면 절차·안내문은 병원이 마련한다.',
    owner: '법무팀 · 개인정보보호책임자 · 수술실',
    dueBy: 'BEFORE_GO_LIVE',
    goLive: 'REQUIRED_BEFORE',
  },
  {
    key: 'or.recording.requestFlow',
    track: 'PRIVACY',
    title: '수술실 촬영 요청·동의를 누가·언제·어떤 서식으로 받는가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '촬영을 HIS 가 일부라도 맡으면 요청을 받는 시점(수술 동의 때·입원 때)과 받는 사람, 거부할 때 남길 사유가 정해져야 화면을 만들 수 있다. ' +
      '정하지 않고 만들면 화면이 절차를 지어낸다(어휘를 지어내 강제하지 않는다).',
    legalReview: ['촬영 요청·거부 사유의 법정 범위(위 조항 — 원문 확인 필요)'],
    approvalPath: 'CODE_CHANGE',
    authority: '의료질 향상위원회 · 수술실 · 법무',
    options: [
      { value: 'WITH_SURGICAL_CONSENT', label: '수술 동의서와 함께 받는다', effect: '코드 변경 — 수술 동의 흐름에 촬영 요청 항목 추가(동의서 서식은 병원이 확정).', enact: null },
      { value: 'SEPARATE_FORM', label: '별도 서식으로 받는다', effect: '코드 변경 — 독립 서식·원장. 기존 RECORDING 동의(진료 녹음·스크라이브 전용)와 섞지 않는다.', enact: null },
      { value: 'PAPER_ONLY', label: 'HIS 밖 종이 절차', effect: 'HIS 개발 없음. 수술방 차트는 요청 여부를 모른다고 말한다.', enact: null },
    ],
    statusQuo: '동의 유형 RECORDING 은 진료 녹음·AI 문서화(앰비언트 스크라이브) 전용이다(schema ConsentType 주석). 수술실 촬영 요청 서식·원장 없음.',
    verifyHow: ['`apps/api/prisma/schema.prisma` ConsentType RECORDING', REF],
    afterDecision: 'PAPER_ONLY 외를 고르면 서식·원장·화면 개발(서식 문구는 법무 확인).',
    owner: '수술실 · 의료질관리실',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
    dependsOn: ['or.recording.cctvOperation'],
  },
  {
    key: 'or.recording.retentionAccess',
    track: 'PRIVACY',
    title: '수술실 영상의 보관 기간·저장 위치·열람 권한을 어떻게 정하는가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '영상은 의무기록보다 민감하고 용량이 크다. 법이 정한 범위 안에서 보관 기간·저장 위치(시설 서버·외부 보관)·열람 요청자와 승인자를 정해야 한다. ' +
      'HIS 의 기존 보존기간 정본(retention)에 영상 종류가 없다.',
    legalReview: ['보관 기간·열람 요건(위 조항 — 원문 확인 필요)', '개인정보 보호법상 파기'],
    approvalPath: 'COMMITTEE',
    authority: '개인정보보호책임자 · 의료질 향상위원회',
    options: [
      { value: 'LEGAL_MINIMUM', label: '법이 정한 기간·요건 그대로', effect: '법무가 확인한 기간을 시설 시스템(또는 HIS 보존 정본)에 설정한다. 이 등재는 기간 숫자를 갖지 않는다.', enact: null },
      { value: 'LONGER_INTERNAL', label: '원내 사유로 더 길게', effect: '사유(분쟁 대응 등)와 기간을 의결로 남긴다 — 길수록 유출 위험·저장 비용이 는다.', enact: null },
    ],
    statusQuo: 'HIS 에 수술실 영상 저장·보존·열람 경로 없음. 보존기간 정본(/admin/retention)에 영상 종류 미등재.',
    verifyHow: ['/admin/retention(보존기간 정본)', REF],
    afterDecision: '선택 후 저장 위치에 기간 설정·열람 대장 운영. HIS 가 맡으면 보존 정본에 종류 추가 개발.',
    owner: '정보보호팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
    dependsOn: ['or.recording.cctvOperation'],
  },
  {
    key: 'or.procedureVideo',
    track: 'CLINICAL',
    title: '수술 장비 영상(내시경·복강경·현미경 화면)을 의무기록에 연결할 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '수술 장비 화면 녹화는 촬영(CCTV)과 목적이 다르다(술기 기록·교육·분쟁 대응). 연결하려면 저장소(영상 보관 시스템)·환자 동의·교육 활용 범위가 정해져야 한다. ' +
      'HIS 는 PACS(OpenPACS, 별도 프로젝트)에 링크만 두며 HIS 가 그 저장소를 고치지 않는다.',
    legalReview: ['교육·연구 활용 시 동의 범위(개인정보 보호법·생명윤리 관련 — 확인 필요)'],
    approvalPath: 'CODE_CHANGE',
    authority: '수술실 · 의료질 향상위원회 · 정보보호',
    options: [
      { value: 'NOT_LINKED', label: '현행 — 연결하지 않음', effect: '장비 영상은 장비·부서 보관. 수술방 차트·수술 기록에 영상 참조 없음.', enact: null },
      { value: 'PACS_REFERENCE', label: '영상 보관 시스템(OpenPACS)에 저장하고 HIS 는 참조 링크만', effect: 'OpenPACS 쪽 수집 작업(별도 프로젝트 합의)과 HIS 수술 기록의 참조 칸 개발.', enact: null },
      { value: 'EXTERNAL_ARCHIVE', label: '별도 영상 보관 솔루션 + HIS 참조 링크', effect: '공급사 선정·계약 후 참조 링크 개발.', enact: null },
    ],
    statusQuo: 'HIS 에 수술 장비 영상 수집·참조 없음. 수술방 차트는 영상을 녹화하지 않는다고 적는다.',
    verifyHow: [REF, 'CLAUDE.md PACS 절(OpenPACS 분리·HIS 수정 금지)'],
    afterDecision: 'NOT_LINKED 외를 고르면 저장소 합의·동의 서식·참조 칸 개발.',
    owner: '수술실',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
];
