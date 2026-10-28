'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { normalizeShiftBoundaries, normalizeLateEntryGraceMinutes, shiftOf, DEFAULT_SHIFT_BOUNDARIES, type ShiftBoundaries, type NursingShift } from '@hospital-run/shared';

/**
 * 교대 경계 config 훅 — 판정 로직은 shared 정본(shiftOf), 경계만 서버에서.
 * 조회 실패·미설정이면 기본(7/15/23) — 교대 판정이 죽으면 기록 저장이 막힌다(항상 동작 우선).
 */
export function useShiftBoundaries(): ShiftBoundaries {
  const { data } = useQuery({
    queryKey: ['shift-boundaries'],
    queryFn: () => apiClient.get<{ data: unknown }>('/api/v1/config/nursing.shift.boundaries'),
    staleTime: 10 * 60 * 1000,
  });
  return normalizeShiftBoundaries(data?.data);
}

export { shiftOf, DEFAULT_SHIFT_BOUNDARIES };
export type { NursingShift, ShiftBoundaries };

/**
 * 늦은 기록 유예(분) — config `nursing.lateEntry.graceMinutes`(원내 기록 규정 · 2026-10-01).
 * `graceMinutes: null` = **미설정**(판정은 유예 0) · 로딩 중·조회 실패는 `state` 로 갈라 말한다(미설정과 다른 사실).
 */
export function useLateEntryGrace(): { graceMinutes: number | null; state: 'loading' | 'error' | 'ready' } {
  const q = useQuery({
    queryKey: ['late-entry-grace'],
    queryFn: () => apiClient.get<{ data: unknown }>('/api/v1/config/nursing.lateEntry.graceMinutes'),
    staleTime: 10 * 60 * 1000,
  });
  if (q.isError) return { graceMinutes: null, state: 'error' };
  if (q.isLoading) return { graceMinutes: null, state: 'loading' };
  return { graceMinutes: normalizeLateEntryGraceMinutes(q.data?.data), state: 'ready' };
}
