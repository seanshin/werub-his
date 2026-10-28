/**
 * 결정 방식 — **이 결정은 어떻게 정해지고, 정하면 시스템에서 무엇이 일어나는가**(2026-10-11 사용자
 * "설정, 위원회 기록, 자동 선택 가능 등의 구분이 더 디테일하고, 설정 내용도 더 디테일해야 함").
 *
 * 🔴 손으로 붙이지 않는다 — 서버가 등록부(처리 경로·집행 바인딩·선택지의 집행 대상)에서 **파생**한다.
 *    손으로 붙이면 등록부가 바뀔 때 갈라진다(실제로 "설정만 바꾼다"고 적힌 결정이 바인딩이 없어 무동작이었다).
 */
export const DECISION_MECHANISMS = [
  'AUTO_APPLY',        // 권한자가 기록하면 엔진이 설정을 바로 바꾼다
  'COMMITTEE_APPLY',   // 위원회가 의결하면 엔진이 설정을 바꾼다
  'COMMITTEE_RECORD',  // 위원회 의결을 기록한다 — 시스템 설정은 바뀌지 않는다(이행은 사람)
  'CONFIRM_ONLY',      // 권한자 확인 기록 — 바꿀 설정 없음 · 후속 결정을 연다
  'MIXED',             // 선택에 따라 설정 반영 또는 개발 반영
  'DEV_APPLY',         // 개발이 반영한다(코드·스키마) — 기록은 결정의 증빙
  'PER_EVENT',         // 업무 화면에서 건별로 — 이 화면에서 미리 정하지 않는다
  'UNBOUND',           // 🔴 선택지가 설정 값을 들고 있는데 반영 바인딩이 없다(등록부 결함 — 가드가 0을 강제)
] as const;
export type DecisionMechanism = (typeof DECISION_MECHANISMS)[number];

export const DECISION_MECHANISM_META: Record<DecisionMechanism, { label: string; who: string; effect: string; auto: boolean }> = {
  AUTO_APPLY: { label: '의사결정하면 자동 반영', who: '권한자가 이 화면에서 의사결정', effect: '고른 선택지의 설정 값을 결정 엔진이 바로 바꾼다(실패하면 반영 실패로 남는다)', auto: true },
  COMMITTEE_APPLY: { label: '의결하면 자동 반영', who: '위원회가 안건으로 의결', effect: '의결한 선택지의 설정 값을 결정 엔진이 바꾼다 — 이 화면의 의사결정만으로는 바뀌지 않는다', auto: true },
  COMMITTEE_RECORD: { label: '위원회 의결(설정 변경 없음)', who: '위원회가 안건으로 의결', effect: '의결이 곧 의사결정이다 — 바꿀 설정이 없어 이행(규정·업무 변경)은 사람이 한다', auto: false },
  CONFIRM_ONLY: { label: '확인 의사결정', who: '권한자가 근거와 함께 의사결정', effect: '바꿀 설정이 없다 — 확인 사실이 남고 이 결정을 선행으로 둔 후속 결정이 열린다', auto: false },
  MIXED: { label: '선택에 따라 설정 또는 개발', who: '위원회(안건) 또는 권한자 의사결정', effect: '어떤 선택지는 설정 값을 바꾸고(의결 시 자동), 어떤 선택지는 개발 반영이 필요하다', auto: false },
  DEV_APPLY: { label: '개발 반영', who: '결정 주체가 의사결정 · 개발팀이 반영', effect: '코드·스키마 변경이라 배포로만 반영된다 — 의사결정은 반영의 근거다', auto: false },
  PER_EVENT: { label: '건별 판단', who: '업무 화면의 담당 직원', effect: '업무 화면의 승인 창에서 건마다 정한다 — 이 화면에서 미리 정하지 않는다', auto: false },
  UNBOUND: { label: '반영 바인딩 없음(등록부 결함)', who: '—', effect: '🔴 선택지가 설정 값을 들고 있는데 반영 경로가 없다 — 골라도 바뀌지 않는다', auto: false },
};

/** 설정 출처 — 서버 `ConfigRuntimeService` 와 같은 어휘 */
export type DecisionSettingSource = 'env' | 'db' | 'default' | 'unset';
export const DECISION_SETTING_SOURCE_LABEL: Record<DecisionSettingSource, string> = {
  env: '환경변수(배포 값)', db: '저장된 값', default: '코드 기본값', unset: '미설정',
};
