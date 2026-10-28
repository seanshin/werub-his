'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

interface OrderItem {
  id: string;
  status: string;
  department?: string;
  priority?: string;
  createdAt?: string;
  receivedAt?: string;
  startedAt?: string;
  completedAt?: string;
  receiver?: { familyName?: string; givenName?: string; role?: string } | null;
  starter?: { familyName?: string; givenName?: string; role?: string } | null;
  completer?: { familyName?: string; givenName?: string; role?: string } | null;
  // 오더 확인(수행 부서 인지) — 응답에 실려 오지만 화면에 없던 값(2026-07 UI 미노출 감사)
  acknowledgedAt?: string | null;
  /** 진료 맥락 — 외래·입원·중환자·응급 (서버 판정) */
  careContext?: 'OUTPATIENT' | 'INPATIENT' | 'ICU' | 'ER';
  careContextLabel?: string;
  /** 야간 당직 처리 대상 */
  nightHandled?: boolean;
  /** 야간 시간대(22~06시 KST)에 발행됨 */
  issuedAtNight?: boolean;
  acknowledger?: { familyName?: string; givenName?: string; role?: string } | null;
  notes?: string;
  /** 수행 부서가 남긴 결과(문자열 또는 구조화) — 오더의 답 */
  result?: string | Record<string, unknown> | null;
  prescription?: {
    id?: string;
    type?: string;
    /** 코드가 없는 지시(간호·활동·식이)의 실제 내용 — 없으면 화면이 "처방" 한 단어로 뭉갠다 */
    instructions?: string;
    dosage?: string;
    frequency?: string;
    duration?: number;
    quantity?: number;
    route?: string;
    priority?: string;
    durChecked?: boolean;
    durWarnings?: unknown[];
    durOverridden?: boolean;
    medicationCode?: { code?: string; nameKo?: string; nameEn?: string | null; ingredient?: string | null; dosageForm?: string };
    procedureCode?: { code?: string; nameKo?: string };
    encounter?: {
      id?: string;
      patientId?: string;
      patient?: { id?: string; familyName: string; givenName: string; mrn: string };
      doctor?: { id?: string; familyName: string; givenName: string; department?: string };
    };
  };
}

export type { OrderItem };

/**
 * 부서별 오더 대기열.
 *
 * 🔴 **약국 탭에 약이 아닌 것이 섞여 있었다** — `병실 내 보행`·`체위 변경`(간호 지시)·
 *    `기본식사`(식이)·검사 오더. `TYPE_TO_DEPARTMENT` 가 제 부서가 없는 처방 3종
 *    (DIET·ACTIVITY·NURSING)을 **PHARMACY 로 대체**하기 때문이다.
 *    어제 약국 워크스테이션에서 같은 병을 고쳤는데 CPOE 부서별 대기열에 그대로 남아 있었다.
 *    **약국이 처리하는 것은 약(`MEDICATION`)뿐**이다 — 서버의 `type` 필터를 쓴다.
 */
export function useOrderQueue(department: string) {
  const type = department === 'PHARMACY' ? 'MEDICATION' : undefined;
  return useQuery({
    queryKey: ['order-queue', department, type],
    queryFn: () => apiClient.get<{ data: OrderItem[] }>(`/api/v1/orders`, {
      department, status: 'ORDERED', limit: 50, ...(type ? { type } : {}),
    }),
    refetchInterval: 10000,
  });
}

export function useMyOrders(
  doctorId: string | undefined,
  status?: string,
  type?: string,
  from?: string,
  to?: string,
  careContext?: string,
  nightOnly?: boolean,
) {
  return useQuery({
    queryKey: ['my-orders', doctorId, status, type, from, to, careContext, nightOnly],
    queryFn: () => {
      const params: Record<string, string | number> = { limit: 200 };
      if (doctorId) params.doctorId = doctorId;
      if (status) params.status = status;
      if (type) params.type = type;
      if (from) params.from = from;
      if (to) params.to = to;
      if (careContext) params.careContext = careContext;
      if (nightOnly) params.nightOnly = 'true';
      return apiClient.get<{ data: OrderItem[] }>('/api/v1/orders', params);
    },
    enabled: !!doctorId,
    refetchInterval: 15000,
  });
}

export function useChangeOrderStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, notes }: { id: string; status: string; notes?: string }) =>
      apiClient.patch<{ data: OrderItem }>(`/api/v1/orders/${id}/status`, { status, notes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['order-queue'] });
      qc.invalidateQueries({ queryKey: ['my-orders'] });
    },
  });
}
