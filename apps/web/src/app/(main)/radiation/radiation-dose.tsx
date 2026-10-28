'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from '@/stores/toast-store';
import { apiClient } from '@/lib/api-client';
import { KDate, Ratio, Unit } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import StatusBadge from '@/components/ui/StatusBadge';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

/**
 * 누적선량 표시(2026-10-10) — 서버 요약(`doseSummary`)만 그린다. 화면은 선량을 더하지 않는다.
 * 🔴 종전엔 목록에 선량이 없었고 계획 상세 EP 를 부르는 화면이 0 이라, 처방 대비 얼마나 조사됐는지 볼 곳이 없었다.
 */
export interface DoseSummary { deliveredGy: number; recordedFractions: number; prescribedGy: number | null }

export function doseSummaryOf(row: Record<string, unknown> | undefined): DoseSummary | null {
  const s = row?.doseSummary as DoseSummary | undefined;
  return s && typeof s.deliveredGy === 'number' ? s : null;
}

/** "누적 / 처방 Gy (비율)" — 처방 총선량이 없으면 산출 불가(0% 로 그리지 않는다) */
export function DoseSummaryText({ summary, className }: { summary: DoseSummary | null; className?: string }) {
  if (!summary) return <span className={`text-gray-400 ${className ?? ''}`}><T k="선량 요약 없음" /></span>;
  return (
    <span className={`inline-flex items-center gap-1 ${className ?? ''}`} data-dose-summary>
      <Ratio numerator={summary.deliveredGy} denominator={summary.prescribedGy} unavailableHint="처방 총선량 없음" />
      {summary.prescribedGy != null && <Unit>Gy</Unit>}
    </span>
  );
}

interface Fraction {
  id: string; fractionNumber: number | null; scheduledDate: string | null; status: string;
  deliveredDose: string | number | null; cumulativeDose: string | number | null; deliveredAt: string | null;
}

/**
 * 누적선량 진행 막대(2026-10-10) — 처방 총선량 대비 기록된 조사선량. 처방 총선량이 없으면 막대를 그리지 않는다(0% 아님).
 * 100% 를 넘으면 막대는 가득 채우고 넘었다고 말한다(과조사 의심 — 판정은 사람).
 */
