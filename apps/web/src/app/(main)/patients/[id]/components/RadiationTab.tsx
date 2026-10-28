'use client';

import { useState } from 'react';
import { Unit } from '@/components/ui/display';
import { useQuery } from '@tanstack/react-query';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { apiClient } from '@/lib/api-client';
import { DoseSummaryText, doseSummaryOf } from '@/app/(main)/radiation/radiation-dose';
import { kdate } from '@/lib/ui-settings';
import StatusBadge from '@/components/ui/StatusBadge';
import { T } from '@/components/ui/i18n-text';

// 🔴 로컬 라벨표는 서버 어휘(PLANNED·IN_TREATMENT·ON_HOLD)를 몰라 치료 중 계획이 영문으로 샜다 —
//    상태 표기는 shared 정본(StatusBadge domain="radiationPlan") 하나뿐이다.
const CTCAE_GRADE_COLOR: Record<number, string> = {
  0: 'bg-gray-100 text-gray-500', 1: 'bg-emerald-100 text-emerald-700',
  2: 'bg-yellow-100 text-yellow-700', 3: 'bg-orange-100 text-orange-700',
  4: 'bg-red-100 text-red-700', 5: 'bg-red-200 text-red-900',
};

type RadiationSubTab = 'plans' | 'toxicity';

interface RadiationTabProps {
  patientId: string;
}

export function RadiationTab({ patientId }: RadiationTabProps) {
  const [tab, setTab] = useState<RadiationSubTab>('plans');
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);

  const { data: plansData, isLoading: plansLoading, isError, error, refetch } = useQuery({
    queryKey: ['radiation-plans', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/radiation/plans`, { patientId }),
    enabled: !!patientId,
  });

  const plans: Record<string, unknown>[] = (() => { const r = plansData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();

  const { data: toxicityData, isLoading: toxicityLoading, isError: toxicityIsError, error: toxicityError, refetch: refetchToxicity } = useQuery({
    queryKey: ['radiation-toxicity', selectedPlanId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/radiation/plans/${selectedPlanId}/toxicity`),
    enabled: tab === 'toxicity' && !!selectedPlanId,
  });

  const toxicities: Record<string, unknown>[] = (() => { const r = toxicityData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();

  // Auto-select first plan for toxicity tab
  if (selectedPlanId === null && plans.length > 0) {
    setSelectedPlanId(plans[0].id as string);
  }

  const LoadingRows = ({ cols }: { cols: number }) => (
    <>{Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={cols} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)}</>
  );

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} size="compact" />;
  return (
    <div>
      <div className="flex gap-1 mb-5 bg-gray-100/80 p-1 rounded-xl w-fit">
        {([
          { key: 'plans' as RadiationSubTab, label: '치료 계획' },
          { key: 'toxicity' as RadiationSubTab, label: 'CTCAE 독성' },
        ]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>{t.label}</button>
        ))}
      </div>

      {/* 치료 계획 */}
      {tab === 'plans' && (
        <div className="space-y-4">
          {plans.map((p) => {
            const status = (p.status as string) ?? 'DRAFT';
            const doc = p.prescriber as Record<string, unknown> | undefined;
            const fractions = (p.fractions ?? p.fractionSchedules) as Record<string, unknown>[] | undefined;
            const totalFractions = Number(p.totalFractions ?? p.plannedFractions ?? 0);
            const deliveredCount = Array.isArray(fractions)
              ? fractions.filter((f) => f.status === 'DELIVERED' || f.status === 'COMPLETED').length
              : Number(p.deliveredFractions ?? 0);
            const progressPct = totalFractions > 0 ? Math.round((deliveredCount / totalFractions) * 100) : 0;

            return (
              <div key={p.id as string} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">{(p.planName ?? p.diagnosis ?? p.targetSite) as string ?? '방사선 치료'}</h3>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {(p.technique as string) ?? ''} {p.totalDose ? `${p.totalDose} Gy` : ''} / {totalFractions}fx
                      {p.machine ? ` | ${p.machine as string}` : ''}
                    </p>
                  </div>
                  <StatusBadge domain="radiationPlan" status={status} className="text-[10px] font-bold" />
                </div>

                {/* Progress bar */}
                <div>
                  <div className="flex justify-between text-[10px] text-gray-500 mb-1">
                    <span><T k="분할 진행률" /></span>
                    <span>{deliveredCount} / {totalFractions} ({progressPct}<Unit>%</Unit>)</span>
                  </div>
                  <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
                  </div>
                </div>

                {/* 누적선량 — 서버 요약(기록된 조사선량 합 ÷ 처방 총선량 · 2026-10-10) */}
                <p className="text-xs text-gray-600"><T k="누적선량" />: <DoseSummaryText summary={doseSummaryOf(p)} /></p>

                <div className="flex gap-4 text-xs text-gray-500">
                  <span>처방의: {doc ? `${(doc.familyName as string) ?? ''}${(doc.givenName as string) ?? ''}` : '-'}</span>
                  <span>시작: {p.startDate ? kdate(p.startDate as string) : '-'}</span>
                  <span>종료: {p.endDate ? kdate(p.endDate as string) : '-'}</span>
                </div>
              </div>
            );
          })}
          {plansLoading && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" />)}
              </div>
            </div>
          )}
          {!plansLoading && plans.length === 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center text-gray-400"><T k="방사선 치료 계획 없음" /></div>
          )}
        </div>
      )}

      {/* CTCAE 독성 */}
      {tab === 'toxicity' && (
        <div className="space-y-4">
          {plans.length > 1 && (
            <div className="flex gap-2 flex-wrap">
              {plans.map((p) => (
                <button key={p.id as string} onClick={() => setSelectedPlanId(p.id as string)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${selectedPlanId === p.id ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  {(p.planName ?? p.diagnosis ?? p.targetSite) as string ?? '치료 계획'}
                </button>
              ))}
            </div>
          )}

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="날짜" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="부작용" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="CTCAE 등급" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="조치" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="평가자" /></th>
              </tr></thead>
              <tbody>
                {toxicityIsError ? <tr><td colSpan={5} className="px-4 py-3"><QueryErrorFallback error={toxicityError} onRetry={refetchToxicity} size="compact" /></td></tr>
                : toxicityLoading ? <LoadingRows cols={5} />
                : !selectedPlanId ? <tr><td colSpan={5} className="py-12 text-center text-gray-400"><T k="치료 계획을 선택하세요" /></td></tr>
                : toxicities.length === 0 ? <tr><td colSpan={5} className="py-12 text-center text-gray-400"><T k="독성 기록 없음" /></td></tr>
                : toxicities.map((t) => {
                  const grade = Number(t.grade ?? t.ctcaeGrade ?? 0);
                  const assessor = t.assessor as Record<string, unknown> | undefined;
                  return (
                    <tr key={t.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-3 text-xs text-gray-700">{(t.assessedAt ?? t.createdAt) ? kdate(((t.assessedAt ?? t.createdAt) as string)) : '-'}</td>
                      <td className="px-4 py-3 text-xs text-gray-900 font-medium">{(t.toxicityType ?? t.term ?? t.symptom) as string ?? '-'}</td>
                      <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${CTCAE_GRADE_COLOR[grade] ?? 'bg-gray-100'}`}>Grade {grade}</span></td>
                      <td className="px-4 py-3 text-xs text-gray-700 max-w-[150px] truncate">{(t.management ?? t.action ?? t.notes) as string ?? '-'}</td>
                      <td className="px-4 py-3 text-xs text-gray-700">{assessor ? `${(assessor.familyName as string) ?? ''}${(assessor.givenName as string) ?? ''}` : '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
