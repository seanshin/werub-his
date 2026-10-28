/**
 * ICU 중증도 점수 실계산 (mock 랜덤 → 실제 IcuRecord 기반).
 *
 * ⚠️ 정직성: HIS IcuRecord는 침상 바이탈·GCS·환기설정만 보유(혈액검사 미연동).
 *  - NEWS2: 바이탈만으로 산정 → **완전 실계산**.
 *  - APACHE II / SOFA: 검사 성분(pH·Na·K·Cr·Hct·WBC·혈소판·빌리루빈·ABG)이 없어
 *    **침상 산출 가능 성분만 실계산**하고 검사 성분은 `missingParams`로 명시(미평가=0).
 *    LIS 연동 시 완전 산정 가능. (랜덤 조작 제거가 핵심 — 실제 환자값 반영)
 */

import { scoreNews2, normalizeAcvpu, type News2RiskLevel, type News2Breakdown } from '@hospital-run/shared';

export interface IcuVitalRec {
  heartRate?: number | null; systolicBp?: number | null; diastolicBp?: number | null;
  spo2?: number | null; respiratoryRate?: number | null; temperature?: number | string | null;
  gcScore?: number | null; consciousness?: string | null;
  fio2?: number | null; ventMode?: string | null; outputUrine?: number | null;
}

const num = (v: number | string | null | undefined): number | null =>
  v == null ? null : typeof v === 'string' ? (Number.isFinite(+v) ? +v : null) : v;

const map = (rec: IcuVitalRec): number | null => {
  const s = num(rec.systolicBp), d = num(rec.diastolicBp);
  if (s == null || d == null) return null;
  return Math.round((s + 2 * d) / 3);
};

/**
 * 보충산소 투여 여부 — ICU 기록에는 boolean 이 없어 FiO₂·환기모드에서 **관측을 접는다**.
 * 🔴 셋 다 없으면 `null`(모름)이다. `false` 로 가정하지 않는다 —
 *    실내공기로 단정하면 NEWS2 가 2점 낮아지고, 그만큼 조기경보가 조용히 사라진다.
 */
const onOxygen = (rec: IcuVitalRec): boolean | null => {
  const f = num(rec.fio2);
  if (f != null) return f > 21;
  if (rec.ventMode) return true;
  return null;
};

/** 산출 불가 사유에 쓰는 항목 라벨 — 화면이 "무엇이 없어서 못 냈는지"를 말할 수 있게 */
const MISSING_LABEL = {
  respiratoryRate: '호흡수', spo2: 'SpO₂', supplementalO2: '보충산소(FiO₂·환기모드)',
  systolicBp: '수축기혈압', heartRate: '맥박', temperature: '체온', consciousness: '의식(ACVPU)',
} as const;

export type News2ComputeResult = {
  /** 🔴 산출 불가는 `null` 이다 — 0점이 아니다 */
  score: number | null;
  riskLevel: News2RiskLevel | 'UNSCORABLE';
  params: Partial<News2Breakdown>;
  /** 관측되지 않아 산출할 수 없었던 항목 */
  missing: string[];
};

// ───────────────────────── NEWS2 ─────────────────────────
/**
 * 🔴 채점 정본은 shared `scoreNews2`(RCP 2017) 하나다 — 여기에 점수표를 다시 적지 않는다.
 *    2026-08-19 수렴 전 이 함수는 자기 판을 갖고 있었고 **위험등급 밴드가 정본과 달랐다**:
 *      단일 3점 → `MEDIUM`(정본은 LOW_MEDIUM) · 총점 1~4 → `LOW_MEDIUM`(정본은 LOW).
 *    같은 환자가 ICU 보드와 환자 안전바에서 다른 등급으로 보였다(P12).
 * 🔴 그리고 관측되지 않은 항목을 **빼고 합산**해 부분 점수를 총점처럼 내놓았다.
 *    이제 7요소가 전부 관측된 경우에만 점수를 내고, 아니면 무엇이 없는지 말한다.
 */
export function computeNews2(rec: IcuVitalRec): News2ComputeResult {
  const supplementalO2 = onOxygen(rec);
  const input = {
    respiratoryRate: num(rec.respiratoryRate) ?? undefined,
    spO2: num(rec.spo2) ?? undefined,
    supplementalO2: supplementalO2 ?? undefined,
    systolicBp: num(rec.systolicBp) ?? undefined,
    heartRate: num(rec.heartRate) ?? undefined,
    temperature: num(rec.temperature) ?? undefined,
    // ICU·플로우시트는 구 AVPU('VERBAL')를 쓴다 — 정본이 ACVPU('VOICE')로 접는다(운영 실측 VERBAL 4건)
    consciousness: normalizeAcvpu(rec.consciousness) ?? undefined,
  };

  const result = scoreNews2(input);
  if (result) {
    return { score: result.totalScore, riskLevel: result.riskLevel, params: result.scoreBreakdown, missing: [] };
  }

  const missing = (Object.keys(MISSING_LABEL) as Array<keyof typeof MISSING_LABEL>)
    .filter((k) => input[k === 'spo2' ? 'spO2' : k === 'supplementalO2' ? 'supplementalO2' : k] === undefined)
    .map((k) => MISSING_LABEL[k]);
  return { score: null, riskLevel: 'UNSCORABLE', params: {}, missing };
}

