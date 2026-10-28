import { InsuranceType } from '@prisma/client';

export type EligibilityStatus = 'VERIFIED' | 'EXPIRED' | 'NOT_FOUND' | 'ERROR';
export type CopayCategory =
  | 'NHI'
  | 'MA_TYPE1'
  | 'MA_TYPE2'
  | 'NEAR_POOR'
  | 'SPECIAL_EXEMPTION'
  | 'PATRIOT'      // 보훈(국가유공자) — 국비부담. 실 자격검증은 보훈처/공단 연계(운영 시), 현재 프록시
  | 'INDUSTRIAL'
  | 'AUTO'
  | 'SELF_PAY';

export interface EligibilityInput {
  patientId: string;
  insuranceType: InsuranceType;
  insuranceNumber?: string | null; // 복호화된 보험번호(있으면) — 시뮬레이션 분기용
  dateOfBirth?: Date | null;
  visitType?: 'OUTPATIENT' | 'INPATIENT';
}

export interface EligibilityResult {
  status: EligibilityStatus;
  copayCategory: CopayCategory;
  coverageStartDate?: string | null;
  coverageEndDate?: string | null;
  specialExemption?: string | null;
  exemptionExpiry?: string | null;
  message?: string;
  source: 'SIMULATION' | 'NHIS';
  raw?: unknown;
}

/** 자격조회 공급자 — 시뮬레이션/실연동(NHIS) 동일 인터페이스. 실연동은 어댑터 교체. */
export interface EligibilityProvider {
  readonly source: 'SIMULATION' | 'NHIS';
  check(input: EligibilityInput): Promise<EligibilityResult>;
}
