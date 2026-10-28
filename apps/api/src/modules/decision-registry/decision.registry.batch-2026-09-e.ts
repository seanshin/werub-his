/**
 * 결정 등록부 배치 E (2026-09-15) — 요청 본문 DTO 5차 배치(B5)가 **막지 않고 기록한 절차 우회** 4건.
 *
 * 🔴 등재 ≠ 결정. 선택지와 결과만 적고 권고·기본 선택은 하지 않는다(판정 규칙 6장).
 *    배치 D 와 같이 어느 항목도 `enactKind` 를 갖지 않고 선택지의 `enact` 는 전부 `null` 이다
 *    (기록이 시스템을 자동으로 바꾸지 않는다 · 반영은 `afterDecision` 의 개발 몫).
 * 🔴 B5 는 DTO 로 "형(型)"만 막았다. 아래 네 필드는 DTO 가 허용한 값으로 일어나는 우회라
 *    검증 추가만으로 막으면 임상 절차를 코드가 대신 정하게 된다 — 그래서 사람 결정으로 올린다.
 * 🔴 같은 성격을 묶었다(4건 → 2결정):
 *    ① 임상 게이트를 넘는 권한(검진 결과서 강제 서명 `force` · 사전오더 승인 DUR 오버라이드 `overrideDur`)
 *    ② 행위자·책임 의사를 요청 본문으로 대리 지정(검진 스테이션 `operatorId` · 사전오더 `doctorId`)
 *    마약류 처방자(`policy.controlledSubstance.prescriberSource`, 배치 C)·대외 보고 제출자
 *    (`policy.reporting.externalSubmitterIdentity`, 배치 D)는 같은 모양이지만 대상 원장이 달라 합치지 않는다.
 * 🔴 법령 수치·조문은 적지 않는다(검토 항목 이름만).
 */
import type { DecisionDef } from './decision.registry';

