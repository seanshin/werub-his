'use client';

import { useQuery } from '@tanstack/react-query';
import { Unit } from '@/components/ui/display';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import Link from 'next/link';
import { T } from '@/components/ui/i18n-text';

const CELL: Record<string, { bg: string; text: string; label: string }> = {
  COMPLETED: { bg: 'bg-emerald-500', text: 'text-white', label: '완료' },
  IN_PROGRESS: { bg: 'bg-amber-400', text: 'text-amber-900', label: '진행' },
  ARRIVED: { bg: 'bg-blue-400', text: 'text-white', label: '대기' },
  WAITING: { bg: 'bg-gray-100', text: 'text-gray-300', label: '' },
};

const FINDING_DOT: Record<string, string> = {
  NORMAL: 'bg-emerald-300', ABNORMAL: 'bg-amber-300', CRITICAL: 'bg-red-400',
};

export default function FlowBoardPage() {
  const { data: flowRes, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['ck-flow-board'],
    queryFn: () => apiClient.get<any>('/api/v1/checkup/ws/flow-board'),
    refetchInterval: 5000,
  });
  const stations = flowRes?.data?.stations ?? [];
  const matrix = flowRes?.data?.matrix ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900"><T k="동선 현황판" /></h1>
          <p className="text-xs text-gray-400">{matrix.length}<Unit>명</Unit> <T k="수검자" /> × {stations.length} 스테이션 · 5초 갱신</p>
        </div>
        <div className="flex items-center gap-3">
          {Object.entries(CELL).filter(([k]) => k !== 'WAITING').map(([k, v]) => (
            <span key={k} className="flex items-center gap-1 text-[10px] text-gray-500">
              <span className={`w-3 h-3 rounded-sm ${v.bg}`} /> <T k={v.label} />
            </span>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-gray-400 animate-pulse text-sm"><T k="로딩 중..." /></div>
      ) : isError ? <QueryErrorFallback error={error} onRetry={refetch} /> : matrix.length === 0 ? (
        <div className="py-16 text-center text-gray-400">
          <div className="text-3xl mb-2">📋</div>
          <p className="text-sm"><T k="오늘 접수된 수검자가 없습니다" /></p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border shadow-sm overflow-x-auto">
          <table className="w-full text-xs border-collapse min-w-[800px]">
            <thead>
              <tr className="bg-gray-50">
                <th className="sticky left-0 z-10 bg-gray-50 px-3 py-2.5 text-left font-semibold text-gray-700 border-b min-w-[140px]"><T k="수검자" /></th>
                {stations.filter((s: any) => s.stationId !== 'ck-reception').map((s: any) => (
                  <th key={s.stationId} className="px-1 py-2.5 text-center font-medium text-gray-600 border-b min-w-[52px]">
                    <div className="text-base mb-0.5">{s.icon}</div>
                    <div className="text-[9px] leading-tight whitespace-nowrap">{s.name.replace('검사실', '').replace('실', '')}</div>
                  </th>
                ))}
                <th className="px-3 py-2.5 text-center font-medium text-gray-600 border-b"><T k="진행" /></th>
              </tr>
            </thead>
            <tbody>
              {matrix.map((row: any) => {
                const done = row.stations.filter((s: any) => s.status === 'COMPLETED').length;
                const total = row.stations.filter((s: any) => s.stationId !== 'ck-reception').length;
                const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                return (
                  <tr key={row.visitId} className="hover:bg-blue-50/30 transition-colors">
                    <td className="sticky left-0 z-10 bg-white px-3 py-2 border-b">
                      <Link href={`/his-checkup/visit/${row.visitId}`} className="hover:text-blue-600 transition-colors">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded bg-gradient-to-br from-blue-100 to-indigo-100 flex items-center justify-center text-[9px] font-bold text-blue-700">
                            {row.patient?.familyName}
                          </div>
                          <div>
                            <div className="font-semibold text-gray-900 text-[11px]">{row.patient?.familyName}{row.patient?.givenName}</div>
                            <div className="text-[9px] text-gray-400">{row.program?.name}</div>
                          </div>
                        </div>
                      </Link>
                    </td>
                    {row.stations.filter((s: any) => s.stationId !== 'ck-reception').map((cell: any) => {
                      const st = CELL[cell.status] ?? CELL.WAITING;
                      return (
                        <td key={cell.stationId} className="px-1 py-2 text-center border-b">
                          <div className={`inline-flex items-center justify-center w-7 h-7 rounded-lg text-[9px] font-bold ${st.bg} ${st.text}`}>
                            {cell.status === 'COMPLETED' && cell.finding && FINDING_DOT[cell.finding]
                              ? <span className={`w-2.5 h-2.5 rounded-full ${FINDING_DOT[cell.finding]}`} />
                              : cell.status === 'WAITING' ? '' : st.label.charAt(0)}
                          </div>
                        </td>
                      );
                    })}
                    <td className="px-3 py-2 text-center border-b">
                      <div className="flex items-center gap-1.5 justify-center">
                        <div className="w-10 h-1 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${pct === 100 ? 'bg-emerald-500' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[9px] text-gray-500 tabular-nums">{done}/{total}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
