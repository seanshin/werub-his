'use client';

import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { useDashboardStore } from '../stores/dashboard-store';
import { getDefaultConfig, DASHBOARD_CONFIG_VERSION } from '../components/default-layouts';
import type { DashboardConfig } from '../components/default-layouts';

export function useDashboardConfig() {
  const { user } = useAuthStore();
  const store = useDashboardStore();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard-config'],
    queryFn: async (): Promise<DashboardConfig | null> => {
      try {
        const res = await apiClient.get<{ data: DashboardConfig | null }>('/api/v1/dashboard/config');
        const raw = res?.data as any;
        return raw?.data ?? raw ?? null;
      } catch {
        const saved = typeof window !== 'undefined' ? localStorage.getItem('dashboard-config') : null;
        return saved ? JSON.parse(saved) : null;
      }
    },
    staleTime: Infinity,
  });

  useEffect(() => {
    if (isLoading) return;
    // v2 미만 저장분(구 레이아웃)은 개선된 기본으로 재적용 — 밀도·통합 위젯 반영.
    const usable = data && (data.version ?? 0) >= DASHBOARD_CONFIG_VERSION ? data : null;
    const config = usable ?? getDefaultConfig(user?.role, user?.department);
    store.loadConfig(config);
  }, [data, isLoading]);

  const saveMutation = useMutation({
    mutationFn: (config: DashboardConfig) =>
      apiClient.put('/api/v1/dashboard/config', config),
    onSuccess: () => {
      store.finishEditing();
      qc.invalidateQueries({ queryKey: ['dashboard-config'] });
    },
    onError: () => {
      try {
        localStorage.setItem('dashboard-config', JSON.stringify(store.getConfig()));
      } catch { /* ignore */ }
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => apiClient.del('/api/v1/dashboard/config'),
    onSuccess: () => {
      store.resetToDefault(user?.role, user?.department);
      try { localStorage.removeItem('dashboard-config'); } catch { /* */ }
      qc.invalidateQueries({ queryKey: ['dashboard-config'] });
    },
  });

  return {
    isLoading,
    save: () => saveMutation.mutate(store.getConfig()),
    reset: () => resetMutation.mutate(),
    isSaving: saveMutation.isPending,
  };
}