export function DoseProgressBar({ summary }: { summary: DoseSummary | null }) {
  if (!summary || summary.prescribedGy == null || !(summary.prescribedGy > 0)) return null;
  const pct = (summary.deliveredGy / summary.prescribedGy) * 100;
  const over = pct > 100;
  return (
    <div className="space-y-0.5" data-dose-progress={over ? 'over' : 'within'}>
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuemin={0} aria-valuemax={summary.prescribedGy} aria-valuenow={summary.deliveredGy}>
        <div className={`h-full ${over ? 'bg-rose-500' : 'bg-indigo-500'}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
      </div>
      {over && <p className="text-[10px] font-semibold text-rose-700"><T k="처방 총선량을 넘었습니다 — 기록을 확인하십시오" /></p>}
    </div>
  );
}

/** 분할 상태별 수 — 저장된 상태만 센다 */
export function fractionCounts(fractions: Array<{ status: string }>): Record<string, number> {
  const m: Record<string, number> = {};
  for (const f of fractions) m[f.status] = (m[f.status] ?? 0) + 1;
  return m;
}

/** 예정 분할 취소 — 사유 필수(서버도 거부) · 예정(SCHEDULED)만 · 의사·관리자(서버 클래스 @Roles) */
function CancelFractionButton({ fractionId, planId }: { fractionId: string; planId: string }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: () => apiClient.patch(`/api/v1/radiation/fractions/${fractionId}/cancel`, { notes: reason.trim() }),
    onSuccess: () => { toast.success(tAttr('예정 분할을 취소했습니다.')); setOpen(false); setReason(''); qc.invalidateQueries({ queryKey: ['radiation-plan-detail', planId] }); qc.invalidateQueries({ queryKey: ['radiation-plans'] }); },
    onError: (e) => toast.error((e as { message?: string })?.message || tAttr('취소하지 못했습니다.')),
  });
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="min-h-[32px] rounded border border-gray-200 px-2 text-[11px] text-gray-600" data-fraction-cancel-open={fractionId}><T k="취소" /></button>;
  return (
    <span className="inline-flex items-center gap-1" data-fraction-cancel-form={fractionId}>
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tAttr('취소 사유')} className="w-28 rounded border px-1 py-0.5 text-[11px]" />
      <button type="button" disabled={!reason.trim() || m.isPending} onClick={() => m.mutate()} className="min-h-[44px] rounded bg-rose-600 px-2 text-[11px] text-white disabled:opacity-40" data-fraction-cancel-submit={fractionId}><T k="취소 확정" /></button>
      <button type="button" onClick={() => setOpen(false)} className="text-[11px] text-gray-500"><T k="닫기" /></button>
    </span>
  );
}

/**
 * '조사 중' 고착 정리(2026-10-10) — 조사 중은 서버가 기록 중에만 거치는 상태라, 남아 있으면 기록이 끊긴 분할이다.
 * 조사 기록·취소가 예정만 받아 어떤 화면에서도 닫을 수 없었다(계획 완료도 막혔다).
 * 결과는 미선택으로 시작 · 조사됨이면 치료기 기록의 선량·시각을 사람이 넣는다(지금 시각으로 채우지 않는다) · 사유 필수.
 */
export function StuckFractionResolver({ fractionId, planId }: { fractionId: string; planId: string }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<'' | 'DELIVERED' | 'NOT_DELIVERED'>('');
  const [dose, setDose] = useState('');
  const [at, setAt] = useState('');
  const [reason, setReason] = useState('');
  const doseNum = Number(dose);
  const ready = !!reason.trim() && (outcome === 'NOT_DELIVERED' || (outcome === 'DELIVERED' && dose.trim() !== '' && doseNum > 0 && !!at));
  const m = useMutation({
    mutationFn: () => apiClient.patch<{ data: unknown; meta?: { warnings?: string[] } }>(`/api/v1/radiation/fractions/${fractionId}/resolve-stuck`, {
      outcome, reason: reason.trim(),
      ...(outcome === 'DELIVERED' ? { deliveredDose: doseNum, deliveredAt: new Date(at).toISOString() } : {}),
    }),
    onSuccess: (r) => {
      const w = (r as { meta?: { warnings?: string[] } })?.meta?.warnings ?? [];
      if (w.length) toast.warning(tAttr('정리했습니다 — 처방과 다른 선량이거나 누적이 처방 총선량을 넘습니다. 기록을 확인하십시오.'));
      else toast.success(tAttr('조사 중 분할을 정리했습니다.'));
      setOpen(false);
      qc.invalidateQueries({ queryKey: ['radiation-plan-detail', planId] });
      qc.invalidateQueries({ queryKey: ['radiation-plans'] });
    },
    onError: (e) => toast.error((e as { message?: string })?.message || tAttr('정리하지 못했습니다.')),
  });
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="min-h-[44px] rounded border border-amber-300 px-2 text-[11px] text-amber-800" data-fraction-stuck-open={fractionId}><T k="조사 중 정리…" /></button>;
  return (
    <div className="mt-1 space-y-1 rounded border border-amber-200 bg-amber-50 p-2 text-left text-[11px]" data-fraction-stuck-form={fractionId}>
      <p className="text-amber-800"><T k="기록이 끊긴 분할입니다 — 치료기 기록을 확인해 실제 조사 여부를 고르십시오." /></p>
      <select value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)} className="w-full rounded border px-1 py-1" data-fraction-stuck-outcome>
        <option value="">{tAttr('— 고르십시오 —')}</option>
        <option value="DELIVERED">{tAttr('조사됨(치료기 기록 있음)')}</option>
        <option value="NOT_DELIVERED">{tAttr('조사 안 됨(취소)')}</option>
      </select>
      {outcome === 'DELIVERED' && (
        <div className="flex flex-wrap gap-1">
          <input value={dose} onChange={(e) => setDose(e.target.value)} inputMode="decimal" placeholder={tAttr('조사선량(Gy)')} className="w-24 rounded border px-1 py-1" data-fraction-stuck-dose />
          <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} className="rounded border px-1 py-1" aria-label={tAttr('조사 시각')} data-fraction-stuck-at />
        </div>
      )}
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={tAttr('정리 사유·근거')} className="w-full rounded border px-1 py-1" data-fraction-stuck-reason />
      <div className="flex gap-1">
        <button type="button" disabled={!ready || m.isPending} onClick={() => m.mutate()} className="min-h-[44px] rounded bg-amber-600 px-3 text-white disabled:opacity-40" data-fraction-stuck-submit={fractionId}><T k="정리" /></button>
        <button type="button" onClick={() => setOpen(false)} className="min-h-[44px] px-2 text-gray-500"><T k="닫기" /></button>
      </div>
    </div>
  );
}

/** 계획 하나의 분할 기록 — 계획 상세 EP(`plans/:id`)를 부른다 */
export function PlanFractionsPanel({ planId }: { planId: string }) {
  // 예정 분할 취소는 계획 쓰기와 같은 역할(서버 클래스 @Roles DOCTOR·ADMIN) — 권한 밖이면 버튼을 그리지 않는다
  const role = useAuthStore((st) => st.user?.role);
  const canCancel = role === 'DOCTOR' || role === 'ADMIN';
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['radiation-plan-detail', planId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown> }>(`/api/v1/radiation/plans/${planId}`),
  });
  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} size="compact" />;
  if (isLoading) return <p className="text-xs text-gray-400 py-2"><T k="불러오는 중..." /></p>;
  const plan = (data?.data ?? {}) as Record<string, unknown>;
  const fractions = (Array.isArray(plan.fractions) ? plan.fractions : []) as Fraction[];
  const counts = fractionCounts(fractions);
  const planned = typeof plan.totalFractions === 'number' ? plan.totalFractions : null;
  return (
    <div className="space-y-2" data-plan-fractions={planId}>
      <p className="text-xs text-gray-600">
        <T k="누적선량" />: <DoseSummaryText summary={doseSummaryOf(plan)} />
      </p>
      <DoseProgressBar summary={doseSummaryOf(plan)} />
      {fractions.length > 0 && (
        <p className="flex flex-wrap gap-2 text-[11px] text-gray-600" data-fraction-counts>
          {planned != null && <span><Tf k="계획 분할 {n}회" params={{ n: planned }} /></span>}
          {Object.entries(counts).map(([st, n]) => <span key={st} className="inline-flex items-center gap-1"><StatusBadge domain="radiationFraction" status={st} className="text-[10px]" /> {n}</span>)}
        </p>
      )}
      {fractions.length === 0 ? (
        <p className="text-xs text-gray-400"><T k="생성된 분할 없음" /></p>
      ) : (
        <table className="w-full text-xs">
          <thead><tr className="text-gray-500">
            <th className="text-left py-1"><T k="분할 #" /></th>
            <th className="text-left py-1"><T k="예정일" /></th>
            <th className="text-left py-1"><T k="상태" /></th>
            <th className="text-right py-1"><T k="조사선량" /></th>
            <th className="text-right py-1"><T k="누적" /></th>
            {canCancel && <th className="py-1" />}
          </tr></thead>
          <tbody>
            {fractions.map((f) => (
              <tr key={f.id} className="border-t border-gray-100">
                <td className="py-1">#{f.fractionNumber ?? '-'}</td>
                <td className="py-1"><KDate value={f.scheduledDate} /></td>
                <td className="py-1"><StatusBadge domain="radiationFraction" status={f.status} className="text-[10px]" /></td>
                {/* 기록 없으면 '—' — 0 으로 그리지 않는다(조사하지 않은 것과 0Gy 조사는 다르다) */}
                <td className="py-1 text-right">{f.deliveredDose != null ? <>{String(f.deliveredDose)}<Unit>Gy</Unit></> : '—'}</td>
                <td className="py-1 text-right">{f.cumulativeDose != null ? <>{String(f.cumulativeDose)}<Unit>Gy</Unit></> : '—'}</td>
                {canCancel && <td className="py-1 text-right">{f.status === 'SCHEDULED' && <CancelFractionButton fractionId={f.id} planId={planId} />}{f.status === 'DELIVERING' && <StuckFractionResolver fractionId={f.id} planId={planId} />}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-[10px] text-gray-400"><Tf k="누적은 기록된 조사선량의 합입니다(분할 {n}건 기록)." params={{ n: doseSummaryOf(plan)?.recordedFractions ?? 0 }} /></p>
    </div>
  );
}
