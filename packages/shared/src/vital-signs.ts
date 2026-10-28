/**
 * 활력징후·생체계측 **표시 표준 정본**(2026-10-07).
 *
 * 무엇을 정하는가 — "같은 측정치를 모든 화면이 같은 모양으로 말한다":
 *  · 항목 정의: 약어·한/영 이름·LOINC·UCUM·표시 단위·수치 정책 키(자릿수는 `NUMERIC_POLICIES` 하나)
 *  · 표시 순서: NEWS2 관찰 차트 순서(RCP 2017 — 호흡수 → SpO₂ → 혈압 → 맥박 → 의식 → 체온) 다음 보조·계측 항목
 *  · 혈압은 한 값이다: `수축기/이완기 mmHg`(LOINC 85354-9 패널) — 두 숫자를 따로 그리지 않는다
 *  · 미측정은 '—'(0·빈칸·정상 아님) · 측정 시각을 함께
 *  · 필드 이름이 화면·원장마다 달랐다(pulse·temp·o2sat·bp 문자열) → `readVitals` 가 정본 키로 읽는다(무엇을 별칭으로 읽었는지 함께)
 *  · `vitalConformance` — 표준에 맞지 않는 측정 기록(별칭 필드·문자열 숫자·혈압 짝 없음·생리적으로 불가능한 값·측정 시각 없음)을 말한다
 *
 * 무엇을 정하지 않는가:
 *  · 이상 판정 임계 — `vitals-thresholds.ts`(환자안전위 개정 대상) · NEWS2 점수 — `news2.ts`
 *  · 🔴 `PLAUSIBLE` 은 **입력 타당성**(기기·전사 오류 탐지) 범위다. 임상 판정이 아니며 값을 숨기거나 고치지 않는다 — "확인 필요"로 말할 뿐.
 */

import { normalizeAcvpu } from './news2';

export type VitalSignKey =
  | 'respiratoryRate' | 'spo2' | 'systolicBp' | 'diastolicBp' | 'heartRate' | 'consciousness' | 'temperature'
  | 'painScore' | 'bloodGlucose' | 'weight' | 'height' | 'bmi';

export type VitalSignGroup = 'core' | 'supplemental' | 'anthropometric';

export interface VitalSignDef {
  key: VitalSignKey;
  /** 화면 약어(한 가지) */
  abbr: string;
  labelKo: string;
  labelEn: string;
  loinc: string;
  /** UCUM 코드(FHIR Quantity.code) — 의식(ACVPU)은 수치가 아니라 없음 */
  ucum: string | null;
  /** 화면 표시 단위 */
  displayUnit: string;
  /** `NUMERIC_POLICIES` 키 — 자릿수·반올림은 거기 하나 */
  numericDomain: string | null;
  group: VitalSignGroup;
  /** 입력 타당성 범위(포함) — 임상 판정 아님 */
  plausible: readonly [number, number] | null;
}

