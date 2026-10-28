'use client';

import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

interface WidgetQueryResult<T> {
  data: T | null;
  isLoading: boolean;
  isForbidden: boolean;
  error: unknown;
}

export function useWidgetQuery<T>(
  queryKey: string[],
  endpoint: string,
  options?: Partial<UseQueryOptions>,
): WidgetQueryResult<T> {
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      try {
        const res = await apiClient.get<{ data: T }>(endpoint) as any;
        /**
         * 🔴 (2026-10-02) 봉투(`{data}`)가 없는 응답을 버리고 있었다 — `/health` 는 `{status,version}` 이라
         *    `res.data` 가 없어 '시스템 상태' 위젯이 개통 이래 "데이터 없음"이었다(실화면).
         *    봉투가 있으면 벗기고(이중 봉투도), 없으면 응답 그대로 쓴다.
         */
        const raw = res && typeof res === 'object' && 'data' in res ? res.data : res;
        return { __data: raw && typeof raw === 'object' && 'data' in raw ? raw.data : raw, __forbidden: false };
      } catch (err: any) {
        if (err?.code === 'UNAUTHORIZED' || err?.code === 'FORBIDDEN' || err?.status === 403) {
          return { __data: null, __forbidden: true };
        }
        throw err;
      }
    },
    retry: (count: number, err: any) => {
      if (err?.code === 'FORBIDDEN' || err?.code === 'UNAUTHORIZED' || err?.status === 403) return false;
      return count < 2;
    },
    ...options,
  } as any);

  return {
    data: (query.data as any)?.__data ?? null,
    isLoading: query.isLoading,
    isForbidden: (query.data as any)?.__forbidden ?? false,
    error: query.error,
  };
}
