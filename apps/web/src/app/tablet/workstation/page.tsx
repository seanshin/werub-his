'use client';

import { useEffect, useState } from 'react';
import { Unit } from '@/components/ui/display';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { useAuthStore } from '@/stores/auth-store';

interface Order {
  orderId: string; status: string; priority?: string; procedureCode?: string; procedureName?: string;
  patient?: { mrn?: string; familyName?: string; givenName?: string; gender?: string; age?: number };
  receivedAt?: string; startedAt?: string;
}
interface ResultItem { name: string; value: string; unit?: string; refRange?: string; finding?: string }

const STATIONS = [
  { id: 'lab-phlebotomy', label: '채혈실', icon: '🩸', kind: 'lab' },
  { id: 'lab-hematology', label: '혈액검사', icon: '🔬', kind: 'lab' },
  { id: 'lab-chemistry', label: '생화학', icon: '⚗️', kind: 'lab' },
  { id: 'lab-urinalysis', label: '소변검사', icon: '🧪', kind: 'lab' },
  { id: 'imaging-xray', label: 'X-ray', icon: '🩻', kind: 'imaging' },
  { id: 'imaging-ct', label: 'CT', icon: '🖥', kind: 'imaging' },
];
const STATUS: Record<string, { label: string; cls: string }> = {
  ORDERED: { label: '대기', cls: 'bg-gray-100 text-gray-600' },
  RECEIVED: { label: '접수', cls: 'bg-blue-100 text-blue-700' },
  IN_PROGRESS: { label: '진행중', cls: 'bg-amber-100 text-amber-700' },
  COMPLETED: { label: '완료', cls: 'bg-emerald-100 text-emerald-700' },
};
/** 참고범위를 숫자 구간으로 읽을 수 있는가 — 읽지 못하면 자동 제안을 하지 않는다(모르면 미판정) */
const canJudgeRange = (refRange?: string): boolean =>
  !!refRange && /(\d+\.?\d*)\s*[-~]\s*(\d+\.?\d*)/.test(refRange);

const outOfRange = (value: string, refRange?: string): boolean => {
  if (!refRange) return false;
  const m = refRange.match(/(\d+\.?\d*)\s*[-~]\s*(\d+\.?\d*)/);
  const v = parseFloat(value);
  if (!m || Number.isNaN(v)) return false;
  return v < parseFloat(m[1]) || v > parseFloat(m[2]);
};

