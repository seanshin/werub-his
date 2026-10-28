'use client';

import { useQuery } from '@tanstack/react-query';
import { Unit } from '@/components/ui/display';
import { apiClient } from '@/lib/api-client';
import { pollMs } from '@/lib/ui-settings';
import { T, Tf, Data } from '@/components/ui/i18n-text';

const REPORT_STATUS: Record<string, { label: string; bg: string; text: string }> = {
  DRAFT: { label: '초안', bg: 'bg-gray-100', text: 'text-gray-600' },
  PRELIMINARY: { label: '예비판독', bg: 'bg-amber-50', text: 'text-amber-700' },
  FINAL: { label: '최종판독', bg: 'bg-emerald-50', text: 'text-emerald-700' },
};

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  const colorMap: Record<string, { bg: string; text: string; accent: string }> = {
    blue: { bg: 'bg-blue-50', text: 'text-blue-700', accent: 'text-blue-900' },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700', accent: 'text-emerald-900' },
    amber: { bg: 'bg-amber-50', text: 'text-amber-700', accent: 'text-amber-900' },
    violet: { bg: 'bg-violet-50', text: 'text-violet-700', accent: 'text-violet-900' },
  };
  const c = colorMap[color] ?? colorMap.blue;
  return (
    <div className={`${c.bg} rounded-2xl p-4`}>
      <span className={`text-xs font-medium ${c.text}`}><T k={label} /></span>
      <p className={`text-2xl font-bold ${c.accent} mt-1`}>{value}</p>
    </div>
  );
}

interface PacsDashboardStats {
  total_studies?: number;
  total?: number;
  completed?: number;
  completed_studies?: number;
  pending?: number;
  pending_reading?: number;
  scheduled?: number;
  pending_acquisition?: number;
  by_modality?: Record<string, number>;
}

interface ReadingQueueItem {
  id?: string;
  modality?: string;
  patient_name?: string;
  patient_id?: string;
  study_description?: string;
  study_date?: string;
  status?: string;
  priority?: string;
}

interface ReadingQueueData {
  results?: ReadingQueueItem[];
  count?: number;
}

export function StatsTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['pacs-dashboard-today'],
    queryFn: () => apiClient.get<{ data: PacsDashboardStats }>('/api/v1/pacs/dashboard/today'),
    refetchInterval: pollMs('normal'),
  });

  const { data: queueData, isLoading: queueLoading, isError: queueError } = useQuery({
    queryKey: ['pacs-reading-queue'],
    queryFn: () => apiClient.get<{ data: ReadingQueueData }>('/api/v1/pacs/dashboard/reading-queue'),
    refetchInterval: pollMs('fast'),
  });

  const stats = data?.data ?? {};
  const queueItems = queueData?.data?.results ?? [];
  const queueCount = queueData?.data?.count ?? 0;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-bold text-gray-700 mb-3"><T k="오늘 현황" /></h3>
        {isLoading ? (
          <div className="grid grid-cols-4 gap-4">{[...Array(4)].map((_, i) => (<div key={i} className="h-24 bg-gray-100 rounded-2xl animate-pulse" />))}</div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {/* 서버가 주는 사실만 — 종전 '촬영 대기' 카드는 존재하지 않는 키(scheduled)라 항상 0 이었다(P11).
                촬영 대기는 HIS 오더 기준이라 '촬영 대기' 탭이 정본이다. */}
            <StatCard label="전체 검사" value={stats.total_studies ?? stats.total ?? 0} color="blue" />
            <StatCard label="완료" value={stats.completed ?? stats.completed_studies ?? 0} color="emerald" />
            <StatCard label="판독 대기" value={stats.pending ?? stats.pending_reading ?? 0} color="amber" />
          </div>
        )}
      </div>

      {stats.by_modality && (
        <div>
          <h3 className="text-sm font-bold text-gray-700 mb-3"><T k="Modality별 현황" /></h3>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
            <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
              {Object.entries(stats.by_modality).map(([mod, count]) => (
                <div key={mod} className="text-center p-3 bg-gray-50 rounded-xl">
                  <span className="block text-xs font-bold text-gray-500">{mod}</span>
                  <span className="block text-lg font-bold text-gray-900 mt-1">{count as number}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div>
        <h3 className="text-sm font-bold text-gray-700 mb-3"><Tf k="판독 대기열 ({건수})" params={{ 건수: <>{queueCount}<Unit>건</Unit></> }} /></h3>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          {queueLoading ? (
            <div className="p-5 space-y-3">{[...Array(3)].map((_, i) => (<div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />))}</div>
          ) : !Array.isArray(queueItems) || queueItems.length === 0 ? (
            queueError ? (
              <div className="p-8 text-center">
                <p className="text-sm text-red-600"><T k="판독 대기 목록을 불러오지 못했습니다." /></p>
                <p className="text-xs text-gray-400 mt-1"><T k="대기가 없는 것이 아니라 조회에 실패했습니다." /></p>
              </div>
            ) : <div className="p-8 text-center"><p className="text-sm text-gray-400"><T k="판독 대기 중인 검사가 없습니다." /></p></div>
          ) : (
            <div className="divide-y divide-gray-50">
              {queueItems.map((item: ReadingQueueItem, idx: number) => {
                // 미등록 상태를 '초안'으로 단정하지 않는다(P4) — 모르는 값은 원문으로
                const known = item.status ? REPORT_STATUS[item.status] : undefined;
                const st = known
                  ? { ...known, known: true }
                  : { label: item.status ?? '미상', bg: 'bg-gray-100', text: 'text-gray-600', known: !item.status };
                return (
                  <div key={item.id ?? idx} className="p-4 flex items-center justify-between hover:bg-blue-50/30 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center">
                        <span className="text-xs font-bold text-violet-600">{(item.modality ?? 'IM').toString().slice(0, 2)}</span>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{item.patient_name ?? item.patient_id ?? '-'}</p>
                        <p className="text-xs text-gray-500">{item.study_description ?? '-'}{item.study_date && ` | ${item.study_date}`}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {/* 🔴 미등록 상태는 서버 원문(데이터)이 그대로 온다 — 카탈로그 키가 아니다 */}
                      <span className={`text-[11px] font-medium px-2 py-1 rounded-full ${st.bg} ${st.text}`}>{st.known ? <T k={st.label} /> : <Data>{st.label}</Data>}</span>
                      {item.priority && item.priority !== 'ROUTINE' && (
                        <span className="text-[11px] font-medium px-2 py-1 rounded-full bg-red-50 text-red-700">{item.priority === 'STAT' ? <T k="응급" /> : item.priority === 'URGENT' ? <T k="긴급" /> : <Data>{item.priority}</Data>}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
