/**
 * 감시자 발견 항목의 **사람 판정** 어휘 정본.
 *
 * 🔴 판정은 발견을 없애지 않는다 — 스윕은 계속 세고, 판정은 그 숫자에 대한
 *    사람의 해석 기록이다(기록 ≠ 적용). 화면·API·백필이 전부 이 목록 하나를 쓴다.
 * 🔴 판정 당시 건수(valueAtJudgment)를 함께 저장한다 — 이후 값이 늘면
 *    그 판정은 새 행을 덮지 못한다("판정 이후 증가"로 되돌린다).
 */

export const SENTINEL_JUDGMENT_VERDICTS = [
  'SEED_ARTIFACT',
  'FIXED_RESIDUAL',
  'REAL_DEFECT',
  'UNDETERMINED',
] as const;

export type SentinelJudgmentVerdict = (typeof SENTINEL_JUDGMENT_VERDICTS)[number];

export const SENTINEL_JUDGMENT_LABEL: Record<SentinelJudgmentVerdict, string> = {
  SEED_ARTIFACT: '시드·백필 아티팩트',
  FIXED_RESIDUAL: '코드 회수됨 · 잔여 행 보존',
  REAL_DEFECT: '실결함 — 회수 필요',
  UNDETERMINED: '원인 미특정 — 보존',
};

/** 화면 도움말 — 각 판정이 무엇을 뜻하고 무엇을 뜻하지 않는지 */
export const SENTINEL_JUDGMENT_EFFECT: Record<SentinelJudgmentVerdict, string> = {
  SEED_ARTIFACT:
    '가상 병원 시드/백필 데이터의 품질 결함이다. 데이터를 코드로 교정하지 않으며, 실환자 전환 시 시드 격리로 소멸한다.',
  FIXED_RESIDUAL:
    '원인 코드는 이미 회수됐고 남은 행은 과거 기록이라 보존한다. 값이 다시 늘면 회수가 불완전한 것이다.',
  REAL_DEFECT:
    '실결함이다. 판정이 곧 수정이 아니다 — 회수 작업은 별도로 진행하고, 값이 0이 되면 스윕이 해결로 기록한다.',
  UNDETERMINED:
    '원인을 특정하지 못했다. 원인을 지어내지 않고 보존한다 — 새 근거가 생기면 재판정한다.',
};

/** 판정 출처 — SCREEN(관리 화면에서 기록) | DOC(기획서 판정 1·2차 문서 이관) */
export const SENTINEL_JUDGMENT_SOURCES = ['SCREEN', 'DOC'] as const;
export type SentinelJudgmentSource = (typeof SENTINEL_JUDGMENT_SOURCES)[number];

export const SENTINEL_JUDGMENT_SOURCE_LABEL: Record<SentinelJudgmentSource, string> = {
  SCREEN: '화면 기록',
  DOC: '문서 이관',
};
