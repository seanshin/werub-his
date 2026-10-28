/**
 * CPOE 질 지표 산출 — 순수 함수(원장 행 → 분자·분모·문제 건·주별 추이·층화·처방의별·소요 시간·월별 묶음).
 *
 * 🔴 분모 0 은 `value: null`(산출 불가) — 0 이 아니다. 문제 건은 상한까지만 싣고 전체 수를 함께 낸다.
 * 🔴 판정(달성/미달)은 여기서 하지 않는다 — 질 지표 원장(목표·방향)이 정본이다.
 */
import {
  CPOE_QI_DEFS, CPOE_TAT_DEPTS, QI_SETTINGS, isBlankReason, percentileOf,
  type CpoeQiKey, type CpoeTatDept, type QiSetting,
} from '@hospital-run/shared';

interface Base { id: string; createdAt: Date; prescriber: string | null; patientId: string | null; name: string | null; setting: QiSetting }
export interface QiRx extends Base {
  type: string; // PrescriptionType
  status: string; // ACTIVE · CANCELLED · DISCONTINUED
  priority: string;
  orderSource: string;
  durChecked: boolean;
  durWarnings: unknown;
  durOverridden: boolean;
  durOverrideReason: string | null;
  readBackConfirmedAt: Date | null;
  prescriberCosignedAt: Date | null;
  diagnosisCodeId: string | null;
  discontinueReason: string | null;
}
export interface QiOrder extends Base {
  department: string;
  status: string;
  priority: string;
  completedAt: Date | null;
  acknowledgedAt: Date | null;
  specimenCollectedAt: Date | null;
}
export interface QiIntervention extends Base { status: string }
export interface QiCdss extends Base { overridden: boolean; overrideReason: string | null; level?: string | null }
/** 위급값 통보 — createdAt 은 통보 시각(notifiedAt) */
export interface QiCritical extends Base { acknowledgedAt: Date | null; readBackConfirmed: boolean }

export type QiItemKind = 'RX' | 'ORDER' | 'INTERVENTION' | 'CDSS' | 'CRITICAL';
export interface QiItem { id: string; kind: QiItemKind; at: string; patientId: string | null; name: string | null; prescriber: string | null }
export interface Count { numerator: number; denominator: number }
export interface QiResult extends Count {
  key: CpoeQiKey;
  /** 분자/분모(0~1) · 분모 0 = null(산출 불가) */
  value: number | null;
  /** 문제 건(정의상 없으면 null) — 최근 순 상한까지 + 전체 수 */
  offenders: { total: number; items: QiItem[] } | null;
  /** 주별(7일 칸) 분자·분모 — 기간 시작부터 */
  trend: ({ start: string } & Count)[];
  /** 층화 — 진료 유형(그 진료 기록 기준) · 책임 처방의 진료과(미상은 null) */
  strata: { setting: Record<QiSetting, Count>; department: ({ department: string | null } & Count)[] };
}
export interface TatCell { department: CpoeTatDept; priority: 'STAT' | 'ROUTINE'; median: number | null; p90: number | null; n: number }
export interface AckTime { kind: 'RESULT' | 'CRITICAL'; median: number | null; p90: number | null; n: number }
export interface PrescriberRow {
  prescriber: string;
  prescriptions: number;
  durOverridden: number;
  durOverrideNoReason: number;
  verbal: number;
  verbalUncosigned: number;
  noDiagnosis: number;
  discontinueNoReason: number;
  resultUnack: number;
  criticalUnack: number;
}
export interface QiData { rx: QiRx[]; orders: QiOrder[]; interventions: QiIntervention[]; cdss: QiCdss[]; criticals: QiCritical[] }

const OFFENDER_CAP = 30;
const DAY = 86_400_000;
const hasWarnings = (w: unknown) => Array.isArray(w) && w.length > 0;
const isVerbal = (s: string) => s === 'VERBAL' || s === 'TELEPHONE';
const isResultDept = (d: string) => d === 'LAB' || d === 'IMAGING';
const minutesBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 60_000;

/** 지표별 모집단(분모 행)과 분자 술어 — 정의는 shared `CPOE_QI_DEFS` 의 문구와 같은 뜻 */
interface Rule { rows: (d: QiData) => Base[]; num: (r: never) => boolean; kind: QiItemKind }
const rule = <T extends Base>(kind: QiItemKind, rows: (d: QiData) => T[], num: (r: T) => boolean): Rule => ({ rows, num: num as (r: never) => boolean, kind });

