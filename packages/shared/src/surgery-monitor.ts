/**
 * 수술실 실시간 모니터·질 지표 어휘 정본(2026-10-05 · `/surgery`).
 *
 * 🔴 단계는 **기록된 시각에서만** 판정한다 — 시각이 없으면 그 단계는 "기록 없음"이지 "지났다"가 아니다.
 *    (수술 시작 버튼 시각 `startedAt` 은 절개 시각이 아니다 — 둘을 같은 단계로 합치지 않는다)
 */

/** 수술 상태(SurgeryStatus) 표시 정본 — 화면이 로컬 표를 두지 않는다 */
export const SURGERY_STATUS_LABEL: Record<string, string> = {
  SCHEDULED: '예정', IN_PROGRESS: '진행중', COMPLETED: '완료', CANCELLED: '취소',
};

export const SURGERY_PHASES = [
  'SIGN_IN', 'INDUCTION', 'TIME_OUT', 'START', 'INCISION', 'CLOSURE', 'SIGN_OUT', 'END', 'PACU_IN', 'PACU_OUT',
] as const;
export type SurgeryPhase = (typeof SURGERY_PHASES)[number];

export const SURGERY_PHASE_LABEL: Record<SurgeryPhase, string> = {
  SIGN_IN: 'Sign-In',
  INDUCTION: '마취 유도',
  TIME_OUT: 'Time-Out',
  START: '수술 시작',
  INCISION: '절개',
  CLOSURE: '봉합',
  SIGN_OUT: 'Sign-Out',
  END: '수술 종료',
  PACU_IN: '회복실 입실',
  PACU_OUT: '회복실 퇴실',
};

