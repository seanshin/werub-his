'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

/**
 * 대기 시간 색상 임계 정본(§7 P2 수렴·2026-08-04) — config `clinical.queue.waitWarningMinutes`(경고)·
 * `clinical.queue.maxWaitMinutes`(위험). 종전엔 화면마다 10/15/20/30/60 이 제각각 하드코딩돼
 * 같은 대기가 화면에 따라 다른 색이었다. 이 훅+waitTone 만 쓴다(로컬 임계 재정의 금지).
 * 폴백 = DEFAULTS 기본(20/60) — config 조회 실패 시에도 화면은 산다.
 * ⚠️ ER(응급) 대기는 KTAS 기반 별도 축(qi.targets)이라 이 임계의 적용 대상이 아니다.
 */
export const QUEUE_THRESHOLD_DEFAULTS = { warnMinutes: 20, dangerMinutes: 60 };
export type QueueThresholds = typeof QUEUE_THRESHOLD_DEFAULTS;

function num(v: unknown, fb: number) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fb;
}

export function useQueueThresholds(): QueueThresholds {
  const q = useQuery({
    queryKey: ['queue-thresholds'],
    queryFn: () => apiClient.get<{ data: { key: string; value: unknown }[] }>('/api/v1/config?category=clinical'),
    staleTime: 300_000,
  });
  const raw = q.data?.data as { key: string; value: unknown }[] | { data?: { key: string; value: unknown }[] } | undefined;
  const rows = (Array.isArray(raw) ? raw : raw?.data) ?? [];
  const find = (k: string) => rows.find((r) => r.key === k)?.value;
  return {
    warnMinutes: num(find('clinical.queue.waitWarningMinutes'), QUEUE_THRESHOLD_DEFAULTS.warnMinutes),
    dangerMinutes: num(find('clinical.queue.maxWaitMinutes'), QUEUE_THRESHOLD_DEFAULTS.dangerMinutes),
  };
}

export type WaitTone = 'danger' | 'warn' | null;

/** 대기(분) → 톤. danger=최대 허용 초과·warn=경고 기준 초과·null=정상 */
export function waitTone(mins: number | null | undefined, t: QueueThresholds): WaitTone {
  if (mins == null || !Number.isFinite(mins)) return null;
  if (mins >= t.dangerMinutes) return 'danger';
  if (mins >= t.warnMinutes) return 'warn';
  return null;
}

export const WAIT_TONE_TEXT: Record<'danger' | 'warn', string> = {
  danger: 'text-red-600',
  warn: 'text-amber-600',
};