export default function TabletWorkstationPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { user, isAuthenticated, loadProfile } = useAuthStore();
  const [ready, setReady] = useState(false);
  const [station, setStation] = useState('lab-hematology');
  const [resultFor, setResultFor] = useState<Order | null>(null);

  useEffect(() => {
    (async () => {
      if (!isAuthenticated) { router.replace('/staff/login'); return; }
      if (!user) { try { await loadProfile(); } catch { router.replace('/staff/login'); return; } }
      setReady(true);
    })();
  }, [isAuthenticated, user, loadProfile, router]);

  const q = useQuery({
    queryKey: ['ws-queue', station],
    queryFn: () => apiClient.get<{ data: Order[] }>(`/api/v1/workstation/station/${station}/queue`).then((r) => r.data),
    enabled: ready,
    refetchInterval: 8000,
  });
  const act = useMutation({
    mutationFn: ({ orderId, action }: { orderId: string; action: 'receive' | 'start' }) => apiClient.fetch(`/api/v1/workstation/order/${orderId}/${action}`, { method: 'PATCH' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ws-queue', station] }),
  });

  if (!ready) return <div className="min-h-screen flex items-center justify-center text-gray-400">로딩 중…</div>;
  const kind = STATIONS.find((s) => s.id === station)?.kind;
  const list = q.data ?? [];

  return (
    <div className="min-h-[100dvh] bg-gray-100">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="px-3 py-2.5 flex items-center gap-2">
          <button onClick={() => router.push('/staff')} aria-label="내부포털로" className="p-1 rounded-lg hover:bg-gray-100">
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <span className="font-bold text-gray-800">워크스테이션</span>
          <span className="ml-auto text-xs text-gray-400">{q.isError ? '조회 실패' : <>{list.length}<Unit>건</Unit></>}</span>
        </div>
        <div className="px-2 pb-2 flex gap-1.5 overflow-x-auto">
          {STATIONS.map((s) => (
            <button key={s.id} onClick={() => setStation(s.id)} className={`flex-shrink-0 px-3 py-1.5 rounded-full text-sm whitespace-nowrap ${station === s.id ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600'}`}>
              {s.icon} {s.label}
            </button>
          ))}
        </div>
      </header>

      <main className="p-3 space-y-2">
        {q.isError && <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} />}
        {!q.isError && list.length === 0 && <p className="text-center text-gray-400 text-sm py-10">대기 중인 오더가 없습니다.</p>}
        {!q.isError && list.map((o) => (
          <div key={o.orderId} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  {o.priority === 'STAT' && <span className="text-[10px] font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">STAT</span>}
                  <span className="font-semibold text-gray-800 truncate">{o.patient?.familyName}{o.patient?.givenName}</span>
                  <span className="text-xs text-gray-400">{o.patient?.gender === 'MALE' ? 'M' : o.patient?.gender === 'FEMALE' ? 'F' : ''}{o.patient?.age ? `/${o.patient.age}` : ''}</span>
                </div>
                <p className="text-xs text-gray-500 truncate">{o.procedureName ?? o.procedureCode} · {o.patient?.mrn}</p>
              </div>
              <span className={`flex-shrink-0 text-[11px] px-2 py-0.5 rounded-full ${STATUS[o.status]?.cls ?? 'bg-gray-100'}`}>{STATUS[o.status]?.label ?? o.status}</span>
            </div>
            <div className="mt-2 flex gap-2">
              {o.status === 'ORDERED' && <button onClick={() => act.mutate({ orderId: o.orderId, action: 'receive' })} className="flex-1 py-2 rounded-lg bg-blue-50 text-blue-700 text-sm font-medium">접수</button>}
              {o.status === 'RECEIVED' && <button onClick={() => act.mutate({ orderId: o.orderId, action: 'start' })} className="flex-1 py-2 rounded-lg bg-amber-50 text-amber-700 text-sm font-medium">검사 시작</button>}
              {o.status === 'IN_PROGRESS' && kind === 'lab' && <button onClick={() => setResultFor(o)} className="flex-1 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium">결과 입력</button>}
              {o.status === 'IN_PROGRESS' && kind === 'imaging' && <button onClick={() => setResultFor(o)} className="flex-1 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium">촬영 완료</button>}
            </div>
          </div>
        ))}
      </main>

      {resultFor && kind === 'lab' && <LabResultSheet order={resultFor} onClose={() => setResultFor(null)} onDone={() => { setResultFor(null); qc.invalidateQueries({ queryKey: ['ws-queue', station] }); }} />}
      {resultFor && kind === 'imaging' && <ImagingSheet order={resultFor} onClose={() => setResultFor(null)} onDone={() => { setResultFor(null); qc.invalidateQueries({ queryKey: ['ws-queue', station] }); }} />}
    </div>
  );
}

