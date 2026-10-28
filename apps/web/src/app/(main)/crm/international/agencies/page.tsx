'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { KDate, Money, EmptyState, Unit } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

/**
 * 에이전시 관리 — "Phase 2 예정" 스텁을 실데이터로 보완(2026-08-04).
 * 별도 Agency 모델 없이 해외환자 케이스의 agencyName 축 집계(서버 international/agencies).
 * 계약서/수수료율 CRUD 는 여전히 범위 밖 — 표에서 말하는 건 실적 사실뿐이다.
 */

interface AgencyRow {
  agency: string;
  cases: number;
  active: number;
  closed: number;
  estimatedCost: number;
  actualCost: number;
  satisfaction: number | null;
  lastCaseAt: string | null;
}

export default function AgenciesPage() {
  const tAttr = useTAttr();
  const { data, isLoading } = useQuery({
    queryKey: ['crm-agency-stats'],
    queryFn: () => apiClient.get<{ data: AgencyRow[] }>('/api/v1/crm/international/agencies'),
    staleTime: 60_000,
  });
  const raw = data?.data;
  const rows: AgencyRow[] = Array.isArray(raw) ? raw : (raw as unknown as { data?: AgencyRow[] })?.data ?? [];
  const totals = rows.reduce((a, r) => ({ cases: a.cases + r.cases, active: a.active + r.active, actual: a.actual + r.actualCost }), { cases: 0, active: 0, actual: 0 });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="에이전시 관리" /></h1>
          <p className="text-sm text-gray-500 mt-1"><T k="의료관광 에이전시별 유치 실적 — 케이스 기준 집계" /></p>
        </div>
        <Link href="/crm/international/cases" className="text-sm text-blue-600 font-medium hover:underline"><T k="케이스 관리" /> →</Link>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: '전체 케이스', value: <>{totals.cases}<Unit>건</Unit></>, bg: 'bg-emerald-50', text: 'text-emerald-700' },
          { label: '진행 중', value: <>{totals.active}<Unit>건</Unit></>, bg: 'bg-blue-50', text: 'text-blue-700' },
          { label: '실현 매출(합)', value: <Money value={totals.actual} />, bg: 'bg-violet-50', text: 'text-violet-700' },
        ].map((s, i) => (
          <div key={i} className={`rounded-2xl border border-gray-100 p-5 text-center ${s.bg}`}>
            <p className={`text-2xl font-bold ${s.text}`}>{s.value}</p>
            <p className="text-xs text-gray-500 mt-1"><T k={s.label} /></p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-100">
            <tr className="text-xs text-gray-500">
              <th className="text-left py-3 px-4 font-medium"><T k="에이전시" /></th>
              <th className="text-right py-3 px-4 font-medium"><T k="케이스" /></th>
              <th className="text-right py-3 px-4 font-medium"><T k="진행중" /></th>
              <th className="text-right py-3 px-4 font-medium"><T k="종결@집계" /></th>
              <th className="text-right py-3 px-4 font-medium"><T k="견적 합계" /></th>
              <th className="text-right py-3 px-4 font-medium"><T k="실현 매출" /></th>
              <th className="text-right py-3 px-4 font-medium"><T k="만족도" /></th>
              <th className="text-right py-3 px-4 font-medium whitespace-nowrap"><T k="최근 케이스" /></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {isLoading ? (
              <tr><td colSpan={8} className="py-10 text-center text-gray-400 text-sm"><T k="불러오는 중…" /></td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8}><EmptyState icon="🤝" title="집계할 해외환자 케이스가 없습니다" hint="케이스 등록 시 에이전시명을 입력하면 여기에 집계됩니다" /></td></tr>
            ) : rows.map((r) => (
              <tr key={r.agency} className="hover:bg-gray-50/60">
                <td className="py-3 px-4 font-medium text-gray-900 whitespace-nowrap">{r.agency}</td>
                <td className="py-3 px-4 text-right tabular-nums font-semibold">{r.cases}<Unit>건</Unit></td>
                <td className="py-3 px-4 text-right tabular-nums text-blue-700">{r.active}<Unit>건</Unit></td>
                <td className="py-3 px-4 text-right tabular-nums text-gray-500">{r.closed}<Unit>건</Unit></td>
                <td className="py-3 px-4 text-right tabular-nums text-gray-600"><Money value={r.estimatedCost} /></td>
                <td className="py-3 px-4 text-right tabular-nums font-semibold text-violet-700"><Money value={r.actualCost} /></td>
                <td className="py-3 px-4 text-right tabular-nums">{r.satisfaction != null ? `★ ${r.satisfaction}` : <span className="text-gray-300">-</span>}</td>
                <td className="py-3 px-4 text-right text-xs text-gray-500 whitespace-nowrap"><KDate value={r.lastCaseAt} mode="date" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-gray-400">
        <T k="집계 축은 케이스의 에이전시명입니다 — 계약서·수수료율 관리는 범위 밖(필요 시 별도 트랙). 에이전시명이 비어 있는 케이스는 (직접 유치)로 묶입니다." />
      </p>
    </div>
  );
}
