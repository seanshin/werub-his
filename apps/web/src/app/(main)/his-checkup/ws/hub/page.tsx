'use client';

import { useQuery } from '@tanstack/react-query';
import { Unit, Duration } from '@/components/ui/display';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import Link from 'next/link';
import { T } from '@/components/ui/i18n-text';

const ROUTES: Record<string, string> = {
  'ck-reception': '/his-checkup/reception',
  'ck-physical': '/his-checkup/ws/physical', 'ck-blood': '/his-checkup/ws/blood',
  'ck-urine': '/his-checkup/ws/urine', 'ck-xray': '/his-checkup/ws/xray',
  'ck-ultrasound': '/his-checkup/ws/ultrasound', 'ck-ecg': '/his-checkup/ws/ecg',
  'ck-pft': '/his-checkup/ws/pft', 'ck-endoscopy': '/his-checkup/ws/endoscopy',
  'ck-eye': '/his-checkup/ws/eye', 'ck-consult': '/his-checkup/ws/consult',
};

const GRADIENT: Record<string, string> = {
  LAB: 'from-red-500 to-rose-600', IMAGING: 'from-blue-500 to-indigo-600',
  DIAGNOSTIC: 'from-violet-500 to-purple-600', PHYSICAL: 'from-emerald-500 to-teal-600',
  CONSULT: 'from-gray-600 to-gray-700', RECEPTION: 'from-sky-500 to-blue-600',
};

export default function StationHubPage() {
  const { data: flowRes, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['ck-flow-board'],
    queryFn: () => apiClient.get<any>('/api/v1/checkup/ws/flow-board'),
    refetchInterval: 8000,
  });
  const stations = flowRes?.data?.stations ?? [];
  const totalVisitors = flowRes?.data?.totalVisitors ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900"><T k="검사실 허브" /></h1>
          <p className="text-xs text-gray-400"><T k="오늘" /> <T k="수검자" /> {totalVisitors}<Unit>명</Unit> · 스테이션 {stations.length}<Unit>개</Unit> · <T k="8초 자동 갱신" /></p>
        </div>
        <Link href="/his-checkup/flow-board" className="px-4 py-2 bg-gray-900 text-white rounded-lg text-xs font-semibold hover:bg-gray-800 transition">
          <T k="동선 현황판" />
        </Link>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-3 gap-3">
          {[1,2,3,4,5,6].map(i => <div key={i} className="h-36 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : isError ? <QueryErrorFallback error={error} onRetry={refetch} /> : (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {stations.map((s: any) => {
            const route = ROUTES[s.stationId] ?? `/his-checkup/ws/${s.stationId.replace('ck-', '')}`;
            const total = s.waiting + s.inProgress + s.completed;
            const grad = GRADIENT[s.category] ?? GRADIENT.DIAGNOSTIC;
            const hasActive = s.waiting > 0 || s.inProgress > 0;
            return (
              <Link key={s.stationId} href={route}
                className="relative overflow-hidden rounded-xl border hover:shadow-lg transition-all group">
                {/* 상단 컬러 헤더 */}
                <div className={`bg-gradient-to-r ${grad} px-4 py-3 text-white`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{s.icon ?? '🏥'}</span>
                      <span className="font-bold text-sm">{s.name}</span>
                    </div>
                    <span className="text-white/60 group-hover:text-white transition text-xs">→</span>
                  </div>
                </div>
                {/* 하단 숫자 */}
                <div className="bg-white px-4 py-3">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <div className={`text-xl font-black tabular-nums ${s.waiting > 0 ? 'text-amber-600' : 'text-gray-300'}`}>{s.waiting}</div>
                      <div className="text-[9px] text-gray-400"><T k="대기" /></div>
                    </div>
                    <div>
                      <div className={`text-xl font-black tabular-nums ${s.inProgress > 0 ? 'text-blue-600' : 'text-gray-300'}`}>{s.inProgress}</div>
                      <div className="text-[9px] text-gray-400"><T k="진행" /></div>
                    </div>
                    <div>
                      <div className={`text-xl font-black tabular-nums ${s.completed > 0 ? 'text-emerald-600' : 'text-gray-300'}`}>{s.completed}</div>
                      <div className="text-[9px] text-gray-400"><T k="완료" /></div>
                    </div>
                  </div>
                  {s.estimatedWait > 0 && (
                    <div className="mt-2 text-center text-[10px] text-amber-600 font-medium">
                      <T k="예상 대기 약" /> <Duration minutes={s.estimatedWait} />
                    </div>
                  )}
                  {/* 활성 표시 */}
                  {hasActive && (
                    <div className="absolute top-2 right-2">
                      <span className="flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
                      </span>
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
