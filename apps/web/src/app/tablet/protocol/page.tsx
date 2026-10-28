'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QrScanModal } from '@/app/(main)/workstation/front-desk/QrScanModal';

type Row = { instanceId: string; domain: string; surgeryId: string | null; currentStepKey: string | null; label: string; patientName: string; mrn: string; scheduledAt: string | null };

const STEP_KO: Record<string, string> = { PREP: '수술 전 준비', SIGN_IN: 'Sign-In', TIME_OUT: 'Time-Out', SURGERY: '수술 진행', SIGN_OUT: 'Sign-Out', RECOVERY: '회복', ADMIT_ASSESS: '입원 사정', CARE_PLAN: '간호 계획', ROUNDS: '회진', DISCHARGE_PLAN: '퇴원 계획', DISCHARGED: '퇴원' };
const DOMAIN_KO: Record<string, string> = { SURGERY: '수술', IPD: '입원', OPD: '외래', ER: '응급' };

export default function TabletProtocolList() {
  const router = useRouter();
  const [scan, setScan] = useState(false);
  const [err, setErr] = useState('');
  const { data, isLoading } = useQuery({
    queryKey: ['protocol-active'],
    queryFn: () => apiClient.get<{ data: Row[] }>('/api/v1/protocols/active'),
    refetchInterval: 30000,
  });
  const rows = (data?.data ?? []) as Row[];

  const onScan = async (raw: string) => {
    setScan(false); setErr('');
    let mrn = raw.trim();
    try { const j = JSON.parse(raw); if (j?.mrn) mrn = String(j.mrn); } catch { /* raw=mrn */ }
    try {
      const pr = await apiClient.get<{ data: { id: string }[] }>('/api/v1/patients', { q: mrn, limit: 1 });
      const pid = (pr?.data as { id: string }[] | undefined)?.[0]?.id;
      if (!pid) { setErr(`환자를 찾을 수 없습니다 (${mrn})`); return; }
      const rr = await apiClient.get<{ data: { instanceId: string | null } }>(`/api/v1/protocols/resolve`, { patientId: pid });
      const iid = (rr?.data as { instanceId: string | null })?.instanceId;
      if (!iid) { setErr('해당 환자의 활성 프로토콜이 없습니다 (수술/입원)'); return; }
      router.push(`/tablet/protocol/${iid}`);
    } catch { setErr('해석 실패'); }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-20 bg-white border-b border-gray-200 px-4 h-16 flex items-center gap-3">
        <button onClick={() => router.push('/tablet')} className="min-h-[44px] min-w-[44px] -ml-1 text-2xl text-gray-600" aria-label="뒤로">‹</button>
        <h1 className="flex-1 font-bold text-lg">수술 프로토콜</h1>
        <button onClick={() => setScan(true)} className="min-h-[44px] px-4 rounded-xl bg-blue-600 text-white text-sm font-semibold">📷 환자 QR 스캔</button>
      </header>

      {err && <div className="mx-4 mt-3 px-4 py-2 rounded-xl bg-red-50 text-red-700 text-sm">{err}</div>}

      <div className="flex-1 p-4">
        {isLoading ? (
          <div className="text-gray-400 p-6">불러오는 중…</div>
        ) : rows.length === 0 ? (
          <div className="text-gray-400 p-6">진행 중인 수술 프로토콜이 없습니다. (환자 QR을 스캔하면 생성됩니다)</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {rows.map((r) => (
              <button key={r.instanceId} onClick={() => router.push(`/tablet/protocol/${r.instanceId}`)}
                className="text-left bg-white rounded-2xl border border-gray-200 shadow-sm p-4 min-h-[92px] active:bg-gray-50">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-lg text-gray-900">{r.patientName}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 font-semibold">{STEP_KO[r.currentStepKey ?? ''] ?? r.currentStepKey ?? '—'}</span>
                </div>
                <div className="mt-1 text-sm text-gray-600 truncate"><span className="text-gray-400">[{DOMAIN_KO[r.domain] ?? r.domain}]</span> {r.label}</div>
                <div className="mt-0.5 text-xs text-gray-400">{r.mrn}{r.scheduledAt ? ` · ${r.scheduledAt.slice(0, 16).replace('T', ' ')}` : ''}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {scan && <QrScanModal onResult={onScan} onClose={() => setScan(false)} />}
    </div>
  );
}
