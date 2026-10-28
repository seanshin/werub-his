'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';
import { EmptyState, KDate } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf } from '@/components/ui/i18n-text';

/** `GET /api/v1/crm/campaigns/:id/logs` 응답 — 서버 `crm.service.ts getCampaignLogs` */
interface CampaignLogRow {
  id: string; patientId: string; patientName: string | null; channel: string;
  status: string; reason: string | null; sentAt: string | null; deliveredAt: string | null;
}
interface CampaignLogsResponse {
  data: CampaignLogRow[];
  meta: { total: number; page: number; limit: number };
  summary: {
    total: number;
    byStatus: Record<string, number>;
    byReason: { status: string; reason: string | null; count: number }[];
    deliveryTracking: 'RECORDED' | 'NOT_AVAILABLE';
  };
}

/** 발송 기록 상태 — SIMULATED 는 "나가지 않음"이라 SENT 와 같은 색으로 그리지 않는다 */
const STATUS_TONE: Record<string, string> = {
  SENT: 'bg-emerald-100 text-emerald-700',
  SIMULATED: 'bg-amber-100 text-amber-700',
  FAILED: 'bg-red-100 text-red-600',
};
const FILTERS = ['', 'SENT', 'SIMULATED', 'FAILED'] as const;
const LIMIT = 50;

/**
 * 캠페인 발송 기록 — 🔴 (2026-09-14) 종전엔 캠페인 상세가 `logs` 최근 100건을 환자 ID 앞 8자리로만 그렸고
 * SIMULATED(제공자 없음 = 나가지 않음)가 회색 무표시라 발송과 구분되지 않았다. 전체 요약은 서버가 상태별로 갈라 주고,
 * 도달은 기록 경로가 없다는 사실을 그대로 말한다(도달률을 만들지 않는다).
 */
export function CampaignLogsPanel({ campaignId }: { campaignId: string }) {
  const [status, setStatus] = useState<(typeof FILTERS)[number]>('');
  const [page, setPage] = useState(1);
  const [res, setRes] = useState<CampaignLogsResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ page: String(page), limit: String(LIMIT), ...(status ? { status } : {}) });
      setRes(await apiClient.fetch<CampaignLogsResponse>(`/api/v1/crm/campaigns/${campaignId}/logs?${qs}`));
    } catch (e) {
      // 조회 실패를 "기록 없음"으로 그리지 않는다
      setRes(null);
      setError(e);
    }
    setLoading(false);
  }, [campaignId, page, status]);

  useEffect(() => { void load(); }, [load]);

  const pages = res ? Math.max(1, Math.ceil(res.meta.total / LIMIT)) : 1;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-sm font-bold text-gray-700"><T k="발송 기록(환자별)" /></h2>
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <button key={f || 'ALL'} onClick={() => { setStatus(f); setPage(1); }}
              className={`px-2 py-1 text-xs rounded-lg border ${status === f ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200'}`}>
              {f ? f : <T k="전체" />}
            </button>
          ))}
        </div>
      </div>

      {error != null && <QueryErrorFallback size="compact" error={error} onRetry={() => void load()} />}

      {res && (
        <>
          <div className="flex flex-wrap gap-3 text-xs text-gray-600">
            <Tf k="전체 기록 {건수}" params={{ 건수: res.summary.total }} />
            {Object.entries(res.summary.byStatus).map(([st, n]) => (
              <span key={st} className={`px-1.5 py-0.5 rounded-full font-bold ${STATUS_TONE[st] ?? 'bg-gray-100 text-gray-600'}`}>{st} {n}</span>
            ))}
          </div>
          <p className="text-[11px] text-gray-500"><T k="SIMULATED 는 발송 제공자가 없어 환자에게 나가지 않은 건입니다. SENT 는 채널이 받은 것이지 도달이 아닙니다." /></p>
          {res.summary.deliveryTracking === 'NOT_AVAILABLE' && (
            <p className="text-[11px] text-amber-700"><T k="도달 여부는 확인할 수 없습니다 — 발송 결과를 돌려받는 경로가 없습니다." /></p>
          )}
          {res.summary.byReason.length > 0 && (
            <div className="text-[11px] text-gray-600 flex flex-wrap gap-2">
              {res.summary.byReason.map((r) => (
                <span key={`${r.status}-${r.reason ?? ''}`} className="font-mono">{r.status}·{r.reason ?? '-'} {r.count}</span>
              ))}
            </div>
          )}

          {res.data.length === 0 ? (
            <EmptyState icon="📋" title={status ? '이 상태의 발송 기록이 없습니다' : '발송 기록이 없습니다'} compact />
          ) : (
            <div className="max-h-80 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="text-gray-500 border-b border-gray-100">
                  <tr>
                    <th className="py-1 text-left"><T k="환자" /></th>
                    <th className="py-1 text-center"><T k="채널" /></th>
                    <th className="py-1 text-center"><T k="상태" /></th>
                    <th className="py-1 text-left"><T k="사유" /></th>
                    <th className="py-1 text-left"><T k="발송시간" /></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {res.data.map((l) => (
                    <tr key={l.id}>
                      <td className="py-1 text-gray-700">{l.patientName ?? <span className="font-mono">{l.patientId.slice(0, 8)}</span>}</td>
                      <td className="py-1 text-center">{l.channel}</td>
                      <td className="py-1 text-center">
                        <span className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold whitespace-nowrap ${STATUS_TONE[l.status] ?? 'bg-gray-100 text-gray-600'}`}>{l.status}</span>
                      </td>
                      <td className="py-1 text-gray-500 font-mono">{l.reason ?? ''}</td>
                      <td className="py-1 text-gray-500"><KDate value={l.sentAt} mode="datetime" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {pages > 1 && (
            <div className="flex items-center justify-end gap-2 text-xs">
              <button disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)} className="px-2 py-1 border rounded disabled:opacity-40"><T k="이전" /></button>
              <span>{page} / {pages}</span>
              <button disabled={page >= pages || loading} onClick={() => setPage((p) => p + 1)} className="px-2 py-1 border rounded disabled:opacity-40"><T k="다음" /></button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
