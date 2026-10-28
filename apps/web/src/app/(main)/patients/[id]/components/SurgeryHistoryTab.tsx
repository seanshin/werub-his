'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { apiClient } from '@/lib/api-client';
import { safeFormat as format } from '@/lib/safe-date';

import { EmptyState } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface SurgerySchedule {
  id: string;
  patientId: string;
  procedureName: string;
  scheduledDate: string;
  startTime?: string;
  endTime?: string;
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  surgeon?: { familyName?: string; givenName?: string };
  surgeonName?: string;
  anesthesiaType?: string;
  operatingRoom?: string;
  duration?: number;
  complications?: string;
  opNote?: string;
  notes?: string;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  SCHEDULED: { bg: 'bg-blue-100', text: 'text-blue-700', label: '예정' },
  IN_PROGRESS: { bg: 'bg-indigo-100', text: 'text-indigo-700', label: '진행중' },
  COMPLETED: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: '완료' },
  CANCELLED: { bg: 'bg-red-100', text: 'text-red-700', label: '취소' },
};

export function SurgeryHistoryTab({ patientId }: { patientId: string }) {
  const tAttr = useTAttr();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['patient-surgeries', patientId],
    queryFn: () => apiClient.get<{ data: SurgerySchedule[] }>(`/api/v1/surgery/schedule`, { patientId }),
    enabled: !!patientId,
  });

  const _raw = data?.data;
  const allSurgeries: SurgerySchedule[] = useMemo(() => {
    const list: SurgerySchedule[] = Array.isArray(_raw) ? _raw : (_raw as Record<string, unknown> | undefined)?.data as SurgerySchedule[] ?? [];
    return list.filter(s => s.patientId === patientId);
  }, [_raw, patientId]);

  const upcoming = useMemo(() =>
    allSurgeries.filter(s => s.status === 'SCHEDULED' || s.status === 'IN_PROGRESS')
      .sort((a, b) => new Date(a.scheduledDate).getTime() - new Date(b.scheduledDate).getTime()),
    [allSurgeries]
  );

  const past = useMemo(() =>
    allSurgeries.filter(s => s.status === 'COMPLETED' || s.status === 'CANCELLED')
      .sort((a, b) => new Date(b.scheduledDate).getTime() - new Date(a.scheduledDate).getTime()),
    [allSurgeries]
  );

  const stats = useMemo(() => ({
    total: allSurgeries.length,
    scheduled: allSurgeries.filter(s => s.status === 'SCHEDULED' || s.status === 'IN_PROGRESS').length,
    completed: allSurgeries.filter(s => s.status === 'COMPLETED').length,
  }), [allSurgeries]);

  const getSurgeonName = (s: SurgerySchedule) =>
    s.surgeonName ?? (s.surgeon ? `${s.surgeon.familyName ?? ''}${s.surgeon.givenName ?? ''}` : '-');

  const getStatusStyle = (status: string) => STATUS_STYLES[status] ?? STATUS_STYLES.SCHEDULED;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-6"><T k="수술 이력 (Surgery History)" /></h3>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : isError ? (
        /* 🔴 조회 실패를 "없습니다"로 그리지 않는다 — import 만 있고 렌더가 없던 자리(2026-09-02) */
        <QueryErrorFallback error={error} onRetry={() => refetch()} />
      ) : allSurgeries.length === 0 ? (
        <EmptyState icon="🏥" title="수술 기록이 없습니다" />
      ) : (
        <div className="space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-gray-50 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
              <p className="text-xs text-gray-500 mt-1"><T k="총 수술" /></p>
            </div>
            <div className="bg-blue-50 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-blue-600">{stats.scheduled}</p>
              <p className="text-xs text-gray-500 mt-1"><T k="예정" /></p>
            </div>
            <div className="bg-emerald-50 rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-emerald-600">{stats.completed}</p>
              <p className="text-xs text-gray-500 mt-1"><T k="완료" /></p>
            </div>
          </div>

          {/* Upcoming Surgeries */}
          {upcoming.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-3"><T k="예정된 수술" /></h4>
              <div className="grid gap-3">
                {upcoming.map((s) => {
                  const st = getStatusStyle(s.status);
                  return (
                    <div key={s.id} className="border border-blue-100 bg-blue-50/30 rounded-xl p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <h5 className="text-sm font-semibold text-gray-900">{s.procedureName}</h5>
                          <div className="flex flex-wrap items-center gap-2 mt-1">
                            <span className="text-xs text-gray-500">
                              {format(new Date(s.scheduledDate), 'yyyy-MM-dd')}
                              {s.startTime && ` ${s.startTime}`}
                            </span>
                            <span className="text-xs text-gray-400">|</span>
                            <span className="text-xs text-gray-600">{getSurgeonName(s)}</span>
                            {s.operatingRoom && (
                              <>
                                <span className="text-xs text-gray-400">|</span>
                                <span className="text-xs text-gray-600">{s.operatingRoom}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${st.bg} ${st.text}`}>
                          {st.label}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Past Surgeries */}
          {past.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-3"><T k="완료된 수술" /></h4>
              <div className="border border-gray-100 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50">
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap"><T k="수술명" /></th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap"><T k="날짜" /></th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap"><T k="집도의" /></th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap"><T k="마취" /></th>
                        <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap"><T k="소요시간" /></th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap"><T k="합병증" /></th>
                        <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap"><T k="상태" /></th>
                        <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap"><T k="상세" /></th>
                      </tr>
                    </thead>
                    <tbody>
                      {past.map((s) => {
                        const st = getStatusStyle(s.status);
                        const hasOpNote = !!(s.opNote || s.notes);
                        const isExpanded = expandedId === s.id;
                        return (
                          <>
                            <tr key={s.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                              <td className="px-4 py-2 text-gray-900 font-medium">{s.procedureName}</td>
                              <td className="px-4 py-2 text-gray-700 whitespace-nowrap">{format(new Date(s.scheduledDate), 'yyyy-MM-dd')}</td>
                              <td className="px-4 py-2 text-gray-700 whitespace-nowrap">{getSurgeonName(s)}</td>
                              <td className="px-4 py-2 text-gray-600 text-xs">{s.anesthesiaType ?? '-'}</td>
                              <td className="px-4 py-2 text-center text-gray-700">
                                {s.duration != null ? `${s.duration}분` : '-'}
                              </td>
                              <td className={`px-4 py-2 text-xs ${s.complications ? 'text-red-600 font-medium' : 'text-gray-400'}`}>
                                {s.complications ?? '없음'}
                              </td>
                              <td className="px-4 py-2 text-center">
                                <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${st.bg} ${st.text}`}>
                                  {st.label}
                                </span>
                              </td>
                              <td className="px-4 py-2 text-center">
                                {hasOpNote && (
                                  <button
                                    onClick={() => setExpandedId(isExpanded ? null : s.id)}
                                    className="text-blue-600 hover:text-blue-800 text-xs font-medium"
                                  >
                                    {isExpanded ? '접기' : 'Op Note'}
                                  </button>
                                )}
                              </td>
                            </tr>
                            {isExpanded && hasOpNote && (
                              <tr key={`${s.id}-note`}>
                                <td colSpan={8} className="px-4 py-3 bg-gray-50/50">
                                  <div className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">
                                    <span className="text-xs font-semibold text-gray-500 block mb-1"><T k="수술 기록 (Op Note)" /></span>
                                    {s.opNote ?? s.notes}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