/** 정의 — 배열 순서 = 표시 순서(NEWS2 차트 순서 → 보조 → 계측). */
export const VITAL_SIGN_DEFS: readonly VitalSignDef[] = [
  { key: 'respiratoryRate', abbr: 'RR', labelKo: '호흡수', labelEn: 'Respiratory rate', loinc: '9279-1', ucum: '/min', displayUnit: '/min', numericDomain: 'respiratoryRate', group: 'core', plausible: [0, 80] },
  { key: 'spo2', abbr: 'SpO₂', labelKo: '산소포화도', labelEn: 'Oxygen saturation', loinc: '59408-5', ucum: '%', displayUnit: '%', numericDomain: 'spo2', group: 'core', plausible: [50, 100] },
  { key: 'systolicBp', abbr: 'SBP', labelKo: '수축기혈압', labelEn: 'Systolic BP', loinc: '8480-6', ucum: 'mm[Hg]', displayUnit: 'mmHg', numericDomain: 'systolicBp', group: 'core', plausible: [40, 300] },
  { key: 'diastolicBp', abbr: 'DBP', labelKo: '이완기혈압', labelEn: 'Diastolic BP', loinc: '8462-4', ucum: 'mm[Hg]', displayUnit: 'mmHg', numericDomain: 'diastolicBp', group: 'core', plausible: [10, 200] },
  { key: 'heartRate', abbr: 'HR', labelKo: '맥박', labelEn: 'Heart rate', loinc: '8867-4', ucum: '/min', displayUnit: 'bpm', numericDomain: 'heartRate', group: 'core', plausible: [20, 300] },
  { key: 'consciousness', abbr: 'ACVPU', labelKo: '의식', labelEn: 'Consciousness', loinc: '67775-7', ucum: null, displayUnit: '', numericDomain: null, group: 'core', plausible: null },
  { key: 'temperature', abbr: 'BT', labelKo: '체온', labelEn: 'Body temperature', loinc: '8310-5', ucum: 'Cel', displayUnit: '℃', numericDomain: 'temperature', group: 'core', plausible: [25, 45] },
  { key: 'painScore', abbr: 'Pain', labelKo: '통증(NRS)', labelEn: 'Pain (NRS)', loinc: '72514-3', ucum: '{score}', displayUnit: '/10', numericDomain: null, group: 'supplemental', plausible: [0, 10] },
  { key: 'bloodGlucose', abbr: 'BST', labelKo: '혈당', labelEn: 'Blood glucose', loinc: '41653-7', ucum: 'mg/dL', displayUnit: 'mg/dL', numericDomain: null, group: 'supplemental', plausible: [10, 1500] },
  { key: 'weight', abbr: 'BW', labelKo: '체중', labelEn: 'Body weight', loinc: '29463-7', ucum: 'kg', displayUnit: 'kg', numericDomain: 'weight', group: 'anthropometric', plausible: [0.2, 400] },
  { key: 'height', abbr: 'Ht', labelKo: '신장', labelEn: 'Body height', loinc: '8302-2', ucum: 'cm', displayUnit: 'cm', numericDomain: 'height', group: 'anthropometric', plausible: [20, 260] },
  { key: 'bmi', abbr: 'BMI', labelKo: '체질량지수', labelEn: 'BMI', loinc: '39156-5', ucum: 'kg/m2', displayUnit: 'kg/m²', numericDomain: 'bmi', group: 'anthropometric', plausible: [5, 100] },
];

/** 혈압 패널(수축기/이완기 한 값) LOINC */
export const BLOOD_PRESSURE_PANEL_LOINC = '85354-9';

export const VITAL_SIGN_DEF: Readonly<Record<VitalSignKey, VitalSignDef>> = Object.freeze(
  Object.fromEntries(VITAL_SIGN_DEFS.map((d) => [d.key, d])) as Record<VitalSignKey, VitalSignDef>,
);

/** 표시 순서 — 혈압은 수축기 자리에 한 칸(이완기는 짝으로 붙는다) */
export const VITAL_DISPLAY_ORDER: readonly VitalSignKey[] = VITAL_SIGN_DEFS.map((d) => d.key).filter((k) => k !== 'diastolicBp');

/** 표준 세트 — 화면이 고르는 묶음 */
export const VITAL_SETS = {
  /** NEWS2 관찰 6항목(+혈압 짝) */
  core: ['respiratoryRate', 'spo2', 'systolicBp', 'heartRate', 'consciousness', 'temperature'],
  /** 병동·외래 기본 줄 */
  standard: ['respiratoryRate', 'spo2', 'systolicBp', 'heartRate', 'temperature', 'painScore'],
  anthropometric: ['weight', 'height', 'bmi'],
} as const satisfies Record<string, readonly VitalSignKey[]>;

/**
 * 의식(ACVPU — NEWS2 2017) 표시 라벨. 값 정규화는 `news2.normalizeAcvpu`.
 * A 외 전부가 NEWS2 단일 3점 항목이다(그래서 화면은 A 외를 '주의'로 칠한다 — 점수·대응은 NEWS2 정본).
 */