function LabResultSheet({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => void }) {
  const [items, setItems] = useState<ResultItem[]>([{ name: '', value: '', unit: '', refRange: '' }]);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    /**
     * 🔴 종전엔 `finding` 을 **자동 산정**해 `ABNORMAL|NORMAL` 둘만 보냈다(2026-09-02).
     *    ① 서버는 `finding === 'CRITICAL'` 인 항목만 위급값 통보(IPSG.2)로 보내는데 **고를 화면이 없었고**,
     *    ② `outOfRange` 는 참고범위 미상·비수치를 무조건 `false` 로 떨어뜨려
     *       **모르는 값을 '정상'이라고 원장에 적었다.**
     *    이제 검사자가 고른 판정을 그대로 보내고, 미판정이면 저장하지 않는다.
     */
    const entered = items.filter((i) => i.name && i.value);
    const unjudged = entered.filter((i) => !i.finding).map((i) => i.name);
    if (unjudged.length) { alert(`판정하지 않은 항목: ${unjudged.join(' · ')}\n정상/이상/위급을 선택해야 저장됩니다.`); return; }
    const valid = entered;
    if (!valid.length) return;
    setBusy(true);
    try { await apiClient.post(`/api/v1/workstation/lab/${order.orderId}/results`, { items: valid }); onDone(); }
    catch (e) { alert(e instanceof Error ? e.message : '저장 실패'); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md p-4 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-gray-900 mb-1">결과 입력 · {order.patient?.familyName}{order.patient?.givenName}</h3>
        <p className="text-xs text-gray-400 mb-3">{order.procedureName}</p>
        <div className="space-y-2">
          {items.map((it, i) => {
            const abn = outOfRange(it.value, it.refRange);
            return (
              <div key={i} className="grid grid-cols-12 gap-1.5">
                <input className="col-span-4 min-h-[44px] border rounded-lg px-2 py-1.5 text-sm" placeholder="항목" value={it.name} onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
                <input
                  className={`col-span-3 min-h-[44px] border rounded-lg px-2 py-1.5 text-sm ${abn ? 'border-red-400 text-red-600' : ''}`}
                  placeholder="값" value={it.value}
                  onChange={(e) => setItems(items.map((x, j) => {
                    if (j !== i) return x;
                    const next = { ...x, value: e.target.value };
                    // 자동 **제안** — 읽을 수 있는 범위일 때만, 이미 고른 '위급'은 덮지 않는다
                    if (canJudgeRange(next.refRange) && next.finding !== 'CRITICAL') {
                      next.finding = outOfRange(next.value, next.refRange) ? 'ABNORMAL' : 'NORMAL';
                    }
                    return next;
                  }))} />
                <input className="col-span-2 min-h-[44px] border rounded-lg px-2 py-1.5 text-sm" placeholder="단위" value={it.unit} onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, unit: e.target.value } : x))} />
                <input className="col-span-3 min-h-[44px] border rounded-lg px-2 py-1.5 text-sm" placeholder="참고범위" value={it.refRange} onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, refRange: e.target.value } : x))} />
                {/* 🔴 검사자가 '위급'을 고를 수 있어야 위급값 통보가 발동한다 */}
                <select
                  aria-label={`${it.name || '항목'} 판정`}
                  className={`col-span-12 min-h-[44px] border rounded-lg px-2 py-1.5 text-sm font-medium ${
                    it.finding === 'CRITICAL' ? 'text-red-600 border-red-300' : it.finding === 'ABNORMAL' ? 'text-amber-600 border-amber-300' : it.finding === 'NORMAL' ? 'text-emerald-600' : 'text-gray-400'
                  }`}
                  value={it.finding ?? ''}
                  onChange={(e) => setItems(items.map((x, j) => j === i ? { ...x, finding: e.target.value } : x))}
                >
                  <option value="">판정 — 미선택</option>
                  <option value="NORMAL">정상</option>
                  <option value="ABNORMAL">이상</option>
                  <option value="CRITICAL">위급 — 즉시 통보</option>
                </select>
              </div>
            );
          })}
        </div>
        <button onClick={() => setItems([...items, { name: '', value: '', unit: '', refRange: '' }])} className="mt-2 text-xs text-blue-600">+ 항목 추가</button>
        <div className="flex gap-2 mt-4">
          <button onClick={submit} disabled={busy} className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white font-medium disabled:opacity-50">{busy ? '저장 중…' : '결과 저장·완료'}</button>
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl bg-gray-100 text-gray-600">닫기</button>
        </div>
      </div>
    </div>
  );
}

function ImagingSheet({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => void }) {
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await apiClient.fetch(`/api/v1/workstation/imaging/${order.orderId}/acquired`, { method: 'PATCH', body: JSON.stringify({ notes }), headers: { 'Content-Type': 'application/json' } }); onDone(); }
    catch (e) { alert(e instanceof Error ? e.message : '저장 실패'); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-white rounded-t-3xl sm:rounded-2xl w-full sm:max-w-md p-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-bold text-gray-900 mb-1">촬영 완료 · {order.patient?.familyName}{order.patient?.givenName}</h3>
        <p className="text-xs text-gray-400 mb-3">{order.procedureName}</p>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="촬영 메모(선택)" rows={3} className="w-full border rounded-lg px-2 py-1.5 text-sm" />
        <div className="flex gap-2 mt-3">
          <button onClick={submit} disabled={busy} className="flex-1 py-2.5 rounded-xl bg-emerald-600 text-white font-medium disabled:opacity-50">{busy ? '저장 중…' : '촬영 완료(판독 대기로)'}</button>
          <button onClick={onClose} className="px-4 py-2.5 rounded-xl bg-gray-100 text-gray-600">닫기</button>
        </div>
      </div>
    </div>
  );
}
