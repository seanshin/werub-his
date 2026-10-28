'use client';

import { useState } from 'react';
import { Unit } from '@/components/ui/display';
import { useQuery } from '@tanstack/react-query';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { apiClient } from '@/lib/api-client';
import { kdate } from '@/lib/ui-settings';
import { T } from '@/components/ui/i18n-text';

const MODALITY_LABEL: Record<string, string> = { HD: '혈액투석', PD: '복막투석', CRRT: 'CRRT', HDF: '혈액투석여과', SLED: 'SLED' };
const MODALITY_COLOR: Record<string, string> = {
  HD: 'bg-blue-100 text-blue-700', PD: 'bg-emerald-100 text-emerald-700',
  CRRT: 'bg-red-100 text-red-700', HDF: 'bg-violet-100 text-violet-700',
  SLED: 'bg-amber-100 text-amber-700',
};
const SESSION_STATUS_LABEL: Record<string, string> = { SCHEDULED: '예정', IN_PROGRESS: '진행 중', COMPLETED: '완료', CANCELLED: '취소', MISSED: '미시행' };
const SESSION_STATUS_COLOR: Record<string, string> = {
  SCHEDULED: 'bg-yellow-100 text-yellow-700', IN_PROGRESS: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700', CANCELLED: 'bg-gray-100 text-gray-500',
  MISSED: 'bg-red-100 text-red-700',
};

type DialysisSubTab = 'orders' | 'sessions';

interface DialysisTabProps {
  patientId: string;
}