export const DECISION_BATCH_2026_09_E: DecisionDef[] = [
  {
    key: 'policy.clinical.gateOverrideAuthority',
    track: 'CLINICAL',
    title: '검진 결과서 강제 서명과 사전오더 승인 DUR 오버라이드를 누가, 어떤 기록을 남기고 할 수 있게 할 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '두 경로 모두 임상 안전 게이트(서명 자격·작성자≠서명자·검토 완료 / DUR 차단 경고)를 넘는다. ' +
      '막으면(오버라이드 없음) 게이트가 잘못 막은 건을 처리할 길이 없어 방치되고, 두면 게이트를 넘은 기록이 정상 기록과 섞인다 — ' +
      '누가 넘을 수 있는지와 무엇을 남길지는 진료 소관 위원회 판단이다.',
    legalReview: ['건강검진 결과서 판정 의사 서명 요건', '의약품 안전사용 점검(DUR) 경고 무시 시 사유 기록'],
    approvalPath: 'CODE_CHANGE',
    authority: '의료질 관리위원회 · 약사위원회 · 건강검진센터장',
    options: [
      {
        value: 'CLINICIAN_WITH_RECORD',
        label: '자격 있는 의사만 + 오버라이드 표시·사유를 원장에 남김',
        effect: '강제 서명은 서명 자격이 있는 의사가 사유와 함께만 할 수 있고 결과서에 강제 서명임이 남는다. DUR 오버라이드도 의사만 가능하다(개발 필요).',
        enact: null,
      },
      {
        value: 'ADMIN_WITH_RECORD',
        label: '현 권한 유지 + 오버라이드 표시·사유를 원장에 남김',
        effect: '관리자 강제 서명·관리자 DUR 오버라이드를 그대로 허용하되, 강제 서명 여부와 사유를 결과서에 남긴다(개발 필요).',
        enact: null,
      },
      {
        value: 'AS_IS',
        label: '현행 유지',
        effect: '관리자는 사유 없이 강제 서명할 수 있고 결과서 기록은 정상 서명과 구분되지 않는다. DUR 오버라이드는 승인 권한자(의사·관리자)가 사유와 함께 할 수 있다.',
        enact: null,
      },
    ],
    statusQuo:
      '2026-09-15 코드 확인 — ① 검진: `checkup.service.ts` `signSummary` 는 `force=true` 면 ADMIN 만 허용하고, 그 경우 서명 자격(signerRoles)·4-eyes·검토 완료 게이트를 모두 건너뛴다. ' +
      '`CheckupSummary` 에는 강제 서명 여부·사유 필드가 없어 `signedBy`·`signedAt` 이 정상 서명과 같은 모양으로 남는다. 화면(`his-checkup/visit/[id]`)은 `force` 를 보내지 않는다(직접 API 호출로만 가능). ' +
      '② 사전오더: `pre-order.service.ts` `approve` 는 DUR ERROR 가 있으면 `overrideDur`+사유가 있어야 승인하고 `durOverrideReason`·`durOverrideBy`·`durOverrideAt` 을 처방에 남긴다. ' +
      '승인 EP 는 DOCTOR·ADMIN 에 열려 있어 관리자도 오버라이드할 수 있다. 승인 화면(`PreOrderBanner`)에는 오버라이드 입력이 없다. ' +
      '또한 승인 시점 DUR 재검증 호출이 실패하면 경고 없음으로 진행한다(로그만 남김).',
    verifyHow: [
      '`grep -n "async signSummary" -A40 apps/api/src/modules/checkup/checkup.service.ts`',
      '`grep -n "overrideDur\\|durOverride\\|재검증 실패" apps/api/src/modules/pre-order/pre-order.service.ts`',
      '`grep -n "@Roles" apps/api/src/modules/pre-order/pre-order.controller.ts`',
    ],
    afterDecision: '🔴 현행 유지가 아니면 결과서 모델(강제 서명 표시·사유)과 권한 판정 개발이 남는다. 이미 서명·승인된 기록은 소급하지 않는다.',
    owner: '건강검진센터 · 약제부 · 의료질 관리실',
    dueBy: 'NONE',
    // 개시 뒤로 둘 수 있는 근거: 두 오버라이드 모두 화면이 보내지 않아 일상 업무에서는 발생하지 않는다(직접 API 호출 시에만).
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'policy.clinical.actorAttribution',
    track: 'CLINICAL',
    title: '검진 스테이션 시행자와 사전오더 책임 의사를 요청 본문으로 다른 사람으로 지정하게 둘 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '시행자·책임 의사는 "누가 했는가/누가 책임지는가" 기록이다. 본문 값을 받으면 실제 입력자와 다른 사람이 기록될 수 있고, ' +
      '인증 사용자로 고정하면 보조 인력이 담당 의사 대신 입력하는 흐름("입력은 열되 책임은 의사")이 막힌다.',
    legalReview: ['진료기록 작성자·처방의 기록 요건'],
    approvalPath: 'CODE_CHANGE',
    authority: '의료질 관리위원회 · 건강검진센터장',
    options: [
      {
        value: 'AUTH_USER',
        label: '인증 사용자로 고정',
        effect: '시행자·책임 의사는 로그인한 사용자로만 기록된다. 대리 입력은 막힌다(개발 필요).',
        enact: null,
      },
      {
        value: 'PROXY_WITH_BOTH',
        label: '대리 지정 허용 + 입력자와 지정 대상을 따로 기록',
        effect: '지정된 시행자·책임 의사와 실제 입력자를 모두 남기고, 지정 대상이 해당 역할인지 확인한다(개발 필요).',
        enact: null,
      },
      {
        value: 'AS_IS',
        label: '현행 — 본문 값 사용',
        effect: '본문에 값이 오면 그 사용자가 시행자·책임 의사로 기록되고 입력자는 따로 남지 않는다.',
        enact: null,
      },
    ],
    statusQuo:
      '2026-09-15 코드 확인 — ① 검진 스테이션: `checkup.controller.ts` `wsStart` 가 본문 `operatorId` 를 로그인 사용자보다 먼저 쓴다(`CheckupStationLog.operatorId`). ' +
      '완료(`wsComplete`)는 로그인 사용자로 덮어쓴다. 지정 대상의 역할 확인은 없다. ' +
      '② 사전오더: `pre-order.controller.ts` `create` 가 본문 `doctorId` 를 로그인 사용자보다 먼저 쓰고, 승인 시 그 값이 처방의 `prescriberId`(책임 처방의)가 된다. 지정 대상이 의사인지 확인하지 않는다. ' +
      '두 경로 모두 화면(`PreOrderTab` 등)은 이 필드를 보내지 않는다(직접 API 호출로만 가능).',
    verifyHow: [
      '`grep -n "operatorId" apps/api/src/modules/checkup/checkup.controller.ts apps/api/src/modules/checkup/checkup-station.service.ts`',
      '`grep -n "doctorId" apps/api/src/modules/pre-order/pre-order.controller.ts apps/api/src/modules/pre-order/pre-order.service.ts`',
    ],
    afterDecision: '선택에 따라 행위자 결정 로직(입력자 병기·역할 확인) 개발이 남는다. 이미 기록된 시행자·처방의는 소급하지 않는다.',
    owner: '건강검진센터 · 진료부 · 의료질 관리실',
    dueBy: 'NONE',
    // 개시 뒤로 둘 수 있는 근거: 두 필드 모두 화면이 보내지 않아 일상 업무에서는 로그인 사용자로 기록된다.
    goLive: 'CAN_FOLLOW',
  },
];
