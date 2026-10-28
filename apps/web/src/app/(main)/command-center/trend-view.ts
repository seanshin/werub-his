/**
 * 상단 지표 추세선 — 순수 계산(2026-10-02 · 상황판 디자인 F).
 *
 * 🔴 서버가 남긴 이력(`GET /command-center/trend`)만 그린다 — 직전 갱신 비교(▲▼)와 달리 서버 이력이다.
 *    값이 null(그 칸에 섹션 조회 실패)이거나 칸이 비면(기록 실패·서버 정지) **선을 잇지 않고 끊는다** — 이어 그리면 없던 값을 지어낸다.
 *    색으로 좋고 나쁨을 판정하지 않는다(늘어난 것이 좋은지는 지표마다 다르다).
 */
export interface TrendPoint { at: string; values: Record<string, number | null> }
export interface TrendResponse {
  bucketMinutes: number; from: string; to: string; recordingSince: string | null; metrics: string[]; points: TrendPoint[];
}

/** 지표 값 꺼내기 — 병상 가동률은 분자/분모 이력으로(분모 0·null 이면 그 칸은 끊김) */
export type TrendSource = { key: string } | { ratio: [string, string] };

export function valueAt(p: TrendPoint, src: TrendSource): number | null {
  if ('key' in src) return p.values[src.key] ?? null;
  const [nk, dk] = src.ratio;
  const n = p.values[nk], d = p.values[dk];
  if (n == null || d == null || d <= 0) return null;
  return (n / d) * 100;
}

export interface TrendSeries {
  /** 끊긴 구간별 점열 — x 는 시각(ms), y 는 값 */
  segments: Array<Array<{ t: number; v: number }>>;
  n: number;
  min: number | null;
  max: number | null;
  last: number | null;
}

/**
 * 점열 → 끊긴 구간들. 이웃 칸 사이가 1.5칸 넘게 벌어지면(칸 누락) 끊는다.
 */
export function seriesOf(points: TrendPoint[], src: TrendSource, bucketMinutes: number): TrendSeries {
  const gap = bucketMinutes * 60_000 * 1.5;
  const segments: TrendSeries['segments'] = [];
  let cur: Array<{ t: number; v: number }> = [];
  let prevT: number | null = null;
  let n = 0, min: number | null = null, max: number | null = null, last: number | null = null;
  for (const p of points) {
    const t = new Date(p.at).getTime();
    const v = valueAt(p, src);
    if (v == null || (prevT != null && t - prevT > gap)) {
      if (cur.length) segments.push(cur);
      cur = [];
    }
    if (v != null) {
      cur.push({ t, v });
      n += 1;
      min = min == null ? v : Math.min(min, v);
      max = max == null ? v : Math.max(max, v);
      last = v;
    }
    prevT = t;
  }
  if (cur.length) segments.push(cur);
  return { segments, n, min, max, last };
}

/** 구간들 → SVG polyline 점 문자열(창 [from,to] · 높이 h · 값 범위 [min,max] — 평평하면 가운데 선) */
export function polylines(series: TrendSeries, from: number, to: number, w: number, h: number): string[] {
  const span = Math.max(1, to - from);
  const lo = series.min ?? 0, hi = series.max ?? 0;
  const range = hi - lo;
  const y = (v: number) => (range === 0 ? h / 2 : h - 1 - ((v - lo) / range) * (h - 2));
  // 좌표는 그리기용 실수 그대로(표시 숫자가 아니라 반올림 정본을 지나지 않는다)
  return series.segments.map((seg) => seg.map((p) => `${((p.t - from) / span) * w},${y(p.v)}`).join(' '));
}
