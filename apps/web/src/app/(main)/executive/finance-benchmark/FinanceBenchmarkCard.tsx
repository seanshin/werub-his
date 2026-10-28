'use client';

/**
 * 경영성과 벤치마크 요약 카드 — 통합 상황판·대시보드 위젯이 같이 쓴다(상세는 /executive/finance-benchmark).
 * 🔴 정직: 데이터 없음 / 우리 병원 미지정 / 미존재 / 비교 가능을 다른 말로 한다 · 비교 기준은 동급 중앙값 · 비율은 %·편차는 %p.
 */
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { COST_RATIOS, type FinanceRatio, type PeerStat } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { Num, Ratio } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

interface Overview {
  available: boolean;
  year?: number;
  type?: string | null;
  peerCount?: number;
  peer?: Record<FinanceRatio, PeerStat>;
  self?: {
    status: 'NOT_SET' | 'NOT_FOUND' | 'FOUND'; name: string | null;
    ratios?: Record<FinanceRatio, number | null>;
    deviations?: Record<FinanceRatio, { diff: number | null; worse: boolean | null }>;
  };
}

const pct = (v: number | null | undefined) => (v == null ? null : v * 100);

function CostLabel({ r }: { r: FinanceRatio }) {
  return r === 'laborRatio' ? <T k="인건비율" /> : r === 'materialRatio' ? <T k="재료비율" /> : <T k="관리운영비율" />;
}

export function FinanceBenchmarkCard({ compact = false }: { compact?: boolean }) {
  const tAttr = useTAttr();
  const q = useQuery({
    queryKey: ['fb-overview', null, ''],
    queryFn: () => apiClient.get<{ data: Overview }>('/api/v1/finance-benchmark/overview'),
    staleTime: 10 * 60_000,
  });
  const o = q.data?.data;
  const self = o?.self;
  // 동급보다 나쁜 비용 중 편차가 가장 큰 것
  const worstCost = self?.status === 'FOUND' && self.deviations
    ? COST_RATIOS.map((k) => ({ k, ...self.deviations![k] })).filter((d) => d.worse && d.diff != null).sort((a, b) => (b.diff ?? 0) - (a.diff ?? 0))[0]
    : undefined;

  return (
    <div className={`rounded-2xl border bg-white shadow-sm ${compact ? 'p-3' : 'p-4'}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-gray-800"><T k="경영성과 벤치마크" /></p>
        <Link href="/executive/finance-benchmark" className="text-[11px] text-indigo-600 hover:underline"><T k="자세히" /></Link>
      </div>
      {q.isError ? <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} size="compact" />
        : q.isLoading ? <div className="h-16 animate-pulse rounded-lg bg-gray-100" />
        : !o?.available ? <p className="text-[12px] text-gray-500"><T k="가져온 공시 손익이 없습니다(관리자 가져오기 필요)" /></p>
        : (
          <div className="space-y-2">
            <p className="text-[11px] text-gray-500">
              <Tf k="{연도} 회계연도 공시 · {종별} 동급 {n}곳 · 기준 = 중앙값" params={{ 연도: o.year ?? '-', 종별: o.type ?? tAttr('전체 종별'), n: o.peerCount ?? 0 }} />
            </p>
            {self?.status === 'FOUND' && self.ratios ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-slate-50 p-2">
                  <p className="text-[11px] text-gray-500"><T k="의료이익률" /></p>
                  <p className={`text-lg font-bold ${(self.ratios.medicalProfitMargin ?? 0) >= 0 ? 'text-teal-700' : 'text-rose-600'}`}>
                    {self.ratios.medicalProfitMargin == null ? <Ratio numerator={null} denominator={null} pctOnly /> : <Num value={pct(self.ratios.medicalProfitMargin)} domain="percent" />}
                  </p>
                  <p className="text-[10px] text-gray-500"><T k="동급 중앙값" /> {o.peer?.medicalProfitMargin.median == null ? '-' : <Num value={pct(o.peer.medicalProfitMargin.median)} domain="percent" />}</p>
                </div>
                <div className="rounded-xl bg-slate-50 p-2">
                  <p className="text-[11px] text-gray-500"><T k="동급보다 높은 비용" /></p>
                  {worstCost ? (<>
                    <p className="text-lg font-bold text-rose-600">+<Num value={pct(worstCost.diff)} domain="percentPoint" /></p>
                    <p className="text-[10px] text-gray-500"><CostLabel r={worstCost.k} /></p>
                  </>) : <p className="mt-1 text-[12px] text-emerald-700"><T k="동급보다 높은 비용 항목 없음" /></p>}
                </div>
              </div>
            ) : (
              <div className="space-y-1">
                <p className="text-[12px] text-amber-700">
                  {self?.status === 'NOT_FOUND'
                    ? <Tf k="우리 병원「{이름}」이 공시에 없어 비교하지 않습니다" params={{ 이름: self.name ?? '' }} />
                    : <T k="우리 병원 미지정 — 동급 분포만 보입니다" />}
                </p>
                <p className="text-[12px] text-gray-700">
                  <T k="동급 의료이익률 중앙값" /> {o.peer?.medicalProfitMargin.median == null ? '-' : <Num value={pct(o.peer.medicalProfitMargin.median)} domain="percent" />}
                  {' · '}<T k="평균" /> {o.peer?.medicalProfitMargin.mean == null ? '-' : <Num value={pct(o.peer.medicalProfitMargin.mean)} domain="percent" />}
                </p>
              </div>
            )}
          </div>
        )}
    </div>
  );
}
