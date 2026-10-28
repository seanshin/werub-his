/**
 * 결정 등록부 배치 10-K(2026-10-20) — 환자 관리 목록 세련화의 사람 결정 D1~D6.
 *
 * 출처: 기획 `docs/01-plan/features/patients-list-refinement-2026-10.plan.md` §6(🔴 그 표는 정본이 아니다 — 이 키가 정본).
 * 목록 범위·연락처로 찾기·휴면 정의·사진·병합 되돌리기·역할 데이터 접근 설정의 적용 범위는 원내 정책이다 — 코드가 정하지 않는다.
 * 🔴 원내에 정보보호 위원회가 없다(위원회 9곳) — 없는 위원회를 지어내지 않고 의무기록위원회(MRC)·운영위원회(OPS)에 배정한다.
 * 시스템은 권고하지 않는다(선택지와 결과만).
 */
import type { DecisionDef } from './decision.registry';

const PLAN = '`docs/01-plan/features/patients-list-refinement-2026-10.plan.md` §6';

export const DECISION_BATCH_2026_10_K: DecisionDef[] = [
  {
    key: 'patient.listScopeByRole',
    track: 'PRIVACY',
    title: '환자 목록의 기본 범위를 역할로 좁히는가 (지금은 환자 조회 권한이면 모든 역할이 등록 환자 전체를 본다)',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '🔴 실측: 환자 목록(`GET patients`)은 환자 조회 권한(PATIENT_VIEW)이 있는 14역할 모두에게 등록 환자 전체를 준다 — 범위 제한이 없다(능력표 `scope = ALL`). ' +
      '연락처·신원 값은 능력표대로 가리지만(v4.102.0), 이름·생년월일·등록번호는 전체가 보인다. ' +
      '의사에게는 "내 환자" 필터(최근 30일 진료·담당 입원·오늘 예약)가 있지만 기본이 아니라 사람이 누르는 필터다(v4.106.0). ' +
      '범위를 좁히면 응급·협진·당직 때 다른 환자를 못 찾을 수 있고, 넓게 두면 업무와 무관한 열람이 가능하다 — 열람은 감사 로그에 남는다.',
    legalReview: ['개인정보 보호법 — 최소 처리 원칙(원문 확인 필요)', '의료법 — 진료기록 열람 제한(원문 확인 필요)', '원내 의무기록 열람 규정'],
    approvalPath: 'CODE_CHANGE',
    authority: '의무기록위원회(MRC) · 운영위원회(OPS) · 개인정보 보호책임자',
    options: [
      { value: 'ALL', label: '현행 유지 — 조회 권한이면 전체', effect: '업무 흐름을 막지 않는다. 대신 열람 감사 로그를 정기 점검하는 사람이 있어야 한다.', enact: null },
      { value: 'ROLE_DEFAULT_WITH_REASON', label: '의사·간호 기본 범위 + 전체 보기는 사유 기록', effect: '코드 변경 — 의사는 내 환자, 간호사는 내 병동 재원이 기본 · "전체 보기"를 누르면 사유를 남기고 넓힌다(응급 열람과 같은 방식).', enact: null },
      { value: 'SCOPE_ONLY', label: '범위 밖 열람 금지', effect: '코드 변경 — 역할별 범위 밖 환자는 목록에 나오지 않는다. 협진·응급·당직 예외 경로를 따로 정해야 한다.', enact: null },
    ],
    statusQuo: '능력표 `scope = ALL` · 범위 제한 없음 · "내 환자"는 의사 전용 필터(기본 꺼짐) · 연락처·신원 값은 능력표대로 가린다.',
    verifyHow: ['apps/api `modules/patient/patient-list-access.ts resolveListAccess`(scope)', 'apps/api `modules/patient/patient.service.ts buildWhere`(scope=mine)', PLAN],
    afterDecision: '현행 외를 고르면 역할별 기본 범위·사유 기록(또는 예외 경로) 개발.',
    owner: '의무기록팀 · 개인정보 보호책임자 · 운영위원회',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'patient.contactSearch',
    track: 'PRIVACY',
    title: '전화번호로 환자를 찾을 수 있는 역할',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '🔴 v4.102.0 이전에는 모든 역할이 전화번호로 환자를 찾았다 — 연락처가 가려진 역할도 "이 번호의 환자가 있다"를 알 수 있었다. ' +
      '지금은 연락처를 원문으로 받는 역할(RBAC 연락처 권한 + 역할 데이터 접근 설정이 좁히지 않음)만 전화번호로 찾고, ' +
      '다른 역할이 숫자로 검색하면 "전화번호 검색 권한이 없어 이름·등록번호로만 찾았다"고 말한다(`searchNote`). ' +
      '전화로 문의한 환자를 찾는 창구 업무와 개인정보 노출 사이의 선택이다.',
    legalReview: ['개인정보 보호법 — 목적 외 이용 제한(원문 확인 필요)', '원내 개인정보 처리방침'],
    approvalPath: 'CODE_CHANGE',
    authority: '의무기록위원회(MRC) · 운영위원회(OPS) · 개인정보 보호책임자',
    options: [
      { value: 'CONTACT_ROLE_ONLY', label: '연락처 원문을 받는 역할만', effect: '지금 코드(v4.102.0) — 연락처가 가려진 역할은 전화번호로 찾지 않고 그 사실을 말한다.', enact: null },
      { value: 'RECEPTION_ONLY', label: '원무만', effect: '코드 변경 — 전화번호 검색을 원무(RECEPTIONIST)에게만 연다. 연락처 권한이 있는 다른 역할도 이름·등록번호로만 찾는다.', enact: null },
      { value: 'ALL_ROLES', label: '모든 역할(v4.102.0 이전)', effect: '코드 변경(되돌림) — 연락처가 가려진 역할도 전화번호로 찾는다. 찾은 환자의 번호는 여전히 가려진다.', enact: null },
    ],
    statusQuo: '능력표 `phoneSearch` = 연락처 원문 여부 · 권한 없는 숫자 검색은 이름·등록번호로만 찾고 `searchNote: PHONE_SEARCH_NOT_ALLOWED`.',
    verifyHow: ['apps/api `modules/patient/patient-list-access.ts`(phoneSearch · looksLikePhoneQuery)', 'apps/api `test/patient/patient-list-access.spec.ts`', PLAN],
    afterDecision: '원무만을 고르면 검색 권한 판정 변경 · 모든 역할을 고르면 v4.102.0 검색 제한을 되돌린다(판정표 "시드대로 구현됨").',
    owner: '개인정보 보호책임자 · 원무팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'patient.dormantDefinition',
    track: 'QUALITY',
    title: '"휴면 환자"를 무엇으로 정하는가 (지금은 등록 1년이 지났고 1년 안 진료 기록이 없는 환자)',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '환자 목록 데이터 품질 카드의 "1년 이상 미내원"은 등록 1년이 지났고 최근 1년 안에 진료 기록(작성 중 포함)이 없는 환자를 센다(v4.103.0). ' +
      '기준 기간(1년)과 "내원"의 뜻(서명된 진료만인지·예약 방문을 포함하는지)은 원내 정의다 — 연락처 정비·기록 보존·안내 발송의 대상을 정한다. ' +
      '운영 실측 분모 0(가상 시드 등록일이 모두 최근) — 지금 카드는 "산출 불가"를 말한다.',
    legalReview: ['의료법 시행규칙 — 진료기록 보존기간(원문 확인 필요)'],
    approvalPath: 'CODE_CHANGE',
    authority: '운영위원회(OPS) · 의무기록위원회(MRC)',
    options: [
      { value: 'ANY_ENCOUNTER_12M', label: '현행 — 등록 1년 지나고 1년 안 진료 기록 없음', effect: '작성 중 기록도 내원으로 센다. 바꾸지 않는다.', enact: null },
      { value: 'SIGNED_24M', label: '서명된 진료 24개월 없음', effect: '코드 변경 — 서명된 진료만 내원으로 세고 기간을 24개월로.', enact: null },
      { value: 'SIGNED_36M', label: '서명된 진료 36개월 없음', effect: '코드 변경 — 서명된 진료만 내원으로 세고 기간을 36개월로.', enact: null },
    ],
    statusQuo: '`qualityDormantWhere` — 등록 1년 경과 + 1년 안 진료 기록 없음 · 분모 = 등록 1년 경과 환자 · 분모 0 이면 산출 불가.',
    verifyHow: ['apps/api `modules/patient/patient.service.ts qualityDormantWhere`', 'apps/api `test/patient/patient-list-p1.spec.ts`', PLAN],
    afterDecision: '현행 외를 고르면 휴면 조건과 카드 문구를 바꾼다.',
    owner: '원무팀 · 의무기록팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'patient.photoPolicy',
    track: 'CLINICAL',
    title: '환자 사진 등록을 요구하는가 (지금은 요구하지 않고, 품질 카드가 수만 보인다)',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '환자 사진은 본인 확인(환자 확인 2가지 지표의 보조)에 쓰일 수 있지만, 사진도 개인정보다. ' +
      '지금은 등록 때 요구하지 않고, 품질 카드는 "사진 없음"을 경고색 없이 수만 보인다(정책 미정 — `noPhoto.policy = UNDECIDED`). ' +
      '요구한다면 누구에게(입원·수술 환자만인지 전원인지)·동의는 어떻게 받는지가 함께 정해져야 한다.',
    legalReview: ['개인정보 보호법 — 민감정보·영상정보 처리(원문 확인 필요)', '의료기관 인증 — 환자 확인 기준(원문 확인 필요)'],
    approvalPath: 'CODE_CHANGE',
    authority: '운영위원회(OPS) · 환자안전위원회(SAFE)',
    options: [
      { value: 'NOT_REQUIRED', label: '현행 — 요구하지 않음(경고 없음)', effect: '품질 카드는 수만 보인다. 바꾸지 않는다.', enact: null },
      { value: 'INPATIENT_SURGERY', label: '입원·수술 환자만', effect: '코드 변경 — 입원·수술 예정 환자의 사진 없음을 품질 카드·입원 화면에서 경고하고 촬영 동의 기록을 둔다.', enact: null },
      { value: 'ALL', label: '전원', effect: '코드 변경 — 모든 환자의 사진 없음을 경고하고 등록 때 촬영(또는 거부 사유)을 기록한다.', enact: null },
    ],
    statusQuo: '품질 지표 `noPhoto.policy = UNDECIDED` · 화면은 경고색 없이 수만 · 등록 화면은 사진을 요구하지 않는다.',
    verifyHow: ['apps/api `modules/patient/patient.service.ts getQualityDashboard`(noPhoto)', 'apps/web `app/(main)/patients/components/QualityDashboardCard.tsx`', PLAN],
    afterDecision: '현행 외를 고르면 경고 대상·촬영 동의 기록 개발.',
    owner: '원무팀 · 간호부 · 환자안전위원회',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'patient.mergeReversal',
    track: 'CLINICAL',
    title: '환자 병합을 되돌릴 수 있게 하는가 (지금은 되돌리는 경로가 없다)',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '🔴 실측: 병합(`POST patients/merge`)은 원 환자를 비활성으로 두고 기록을 정책대로 옮긴다(옮김·고유 키 겹치지 않는 행만·원장은 남김·포털 계정 수동 · v4.105.0). ' +
      '되돌리는 EP·화면은 없다 — 잘못 병합하면 옮겨진 기록을 사람이 하나씩 되돌려야 하고, 무엇이 어디서 왔는지는 병합 이력의 건수만 남는다. ' +
      '되돌리기를 만들려면 옮긴 행의 id 를 병합 때 기록해야 한다(지금은 건수만).',
    legalReview: ['의료법 — 진료기록 수정 이력 보존(원문 확인 필요)', '원내 의무기록 정정 규정'],
    approvalPath: 'CODE_CHANGE',
    authority: '의무기록위원회(MRC)',
    options: [
      { value: 'NONE', label: '현행 — 되돌리기 없음', effect: '병합 창이 "되돌릴 수 없다"를 말하고 남는 기록 확인을 받는다. 잘못된 병합은 사람이 정정한다.', enact: null },
      { value: 'ADMIN_WITH_REASON', label: '관리자 + 사유로 되돌리기', effect: '코드 변경 — 병합 때 옮긴 행 id 를 원장에 남기고, 관리자가 사유와 함께 되돌린다(그 사이 새로 생긴 기록은 대상 환자에 남는다).', enact: null },
    ],
    statusQuo: '되돌리기 EP·화면 없음 · 병합 이력에 옮긴/남은 건수와 남는 기록 확인 사실만 남는다 · 원 환자는 비활성(병합 대상 id 기록).',
    verifyHow: ['apps/api `modules/patient/patient.service.ts mergePatients`', 'apps/api `modules/patient/patient-merge.ts`', PLAN],
    afterDecision: '되돌리기를 고르면 병합 행 원장·되돌리기 EP·화면 개발.',
    owner: '의무기록팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'access.roleDataAccess.scope',
    track: 'PRIVACY',
    title: '역할 데이터 접근 설정(연락처 등)을 어디까지 강제하는가 (지금은 환자 목록에만)',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '🔴 실측: 역할 데이터 접근 설정(`access.role.*` — 연락처 보기·등록)은 v4.102.0 전에는 화면이 열만 숨겼고 서버 응답은 원문이었다. ' +
      '지금은 환자 목록·스마트 목록 응답에서 RBAC 를 **좁히기만** 한다(넓히지 못함). 환자 상세·차트는 RBAC 그대로다 — 목록에서 가린 번호가 상세에서 보인다. ' +
      '설정과 RBAC 가 같은 사실(누가 연락처를 보는가)의 정본 둘이다.',
    legalReview: ['개인정보 보호법 — 접근 권한 관리(원문 확인 필요)', '원내 개인정보 처리방침'],
    approvalPath: 'CODE_CHANGE',
    authority: '의무기록위원회(MRC) · 운영위원회(OPS) · 개인정보 보호책임자',
    options: [
      { value: 'LIST_ONLY', label: '목록만', effect: '지금 코드(v4.102.0) — 목록·스마트 목록 응답만 좁힌다. 능력표가 `narrowing.scope = LIST` 로 밝힌다.', enact: null },
      { value: 'LIST_AND_DETAIL', label: '상세·차트까지', effect: '코드 변경 — 환자 상세·차트 응답도 같은 설정으로 좁힌다.', enact: null },
      { value: 'ABOLISH_SETTING', label: '설정 폐지 — RBAC 하나로', effect: '코드 변경 — 역할 데이터 접근 설정을 없애고 권한은 RBAC 로만 정한다(정본 하나).', enact: null },
    ],
    statusQuo: '`AccessControlService.listNarrowing` → 목록 응답만 좁힘 · 상세는 RBAC · 설정 조회 실패 = 연락처 가림·등록 닫힘.',
    verifyHow: ['apps/api `modules/access-control/access-control.service.ts listNarrowing`', 'apps/api `modules/patient/patient.controller.ts listAccess`', PLAN],
    afterDecision: '상세까지를 고르면 상세 응답 마스킹 확장 · 폐지를 고르면 설정 화면·서버 좁히기 회수(판정표 "시드대로 구현됨" — 목록 좁히기는 되돌린다).',
    owner: '개인정보 보호책임자 · 의무기록팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
];
