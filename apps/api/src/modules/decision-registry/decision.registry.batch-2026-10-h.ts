/**
 * 결정 등록부 배치 10-H(2026-10-12) — 인쇄본 발급 원장·개발 반영 추적의 사람 결정 D1~D6.
 *
 * 출처: 기획서 `docs/01-plan/features/decision-print-remaining.plan.md` §4(🔴 그 표는 정본이 아니다 — 이 키가 정본).
 * P0·P1 은 D1·D3 을 **기본값으로** 구현했다(공개 진위확인은 유효·종류·시각·상태·기관만 · 직원 대조는 관리자·경영진 · 발급은 관리자).
 * 이 결정들은 그 기본값을 사람이 고르게 한다. 시스템은 어느 선택이 옳다고 권고하지 않는다.
 */
import type { DecisionDef } from './decision.registry';

const PLAN = '`docs/01-plan/features/decision-print-remaining.plan.md` §4';

export const DECISION_BATCH_2026_10_H: DecisionDef[] = [
  {
    key: 'print.verify.publicScope',
    track: 'PRIVACY',
    title: '서버 발급 인쇄본(결정 대장·개시 브리핑·당직표·QI 보고서)의 진위확인을 누구에게 어디까지 보여줄 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '인쇄본 쪽마다 진위확인 QR 이 찍힌다. 종이를 받은 외부인이 찍었을 때 무엇을 보여줄지, 직원이 찍었을 때 "이 판 이후 바뀐 것"까지 보여줄지는 공개 범위 결정이다. ' +
      '확인 코드 없이 번호만으로는 답하지 않는다(번호 열거 방지 — 이미 구현).',
    legalReview: ['원내 문서의 외부 공개 범위(개인정보 보호법 — 당직표는 직원 이름 · 확인 필요)'],
    approvalPath: 'CODE_CHANGE',
    authority: '의무기록위원회(MRC)',
    options: [
      { value: 'PUBLIC_MIN_STAFF_DIFF', label: '공개 최소 + 직원 대조(현행 기본값)', effect: '누구나 유효 여부·종류·발급 시각·상태·기관명을 본다(내용 없음). 관리자·경영진이 로그인해 찍으면 지금 원장과의 차이까지 본다.', enact: null },
      { value: 'STAFF_ONLY', label: '직원만', effect: '코드 변경 — 로그인하지 않으면 진위확인이 답하지 않는다. 종이를 받은 외부인은 진본 여부를 확인할 수 없다.', enact: null },
      { value: 'PUBLIC_ONLY', label: '공개 최소만', effect: '코드 변경 — 직원 대조(이 판 이후 바뀐 것)를 없앤다. 직원도 낡은 판인지 종이만으로 알 수 없다.', enact: null },
    ],
    statusQuo: '공개 진위확인은 유효·종류·발급 시각·상태·기관명만 답한다 · 직원 대조 `GET /api/v1/print-issue/:issueNo/compare` 는 관리자·경영진.',
    verifyHow: ['/verify/document/<발급번호>?v=<확인 코드> — 로그인 없이·관리자로 각각', PLAN],
    afterDecision: '현행 외를 고르면 진위확인 화면·대조 EP 권한 개발.',
    owner: '의무기록실 · 전산팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'print.issue.phiRetention',
    track: 'PRIVACY',
    title: '환자 정보가 든 인쇄본(차트 요약·퇴원 정산서·기록 상세·기록 시계열·빠른 진단서)을 발급 원장에 올릴 것인가 — 올린다면 보존기간·열람 역할',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '발급 원장에 올리면 진위확인이 생기지만, 원장 스냅샷이 의무기록 사본과 같은 무게의 환자 정보 사본이 된다(보존·열람·파기 대상). ' +
      '정하기 전에는 원장에 올리지 않고 쪽마다 "원장 미등재 — 진위확인 불가"를 적는다(QR 없음).',
    legalReview: ['의료법 시행규칙 진료기록 보존기간 · 사본 발급 기록 보존(원문 확인 필요)'],
    approvalPath: 'CODE_CHANGE',
    authority: '의무기록위원회(MRC) · 정보보호',
    options: [
      { value: 'NOT_REGISTERED', label: '원장에 올리지 않는다(현행)', effect: '환자 정보 인쇄본은 진위확인이 없다. 쪽마다 "원장 미등재"를 적는다.', enact: null },
      { value: 'SAME_AS_COPY', label: '의무기록 사본과 같은 보존·열람', effect: '코드 변경 — 종류별 서버 스냅샷 개발 · 보존기간 검사(ISSUED_DOCUMENT)를 사본과 같게 · 열람은 의무기록 역할.', enact: null },
      { value: 'SEPARATE_PERIOD', label: '별도 보존기간(짧게)', effect: '코드 변경 — 종류별 서버 스냅샷 + 별도 보존기간 설정 · 기간이 지나면 진위확인이 "기록 없음"이 된다.', enact: null },
    ],
    statusQuo: '환자 차트 요약·퇴원 정산서·기록 상세·기록 시계열·빠른 진단서 인쇄본은 발급 원장에 오르지 않는다 — QR 없음 · "원장 미등재" 표시.',
    verifyHow: ['web `components/print/PrintSheet.tsx` — unissued PENDING_D2', PLAN],
    afterDecision: '현행 외를 고르면 종류별 서버 스냅샷·보존·열람 개발.',
    owner: '정보보호 담당 · 의무기록실',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'print.issue.roles',
    track: 'GOVERNANCE',
    title: '서버 발급 인쇄본을 누가 발급받을 수 있는가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '발급하면 진본 번호가 생긴다. 지금은 관리자만 발급하고, 나머지 역할은 "미발급 미리보기"(워터마크·QR 없음)만 인쇄할 수 있다 — ' +
      '당직표를 뽑는 부서장·QI 보고서를 뽑는 질관리 담당이 진본을 받지 못한다.',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: '운영위원회(OPS)',
    options: [
      { value: 'ADMIN_ONLY', label: '관리자만(현행 기본값)', effect: '관리자 외에는 미발급 미리보기만 인쇄한다.', enact: null },
      { value: 'SCREEN_ROLES', label: '그 화면을 볼 수 있는 역할 전부', effect: '코드 변경 — 문서 종류별로 화면 읽기 역할과 같은 발급 역할(당직표 = 근무표 열람 역할 등).', enact: null },
      { value: 'PER_DOCUMENT', label: '문서별로 지정', effect: '코드 변경 — 종류별 발급 역할 설정을 두고 위원회가 정한다.', enact: null },
    ],
    statusQuo: '`POST /api/v1/print-issue` 는 관리자(ADMIN)만.',
    verifyHow: ['apps/api `modules/print-issuance/print-issuance.controller.ts` @Roles', PLAN],
    afterDecision: '현행 외를 고르면 발급 EP 역할 개발.',
    owner: '전산팀 · 운영위원회',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'governance.registerPeriodicIssue',
    track: 'GOVERNANCE',
    title: '결정 대장을 언제 발급해 남길 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '결정 대장은 결정이 하나 바뀔 때마다 해시가 바뀐다. 수시로만 발급하면 "어느 시점에 무엇이 결정돼 있었나"가 발급한 날에만 남는다. ' +
      '정기 발급은 그 공백을 메우지만 발급 원장이 늘어난다.',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: '운영위원회(OPS)',
    options: [
      { value: 'ON_DEMAND', label: '수시(현행)', effect: '누군가 인쇄할 때만 발급한다.', enact: null },
      { value: 'PER_MEETING', label: '위원회 회의마다', effect: '코드 변경 — 회의 기록 때 결정 대장을 자동 발급해 회의에 붙인다.', enact: null },
      { value: 'MONTHLY', label: '월 1회', effect: '코드 변경 — 매월 첫날 자동 발급(크론) · 발급 원장에 한 판씩 쌓인다.', enact: null },
    ],
    statusQuo: '정기 발급 없음 — 인쇄 버튼을 누를 때만 발급된다.',
    verifyHow: ['/admin/decisions/register 발급 후 인쇄', PLAN],
    afterDecision: '현행 외를 고르면 자동 발급 개발.',
    owner: '운영위원회',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'governance.devEnactmentConfirmer',
    track: 'GOVERNANCE',
    title: '개발 반영 결정이 "반영됐다"를 누가 확인해 기록하는가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '결정 방식 "개발 반영" 108건은 의사결정만으로 시스템이 바뀌지 않는다 — 개발·배포가 따라야 한다. ' +
      '지금은 반영됐는지 기록하는 곳이 없다(기록 ≠ 적용). 확인자를 정해야 반영 대기·반영됨을 갈라 말할 수 있다.',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: '운영위원회(OPS)',
    options: [
      { value: 'ADMIN', label: '관리자', effect: '코드 변경 — 반영 확인 기록을 관리자가 남긴다(릴리즈 번호 근거 필수).', enact: null },
      { value: 'DEV_LEAD', label: '개발 책임자', effect: '코드 변경 — 개발 책임자 지정 계정이 남긴다. 그 지정도 기록한다.', enact: null },
      { value: 'DECISION_OWNER', label: '결정 주체', effect: '코드 변경 — 결정을 내린 층(위원회·허가권자)이 확인해야 반영됨으로 센다. 확인까지 시간이 걸린다.', enact: null },
    ],
    statusQuo: '개발 반영 결정의 반영 여부를 기록하는 원장·화면이 없다.',
    verifyHow: ['/admin/decisions 결정 방식 "개발 반영"', PLAN],
    afterDecision: '어느 쪽이든 반영 기록(이력 종류)·화면 개발(기획 P2).',
    owner: '운영위원회 · 전산팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'governance.seedImplementedPolicy',
    track: 'GOVERNANCE',
    title: '개발 시드대로 이미 구현된 동작을 실결정이 다르게 정하면 어떻게 하는가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '개발 반영 108건 중 47건은 시드 선택이 현행과 다른 동작을 정했고, 그 일부는 이미 구현됐다(시드가 정책을 정한 상태). ' +
      '실결정이 시드와 다르면 되돌리는 개발이 필요하다. 원칙을 먼저 정하지 않으면 건마다 "이미 이렇게 돌고 있으니"가 결정을 대신한다.',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: '운영위원회(OPS)',
    options: [
      { value: 'REVERT_IF_DIFFERENT', label: '실결정이 다르면 되돌린다', effect: '실결정과 다른 시드 동작은 개발로 되돌린다 — 개발 비용이 든다. 되돌리기 전까지 "반영 대기"로 표시한다.', enact: null },
      { value: 'SEED_AS_PROPOSAL', label: '시드 동작을 실결정 기본안으로 상정', effect: '🔴 시드가 정책을 정한 것을 공식 안건으로 올린다 — 위원회가 그대로 의결하면 되돌릴 일이 없다. 시드가 결정을 이끄는 구조를 인정하는 것이다.', enact: null },
      { value: 'PER_KEY', label: '키마다 따로', effect: '원칙 없이 결정마다 정한다 — 판정표(기획 P2-0)를 근거로 건별 판단.', enact: null },
    ],
    statusQuo: '원칙 없음 · 개발 반영 108건의 구현 여부 판정표(기획 P2-0)도 아직 없다.',
    verifyHow: [PLAN, 'CLAUDE.md "시드가 정책을 정해버린다"'],
    afterDecision: '원칙에 따라 P2-0 판정표·되돌림 목록을 만든다.',
    owner: '운영위원회',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
];
