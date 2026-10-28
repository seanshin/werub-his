/**
 * 고시 종별 단가 읽기 — 정본(2026-10-20 · 종별 계산기).
 *
 * 수가 고시(`procedure_fees`)는 종별 단가 열을 따로 둔다. 요양기관 종별 어휘(4)와 단가 열은 다른 축이다 —
 * 병원·종합병원·상급종합은 고시상 모두 **병원급이상단가** 한 열을 쓴다(진찰료처럼 종별마다 코드가 다른 것은 코드가 가른다).
 *
 * 🔴 고시의 `0` 은 "그 종별에서 산정하지 않는다"이지 0원 청구가 아니다 · 열이 비어 있으면 모른다.
 *    api `reference-dataset.service feeOn` 과 종별 계산기가 이 한 함수를 쓴다(같은 사실에 정본 둘 금지).
 */
import type { InstitutionGrade } from './receipt-class';

export const GRADE_FEE_COLUMN: Readonly<Record<InstitutionGrade, 'priceClinic' | 'priceHospital'>> = {
  CLINIC: 'priceClinic',
  HOSPITAL: 'priceHospital',
  GENERAL: 'priceHospital',
  TERTIARY: 'priceHospital',
};

/** GAZETTE = 그 종별 금액 있음 · NOT_BILLABLE_AT_TIER = 고시에 있으나 그 종별 미산정(0) · NOT_LISTED = 고시에 없거나 열이 비었다 */
export type GazetteFeeBasis = 'GAZETTE' | 'NOT_BILLABLE_AT_TIER' | 'NOT_LISTED';

export function gazetteFeeOf(
  row: { priceClinic?: number | null; priceHospital?: number | null } | null | undefined,
  grade: InstitutionGrade,
): { price: number | null; basis: GazetteFeeBasis } {
  if (!row) return { price: null, basis: 'NOT_LISTED' };
  const v = row[GRADE_FEE_COLUMN[grade]];
  if (v === null || v === undefined) return { price: null, basis: 'NOT_LISTED' };
  if (v === 0) return { price: null, basis: 'NOT_BILLABLE_AT_TIER' };
  return { price: v, basis: 'GAZETTE' };
}
