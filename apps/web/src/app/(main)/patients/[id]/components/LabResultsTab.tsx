'use client';

import { LabTerm } from '@/components/ui/lab-term';

import { useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { apiClient } from '@/lib/api-client';
import { safeFormat as format } from '@/lib/safe-date';
import type { LabResult, LabResultItem } from './types';
import { LabReportModal } from '@/components/document/LabReportModal';

import { EmptyState } from '@/components/ui/display';
// 검사 flag 판정 정본(shared lab-flags) — 위급값(HH·LL·C·CRITICAL) 전량 처리.
import { isAbnormalFlag as isAbnFlag, isCriticalFlag as isCritFlag, isHighFlag, isLowFlag } from '@hospital-run/shared';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import Link from 'next/link';
import { useHasRole } from '@/hooks/use-admin-write';

/** 차트에서 바로 확인 — 받는 상한(나머지는 결과 확인함) */
export const CHART_ACK_LIMIT = 20;
interface UnackedItem {
  orderId: string; testName: string | null; completedAt: string | null; severity: string;
  lab: { flaggedItems: Array<{ testName: string; value: string; unit: string; flag: string | null }> } | null;
  imaging: { impression: string | null } | null;
}
interface UnackedRes { total: number; counts: { critical: number; abnormal: number; other: number }; items: UnackedItem[] }

const TREND_PANELS = [
  { name: 'CBC', items: [
    { key: 'WBC', label: 'WBC', unit: '/uL', normalMin: 4000, normalMax: 10000 },
    { key: 'Hgb', label: 'Hgb', unit: 'g/dL', normalMin: 12, normalMax: 17 },
    { key: 'PLT', label: 'PLT', unit: 'x10^3/uL', normalMin: 150, normalMax: 400 },
  ]},
  { name: 'LFT', items: [
    { key: 'AST', label: 'AST', unit: 'U/L', normalMin: 0, normalMax: 40 },
    { key: 'ALT', label: 'ALT', unit: 'U/L', normalMin: 0, normalMax: 40 },
  ]},
  { name: 'RFT', items: [
    { key: 'BUN', label: 'BUN', unit: 'mg/dL', normalMin: 7, normalMax: 20 },
    { key: 'Cr', label: 'Cr', unit: 'mg/dL', normalMin: 0.6, normalMax: 1.2 },
  ]},
  { name: 'Metabolic', items: [
    { key: 'HbA1c', label: 'HbA1c', unit: '%', normalMin: 4.0, normalMax: 5.6 },
    { key: 'Glucose', label: 'Glucose', unit: 'mg/dL', normalMin: 70, normalMax: 100 },
    { key: 'LDL', label: 'LDL', unit: 'mg/dL', normalMin: 0, normalMax: 130 },
  ]},
];

function TrendSparkline({ dataPoints, normalMin, normalMax }: {
  dataPoints: { value: number; date: string; flag?: string }[];
  normalMin: number;
  normalMax: number;
}) {
  if (dataPoints.length < 2) return <span className="text-[10px] text-gray-400"><T k="데이터 부족" /></span>;

  const values = dataPoints.map(d => d.value);
  const allVals = [...values, normalMin, normalMax];
  const max = Math.max(...allVals);
  const min = Math.min(...allVals);
  const range = max - min || 1;
  const w = 200;
  const h = 50;
  const pad = 4;

  const toY = (v: number) => pad + (h - 2 * pad) - ((v - min) / range) * (h - 2 * pad);
  const toX = (i: number) => pad + (i / (dataPoints.length - 1)) * (w - 2 * pad);

  const points = dataPoints.map((d, i) => `${toX(i)},${toY(d.value)}`).join(' ');
  const bandY1 = toY(normalMax);
  const bandY2 = toY(normalMin);

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ height: h }}>
      <rect x={pad} y={bandY1} width={w - 2 * pad} height={bandY2 - bandY1} fill="#D1FAE5" opacity="0.5" rx="2" />
      <polyline points={points} fill="none" stroke="#3B82F6" strokeWidth="1.5" />
      {dataPoints.map((d, i) => {
        const abn = isAbnFlag(d.flag);
        return (
          <circle
            key={i}
            cx={toX(i)}
            cy={toY(d.value)}
            r={abn ? 3 : 2}
            fill={isCritFlag(d.flag) ? '#B91C1C' : abn ? '#EF4444' : '#3B82F6'}
          />
        );
      })}
    </svg>
  );
}

