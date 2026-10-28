'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import type { EntryScope } from './PrescriberDelegate';

/**
 * 내 오더 입력 범위(유형별 본인 권한/의사 승인/불가) — 환자·진료를 고르기 **전**에도 탭에 표시하려고 따로 부른다.
 * 서버 정본 `GET /api/v1/prescriptions/entry-scope/me`(shared `order-entry-scope`).
 */
export function useEntryScope(enabled = true) {
  return useQuery({
    queryKey: ['my-entry-scope'],
    queryFn: async () => {
      const r = await apiClient.get<{ data: EntryScope }>('/api/v1/prescriptions/entry-scope/me');
      const raw = r?.data as unknown;
      return ((raw as { data?: EntryScope })?.data ?? raw) as EntryScope;
    },
    staleTime: 60_000,
    enabled,
  });
}
