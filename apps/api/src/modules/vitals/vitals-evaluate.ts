/**
 * 활력징후 판정 — 순수 로직·정본 임계치 (2026-07-30 통합)
 *
 * 종전 문제: 임계치가 **세 벌**로 갈라져 있었음(nurse-station SBP≤80 / vitals.service SBP≤90 /
 * 진료화면 FE SBP≥140). 같은 측정치가 경로에 따라 이상/정상으로 갈리므로 판정은 여기 하나로 모은다.
 * 값은 nurse-station(임상 알림 발동 기준·NEWS2 동반 경로)을 정본으로 채택.
 */

import {
  roundBy,
  canScoreNews2 as sharedCanScoreNews2,
  normalizeAcvpu,
  ACVPU_VALUES,
  type Acvpu,
} from '@hospital-run/shared';

export interface VitalsMeasurement {
  systolicBp?: number | null;
  diastolicBp?: number | null;
  heartRate?: number | null;
  temperature?: number | null;
  spo2?: number | null;
  respiratoryRate?: number | null;
  painScore?: number | null;
  weight?: number | null;
  height?: number | null;
  /** NEWS2 7요소 중 관측 항목 — **미관측은 `null`/`undefined`**(`false` 로 가정하지 않는다) */
  supplementalO2?: boolean | null;
  /** ACVPU — ALERT|CONFUSION|VOICE|PAIN|UNRESPONSIVE. 미관측은 `null` */
  consciousness?: string | null;
}

/**
 * ACVPU 정본 어휘 — 정본은 shared(`ACVPU_VALUES`)다. 여기서는 재수출만 한다.
 * 🔴 어휘를 두 곳에 적으면 갈라진다(실제로 ICU·플로우시트는 구 AVPU 'VERBAL' 을 쓰고 있었다).
 *    DTO 는 이 목록으로 입력을 좁히고, 이미 저장된 구 어휘는 `normalizeAcvpu` 가 접는다.
 */
export const ACVPU_LEVELS = ACVPU_VALUES;
export type AcvpuLevel = Acvpu;
export const isAcvpu = (v: unknown): v is Acvpu => normalizeAcvpu(v) === v;

// 🔴 임계 정본은 shared `vitals-thresholds.ts` 로 옮겼다(2026-10-01) — 화면도 같은 숫자를 쓰게. 여기는 재수출만.
export {
  VITALS_THRESHOLDS, mergeVitalsThresholds, mergeVitalsThresholdsDetailed, vitalItemFlags, worseVitalFlag,
  type VitalThreshold, type VitalsThresholds, type VitalItemFlag, type VitalItemFlags,
} from '@hospital-run/shared';
import { VITALS_THRESHOLDS, type VitalsThresholds } from '@hospital-run/shared';

/**
 * BMI — kg/m². 신장 0 이하/미측정이면 undefined.
 * 자릿수·반올림은 수치 정책 정본(NUMERIC_POLICIES.bmi) 경유 — 하드코딩하면 정책을 바꿔도 여기만 남는다.
 * (기본 정책 = 소수 1자리 반올림 · 종전 산식과 값 동일)
 */
export function calcBmi(weight?: number | null, height?: number | null): number | undefined {
  if (!weight || !height || height <= 0) return undefined;
  const m = height / 100;
  return roundBy(weight / (m * m), 'bmi') ?? undefined;
}

function isOut(v: number | null | undefined, low: number | null, high: number | null): boolean {
  if (v === null || v === undefined) return false;
  if (low !== null && v <= low) return true;
  if (high !== null && v >= high) return true;
  return false;
}

export interface VitalsEvaluation {
  isAbnormal: boolean;
  /** 알림 문구용 이상 항목 라벨(예: "BP 190/100", "SpO2 88%") */
  abnormalLabels: string[];
  bmi?: number;
}

/** 측정치 → 이상 여부·라벨·BMI. 결정적·부작용 없음. */
export function evaluateVitals(m: VitalsMeasurement, thresholds: VitalsThresholds = VITALS_THRESHOLDS): VitalsEvaluation {
  const labels: string[] = [];
  const T = thresholds;

  if (isOut(m.systolicBp, T.systolicBp.low, T.systolicBp.high)) labels.push(`BP ${m.systolicBp}/${m.diastolicBp ?? '?'}`);
  else if (isOut(m.diastolicBp, T.diastolicBp.low, T.diastolicBp.high)) labels.push(`BP ${m.systolicBp ?? '?'}/${m.diastolicBp}`);
  if (isOut(m.heartRate, T.heartRate.low, T.heartRate.high)) labels.push(`HR ${m.heartRate}`);
  if (isOut(m.spo2, T.spo2.low, T.spo2.high)) labels.push(`SpO2 ${m.spo2}%`);
  if (isOut(m.temperature, T.temperature.low, T.temperature.high)) labels.push(`BT ${m.temperature}℃`);
  if (isOut(m.respiratoryRate, T.respiratoryRate.low, T.respiratoryRate.high)) labels.push(`RR ${m.respiratoryRate}`);
  if (isOut(m.painScore, T.painScore.low, T.painScore.high)) labels.push(`Pain ${m.painScore}/10`);

  return { isAbnormal: labels.length > 0, abnormalLabels: labels, bmi: calcBmi(m.weight, m.height) };
}

/**
 * NEWS2 산출 가능 여부 — **7요소 전부 관측된 경우에만**.
 *
 * 🔴 2026-08-18 봉합: 종전엔 수치 5요소만 보고 산출하면서, 나머지 두 요소를
 *    `supplementalO2: false` · `consciousness: 'ALERT'` 로 **하드코딩**해 저장했다.
 *    산소를 투여 중이거나 의식이 저하된 환자의 NEWS2 가 **최대 5점 낮게**(보충산소 2점 +
 *    의식 3점) 기록되고, 그 가정이 EarlyWarningScore 라는 **법정기록에 관측 사실로** 박혔다.
 *    `null` 저장은 스키마상 불가(두 컬럼 모두 NOT NULL)이며, 값을 지어내는 것보다
 *    **산출하지 않는 것**이 옳다 — 관측되지 않은 점수는 "0점"이 아니라 "산출 불가"다.
 *    화면은 두 항목을 입력받아 넘긴다(입력하면 그때부터 NEWS2 가 산출된다).
 *
 * 🔴 2026-08-19: 판정 자체는 shared `canScoreNews2` 정본으로 위임한다 —
 *    같은 판정이 여기와 nursing·icu 에 따로 적혀 있으면 다시 갈라진다.
 *    의식 어휘도 정본이 접는다(ICU·플로우시트의 구 AVPU 'VERBAL' 포함).
 */
export function canScoreNews2(m: VitalsMeasurement): boolean {
  return sharedCanScoreNews2({
    respiratoryRate: m.respiratoryRate ?? undefined,
    spO2: m.spo2 ?? undefined,
    supplementalO2: typeof m.supplementalO2 === 'boolean' ? m.supplementalO2 : undefined,
    systolicBp: m.systolicBp ?? undefined,
    heartRate: m.heartRate ?? undefined,
    temperature: m.temperature ?? undefined,
    consciousness: normalizeAcvpu(m.consciousness) ?? undefined,
  });
}