export const ACVPU_LABEL: Record<'ALERT' | 'CONFUSION' | 'VOICE' | 'PAIN' | 'UNRESPONSIVE', string> = {
  ALERT: 'A 명료', CONFUSION: 'C 새 혼돈', VOICE: 'V 목소리에 반응', PAIN: 'P 통증에 반응', UNRESPONSIVE: 'U 무반응',
};

/** 미측정 표기 — 0·빈칸·'정상' 이 아니다 */
export const VITAL_UNMEASURED_TEXT = '—';

/* ── 읽기: 별칭 필드 → 정본 키 ─────────────────────────────────────────────── */

/** 원장·응답마다 달랐던 이름(실측) → 정본 키. 정본 이름이 있으면 별칭은 읽지 않는다. */
export const VITAL_FIELD_ALIASES: Readonly<Record<string, VitalSignKey>> = {
  rr: 'respiratoryRate', respRate: 'respiratoryRate', respirationRate: 'respiratoryRate', respiration: 'respiratoryRate',
  spO2: 'spo2', SpO2: 'spo2', o2sat: 'spo2', oxygenSaturation: 'spo2', sao2: 'spo2', saturation: 'spo2',
  sbp: 'systolicBp', systolic: 'systolicBp', bpSystolic: 'systolicBp', systolicBP: 'systolicBp',
  dbp: 'diastolicBp', diastolic: 'diastolicBp', bpDiastolic: 'diastolicBp', diastolicBP: 'diastolicBp',
  hr: 'heartRate', pulse: 'heartRate', pulseRate: 'heartRate', pr: 'heartRate',
  temp: 'temperature', bt: 'temperature', bodyTemperature: 'temperature', bodyTemp: 'temperature',
  avpu: 'consciousness', acvpu: 'consciousness', loc: 'consciousness', mentalStatus: 'consciousness',
  pain: 'painScore', nrs: 'painScore', painNrs: 'painScore', vas: 'painScore',
  glucose: 'bloodGlucose', bst: 'bloodGlucose', bloodSugar: 'bloodGlucose',
  bodyWeight: 'weight', wt: 'weight', weightKg: 'weight',
  bodyHeight: 'height', ht: 'height', heightCm: 'height',
};

export type VitalValues = Partial<Record<Exclude<VitalSignKey, 'consciousness'>, number>> & { consciousness?: string };

export interface ReadVitalsResult {
  values: VitalValues;
  /** 별칭으로 읽은 필드(원 이름 → 정본 키) — 정본 이름을 쓰라는 신호 */
  aliasesUsed: Array<{ field: string; key: VitalSignKey }>;
  /** 숫자 문자열로 온 필드 */
  stringNumbers: VitalSignKey[];
  /** 숫자로 읽을 수 없어 버린 필드(값 그대로) */
  unreadable: Array<{ key: VitalSignKey; raw: unknown }>;
  /** `bp: "120/80"` 처럼 문자열 혈압을 쪼갰다 */
  bpStringParsed: boolean;
}

const BP_STRING = /^\s*(\d{2,3})\s*\/\s*(\d{2,3})\s*$/;

function toNumber(raw: unknown): { n: number | null; fromString: boolean } {
  if (raw === null || raw === undefined || raw === '') return { n: null, fromString: false };
  if (typeof raw === 'number') return { n: Number.isFinite(raw) ? raw : null, fromString: false };
  if (typeof raw === 'string') {
    const n = Number(raw.trim());
    return { n: raw.trim() !== '' && Number.isFinite(n) ? n : null, fromString: true };
  }
  // Prisma Decimal·{toNumber} 류
  if (typeof raw === 'object' && raw !== null && typeof (raw as { toNumber?: unknown }).toNumber === 'function') {
    const n = (raw as { toNumber: () => number }).toNumber();
    return { n: Number.isFinite(n) ? n : null, fromString: false };
  }
  return { n: null, fromString: false };
}

