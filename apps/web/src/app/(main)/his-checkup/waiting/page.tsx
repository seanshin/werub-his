'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ageOf } from '@hospital-run/shared';
import { Unit, Duration, genderText } from '@/components/ui/display';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { toast } from '@/stores/toast-store';
import Link from 'next/link';
import { kstToday } from '@/lib/kst-today';
import { T } from '@/components/ui/i18n-text';
import { useCanManageCheckupVisit } from '../checkup-access';

const COLUMNS = [
  { key: 'CHECKED_IN', label: '접수 대기', icon: '🏥', color: 'blue', bg: 'bg-blue-500' },
  { key: 'IN_PROGRESS', label: '검사중', icon: '🔬', color: 'amber', bg: 'bg-amber-500' },
  { key: 'EXAM_COMPLETE', label: '검사완료', icon: '✅', color: 'orange', bg: 'bg-orange-500' },
  { key: 'PARTIAL_COMPLETE', label: '부분완료', icon: '⚠️', color: 'yellow', bg: 'bg-yellow-500' },
  { key: 'REVIEW', label: '소견대기', icon: '📝', color: 'violet', bg: 'bg-violet-500' },
];

const NEXT: Record<string, string> = {
  CHECKED_IN: 'IN_PROGRESS', IN_PROGRESS: 'EXAM_COMPLETE',
  EXAM_COMPLETE: 'REVIEW', PARTIAL_COMPLETE: 'REVIEW',
};

export default function CheckupWaitingPage() {
  // 🔴 상태 전이는 검진 데스크 권한(정본 `checkup-access`) — 의사에게 그려도 서버가 막는다
  const canManage = useCanManageCheckupVisit();
  const queryClient = useQueryClient();
  const today = kstToday();

  const queries = COLUMNS.map((col) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useQuery({
      queryKey: ['checkup-waiting', col.key],
      queryFn: () => apiClient.get<any>('/api/v1/checkup/visits', { date: today, status: col.key }),
      refetchInterval: 8000,
    }),
  );

  const updateStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiClient.patch(`/api/v1/checkup/visits/${id}/status`, { status }),
    onSuccess: () => {
      COLUMNS.forEach((c) => queryClient.invalidateQueries({ queryKey: ['checkup-waiting', c.key] }));
      toast.success('상태 변경');
    },
  });

  const firstError = queries.find(q => q.isError);
  if (firstError?.isError) return <QueryErrorFallback error={firstError.error} onRetry={() => queries.forEach(q => q.refetch())} />;

  const age = (dob: string) => dob ? (ageOf(dob) ?? 0) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900"><T k="검진 대기 현황" /></h1>
          <p className="text-xs text-gray-400">{today} · <T k="칸반 보드 · 8초 자동 갱신" /></p>
        </div>
        <Link href="/display/checkup" target="_blank"
          className="px-3 py-1.5 bg-gray-900 text-white rounded-lg text-xs font-medium hover:bg-gray-800">
          <T k="대기실 디스플레이" />
        </Link>
      </div>

      {/* 상단 카운트 */}
      <div className="grid grid-cols-5 gap-2">
        {COLUMNS.map((col, idx) => {
          const count = queries[idx].data?.data?.length ?? 0;
          return (
            <div key={col.key} className={`p-3 rounded-xl text-white bg-gradient-to-br ${
              col.color === 'blue' ? 'from-blue-500 to-blue-600' :
              col.color === 'amber' ? 'from-amber-500 to-orange-500' :
              col.color === 'orange' ? 'from-orange-500 to-red-400' :
              col.color === 'yellow' ? 'from-yellow-400 to-amber-500' :
              'from-violet-500 to-purple-600'
            }`}>
              <div className="flex items-center justify-between">
                <span className="text-lg">{col.icon}</span>
                <span className="text-3xl font-black tabular-nums">{count}</span>
              </div>
              <div className="text-[10px] font-medium opacity-80 mt-0.5"><T k={col.label} /></div>
            </div>
          );
        })}
      </div>

      {/* 칸반 보드 */}
      <div className="grid grid-cols-5 gap-3">
        {COLUMNS.map((col, idx) => {
          const visits = queries[idx].data?.data ?? [];
          return (
            <div key={col.key} className="space-y-1.5">
              <div className={`h-1 rounded-full ${col.bg}`} />
              {visits.length === 0 && (
                <div className="text-center text-gray-300 text-xs py-8"><T k="없음" /></div>
              )}
              {visits.map((v: any) => {
                const items = (v.program?.items as any[]) ?? [];
                const resultCount = v._count?.items ?? 0;
                const pct = items.length > 0 ? Math.round((resultCount / items.length) * 100) : 0;
                const waitMin = v.checkedInAt ? Math.round((Date.now() - new Date(v.checkedInAt).getTime()) / 60000) : 0;

                return (
                  <div key={v.id} className="bg-white border rounded-xl p-3 space-y-2 shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-100 to-indigo-100 flex items-center justify-center text-[10px] font-bold text-blue-700">
                          {v.patient?.familyName}
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-gray-900">
                            {v.patient?.familyName}{v.patient?.givenName}
                          </div>
                          <div className="text-[9px] text-gray-400">
                            {genderText(v.patient?.gender)}/{age(v.patient?.dateOfBirth)}
                          </div>
                        </div>
                      </div>
                      <span className="text-[10px] text-gray-400 tabular-nums"><Duration minutes={waitMin} /></span>
                    </div>

                    <div className="text-[10px] text-gray-500 truncate">{v.program?.name}</div>

                    {col.key !== 'CHECKED_IN' && (
                      <div className="flex items-center gap-1.5">
                        <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${pct === 100 ? 'bg-emerald-500' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[9px] text-gray-400 tabular-nums">{pct}<Unit>%</Unit></span>
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-1">
                      <Link href={`/his-checkup/visit/${v.id}`} className="text-[10px] text-blue-600 hover:underline"><T k="상세" /></Link>
                      {canManage && NEXT[col.key] && (
                        <button onClick={() => updateStatus.mutate({ id: v.id, status: NEXT[col.key] })}
                          className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-[10px] hover:bg-gray-200 font-medium transition">
                          → {COLUMNS.find(c => c.key === NEXT[col.key])?.label?.replace(' ', '')}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
