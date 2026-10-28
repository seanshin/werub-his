/**
 * 결정 등록부 배치 D (2026-09-15) — 요청 본문 DTO 배치(T2·E2·U2·B4)가 **막지 않고 기록한 절차 우회**.
 *
 * 🔴 등재 ≠ 결정. 선택지와 결과만 적고 권고·기본 선택은 하지 않는다(판정 규칙 6장).
 *    이 배치의 어느 항목도 `enactKind` 를 갖지 않는다 — 기록은 증빙이고 반영은 `afterDecision` 의 개발 몫이다.
 *    그래서 선택지의 `enact` 는 전부 `null`(기록이 시스템을 자동으로 바꾸지 않는다는 명시)이다.
 * 🔴 DTO 배치는 "모르는 키를 지우는" 것까지만 했다. 아래 우회는 **DTO 가 허용한 필드** 로 일어나는 것이라
 *    검증 추가만으로 막으면 절차를 코드가 대신 정하게 된다 — 그래서 사람 결정으로 올린다.
 * 🔴 같은 성격을 묶었다(9건 → 3결정):
 *    ① 절차 경로가 따로 있는데 수정 API 로 최종 상태·절차 파생 값을 넣을 수 있는 것(승인·퇴직·중도탈락·IRB 만료일)
 *    ② 전이 규칙·이력 없이 상태를 바꾸는 운영 화면(해외환자 케이스·급양 조리·포털 배너)
 *    ③ 대외 보고 제출자를 요청 본문에서 받는 것(KONIS) — 마약류 처방자(`policy.controlledSubstance.prescriberSource`)는
 *       배치 C 에 이미 있어 중복 등재하지 않는다.
 * 🔴 법령 수치·조문은 적지 않는다(검토 항목 이름만).
 */
import type { DecisionDef } from './decision.registry';