/**
 * 어떤 원장·응답이든 정본 키로 읽는다. 값을 고치지 않는다(반올림·범위 보정 없음).
 * 정본 키가 있으면 같은 항목의 별칭은 무시한다(두 값이 다르면 정본이 이긴다).
 */
export function readVitals(raw: Record<string, unknown> | null | undefined): ReadVitalsResult {
  const out: ReadVitalsResult = { values: {}, aliasesUsed: [], stringNumbers: [], unreadable: [], bpStringParsed: false };
  if (!raw || typeof raw !== 'object') return out;
  const canonical = new Set<string>(VITAL_SIGN_DEFS.map((d) => d.key));
  const pending: Array<{ field: string; key: VitalSignKey; value: unknown; alias: boolean }> = [];
  for (const [field, value] of Object.entries(raw)) {
    if (canonical.has(field)) pending.push({ field, key: field as VitalSignKey, value, alias: false });
    else if (VITAL_FIELD_ALIASES[field]) pending.push({ field, key: VITAL_FIELD_ALIASES[field], value, alias: true });
  }
  // 문자열 혈압 "120/80"
  for (const f of ['bloodPressure', 'bp', 'BP']) {
    const v = raw[f];
    if (typeof v === 'string') {
      const m = BP_STRING.exec(v);
      if (m) {
        pending.push({ field: f, key: 'systolicBp', value: Number(m[1]), alias: true });
        pending.push({ field: f, key: 'diastolicBp', value: Number(m[2]), alias: true });
        out.bpStringParsed = true;
      }
    }
  }
  const seenCanonical = new Set(pending.filter((p) => !p.alias && p.value != null && p.value !== '').map((p) => p.key));
  for (const p of pending) {
    if (p.alias && seenCanonical.has(p.key)) continue;
    if (p.value === null || p.value === undefined || p.value === '') continue;
    if (p.key === 'consciousness') {
      if (typeof p.value === 'string' && p.value.trim()) out.values.consciousness = p.value.trim();
      else out.unreadable.push({ key: p.key, raw: p.value });
    } else {
      const { n, fromString } = toNumber(p.value);
      if (n == null) { out.unreadable.push({ key: p.key, raw: p.value }); continue; }
      if ((out.values as Record<string, number>)[p.key] !== undefined) continue;
      (out.values as Record<string, number>)[p.key] = n;
      if (fromString && !(p.field === 'bloodPressure' || p.field === 'bp' || p.field === 'BP')) out.stringNumbers.push(p.key);
    }
    if (p.alias && !out.aliasesUsed.some((a) => a.field === p.field && a.key === p.key)) out.aliasesUsed.push({ field: p.field, key: p.key });
  }
  return out;
}

/* ── 표준 적합성 ───────────────────────────────────────────────────────── */

export type VitalConformanceCode =
  | 'ALIAS_FIELD'        // 정본 이름이 아닌 필드로 왔다
  | 'STRING_NUMBER'      // 숫자가 문자열로 왔다
  | 'BP_STRING'          // 혈압이 "120/80" 문자열로 왔다
  | 'UNREADABLE'         // 숫자로 읽을 수 없다
  | 'BP_INCOMPLETE'      // 수축기·이완기 중 하나만
  | 'BP_INVERTED'        // 이완기 ≥ 수축기
  | 'IMPLAUSIBLE'        // 입력 타당성 범위 밖(기기·전사 오류 의심)
  | 'CONSCIOUSNESS_SCALE' // 의식이 ACVPU 로 접히지 않는 다른 척도(한글 5단계 등) — 원문 그대로 보이고 판정하지 않는다
  | 'NO_MEASURED_AT'     // 측정 시각 없음
  | 'FUTURE_MEASURED_AT'; // 측정 시각이 미래

