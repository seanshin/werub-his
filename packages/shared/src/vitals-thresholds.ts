/**
 * 활력 이상 판정 임계 — **정본 하나**(2026-10-01 API `vitals-evaluate` 에서 shared 로 이동).
 *
 * 🔴 같은 측정치를 화면마다 다른 숫자로 판정했다: 간호 스테이션(SBP>140·HR>100)·입원 상세(SpO2<94·RR>24)·
 *    플로시트(SBP>160·HR>120)·응급(HR>100)·ICU(HR>130)·의사 담당 환자 상태(HR>140 위급)·FE `VITAL_RANGES`.
 *    환자안전위가 `clinical.vitals.thresholds` 를 개정해도 서버 알림만 바뀌고 화면들은 각자 옛 숫자였다.
 *    수치는 여기 하나 — 서버는 config 오버라이드를 병합하고, 화면은 `GET /api/v1/vitals/thresholds` 로 병합본을 받는다.
 * NEWS2 점수 밴드(국제 표준)·채점 도구(CURB-65·qSOFA·APACHE·Aldrete)·PACU 밀착감시(의도된 더 엄격한 기준)는 대상 밖.
 */

/** 판정에 쓰는 측정치(미측정은 null/undefined) */
export interface VitalsFlagInput {
  systolicBp?: number | null;
  diastolicBp?: number | null;
  heartRate?: number | null;
  temperature?: number | null;
  spo2?: number | null;
  respiratoryRate?: number | null;
  painScore?: number | null;
}

export interface VitalThreshold {
  low: number | null;   // 위급 저역치(≤)
  high: number | null;  // 위급 고역치(≥)
  warnLow: number | null;  // 주의 저역치 — 타임라인 강조용(경보 미발동)
  warnHigh: number | null; // 주의 고역치
  unit: string;
  label: string;
}
export type VitalsThresholds = Record<
  'systolicBp' | 'diastolicBp' | 'heartRate' | 'temperature' | 'spo2' | 'respiratoryRate' | 'painScore',
  VitalThreshold
>;

/**
 * 이상 판정 임계치(정본·기본값) — 위급(crit)+주의(warn) 2층. 경계값 포함(≤/≥).
 * 🔴 2026-08-04 3중 정본 통합(P0-a③): record-issues 의 VITAL_RULES(warn 층 포함)를 여기로 편입 —
 *    수치 선언은 이 파일 하나. 운영 오버라이드는 config `clinical.vitals.thresholds`(JSON·부분 병합,
 *    환자안전위 개정 표면) → mergeVitalsThresholds(). NEWS2 점수 밴드는 국제 표준이라 통합 제외.
 */
export const VITALS_THRESHOLDS: VitalsThresholds = {
  systolicBp: { low: 80, high: 180, warnLow: 90, warnHigh: 140, unit: 'mmHg', label: 'BP' },
  diastolicBp: { low: 50, high: 110, warnLow: null, warnHigh: null, unit: 'mmHg', label: 'DBP' },
  heartRate: { low: 40, high: 130, warnLow: 60, warnHigh: 100, unit: 'bpm', label: 'HR' },
  temperature: { low: 35.0, high: 38.5, warnLow: null, warnHigh: 37.5, unit: '℃', label: 'BT' },
  spo2: { low: 90, high: null, warnLow: 95, warnHigh: null, unit: '%', label: 'SpO2' }, // 저산소만 이상
  respiratoryRate: { low: 8, high: 30, warnLow: null, warnHigh: 22, unit: '/min', label: 'RR' }, // 단위 = vital-signs 정본 displayUnit(2026-10-07 '회/분' 이 수치 정책 '/min' 과 갈라져 있었다)
  painScore: { low: null, high: 7, warnLow: null, warnHigh: null, unit: '/10', label: 'Pain' }, // 고통증만 이상
};

/**
 * config 오버라이드 병합 — 부분 JSON({systolicBp:{high:170}})을 기본값 위에 얹는다.
 * 숫자/null 만 수용·미상 키 무시·low≥high 역전은 해당 항목 무시(판정이 죽는 것 방지) — fail-safe.
 *
 * 🔴 (2026-09-03) "무시"가 조용하면 환자안전위가 개정한 임계가 반영되지 않은 채 화면은
 *    "적용됨"이라 말한다 — 무엇을 버렸는지(dropped/inverted)를 함께 돌려준다
 *    (parseFhirStaffRoles 의 `dropped` 관례). 판정 경로는 기존 서명 그대로 쓴다.
 */
