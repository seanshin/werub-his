'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { useAuthStore } from '@/stores/auth-store';

interface Station { stationId: string; name: string; icon?: string; waiting?: number; inProgress?: number }
interface QueueItem { visitId: string; checkedInAt?: string; stationStatus?: string; pendingCount?: number; patient?: { mrn?: string; familyName?: string; givenName?: string; gender?: string }; program?: { code?: string; name?: string } }
interface Stats { reserved: number; checkedIn: number; inProgress: number; examComplete: number; completed: number; total: number }

const SS: Record<string, { label: string; cls: string }> = {
  WAITING: { label: '대기', cls: 'bg-gray-100 text-gray-600' },
  ARRIVED: { label: '도착', cls: 'bg-blue-100 text-blue-700' },
  IN_PROGRESS: { label: '진행중', cls: 'bg-amber-100 text-amber-700' },
  DONE: { label: '완료', cls: 'bg-emerald-100 text-emerald-700' },
};

export default function TabletCheckupPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { user, isAuthenticated, loadProfile } = useAuthStore();
  const [ready, setReady] = useState(false);
  const [station, setStation] = useState('ck-blood');
  const [judgeFor, setJudgeFor] = useState<QueueItem | null>(null);

  useEffect(() => {
    (async () => {
      if (!isAuthenticated) { router.replace('/staff/login'); return; }
      if (!user) { try { await loadProfile(); } catch { router.replace('/staff/login'); return; } }
      setReady(true);
    })();
  }, [isAuthenticated, user, loadProfile, router]);

  const stats = useQuery({ queryKey: ['ck-today-stats'], queryFn: () => apiClient.get<{ data: Stats }>('/api/v1/checkup/visits/today-stats').then((r) => r.data), enabled: ready, refetchInterval: 15000 });
  const board = useQuery({ queryKey: ['ck-flow-board'], queryFn: () => apiClient.get<{ data: { stations: Station[] } }>('/api/v1/checkup/ws/flow-board').then((r) => r.data?.stations ?? []), enabled: ready, refetchInterval: 15000 });
  const q = useQuery({ queryKey: ['ck-queue', station], queryFn: () => apiClient.get<{ data: { queue: QueueItem[] } }>(`/api/v1/checkup/ws/stations/${station}/queue`).then((r) => r.data?.queue ?? []), enabled: ready, refetchInterval: 8000 });
  const arrive = useMutation({
    mutationFn: (visitId: string) => apiClient.post(`/api/v1/checkup/ws/${visitId}/arrive`, { stationId: station }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ck-queue', station] }),
  });

  if (!ready) return <div className="min-h-screen flex items-center justify-center text-gray-400">로딩 중…</div>;
  const s = stats.data;
  const stations = (board.data ?? []).filter((x) => x.stationId !== 'ck-reception');
  const list = q.data ?? [];

  return (
    <div className="min-h-[100dvh] bg-gray-100">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="px-3 py-2.5 flex items-center gap-2">
          <button onClick={() => router.push('/staff')} aria-label="내부포털로" className="p-1 rounded-lg hover:bg-gray-100">
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <span className="font-bold text-gray-800">건강검진</span>
        </div>
        {stats.isError && (
          <div className="px-3 pb-2"><QueryErrorFallback error={stats.error} onRetry={stats.refetch} size="compact" /></div>
        )}
        {!stats.isError && s && (
          <div className="px-3 pb-2 flex gap-2 text-center text-[11px]">
            <div className="flex-1 rounded-lg bg-blue-50 py-1"><div className="font-bold text-blue-700">{s.checkedIn}</div>접수</div>
            <div className="flex-1 rounded-lg bg-amber-50 py-1"><div className="font-bold text-amber-700">{s.inProgress}</div>진행</div>
            <div className="flex-1 rounded-lg bg-emerald-50 py-1"><div className="font-bold text-emerald-700">{s.examComplete}</div>검사완료</div>
            <div className="flex-1 rounded-lg bg-gray-50 py-1"><div className="font-bold text-gray-700">{s.total}</div>전체</div>
          </div>
        )}
        {board.isError && (
          <div className="px-3 pb-2"><QueryErrorFallback error={board.error} onRetry={board.refetch} size="compact" /></div>
        )}
        <div className="px-2 pb-2 flex gap-1.5 overflow-x-auto">
          {!board.isError && stations.map((st) => (
            <button key={st.stationId} onClick={() => setStation(st.stationId)} className={`flex-shrink-0 px-3 py-1.5 rounded-full text-sm whitespace-nowrap ${station === st.stationId ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>
              {st.name}{typeof st.waiting === 'number' && st.waiting > 0 ? ` ${st.waiting}` : ''}
            </button>
          ))}
        </div>
      </header>

      <main className="p-3 space-y-2">
        {/* 🔴 조회 실패를 "대기 중인 수검자가 없습니다"로 말하지 않는다 */}
        {q.isError && <QueryErrorFallback error={q.error} onRetry={q.refetch} />}
        {!q.isError && list.length === 0 && <p className="text-center text-gray-400 text-sm py-10">대기 중인 수검자가 없습니다.</p>}
        {!q.isError && list.map((v) => (
          <div key={v.visitId} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="font-semibold text-gray-800 truncate">{v.patient?.familyName}{v.patient?.givenName} <span className="text-xs text-gray-400">{v.patient?.gender === 'MALE' ? 'M' : v.patient?.gender === 'FEMALE' ? 'F' : ''}</span></span>
                <p className="text-xs text-gray-500 truncate">{v.program?.name} · {v.patient?.mrn}{typeof v.pendingCount === 'number' ? ` · 잔여 ${v.pendingCount}` : ''}</p>
              </div>
              <span className={`flex-shrink-0 text-[11px] px-2 py-0.5 rounded-full ${SS[v.stationStatus ?? '']?.cls ?? 'bg-gray-100'}`}>{SS[v.stationStatus ?? '']?.label ?? v.stationStatus}</span>
            </div>
            <div className="mt-2 flex gap-2">
              {v.stationStatus === 'WAITING' && <button onClick={() => arrive.mutate(v.visitId)} className="flex-1 py-2 rounded-lg bg-blue-50 text-blue-700 text-sm font-medium">도착 확인</button>}
              {(v.stationStatus === 'ARRIVED' || v.stationStatus === 'IN_PROGRESS') && <button onClick={() => setJudgeFor(v)} className="flex-1 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium">검사 완료·판정</button>}
            </div>
          </div>
        ))}
      </main>

      {judgeFor && <JudgeSheet visit={judgeFor} stationId={station} onClose={() => setJudgeFor(null)} onDone={() => { setJudgeFor(null); qc.invalidateQueries({ queryKey: ['ck-queue', station] }); }} />}
    </div>
  );
}

function JudgeSheet({ visit, stationId, onClose, onDone }: { visit: QueueItem; stationId: string; onClose: () => void; onDone: () => void }) {
  /**
   * 🔴 판정 초기값은 **미선택**이다(2026-09-02). '정상'으로 시작하면 시트를 열고 「완료 처리」만 눌러도
   *    정상 판정이 저장되고, 서버는 이 값 하나로 위급값 알림 발신을 결정한다 —
   *    기본값이 알림을 조용히 끈다.
   */
  const [finding, setFinding] = useState<'NORMAL' | 'ABNORMAL' | 'CRITICAL' | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await apiClient.fetch(`/api/v1/checkup/ws/${visit.visitId}/complete`, { method: 'PATCH', body: JSON.stringify({ stationId, resultData: {}, finding, note }), headers: { 'Content-Type': 'application/json' } }); onDone(); }
    catch (e) { alert(e instanceof Error ? e.message : '저장 실패'); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md p-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-gray-900 mb-1">검사 완료 · {visit.patient?.familyName}{visit.patient?.givenName}</h3>
        <p className="text-xs text-gray-400 mb-3">{visit.program?.name}</p>
        {/* 🔴 판정 미선택이면 그렇게 말한다 — 아무것도 안 고른 것과 '정상'은 다른 사실이다 */}
        {!finding && <p className="text-[11px] text-amber-600 mb-1.5">판정을 선택해야 완료 처리할 수 있습니다.</p>}
        <div className="flex gap-2 mb-3">
          {(['NORMAL', 'ABNORMAL', 'CRITICAL'] as const).map((fv) => (
            <button key={fv} onClick={() => setFinding(fv)} className={`flex-1 min-h-[44px] py-2 rounded-lg text-sm font-medium ${finding === fv ? (fv === 'NORMAL' ? 'bg-emerald-600 text-white' : fv === 'ABNORMAL' ? 'bg-amber-500 text-white' : 'bg-red-600 text-white') : 'bg-gray-100 text-gray-600'}`}>
              {fv === 'NORMAL' ? '정상' : fv === 'ABNORMAL' ? '이상' : '위급'}
            </button>
          ))}
        </div>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="소견/메모(선택)" rows={3} className="w-full border rounded-lg px-2 py-1.5 text-sm" />
        <p className="text-[10px] text-gray-400 mt-1">※ 상세 수치 입력은 스테이션 단말/PC. 위급 판정 시 위급값 알림 자동 발신.</p>
        <div className="flex gap-2 mt-3">
          <button onClick={submit} disabled={busy || !finding} className="flex-1 min-h-[44px] py-2.5 rounded-xl bg-emerald-600 text-white font-medium disabled:opacity-50">{busy ? '저장 중…' : '완료 처리'}</button>
          <button onClick={onClose} className="px-4 min-h-[44px] py-2.5 rounded-xl bg-gray-100 text-gray-600">닫기</button>
        </div>
      </div>
    </div>
  );
}
