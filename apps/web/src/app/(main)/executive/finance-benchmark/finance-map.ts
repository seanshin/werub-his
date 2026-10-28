/**
 * 경영성과 지도 부호화 정본(2D·3D 공용) — 기획 `docs/01-plan/features/finance-map-visual-3d.plan.md`.
 *
 * 한 부호화에 뜻 하나: 크기 = 규모(의료수익) · 색 = 의료이익률(6단 발산) · 모양 = 종별.
 * 🔴 산출 불가(의료수익 없음·0 이하)는 회색 — 0% 처럼 보이게 칠하지 않는다.
 */

/** 표식 모양 — 종별(HASPA 표기)에서 */
export type MarkerShape = 'tertiary' | 'general' | 'hospital' | 'longterm' | 'psych' | 'kmed' | 'other';
export function markerShape(hospitalType: string | null | undefined): MarkerShape {
  switch (hospitalType) {
    case '상급종합병원': return 'tertiary';
    case '종합병원': return 'general';
    case '병원': return 'hospital';
    case '요양병원': return 'longterm';
    case '정신병원': return 'psych';
    case '한방병원': return 'kmed';
    default: return 'other';
  }
}
export const MARKER_SHAPES: MarkerShape[] = ['tertiary', 'general', 'hospital', 'longterm', 'psych', 'kmed', 'other'];

/** 의료이익률 6단 — 경계는 이익률(비율) · 아래 경계 포함 */
export const MARGIN_BINS = [
  { key: 'm10', max: -0.10, color: '#be123c' },  // ≤ −10%
  { key: 'm3', max: -0.03, color: '#f43f5e' },   // −10 ~ −3%
  { key: 'm0', max: 0, color: '#fda4af' },       // −3 ~ 0%
  { key: 'p3', max: 0.03, color: '#99f6e4' },    // 0 ~ 3%
  { key: 'p10', max: 0.10, color: '#14b8a6' },   // 3 ~ 10%
  { key: 'p10+', max: Infinity, color: '#0f766e' }, // ≥ 10%
] as const;
export const MARGIN_NA_COLOR = '#94a3b8';
export type MarginBin = (typeof MARGIN_BINS)[number]['key'] | 'na';

/** 이익률 → 칸 — 0% 는 흑자 쪽(의료이익 ≥ 0 과 같은 규칙) · 경계값은 위 칸으로 */
export function marginBin(margin: number | null | undefined): MarginBin {
  if (margin == null || !Number.isFinite(margin)) return 'na';
  if (margin < -0.10) return 'm10';
  if (margin < -0.03) return 'm3';
  if (margin < 0) return 'm0';
  if (margin < 0.03) return 'p3';
  if (margin < 0.10) return 'p10';
  return 'p10+';
}
export function marginColor(margin: number | null | undefined): string {
  const b = marginBin(margin);
  return b === 'na' ? MARGIN_NA_COLOR : MARGIN_BINS.find((x) => x.key === b)!.color;
}

/** 글자색(흰 바탕 위) — 옅은 칸은 같은 계열의 진한 색으로(읽히게) */
export function marginInk(margin: number | null | undefined): string {
  const b = marginBin(margin);
  if (b === 'na') return '#64748b';
  if (b === 'm0') return '#be123c';
  if (b === 'p3') return '#0f766e';
  return marginColor(margin);
}

/** 규모 → 0~1(√ 척도 · 최대 대비) — 의료수익이 없으면 null(최소 크기로 그리되 규모를 지어내지 않는다) */
export function sizeRatio(revenue: number | null | undefined, maxRevenue: number): number | null {
  if (revenue == null || !Number.isFinite(revenue) || revenue <= 0 || maxRevenue <= 0) return null;
  return Math.sqrt(Math.min(1, revenue / maxRevenue));
}

export interface ClusterInput { key: string; x: number; y: number; pinned: boolean; surplus: boolean | null }
export interface Cluster<T extends ClusterInput> { x: number; y: number; members: T[]; n: number; surplusK: number; surplusN: number }

