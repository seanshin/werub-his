/**
 * 파토그래프 점(2026-10-10) — 분만 진행 원장(`labor_progress_records`)을 시간 축으로 편다.
 *
 *  · 시간 0 = 진통 시작 시각(`laborOnsetAt`)이 있으면 그것, 없으면 첫 진행 기록 — 어느 쪽인지 `origin` 으로 밝힌다
 *  · 측정하지 않은 항목은 점을 만들지 않는다(빈 칸을 0 cm 로 그리지 않는다)
 *  · 🔴 경고선·행동선은 만들지 않는다 — 원내 기준이 정해지지 않았다. 표준(WHO 1994 파토그래프의 4 cm 시작·1 cm/시간 등)을
 *    원내 기준인 것처럼 겹쳐 그리면 "기준선 넘음"이라는 판정을 화면이 지어내게 된다
 */
export interface LaborProgressRow {
  recordedAt: string;
  cervicalDilation?: number | null;
  station?: number | null;
  fetalHeartRate?: number | null;
  contractionFreq?: number | null;
}

export interface PartographPoint {
  /** 시간 0 으로부터 지난 시간(시) */
  h: number;
  at: string;
  dilation: number | null;
  station: number | null;
  fhr: number | null;
  contractions: number | null;
}

export interface Partograph {
  origin: 'LABOR_ONSET' | 'FIRST_RECORD' | null;
  originAt: string | null;
  points: PartographPoint[];
  /** 개대가 기록된 점 수(선이 될 수 있는가) */
  dilationCount: number;
  /** 시간 축 끝(시) — 최소 12 */
  spanH: number;
}

const val = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function buildPartograph(rows: LaborProgressRow[], laborOnsetAt?: string | null): Partograph {
  const sorted = rows
    .filter((r) => Number.isFinite(new Date(r.recordedAt).getTime()))
    .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());
  const onset = laborOnsetAt && Number.isFinite(new Date(laborOnsetAt).getTime()) ? laborOnsetAt : null;
  if (!sorted.length) return { origin: onset ? 'LABOR_ONSET' : null, originAt: onset, points: [], dilationCount: 0, spanH: 12 };
  // 진통 시작이 첫 기록보다 늦으면(입력 오류) 쓰지 않는다 — 음수 시간을 만들지 않는다
  const useOnset = onset && new Date(onset).getTime() <= new Date(sorted[0].recordedAt).getTime();
  const originAt = useOnset ? onset! : sorted[0].recordedAt;
  const t0 = new Date(originAt).getTime();
  const points = sorted.map((r) => ({
    h: (new Date(r.recordedAt).getTime() - t0) / 3_600_000,
    at: r.recordedAt,
    dilation: val(r.cervicalDilation),
    station: val(r.station),
    fhr: val(r.fetalHeartRate),
    contractions: val(r.contractionFreq),
  }));
  const last = points[points.length - 1].h;
  return {
    origin: useOnset ? 'LABOR_ONSET' : 'FIRST_RECORD',
    originAt,
    points,
    dilationCount: points.filter((p) => p.dilation != null).length,
    spanH: Math.max(12, Math.ceil(last)),
  };
}
