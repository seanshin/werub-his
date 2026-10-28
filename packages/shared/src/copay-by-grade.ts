/**
 * 건강보험 외래 본인부담률 — 요양기관 종별 차등(2026-10-20 · 사용자 지시 "건보 본인부담률은 UI 화면으로 기능 구현").
 *
 * 설정 `billing.copay.nhi.outpatient.byGrade` = `{ CLINIC, HOSPITAL, GENERAL, TERTIARY }`(각 0~100 정수 %) 또는 null.
 *  · null(미설정) = 종전 그대로 단일 율 `billing.copay.nhi.outpatient` 하나를 모든 종별에 쓴다
 *  · 값이 있으면 **우리 기관 종별**(명시 설정)의 율을 쓴다 — 종별이 미설정이면 단일 율(어느 종별 율도 짐작하지 않는다)
 * 🔴 법정 율(시행령)을 코드·기본값에 넣지 않는다 — 사람이 화면에서 근거를 보고 입력한다(조사한 것만 적는다).
 *    상급종합의 진찰료 전액 본인부담·읍면/동 구분 같은 세부 규칙은 이 설정이 표현하지 못한다(화면이 밝힌다).
 * 청구(EligibilityService.copayRateFor)·종별 계산기·설정 저장 검사가 이 파일 하나를 쓴다.
 */
import { INSTITUTION_GRADES, type InstitutionGrade } from './receipt-class';

export const NHI_OUTPATIENT_BY_GRADE_KEY = 'billing.copay.nhi.outpatient.byGrade';
export type GradeRatePct = Record<InstitutionGrade, number>;

/** 저장 값 검사 — null 은 허용(단일 율로 되돌림) · 네 종별 모두 0~100 정수여야 한다(일부만 있으면 어느 율인지 모호하다) */
export function gradeRatesInvalidReason(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return '종별 4개(CLINIC·HOSPITAL·GENERAL·TERTIARY)의 율(%) 객체여야 합니다';
  const v = value as Record<string, unknown>;
  const extra = Object.keys(v).filter((k) => !(INSTITUTION_GRADES as readonly string[]).includes(k));
  if (extra.length) return `모르는 종별: ${extra.join(', ')}`;
  for (const g of INSTITUTION_GRADES) {
    const n = v[g];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 100) return `${g} 율은 0~100 정수여야 합니다`;
  }
  return null;
}

/** 유효한 종별 율 표면 그 값, 아니면 null(단일 율로) */
export function parseGradeRates(value: unknown): GradeRatePct | null {
  return value != null && gradeRatesInvalidReason(value) === null ? (value as GradeRatePct) : null;
}

/** 건보 외래 본인부담률(%) — 종별 율이 있고 종별을 알면 그 값, 아니면 단일 율 */
export function nhiOutpatientRatePct(byGrade: unknown, grade: InstitutionGrade | null, singlePct: number): { pct: number; source: 'BY_GRADE' | 'SINGLE' } {
  const rates = parseGradeRates(byGrade);
  if (rates && grade) return { pct: rates[grade], source: 'BY_GRADE' };
  return { pct: singlePct, source: 'SINGLE' };
}
