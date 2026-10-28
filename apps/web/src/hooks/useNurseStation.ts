'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { vitalsIngestNotice, ingestOf } from '@/lib/vitals-ingest-notice';
import { toast } from '@/stores/toast-store';

/* ─── Types ─── */

export interface NurseQueuePatient {
  id: string;
  familyName: string;
  givenName: string;
  mrn?: string;
  birthDate?: string;
  gender?: string;
  insuranceType?: string;
  allergies?: string[];
}

export interface NurseTask {
  id: string;
  queueId: string;
  taskType: string;
  label: string;
  phase: 'PRE_VISIT' | 'POST_VISIT';
  status: 'PENDING' | 'COMPLETED' | 'SKIPPED';
  completedAt?: string;
  completedBy?: string;
  isConditional?: boolean;
}

export interface NurseQueueItem {
  id: string;
  queueNumber: number;
  patientId: string;
  appointmentTime?: string;
  status: 'PENDING' | 'VITALS_DONE' | 'READY_FOR_DOCTOR' | 'IN_CONSULTATION' | 'POST_VISIT_NURSING' | 'COMPLETED';
  patient?: NurseQueuePatient;
  tasks?: NurseTask[];
  completedTaskCount?: number;
  totalTaskCount?: number;
  doctorName?: string;
  departmentName?: string;
}

export interface NurseStats {
  doctorName?: string;
  todayTotal?: number;
  completedCount?: number;
  pendingCount?: number;
  inProgressCount?: number;
}

export interface VitalsData {
  id?: string;
  queueId: string;
  systolicBp?: number;
  diastolicBp?: number;
  heartRate?: number;
  bodyTemperature?: number;
  spO2?: number;
  weight?: number;
  height?: number;
  painScore?: number;
  bmi?: number;
  recordedAt?: string;
}

/* ─── Hooks ─── */

export function useNurseQueue() {
  return useQuery({
    queryKey: ['nurse-queue'],
    queryFn: () => apiClient.get<{ data: NurseQueueItem[] }>('/api/v1/nurse-station/queue'),
    refetchInterval: 10000,
  });
}

export function useNurseStats() {
  return useQuery({
    queryKey: ['nurse-stats'],
    queryFn: () => apiClient.get<{ data: NurseStats }>('/api/v1/nurse-station/stats'),
    refetchInterval: 10000,
  });
}

export function useNurseTasks(queueId: string) {
  return useQuery({
    queryKey: ['nurse-tasks', queueId],
    queryFn: () => apiClient.get<{ data: NurseTask[] }>(`/api/v1/nurse-station/tasks/${queueId}`),
    enabled: !!queueId,
  });
}

export function useCompleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) =>
      apiClient.patch<{ data: NurseTask }>(`/api/v1/nurse-station/tasks/${taskId}/complete`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nurse-tasks'] });
      qc.invalidateQueries({ queryKey: ['nurse-queue'] });
      qc.invalidateQueries({ queryKey: ['nurse-stats'] });
    },
  });
}

export function useSkipTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) =>
      apiClient.patch<{ data: NurseTask }>(`/api/v1/nurse-station/tasks/${taskId}/skip`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nurse-tasks'] });
      qc.invalidateQueries({ queryKey: ['nurse-queue'] });
    },
  });
}

/**
 * 🔴 2026-08-20 실측: 이 훅은 **소비처가 없다**(저장소 전역 grep 0). 간호 스테이션 화면은
 * 활력을 이 경로로 기록하지 않는다. 지우지 않고 남기되, 쓰이는 날 조용한 성공이 되지 않도록
 * 수집 판정(`meta.ingest`)을 해석해 둔다. **배선할 화면이 정해지면 그 화면까지가 한 벌이다.**
 */
export function useRecordVitals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ queueId, ...vitals }: Omit<VitalsData, 'id' | 'recordedAt'>) =>
      apiClient.post<{ data: VitalsData }>(`/api/v1/nurse-station/vitals/${queueId}`, vitals),
    onSuccess: (res) => {
      // 🔴 200 이 곧 "기록됨"이 아니다 — 중복 재수신·저장 보류면 `data: null` 이다.
      const n = vitalsIngestNotice(ingestOf(res));
      if (n && !n.stored) toast.error(n.text);
      else if (n) toast.warning(n.text);
      qc.invalidateQueries({ queryKey: ['nurse-vitals'] });
      qc.invalidateQueries({ queryKey: ['nurse-tasks'] });
      qc.invalidateQueries({ queryKey: ['nurse-queue'] });
      qc.invalidateQueries({ queryKey: ['nurse-stats'] });
    },
  });
}

export function useGetVitals(queueId: string) {
  return useQuery({
    queryKey: ['nurse-vitals', queueId],
    queryFn: () => apiClient.get<{ data: VitalsData }>(`/api/v1/nurse-station/vitals/${queueId}`),
    enabled: !!queueId,
  });
}
