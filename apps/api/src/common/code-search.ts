/**
 * 코드 검색 어휘 정본 — 정규화·약어 판정·좁힘 규칙.
 *
 * 발단(2026-08-26 운영 실측): 약어를 치면 **없는 것이 아니라 전혀 다른 것**이 나왔다.
 *   `AMI` → 248건(1위 "일반 성인 의학적 검사" = ex**AMI**nation)
 *   `DM`  → 271건(1위 "신생아 약물 중독"     = medica**M**ent)
 *   `HTN` →  11건(전부 "**벼락**"            = lig**HTN**ing)
 * 🔴 0건보다 나쁘다 — 화면이 자신 있게 틀린 답을 준다("아는 것과 모르는 것을 뒤바꿔 말함").
 */

/** 매칭 키 — 소문자 + 공백·하이픈·점·언더바 제거. 표시는 원문(`term`)을 쓴다 */
export function normalizeTerm(raw: string): string {
  return (raw ?? '').toLowerCase().replace(/[\s\-._/]/g, '');
}

/**
 * 부분일치가 위험한 질의인가 — **짧은 라틴문자**.
 * 한글은 형태소가 길어 부분일치 노이즈가 적다(`당뇨`→214건 전부 당뇨병 계열·실측).
 * 라틴 2~4자는 영문 병명 안에 통째로 박혀 있는 경우가 흔하다.
 */
export function isShortLatinQuery(q: string): boolean {
  const t = (q ?? '').trim();
  return /^[A-Za-z]{2,4}$/.test(t);
}

/**
 * 단어 경계 정규식(Postgres `~*`). `AMI` 가 `examination` 에 걸리지 않게 한다.
 * 🔴 정규식 메타문자를 이스케이프한다 — 사용자 입력이 그대로 들어간다.
 */
export function wordBoundaryPattern(q: string): string {
  const esc = (q ?? '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return `\\y${esc}\\y`;
}

/**
 * 검색이 어떻게 좁혀졌는지 — 응답으로 나가 화면이 **그대로** 말한다.
 * 🔴 좁혔으면서 좁혔다고 말하지 않으면, 없는 것과 못 찾은 것이 같아진다.
 */
export const NARROW_NOTE =
  '짧은 영문 약어라 이름 안에 묻힌 우연한 일치를 뺐습니다(단어 단위로만 찾음).';
export const NARROW_EMPTY_NOTE =
  '단어 단위로는 찾지 못했습니다. 풀어서(예: HTN → 고혈압) 찾거나, 아래에서 이름 일부 일치까지 넓혀 보세요.';
export const WIDENED_NOTE =
  '이름 일부 일치까지 넓혔습니다 — 약어와 관계 없는 결과가 섞여 있습니다.';

/** 동의어 종류 표시 정본 — 화면이 로컬로 다시 정의하지 않는다 */
export const SYNONYM_KINDS = ['ABBREVIATION', 'COLLOQUIAL', 'ENGLISH', 'LEGACY', 'TYPO'] as const;
export type SynonymKind = (typeof SYNONYM_KINDS)[number];
export const SYNONYM_KIND_LABEL: Record<SynonymKind, string> = {
  ABBREVIATION: '약어',
  COLLOQUIAL: '구어',
  ENGLISH: '영문',
  LEGACY: '옛 표기',
  TYPO: '흔한 오타',
};

export const SYNONYM_STATUSES = ['PROPOSED', 'APPROVED', 'REJECTED'] as const;
export type SynonymStatus = (typeof SYNONYM_STATUSES)[number];
export const SYNONYM_STATUS_LABEL: Record<SynonymStatus, string> = {
  PROPOSED: '검토 전',
  APPROVED: '사용 중',
  REJECTED: '반려',
};

export const SYNONYM_SOURCE_TABLES = [
  'DiagnosisCode',
  'ProcedureCode',
  'MedicationCode',
  'LabTestCode',
] as const;
export type SynonymSourceTable = (typeof SYNONYM_SOURCE_TABLES)[number];