/**
 * 화면 격자 묶음 — 같은 칸의 표식을 하나로(칸 크기 px). 고정 표식(선택·우리 병원)은 묶지 않는다.
 * 흑자 k/n 의 분모는 **의료이익을 알 수 있는 기관 수**(surplus null 은 분모에서 뺀다).
 * 결과: 한 곳뿐인 칸은 묶지 않고 `singles` 로 돌려준다.
 */
export function clusterByGrid<T extends ClusterInput>(items: T[], cell: number): { clusters: Cluster<T>[]; singles: T[] } {
  const cells = new Map<string, T[]>();
  const singles: T[] = [];
  for (const it of items) {
    if (it.pinned) { singles.push(it); continue; }
    const k = `${Math.floor(it.x / cell)}:${Math.floor(it.y / cell)}`;
    const arr = cells.get(k);
    if (arr) arr.push(it); else cells.set(k, [it]);
  }
  const clusters: Cluster<T>[] = [];
  for (const members of cells.values()) {
    if (members.length === 1) { singles.push(members[0]); continue; }
    const known = members.filter((m) => m.surplus != null);
    clusters.push({
      x: members.reduce((s, m) => s + m.x, 0) / members.length,
      y: members.reduce((s, m) => s + m.y, 0) / members.length,
      members, n: members.length,
      surplusK: known.filter((m) => m.surplus).length, surplusN: known.length,
    });
  }
  return { clusters, singles };
}

/** 묶음을 풀 확대 수준 — 화면 px/위도 1°(ppd)가 이 값 이상이면 묶지 않는다 */
export const CLUSTER_OFF_PPD = 1600;
export const CLUSTER_CELL_PX = 46;

/**
 * 묶음 판정 정본 — 2D·3D 가 같이 쓴다(2026-09-30 · 종전 3D 는 묶지 않아 수도권 건물이 서로를 덮었다).
 * 화면 좌표(px) 기준 · ppd(화면 px/위도 1°)가 풀림 기준 이상이면 묶지 않는다 · 끄기(검사용)면 묶지 않는다.
 */
export function groupMarkers<T extends ClusterInput>(items: T[], ppd: number, off = false): { clusters: Cluster<T>[]; singles: T[] } {
  return !off && ppd < CLUSTER_OFF_PPD ? clusterByGrid(items, CLUSTER_CELL_PX) : { clusters: [], singles: items };
}

/**
 * 주소에서 읍면동 후보 — 시군구 뒤 어절 · 괄호 안(도로명 주소의 `(풍납동, …)`).
 * 경계는 행정동(`풍납1동`·`풍납2동`)이고 주소는 법정동(`풍납동`)이라, 정확히 같지 않으면 `풍납` + 숫자 + `동` 들의 평균으로 맞춘다.
 */
export function emdCandidates(address: string | null | undefined): string[] {
  const a = (address ?? '').replace(/&\s*#40;/g, '(').replace(/&\s*#41;/g, ')');
  const inParen = [...a.matchAll(/\(([^)]*)\)/g)].flatMap((m) => m[1].split(/[,\s]+/));
  const words = a.replace(/\([^)]*\)/g, ' ').split(/\s+/);
  return [...new Set([...inParen, ...words].map((w) => w.trim()).filter((w) => /^[가-힣0-9·]+(읍|면|동|가)$/.test(w) && w.length >= 2))];
}
export function matchEmd(table: Record<string, [number, number]> | undefined, cands: string[]): [number, number] | null {
  if (!table) return null;
  for (const c of cands) if (table[c]) return table[c];
  for (const c of cands) {
    if (!c.endsWith('동')) continue;
    const stem = c.slice(0, -1).replace(/\d+$/, '');
    const hits = Object.entries(table).filter(([n]) => new RegExp(`^${stem}\\d*(?:·\\d+)?동$`).test(n)).map(([, p]) => p);
    if (hits.length) return [hits.reduce((s, p) => s + p[0], 0) / hits.length, hits.reduce((s, p) => s + p[1], 0) / hits.length];
  }
  return null;
}
