'use client';

import { useState } from 'react';
import { Unit } from '@/components/ui/display';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QrScanModal } from '@/app/(main)/workstation/front-desk/QrScanModal';
import { AI_ORIGIN_TEXT } from '@hospital-run/shared';

type Row = {
  admissionId: string; name: string; mrn: string; ward: string; wardId: string | null;
  room: string; bed: string; losDays: number;
  ews: { score: number; risk: string } | null; fall: { risk: string } | null;
  meds: { due: number; overdue: number }; unsignedNotes: number; highRisk: boolean;
};
type Board = { wards: { id: string; name: string }[]; patients: Row[]; summary: { total: number; highRisk: number; medsOverdue: number; unsignedNotes: number } };
type Resolved = { admissionId: string | null; name: string; mrn: string; ward: string | null; bed: string | null };

const EWS_TONE: Record<string, string> = { HIGH: 'bg-rose-100 text-rose-700', MEDIUM: 'bg-amber-100 text-amber-700', LOW_MEDIUM: 'bg-yellow-50 text-yellow-700', LOW: 'bg-emerald-50 text-emerald-700' };

export default function NurseTabletBoard() {
  const router = useRouter();
  const [wardId, setWardId] = useState('');
  const [scan, setScan] = useState(false);
  const [scanErr, setScanErr] = useState('');

  const board = useQuery({
    queryKey: ['tablet-nursing-board', wardId],
    queryFn: () => apiClient.get<{ data: Board }>(`/api/v1/nursing/station-board${wardId ? `?wardId=${wardId}` : ''}`),
    refetchInterval: 30000,
  });
  const briefing = useQuery({
    queryKey: ['tablet-nursing-brief', wardId],
    queryFn: () => apiClient.get<{ data: { briefing: string } }>(`/api/v1/nursing/station-briefing${wardId ? `?wardId=${wardId}` : ''}`),
    refetchInterval: 60000, retry: false,
  });
  const resp = ((board.data as { data?: { data?: Board } } | undefined)?.data?.data) ?? (board.data as { data?: Board } | undefined)?.data;
  const rows = resp?.patients ?? [];
  const brief = (((briefing.data as { data?: { data?: { briefing?: string } } } | undefined)?.data?.data) ?? (briefing.data as { data?: { briefing?: string } } | undefined)?.data)?.briefing;

  const onScan = async (code: string) => {
    setScan(false); setScanErr('');
    try {
      const r = await apiClient.get<{ data: Resolved }>(`/api/v1/nursing/resolve-patient`, { code });
      const d = ((r as { data?: { data?: Resolved } })?.data?.data) ?? (r as { data?: Resolved })?.data;
      if (d?.admissionId) router.push(`/tablet/nursing/${d.admissionId}`);
      else setScanErr(`${d?.name ?? '환자'}(${d?.mrn ?? '-'}) — 활성 입원이 없습니다(외래).`);
    } catch (e) {
      setScanErr((e as { message?: string })?.message ?? '환자를 찾을 수 없습니다.');
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <header className="sticky top-0 z-20 bg-white border-b px-4 h-14 flex items-center gap-2">
        <span className="w-8 h-8 rounded-lg bg-indigo-600 text-white grid place-items-center font-bold text-sm">간</span>
        <div className="font-bold text-gray-900 text-sm leading-tight">간호 라운드<div className="text-[10px] text-gray-400 font-normal">{AI_ORIGIN_TEXT} 타블렛</div></div>
        <div className="flex-1" />
        <button onClick={() => { setScan(true); setScanErr(''); }} className="min-h-[44px] px-4 rounded-xl bg-indigo-600 text-white text-sm font-semibold inline-flex items-center gap-1">📷 환자 스캔</button>
      </header>

      <div className="p-3 space-y-3 flex-1">
        {scanErr && <div className="rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-sm text-rose-700">{scanErr}</div>}

        {/* WeRU.B 브리핑 */}
        {!briefing.isError && brief && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-3">
            <p className="text-xs font-semibold text-amber-800 mb-0.5">✦ {AI_ORIGIN_TEXT} 브리핑</p>
            <p className="text-sm text-gray-800 leading-relaxed">{brief}</p>
          </div>
        )}

        {/* 요약 */}
        {resp && (
          <div className="grid grid-cols-4 gap-2 text-center">
            {[['재원', resp.summary.total, ''], ['고위험', resp.summary.highRisk, 'text-rose-600'], ['투약지연', resp.summary.medsOverdue, 'text-amber-600'], ['미서명', resp.summary.unsignedNotes, '']].map(([l, v, c]) => (
              <div key={l as string} className="rounded-xl bg-white border p-2"><div className={`text-xl font-bold ${c as string}`}>{v as number}</div><div className="text-[10px] text-gray-500">{l as string}</div></div>
            ))}
          </div>
        )}

        {/* 병동 필터 */}
        {(resp?.wards.length ?? 0) > 1 && (
          <div className="flex gap-1 overflow-x-auto">
            <button onClick={() => setWardId('')} className={`min-h-[40px] px-3 rounded-lg text-xs whitespace-nowrap border ${!wardId ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white'}`}>전체</button>
            {resp!.wards.map((w) => <button key={w.id} onClick={() => setWardId(w.id)} className={`min-h-[40px] px-3 rounded-lg text-xs whitespace-nowrap border ${wardId === w.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white'}`}>{w.name}</button>)}
          </div>
        )}

        {/* 위험 우선 환자(큰 터치 행) */}
        {board.isLoading ? <div className="py-10 text-center text-sm text-gray-400">불러오는 중…</div>
        : !rows.length ? <div className="py-10 text-center text-sm text-gray-400">재원 환자가 없습니다.</div>
        : (
          <div className="space-y-2">
            {rows.map((r) => (
              <button key={r.admissionId} onClick={() => router.push(`/tablet/nursing/${r.admissionId}`)}
                className={`w-full text-left rounded-2xl border bg-white p-3 active:bg-gray-50 ${r.highRisk ? 'border-rose-200' : 'border-gray-100'}`}>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-gray-400 w-16 flex-shrink-0">{r.room}-{r.bed}</span>
                  <span className="font-semibold text-gray-900">{r.name}</span>
                  <span className="text-[10px] text-gray-400">{r.mrn} · {r.losDays}<Unit>일</Unit></span>
                  <div className="flex-1" />
                  {r.ews && <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${EWS_TONE[r.ews.risk] ?? 'bg-gray-100 text-gray-600'}`}>EWS {r.ews.score}</span>}
                </div>
                <div className="flex gap-1.5 mt-1.5 flex-wrap">
                  {r.fall?.risk === 'HIGH' && <span className="px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-600 text-[10px]">낙상 高</span>}
                  {r.meds.overdue > 0 && <span className="px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[10px]">투약지연 {r.meds.overdue}</span>}
                  {r.unsignedNotes > 0 && <span className="px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 text-[10px]">미서명 {r.unsignedNotes}</span>}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {scan && <QrScanModal onResult={onScan} onClose={() => setScan(false)} />}
    </div>
  );
}
