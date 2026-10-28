import type { Billing } from '@hospital-run/shared';

export interface HistoryEntry {
  txTime: string;
  action?: string;
  changedBy?: string;
}

export interface ProblemItem {
  id: string;
  status: string;
  severity: string;
  description: string;
  diagnosisCode?: { code: string; nameKo: string; nameEn?: string | null };
  onsetDate?: string;
  resolvedDate?: string;
  addedByUser?: { familyName: string; givenName: string };
  notes?: string;
}

export interface AllergyItem {
  id: string;
  type: string;
  severity: string;
  verificationStatus: string;
  allergen: string;
  /** 표준 알레르겐 코드 — 응답에 실려 오지만 화면에 없던 값(2026-07 UI 미노출 감사) */
  allergenCode?: string | null;
  reaction: string;
  onsetDate?: string;
  reportedBy: string;
  notes?: string;
}

export interface LabResult {
  id: string;
  status: string;
  completedAt?: string;
  collectedAt?: string;
  items?: LabResultItem[];
}

export interface LabResultItem {
  id: string;
  testName: string;
  value: string;
  unit: string;
  flag?: string;
  normalMin?: number;
  normalMax?: number;
}

export interface JourneyEvent {
  id: string;
  eventType: string;
  severity?: string;
  title: string;
  description?: string;
  department?: string;
  doctorName?: string;
  navUrl?: string;
  /**
   * 종전 표시 시각 — 🔴 기록 시각이 아니다: 시드 롤포워드가 다시 쓴 행이 있다(기획 §2.9①).
   * P1 이후 새 행은 기록 순간과 같다. 기록 시각 정본은 `createdAt`.
   */
  eventAt: string;
  /** 기록 시각(시스템이 알게 된 순간) — 정본 */
  createdAt?: string;
  /** (P1) 예정 시각 — 발생과 섞지 않는다 */
  plannedAt?: string | null;
  /** (P1) 데이터 출처 LIVE·SEED·DEMO·IMPORTED·UNKNOWN */
  dataOrigin?: string;
  /** (P2) 활동·전이·결과·정정 대상 */
  activity?: string | null;
  transition?: string | null;
  outcome?: string | null;
  supersedesId?: string | null;
  /** (P3) 방문 단위 관계 — 비면 방문 미지정(과거 행) */
  objects?: { objectType: string; objectId: string }[];
  /** (여정 P1) 발생 시각 — null 이면 모른다(P1 이전 행·도메인이 모르는 시각) */
  occurredAt?: string | null;
  occurredAtSource?: 'DOMAIN_FIELD' | 'USER_CLAIMED' | 'SAME_AS_RECORDED' | 'UNKNOWN' | string;
  occurredAtPrecision?: 'SECOND' | 'MINUTE' | 'DAY' | string | null;
}

export interface ConsentItem {
  id: string;
  status: string;
  type: string;
  consentType?: string;
  templateName: string;
  risks?: string;
  signedAt?: string;
  patientSignedBy?: string;
  patientSignedAt?: string;
  patientSignature?: string;
  doctorSignedAt?: string;
  witnessSignedAt?: string;
  signedBy?: string;
  createdAt?: string;
}

export interface ConsentTemplate {
  id: string;
  name: string;
  type: string;
  content?: Record<string, unknown>;
}

export interface PrescriptionWithRelations {
  id: string;
  // BE 관계명은 medicationCode — 종전 medication(미존재)만 읽어 약품명이 비던 것을 정합. medication 은 타 소비처 호환용 유지.
  medicationCode?: { nameKo?: string; nameEn?: string; ingredient?: string };
  medication?: { nameKo?: string; nameEn?: string };
  medicationId?: string;
  dosage?: string;
  frequency?: string;
  duration?: string;
  quantity?: number;
  route?: string;
}

export interface EncounterListItem {
  id: string;
  status: string;
  createdAt: string;
  subjective?: string;
  objective?: string;
  assessment?: string;
  plan?: string;
  doctor?: { familyName: string; givenName: string };
  diagnoses?: Array<{ id: string; diagnosisCode?: { code: string; nameKo: string; nameEn?: string | null } }>;
  prescriptions?: PrescriptionWithRelations[];
}

export interface BillingWithRelations extends Billing {
  insuranceCovered?: number;
  copayAmount?: number;
  patientAmount?: number;
}

export interface CliHistoryItem {
  type: 'input' | 'success' | 'error' | 'info';
  text: string;
}

// 라벨은 ENCOUNTER_STATUS_LABEL 정본 정렬 — 종전 진료중/완료 누락(raw 코드 표시)·서명완료/수정됨 문구 드리프트 봉합
export const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string; dot: string }> = {
  DRAFT: { label: '작성중', bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-500' },
  IN_PROGRESS: { label: '진료중', bg: 'bg-indigo-50', text: 'text-indigo-700', dot: 'bg-indigo-500' },
  COMPLETED: { label: '완료', bg: 'bg-gray-50', text: 'text-gray-600', dot: 'bg-gray-400' },
  SIGNED: { label: '서명', bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  AMENDED: { label: '수정', bg: 'bg-blue-50', text: 'text-blue-700', dot: 'bg-blue-500' },
};

// BILLING_STATUS_LABEL 정본 정렬 — 종전 환불/후납/분할납 누락(raw 코드 표시) 봉합
export const BILLING_STATUS: Record<string, { label: string; bg: string; text: string }> = {
  PAID: { label: '수납완료', bg: 'bg-emerald-50', text: 'text-emerald-700' },
  PENDING: { label: '미수납', bg: 'bg-amber-50', text: 'text-amber-700' },
  PARTIAL: { label: '부분수납', bg: 'bg-blue-50', text: 'text-blue-700' },
  REFUNDED: { label: '환불', bg: 'bg-gray-50', text: 'text-gray-600' },
  DEFERRED: { label: '후납', bg: 'bg-amber-50', text: 'text-amber-700' },
  INSTALLMENT: { label: '분할납', bg: 'bg-blue-50', text: 'text-blue-700' },
  CANCELLED: { label: '취소', bg: 'bg-red-50', text: 'text-red-700' },
};