const RULES: Record<CpoeQiKey, Rule> = {
  DUR_CHECK_RATE: rule('RX', (d) => d.rx.filter((r) => r.type === 'MEDICATION'), (r) => r.durChecked),
  DUR_ALERT_RATE: rule('RX', (d) => d.rx.filter((r) => r.type === 'MEDICATION' && r.durChecked), (r) => hasWarnings(r.durWarnings)),
  DUR_OVERRIDE_RATE: rule('RX', (d) => d.rx.filter((r) => hasWarnings(r.durWarnings)), (r) => r.durOverridden),
  DUR_OVERRIDE_NO_REASON: rule('RX', (d) => d.rx.filter((r) => r.durOverridden), (r) => isBlankReason(r.durOverrideReason)),
  VERBAL_RATE: rule('RX', (d) => d.rx, (r) => isVerbal(r.orderSource)),
  VERBAL_NO_READBACK: rule('RX', (d) => d.rx.filter((r) => isVerbal(r.orderSource)), (r) => !r.readBackConfirmedAt),
  VERBAL_UNCOSIGNED: rule('RX', (d) => d.rx.filter((r) => isVerbal(r.orderSource) && r.status !== 'CANCELLED'), (r) => !r.prescriberCosignedAt),
  NO_DIAGNOSIS: rule('RX', (d) => d.rx.filter((r) => r.status !== 'CANCELLED'), (r) => !r.diagnosisCodeId),
  DISCONTINUE_NO_REASON: rule('RX', (d) => d.rx.filter((r) => r.status === 'DISCONTINUED'), (r) => isBlankReason(r.discontinueReason)),
  RX_CANCEL_RATE: rule('RX', (d) => d.rx, (r) => r.status === 'CANCELLED'),
  STAT_RATE: rule('RX', (d) => d.rx, (r) => r.priority === 'STAT'),
  RESULT_UNACK: rule('ORDER', (d) => d.orders.filter((o) => isResultDept(o.department) && o.status === 'COMPLETED'), (o) => !o.acknowledgedAt),
  SPECIMEN_TIME_RECORDED: rule('ORDER', (d) => d.orders.filter((o) => o.department === 'LAB' && o.status === 'COMPLETED'), (o) => !!o.specimenCollectedAt),
  CRITICAL_UNACK: rule('CRITICAL', (d) => d.criticals, (c) => !c.acknowledgedAt),
  CRITICAL_NO_READBACK: rule('CRITICAL', (d) => d.criticals.filter((c) => !!c.acknowledgedAt), (c) => !c.readBackConfirmed),
  PI_UNANSWERED: rule('INTERVENTION', (d) => d.interventions, (i) => i.status === 'PENDING'),
  PI_ACCEPT_RATE: rule('INTERVENTION', (d) => d.interventions.filter((i) => i.status === 'ACCEPTED' || i.status === 'REJECTED'), (i) => i.status === 'ACCEPTED'),
  CDSS_OVERRIDE_NO_REASON: rule('CDSS', (d) => d.cdss.filter((c) => c.overridden), (c) => isBlankReason(c.overrideReason)),
};

const toItem = (kind: QiItemKind, r: Base): QiItem => ({ id: r.id, kind, at: r.createdAt.toISOString(), patientId: r.patientId, name: r.name, prescriber: r.prescriber });
const countOf = (rows: Base[], num: (r: never) => boolean): Count => ({ numerator: rows.filter((r) => num(r as never)).length, denominator: rows.length });

/** 한 지표의 분자·분모만 — 월 측정 기록용 */
export function countIndicator(key: CpoeQiKey, data: QiData): Count {
  const r = RULES[key];
  return countOf(r.rows(data), r.num);
}

/** 한 지표를 시각 칸으로 나눠 센다 — 관리도(월)·추이(주) 공용 · 칸 경계는 [start, end) */
export function bucketCounts(key: CpoeQiKey, data: QiData, buckets: { start: Date; end: Date }[]): Count[] {
  const r = RULES[key];
  const rows = r.rows(data);
  return buckets.map((b) => countOf(rows.filter((x) => x.createdAt >= b.start && x.createdAt < b.end), r.num));
}

