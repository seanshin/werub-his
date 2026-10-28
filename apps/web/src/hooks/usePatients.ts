'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { Patient, PatientListItem, PatientContact, PatientRelation, DuplicateCheckResult, QualityDashboard, PaginatedResponse } from '@/types/patient';

interface PatientFilters {
  q?: string;
  mrn?: string;
  gender?: string;
  insuranceType?: string;
  status?: string;
  tags?: string;
  foreigner?: string;
  nationality?: string;
  language?: string;
  quality?: string;
  /** 재원/내원 여부 — 'onsite'=지금 병원 안(입원·오늘 대기·진료중) */
  presence?: string;
  /** 'mine' = 내 환자(의사 · 최근 30일 진료·담당 입원·오늘 예약) */
  scope?: string;
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
}

export function usePatients(filters: PatientFilters = {}) {
  return useQuery({
    queryKey: ['patients', filters],
    queryFn: () =>
      apiClient.get<PaginatedResponse<PatientListItem>>('/api/v1/patients', {
        ...filters,
        page: filters.page ?? 1,
        limit: filters.limit ?? 20,
      }),
  });
}

export function usePatient(id: string) {
  return useQuery({
    queryKey: ['patient', id],
    queryFn: () => apiClient.get<{ data: Patient }>(`/api/v1/patients/${id}`),
    enabled: !!id,
    staleTime: 5 * 60 * 1000, // 5분 — 환자 기본 정보는 자주 변경되지 않음
  });
}

export function useCreatePatient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Omit<Patient, 'id' | 'mrn' | 'createdAt' | 'allergies'> & { allergies?: string[]; contacts?: Omit<PatientContact, 'id' | 'patientId' | 'createdAt'>[] }) =>
      apiClient.post<{ data: Patient }>('/api/v1/patients', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patients'] });
    },
  });
}

export function useUpdatePatient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Patient> & { changeReason?: string } }) =>
      apiClient.put<{ data: Patient }>(`/api/v1/patients/${id}`, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['patients'] });
      queryClient.invalidateQueries({ queryKey: ['patient', id] });
    },
  });
}

export function usePatientHistory(id: string) {
  return useQuery({
    queryKey: ['patient-history', id],
    queryFn: () => apiClient.get<{ data: unknown[] }>(`/api/v1/patients/${id}/history`),
    enabled: !!id,
    staleTime: 5 * 60 * 1000, // 5분 — 이력 데이터는 자주 변경되지 않음
  });
}

// ── 보호자/연락처 ──

export function usePatientContacts(patientId: string) {
  return useQuery({
    queryKey: ['patient-contacts', patientId],
    queryFn: () => apiClient.get<{ data: PatientContact[] }>(`/api/v1/patients/${patientId}/contacts`),
    enabled: !!patientId,
  });
}

export function useCreateContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ patientId, data }: { patientId: string; data: Omit<PatientContact, 'id' | 'patientId' | 'createdAt'> }) =>
      apiClient.post<{ data: PatientContact }>(`/api/v1/patients/${patientId}/contacts`, data),
    onSuccess: (_, { patientId }) => {
      queryClient.invalidateQueries({ queryKey: ['patient-contacts', patientId] });
      queryClient.invalidateQueries({ queryKey: ['patient', patientId] });
    },
  });
}

export function useUpdateContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ patientId, contactId, data }: { patientId: string; contactId: string; data: Partial<PatientContact> }) =>
      apiClient.put<{ data: PatientContact }>(`/api/v1/patients/${patientId}/contacts/${contactId}`, data),
    onSuccess: (_, { patientId }) => {
      queryClient.invalidateQueries({ queryKey: ['patient-contacts', patientId] });
      queryClient.invalidateQueries({ queryKey: ['patient', patientId] });
    },
  });
}

export function useDeleteContact() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ patientId, contactId }: { patientId: string; contactId: string }) =>
      apiClient.del(`/api/v1/patients/${patientId}/contacts/${contactId}`),
    onSuccess: (_, { patientId }) => {
      queryClient.invalidateQueries({ queryKey: ['patient-contacts', patientId] });
      queryClient.invalidateQueries({ queryKey: ['patient', patientId] });
    },
  });
}