export function DialysisTab({ patientId }: DialysisTabProps) {
  const [tab, setTab] = useState<DialysisSubTab>('orders');

  const { data: ordersData, isLoading: ordersLoading, isError, error, refetch } = useQuery({
    queryKey: ['dialysis-orders', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/dialysis/orders`, { patientId }),
    enabled: !!patientId,
  });

  const { data: sessionsData, isLoading: sessionsLoading, isError: sessionsIsError, error: sessionsError, refetch: refetchSessions } = useQuery({
    queryKey: ['dialysis-sessions', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>(`/api/v1/dialysis/sessions`, { patientId }),
    enabled: tab === 'sessions' && !!patientId,
  });

  const { data: historyData, isError: historyIsError, error: historyError, refetch: refetchHistory } = useQuery({
    queryKey: ['dialysis-history', patientId],
    queryFn: () => apiClient.get<{ data: Record<string, unknown> }>(`/api/v1/dialysis/patients/${patientId}/history`),
    enabled: !!patientId,
  });

  const orders: Record<string, unknown>[] = (() => { const r = ordersData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const sessions: Record<string, unknown>[] = (() => { const r = sessionsData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();

  const historyRaw = historyData?.data;
  const history = (typeof historyRaw === 'object' && historyRaw !== null)
    ? (historyRaw as Record<string, unknown>).data ?? historyRaw
    : null;
  // getPatientHistory 는 scheduledDate desc 정렬된 세션 배열을 반환 → 최신 비-null Kt/V 추출
  const historyArr: Record<string, unknown>[] = Array.isArray(history) ? (history as Record<string, unknown>[]) : [];
  const lastKtV = historyArr.find((s) => s.ktV != null)?.ktV
    ?? (history && !Array.isArray(history) ? ((history as Record<string, unknown>).lastKtV ?? (history as Record<string, unknown>).latestKtV) : null);

  const LoadingRows = ({ cols }: { cols: number }) => (
    <>{Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={cols} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)}</>
  );

  const ktVColor = (v: number) => v >= 1.2 ? 'text-emerald-600' : v >= 1.0 ? 'text-yellow-600' : 'text-red-600';

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} size="compact" />;
  return (
    <div>
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <p className="text-[10px] text-gray-500 mb-1"><T k="활성 처방" /></p>
          <p className="text-xl font-bold text-gray-900">{orders.filter(o => o.isActive === true).length}</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <p className="text-[10px] text-gray-500 mb-1"><T k="최근 Kt/V" /></p>
          {/* 🔴 측정하지 않은 것을 '-' 로만 두면 "값이 낮다"와 구분되지 않는다 — 미측정이라고 말한다.
              (2026-08-18: 근사식으로 채우던 것을 걷어내고 실측만 원장에 남긴다) */}
          {/* 🔴 조회 실패는 '미측정'이 아니다 — 잰 적이 없는 것과 못 읽은 것을 구분한다 */}
          {historyIsError ? (
            <QueryErrorFallback error={historyError} onRetry={refetchHistory} size="compact" />
          ) : (
            <>
              <p className={`text-xl font-bold ${lastKtV != null ? ktVColor(Number(lastKtV)) : 'text-gray-400'}`}>
                {lastKtV != null ? Number(lastKtV).toFixed(2) : <span className="text-sm font-medium"><T k="미측정" /></span>}
              </p>
              {lastKtV != null && <p className="text-[10px] text-gray-400 mt-0.5">{Number(lastKtV) >= 1.2 ? '적정' : Number(lastKtV) >= 1.0 ? '경계' : '부족'}</p>}
            </>
          )}
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <p className="text-[10px] text-gray-500 mb-1"><T k="투석 방식" /></p>
          <p className="text-sm font-bold text-gray-900">
            {orders.length > 0 ? (MODALITY_LABEL[(orders[0].modality ?? orders[0].dialysisType) as string] ?? (orders[0].modality as string) ?? '-') : '-'}
          </p>
        </div>
      </div>

      <div className="flex gap-1 mb-5 bg-gray-100/80 p-1 rounded-xl w-fit">
        {([
          { key: 'orders' as DialysisSubTab, label: '투석 처방' },
          { key: 'sessions' as DialysisSubTab, label: '세션 이력' },
        ]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>{t.label}</button>
        ))}
      </div>

      {/* 투석 처방 */}
      {tab === 'orders' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="방식" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="빈도" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="시간(분)" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="혈류량" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="투석액" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="건체중" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="상태" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="처방의" /></th>
            </tr></thead>
            <tbody>
              {ordersLoading ? <LoadingRows cols={8} />
              : orders.length === 0 ? <tr><td colSpan={8} className="py-12 text-center text-gray-400"><T k="투석 처방 없음" /></td></tr>
              : orders.map((o) => {
                const modality = (o.modality ?? o.dialysisType) as string ?? '';
                const doc = o.prescriber as Record<string, unknown> | undefined;
                return (
                  <tr key={o.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${MODALITY_COLOR[modality] ?? 'bg-gray-100 text-gray-600'}`}>{(MODALITY_LABEL[modality] ?? modality) || '-'}</span></td>
                    <td className="px-4 py-3 text-xs text-gray-700">{(o.frequency as string) ?? '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-900 font-medium">{(o.durationMinutes ?? o.duration) != null ? `${o.durationMinutes ?? o.duration}` : '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-700">{o.bloodFlowRate != null ? `${o.bloodFlowRate} mL/min` : '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-700">{(o.dialysateFlow ?? o.dialysateFlowRate) != null ? `${o.dialysateFlow ?? o.dialysateFlowRate} mL/min` : (o.dialysate as string) ?? '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-700">{o.dryWeight != null ? `${o.dryWeight} kg` : '-'}</td>
                    <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${o.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{o.isActive ? '활성' : '종료'}</span></td>
                    <td className="px-4 py-3 text-xs text-gray-700">{doc ? `${(doc.familyName as string) ?? ''}${(doc.givenName as string) ?? ''}` : '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 세션 이력 */}
      {tab === 'sessions' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="날짜" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="방식" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="시간(분)" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">UF(mL)</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Kt/V</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="상태" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="합병증" /></th>
            </tr></thead>
            <tbody>
              {sessionsIsError ? <tr><td colSpan={7} className="px-4 py-3"><QueryErrorFallback error={sessionsError} onRetry={refetchSessions} size="compact" /></td></tr>
              : sessionsLoading ? <LoadingRows cols={7} />
              : sessions.length === 0 ? <tr><td colSpan={7} className="py-12 text-center text-gray-400"><T k="세션 기록 없음" /></td></tr>
              : sessions.map((s) => {
                const status = (s.status as string) ?? '';
                const ktv = s.ktV ?? s.spKtV;
                const complications = s.complications as Record<string, unknown>[] | undefined;
                return (
                  <tr key={s.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3 text-xs text-gray-700">{(s.scheduledDate ?? s.startedAt ?? s.createdAt) ? kdate(((s.scheduledDate ?? s.startedAt ?? s.createdAt) as string)) : '-'}</td>
                    <td className="px-4 py-3"><span className={`text-[10px] font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${MODALITY_COLOR[(s.modality ?? s.dialysisType) as string] ?? 'bg-gray-100 text-gray-600'}`}>{MODALITY_LABEL[(s.modality ?? s.dialysisType) as string] ?? (s.modality as string) ?? '-'}</span></td>
                    <td className="px-4 py-3 text-xs text-gray-900">{(s.actualDuration ?? s.durationMinutes) != null ? `${s.actualDuration ?? s.durationMinutes}` : '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-700">{(s.actualUf ?? s.totalUF ?? s.ufVolume) != null ? `${s.actualUf ?? s.totalUF ?? s.ufVolume}` : '-'}</td>
                    <td className="px-4 py-3 text-xs font-bold">
                      {ktv != null ? <span className={ktVColor(Number(ktv))}>{Number(ktv).toFixed(2)}</span> : <span className="text-gray-400">-</span>}
                    </td>
                    <td className="px-4 py-3"><span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${SESSION_STATUS_COLOR[status] ?? 'bg-gray-100'}`}>{(SESSION_STATUS_LABEL[status] ?? status) || '-'}</span></td>
                    <td className="px-4 py-3 text-xs text-gray-700">
                      {Array.isArray(complications) && complications.length > 0
                        ? <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600 whitespace-nowrap">{complications.length}<Unit>건</Unit></span>
                        : '-'
                      }
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