export function computeIndicators(data: QiData, period: { from: Date; to: Date }, deptOf: (prescriber: string | null) => string | null = () => null): QiResult[] {
  const weeks: { start: Date; end: Date }[] = [];
  for (let t = period.from.getTime(); t < period.to.getTime(); t += 7 * DAY) weeks.push({ start: new Date(t), end: new Date(t + 7 * DAY) });
  return CPOE_QI_DEFS.map((def) => {
    const r = RULES[def.key];
    const rows = r.rows(data);
    const isHit = (x: Base) => r.num(x as never);
    const hits = rows.filter(isHit);
    const offRows = def.offender === 'NUM' ? hits : def.offender === 'REST' ? rows.filter((x) => !isHit(x)) : null;
    const setting = Object.fromEntries(QI_SETTINGS.map((s) => [s, countOf(rows.filter((x) => x.setting === s), r.num)])) as Record<QiSetting, Count>;
    const byDept = new Map<string | null, Count>();
    for (const x of rows) {
      const k = deptOf(x.prescriber);
      const c = byDept.get(k) ?? { numerator: 0, denominator: 0 };
      c.denominator++; if (isHit(x)) c.numerator++;
      byDept.set(k, c);
    }
    return {
      key: def.key,
      ...countOf(rows, r.num),
      value: rows.length ? hits.length / rows.length : null,
      offenders: offRows
        ? { total: offRows.length, items: [...offRows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, OFFENDER_CAP).map((x) => toItem(r.kind, x)) }
        : null,
      trend: bucketCounts(def.key, data, weeks).map((c, i) => ({ start: weeks[i].start.toISOString(), ...c })),
      strata: {
        setting,
        department: [...byDept.entries()].map(([department, c]) => ({ department, ...c })).sort((a, b) => b.denominator - a.denominator),
      },
    };
  });
}

/** 발행→완료 소요(분) — 검사·영상은 결과, 약국은 조제 완료 · 완료 안 된 오더는 표본이 아니다 */
export function computeTat(orders: QiOrder[]): TatCell[] {
  const cells: TatCell[] = [];
  for (const department of CPOE_TAT_DEPTS) {
    for (const priority of ['STAT', 'ROUTINE'] as const) {
      const mins = orders
        .filter((o) => o.department === department && o.status === 'COMPLETED' && o.completedAt
          && (priority === 'STAT' ? o.priority === 'STAT' : o.priority !== 'STAT'))
        .map((o) => minutesBetween(o.createdAt, o.completedAt!))
        // 🔴 완료가 발행보다 이른 행(시드 결함)은 표본에서 뺀다 — 음수 소요를 중앙값에 섞지 않는다
        .filter((m) => m >= 0);
      cells.push({ department, priority, median: percentileOf(mins, 50), p90: percentileOf(mins, 90), n: mins.length });
    }
  }
  return cells;
}

/** 결과 확인 소요 — 결과 완료→의사 확인 · 위급값 통보→확인 · 확인 안 된 건은 표본이 아니다(미확인률이 따로 센다) */
export function computeAckTimes(data: QiData): AckTime[] {
  const sample = (mins: number[]) => { const v = mins.filter((m) => m >= 0); return { median: percentileOf(v, 50), p90: percentileOf(v, 90), n: v.length }; };
  return [
    { kind: 'RESULT', ...sample(data.orders.filter((o) => isResultDept(o.department) && o.completedAt && o.acknowledgedAt).map((o) => minutesBetween(o.completedAt!, o.acknowledgedAt!))) },
    { kind: 'CRITICAL', ...sample(data.criticals.filter((c) => c.acknowledgedAt).map((c) => minutesBetween(c.createdAt, c.acknowledgedAt!))) },
  ];
}

export function computeByPrescriber(data: QiData): PrescriberRow[] {
  const rows = new Map<string, PrescriberRow>();
  const row = (id: string) => {
    let r = rows.get(id);
    if (!r) {
      r = { prescriber: id, prescriptions: 0, durOverridden: 0, durOverrideNoReason: 0, verbal: 0, verbalUncosigned: 0, noDiagnosis: 0, discontinueNoReason: 0, resultUnack: 0, criticalUnack: 0 };
      rows.set(id, r);
    }
    return r;
  };
  for (const rx of data.rx) {
    if (!rx.prescriber) continue;
    const r = row(rx.prescriber);
    r.prescriptions++;
    if (rx.durOverridden) { r.durOverridden++; if (isBlankReason(rx.durOverrideReason)) r.durOverrideNoReason++; }
    if (isVerbal(rx.orderSource)) { r.verbal++; if (rx.status !== 'CANCELLED' && !rx.prescriberCosignedAt) r.verbalUncosigned++; }
    if (rx.status !== 'CANCELLED' && !rx.diagnosisCodeId) r.noDiagnosis++;
    if (rx.status === 'DISCONTINUED' && isBlankReason(rx.discontinueReason)) r.discontinueNoReason++;
  }
  for (const o of data.orders) {
    if (!o.prescriber || !isResultDept(o.department) || o.status !== 'COMPLETED' || o.acknowledgedAt) continue;
    row(o.prescriber).resultUnack++;
  }
  for (const c of data.criticals) if (c.prescriber && !c.acknowledgedAt) row(c.prescriber).criticalUnack++;
  return [...rows.values()].sort((a, b) => b.prescriptions - a.prescriptions);
}