export const DECISION_BATCH_2026_09_D: DecisionDef[] = [
  {
    key: 'policy.workflow.procedureBypassViaUpdate',
    track: 'GOVERNANCE',
    title: '승인·퇴직·중도탈락처럼 전용 절차가 있는 값을 일반 수정 API 로 바꾸게 둘 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '전용 절차 경로는 승인자·시각·사유·후속 이벤트를 남기는데, 같은 값을 일반 수정 API 로 넣으면 그 기록 없이 최종 상태가 된다. ' +
      '막으면(전용 경로만 허용) 잘못 입력한 값을 고칠 길이 좁아지고, 두면 절차 기록이 빠진 최종 상태가 생긴다 — 어느 쪽을 택할지는 각 절차 소관 위원회 판단이다.',
    legalReview: ['연구 대상자 중도탈락 보고(GCP)·IRB 승인 유효기간 기록', '인사 퇴직 처리 기록'],
    approvalPath: 'CODE_CHANGE',
    authority: '의료질 관리위원회 · IRB · 인사위원회',
    options: [
      {
        value: 'DEDICATED_PATH_ONLY',
        label: '전용 절차 경로만 허용',
        effect: '수정 API 에서 최종 상태·절차 파생 값을 거부한다. 승인·퇴직·중도탈락·만료일 변경은 각 전용 경로로만 기록된다(개발 필요).',
        enact: null,
      },
      {
        value: 'ALLOW_WITH_REASON',
        label: '수정 허용 + 사유·행위자 기록 필수',
        effect: '수정 API 로도 바꿀 수 있되 사유와 변경자를 남기지 않으면 거부한다. 전용 경로의 후속 이벤트(퇴직 이벤트·등록 수 감소)는 별도로 맞춰야 한다(개발 필요).',
        enact: null,
      },
      {
        value: 'AS_IS',
        label: '현행 유지',
        effect: '수정 API 로 최종 상태를 넣을 수 있다. 승인자·퇴직일·탈락 사유·등록 수 감소가 기록되지 않는 경로가 남는다.',
        enact: null,
      },
    ],
    statusQuo:
      '2026-09-15 코드 확인 — ① 원내 정책: `gld.service.ts` `updatePolicy` 가 `status` 를 받아 `ACTIVE` 로 둘 수 있다(`approvePolicy` 는 approvedBy·approvedAt·effectiveDate 를 남긴다). ' +
      '② 인사: `hr.service.ts` `changeStatus` 가 `RESIGNED` 를 어휘 검사만 하고 저장한다(`resign` 은 resignDate 와 `staff.resigned` 이벤트를 남긴다). ' +
      '③ 연구 대상자: `research.service.ts` `updateSubject` 가 `status: WITHDRAWN` 을 받는다(`withdrawSubject` 는 사유 필수·탈락일·currentEnroll 감소). ' +
      '④ 연구 과제: `update` 가 `irbExpiryDate` 를 승인일과 대조하지 않고 저장한다(`approve` 는 대조한다). 네 수정 경로 모두 web·mobile 호출부는 없다(직접 API 호출로만 가능).',
    verifyHow: [
      '`grep -n "async updatePolicy\\|async approvePolicy" apps/api/src/modules/gld/gld.service.ts`',
      '`grep -n "async changeStatus\\|async resign" apps/api/src/modules/hr/hr.service.ts`',
      '`grep -n "async updateSubject\\|async withdrawSubject\\|irbExpiryDate" apps/api/src/modules/research/research.service.ts`',
    ],
    afterDecision: '🔴 어느 선택이든 수정 경로 개발이 남는다(현행 유지 제외). 이미 수정 경로로 바뀐 기록은 소급하지 않는다.',
    owner: '의료질 관리실 · 인사팀 · 임상연구센터',
    dueBy: 'NONE',
    // 개시 뒤로 둘 수 있는 근거: 네 수정 경로를 부르는 화면이 없어 일상 업무에서는 전용 경로만 쓰인다(직접 API 호출 시에만 발생).
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'policy.workflow.operationalStateTransitions',
    track: 'PLATFORM',
    title: '해외환자 케이스·급양 조리·포털 배너의 상태를 전이 규칙과 이력 없이 바꾸게 둘 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '세 화면의 상태 변경은 순서(예: 조리 시작 전 완료)나 누가 언제 바꿨는지를 남기지 않는다. ' +
      '전이 규칙을 정하려면 각 부서의 업무 순서를 먼저 정해야 한다 — 개발자가 순서를 지어내지 않는다.',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: '해외환자 관리 책임자 · 영양팀장 · 홍보 책임자',
    options: [
      {
        value: 'ENFORCE_WITH_HISTORY',
        label: '부서가 정한 전이 규칙 강제 + 변경 이력',
        effect: '정해진 순서 밖의 상태 변경을 거부하고 변경자·시각을 남긴다. 각 부서의 순서 정의와 이력 모델 개발이 필요하다.',
        enact: null,
      },
      {
        value: 'HISTORY_ONLY',
        label: '순서는 강제하지 않고 변경 이력만',
        effect: '어떤 상태로든 바꿀 수 있되 누가 언제 바꿨는지 남는다(이력 개발 필요).',
        enact: null,
      },
      {
        value: 'AS_IS',
        label: '현행 유지',
        effect: '상태·담당자를 순서와 이력 없이 바꿀 수 있다.',
        enact: null,
      },
    ],
    statusQuo:
      '2026-09-15 코드 확인 — ① 해외환자 케이스: `crm.service.ts` `updateForeignCase` 가 `status`·`assignedTo` 를 받아 그대로 저장한다(전이 규칙·담당자 변경 이력 없음 · 호출 화면 없음). ' +
      '② 급양: `nutrition.service.ts` `updateProductionStatus` 가 어떤 상태든 받는다 — 화면은 계획→조리시작→조리완료 순서 버튼만 보이지만 API 는 `DONE` 을 바로 받는다(검식·HACCP 기록 선행 없음). ' +
      '③ 포털 배너: `deleteBanner` 는 `isActive=false` 로 숨기고, `updateBanner` 가 `isActive` 를 받아 다시 켤 수 있다(복원 경로·이력 없음 · 호출 화면 없음).',
    verifyHow: [
      '`grep -n "async updateForeignCase" -A20 apps/api/src/modules/crm/crm.service.ts`',
      '`grep -n "async updateProductionStatus" -A8 apps/api/src/modules/nutrition/nutrition.service.ts`',
      '`grep -n "async updateBanner\\|async deleteBanner" apps/api/src/modules/crm/crm.service.ts`',
    ],
    afterDecision: '이력·규칙을 택하면 모듈별 개발이 남는다. 지난 상태 변경은 소급하지 않는다.',
    owner: '해외환자센터 · 영양팀 · 홍보팀',
    dueBy: 'NONE',
    // 개시 뒤로 둘 수 있는 근거: 급양은 화면이 순서대로만 부르고, 나머지 두 경로는 호출 화면이 없다.
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'policy.reporting.externalSubmitterIdentity',
    track: 'NOTIFY',
    title: '대외 보고(KONIS 감염 감시)의 제출자를 요청 본문에서 받을 것인가, 인증 사용자로 고정할 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '대외 보고의 제출자는 보고 책임자 기록이다. 본문에서 받으면 아무 이름·id 로나 제출자가 기록될 수 있고, 인증 사용자로 고정하면 감염관리실이 담당의 대신 올리는 대리 제출이 막힌다.',
    legalReview: ['감염병 신고·보고 의무자 요건'],
    approvalPath: 'CODE_CHANGE',
    authority: '감염관리위원회 · 감염관리 책임자',
    options: [
      {
        value: 'AUTH_USER',
        label: '인증 사용자로 고정',
        effect: '로그인한 사용자만 제출자로 기록된다. 대리 제출은 막힌다.',
        enact: null,
      },
      {
        value: 'PROXY_WITH_BOTH',
        label: '대리 제출 허용 + 입력자·보고 책임자를 따로 기록',
        effect: '입력한 사용자와 보고 책임자를 모두 남긴다(개발 필요).',
        enact: null,
      },
      {
        value: 'AS_IS',
        label: '현행 — 본문 값 사용',
        effect: '제출자 값이 요청 본문을 따른다.',
        enact: null,
      },
    ],
    statusQuo:
      '`apps/api/src/modules/infection-control/infection-control.service.ts` 가 KONIS 보고의 `submittedBy` 를 요청 본문 값으로 받는다(2026-09-15 코드 확인). ' +
      'KONIS 연동 채널은 아직 구축되지 않아 보고는 "미전송·미저장"으로 응답한다 — 지금은 외부로 나간 기록이 없다.',
    verifyHow: ['`grep -n "submittedBy" apps/api/src/modules/infection-control/infection-control.service.ts`'],
    afterDecision: '선택에 따라 제출자 결정 로직 개발이 남는다. KONIS 채널 구축(대외 발신 3조건) 전에 정하면 채널 개발에 함께 반영된다.',
    owner: '감염관리실',
    dueBy: 'NONE',
    // 개시 뒤로 둘 수 있는 근거: 채널 미구축으로 대외 보고가 실제로 나가지 않는다. 채널을 켜기 전에는 정해야 한다(afterDecision).
    goLive: 'CAN_FOLLOW',
  },
];
