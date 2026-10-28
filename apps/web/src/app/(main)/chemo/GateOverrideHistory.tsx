'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import PatientSelector from '@/components/ui/PatientSelector';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { EmptyState, KDate, PatientName, StaffName, Unknown } from '@/components/ui/display';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

/**
 * 점검 우회 이력(2026-10-10) — nadir 게이트를 통과하지 못한 채 시작된 사이클.
 * 서버 `GET chemo/gate-overrides`(원장 = 사이클 시작 순간의 게이트 스냅샷).
 *  · 게이트가 꺼져(OFF) 있던 시작은 우회가 아니라 서버가 뺀다
 *  · 🔴 누가·왜가 남지 않은 시작(2026-10-10 이전분)은 '기록 없음' — 지어내지 않는다
 *  · 조회 실패 ≠ 0건 · 상한을 넘으면 잘림을 말한다
 */
export interface GateOverrideItem {
  cycleId: string; courseId: string; cycleNumber: number; status: string; startedAt: string;
  patientId: string; patientMrn: string | null; patientName: string | null;
  regimenCode: string; regimenName: string; mode: string | null;
  failedChecks: Array<{ name: string; value: string | null; unit: string | null; min: number; reason: string | null }>;
  recorded: boolean; override: boolean | null; reason: string | null; byId: string | null; byName: string | null;
}
interface GateOverrideResult { items: GateOverrideItem[]; total: number; limit: number; truncated: boolean }

const inputCls = 'min-h-[44px] rounded-lg border border-gray-200 px-3 text-sm';

export default function GateOverrideHistory() {
  const tAttr = useTAttr();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [patientId, setPatientId] = useState('');
  const q = useQuery({
    queryKey: ['chemo-gate-overrides', from, to, patientId],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (from) params.from = from;
      if (to) params.to = to;
      if (patientId) params.patientId = patientId;
      const r = await apiClient.get('/api/v1/chemo/gate-overrides', params);
      const raw = (r as { data?: unknown })?.data as { data?: GateOverrideResult } | GateOverrideResult;
      return ((raw as { data?: GateOverrideResult })?.data ?? raw) as GateOverrideResult;
    },
  });
  const d = q.data;

  return (
    <div className="space-y-3" data-gate-override-history>
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
        <p className="text-xs text-gray-500">
          <T k="nadir 게이트를 통과하지 못한 채 시작된 사이클입니다. 게이트가 꺼져 있던 시작은 우회가 아니라 빠집니다." />
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-gray-500 flex flex-col"><T k="시작일" />
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
          </label>
          <label className="text-xs text-gray-500 flex flex-col"><T k="종료일" />
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
          </label>
          <div className="min-w-[240px] flex-1">
            <PatientSelector value={patientId} onChange={(id: string) => setPatientId(id)} context="order" placeholder={tAttr('환자 검색(이름/MRN)')} />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {q.isError ? (
          <div className="p-3"><QueryErrorFallback error={q.error} onRetry={q.refetch} size="compact" /></div>
        ) : q.isLoading || !d ? (
          <p className="px-4 py-6 text-center text-sm text-gray-400"><T k="불러오는 중…" /></p>
        ) : d.items.length === 0 ? (
          <EmptyState compact title="이 조건에서 게이트를 넘겨 시작한 사이클이 없습니다" />
        ) : (
          <>
            {d.truncated && (
              <p className="px-4 py-2 text-xs text-amber-700 bg-amber-50" data-gate-override-truncated>
                <Tf k="전체 {total}건 중 최근 {shown}건만 보입니다 — 기간을 좁히세요" params={{ total: d.total, shown: d.items.length }} />
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs text-gray-500">
                  <tr>
                    <th className="px-3 py-2.5"><T k="시작 시각" /></th>
                    <th className="px-3 py-2.5"><T k="환자" /></th>
                    <th className="px-3 py-2.5"><T k="레지멘·사이클" /></th>
                    <th className="px-3 py-2.5"><T k="미통과 항목" /></th>
                    <th className="px-3 py-2.5"><T k="모드" /></th>
                    <th className="px-3 py-2.5"><T k="시작한 사람" /></th>
                    <th className="px-3 py-2.5"><T k="사유" /></th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((it) => (
                    <tr key={it.cycleId} className="border-t border-gray-100 align-top" data-gate-override-row={it.recorded ? 'recorded' : 'unrecorded'}>
                      <td className="px-3 py-2 whitespace-nowrap"><KDate value={it.startedAt} mode="datetime" /></td>
                      <td className="px-3 py-2"><PatientName name={it.patientName} mrn={it.patientMrn} /></td>
                      <td className="px-3 py-2 whitespace-nowrap">{it.regimenCode} C{it.cycleNumber}</td>
                      <td className="px-3 py-2 text-xs text-rose-700">
                        {it.failedChecks.length
                          ? it.failedChecks.map((c) => <div key={c.name}>{c.name}{c.reason ? ` — ${c.reason}` : ''}</div>)
                          : <Unknown kind="UNRECORDED" />}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {it.mode ?? <Unknown kind="UNRECORDED" />}
                        {it.override ? <span className="ml-1 rounded bg-amber-100 px-1 text-amber-800"><T k="의사 오버라이드" /></span> : null}
                      </td>
                      <td className="px-3 py-2 text-xs" data-gate-override-by>
                        {it.recorded ? <StaffName name={it.byName} /> : <Unknown kind="UNRECORDED" />}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {it.reason ? it.reason : it.recorded && !it.override ? <T k="사유 없이 시작(경고 모드)" /> : <Unknown kind="UNRECORDED" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {d.items.some((i) => !i.recorded) && (
              <p className="px-4 py-2 text-[11px] text-gray-500 border-t border-gray-100">
                <T k="'기록 없음' 행은 2026-10-10 이전에 시작돼 누가·왜를 남기지 않은 사이클입니다(추정하지 않습니다)." />
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
