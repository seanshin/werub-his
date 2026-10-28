/**
 * 신경학적 점수 추이(2026-10-10) — 신경외과 검사 원장에서 GCS·NIHSS 를 시간순 점으로.
 *  · GCS 는 저장 총점(gcsTotal)이 정본 — 없으면 세 항목이 다 있을 때만 합(부분 측정을 총점으로 만들지 않는다)
 *  · 기록되지 않은 점수는 점을 만들지 않는다(0·정상으로 채우지 않는다)
 *  · 판정선(악화 기준)은 원내 기준이 없어 만들지 않는다 — 변화량만 사실로
 */
export interface NeuroPoint { at: string; t: number; v: number }

export function neuroSeries(items: Array<Record<string, unknown>>): { gcs: NeuroPoint[]; nihss: NeuroPoint[] } {
  const gcs: NeuroPoint[] = []; const nihss: NeuroPoint[] = [];
  for (const it of items) {
    const at = typeof it.examinedAt === 'string' ? it.examinedAt : null;
    const t = at ? Date.parse(at) : NaN;
    if (!at || Number.isNaN(t)) continue;
    const e = it.gcsEye, v = it.gcsVerbal, m = it.gcsMotor;
    const total = typeof it.gcsTotal === 'number' ? it.gcsTotal
      : typeof e === 'number' && typeof v === 'number' && typeof m === 'number' ? e + v + m : null;
    if (total != null) gcs.push({ at, t, v: total });
    if (typeof it.nihss === 'number') nihss.push({ at, t, v: it.nihss });
  }
  gcs.sort((a, b) => a.t - b.t); nihss.sort((a, b) => a.t - b.t);
  return { gcs, nihss };
}

/** 첫 점 대비 마지막 점 변화 — 점이 둘 미만이면 null(변화를 말할 수 없다) */
export function neuroDelta(points: NeuroPoint[]): number | null {
  return points.length < 2 ? null : points[points.length - 1].v - points[0].v;
}
