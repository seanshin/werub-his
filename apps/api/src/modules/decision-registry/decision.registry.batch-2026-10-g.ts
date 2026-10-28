/**
 * 결정 등록부 배치 10-G(2026-10-11) — 결정 엔진의 보호 수준.
 *
 * 사용자 지시: "엔진 형태로 세팅 후에 변경되고, 전후 관계에도 영향을 주고, 보호하거나 설정에 영향을 줄 수 있어야 함".
 * 결정에 묶인 설정을 결정 경로 밖에서(범용 설정 화면) 바꾸는 것을 어디까지 허용할지는 원내 운영 정책이다 —
 * 보호 수준 자체도 결정으로 정한다(관리자가 설정 하나로 보호를 끄면 보호가 아니다).
 */
import type { DecisionDef } from './decision.registry';

export const DECISION_BATCH_2026_10_G: DecisionDef[] = [
  {
    key: 'governance.decisionConfigGuard',
    track: 'GOVERNANCE',
    title: '결정에 묶인 설정을 결정 경로 밖에서 바꾸는 것을 어디까지 허용할 것인가',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '결정이 설정을 바꾼 뒤에도 관리자는 범용 설정 화면에서 같은 값을 그대로 바꿀 수 있었다 — 결정 기록은 B 인데 시스템은 A 로 돌고, 어디에도 흔적이 없었다. 엔진은 이제 그 변경을 결정 이력에 남기고 "결정과 다름"을 표시한다. 막을지(결정·의결로만 바뀌게)는 운영 정책이다.',
    legalReview: [],
    approvalPath: 'COMMITTEE',
    authority: '운영위원회(OPS)',
    options: [
      { value: 'OFF', label: '기록하지 않는다', effect: '🔴 설정 화면 변경이 결정 이력에 남지 않는다 — 결정과 실제 값이 갈라져도 흔적이 없다(종전과 같다).', enact: { kind: 'CONFIG_CHANGE', target: { key: 'governance.decisionConfigGuard', newValue: 'OFF' } } },
      { value: 'WARN', label: '바꾸게 두고 기록한다(기본)', effect: '설정 화면에서 바꿀 수 있다. 변경은 그 결정의 이력에 "설정 직접 변경"으로 남고 결정 화면이 "결정과 다름"을 표시한다.', enact: { kind: 'CONFIG_CHANGE', target: { key: 'governance.decisionConfigGuard', newValue: 'WARN' } } },
      { value: 'BLOCK', label: '실결정에 묶인 설정은 막는다', effect: '🔴 실결정(개발 시드 아님)에 묶인 설정은 설정 화면에서 바꿀 수 없다 — 결정 기록·위원회 의결로만 바뀐다. 막힌 시도도 이력에 남는다.', enact: { kind: 'CONFIG_CHANGE', target: { key: 'governance.decisionConfigGuard', newValue: 'BLOCK' } } },
    ],
    statusQuo: '설정 `governance.decisionConfigGuard` 기본 WARN — 결정에 묶인 설정을 설정 화면에서 바꾸면 허용하되 결정 이력에 남긴다.',
    verifyHow: ['/admin/decisions 결정 이력 탭 — "설정 직접 변경" 사건', '설정 화면에서 결정에 묶인 키를 바꾼 뒤 결정 행의 "결정과 다름" 표시'],
    afterDecision: '의결 후 집행 엔진이 설정을 바꾼다. 개발 시드 결정에 묶인 설정은 BLOCK 이어도 막지 않는다(실결정이 아니다).',
    owner: '전산팀 · 운영위원회',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
];
