/**
 * 임상 기록 시계열 분석(2026-10-01 사람 요청) — 진료의 방향과 의미를 판단하는 데 **도움이 되는 사실**을 수치로 정리한다(순수 함수).
 *
 * 무엇을 하는가
 *  · 검사 항목별 수치 시계열(같은 항목 판정은 LOINC → 원 코드 → 이름 순 · 종전 화면은 이름 문자열만 봤다)
 *  · 처음 → 최근 · 변화량·변화율 · 최소/최대/중앙값 · 30일당 기울기(최소제곱) · 참고 범위 안 비율(분모 병기)
 *  · 범위 이동(범위 안 유지 / 범위 밖→안 / 안→밖 / 밖 유지) — "호전·악화" 같은 **임상 판정 어휘는 쓰지 않는다**
 *  · 활력(외래 사전 측정 + 병동 플로시트) — 범위는 활력 판정 정본(환자안전위 개정 병합본)
 *  · 처방 기간 레인 + 처방 시작 **전·후 평균**(양쪽 2점 이상일 때만) — 🔴 관련성 판단이 아니다(화면이 그렇게 말한다)
 *
 * 정직성
 *  · `<5`·`>1000` 같은 보고값은 수치 통계에서 빼고 수를 밝힌다(값을 지어내지 않는다)
 *  · 한 항목에 단위가 여럿이면 가장 많은 단위만 계산하고 뺀 수를 밝힌다(단위 환산은 하지 않는다)
 *  · 외부 보고값은 재반올림하지 않는다 — 원값 그대로 싣고, **파생값(차이·평균·기울기)만** `roundBy('labValue')`
 */
import { isAbnormalFlag, isCriticalFlag, dosingWindow, roundBy, vitalItemFlags, type VitalsThresholds } from '@hospital-run/shared';

const DAY = 86_400_000;
const EFFECT_WINDOW_DAYS = 90;

export interface LabPointInput {
  at: Date;
  testName: string;
  testCode: string | null;
  loincCode: string | null;
  value: string;
  unit: string;
  normalMin: number | null;
  normalMax: number | null;
  flag: string | null;
}
export interface VitalRowInput {
  at: Date;
  source: 'PRE_VISIT' | 'FLOWSHEET';
  systolicBp: number | null;
  diastolicBp: number | null;
  heartRate: number | null;
  temperature: number | null;
  spo2: number | null;
  respiratoryRate: number | null;
}
export interface MedInput {
  id: string;
  name: string | null;
  status: string;
  createdAt: Date;
  duration: number | null;
  discontinuedAt: Date | null;
}

export type RangeState = 'IN' | 'OUT' | null;
export type RangeMove = 'STAYED_IN' | 'ENTERED' | 'LEFT' | 'STAYED_OUT' | null;

export interface SeriesPoint { at: string; value: number; flag: string | null; range: RangeState }
export interface MedEffect { medId: string; name: string | null; start: string; meanBefore: number; nBefore: number; meanAfter: number; nAfter: number }

export interface Analyte {
  key: string;
  kind: 'LAB' | 'VITAL';
  name: string;
  unit: string | null;
  codes: { loinc: string | null; code: string | null };
  n: number;
  first: { at: string; value: number } | null;
  last: { at: string; value: number } | null;
  delta: number | null;
  deltaPct: number | null;
  min: number | null;
  max: number | null;
  median: number | null;
  slopePer30d: number | null;
  /** 참고 범위 — 검사는 최근 결과의 범위, 활력은 판정 정본(주의 경계) */
  range: { low: number | null; high: number | null; source: 'LAB_REFERENCE' | 'VITALS_CANON' | null };
  inRange: { numerator: number; denominator: number };
  abnormal: number;
  critical: number;
  rangeMove: RangeMove;
  excluded: { nonNumeric: number; otherUnit: number };
  series: SeriesPoint[];
  medEffects: MedEffect[];
  /** 전·후 비교가 성립한 약 중 화면에 싣지 않은 수(약당 첫 시작만 · 항목당 상한) */
  medEffectsMore: number;
}

