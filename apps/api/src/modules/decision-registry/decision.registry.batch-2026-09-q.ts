/**
 * 결정 등록부 배치 Q (2026-09-30) — **PACU 퇴실 기준**.
 *
 * 이 병원 Aldrete 는 6항목(통증 포함) 0~12 인데 기준 9 는 5항목 0~10 척도의 관례값이다. 코드는 기준을 설정으로 열고
 * (미설정이면 기본 9 + "원내 기준 미설정" 표시), 0점 항목이 있으면 총점과 관계없이 미달로 본다(강제 퇴실은 사유 + 의사).
 * 척도 구성·기준값은 임상 판단이라 코드가 정하지 않는다. 🔴 등재 ≠ 결정 — 선택지와 결과만, 권고 없음.
 */
import type { DecisionDef } from './decision.registry';

const REF = '`apps/api/src/modules/pacu/pacu.service.ts` getMonitoringSettings()·discharge() · 설정 `pacu.aldrete.dischargeMin`·`pacu.padss.dischargeMin`';

export const DECISION_BATCH_2026_09_Q: DecisionDef[] = [
  {
    key: 'pacu.dischargeCriteria',
    track: 'CLINICAL',
    title: 'PACU 퇴실(병동·ICU) Aldrete 기준을 몇 점으로 할 것인가 — 6항목 0~12 척도에서',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '종전 기준 9 는 5항목(0~10) 수정 Aldrete 의 관례값인데 이 병원 척도는 통증을 더한 6항목 0~12 다. 같은 9 가 상대적으로 낮아, ' +
      '의식 0(무반응)인 환자도 총점 9 로 "퇴실가능"이 될 수 있었다. 코드는 0점 항목을 미달로 막아 두었지만(사유+의사로 강제 퇴실 가능) 기준값 자체는 원내 판단이다.',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: '마취통증의학과 · 간호부(회복실) · QI',
    options: [
      { value: 'KEEP_9_NO_ZERO', label: '현행 — 9점 이상 + 0점 항목 없음(기본값)', effect: '설정 미입력 — 화면이 "원내 기준 미설정(기본값)"이라 말한다.', enact: null },
      { value: 'MIN_10', label: '10점 이상 + 0점 항목 없음', effect: '설정 pacu.aldrete.dischargeMin = 10', enact: { key: 'pacu.aldrete.dischargeMin', newValue: 10 } },
      { value: 'MIN_11', label: '11점 이상 + 0점 항목 없음', effect: '설정 pacu.aldrete.dischargeMin = 11', enact: { key: 'pacu.aldrete.dischargeMin', newValue: 11 } },
      { value: 'FIVE_ITEM_SCALE', label: '5항목(0~10) 표준 척도로 바꾸고 9점', effect: '코드 변경 — 척도·화면·기록 형식 변경(통증은 NRS 로만 평가).', enact: null },
    ],
    statusQuo: '기준 = 설정 pacu.aldrete.dischargeMin(미설정 → 9, criteriaSource DEFAULT) · 0점 항목이 있으면 미달 · 미달 퇴실은 사유 + DOCTOR/ADMIN.',
    verifyHow: [REF],
    afterDecision: 'MIN_10/11 은 설정만 바꾼다 · FIVE_ITEM_SCALE 은 개발.',
    owner: '진료부',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    key: 'pacu.icuWardBedHold',
    track: 'CLINICAL',
    title: '수술 후 ICU 로 가는 입원 환자의 병동 병상을 비울 것인가, 붙들어 둘 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      'ICU 는 병동 입원과 별개 체계(ICU 병상·ICU 입실)라, PACU 에서 ICU 로 보내도 병동 병상은 그대로 점유된다. 비우면 ICU 에서 돌아올 자리가 없고, ' +
      '붙들면 병동 병상 가용이 줄어든다. 자동으로 비우는 방향은 사람 판단이다.',
    legalReview: [],
    approvalPath: 'CODE_CHANGE',
    authority: '간호부 · 원무팀(병상 관리) · 진료부',
    options: [
      { value: 'HOLD', label: '현행 — 병동 병상 유지(PACU 퇴실 기록에 붙들린 병상을 남김)', effect: 'destination.wardBedHeld 에 병상이 기록된다. 병상 관리가 수동으로 판단한다.', enact: null },
      { value: 'RELEASE', label: 'ICU 입실 때 병동 병상을 비운다(청소 대기)', effect: '코드 변경 — 퇴실 트랜잭션에서 병상 CLEANING·배정 이력 닫기. ICU 퇴실 때 새로 배정해야 한다.', enact: null },
    ],
    statusQuo: 'PACU → ICU 퇴실은 ICU 입실만 잇고 병동 입원의 병상은 건드리지 않는다(destination.wardBedHeld = 병상 id).',
    verifyHow: ['`apps/api/src/modules/pacu/pacu.service.ts` discharge() · `docs/01-plan/features/pacu-discharge-destination.plan.md`'],
    afterDecision: 'RELEASE 면 퇴실 트랜잭션에 병상 반납 추가 개발.',
    owner: '간호부',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
  {
    // 2026-10-01 추가 — 회복실 활력 경보 임계 설정화
    key: 'pacu.vitalAlertThresholds',
    track: 'CLINICAL',
    title: '회복실(PACU) 활력 경보 기준을 몇으로 할 것인가 — 병동 활력 기준보다 엄격하게 둘 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '회복실은 마취 각성 중이라 병동 활력 정본(SpO2 90·HR 40/130·RR 30)보다 좁게 본다 — 현재 기본값은 SpO2 92 미만·HR 50 미만/120 초과·RR 8 미만/24 초과·SBP 90 미만/180 초과·BT 35 미만/38.5 이상이다. ' +
      '기준이 넓으면 놓치고 좁으면 경보가 잦아 무시된다. 값은 마취통증의학과·회복실 간호가 정할 일이라 코드가 정하지 않는다.',
    legalReview: [],
    approvalPath: 'AUTHORIZED_ROLE',
    authority: '마취통증의학과 · 간호부(회복실) · 환자안전위',
    options: [
      { value: 'KEEP_DEFAULT', label: '현행 — 코드 기본값(미설정)', effect: '화면이 "원내 기준 미설정 — 기본값 적용"이라 말한다.', enact: null },
      { value: 'SET_CUSTOM', label: '원내 값을 정해 설정한다', effect: '설정 pacu.vitalAlertThresholds 에 바꿀 키만 넣는다(코드 변경 불필요) · 범위 밖·역전 값은 버려지고 화면이 밝힌다.', enact: null },
    ],
    statusQuo: '설정 pacu.vitalAlertThresholds 미설정(null) — 코드 기본값(PACU_ALERT_DEFAULTS)으로 판정·소견 문구는 숫자 없이 "기준 미만/초과".',
    verifyHow: [REF, '설정 `pacu.vitalAlertThresholds` · `GET /api/v1/pacu/settings` 의 alertThresholds·alertSource·alertDroppedKeys'],
    afterDecision: '값을 정하면 설정만 바꾼다. 이미 저장된 활력 소견은 소급하지 않는다(일어난 판정).',
    owner: '진료부',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
];