export function mergeVitalsThresholdsDetailed(override?: unknown): {
  thresholds: VitalsThresholds;
  /** 정본에 없는 키(오타·개명) — 통째로 무시된 것 */
  droppedKeys: string[];
  /** low≥high 역전으로 무시된 항목 */
  invertedKeys: string[];
} {
  if (!override || typeof override !== 'object') {
    return { thresholds: VITALS_THRESHOLDS, droppedKeys: [], invertedKeys: [] };
  }
  const out: VitalsThresholds = JSON.parse(JSON.stringify(VITALS_THRESHOLDS));
  const known = new Set(Object.keys(out));
  const droppedKeys = Object.keys(override as Record<string, unknown>).filter((k) => !known.has(k));
  const invertedKeys: string[] = [];
  for (const key of Object.keys(out) as (keyof VitalsThresholds)[]) {
    const o = (override as Record<string, unknown>)[key];
    if (!o || typeof o !== 'object') continue;
    const merged = { ...out[key] };
    for (const f of ['low', 'high', 'warnLow', 'warnHigh'] as const) {
      const v = (o as Record<string, unknown>)[f];
      if (v === null || typeof v === 'number') merged[f] = v as number | null;
    }
    if (merged.low !== null && merged.high !== null && merged.low >= merged.high) { invertedKeys.push(key); continue; } // 역전=무시
    out[key] = merged;
  }
  return { thresholds: out, droppedKeys, invertedKeys };
}

export function mergeVitalsThresholds(override?: unknown): VitalsThresholds {
  return mergeVitalsThresholdsDetailed(override).thresholds;
}

const isOutRange = (v: number, low: number | null, high: number | null): boolean =>
  (low !== null && v <= low) || (high !== null && v >= high);

/** 항목별 판정 — 위급(crit 역치)·주의(warn 역치)·정상·미측정(`null`) */
export type VitalItemFlag = 'CRITICAL' | 'WARNING' | 'NORMAL' | null;
export type VitalItemFlags = Record<keyof VitalsThresholds, VitalItemFlag>;

/**
 * 항목별 이상 표시(2026-10-01) — 화면이 임계 숫자를 따로 적지 않게 **서버가 정본 임계로 판정해** 싣는다.
 * 🔴 간호 스테이션은 SBP>140·HR>100 같은 자기 숫자를 적어 두었고(4번째 정본), 호흡수는 규칙이 아예 없었다.
 * 경계값 포함(≤/≥) · 위급이 주의를 이긴다 · 미측정은 `null`(정상이 아니다).
 */
export function vitalItemFlags(m: VitalsFlagInput, thresholds: VitalsThresholds = VITALS_THRESHOLDS): VitalItemFlags {
  const one = (v: number | null | undefined, t: VitalThreshold): VitalItemFlag => {
    if (v === null || v === undefined || !Number.isFinite(v)) return null;
    if (isOutRange(v, t.low, t.high)) return 'CRITICAL';
    if ((t.warnLow !== null && v <= t.warnLow) || (t.warnHigh !== null && v >= t.warnHigh)) return 'WARNING';
    return 'NORMAL';
  };
  const T = thresholds;
  return {
    systolicBp: one(m.systolicBp, T.systolicBp),
    diastolicBp: one(m.diastolicBp, T.diastolicBp),
    heartRate: one(m.heartRate, T.heartRate),
    temperature: one(m.temperature, T.temperature),
    spo2: one(m.spo2, T.spo2),
    respiratoryRate: one(m.respiratoryRate, T.respiratoryRate),
    painScore: one(m.painScore, T.painScore),
  };
}

/** 두 판정 중 더 나쁜 것(BP 수축기·이완기 묶음 등) */
export function worseVitalFlag(a: VitalItemFlag, b: VitalItemFlag): VitalItemFlag {
  if (a === 'CRITICAL' || b === 'CRITICAL') return 'CRITICAL';
  if (a === 'WARNING' || b === 'WARNING') return 'WARNING';
  if (a === 'NORMAL' || b === 'NORMAL') return 'NORMAL';
  return null;
}

/**
 * 정상(주의 역치 안쪽) 범위 표기 — 화면이 "90–140" 같은 참고 범위를 따로 적지 않게.
 * 주의 역치는 경계 포함(≤/≥)이라 정상은 그 **안쪽**이다. 주의 층이 없으면 위급 역치로 잡는다.
 */
export function vitalNormalRangeText(t: VitalThreshold): string | null {
  const lo = t.warnLow ?? t.low;
  const hi = t.warnHigh ?? t.high;
  if (lo === null && hi === null) return null;
  if (lo === null) return `<${hi}`;
  if (hi === null) return `>${lo}`;
  return `${lo}–${hi}`;
}

/**
 * 체온 상태 라벨 — 고열(위급 고역치)·발열(주의 고역치)·저체온(위급 저역치). 정상·미측정은 null.
 * 🔴 FE `tempStatus` 가 38.5/37.5/35 를 따로 적고 있었다(같은 숫자라도 개정되면 갈라진다).
 */
export function temperatureStatus(temp: number | null | undefined, t: VitalThreshold): 'HYPERTHERMIA' | 'FEVER' | 'HYPOTHERMIA' | null {
  if (temp == null || !Number.isFinite(Number(temp))) return null;
  const v = Number(temp);
  if (t.high !== null && v >= t.high) return 'HYPERTHERMIA';
  if (t.warnHigh !== null && v >= t.warnHigh) return 'FEVER';
  if (t.low !== null && v <= t.low) return 'HYPOTHERMIA';
  return null;
}