export function LabResultsTab({ patientId }: { patientId: string }) {
  const tAttr = useTAttr();
  const [showTrend, setShowTrend] = useState(false);
  const [docResult, setDocResult] = useState<LabResult | null>(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['patient-lab-results', patientId],
    queryFn: () => apiClient.get<{ data: LabResult[] }>(`/api/v1/lab/patients/${patientId}/results`),
    enabled: !!patientId,
  });

  // 🔴 (2026-10-10) 결과 '확인'(의사 확인 원장)은 결과 확인함에서만 했다 — 차트에서 이 환자의 미확인 결과 수를 말하고 그 목록으로 보낸다.
  //    확인 EP·목록은 의사·관리자 몫(서버 @Roles) — 그 밖 역할은 부르지 않는다.
  const canAck = useHasRole('DOCTOR');
  const qc = useQueryClient();
  const tAttrAck = useTAttr();
  // 🔴 (2026-10-10) 차트에서 바로 확인 — 같은 정본 EP(목록·확인)·같은 캐시 키 앞자리(['results-inbox'])라 할 일함 수도 함께 줄어든다
  const unacked = useQuery({
    queryKey: ['results-inbox', 'chart', patientId],
    queryFn: async () => {
      const r = await apiClient.get<{ data: UnackedRes }>(`/api/v1/doctors/results-inbox?patientId=${patientId}&limit=${CHART_ACK_LIMIT}&offset=0`);
      const d = (r as { data?: unknown })?.data as UnackedRes | { data: UnackedRes };
      return ('total' in (d as object) ? d : (d as { data: UnackedRes }).data) as UnackedRes;
    },
    enabled: !!patientId && canAck,
  });
  const ackDone = (n: number) => { qc.invalidateQueries({ queryKey: ['results-inbox'] }); toast.success(tAttrAck('확인했습니다') + ` (${n})`); };
  const ackOne = useMutation({
    mutationFn: (orderId: string) => apiClient.patch(`/api/v1/doctors/orders/${orderId}/acknowledge`, {}),
    onSuccess: () => ackDone(1),
    onError: (e) => toast.error((e as { message?: string })?.message || tAttrAck('확인하지 못했습니다')),
  });
  const ackShown = useMutation({
    mutationFn: async (orderIds: string[]) => {
      const r = await apiClient.post<{ data: { acknowledged: number; skipped: number } }>('/api/v1/doctors/orders/acknowledge', { orderIds });
      return ((r as { data?: unknown })?.data ?? r) as { acknowledged: number; skipped: number };
    },
    onSuccess: (r) => ackDone(r.acknowledged),
    onError: (e) => toast.error((e as { message?: string })?.message || tAttrAck('확인하지 못했습니다')),
  });

  const _resultsRaw = data?.data;
  const results: LabResult[] = Array.isArray(_resultsRaw) ? _resultsRaw : (_resultsRaw as Record<string, unknown> | undefined)?.data as LabResult[] ?? [];

  // Build trend data from all completed results
  const trendData = useMemo(() => {
    const map: Record<string, { value: number; date: string; flag?: string }[]> = {};
    const completed = results
      .filter(lr => lr.status === 'COMPLETED' && lr.items)
      .sort((a, b) => new Date(a.completedAt ?? a.collectedAt ?? '').getTime() - new Date(b.completedAt ?? b.collectedAt ?? '').getTime());

    for (const lr of completed) {
      const date = lr.completedAt ?? lr.collectedAt ?? '';
      for (const item of lr.items ?? []) {
        const numVal = parseFloat(item.value);
        if (isNaN(numVal)) continue;
        const key = item.testName;
        if (!map[key]) map[key] = [];
        map[key].push({ value: numVal, date, flag: item.flag });
      }
    }
    return map;
  }, [results]);

  return (
    <div className="space-y-4">
      {canAck && (
        unacked.isError
          ? <p className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700" data-chart-unacked="failed"><T k="미확인 결과 수를 불러오지 못했습니다 — 0건이 아닙니다" /></p>
          : unacked.data && unacked.data.total > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm" data-chart-unacked={unacked.data.total}>
              <span className="font-semibold text-amber-900"><Tf k="이 환자의 의사 미확인 결과 {n}건" params={{ n: unacked.data.total }} /></span>
              {unacked.data.counts.critical > 0 && <span className="rounded bg-red-600 px-1.5 py-0.5 text-xs font-bold text-white"><Tf k="위급 {n}" params={{ n: unacked.data.counts.critical }} /></span>}
              <Link href={`/doctor-inbox?tab=results&patientId=${patientId}`} className="ml-auto min-h-[44px] rounded-lg bg-white px-3 py-2.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-300" data-chart-unacked-link>
                <T k="확인하러 가기" /> →
              </Link>
              {/* 차트에서 바로 확인 — 받은 목록(상한) 안에서만 · 잘렸으면 그렇게 말한다 */}
              <ul className="w-full divide-y divide-amber-100 rounded-lg bg-white" data-chart-unacked-list>
                {unacked.data.items.map((it) => (
                  <li key={it.orderId} className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-xs" data-chart-unacked-item={it.orderId}>
                    {it.severity === 'CRITICAL' && <span className="rounded bg-red-600 px-1 text-[10px] font-bold text-white"><T k="위급" /></span>}
                    <span className="font-semibold text-gray-800">{it.testName ? <LabTerm name={it.testName} /> : '—'}</span>
                    {it.lab?.flaggedItems?.slice(0, 3).map((f) => <span key={f.testName} className="text-gray-600"><LabTerm name={f.testName} /> {f.value}{f.unit ? ` ${f.unit}` : ''}{f.flag ? ` (${f.flag})` : ''}</span>)}
                    {it.imaging?.impression && <span className="truncate text-gray-600">{it.imaging.impression}</span>}
                    <span className="ml-auto text-gray-400">{it.completedAt ? format(new Date(it.completedAt), 'MM-dd HH:mm') : '—'}</span>
                    <button type="button" disabled={ackOne.isPending || ackShown.isPending} onClick={() => ackOne.mutate(it.orderId)} data-chart-ack={it.orderId}
                      className="min-h-[44px] rounded-lg bg-amber-600 px-3 text-xs font-semibold text-white disabled:opacity-40"><T k="확인" /></button>
                  </li>
                ))}
              </ul>
              {unacked.data.items.length > 1 && (
                <button type="button" disabled={ackShown.isPending || ackOne.isPending} onClick={() => ackShown.mutate(unacked.data!.items.map((i) => i.orderId))} data-chart-ack-shown
                  className="min-h-[44px] rounded-lg border border-amber-300 bg-white px-3 text-xs font-semibold text-amber-800 disabled:opacity-40">
                  <Tf k="보이는 {n}건 모두 확인" params={{ n: unacked.data.items.length }} />
                </button>
              )}
              {unacked.data.total > unacked.data.items.length && (
                <p className="w-full text-[11px] text-amber-800" data-chart-unacked-truncated><Tf k="최근 {shown}건만 보입니다(전체 {total}건) — 나머지는 결과 확인함에서" params={{ shown: unacked.data.items.length, total: unacked.data.total }} /></p>
              )}
            </div>
          )
      )}
      {/* Trend Chart Section */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900"><T k="검사결과 (Lab Results)" /></h3>
          <button
            onClick={() => setShowTrend(!showTrend)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
              showTrend ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5" />
            </svg>
            <T k="트렌드 보기" />
          </button>
        </div>

        {showTrend && (
          <div className="mb-6 border border-gray-100 rounded-xl p-4 bg-gray-50/50">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {TREND_PANELS.map((panel) => {
                const hasData = panel.items.some(item => {
                  const matches = Object.entries(trendData).find(([k]) =>
                    k.toLowerCase().includes(item.key.toLowerCase())
                  );
                  return matches && matches[1].length >= 2;
                });
                if (!hasData) return null;
                return (
                  <div key={panel.name}>
                    <p className="text-xs font-semibold text-gray-600 mb-2">{panel.name}</p>
                    <div className="space-y-3">
                      {panel.items.map((item) => {
                        const match = Object.entries(trendData).find(([k]) =>
                          k.toLowerCase().includes(item.key.toLowerCase())
                        );
                        if (!match || match[1].length < 2) return null;
                        const latest = match[1][match[1].length - 1];
                        return (
                          <div key={item.key}>
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="text-[11px] text-gray-500">{item.label}</span>
                              <span className={`text-[11px] font-mono font-bold ${
                                isCritFlag(latest.flag) ? 'text-red-700' : isAbnFlag(latest.flag) ? 'text-red-600' : 'text-gray-700'
                              }`}>
                                {latest.value} {item.unit}
                              </span>
                            </div>
                            <TrendSparkline
                              dataPoints={match[1]}
                              normalMin={item.normalMin}
                              normalMax={item.normalMax}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              {TREND_PANELS.every(panel => !panel.items.some(item => {
                const match = Object.entries(trendData).find(([k]) =>
                  k.toLowerCase().includes(item.key.toLowerCase())
                );
                return match && match[1].length >= 2;
              })) && (
                <p className="text-xs text-gray-400 col-span-2 text-center py-4"><T k="트렌드 데이터가 충분하지 않습니다 (최소 2건 필요)" /></p>
              )}
            </div>
          </div>
        )}

        {/* Existing results table */}
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}
          </div>
        ) : isError ? (
          /* 🔴 조회 실패를 "없습니다"로 그리지 않는다 — import 만 있고 렌더가 없던 자리(2026-09-02) */
          <QueryErrorFallback error={error} onRetry={() => refetch()} />
        ) : results.length === 0 ? (
          <EmptyState icon="🧪" title="검사결과가 없습니다" />
        ) : (
          <div className="space-y-6">
            {results.map((lr: LabResult) => (
              <div key={lr.id} className="border border-gray-100 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 bg-gray-50">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                      lr.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700' :
                      lr.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-700' :
                      'bg-amber-100 text-amber-700'
                    }`}>
                      {lr.status === 'COMPLETED' ? '완료' : lr.status === 'IN_PROGRESS' ? '진행중' : '대기'}
                    </span>
                    <span className="text-xs text-gray-500">
                      {lr.completedAt ? format(new Date(lr.completedAt), 'yyyy-MM-dd HH:mm') : lr.collectedAt ? format(new Date(lr.collectedAt), 'yyyy-MM-dd HH:mm') : '-'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-gray-400">{lr.items?.length ?? 0}항목</span>
                    {lr.items && lr.items.length > 0 && (
                      <button onClick={() => setDocResult(lr)} className="text-[11px] px-2 py-0.5 rounded-full border border-gray-300 text-gray-600 hover:bg-white"><T k="📄 검사 성적서" /></button>
                    )}
                  </div>
                </div>
                {lr.items && lr.items.length > 0 && (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500"><T k="검사항목" /></th>
                        <th className="px-4 py-2 text-right text-xs font-medium text-gray-500"><T k="결과" /></th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-gray-500"><T k="단위" /></th>
                        <th className="px-4 py-2 text-center text-xs font-medium text-gray-500"><T k="참고범위" /></th>
                        <th className="px-4 py-2 text-center text-xs font-medium text-gray-500"><T k="판정" /></th>
                      </tr>
                    </thead>
                    <tbody>
                      {lr.items.map((item: LabResultItem) => {
                        const abn = isAbnFlag(item.flag);
                        const crit = isCritFlag(item.flag);
                        return (
                          <tr key={item.id} className={`border-b border-gray-50 ${crit ? 'bg-red-100/70' : abn ? 'bg-red-50/50' : ''}`}>
                            <td className="px-4 py-2 text-gray-900 font-medium"><LabTerm name={item.testName} /></td>
                            <td className={`px-4 py-2 text-right font-mono font-bold ${
                              crit || isHighFlag(item.flag) ? 'text-red-600' : isLowFlag(item.flag) ? 'text-blue-600' : 'text-gray-900'
                            }`}>
                              {item.value}
                              {isHighFlag(item.flag) ? ' ↑' : isLowFlag(item.flag) ? ' ↓' : ''}
                            </td>
                            <td className="px-4 py-2 text-gray-500 text-xs">{item.unit}</td>
                            <td className="px-4 py-2 text-center text-xs text-gray-400">
                              {item.normalMin != null && item.normalMax != null ? `${item.normalMin} - ${item.normalMax}` : '-'}
                            </td>
                            <td className="px-4 py-2 text-center">
                              {crit && <span className="text-[11px] font-bold text-white bg-red-600 px-1.5 py-0.5 rounded">🔴 위급</span>}
                              {!crit && item.flag === 'H' && <span className="text-[11px] font-bold text-red-600 bg-red-100 px-1.5 py-0.5 rounded">HIGH</span>}
                              {!crit && item.flag === 'L' && <span className="text-[11px] font-bold text-blue-600 bg-blue-100 px-1.5 py-0.5 rounded">LOW</span>}
                              {(item.flag === 'N' || item.flag === 'NORMAL') && <span className="text-[11px] text-emerald-600"><T k="정상" /></span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {docResult && (
        <LabReportModal patientId={patientId} result={docResult} onClose={() => setDocResult(null)} />
      )}
    </div>
  );
}