// ── 중복 감지 ──

export function useCheckDuplicate() {
  return useMutation({
    mutationFn: (data: { familyName: string; givenName: string; dateOfBirth: string }) =>
      apiClient.post<{ data: DuplicateCheckResult }>('/api/v1/patients/check-duplicate', data),
  });
}

// ── 환자 병합 ──

// 병합 — 병합 창(`patients/components/MergePatientsModal`)이 미리보기·확인을 거쳐 직접 부른다(2026-10-20 · 확인 없는 훅 회수)

// ── 사진 업로드 ──

export function useUploadPhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ patientId, file }: { patientId: string; file: File }) => {
      const formData = new FormData();
      formData.append('photo', file);
      const API_URL = process.env.NEXT_PUBLIC_API_URL || '';
      const res = await fetch(`${API_URL}/api/v1/patients/${patientId}/photo`, {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Upload failed');
      return res.json();
    },
    onSuccess: (_, { patientId }) => {
      queryClient.invalidateQueries({ queryKey: ['patient', patientId] });
      queryClient.invalidateQueries({ queryKey: ['patients'] });
    },
  });
}

// ── 가족 관계 ──

export function usePatientRelations(patientId: string) {
  return useQuery({
    queryKey: ['patient-relations', patientId],
    queryFn: () => apiClient.get<{ data: PatientRelation[] }>(`/api/v1/patients/${patientId}/relations`),
    enabled: !!patientId,
  });
}

export function useCreateRelation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ patientId, data }: { patientId: string; data: { relatedId: string; relationship: string; notes?: string } }) =>
      apiClient.post<{ data: PatientRelation }>(`/api/v1/patients/${patientId}/relations`, data),
    onSuccess: (_, { patientId }) => {
      queryClient.invalidateQueries({ queryKey: ['patient-relations', patientId] });
    },
  });
}

export function useDeleteRelation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ patientId, relationId }: { patientId: string; relationId: string }) =>
      apiClient.del(`/api/v1/patients/${patientId}/relations/${relationId}`),
    onSuccess: (_, { patientId }) => {
      queryClient.invalidateQueries({ queryKey: ['patient-relations', patientId] });
    },
  });
}

// ── 일괄 등록 ──

export function useImportPatients() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { patients: Record<string, unknown>[] }) =>
      apiClient.post<{ data: { created: number; skipped: number; errors: Array<{ index: number; reason: string }> } }>('/api/v1/patients/import', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patients'] });
    },
  });
}

// ── 데이터 품질 대시보드 ──

export function useQualityDashboard() {
  return useQuery({
    queryKey: ['patient-quality-dashboard'],
    queryFn: () => apiClient.get<{ data: QualityDashboard }>('/api/v1/patients/quality-dashboard'),
  });
}

// ── 사망 처리 ──

export function useMarkDeceased() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ patientId, data }: { patientId: string; data: Record<string, unknown> }) =>
      apiClient.post<{ data: Patient }>(`/api/v1/patients/${patientId}/deceased`, data),
    onSuccess: (_, { patientId }) => {
      queryClient.invalidateQueries({ queryKey: ['patient', patientId] });
      queryClient.invalidateQueries({ queryKey: ['patients'] });
    },
  });
}

/** 🔴 미확인(응급) 환자 신원 확인 — 임시ID → 실명 전환(A3 · PATCH .../identify) */
export function useIdentifyPatient() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ patientId, data }: { patientId: string; data: Record<string, unknown> }) =>
      apiClient.patch<{ data: Patient }>(`/api/v1/patients/${patientId}/identify`, data),
    onSuccess: (_, { patientId }) => {
      queryClient.invalidateQueries({ queryKey: ['patient', patientId] });
      queryClient.invalidateQueries({ queryKey: ['patients'] });
    },
  });
}
