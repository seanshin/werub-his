/**
 * 결정 등록부 배치 S (2026-10-01) — **간호기록 '늦은 기록' 유예**.
 * 코드는 관찰 시각의 근무조가 끝난 뒤에 쓴 간호기록을 '늦은 기록'으로 표시한다(막지 않는다 · 저장값이 아니라 파생).
 * 종료 후 몇 분까지를 정상 작성으로 볼지는 원내 기록 규정이다 — 설정 `nursing.lateEntry.graceMinutes`.
 * 🔴 등재 ≠ 결정 — 선택지와 결과만, 권고 없음.
 */
import type { DecisionDef } from './decision.registry';

const REF = '`apps/api/src/modules/nursing/nursing.service.ts` lateEntryRule()·getNotes() · shared `isLateNursingEntry` · `docs/01-plan/features/nurse-station-shift-handover.plan.md`';

export const DECISION_BATCH_2026_09_S: DecisionDef[] = [
  {
    key: 'nursing.lateEntry.graceMinutes',
    track: 'CLINICAL',
    title: '근무조가 끝난 뒤 몇 분 안에 쓴 간호기록까지 정상 작성으로 볼 것인가(늦은 기록 유예)',
    layer: 'INTERNAL_COMMITTEE',
    why:
      '교대 직후에 직전 근무 관찰을 마무리해 적는 일은 흔하다. 유예가 없으면 그런 기록이 전부 "늦은 기록"으로 표시돼 표식이 흔해지고 뜻을 잃는다. ' +
      '유예가 길면 실제로 늦게 적은 기록이 가려진다. 표시만 바뀌고 기록을 막지는 않는다.',
    legalReview: [],
    approvalPath: 'AUTHORIZED_ROLE',
    authority: '간호부 · 의무기록위원회',
    options: [
      { value: 'UNSET', label: '현행 — 미설정(유예 0 · 근무조 종료 시각 기준)', effect: '화면이 "원내 규정 미설정"이라 밝힌다.', enact: null },
      { value: 'MIN_30', label: '30분', effect: '설정 nursing.lateEntry.graceMinutes = 30', enact: { key: 'nursing.lateEntry.graceMinutes', newValue: 30 } },
      { value: 'MIN_60', label: '60분', effect: '설정 nursing.lateEntry.graceMinutes = 60', enact: { key: 'nursing.lateEntry.graceMinutes', newValue: 60 } },
    ],
    // 🔴 2026-10-11 — 선택지가 설정 값을 들고 있었는데 바인딩(configKey·enactKind)이 없어 **골라도 설정이 바뀌지 않았다**
    //    (결정 기록은 "확인이 기록됐다 — 바꿀 설정 없음"이라 말했다 · afterDecision 의 "설정만 바꾼다"와 모순). 결정 방식 가드가 다시 막는다.
    configKey: 'nursing.lateEntry.graceMinutes',
    enactKind: 'CONFIG_CHANGE',
    statusQuo: '설정 nursing.lateEntry.graceMinutes 미설정(null) — 관찰 시각의 근무조 종료 시각 이후에 작성하면 늦은 기록 표시.',
    verifyHow: [REF, '설정 `nursing.lateEntry.graceMinutes`'],
    afterDecision: '값을 정하면 설정만 바꾼다(코드 변경 불필요) · 과거 기록도 다음 조회부터 새 기준으로 표시된다(파생값).',
    owner: '간호부',
    dueBy: 'NONE',
    goLive: 'CAN_FOLLOW',
  },
];
