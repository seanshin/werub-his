/**
 * 결정 등록부 배치 10-L(2026-10-21) — 임상 규칙·템플릿 교차검증의 사람 결정 D1~D7.
 *
 * 출처: 기획 `docs/01-plan/features/clinical-rules-templates-review-2026-10.plan.md` §6(🔴 그 표는 정본이 아니다 — 이 키가 정본).
 * 누가 어떤 임상 카탈로그를 소유·승인하는지, 사용 중 세트를 어떻게 고치는지, 판정에 쓰이지 않던 옛 CDSS 규칙을 어떻게 할지 등은
 * 원내 정책이다 — 코드가 정하지 않는다. 시스템은 권고하지 않는다(선택지와 결과만).
 */
import type { DecisionDef } from './decision.registry';

const PLAN = '`docs/01-plan/features/clinical-rules-templates-review-2026-10.plan.md` §6';

export const DECISION_BATCH_2026_10_L: DecisionDef[] = [
  {
    key: 'catalog.ownership',
    track: 'GOVERNANCE',
    title: '임상 카탈로그(약속처방·치료일정·DUR 룰·트리아지·차트 서식·문진 폼·임상도구)를 어느 위원회가 소유·승인하는가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '「임상 규칙·템플릿」 10개 화면의 규칙은 모두 진료를 바꾸지만 소유 위원회가 정해져 있지 않다(기존 결정 `policy.catalogOwnership` 시드 = 미배정). ' +
      '그래서 사용 중 약속처방 26/26 이 승인 기록 없이 쓰였고(v4.111.0 부터 사용 중으로 바꾼 사람이 승인자로 남는다), 규칙 재검토 주기도 없다. ' +
      '카탈로그마다 누가 승인하고 언제 다시 보는지를 정해야 승인 기록이 의미를 가진다.',
    legalReview: ['의료기관 인증 — 임상 진료지침·표준 처방 관리 기준(원문 확인 필요)', '원내 위원회 규정'],
    approvalPath: 'CODE_CHANGE',
    authority: '운영위원회(OPS) · 진료부원장',
    options: [
      { value: 'UNASSIGNED', label: '현행 — 미배정', effect: '승인 기록은 사용 중으로 바꾼 관리자 개인으로 남는다. 위원회 안건이 되지 않는다.', enact: null },
      { value: 'ASSIGN_BY_CATALOG', label: '카탈로그별 배정', effect: '코드 변경 — 약속처방·치료일정·DUR 룰 = 약사위원회(DTC) · 트리아지 = 운영위원회(OPS) · 차트 서식·문진 폼 = 의무기록위원회(MRC) · 임상도구 검수 = 질향상·환자안전위원회(QPS) 같은 배정표를 원내가 확정하고, 사용 중 전환을 그 위원회 의결에 묶는다. 재검토 주기도 함께 정한다.', enact: null },
    ],
    statusQuo: '소유 위원회 없음 · 사용 중 전환은 관리자 권한 · 승인자 = 사용 중으로 바꾼 사람(v4.111.0) · 재검토 기한 없음.',
    verifyHow: ['apps/api `modules/order-set/order-set.service.ts changeStatus`', 'shared `catalog-lifecycle.ts`', PLAN],
    afterDecision: '배정을 고르면 카탈로그별 위원회 표·사용 중 전환의 의결 연결·재검토 기한 개발.',
    owner: '운영위원회',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'catalog.activeEdit',
    track: 'CLINICAL',
    title: '사용 중인 약속처방·치료일정 템플릿을 고칠 때 새 판으로 만드는가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '🔴 v4.111.0 전에는 사용 중 세트를 의사가 제자리에서 고쳤다 — 승인된 세트와 지금 세트가 다를 수 있었고, 누가 언제 바꿨는지 세트에 남지 않았다. ' +
      'v4.111.0 은 사용 중 수정을 새 판 초안으로 바꿨다(사용 중 판은 그대로 쓰이고, 새 판을 사용 중으로 하면 이전 판은 폐기). ' +
      '용량 표기 오타 같은 경미한 수정까지 새 판·재승인을 거치게 할지는 원내 판단이다.',
    legalReview: ['원내 약속처방 관리 규정'],
    approvalPath: 'CODE_CHANGE',
    authority: '약사위원회(DTC) · 의무기록위원회(MRC)',
    options: [
      { value: 'NEW_VERSION', label: '새 판 강제', effect: '지금 코드(v4.111.0) — 사용 중 수정은 새 판 초안 · 승인 단계 수정은 초안으로 되돌림.', enact: null },
      { value: 'MINOR_IN_PLACE', label: '경미 수정만 제자리 + 기록', effect: '코드 변경 — 정한 범위(문구·표기)는 제자리에서 고치고 변경 이력을 세트에 남긴다. 그 밖은 새 판.', enact: null },
      { value: 'IN_PLACE', label: '제자리 수정(v4.111.0 이전)', effect: '코드 변경(되돌림) — 사용 중 세트를 그대로 고친다. 승인과 내용이 갈릴 수 있다.', enact: null },
    ],
    statusQuo: 'shared `catalog-lifecycle` — 사용 중 = 새 판(열린 초안 하나 · 진단 연결·연령군·금기 옮김) · 승인 대기/승인됨 = 초안으로 · 상태는 조건부 쓰기(동시 변경 409).',
    verifyHow: ['shared `catalog-lifecycle.ts catalogEditMode`', 'apps/api `test/order-set/catalog-lifecycle-p2.spec.ts`', PLAN],
    afterDecision: '경미 수정 허용을 고르면 범위 정의와 변경 이력 개발 · 제자리를 고르면 v4.111.0 새 판 규칙을 되돌린다(판정표 시드대로 구현됨).',
    owner: '약제팀 · 의무기록팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'cdss.legacyRules',
    track: 'CLINICAL',
    title: '판정에 쓰이지 않던 옛 CDSS 규칙 17건을 어떻게 할 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '🔴 화면 3105 는 개통 이래 판정이 읽지 않는 표(`CdssRule` 17)를 편집했다 — 규칙을 고쳐도 처방 경고는 바뀌지 않았다. ' +
      'v4.110.0 은 화면을 실제 판정 규칙(DUR 룰)으로 바꾸고 옛 목록을 읽기 전용으로 두었다. 옛 17건(병용 8·연령 3·진단 3·용량 2·신기능 1) 중 ' +
      'DUR 룰에 없는 것을 옮길지, 버릴지는 약사위원회 판단이다.',
    legalReview: ['원내 DUR 기준'],
    approvalPath: 'CODE_CHANGE',
    authority: '약사위원회(DTC)',
    options: [
      { value: 'KEEP_READONLY', label: '읽기 전용 보존(v4.110.0)', effect: '판정에 쓰이지 않는 채로 남긴다. 화면이 그 사실을 말한다.', enact: null },
      { value: 'MIGRATE_TO_DUR', label: '검토 후 DUR 룰로 옮김', effect: '약사가 17건을 하나씩 검토해 DUR 룰 표에 같은 뜻으로 등록한다(사람 작업) · 옮긴 뒤 옛 목록 폐기.', enact: null },
      { value: 'RETIRE', label: '폐기', effect: '옛 목록을 비활성으로 정리한다(판정에는 원래 쓰이지 않았다).', enact: null },
    ],
    statusQuo: '3105 「옛 목록(판정 미사용)」 탭 · 읽기 전용(편집 단추 없음) · 서버 EP 는 그대로.',
    verifyHow: ['apps/web `app/(main)/admin/cdss-rules/page.tsx LEGACY_READ_ONLY`', 'apps/api `test/cdss/cdss-p0-honesty.spec.ts`(판정이 CdssRule 을 읽지 않는다)', PLAN],
    afterDecision: '옮김·폐기는 약사·관리자 작업 · 폐기를 고르면 옛 EP·표 회수(개발).',
    owner: '약제팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'orderSet.nurseUse',
    track: 'CLINICAL',
    title: '간호사가 약속처방을 사용할 수 있는가 (지금은 사용 기록 EP 가 403)',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '오더 화면에서 간호사가 세트를 고르면 사용 기록 EP 가 403 이다(역할 대조 기준선에 동결된 어긋남) — 사용 통계·추천 가중이 실제보다 낮다. ' +
      '간호사의 오더 입력은 직종별 오더 입력 범위(`order.entryScope`)와 구두 처방 규칙을 따른다. 세트 사용을 그 범위 안에서 허용할지는 원내 판단이다.',
    legalReview: ['의료법 — 처방 권한(원문 확인 필요)', '원내 구두 처방 규정'],
    approvalPath: 'CODE_CHANGE',
    authority: '약사위원회(DTC) · 간호부',
    options: [
      { value: 'DENY', label: '현행 — 사용 불가(403)', effect: '간호사는 세트를 고르지 않고 항목을 하나씩 입력한다.', enact: null },
      { value: 'ALLOW_IN_SCOPE', label: '입력 범위 안에서 허용', effect: '코드 변경 — 직종별 입력 범위가 허용한 유형의 항목만 세트에서 담고, 사용 기록에 남긴다.', enact: null },
    ],
    statusQuo: '`POST order-sets/:id/use` = @Roles(DOCTOR) · 역할 대조 기준선 `/orders|POST /api/v1/order-sets/:x/use|LAB_TECH,NURSE`.',
    verifyHow: ['apps/api `modules/order-set/order-set.controller.ts`(use)', 'apps/api `test/architecture/role-endpoint-fit.baseline.json`', PLAN],
    afterDecision: '허용을 고르면 세트 사용 EP 역할·입력 범위 필터 개발.',
    owner: '간호부 · 약제팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'triage.ruleAuthority',
    track: 'CLINICAL',
    title: '원무 AI 접수 상담 규칙(증상 → 진료과·응급 안내)을 누가 고칠 수 있는가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '「트리아지 관리」(3130) 규칙은 원무 창구 AI 접수 상담이 읽는다(응급실 KTAS 에는 쓰이지 않는다 — v4.109.0 화면 고지). ' +
      '증상·규칙은 의사 누구나 승인·판 기록 없이 수정한다 — 응급 안내 규칙(흉통 → 응급실)도 포함된다. 수정은 감사 기록에만 남는다.',
    legalReview: ['원내 환자 안내 규정'],
    approvalPath: 'CODE_CHANGE',
    authority: '운영위원회(OPS) · 환자안전위원회(SAFE)',
    options: [
      { value: 'DOCTOR_ANY', label: '현행 — 의사 누구나', effect: '빠르게 고칠 수 있다. 응급 안내가 검토 없이 바뀔 수 있다.', enact: null },
      { value: 'DOCTOR_WITH_APPROVAL', label: '의사 + 승인', effect: '코드 변경 — 의사가 고친 규칙은 초안이 되고 승인 뒤 쓰인다(카탈로그 생애주기 정본).', enact: null },
      { value: 'ADMIN_ONLY', label: '관리자만', effect: '코드 변경 — 증상·규칙 쓰기 EP 를 관리자로 좁힌다.', enact: null },
    ],
    statusQuo: '`triage.controller` 증상·규칙·별칭 쓰기 = @Roles(ADMIN, DOCTOR) · 삭제 = ADMIN · 판·승인 없음.',
    verifyHow: ['apps/api `modules/triage/triage.controller.ts`', 'apps/web `app/(main)/admin/triage/page.tsx`(범위 고지)', PLAN],
    afterDecision: '승인·관리자를 고르면 권한·초안 경로 개발 · 화면 이름(트리아지)을 바꿀지도 함께.',
    owner: '원무팀 · 응급의학과 · 운영위원회',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'prescription.delegatePolicy',
    track: 'CLINICAL',
    title: '위임(대리) 처방 — 본인 외 처방의 지정을 허용하는가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '🔴 「처방의 지정 규칙」(3157) 화면은 위임 처방 허용·위임 인증·주치의 한정 같은 **정책**을 관리자가 설정으로 바로 바꾼다 — 결정 등록부 밖이었다. ' +
      '코드 기본값은 위임 허용 안 함·위임 시 지정 처방의 본인 인증 필수다. 위임 처방은 의료법상 처방 주체 문제라 허가권자 검토가 먼저 필요하다.',
    legalReview: ['의료법 — 처방전 작성·대리 처방(원문 확인 필요)', '원내 위임 처방 규정'],
    approvalPath: 'CODE_CHANGE',
    authority: '의무기록위원회(MRC) · 약사위원회(DTC) · 병원장(허가권자 검토)',
    options: [
      { value: 'DISABLED', label: '현행 — 허용하지 않음', effect: '처방의 = 로그인 사용자. 위임 요청 경로는 꺼져 있다(설정 기본값).', enact: null },
      { value: 'ALLOW_WITH_AUTH', label: '본인 인증을 조건으로 허용', effect: '설정으로 위임을 켜고 지정 처방의의 본인 인증(step-up)을 필수로 둔다. 🔴 결정 전에는 설정 화면에서 켜지 않는다.', enact: null },
    ],
    statusQuo: '설정 `prescription.prescriberRules`(코드 기본 enabled·allowDelegate=false · requireDelegateAuth=true) · 3157 화면이 관리자에게 직접 변경을 허용한다(결정 보호 밖).',
    verifyHow: ['apps/api `modules/config/config-runtime.service.ts`(prescription.prescriberRules)', 'apps/api `modules/prescription/prescription.service.ts`(prescriber rules)', PLAN],
    afterDecision: '허용을 고르면 설정을 결정에 묶어 보호하고(결정 보호 대상) 3157 화면이 결정 상태를 보인다.',
    owner: '의무기록팀 · 약제팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'clinicalChart.verifyPolicy',
    track: 'QUALITY',
    title: '임상도구(점수표·레지멘 등 89종) 검수를 몇 명이 승인하는가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '임상도구 89종 중 검수된 것이 0 이다 — 전부 "미검증"이고 레지멘 처방 초안 생성은 모든 도구에서 막혀 있다. ' +
      '코드 기본값은 2인 승인(4-eyes · 설정 `clinical.verificationFourEyes` 행이 없으면 켜짐)이다. 비임상 관리자 1인이 89개를 혼자 승인하던 결함을 막으려고 켠 값이다. ' +
      '몇 명이, 어떤 우선순위로 검수할지는 원내 판단이다.',
    legalReview: ['원내 임상 진료지침 검토 규정'],
    approvalPath: 'CODE_CHANGE',
    authority: '질향상·환자안전위원회(QPS) · 의무기록위원회(MRC)',
    options: [
      { value: 'TWO_PERSON', label: '현행 — 2인 승인', effect: '두 사람이 승인해야 검증됨. 진행이 느리다.', enact: null },
      { value: 'ONE_PERSON', label: '1인 승인', effect: '설정을 false 로 — 한 사람 승인으로 검증됨(끈 사람이 기록된다).', enact: null },
    ],
    statusQuo: '`FOUR_EYES_DEFAULT = true` · 설정 행 없으면 2인 · 검수 0/89 · 레지멘 초안 비활성.',
    verifyHow: ['apps/api `modules/clinical-chart-verification/clinical-chart-verification.service.ts`', PLAN],
    afterDecision: '우선순위(레지멘 먼저 등)와 검수 현황판은 기획 P5.',
    owner: '질향상팀 · 의무기록팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
];
