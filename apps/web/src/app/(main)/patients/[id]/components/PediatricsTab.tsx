'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import GrowthCurveChart from '@/components/specialty/GrowthCurveChart';
import { growthPointsOf, growthSexOf, devResultView } from '@/lib/specialty/pediatrics-views';
import { kdate } from '@/lib/ui-settings';
import { T } from '@/components/ui/i18n-text';
import { GrowthPercentileCell } from '@/components/specialty/GrowthPercentileCell';

type PedSubTab = 'growth' | 'immunization' | 'development';

export function PediatricsTab({ patientId }: { patientId: string }) {
  const [tab, setTab] = useState<PedSubTab>('growth');

  const { data: growthData, isLoading: growthLoading, isError: growthIsError, error: growthError, refetch: refetchGrowth } = useQuery({
    queryKey: ['pediatrics-growth', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/pediatrics/growth/${patientId}`),
    enabled: tab === 'growth' && !!patientId,
  });

  const { data: immunData, isLoading: immunLoading, isError: immunIsError, error: immunError, refetch: refetchImmun } = useQuery({
    queryKey: ['pediatrics-immunizations', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/pediatrics/immunizations/${patientId}`),
    enabled: tab === 'immunization' && !!patientId,
  });

  const growthItems: Record<string, unknown>[] = (() => {
    const r = growthData?.data;
    return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? [];
  })();

  const immunItems: Record<string, unknown>[] = (() => {
    const r = immunData?.data;
    return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? [];
  })();

  const completedCount = useMemo(() => immunItems.filter((it) => it.givenAt != null).length, [immunItems]);

  const LoadingRows = ({ cols }: { cols: number }) => (
    <>{Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={cols} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)}</>
  );

  return (
    <div>
      <div className="flex gap-1 mb-5 bg-gray-100/80 p-1 rounded-xl w-fit">
        {([
          { key: 'growth' as PedSubTab, label: '성장 기록' },
          { key: 'immunization' as PedSubTab, label: '접종 현황' },
          { key: 'development' as PedSubTab, label: '발달 평가' },
        ]).map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>{t.label}</button>
        ))}
      </div>

      {tab === 'growth' && (
        <div className="space-y-4">
          {growthItems.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              {/* 🔴 종전 gender="male" 하드코딩 — 여아도 남아 백분위 곡선 위에 그려졌다(2026-08-26).
                  성별은 서버가 성장기록과 함께 주는 환자 원장값이고, 미상이면 차트가 참조곡선을 그리지 않는다. */}
              <GrowthCurveChart data={growthPointsOf(growthItems)} type="weight" gender={growthSexOf(growthItems[0])} />
            </div>
          )}

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="체중(kg)" /></th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="신장(cm)" /></th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="두위(cm)" /></th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="체중 백분위" /></th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="신장 백분위" /></th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="날짜" /></th>
                </tr>
              </thead>
              <tbody>
                {growthIsError ? <tr><td colSpan={6} className="px-4 py-3"><QueryErrorFallback error={growthError} onRetry={refetchGrowth} size="compact" /></td></tr>
                : growthLoading ? <LoadingRows cols={6} />
                : growthItems.length === 0 ? <tr><td colSpan={6} className="py-12 text-center text-gray-400"><T k="기록 없음" /></td></tr>
                : growthItems.map((it) => (
                  <tr key={it.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3 text-xs font-bold text-gray-900">{it.weight != null ? `${it.weight}` : '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-700">{it.height != null ? `${it.height}` : '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-700">{it.headCirc != null ? `${it.headCirc}` : '-'}</td>
                    <td className="px-4 py-3">
                      <GrowthPercentileCell value={it.weightPercentile} basis={it.percentileBasis} />
                    </td>
                    <td className="px-4 py-3">
                      <GrowthPercentileCell value={it.heightPercentile} basis={it.percentileBasis} />
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400">{it.measuredAt ? kdate(it.measuredAt as string) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'immunization' && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <p className="text-xs text-gray-500"><T k="접종 완료" /></p>
            <p className="text-2xl font-bold text-emerald-600">{completedCount}<span className="text-sm text-gray-400 ml-1">/ {immunItems.length}</span></p>
          </div>

          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="백신명" /></th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="차수" /></th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="상태" /></th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="예정일" /></th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="접종일" /></th>
                </tr>
              </thead>
              <tbody>
                {immunIsError ? <tr><td colSpan={5} className="px-4 py-3"><QueryErrorFallback error={immunError} onRetry={refetchImmun} size="compact" /></td></tr>
                : immunLoading ? <LoadingRows cols={5} />
                : immunItems.length === 0 ? <tr><td colSpan={5} className="py-12 text-center text-gray-400"><T k="기록 없음" /></td></tr>
                : immunItems.map((it) => {
                  const completed = it.givenAt != null;
                  return (
                    <tr key={it.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-3 text-xs font-bold text-gray-900">{(it.vaccineName as string) ?? '-'}</td>
                      <td className="px-4 py-3 text-xs text-gray-700">{it.doseNumber != null ? `${it.doseNumber}차` : '-'}</td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${completed ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                          {completed ? '완료' : '미접종'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-400">{it.nextDueDate ? kdate(it.nextDueDate as string) : '-'}</td>
                      <td className="px-4 py-3 text-xs text-gray-400">{it.givenAt ? kdate(it.givenAt as string) : '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'development' && <DevelopmentSection patientId={patientId} />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Development Assessment Section
   ═══════════════════════════════════════════════════════════════ */

// BE DevelopmentalAssessment 도메인별 결과 필드 (grossMotor/fineMotor/language/socialPersonal)
const DEV_DOMAINS = [
  { key: 'grossMotor', label: '대근육 운동', icon: '🏃', color: 'bg-blue-100 text-blue-700' },
  { key: 'fineMotor', label: '소근육 운동', icon: '✋', color: 'bg-emerald-100 text-emerald-700' },
  { key: 'language', label: '언어', icon: '🗣️', color: 'bg-violet-100 text-violet-700' },
  { key: 'socialPersonal', label: '사회성', icon: '👥', color: 'bg-pink-100 text-pink-700' },
];

/** 발달 결과 문자열(NORMAL/DELAYED/…) → 색상 배지. null 안전.
 *  어휘·색 정본은 `lib/specialty/pediatrics-views`(대시보드와 공유) — 여기서 다시 정의하면 갈라진다. */
function ResultBadge({ value }: { value: unknown }) {
  const v = devResultView(value);
  if (!v) return <span className="text-xs text-gray-400">-</span>;
  return <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${v.cls}`}>{v.label}</span>;
}

function DevelopmentSection({ patientId }: { patientId: string }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['pediatrics-development', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/pediatrics/developmental/${patientId}`),
    enabled: !!patientId,
  });

  const items: Record<string, unknown>[] = (() => {
    const r = data?.data;
    return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? [];
  })();

  // 🔴 에러 분기가 로딩보다 먼저 — 조회 실패를 "기록 없음"으로도 영구 로딩으로도 굳히지 않는다
  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;
  if (isLoading) return <div className="py-8 text-center text-gray-400 animate-pulse"><T k="발달 평가 로딩 중..." /></div>;

  if (items.length === 0) {
    return (
      <div className="space-y-4">
        <div className="py-12 text-center bg-white rounded-2xl border">
          <div className="text-3xl mb-2">📋</div>
          <p className="text-gray-400 text-sm"><T k="발달 평가 기록이 없습니다" /></p>
        </div>

        {/* Dev milestone reference */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <h3 className="text-xs font-semibold text-gray-700 mb-3"><T k="발달 영역 체크리스트 (참고)" /></h3>
          <div className="grid grid-cols-4 gap-2">
            {DEV_DOMAINS.map(d => (
              <div key={d.key} className={`rounded-xl p-3 text-center ${d.color}`}>
                <div className="text-lg mb-1">{d.icon}</div>
                <div className="text-[10px] font-semibold">{d.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // 최근(첫) 평가 — 도메인별 결과 요약
  const latest = items[0];

  return (
    <div className="space-y-4">
      {/* Latest domain summary */}
      <div className="grid grid-cols-4 gap-2">
        {DEV_DOMAINS.map(d => (
          <div key={d.key} className="bg-white rounded-xl border p-3 text-center">
            <div className="text-base mb-1">{d.icon}</div>
            <div className="text-[10px] font-semibold text-gray-700 mb-1">{d.label}</div>
            <ResultBadge value={latest[d.key]} />
          </div>
        ))}
      </div>

      {/* Assessment history — 평가별로 4개 도메인 결과를 한 행에 펼쳐 표시 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="월령" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="도구" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="대근육" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="소근육" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="언어" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="사회성" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="종합판정" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="날짜" /></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                <td className="px-4 py-3 text-xs font-bold">{it.ageMonths != null ? `${it.ageMonths}개월` : '-'}</td>
                <td className="px-4 py-3 text-xs text-gray-700">{(it.tool as string) ?? '-'}</td>
                <td className="px-4 py-3"><ResultBadge value={it.grossMotor} /></td>
                <td className="px-4 py-3"><ResultBadge value={it.fineMotor} /></td>
                <td className="px-4 py-3"><ResultBadge value={it.language} /></td>
                <td className="px-4 py-3"><ResultBadge value={it.socialPersonal} /></td>
                <td className="px-4 py-3"><ResultBadge value={it.overallResult} /></td>
                <td className="px-4 py-3 text-xs text-gray-400">{it.assessedAt ? kdate(it.assessedAt as string) : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
