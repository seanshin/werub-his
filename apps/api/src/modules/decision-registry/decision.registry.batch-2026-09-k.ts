/**
 * 결정 등록부 배치 K (2026-09-29) — **직종별 오더 입력 범위**(정본 shared `order-entry-scope`).
 *
 * 코드는 보수적 기본값을 갖고(간호사: 간호 오더 본인 권한·그 밖 의사 승인 / 치료사·방사선사·임상병리사: 자기 유형만 의사 승인 /
 * 영양사·약사: 없음), 원내 설정 `order.entryScope` 로 **낮추기만** 할 수 있다. 무엇을 본인 권한으로 둘지는 원내 규정이라
 * 코드가 정할 수 없다. `statusQuo` 는 배포한 코드를 다시 읽고 적었다.
 *
 * 🔴 등재 ≠ 결정. 선택지와 결과만 적고 권고하지 않는다. 모든 선택지의 `enact` 는 `null`(CODE_CHANGE 또는 설정 값 조정).
 * 🔴 법령은 "적용 여부 검토"로만 적는다 — 조문은 조사하지 않았으므로 적지 않는다(판정 규칙 §7).
 */
import type { DecisionDef } from './decision.registry';

const REF = '`packages/shared/src/order-entry-scope.ts` · `docs/05-reference/order-entry-roles-and-context.md` §1';

export const DECISION_BATCH_2026_09_K: DecisionDef[] = [
  {
    key: 'order.entryScope.policy',
    track: 'CLINICAL',
    title: '의사가 아닌 직종이 어떤 오더를 본인 권한으로, 어떤 오더를 의사 승인으로 등록하게 할 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '간호사·물리치료사 등도 오더 화면을 쓴다. 누가 입력했고 누가 책임지는지는 기록에 남지만(입력자 createdBy · 책임자 prescriberId), ' +
      '어느 유형을 본인 권한으로 둘지(책임자=입력자)는 원내 업무 규정이다. 기본값은 보수적이며, 원내 설정으로 낮출 수는 있어도 ' +
      '비의사의 약·검사·영상 등을 본인 권한으로 올릴 수는 없다(코드가 막는다).',
    legalReview: ['비의사 직종의 오더 입력·책임 범위 — 원내 법무 검토', '의료기사 업무의 "의사 지도" 요건 적용 여부 — 원내 법무 검토'],
    approvalPath: 'CODE_CHANGE',
    authority: '진료부 · 간호부 · 진료지원부 · 법무',
    options: [
      { value: 'KEEP_DEFAULT', label: '기본값 유지 — 간호사 간호 오더만 본인 권한, 나머지는 의사 승인', effect: '간호 중재(간호지시)는 간호사 책임으로 등록된다. 약·검사·영상·치료 등은 지정 의사의 폰 승인 후 의사 명의로 저장된다.', enact: null },
      { value: 'ALL_APPROVAL', label: '간호 오더도 의사 승인 — 비의사의 본인 권한 오더 없음', effect: '설정 order.entryScope 에 {"NURSE":{"NURSING":"DELEGATE"}} 를 넣는다. 간호 중재 기록마다 의사 승인이 필요해진다.', enact: null },
      { value: 'NARROW_NURSE_DELEGATE', label: '간호사 대리입력(구두처방)을 약·검사로 한정', effect: '영상·치료·식이·활동의 간호사 대리입력을 막는다(설정으로 NONE). 그 유형은 의사가 직접 입력한다.', enact: null },
    ],
    statusQuo:
      '코드 기본값 적용 중(설정 order.entryScope 빈 객체). 간호사: NURSING=본인 권한, 그 밖 6유형=의사 승인. ' +
      '물리·작업·언어치료사: THERAPY 만 의사 승인. 방사선사: IMAGING 만 · 임상병리사: LAB 만 의사 승인. 영양사·약사: 입력 불가. ' +
      '의사·관리자: 전 유형 본인. 직종 미지정 LAB_TECH 는 임상병리사로 판정한다.',
    verifyHow: ['GET /api/v1/prescriptions/entry-scope/me 로 계정별 모드를 본다', REF, '`apps/api/test/prescription/order-entry-scope.spec.ts`'],
    afterDecision: 'KEEP_DEFAULT 외에는 설정 order.entryScope 값 조정(코드 변경 불필요). 상한을 넘는 요구는 코드 변경이 아니라 법무 검토가 먼저다.',
    owner: '진료부 · 간호부',
    dueBy: 'BEFORE_GO_LIVE',
    goLive: 'REQUIRED_BEFORE',
  },
  {
    key: 'order.entryScope.dietitian',
    track: 'CLINICAL',
    title: '영양사가 식이 오더를 입력하게 할 것인가(의사 승인으로)',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '영양사 역할(NUTRITION)은 오더 권한이 없는 것으로 정의돼 있어 기본값은 입력 불가다. 치료식 변경 요청을 영양사가 직접 입력하고 ' +
      '의사가 승인하게 할지는 원내 업무 흐름의 문제다.',
    legalReview: ['치료식 처방의 주체와 영양사 입력 범위 — 원내 검토'],
    approvalPath: 'CODE_CHANGE',
    authority: '진료부 · 영양팀',
    options: [
      { value: 'NONE', label: '입력 불가 유지(현행)', effect: '식이 오더는 의사·간호사(의사 승인)만 입력한다.', enact: null },
      { value: 'DIET_DELEGATE', label: '영양사도 식이 오더를 의사 승인으로 입력', effect: '코드 변경이 필요하다 — 처방 입력 EP 에 NUTRITION 역할을 열고 기본 범위 DIETITIAN.DIET 를 DELEGATE 로.', enact: null },
    ],
    statusQuo: '영양사(NUTRITION) 기본 범위는 빈 표(전 유형 입력 불가). 처방 입력 EP @Roles 에 NUTRITION 이 없다.',
    verifyHow: [REF, '`apps/api/src/modules/prescription/prescription.controller.ts` 의 처방 생성 @Roles'],
    afterDecision: 'DIET_DELEGATE 면 @Roles 와 기본 범위 코드 변경.',
    owner: '영양팀',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
];
