import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

/** 병동·병상(상태 포함) — 응급 구역·비활성 병동은 전동 대상에서 뺀다(입원 가용 조회와 같은 판단) */
export type WardWithBeds = { id: string; name: string; floor: number; type?: string; isActive?: boolean; beds: { id: string; roomNumber: string; bedNumber: string; status: string }[] };
export function useTransferWards() {
  return useQuery({
    queryKey: ['bed-transfer-wards'],
    queryFn: () => apiClient.get<{ data: WardWithBeds[] }>('/api/v1/beds/wards').then((r) => (Array.isArray(r.data) ? r.data : []).filter((w) => w.type !== 'EMERGENCY' && w.isActive !== false)),
  });
}