/** 수술 중 활력 한 점 — 마취 기록 `vitalSigns` 배열의 한 칸(모양이 틀린 값은 null) */
export interface IntraopVitalPoint {
  at: string;
  heartRate: number | null;
  systolicBp: number | null;
  diastolicBp: number | null;
  spo2: number | null;
  etco2: number | null;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/**
 * 마취 기록 활력 배열 → 시각순 점. 배열이 아니면 `null`(모름 — 빈 목록과 다르다) · 시각 없는 칸은 버린다(지어내지 않는다).
 * 키 이름은 저장 원장 그대로(`heartRate`·`systolicBp`·`diastolicBp`·`spo2`·`etco2`·`time`).
 */
export function intraopVitalsOf(raw: unknown): IntraopVitalPoint[] | null {
  if (!Array.isArray(raw)) return null;
  const pts: IntraopVitalPoint[] = [];
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue;
    const r = x as Record<string, unknown>;
    const t = typeof r.time === 'string' ? r.time : typeof r.at === 'string' ? r.at : null;
    if (!t || Number.isNaN(Date.parse(t))) continue;
    pts.push({
      at: new Date(t).toISOString(),
      heartRate: num(r.heartRate ?? r.hr),
      systolicBp: num(r.systolicBp ?? r.sbp),
      diastolicBp: num(r.diastolicBp ?? r.dbp),
      spo2: num(r.spo2),
      etco2: num(r.etco2),
    });
  }
  return pts.sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * 분위수(선형 보간 없음 · 가장 가까운 순위) — 표본 0 이면 null(0 아님).
 * 질 지표는 평균보다 중앙값·90분위가 읽힌다(긴 꼬리 한 건이 평균을 끌고 간다).
 */
export function quantileOf(values: number[], q: number): number | null {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const idx = Math.min(xs.length - 1, Math.max(0, Math.ceil(q * xs.length) - 1));
  return xs[idx];
}

// ─────────────────────────── 수술 흐름(10단계) 정본 ───────────────────────────

/** 단계 시각의 출처 — 여러 원장에서 모은다(수술 원장·마취 기록·체크리스트·회복실·구조화 수술 기록) */
export type SurgeryFlowSources = Record<SurgeryPhase, Date | string | null | undefined>;

export interface SurgeryFlow {
  phases: { key: SurgeryPhase; at: string | null }[];
  /** 시각이 기록된 마지막 단계(단계 순서 기준) · 하나도 없으면 null */
  lastPhase: SurgeryPhase | null;
  /** 마지막 단계 다음 단계 — 흐름이 끝났으면(회복실 퇴실) null */
  nextPhase: SurgeryPhase | null;
  /** 마지막 단계보다 앞인데 시각이 없는 단계 — "지나갔다"가 아니라 "기록 없음"(건너뛴 것인지 모른다) */
  unrecordedBefore: SurgeryPhase[];
  /** 반드시 앞뒤가 정해진 짝의 시각이 뒤집힌 것(절개>봉합·시작>종료·입실>퇴실) — 순서가 유동적인 단계는 보지 않는다(거짓 경보) */
  timeConflicts: [SurgeryPhase, SurgeryPhase][];
}

const STRICT_PAIRS: [SurgeryPhase, SurgeryPhase][] = [['INCISION', 'CLOSURE'], ['START', 'END'], ['PACU_IN', 'PACU_OUT']];
const iso = (v: Date | string | null | undefined): string | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/**
 * 수술 흐름 — 실시간 모니터와 수술방 차트가 **같은 규칙**으로 그린다(정본 하나).
 * 🔴 단계는 기록된 시각에서만 판정한다 — 마지막 기록 단계 앞의 빈 단계를 "지났다"로 칠하지 않는다.
 */
export function surgeryFlowOf(src: SurgeryFlowSources): SurgeryFlow {
  const phases = SURGERY_PHASES.map((key) => ({ key, at: iso(src[key]) }));
  let lastIdx = -1;
  phases.forEach((p, i) => { if (p.at) lastIdx = i; });
  const lastPhase = lastIdx >= 0 ? phases[lastIdx].key : null;
  const nextPhase = lastIdx + 1 < phases.length ? phases[lastIdx + 1].key : null;
  const unrecordedBefore = phases.slice(0, Math.max(0, lastIdx)).filter((p) => !p.at).map((p) => p.key);
  const at = new Map(phases.map((p) => [p.key, p.at]));
  const timeConflicts = STRICT_PAIRS.filter(([a, b]) => {
    const x = at.get(a); const y = at.get(b);
    return !!x && !!y && Date.parse(x) > Date.parse(y);
  });
  return { phases, lastPhase, nextPhase, unrecordedBefore, timeConflicts };
}

// ─────────────────────────── 수술 중 기록 요약(결정론) ───────────────────────────

export interface IntraopLedgerRow { kind: string; occurredAt: string | Date; payload: unknown; voidedAt?: string | Date | null }

export interface IntraopSummary {
  /** 기간(분) — 양 끝 시각이 다 있을 때만 · 뒤집혔으면 null(값을 만들지 않는다) */
  durations: { anesthesiaMin: number | null; incisionToClosureMin: number | null; startToEndMin: number | null };
  /** mL 합 — 그 종류 기록이 하나도 없으면 null(0 과 다르다) */
  io: {
    fluidMl: number | null; bloodMl: number | null;
    urineMl: number | null; bloodLossMl: number | null; drainMl: number | null; otherOutMl: number | null;
    /** 들어간 것 − 나온 것 — 들어간 쪽·나온 쪽 기록이 모두 있을 때만 */
    balanceMl: number | null;
    /** mL 없이 단위 수만 적은 혈액 기록 수(합에 들어가지 않는다) */
    bloodUnitsOnly: number;
  };
  vitals: Record<'heartRate' | 'systolicBp' | 'diastolicBp' | 'spo2' | 'etco2' | 'temperature', { min: number; max: number; n: number } | null>;
  /** 같은 약·같은 단위끼리 합 — 단위가 다르면 다른 줄(환산하지 않는다) */
  drugs: { name: string; unit: string; total: number; count: number }[];
  counts: { vitals: number; drugs: number; fluids: number; blood: number; outputs: number; events: number; notes: number; voided: number };
}

const diffMinOf = (a: string | null, b: string | null): number | null => {
  if (!a || !b) return null;
  const d = (Date.parse(b) - Date.parse(a)) / 60000;
  return d >= 0 ? Math.floor(d) : null;
};
const VITAL_KEYS = ['heartRate', 'systolicBp', 'diastolicBp', 'spo2', 'etco2', 'temperature'] as const;

/**
 * 수술 중 기록 원장 → 요약(AI 없이 셈만). 무효 처리된 줄은 뺀다(수만 센다).
 * 🔴 숫자를 지어내지 않는다 — 기록이 없으면 null · 단위를 바꾸지 않는다 · 반올림은 정본 정책(roundBy)으로 호출부가.
 */
export function intraopSummaryOf(
  rows: IntraopLedgerRow[],
  times: { induction: Date | string | null | undefined; extubation: Date | string | null | undefined; incision: Date | string | null | undefined; closure: Date | string | null | undefined; start: Date | string | null | undefined; end: Date | string | null | undefined },
): IntraopSummary {
  const live = rows.filter((r) => !r.voidedAt);
  const pl = (r: IntraopLedgerRow) => (r.payload && typeof r.payload === 'object' ? r.payload as Record<string, unknown> : {});
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const sumMl = (xs: IntraopLedgerRow[]) => (xs.length ? xs.reduce((s, r) => s + (n(pl(r).volumeMl) ?? 0), 0) : null);
  const by = (k: string) => live.filter((r) => r.kind === k);
  const outputs = by('OUTPUT');
  const outOf = (types: string[]) => sumMl(outputs.filter((r) => types.includes(String(pl(r).type))));
  const blood = by('BLOOD');
  const bloodWithMl = blood.filter((r) => n(pl(r).volumeMl) != null);
  const fluidMl = sumMl(by('FLUID'));
  const bloodMl = bloodWithMl.length ? sumMl(bloodWithMl) : null;
  const urineMl = outOf(['URINE']); const bloodLossMl = outOf(['BLOOD_LOSS']); const drainMl = outOf(['DRAIN']); const otherOutMl = outOf(['GASTRIC', 'OTHER']);
  const inSide = [fluidMl, bloodMl].filter((x): x is number => x != null);
  const outSide = [urineMl, bloodLossMl, drainMl, otherOutMl].filter((x): x is number => x != null);
  const balanceMl = inSide.length && outSide.length ? inSide.reduce((a, b) => a + b, 0) - outSide.reduce((a, b) => a + b, 0) : null;

  const vitals = Object.fromEntries(VITAL_KEYS.map((k) => {
    const xs = by('VITALS').map((r) => n(pl(r)[k])).filter((x): x is number => x != null);
    return [k, xs.length ? { min: Math.min(...xs), max: Math.max(...xs), n: xs.length } : null];
  })) as IntraopSummary['vitals'];

  const drugMap = new Map<string, { name: string; unit: string; total: number; count: number }>();
  for (const r of by('DRUG')) {
    const p = pl(r); const name = String(p.name ?? '').trim(); const unit = String(p.unit ?? '').trim(); const dose = n(p.dose);
    if (!name || !unit || dose == null) continue;
    const key = `${name.toLowerCase()}|${unit}`;
    const cur = drugMap.get(key) ?? { name, unit, total: 0, count: 0 };
    cur.total += dose; cur.count += 1; drugMap.set(key, cur);
  }

  return {
    durations: {
      anesthesiaMin: diffMinOf(iso(times.induction), iso(times.extubation)),
      incisionToClosureMin: diffMinOf(iso(times.incision), iso(times.closure)),
      startToEndMin: diffMinOf(iso(times.start), iso(times.end)),
    },
    io: { fluidMl, bloodMl, urineMl, bloodLossMl, drainMl, otherOutMl, balanceMl, bloodUnitsOnly: blood.length - bloodWithMl.length },
    vitals,
    drugs: [...drugMap.values()],
    counts: {
      vitals: by('VITALS').length, drugs: by('DRUG').length, fluids: by('FLUID').length, blood: blood.length,
      outputs: outputs.length, events: by('EVENT').length, notes: by('NOTE').length, voided: rows.length - live.length,
    },
  };
}