/** 약 하나 = 레인 하나 — 같은 약의 반복·갱신 처방은 기간 조각으로 나란히(종전: 처방 한 건 = 한 줄이라 반복 처방 환자는 144줄) */
export interface MedLane {
  id: string;
  name: string | null;
  status: string;
  /** 첫 조각 시작 */
  start: string;
  /** 마지막 조각 끝(모르면 null) */
  end: string | null;
  endKnown: boolean;
  ongoing: boolean;
  prescriptions: number;
  segments: { start: string; end: string | null; endKnown: boolean; status: string }[];
}

export interface RecordAnalytics {
  period: { from: string; to: string };
  analytes: Analyte[];
  meds: MedLane[];
  summary: {
    analytes: number;
    latestOutOfRange: number;
    criticalPoints: number;
    /** 변화율이 큰 순(검사 · 2점 이상) — 크기만 말한다(좋다·나쁘다 아님) */
    largestChanges: { key: string; name: string; deltaPct: number }[];
  };
  truncated: { labs: boolean; vitals: boolean; meds: boolean };
  vitalsThresholdSource: 'CONFIGURED' | 'DEFAULT';
}

const NUMERIC = /^-?\d+(\.\d+)?$/;
export function parseNumeric(v: string): number | null {
  const s = v.trim().replace(/,/g, '');
  return NUMERIC.test(s) ? Number(s) : null;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const r = (x: number | null) => (x == null || !Number.isFinite(x) ? null : roundBy(x, 'labValue'));

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const a = [...xs].sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** 최소제곱 기울기 × 30일 — 3점 이상·하루 이상 퍼져 있을 때만 */
export function slopePer30d(pts: { t: number; v: number }[]): number | null {
  if (pts.length < 3) return null;
  const t0 = pts[0].t;
  const xs = pts.map((p) => (p.t - t0) / DAY);
  if (xs[xs.length - 1] - xs[0] < 1) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = pts.reduce((a, p) => a + p.v, 0) / pts.length;
  let num = 0, den = 0;
  for (let i = 0; i < pts.length; i++) { num += (xs[i] - mx) * (pts[i].v - my); den += (xs[i] - mx) ** 2; }
  return den === 0 ? null : (num / den) * 30;
}

function rangeOf(v: number, low: number | null, high: number | null): RangeState {
  if (low == null && high == null) return null;
  if (low != null && v < low) return 'OUT';
  if (high != null && v > high) return 'OUT';
  return 'IN';
}

function move(a: RangeState, b: RangeState): RangeMove {
  if (!a || !b) return null;
  if (a === 'IN') return b === 'IN' ? 'STAYED_IN' : 'LEFT';
  return b === 'IN' ? 'ENTERED' : 'STAYED_OUT';
}

const medKey = (m: { name: string | null; id: string }) => (m.name ? `name:${norm(m.name)}` : `id:${m.id}`);

export function medLanes(meds: MedInput[], now: Date): MedLane[] {
  const groups = new Map<string, MedInput[]>();
  for (const m of meds) {
    if (m.status === 'CANCELLED') continue; // 발효 전 무효 — 투여 기간이 아니다
    const k = medKey(m);
    groups.set(k, [...(groups.get(k) ?? []), m]);
  }
  const lanes: MedLane[] = [];
  for (const g of groups.values()) {
    g.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const segs = g.map((m) => {
      const w = dosingWindow({ createdAt: m.createdAt, duration: m.duration, discontinuedAt: m.discontinuedAt }, now);
      const end = m.discontinuedAt && m.discontinuedAt.getTime() <= now.getTime() ? m.discontinuedAt.toISOString() : w.endsAt;
      return { start: m.createdAt.toISOString(), end, endKnown: end != null, status: m.status, ongoing: w.state === 'DOSING' };
    });
    const last = segs[segs.length - 1];
    lanes.push({
      id: g[g.length - 1].id, name: g[g.length - 1].name, status: last.status,
      start: segs[0].start, end: last.end, endKnown: last.endKnown, ongoing: segs.some((x) => x.ongoing),
      prescriptions: g.length,
      segments: segs.map((x) => ({ start: x.start, end: x.end, endKnown: x.endKnown, status: x.status })),
    });
  }
  return lanes.sort((a, b) => Number(b.ongoing) - Number(a.ongoing) || Date.parse(b.start) - Date.parse(a.start));
}

/** 처방 시작 전·후 — 약마다 **첫 시작**(같은 약의 반복·갱신은 시작이 아니다) · 항목당 상한 */
const MED_EFFECT_CAP = 5;

function medEffectsFor(points: { t: number; v: number }[], meds: MedInput[]): { shown: MedEffect[]; more: number } {
  const out: MedEffect[] = [];
  const firstStarts = new Map<string, MedInput>();
  for (const m of meds) {
    if (m.status === 'CANCELLED') continue;
    const k = medKey(m);
    const cur = firstStarts.get(k);
    if (!cur || m.createdAt < cur.createdAt) firstStarts.set(k, m);
  }
  for (const m of firstStarts.values()) {
    const s = m.createdAt.getTime();
    const before = points.filter((p) => p.t < s && p.t >= s - EFFECT_WINDOW_DAYS * DAY).map((p) => p.v);
    const after = points.filter((p) => p.t > s && p.t <= s + EFFECT_WINDOW_DAYS * DAY).map((p) => p.v);
    if (before.length < 2 || after.length < 2) continue;
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    out.push({ medId: m.id, name: m.name, start: m.createdAt.toISOString(), meanBefore: r(mean(before))!, nBefore: before.length, meanAfter: r(mean(after))!, nAfter: after.length });
  }
  // 시작 시각 순(효과 크기 순으로 줄 세우지 않는다 — 관련성을 강조하게 된다)
  out.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return { shown: out.slice(0, MED_EFFECT_CAP), more: Math.max(out.length - MED_EFFECT_CAP, 0) };
}

function analyteFrom(
  base: Pick<Analyte, 'key' | 'kind' | 'name' | 'unit' | 'codes' | 'range'>,
  pts: { t: number; v: number; flag: string | null; range: RangeState }[],
  excluded: Analyte['excluded'],
  meds: MedInput[],
): Analyte {
  pts.sort((a, b) => a.t - b.t);
  const vals = pts.map((p) => p.v);
  const first = pts[0];
  const last = pts[pts.length - 1];
  const delta = pts.length >= 2 ? last.v - first.v : null;
  const ranged = pts.filter((p) => p.range != null);
  return {
    ...base,
    n: pts.length,
    first: first ? { at: new Date(first.t).toISOString(), value: first.v } : null,
    last: last ? { at: new Date(last.t).toISOString(), value: last.v } : null,
    delta: r(delta),
    deltaPct: delta != null && first.v !== 0 ? r((delta / Math.abs(first.v)) * 100) : null,
    min: vals.length ? Math.min(...vals) : null,
    max: vals.length ? Math.max(...vals) : null,
    median: r(median(vals)),
    slopePer30d: r(slopePer30d(pts)),
    inRange: { numerator: ranged.filter((p) => p.range === 'IN').length, denominator: ranged.length },
    abnormal: pts.filter((p) => isAbnormalFlag(p.flag) || p.range === 'OUT').length,
    critical: pts.filter((p) => isCriticalFlag(p.flag)).length,
    rangeMove: pts.length >= 2 ? move(first.range, last.range) : null,
    excluded,
    series: pts.map((p) => ({ at: new Date(p.t).toISOString(), value: p.v, flag: p.flag, range: p.range })),
    ...(() => { const e = medEffectsFor(pts, meds); return { medEffects: e.shown, medEffectsMore: e.more }; })(),
  };
}


export function buildLabAnalytes(items: LabPointInput[], meds: MedInput[]): Analyte[] {
  const groups = new Map<string, LabPointInput[]>();
  for (const it of items) {
    const key = it.loincCode ? `loinc:${it.loincCode}` : it.testCode ? `code:${it.testCode}` : `name:${norm(it.testName)}`;
    const g = groups.get(key) ?? [];
    g.push(it);
    groups.set(key, g);
  }
  const out: Analyte[] = [];
  for (const [key, g] of groups) {
    g.sort((a, b) => a.at.getTime() - b.at.getTime());
    const latest = g[g.length - 1];
    const unitCount = new Map<string, number>();
    for (const it of g) unitCount.set(it.unit, (unitCount.get(it.unit) ?? 0) + 1);
    const unit = [...unitCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    let nonNumeric = 0, otherUnit = 0;
    const pts: { t: number; v: number; flag: string | null; range: RangeState }[] = [];
    for (const it of g) {
      const v = parseNumeric(it.value);
      if (v == null) { nonNumeric++; continue; }
      if (it.unit !== unit) { otherUnit++; continue; }
      // 결과마다 자기 참고 범위로 판정한다(범위 개정을 소급하지 않는다) · 범위가 없으면 플래그로
      const rg = rangeOf(v, it.normalMin, it.normalMax) ?? (it.flag ? (isAbnormalFlag(it.flag) ? 'OUT' : 'IN') : null);
      pts.push({ t: it.at.getTime(), v, flag: it.flag, range: rg });
    }
    const latestWithUnit = [...g].reverse().find((it) => it.unit === unit) ?? latest;
    out.push(analyteFrom(
      {
        key, kind: 'LAB', name: latest.testName, unit,
        codes: { loinc: latest.loincCode, code: latest.testCode },
        range: { low: latestWithUnit.normalMin, high: latestWithUnit.normalMax, source: latestWithUnit.normalMin != null || latestWithUnit.normalMax != null ? 'LAB_REFERENCE' : null },
      },
      pts, { nonNumeric, otherUnit }, meds,
    ));
  }
  return out;
}

const VITAL_KEYS = ['systolicBp', 'diastolicBp', 'heartRate', 'temperature', 'spo2', 'respiratoryRate'] as const;
const VITAL_NAME: Record<(typeof VITAL_KEYS)[number], string> = {
  systolicBp: '수축기 혈압', diastolicBp: '이완기 혈압', heartRate: '심박수', temperature: '체온', spo2: '산소포화도', respiratoryRate: '호흡수',
};

export function buildVitalAnalytes(rows: VitalRowInput[], th: VitalsThresholds, meds: MedInput[]): Analyte[] {
  const out: Analyte[] = [];
  for (const k of VITAL_KEYS) {
    const t = th[k];
    const pts: { t: number; v: number; flag: string | null; range: RangeState }[] = [];
    for (const row of rows) {
      const v = row[k];
      if (v == null || !Number.isFinite(v)) continue;
      const f = vitalItemFlags({ [k]: v }, th)[k];
      pts.push({ t: row.at.getTime(), v, flag: f === 'CRITICAL' ? 'CRITICAL' : f === 'WARNING' ? 'H' : null, range: f == null ? null : f === 'NORMAL' ? 'IN' : 'OUT' });
    }
    if (!pts.length) continue;
    out.push(analyteFrom(
      {
        key: `vital:${k}`, kind: 'VITAL', name: VITAL_NAME[k], unit: t.unit, codes: { loinc: null, code: null },
        range: { low: t.warnLow ?? t.low, high: t.warnHigh ?? t.high, source: 'VITALS_CANON' },
      },
      pts, { nonNumeric: 0, otherUnit: 0 }, meds,
    ));
  }
  return out;
}

export function buildRecordAnalytics(input: {
  labs: LabPointInput[];
  vitals: VitalRowInput[];
  meds: MedInput[];
  thresholds: VitalsThresholds;
  thresholdSource: 'CONFIGURED' | 'DEFAULT';
  period: { from: Date; to: Date };
  truncated: RecordAnalytics['truncated'];
  now?: Date;
}): RecordAnalytics {
  const now = input.now ?? new Date();
  const labs = buildLabAnalytes(input.labs, input.meds);
  const vitals = buildVitalAnalytes(input.vitals, input.thresholds, input.meds);
  const order = (a: Analyte) => (a.series[a.series.length - 1]?.range === 'OUT' ? 0 : 1);
  labs.sort((a, b) => order(a) - order(b) || b.critical - a.critical || b.n - a.n || a.name.localeCompare(b.name));
  const analytes = [...labs, ...vitals];
  return {
    period: { from: input.period.from.toISOString(), to: input.period.to.toISOString() },
    analytes,
    meds: medLanes(input.meds, now),
    summary: {
      analytes: analytes.length,
      latestOutOfRange: analytes.filter((a) => a.series[a.series.length - 1]?.range === 'OUT').length,
      criticalPoints: analytes.reduce((s, a) => s + a.critical, 0),
      largestChanges: labs
        .filter((a) => a.n >= 2 && a.deltaPct != null)
        .sort((a, b) => Math.abs(b.deltaPct!) - Math.abs(a.deltaPct!))
        .slice(0, 5)
        .map((a) => ({ key: a.key, name: a.name, deltaPct: a.deltaPct! })),
    },
    truncated: input.truncated,
    vitalsThresholdSource: input.thresholdSource,
  };
}
