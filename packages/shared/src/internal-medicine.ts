/**
 * 내과 세부전문과(subspecialty) 어휘 정본 (2026-08-18 · 이연 회수 T2-3)
 *
 * 🔴 실측으로 **같은 개념에 어휘가 네 벌**이었다(P12):
 *   ① 코드 정본 — schema.prisma 주석 · 서버 `getScoreTrend` 지표표 · 조회 화면 2곳:
 *      `GASTRO` · `ENDOCRINE`
 *   ② 리치니스 시드(`prisma/seeds/dept-richness.ts`): `GASTROENTEROLOGY` · `ENDOCRINOLOGY`
 *   ③ 진료 입력 화면: **한글**(`소화기내과` …) — 실제로 그 값으로 저장된 행이 있었다
 *   ④ (그 결과) 운영 실측 20명 표본에서 `ENDOCRINOLOGY` 8 · `GASTROENTEROLOGY` 7 · `소화기내과` 1
 *
 * 결과: 소화기·내분비 진료 기록이 **조회 화면 필터(subspecialty=GASTRO)에서 사라지고**,
 * 지표 추이표에도 걸리지 않아 해당 과 점수 시계열이 기본 필드로 폴백했다.
 * 저장한 사람이 자기가 저장한 기록을 못 보는 상태였다.
 *
 * 규약: 저장·조회·지표표·시드는 **이 표의 key 만** 쓴다. 화면 표기는 `label` 로만 한다.
 */

export interface ImSubspecialtyDef {
  key: string;
  /** 화면 표기(한글) — 저장값으로 쓰지 않는다 */
  label: string;
}

export const IM_SUBSPECIALTIES: ImSubspecialtyDef[] = [
  { key: 'CARDIOLOGY', label: '심장내과' },
  { key: 'PULMONOLOGY', label: '호흡기내과' },
  { key: 'GASTRO', label: '소화기내과' },
  { key: 'ENDOCRINE', label: '내분비내과' },
  { key: 'NEPHROLOGY', label: '신장내과' },
  { key: 'HEMATO_ONCOLOGY', label: '혈액종양내과' },
  { key: 'INFECTIOUS', label: '감염내과' },
  { key: 'RHEUMATOLOGY', label: '류마티스내과' },
];

export const IM_SUBSPECIALTY_KEYS: string[] = IM_SUBSPECIALTIES.map((s) => s.key);

const LABEL_BY_KEY: Record<string, string> = Object.fromEntries(IM_SUBSPECIALTIES.map((s) => [s.key, s.label]));

/** 저장값 → 화면 표기. 모르는 값은 **원문 그대로** 보여준다(무채색으로 삼키지 않는다). */
export function imSubspecialtyLabel(key: string | null | undefined): string {
  if (!key) return '미지정';
  return LABEL_BY_KEY[key] ?? key;
}

export function isImSubspecialty(key: string | null | undefined): boolean {
  return !!key && IM_SUBSPECIALTY_KEYS.includes(key);
}
