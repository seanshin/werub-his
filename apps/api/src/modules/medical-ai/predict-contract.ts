/**
 * AI 서버 예측 API 계약 어댑터(2026-10-07) — 요청을 상류 계약대로 싸고, 응답에 HIS 화면이 읽는 정규화 필드를 덧붙인다.
 *
 * 🔴 실측: HIS 는 세 예측을 **상류 계약과 다른 모양**으로 불렀다(상류 정본 `AI_server/routes/medical_advanced.py`).
 *    - 재입원: 평면 필드 → 상류는 `patient_data` 필수 → **늘 400**
 *    - 부작용: `drugs` → 상류는 `medications` 필수 → **늘 400**
 *    - 합병증: `age`·`sex` 를 최상위로 → 상류는 `patient_info.age/sex` 만 읽는다 → **나이·성별이 모델에 닿지 않았다**
 *    - 응답: 상류는 `{ prediction: {...}, model, tokens, ... }` 인데 화면들은 최상위 `risk_level`·`complications` 를 읽었다
 *      → 성공해도 위험도가 그려진 적이 없다(재원 목록 배지 '?' · 응급 합병증 '산출 불가').
 * 🔴 정규화는 **상류가 준 필드만** 옮긴다 — 없는 값은 null(지어내지 않는다) · 모르는 위험 어휘는 null · 원 응답(prediction 등)은 그대로 둔다.
 */

import { HttpException } from '@nestjs/common';

export type HisRiskLevel = 'LOW' | 'MODERATE' | 'HIGH';
/** 상류 `low/medium/high` → HIS `LOW/MODERATE/HIGH` · 그 밖(빈 값·다른 어휘)은 null */
export function hisRiskLevel(v: unknown): HisRiskLevel | null {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (s === 'low') return 'LOW';
  if (s === 'medium' || s === 'moderate') return 'MODERATE';
  if (s === 'high') return 'HIGH';
  return null;
}

const strs = (v: unknown): string[] | null => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : null);
const nonEmpty = <T>(a: T[] | undefined | null) => (a && a.length ? a : undefined);

export function readmissionBody(d: { age: number; sex: string; diagnoses: string[]; procedures?: string[]; lengthOfStay?: number | null; previousAdmissions?: number | null; comorbidities?: string[]; labResults?: string | null; admissionInfo?: string | null }) {
  // patient_data 는 상류가 JSON 그대로 프롬프트에 싣는다 — 권장 키(2026-10-07 회신 · HOSPITAL score):
  //   diagnosis·lab_results(퇴원 시 Hb·Na)·admission_info(응급/예정·입원 중 시술·종양내과)·past_admissions(최근 1년)·length_of_stay
  //   없는 값은 빼고 보낸다(undefined 는 JSON 에서 사라진다) — 기록 부재에서 값을 추정하지 않는다
  return {
    patient_data: {
      age: d.age, sex: d.sex,
      diagnosis: d.diagnoses.length ? d.diagnoses.join(', ') : undefined,
      diagnoses: nonEmpty(d.diagnoses), procedures: nonEmpty(d.procedures), comorbidities: nonEmpty(d.comorbidities),
      length_of_stay: d.lengthOfStay ?? undefined,
      past_admissions: d.previousAdmissions ?? undefined,
      lab_results: d.labResults ?? undefined,
      admission_info: d.admissionInfo ?? undefined,
    },
  };
}

export function complicationBody(d: { age: number; sex: string; diagnosis: string; procedure?: string; comorbidities?: string[]; vitals?: Record<string, unknown>; labs?: Record<string, unknown> }) {
  return {
    diagnosis: d.diagnosis,
    patient_info: {
      age: d.age, sex: d.sex,
      conditions: nonEmpty(d.comorbidities),
      // 상류는 lab_results 를 문자열로 읽는다 — 객체면 JSON 문자열로(값을 바꾸지 않는다)
      lab_results: d.labs && Object.keys(d.labs).length ? JSON.stringify(d.labs) : undefined,
    },
  };
}

