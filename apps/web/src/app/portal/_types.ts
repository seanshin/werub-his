export interface PatientInfo { id: string; mrn: string; familyName: string; givenName: string; dateOfBirth: string; gender: string; phone: string; email?: string; address?: string; insuranceType: string }
export interface Appointment { id: string; scheduledAt: string; doctorName: string; department: string; status: string; type?: string; reason?: string; doctor?: { familyName: string; givenName: string; department: string } }
/** 🔴 (2026-10-20 B2 · 결정 portal.visitSummaryScope = GENERAL) 의사 소견 원문은 서버가 싣지 않는다 — 진단명(추정 표기)까지 */
export interface Encounter { id: string; encounteredAt: string; doctorName: string; diagnosisNames: string[] }
/** `judgmentPending` — 의료진 확인 전이라 판정을 비웠다(결정 portal.labResultRelease) · `pendingReview` — 위급값 담당의 확인 중(수치 가림) */
export interface LabItem { name: string; value: string; unit: string; flag: string; judgmentPending?: boolean; pendingReview?: boolean }
export interface LabResult { id: string; orderName: string; orderedAt: string; items: LabItem[]; release?: 'REVIEWED' | 'AWAITING_REVIEW'; reviewedAt?: string | null }
/** 🔴 (2026-10-19 R3) 서버 계약 = `testType`·`testName`·`findings` — 화면은 `type`·`name` 을 읽어 검사명이 늘 비었다(P11). 매핑은 page.tsx `toDiagnosticTest` 하나 */
export interface DiagnosticTest { id: string; type: string | null; name: string | null; performedAt: string; conclusion: string | null; findings: string | null; release: 'REVIEWED' | 'AWAITING_REVIEW' | null; reviewedAt: string | null }
/** `discount`·`outstanding` — P4-1(2026-10-14): 감면을 빼지 않으면 남은 금액이 실제보다 크게 보였다 · outstanding = shared billingOutstanding */
export interface Billing { id: string; billedAt: string; total: number; insuranceCovered: number; copay: number; paidAmount: number; status: string; discount: number; outstanding: number | null; refundAmount: number | null }
export interface Allergy { id: string; allergen: string; severity: string; reaction?: string }
export interface Medication { id: string; name: string; dosage: string; frequency: string; route?: string; medicationCodeId?: string | null }
export interface Questionnaire { id: string; token: string; status: string; formSchema: { name: string }; createdAt: string; expiresAt: string; completedAt?: string }
export interface LoginResponse { accessToken: string; patientId: string }
export interface PortalApiResponse { data?: unknown; [key: string]: unknown }
export type PortalItem = Record<string, unknown>;

export type MainTab = 'home' | 'care' | 'health' | 'services' | 'profile' | 'more';
export type CareSegment = 'appointments' | 'schedule' | 'encounters' | 'questionnaire' | 'consent' | 'messages';
export type HealthSegment = 'labs' | 'imaging' | 'medications' | 'checkup' | 'trends';
export type ServicesSegment = 'billing' | 'documents' | 'telehealth' | 'pre-auth' | 'voc' | 'hospital-info';

export interface PortalData {
  appointments: Appointment[];
  encounters: Encounter[];
  labResults: LabResult[];
  diagnosticTests: DiagnosticTest[];
  billings: Billing[];
  allergies: Allergy[];
  allergyStatus?: 'NOT_ASSESSED' | 'NO_KNOWN_ALLERGIES' | 'HAS_ALLERGIES' | 'UNABLE_TO_ASSESS';
  allergyAssessedAt?: string | null;
  medications: Medication[];
  questionnaires: Questionnaire[];
}
