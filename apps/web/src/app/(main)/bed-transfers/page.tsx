'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BED_TRANSFER_STATUS_LABEL, BED_TRANSFER_CLOSED_BY_ADMISSION, type BedTransferStatus } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { kdate, pollMs } from '@/lib/ui-settings';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { EmptyState } from '@/components/ui/display';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { useTransferWards } from '@/components/inpatient/bed-transfer-common';
import { BedTransferActions } from '@/components/inpatient/BedTransferActions';

/**
 * 병동 간 전동 요청 · 수락(화면 1906) — 2026-09-30.
 * 받을 요청(병동 선택) · 보낸 요청 · 최근 처리(7일). 수락하면 고른 병상으로 **그 순간** 옮겨진다(서버 한 트랜잭션).
 * 🔴 받는 병동 소속은 확인하지 못한다(사용자에 병동 소속이 없다) — 누가 수락·거절했는지 남긴다.
 */
type Bed = { id: string; roomNumber: string; bedNumber: string; ward?: { id: string; name: string } };
export type Item = {
  id: string; status: BedTransferStatus; reason: string; requestedAt: string; decidedAt: string | null; decisionNote: string | null;
  admissionId: string; targetWardId: string; requestedById: string;
  patient: { id: string; mrn: string; familyName: string; givenName: string } | null;
  fromBed: Bed | null; targetWard: { id: string; name: string } | null; targetBed: Bed | null; acceptedBed: Bed | null;
  requestedByName: string | null; decidedByName: string | null;
};
type Scope = 'incoming' | 'mine' | 'recent';
const bedText = (b: Bed | null) => (b ? `${b.ward?.name ?? ''} ${b.roomNumber}-${b.bedNumber}`.trim() : '—');

export default function BedTransfersPage() {
  const tAttr = useTAttr();
  const [scope, setScope] = useState<Scope>('incoming');
  const [wardFilter, setWardFilter] = useState('');
  const wardsQ = useTransferWards();
  const q = useQuery({
    queryKey: ['bed-transfers', scope, wardFilter],
    queryFn: () => apiClient.get<{ data: Item[]; meta?: { truncated?: boolean } }>('/api/v1/bed-transfers', { scope, ...(scope === 'incoming' && wardFilter ? { targetWardId: wardFilter } : {}) }),
    refetchInterval: pollMs('normal'),
  });
  const items = Array.isArray(q.data?.data) ? q.data!.data : [];
  const bedsOf = (wardId: string) => (wardsQ.data ?? []).find((w) => w.id === wardId)?.beds ?? [];
  const tab = (k: Scope, label: string) => (
    <button type="button" onClick={() => setScope(k)} data-bt-scope={k}
      className={`min-h-[40px] rounded-lg px-3 text-xs font-medium ${scope === k ? 'bg-amber-600 text-white' : 'bg-gray-100 text-gray-700'}`}><T k={label} /></button>
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900"><T k="병동 간 전동" /></h1>
        <p className="mt-0.5 text-sm text-gray-500"><T k="보내는 병동이 요청하고, 받는 병동이 병상을 골라 수락하면 그때 옮겨집니다." /></p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {tab('incoming', '받을 요청')}{tab('mine', '보낸 요청')}{tab('recent', '최근 처리(7일)')}
        {scope === 'incoming' && (
          <select value={wardFilter} onChange={(e) => setWardFilter(e.target.value)} data-bt-ward-filter className="rounded-lg border border-gray-200 px-2 py-2 text-xs">
            <option value="">{tAttr('모든 병동')}</option>
            {(wardsQ.data ?? []).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
        )}
      </div>
      {scope === 'incoming' && <p className="text-[11px] text-gray-500"><T k="받는 병동 소속은 시스템이 확인하지 못합니다 — 누가 수락·거절했는지 기록됩니다." /></p>}

      {q.isError ? <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} /> :
       q.isLoading ? <div className="h-24 rounded-xl bg-gray-100 animate-pulse" /> :
       items.length === 0 ? <EmptyState icon="🛏️" title={scope === 'incoming' ? '수락을 기다리는 전동 요청이 없습니다' : scope === 'mine' ? '보낸 전동 요청이 없습니다' : '최근 7일 처리된 전동 요청이 없습니다'} className="bg-white rounded-2xl border" /> : (
        <ul className="space-y-2">
          {items.map((r) => {
            const free = bedsOf(r.targetWardId);
            return (
              <li key={r.id} className="rounded-2xl border bg-white p-4 text-sm" data-bt-row={r.status}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-800"><T k={BED_TRANSFER_STATUS_LABEL[r.status] ?? r.status} /></span>
                  <span className="font-semibold text-gray-900">{r.patient ? `${r.patient.familyName}${r.patient.givenName}` : '—'}</span>
                  <span className="text-xs text-gray-400">{r.patient?.mrn}</span>
                  <span className="ml-auto text-xs text-gray-500">{kdate(r.requestedAt, 'datetime')} · {r.requestedByName ?? '—'}</span>
                </div>
                <p className="mt-1 text-xs text-gray-700">{bedText(r.fromBed)} → <b>{r.targetWard?.name ?? '—'}</b>{r.targetBed ? <> (<T k="희망" /> {r.targetBed.roomNumber}-{r.targetBed.bedNumber})</> : null}</p>
                <p className="text-xs text-gray-600"><T k="사유:" /> {r.reason}</p>
                {r.status !== 'REQUESTED' && (
                  <p className="text-[11px] text-gray-500" data-bt-decided>
                    {r.decisionNote === BED_TRANSFER_CLOSED_BY_ADMISSION ? <T k="입원이 끝나 저절로 닫혔습니다" /> : <>{r.decidedByName ?? '—'} · {kdate(r.decidedAt, 'datetime')}{r.decisionNote ? ` · ${r.decisionNote}` : ''}</>}
                    {r.acceptedBed ? <> · <T k="이동 병상" /> {bedText(r.acceptedBed)}</> : null}
                  </p>
                )}
                {r.status === 'REQUESTED' && <BedTransferActions item={r} beds={bedsOf(r.targetWardId)} incoming={scope === 'incoming'} />}
              </li>
            );
          })}
        </ul>
      )}
      {q.data?.meta?.truncated && <p className="text-[11px] text-amber-700"><Tf k="앞의 {n}건만 보입니다." params={{ n: 200 }} /></p>}
    </div>
  );
}