export interface VitalConformanceIssue {
  code: VitalConformanceCode;
  key?: VitalSignKey;
  field?: string;
  value?: unknown;
  /** ERROR = 값을 믿고 판정하기 전에 확인 · INFO = 표기·이름 표준화 대상 */
  severity: 'ERROR' | 'INFO';
}

export const VITAL_CONFORMANCE_TEXT: Record<VitalConformanceCode, string> = {
  ALIAS_FIELD: '표준 이름이 아닌 필드',
  STRING_NUMBER: '숫자가 문자로 저장됨',
  BP_STRING: '혈압이 문자열로 저장됨',
  UNREADABLE: '숫자로 읽을 수 없는 값',
  BP_INCOMPLETE: '혈압 짝이 없음(수축기/이완기 중 하나)',
  BP_INVERTED: '이완기가 수축기 이상',
  IMPLAUSIBLE: '입력 타당성 범위 밖 — 측정·입력 확인',
  CONSCIOUSNESS_SCALE: '의식이 ACVPU 가 아닌 척도로 기록됨',
  NO_MEASURED_AT: '측정 시각 없음',
  FUTURE_MEASURED_AT: '측정 시각이 미래',
};

/**
 * 측정 기록 한 건이 표시 표준에 맞는지 — 고치지 않고 말한다.
 * `measuredAt` 을 넘기지 않으면(undefined) 시각 검사는 하지 않는다 · `null` 이면 "없음"이다.
 */
export function vitalConformance(
  raw: Record<string, unknown> | null | undefined,
  opts: { measuredAt?: string | Date | null; now?: Date } = {},
): { values: VitalValues; issues: VitalConformanceIssue[] } {
  const r = readVitals(raw);
  const issues: VitalConformanceIssue[] = [];
  for (const a of r.aliasesUsed) if (!(r.bpStringParsed && (a.field === 'bloodPressure' || a.field === 'bp' || a.field === 'BP'))) issues.push({ code: 'ALIAS_FIELD', field: a.field, key: a.key, severity: 'INFO' });
  if (r.bpStringParsed) issues.push({ code: 'BP_STRING', key: 'systolicBp', severity: 'INFO' });
  for (const k of r.stringNumbers) issues.push({ code: 'STRING_NUMBER', key: k, severity: 'INFO' });
  for (const u of r.unreadable) issues.push({ code: 'UNREADABLE', key: u.key, value: u.raw, severity: 'ERROR' });
  const v = r.values;
  if (v.consciousness != null && normalizeAcvpu(v.consciousness) == null) issues.push({ code: 'CONSCIOUSNESS_SCALE', key: 'consciousness', value: v.consciousness, severity: 'INFO' });
  if ((v.systolicBp == null) !== (v.diastolicBp == null)) issues.push({ code: 'BP_INCOMPLETE', key: v.systolicBp == null ? 'systolicBp' : 'diastolicBp', severity: 'INFO' });
  if (v.systolicBp != null && v.diastolicBp != null && v.diastolicBp >= v.systolicBp) issues.push({ code: 'BP_INVERTED', key: 'diastolicBp', severity: 'ERROR' });
  for (const d of VITAL_SIGN_DEFS) {
    if (!d.plausible || d.key === 'consciousness') continue;
    const n = (v as Record<string, number | undefined>)[d.key];
    if (n != null && (n < d.plausible[0] || n > d.plausible[1])) issues.push({ code: 'IMPLAUSIBLE', key: d.key, value: n, severity: 'ERROR' });
  }
  if (opts.measuredAt !== undefined) {
    const t = opts.measuredAt == null ? NaN : new Date(opts.measuredAt).getTime();
    if (!Number.isFinite(t)) issues.push({ code: 'NO_MEASURED_AT', severity: 'INFO' });
    else if (t > (opts.now ?? new Date()).getTime() + 5 * 60_000) issues.push({ code: 'FUTURE_MEASURED_AT', severity: 'ERROR' });
  }
  return { values: v, issues };
}
