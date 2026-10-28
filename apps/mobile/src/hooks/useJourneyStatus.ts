import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../lib/api-client';

/**
 * 서버 `/api/v1/portal/journey/status` 가 내는 phase 전량(portal.service.ts 기준).
 * 🔴 종전 타입은 6종만 알고 있었고 화면도 6종만 그렸다 — PRE_VISIT(예약 D-7 이내)·
 *    PRE_DISCHARGE(퇴원요약 서명됨)·CHECKUP_IN_PROGRESS 는 타입에도 없었다.
 *    예약이 잡힌 평범한 환자가 홈에서 빈 화면을 보던 원인.
 */
export type JourneyPhase =
  | 'OUTPATIENT_WAITING'
  | 'OUTPATIENT_CALLED'
  | 'OUTPATIENT_IN_CONSULTATION'
  | 'CHECKUP_IN_PROGRESS'
  | 'INPATIENT'
  | 'PRE_DISCHARGE'
  | 'POST_DISCHARGE'
  | 'PRE_VISIT'
  | 'IDLE';

export interface JourneyStatus {
  phase: JourneyPhase;
  queue?: {
    id: string;
    queueNumber: number;
    status: string;
    departmentName: string;
    doctor: { id: string; familyName: string; givenName: string } | null;
    aheadCount: number;
    /**
     * 🔴 nullable. 서버가 표본이 없으면 예상 대기를 산출하지 않는다(“모르면 0 대신 null”).
     *    종전 non-null 타입 + `~{...}분` 렌더는 null 을 받으면 화면에 "~분" 만 남았다.
     */
    estimatedWaitMinutes: number | null;
    checkedInAt: string;
    calledAt: string | null;
    startedAt: string | null;
  };
  todayAppointments?: Array<{
    id: string;
    scheduledAt: string;
    type: string;
    doctor: { familyName: string; givenName: string } | null;
  }>;
  timeline?: Array<{ type: string; at: string; description: string; severity: string }>;
  admission?: {
    id: string;
    admitDate: string;
    daysSinceAdmit: number;
    ward: string | null;
    room: string | null;
    bed: string | null;
    attendingDoctor: { familyName: string; givenName: string } | null;
  };
  vitals?: { systolicBp: number | null; diastolicBp: number | null; heartRate: number | null; temperature: number | null; spo2: number | null; measuredAt: string } | null;
  todayMedications?: Array<{ id: string; drugName: string | null; dose: string; scheduledAt: string; status: string }>;
  recentLabResults?: Array<{ id: string; completedAt: string; items: Array<{ testName: string; value: string; unit: string; flag: string | null }> }>;
  recentProgressNotes?: Array<{ id: string; content: string; createdAt: string; doctor: { familyName: string; givenName: string } }>;
  nextSurgery?: { id: string; procedureName: string; scheduledAt: string; status: string } | null;
  discharge?: {
    admissionId: string;
    dischargeDate: string;
    daysSinceDischarge: number;
    attendingDoctor: { familyName: string; givenName: string } | null;
    diagnosis: string | null;
    followUpPlan: string | null;
    followUpDate: string | null;
  };
  nextAppointment?: { id: string; scheduledAt: string; doctor: { familyName: string; givenName: string } | null } | null;
  activeMedications?: Array<{ id: string; drugName: string | null; dosage: string; frequency: string }>;
  lastEncounter?: { id: string; createdAt: string; chiefComplaint: string } | null;
  healthDashboard?: any;
  unreadNotifications?: number;
}

export function useJourneyStatus() {
  return useQuery<{ data: JourneyStatus }>({
    queryKey: ['journey', 'status'],
    queryFn: () => apiClient.get('/api/v1/portal/journey/status'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
