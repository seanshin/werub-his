'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useHasRole } from '@/hooks/use-admin-write';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { toast } from '@/stores/toast-store';

/**
 * 방사선 계획 진행 버튼(2026-10-10).
 * 🔴 종전 화면은 계획을 만들기만 했다 — 승인(`plans/:id/approve`)·분할 생성(`fractions/generate`)·상태 변경(`plans/:id/status`)을
 *    부르는 화면이 없어 **화면에서 만든 계획은 '계획'에서 한 발짝도 나가지 못했다**(분할이 없으니 조사 기록도 불가).
 *  · 승인은 처방의 본인이 아닌 의사(서버 4-eyes) · 분할 생성은 승인된 계획만(서버) · 상태 전이 규칙은 서버 정본(여기는 단계별 버튼만)
 *  · 취소·완료는 되돌릴 수 없어 두 번 누른다(확인 창 대신)
 */
type Action = { key: string; label: string; run: () => Promise<unknown>; irreversible?: boolean };

export function resumeTarget(plan: { planApprovedAt?: unknown; fractions?: unknown }): 'PLANNED' | 'APPROVED' | 'IN_TREATMENT' {
  if (!plan.planApprovedAt) return 'PLANNED';
  return Array.isArray(plan.fractions) && plan.fractions.length > 0 ? 'IN_TREATMENT' : 'APPROVED';
}

export function PlanActions({ plan }: { plan: Record<string, unknown> }) {
  const canAct = useHasRole('DOCTOR');
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [armed, setArmed] = useState<string | null>(null);
  const id = plan.id as string;
  const status = String(plan.status ?? '');
  const done = () => {
    setArmed(null);
    qc.invalidateQueries({ queryKey: ['radiation-plans'] });
    qc.invalidateQueries({ queryKey: ['radiation-plan-detail', id] });
    qc.invalidateQueries({ queryKey: ['radiation-fractions-today'] });
  };
  const m = useMutation({
    mutationFn: (a: Action) => a.run(),
    onSuccess: () => { toast.success(tAttr('반영했습니다.')); done(); },
    onError: (e) => { setArmed(null); toast.error((e as { message?: string })?.message || tAttr('반영하지 못했습니다.')); },
  });
  if (!canAct) return null;
  const setStatus = (to: string) => () => apiClient.patch(`/api/v1/radiation/plans/${id}/status`, { status: to });
  const actions: Action[] = [
    ...(status === 'PLANNED' ? [{ key: 'approve', label: '승인(처방의 외)', run: () => apiClient.patch(`/api/v1/radiation/plans/${id}/approve`, {}) }] : []),
    ...(status === 'APPROVED' ? [{ key: 'generate', label: '분할 일정 생성', run: () => apiClient.post(`/api/v1/radiation/plans/${id}/fractions/generate`, {}) }] : []),
    ...(['PLANNED', 'APPROVED', 'IN_TREATMENT'].includes(status) ? [{ key: 'hold', label: '보류', run: setStatus('ON_HOLD') }] : []),
    ...(status === 'ON_HOLD' ? [{ key: 'resume', label: '보류 해제', run: setStatus(resumeTarget(plan)) }] : []),
    ...(status === 'IN_TREATMENT' ? [{ key: 'complete', label: '치료 완료', run: setStatus('COMPLETED'), irreversible: true }] : []),
    ...(['PLANNED', 'APPROVED', 'IN_TREATMENT', 'ON_HOLD'].includes(status) ? [{ key: 'cancel', label: '계획 취소', run: setStatus('CANCELLED'), irreversible: true }] : []),
  ];
  if (actions.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5" data-rt-plan-actions={id}>
      {actions.map((a) => {
        const arming = a.irreversible && armed !== a.key;
        return (
          <button key={a.key} type="button" disabled={m.isPending} data-rt-action={a.key} data-armed={armed === a.key ? 'yes' : 'no'}
            onClick={() => (arming ? setArmed(a.key) : m.mutate(a))}
            className={`min-h-[44px] rounded-lg px-3 text-xs font-semibold disabled:opacity-40 ${a.irreversible ? (armed === a.key ? 'bg-rose-600 text-white' : 'border border-rose-200 text-rose-700') : 'border border-gray-200 bg-white text-gray-800'}`}>
            {armed === a.key ? <T k="한 번 더 누르면 확정(되돌릴 수 없음)" /> : <T k={a.label} />}
          </button>
        );
      })}
    </div>
  );
}