/**
 * 경고 부담(alert burden) — DUR 경고를 유형별로: 경고가 난 처방·경고 수·무시·사유 없는 무시 · 경고가 잦은 약 · CDSS 수준별.
 * 🔴 경고 원소가 문자열(옛 형식)이면 유형을 모른다 — 'UNTYPED' 로 따로 센다(어느 유형에 끼워 넣지 않는다).
 */
export interface AlertTypeRow { type: string; prescriptions: number; alerts: number; overridden: number; overriddenNoReason: number }
export interface AlertBurden {
  dur: { warnedPrescriptions: number; overridden: number; overriddenNoReason: number; byType: AlertTypeRow[]; topDrugs: { name: string | null; prescriptions: number; overridden: number; types: string[] }[] };
  cdss: { logs: number; byLevel: { level: string; logs: number; overridden: number; overriddenNoReason: number }[] };
}
const warningTypeOf = (w: unknown): string => {
  if (w && typeof w === 'object' && typeof (w as { type?: unknown }).type === 'string' && (w as { type: string }).type.trim()) return (w as { type: string }).type;
  return 'UNTYPED';
};
export function computeAlertBurden(data: QiData): AlertBurden {
  const byType = new Map<string, AlertTypeRow>();
  const byDrug = new Map<string, { name: string | null; prescriptions: number; overridden: number; types: Set<string> }>();
  let warned = 0; let overridden = 0; let noReason = 0;
  for (const rx of data.rx) {
    if (!hasWarnings(rx.durWarnings)) continue;
    warned++;
    const nr = rx.durOverridden && isBlankReason(rx.durOverrideReason);
    if (rx.durOverridden) overridden++;
    if (nr) noReason++;
    const types = (rx.durWarnings as unknown[]).map(warningTypeOf);
    const counted = new Set<string>();
    for (const t of types) {
      const row = byType.get(t) ?? { type: t, prescriptions: 0, alerts: 0, overridden: 0, overriddenNoReason: 0 };
      row.alerts++;
      if (!counted.has(t)) {
        counted.add(t);
        row.prescriptions++;
        if (rx.durOverridden) row.overridden++;
        if (nr) row.overriddenNoReason++;
      }
      byType.set(t, row);
    }
    const key = rx.name ?? `(${rx.id})`;
    const d = byDrug.get(key) ?? { name: rx.name, prescriptions: 0, overridden: 0, types: new Set<string>() };
    d.prescriptions++; if (rx.durOverridden) d.overridden++;
    counted.forEach((t) => d.types.add(t));
    byDrug.set(key, d);
  }
  const levels = new Map<string, { level: string; logs: number; overridden: number; overriddenNoReason: number }>();
  for (const c of data.cdss) {
    const level = c.level || 'UNKNOWN';
    const r = levels.get(level) ?? { level, logs: 0, overridden: 0, overriddenNoReason: 0 };
    r.logs++;
    if (c.overridden) { r.overridden++; if (isBlankReason(c.overrideReason)) r.overriddenNoReason++; }
    levels.set(level, r);
  }
  return {
    dur: {
      warnedPrescriptions: warned, overridden, overriddenNoReason: noReason,
      byType: [...byType.values()].sort((a, b) => b.prescriptions - a.prescriptions),
      topDrugs: [...byDrug.values()].sort((a, b) => b.prescriptions - a.prescriptions).slice(0, 10).map((d) => ({ ...d, types: [...d.types] })),
    },
    cdss: { logs: data.cdss.length, byLevel: [...levels.values()].sort((a, b) => b.logs - a.logs) },
  };
}
