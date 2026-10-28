/**
 * 방사선 부작용 기록 본문(2026-10-07) — 화면 폼 → 서버 DTO(`AddToxicityDto`).
 *  · 종전 화면은 `{skin,fatigue,…}` 로 보내 전역 whitelist 가 등급을 전부 지웠다(주차·비고만 저장 — 성공 응답+등급 소실)
 *  · 등급은 고르기 전 미선택(null) — 0 은 "평가해서 없음"이고 미평가와 다른 사실이다. 고른 항목만 보낸다
 */
export const TOXICITY_ITEMS = [
  { key: 'skin', dto: 'skinGrade', label: '피부 반응' },
  { key: 'mucositis', dto: 'mucositisGrade', label: '점막염' },
  { key: 'fatigue', dto: 'fatigueGrade', label: '피로' },
  { key: 'nausea', dto: 'nauseaGrade', label: '오심/구토' },
  { key: 'pain', dto: 'painGrade', label: '통증' },
] as const;

export type ToxicityKey = (typeof TOXICITY_ITEMS)[number]['key'];
export type ToxicityForm = { week: number | null; notes: string } & Record<ToxicityKey, number | null>;

export const emptyToxicityForm = (): ToxicityForm => ({ week: null, skin: null, mucositis: null, fatigue: null, nausea: null, pain: null, notes: '' });

/** 주차가 있고 등급을 하나 이상 골랐을 때만 저장할 수 있다(빈 기록을 "부작용 없음"으로 남기지 않는다). */
export function toxicityFormReady(f: ToxicityForm): boolean {
  return f.week != null && f.week >= 1 && TOXICITY_ITEMS.some((i) => f[i.key] != null);
}

export function buildToxicityBody(f: ToxicityForm): Record<string, unknown> {
  const body: Record<string, unknown> = { week: f.week };
  for (const i of TOXICITY_ITEMS) if (f[i.key] != null) body[i.dto] = f[i.key];
  if (f.notes.trim()) body.notes = f.notes.trim();
  return body;
}
