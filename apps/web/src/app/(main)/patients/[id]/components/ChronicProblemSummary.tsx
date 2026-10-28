'use client';

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T } from '@/components/ui/i18n-text';

type Indicator = { code: string; label: string; unit: string; target: number; comparator: 'lt' | 'lte' | 'gte'; latest: number | null; measuredAt: string | null; delta: number | null; met: boolean | null };
type Problem = { condition: string; label: string; diagnosis: { code: string; name: string }; indicators: Indicator[]; hasData: boolean; controlled: boolean };
type Resp = { problems: Problem[] };

const COND_TONE: Record<string, string> = { DM: 'border-amber-200', HTN: 'border-sky-200', DYSLIPID: 'border-violet-200', CKD: 'border-rose-200' };
const cmpText = (c: string) => (c === 'gte' ? '≥' : c === 'lte' ? '≤' : '<');

/** 문제중심 요약 — 활성 만성 진단별 지표·목표·달성(서버 가이드라인). 추이패널 위에 표시(현 차트 유지). */
export function ChronicProblemSummary({ patientId }: { patientId: string }) {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['chronic-problems', patientId],
    queryFn: () => apiClient.get<{ data: Resp }>(`/api/v1/patients/${patientId}/chronic-observations/problems`),
    enabled: !!patientId,
  });
  const problems = data?.data?.problems ?? [];

  /**
   * 🔴 종전: `if (isLoading || !problems.length) return null;`
   *    조회가 **실패해도** `problems.length === 0` 이라 카드가 흔적 없이 사라졌고,
   *    임상의는 그것을 "이 환자는 만성질환이 없다"로 읽었다 — `.catch(()=>[])` 와 같은 번역이다.
   *    이 컴포넌트는 지표 단위로는 이미 `측정 없음` 3상태를 쓰고 있었다. 카드 단위만 빠져 있었다.
   */
  if (isError) {
    return (
      <div className="space-y-2">
        <h3 className="text-lg font-semibold text-gray-900"><T k="문제중심 관리" /></h3>
        <QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" />
      </div>
    );
  }
  // 아직 안 온 것과 없는 것은 다른 사실이지만, 로딩 중 자리를 잡아둘 필요는 없다(요약 카드다)
  if (isLoading || !problems.length) return null; // 만성 진단이 **없다**(조회는 성공했다)

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold text-gray-900"><T k="문제중심 관리" /> <span className="text-xs font-normal text-gray-400"><T k="(진단별 목표·달성)" /></span></h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {problems.map((p) => (
          <div key={p.condition} className={`bg-white rounded-2xl border ${COND_TONE[p.condition] ?? 'border-gray-200'} shadow-sm p-4`}>
            <div className="flex items-center justify-between mb-2">
              <div>
                <span className="text-sm font-bold text-gray-800">{p.label}</span>
                <span className="text-[11px] text-gray-400 ml-1.5 font-mono">{p.diagnosis.code}</span>
              </div>
              {p.hasData
                ? <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${p.controlled ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>{p.controlled ? '조절 양호' : '조절 불량'}</span>
                : <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-400"><T k="측정 없음" /></span>}
            </div>
            <div className="space-y-1.5">
              {p.indicators.map((ind) => {
                const up = (ind.delta ?? 0) > 0, down = (ind.delta ?? 0) < 0;
                return (
                  <div key={ind.code} className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">{ind.label} <span className="text-[10px] text-gray-400">목표 {cmpText(ind.comparator)}{ind.target}{ind.unit}</span></span>
                    <span className="flex items-center gap-1.5">
                      {ind.latest != null ? (
                        <>
                          <span className={`font-semibold ${ind.met === false ? 'text-rose-600' : 'text-gray-800'}`}>{ind.latest}<span className="text-[10px] text-gray-400 ml-0.5">{ind.unit}</span></span>
                          {ind.delta != null && ind.delta !== 0 && <span className={`text-[10px] ${down ? 'text-emerald-600' : up ? 'text-rose-500' : 'text-gray-400'}`}>{up ? '▲' : '▼'}{Math.abs(ind.delta)}</span>}
                          {ind.met === true && <span className="text-emerald-500 text-[11px]">✓</span>}
                        </>
                      ) : <span className="text-gray-300">-</span>}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
