import { ageOf } from '@hospital-run/shared';
import { kdate } from '@/lib/ui-settings';
export interface TelehealthSession {
  id: string; sessionType: string; status: string; scheduledAt: string;
  /** 진료 기록 — 세션 시작 시 생성된다. 진단·처방은 이 기록에 붙는다(정본 경로) */
  encounterId?: string | null;
  startedAt?: string; roomId?: string; chiefComplaint?: string;
  patient?: { id?: string; familyName?: string; givenName?: string; mrn?: string; dateOfBirth?: string; gender?: string };
  doctor?: { familyName?: string; givenName?: string; department?: string };
}

export interface PatientSummary {
  patient?: Record<string, unknown>;
  allergies?: Array<{ allergen?: string; severity?: string; type?: string }>;
  problems?: Array<{ code?: string; description?: string; diagnosisCode?: { code?: string; nameKo?: string } }>;
  recentEncounters?: Array<{ id?: string; createdAt?: string; chiefComplaint?: string; assessment?: string; doctor?: { familyName?: string; givenName?: string; department?: string }; diagnoses?: Array<{ diagnosisCode?: { code?: string; nameKo?: string } }> }>;
  latestVitals?: { systolicBp?: number; diastolicBp?: number; heartRate?: number; temperature?: number; spo2?: number; respiratoryRate?: number; weight?: number; height?: number };
  activeRxCount?: number;
  activeMedications?: Array<{ nameKo?: string; dosage?: string; frequency?: string }>;
  flags?: { hasAllergies?: boolean; hasProblems?: boolean };
}

export type UserRole = 'DOCTOR' | 'NURSE' | 'PHARMACIST' | 'ADMIN' | 'LAB_TECH' | 'STAFF';

export interface ChartPanelProps {
  session: TelehealthSession;
  summary: PatientSummary | null;
  patientId?: string;
  sessionId: string;
  notes: string;
  setNotes: (v: string) => void;
  isActive: boolean;
}

export const safeDateStr = (d?: string) => {
  if (!d) return '';
  try { const dt = new Date(d); return isNaN(dt.getTime()) ? '' : kdate(dt, 'date'); } catch { return ''; }
};

// 정본 계산 — 종전 365.25일 나눗셈 근사는 생일 경계에서 어긋났다
export const calcAge = (dob?: string) => ageOf(dob);
