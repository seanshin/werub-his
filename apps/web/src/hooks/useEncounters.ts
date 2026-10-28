'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { Encounter, EncounterWithRelations, Prescription } from '@hospital-run/shared';

interface CreateEncounterInput {
  patientId: string;
  [key: string]: unknown;
}

interface UpdateEncounterInput {
  subjective?: string;
  objective?: string;
  assessment?: string;
  plan?: string;
  [key: string]: unknown;
}

interface PrescriptionInput {
  type: string;
  priority?: string;
  medicationCodeId?: string;
  procedureCodeId?: string;
  dosage?: string;
  frequency?: string;
  duration?: number;
  quantity?: number;
  route?: string;
  /** 치료·식이·활동·간호지시 등 코드 없는 지시 텍스트 */
  instructions?: string;
  /** 관련 상병 연결(G2-5) */
  diagnosisCodeId?: string;
  /** DUR 경고 무시 강제 처방 + 사유(약국·심사 추적) */
  overrideDur?: boolean;
  overrideReason?: string;
}

interface DurWarning {
  severity: string;
  message: string;
}

export function useEncounter(id: string) {
  return useQuery({
    queryKey: ['encounter', id],
    queryFn: () => apiClient.get<{ data: EncounterWithRelations }>(`/api/v1/encounters/${id}`),
    enabled: !!id,
    staleTime: 3 * 60 * 1000, // 3분 — 진료 중 변경 가능하나 빈번하지 않음
  });
}

export function useCreateEncounter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateEncounterInput) => apiClient.post<{ data: Encounter }>('/api/v1/encounters', data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['encounters'] }); },
  });
}

export function useUpdateEncounter() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateEncounterInput }) =>
      apiClient.put<{ data: Encounter }>(`/api/v1/encounters/${id}`, data),
    onSuccess: (_, { id }) => { qc.invalidateQueries({ queryKey: ['encounter', id] }); },
  });
}

export function useSignEncounter() {
  const qc = useQueryClient();
  return useMutation({
    // 전자서명값은 **같은 서명 요청**에 싣는다 — 따로 먼저 보내면 저장 전(서버에 남은 옛) 기록에 서명이 붙는다
    mutationFn: (arg: string | { id: string; blockchainSignature?: Record<string, unknown> }) => {
      const { id, blockchainSignature } = typeof arg === 'string' ? { id: arg, blockchainSignature: undefined } : arg;
      return apiClient.patch<{ data: Encounter }>(`/api/v1/encounters/${id}/sign`, blockchainSignature ? { blockchainSignature } : undefined);
    },
    onSuccess: (_, arg) => { qc.invalidateQueries({ queryKey: ['encounter', typeof arg === 'string' ? arg : arg.id] }); },
  });
}

export function useAddPrescription() {
  const qc = useQueryClient();
  return useMutation({
    // headers — 비처방 역할의 지정 처방의 승인 토큰(`x-prescriber-step-up-token`).
    // 서버가 헤더만 읽으므로 body 에 실으면 승인을 받고도 저장이 거부된다(PrescriberDelegate.authorize 참조).
    mutationFn: ({ encounterId, data, headers }: { encounterId: string; data: PrescriptionInput; headers?: Record<string, string> }) =>
      apiClient.post<{ data: Prescription; durWarnings: DurWarning[] }>(`/api/v1/encounters/${encounterId}/prescriptions`, data, headers),
    onSuccess: (_, { encounterId }) => { qc.invalidateQueries({ queryKey: ['encounter', encounterId] }); },
  });
}

/**
 * 처방 중단 — 지금 이후 멈춤(이미 조제·투약된 사실은 유효 · 사유 필수). 발효된 처방은 취소(무효)가 409
 * `PRESCRIPTION_TOOK_EFFECT` 로 거부되므로 화면은 이것을 쓴다(2026-09-30 오더 중단 설계).
 */
export function useDiscontinuePrescription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiClient.post<{ data: { alreadyDiscontinued: boolean; cancelledOrders: number; removedFutureMar: number } }>(`/api/v1/prescriptions/${id}/discontinue`, { reason }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['encounter'] });
      qc.invalidateQueries({ queryKey: ['admission-detail'] });
      qc.invalidateQueries({ queryKey: ['patient-prescriptions'] });
    },
  });
}

/** 처방 갱신 — 새 처방으로 잇고 원처방은 같은 순간 중단(일수·총량은 의사가 정한다 · 2026-09-30) */
export function useRenewPrescription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, days, quantity, reason, overrideDur, overrideReason }: { id: string; days: number; quantity: number; reason?: string; overrideDur?: boolean; overrideReason?: string }) =>
      apiClient.post<{ data: { prescription: { id: string }; renewedFromId: string } }>(`/api/v1/prescriptions/${id}/renew`, { days, quantity, ...(reason ? { reason } : {}), ...(overrideDur ? { overrideDur, overrideReason } : {}) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['renewals-due'] });
      qc.invalidateQueries({ queryKey: ['patient-prescriptions'] });
      qc.invalidateQueries({ queryKey: ['admission-detail'] });
      qc.invalidateQueries({ queryKey: ['encounter'] });
    },
  });
}

export function useCancelPrescription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient.del(`/api/v1/prescriptions/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['encounter'] }); },
  });
}

export function usePatientEncounters(patientId: string) {
  return useQuery({
    queryKey: ['patient-encounters', patientId],
    queryFn: () => apiClient.get<{ data: EncounterWithRelations[] }>(`/api/v1/encounters?patientId=${patientId}`),
    enabled: !!patientId,
    staleTime: 2 * 60 * 1000, // 2분 — 진료 이력 목록
  });
}