export function adverseDrugBody(d: { drugs: string[]; age?: number; sex?: string; diagnoses?: string[]; allergies?: string[]; renalFunction?: string; hepaticFunction?: string }) {
  return {
    medications: d.drugs,
    patient_info: {
      age: d.age, sex: d.sex,
      conditions: nonEmpty(d.diagnoses), allergies: nonEmpty(d.allergies),
      renal_function: d.renalFunction, hepatic_function: d.hepaticFunction,
    },
  };
}

export type PredictKind = 'readmission' | 'complication' | 'adverse-drug';
/** 종류별로 상류 prediction 에 하나는 있어야 할 필드(정규화가 읽는 것) */
const PREDICTION_FIELDS: Record<PredictKind, string[]> = {
  readmission: ['risk_level', 'score', 'risk_factors', 'preventive_measures'],
  complication: ['overall_risk', 'complications'],
  'adverse-drug': ['overall_risk', 'individual_risks'],
};

/** 응답 정규화 — 원 응답에 화면이 읽는 필드를 덧붙인다(원 필드는 그대로) */
export function normalizePrediction(kind: PredictKind, body: unknown): Record<string, unknown> {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  // 🔴 (2026-10-07 AI 서버 회신) 모델 출력이 JSON 형식을 못 맞추면 상류가 `{"response": "원문"}` 으로 싸서 **200** 으로 보냈다
  //    (상류는 502 generation_failed 로 바꾸기로 함 — 적용 전·후 모두). prediction 이 없으면 결과가 없는 것이다 —
  //    빈 정규화(위험도 null)를 "성공"으로 돌려주면 화면은 '–'(자료 없음)로 그린다. 상류 실패(502)로 말한다.
  if (!b.prediction || typeof b.prediction !== 'object' || Array.isArray(b.prediction)) {
    throw new HttpException({ code: 'AI_UPSTREAM_MALFORMED', message: 'AI 서버가 예측 결과를 약속한 형식으로 돌려주지 않았습니다 — 결과가 없습니다', kind }, 502);
  }
  const p = b.prediction as Record<string, unknown>;
  // 🔴 (AI 서버 회신 정정) 실제 모양은 `{"prediction": {"response": "원문"}}` 이었다(14일 8건) — prediction 은 있는데 그 종류의 필드가 하나도 없다.
  //    10-07 15:04 부터 상류가 502 generation_failed 로 바꿨지만, 같은 모양이 다시 오면 성공으로 그리지 않는다.
  if (!PREDICTION_FIELDS[kind].some((k) => k in p)) {
    throw new HttpException({ code: 'AI_UPSTREAM_MALFORMED', message: 'AI 서버가 예측 결과를 약속한 형식으로 돌려주지 않았습니다 — 결과가 없습니다', kind }, 502);
  }
  if (kind === 'readmission') {
    return {
      ...b,
      risk_level: hisRiskLevel(p.risk_level),
      score: typeof p.score === 'number' ? p.score : null,
      factors: strs(p.risk_factors),
      recommendations: strs(p.preventive_measures),
    };
  }
  if (kind === 'complication') {
    const list = Array.isArray(p.complications) ? p.complications : null;
    return {
      ...b,
      risk_level: hisRiskLevel(p.overall_risk),
      complications: list
        ? list.map((c) => (typeof c === 'string' ? c : c && typeof c === 'object' ? (c as { name?: unknown }).name : null)).filter((x): x is string => typeof x === 'string' && !!x.trim())
        : null,
    };
  }
  const risks = Array.isArray(p.individual_risks) ? (p.individual_risks as Record<string, unknown>[]) : null;
  const events = risks
    ? risks.flatMap((r) => {
      const drug = typeof r?.drug === 'string' ? r.drug : null;
      const pick = (arr: unknown, serious: boolean) => (Array.isArray(arr) ? arr : [])
        .map((a) => (a && typeof a === 'object' ? (a as { reaction?: unknown }).reaction : null))
        .filter((x): x is string => typeof x === 'string' && !!x.trim())
        .map((event) => ({ event, drug, serious }));
      return [...pick(r?.serious_adr, true), ...pick(r?.common_adr, false)];
    }).sort((a, z) => Number(z.serious) - Number(a.serious))
    : null;
  return { ...b, risk_level: hisRiskLevel(p.overall_risk), adverse_events: events };
}