// ───────────────────────── APACHE II (침상 성분 실계산) ─────────────────────────
export function computeApache2(rec: IcuVitalRec, ageYears?: number | null) {
  const pts: Record<string, number> = {};
  const t = num(rec.temperature);
  if (t != null) pts.temp = t >= 41 ? 4 : t >= 39 ? 3 : t >= 38.5 ? 1 : t >= 36 ? 0 : t >= 34 ? 1 : t >= 32 ? 2 : t >= 30 ? 3 : 4;
  const m = map(rec);
  if (m != null) pts.map = m >= 160 ? 4 : m >= 130 ? 3 : m >= 110 ? 2 : m >= 70 ? 0 : m >= 50 ? 2 : 4;
  const hr = num(rec.heartRate);
  if (hr != null) pts.hr = hr >= 180 ? 4 : hr >= 140 ? 3 : hr >= 110 ? 2 : hr >= 70 ? 0 : hr >= 55 ? 2 : hr >= 40 ? 3 : 4;
  const rr = num(rec.respiratoryRate);
  if (rr != null) pts.rr = rr >= 50 ? 4 : rr >= 35 ? 3 : rr >= 25 ? 1 : rr >= 12 ? 0 : rr >= 10 ? 1 : rr >= 6 ? 2 : 4;
  const gcs = num(rec.gcScore);
  const gcsPoints = gcs != null ? 15 - gcs : 0;
  const agePoints = ageYears == null ? 0 : ageYears >= 75 ? 6 : ageYears >= 65 ? 5 : ageYears >= 55 ? 3 : ageYears >= 45 ? 2 : 0;

  const physiologyPoints = Object.values(pts).reduce((a, b) => a + b, 0);
  const score = physiologyPoints + gcsPoints + agePoints;
  const mortalityEstimate = score >= 35 ? 85 : score >= 25 ? 55 : score >= 20 ? 40 : score >= 15 ? 25 : score >= 10 ? 15 : 8;
  return {
    score, physiologyPoints, gcsPoints, agePoints,
    assessedParams: Object.keys(pts).concat(gcs != null ? ['gcs'] : []),
    missingParams: ['arterialPh', 'sodium', 'potassium', 'creatinine', 'hematocrit', 'wbc', 'oxygenation(A-aDO2)'],
    note: '검사수치(ABG·전해질·신기능·혈액) 미연동 — 침상 바이탈·GCS·연령 기반 부분 산정. LIS 연동 시 완전 산정.',
    mortalityEstimate,
  };
}

// ───────────────────────── SOFA (침상 성분 실계산) ─────────────────────────
export function computeSofa(rec: IcuVitalRec) {
  const organScores: Record<string, number> = {};
  const assessed: string[] = [];
  const gcs = num(rec.gcScore);
  if (gcs != null) { organScores.cns = gcs >= 15 ? 0 : gcs >= 13 ? 1 : gcs >= 10 ? 2 : gcs >= 6 ? 3 : 4; assessed.push('cns'); }
  const m = map(rec);
  if (m != null) { organScores.cardiovascular = m >= 70 ? 0 : 1; assessed.push('cardiovascular'); } // 승압제 용량 미연동 → 최대 1점
  const urine = num(rec.outputUrine);
  if (urine != null) { organScores.renal = urine >= 500 ? 0 : urine >= 200 ? 3 : 4; assessed.push('renal(요량)'); }

  const totalScore = Object.values(organScores).reduce((a, b) => a + b, 0);
  const mortalityEstimate = totalScore >= 12 ? 60 : totalScore >= 8 ? 33 : totalScore >= 5 ? 15 : totalScore >= 2 ? 7 : 2;
  return {
    totalScore, organScores,
    assessedComponents: assessed,
    missingComponents: ['respiration(PaO2/FiO2·ABG)', 'coagulation(혈소판)', 'liver(빌리루빈)', 'cardiovascular(승압제 용량)'],
    note: '검사 성분(ABG·혈소판·빌리루빈) 및 승압제 용량 미연동 — GCS·MAP·요량 기반 부분 산정. LIS/약물 연동 시 완전 산정.',
    mortalityEstimate,
  };
}
