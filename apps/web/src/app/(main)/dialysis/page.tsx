'use client';

import { useState } from 'react';
import { Unit, Duration } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { pollMs, kdate } from '@/lib/ui-settings';
import { T, Data, useTAttr } from '@/components/ui/i18n-text';
import { formatNum } from '@hospital-run/shared';
import { dialysisElapsedMinutes, dialysisMachineName, excessOverDryWeight } from '@/lib/dialysis-session';

// 🔴 운영 DB 의 shift 는 한 체계가 아니다 — 실측 `AM 9·PM 9·A 6·B 6·C 6`(총 36).
//    화면이 AM/PM/EVE 로만 버킷을 만들어 **18건(절반)이 어느 카드에도 안 뜨고**,
//    sessions.length!==0 이라 빈 상태 안내도 안 나왔다(2026-08-13 W4).
//    A/B/C 는 1·2·3부 표기로 통용되므로 라벨을 준다. 그 밖의 값은 버리지 않고 '기타'로 모은다.
const SHIFT_LABEL: Record<string, string> = { AM: '오전', PM: '오후', EVE: '야간', A: '1부', B: '2부', C: '3부' };
// 라벨 맵 값은 i18n 키 — CANCELLED 는 무문맥 `취소`(=버튼 Cancel)가 이기므로 상태 문맥 키로
const SESSION_STATUS: Record<string, string> = { SCHEDULED: '예정', IN_PROGRESS: '진행중', COMPLETED: '완료', CANCELLED: '취소@상태' };
const SESSION_COLOR: Record<string, string> = { SCHEDULED: 'bg-indigo-100 text-indigo-700', IN_PROGRESS: 'bg-emerald-100 text-emerald-700', COMPLETED: 'bg-blue-100 text-blue-700', CANCELLED: 'bg-gray-200 text-gray-600' };
// 🔴 투석기 상태는 의도적 미배선 — 무문맥 `가용`(ja 空床=빈 병상)·`사용중`(en Occupied)이 **병상 어휘**로 등재돼 있어
//    장비에 그대로 쓰면 뜻이 틀린 번역이 나간다. `@장비` 문맥 키 신설은 추가 언어 팩(zh·th 등)에 결손을 만든다(팩과 함께 할 일).
// 🔴 `사용중@장비` — 맨 `사용중` 은 앞 카탈로그에서 'Occupied'(병상)다. 투석기는 'In use'. 나머지 셋은 장비에도 뜻이 같아 맨 키를 쓴다.
const MACHINE_STATUS: Record<string, string> = { AVAILABLE: '가용', IN_USE: '사용중@장비', MAINTENANCE: '점검중', OUT_OF_SERVICE: '사용불가' };
const MACHINE_COLOR: Record<string, string> = { AVAILABLE: 'bg-emerald-100 text-emerald-700', IN_USE: 'bg-blue-100 text-blue-700', MAINTENANCE: 'bg-amber-100 text-amber-700', OUT_OF_SERVICE: 'bg-red-100 text-red-700' };

type DialysisTab = 'sessions' | 'machines' | 'orders';

export default function DialysisPage() {
  const qc = useQueryClient();
  const tAttr = useTAttr();
  const [tab, setTab] = useState<DialysisTab>('sessions');
  const [startTarget, setStartTarget] = useState<any>(null);
  const [startForm, setStartForm] = useState({ preWeight: '', preBp: '', preHr: '', preTemp: '' });
  const [completeTarget, setCompleteTarget] = useState<any>(null);
  const [completeForm, setCompleteForm] = useState({ postWeight: '', postBp: '', postHr: '', postTemp: '', ktV: '', notes: '' });

  const startSession = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => apiClient.patch(`/api/v1/dialysis/sessions/${id}/start`, body),
    onSuccess: () => { toast.success(tAttr('투석 시작')); qc.invalidateQueries({ queryKey: ['dialysis-sessions'] }); setStartTarget(null); },
    onError: () => toast.error(tAttr('투석 시작 실패')),
  });

  const completeSession = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) => apiClient.patch(`/api/v1/dialysis/sessions/${id}/complete`, body),
    onSuccess: () => { toast.success(tAttr('투석 완료')); qc.invalidateQueries({ queryKey: ['dialysis-sessions'] }); setCompleteTarget(null); },
    onError: () => toast.error(tAttr('투석 완료 실패')),
  });

  const { data: sessionsData, isLoading: sessionsLoading, isError, error, refetch: refetchSessions } = useQuery({
    queryKey: ['dialysis-sessions'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>('/api/v1/dialysis/sessions'),
    enabled: tab === 'sessions',
    refetchInterval: pollMs('fast'),
  });

  const { data: machinesData, isLoading: machinesLoading, isError: machinesIsError, error: machinesError, refetch: refetchMachines } = useQuery({
    queryKey: ['dialysis-machines'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>('/api/v1/dialysis/machines'),
    enabled: tab === 'machines',
  });

  const { data: ordersData, isLoading: ordersLoading, isError: ordersIsError, error: ordersError, refetch: refetchOrders } = useQuery({
    queryKey: ['dialysis-orders'],
    queryFn: () => apiClient.get<{ data: Record<string, unknown>[] }>('/api/v1/dialysis/orders'),
    enabled: tab === 'orders',
  });

  if (isError) return <QueryErrorFallback error={error} onRetry={refetchSessions} />;

  const sessions: Record<string, unknown>[] = (() => { const r = sessionsData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const machines: Record<string, unknown>[] = (() => { const r = machinesData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();
  const orders: Record<string, unknown>[] = (() => { const r = ordersData?.data; return Array.isArray(r) ? r : (r as Record<string, unknown> | undefined)?.data as Record<string, unknown>[] ?? []; })();

  // 알려진 순서를 먼저, 실제 존재하는 그 밖의 값은 뒤에 — 세션이 화면에서 사라지지 않게 한다
  const KNOWN_SHIFTS = ['AM', 'PM', 'EVE', 'A', 'B', 'C'];
  const presentShifts = [...new Set(sessions.map(s => String(s.shift ?? '')).filter(Boolean))];
  const shiftOrder = [...KNOWN_SHIFTS.filter(k => presentShifts.includes(k)), ...presentShifts.filter(p => !KNOWN_SHIFTS.includes(p))];
  const unshifted = sessions.filter(s => !s.shift);
  const sessionsByShift = [
    ...shiftOrder.map(shift => ({
      shift,
      label: SHIFT_LABEL[shift] ?? shift,
      items: sessions.filter(s => (s.shift as string) === shift),
    })),
    ...(unshifted.length > 0 ? [{ shift: 'UNSPECIFIED', label: '시간대 미지정', items: unshifted }] : []),
  ];

  const LoadingRows = ({ cols }: { cols: number }) => (
    <>{Array.from({ length: 5 }).map((_, i) => <tr key={i}><td colSpan={cols} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)}</>
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-2xl font-bold text-gray-900"><T k="투석실" /></h2>
          <p className="text-sm text-gray-500 mt-1"><T k="투석 세션 / 투석기 관리 / 환자 처방" /></p>
        </div>
      </div>

      <div className="flex gap-1 mb-5 bg-gray-100/80 p-1 rounded-xl w-fit">
        {([
          { key: 'sessions' as DialysisTab, label: '투석현황' },
          { key: 'machines' as DialysisTab, label: '투석기관리' },
          { key: 'orders' as DialysisTab, label: '환자처방' },
        ]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}><T k={t.label} /></button>
        ))}
      </div>

      {/* 투석현황 - Shift-based cards */}
      {tab === 'sessions' && (
        <div className="space-y-4">
          {sessionsLoading ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
              <div className="space-y-3">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />)}</div>
            </div>
          ) : sessions.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm py-12 text-center text-gray-400"><T k="오늘 투석 세션 없음" /></div>
          ) : (
            sessionsByShift.map(({ shift, label, items }) => (
              <div key={shift} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="text-sm font-bold text-gray-900"><T k={label} /> ({shift})</h3>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 whitespace-nowrap">{items.length}<Unit>명</Unit></span>
                </div>
                {items.length === 0 ? (
                  <p className="text-xs text-gray-400 py-4 text-center"><T k="해당 시간대 세션 없음" /></p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                    {items.map((s) => {
                      const order = s.order as Record<string, unknown> | undefined;
                      const patient = (order?.patient ?? s.patient) as Record<string, unknown> | undefined;
                      const status = s.status as string;
                      const elapsed = dialysisElapsedMinutes(s.startTime);
                      const excess = excessOverDryWeight(s.preWeight, order?.dryWeight);
                      const duration = (order?.duration ?? s.durationMinutes) as number | undefined;
                      return (
                        <div key={s.id as string} className={`rounded-xl border p-3 ${status === 'IN_PROGRESS' ? 'border-emerald-200 bg-emerald-50/30' : 'border-gray-100'}`}>
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-bold text-gray-500">{dialysisMachineName(s) ?? <T k="기계 미배정" />}</span>
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${SESSION_COLOR[status] ?? 'bg-gray-100'}`}><T k={SESSION_STATUS[status] ?? status} /></span>
                          </div>
                          <p className="font-medium text-gray-900 text-sm">{(patient?.familyName as string) ?? ''}{(patient?.givenName as string) ?? ''}</p>
                          <p className="text-[10px] text-gray-400 mb-2">{(patient?.mrn as string) ?? ''}</p>
                          <div className="grid grid-cols-2 gap-1 text-[10px]">
                            <div><span className="text-gray-400">BFR</span> <span className="font-medium text-gray-700">{order?.bloodFlowRate != null ? `${order.bloodFlowRate as number}mL/min` : '-'}</span></div>
                            {/* 🔴 `ufGoal` 은 **mL** 다(DTO·실측 2000~3000). 종전 `L` 표기는 1000배 과대 —
                                "2000L 제수"는 임상적으로 불가능한 값이다. */}
                            <div><span className="text-gray-400">UF</span> <span className="font-medium text-gray-700">
                              {((order?.ufGoal as number) ?? (s.ufGoal as number)) != null
                                ? `${(order?.ufGoal as number) ?? (s.ufGoal as number)}mL` : <T k="미설정" />}
                            </span></div>
                            <div><span className="text-gray-400"><T k="건체중" /></span> <span className="font-medium text-gray-700">{order?.dryWeight != null ? formatNum(Number(order.dryWeight), 'weight') : '-'}</span></div>
                            <div data-dialysis-excess><span className="text-gray-400"><T k="건체중 초과" /></span> <span className="font-medium text-gray-700">{excess != null ? `${excess > 0 ? '+' : ''}${formatNum(excess, 'weight')}` : '-'}</span></div>
                            <div className="col-span-2"><span className="text-gray-400"><T k="다이얼라이저" /></span> <span className="font-medium text-gray-700">{(order?.dialyzerType as string | null) ?? '-'}</span></div>
                          </div>
                          {status === 'IN_PROGRESS' && elapsed != null && duration != null && (
                            <div className="mt-2">
                              <div className="flex justify-between text-[10px] text-gray-500 mb-0.5">
                                <span><T k="경과" /></span>
                                <span><Duration minutes={elapsed} /> / {duration}<Unit>분</Unit></span>
                              </div>
                              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.min(100, Math.round((elapsed / duration) * 100))}%` }} />
                              </div>
                            </div>
                          )}
                          {/* 시작/완료 버튼 */}
                          <div className="flex gap-1 mt-2">
                            {status === 'SCHEDULED' && (
                              <button onClick={() => { setStartTarget(s); setStartForm({ preWeight: '', preBp: '', preHr: '', preTemp: '' }); }}
                                className="flex-1 py-1.5 text-[10px] font-bold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"><T k="투석 시작" /></button>
                            )}
                            {status === 'IN_PROGRESS' && (
                              <button onClick={() => { setCompleteTarget(s); setCompleteForm({ postWeight: '', postBp: '', postHr: '', postTemp: '', ktV: '', notes: '' }); }}
                                className="flex-1 py-1.5 text-[10px] font-bold bg-blue-600 text-white rounded-lg hover:bg-blue-700"><T k="투석 완료" /></button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* 투석기관리 */}
      {tab === 'machines' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="장비명" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[100px]"><T k="모델" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="유형" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[100px]"><T k="위치" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="상태" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[100px]"><T k="최종 소독" /></th>
            </tr></thead>
            <tbody>
              {machinesIsError ? <tr><td colSpan={6} className="px-4 py-3"><QueryErrorFallback error={machinesError} onRetry={refetchMachines} size="compact" /></td></tr>
              : machinesLoading ? <LoadingRows cols={6} />
              : machines.length === 0 ? <tr><td colSpan={6} className="py-12 text-center text-gray-400"><T k="투석기 정보 없음" /></td></tr>
              : machines.map((m) => (
                <tr key={m.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                  <td className="px-4 py-3 font-medium text-gray-900">{(m.name as string) ?? '-'}</td>
                  <td className="px-4 py-3 text-xs text-gray-700">{(m.model as string) ?? '-'}</td>
                  <td className="px-4 py-3"><span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 whitespace-nowrap">{(m.type as string) ?? '-'}</span></td>
                  <td className="px-4 py-3 text-xs text-gray-500">{(m.location as string) ?? '-'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${MACHINE_COLOR[m.status as string] ?? 'bg-gray-100'}`}>{MACHINE_STATUS[m.status as string] ? <T k={MACHINE_STATUS[m.status as string]} /> : <Data>{m.status as string}</Data>}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{(m.lastDisinfection as string) ? kdate(m.lastDisinfection as string, 'datetimeShort') : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 환자처방 */}
      {tab === 'orders' && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="투석 방식" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="빈도" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[100px]"><T k="투석막" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]">BFR</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="건체중" /></th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="혈관접근" /></th>
            </tr></thead>
            <tbody>
              {ordersIsError ? <tr><td colSpan={7} className="px-4 py-3"><QueryErrorFallback error={ordersError} onRetry={refetchOrders} size="compact" /></td></tr>
              : ordersLoading ? <LoadingRows cols={7} />
              : orders.length === 0 ? <tr><td colSpan={7} className="py-12 text-center text-gray-400"><T k="투석 처방 없음" /></td></tr>
              : orders.map((o) => {
                const patient = o.patient as Record<string, unknown> | undefined;
                return (
                  <tr key={o.id as string} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{(patient?.familyName as string) ?? ''}{(patient?.givenName as string) ?? ''}</p>
                      <p className="text-[10px] text-gray-400">{(patient?.mrn as string) ?? ''}</p>
                    </td>
                    <td className="px-4 py-3"><span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 whitespace-nowrap">{(o.modality as string) ?? '-'}</span></td>
                    <td className="px-4 py-3 text-xs text-gray-700">{(o.frequency as string) ?? '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-700">{(o.dialyzerType as string | null) ?? '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-700">{o.bloodFlowRate != null ? `${o.bloodFlowRate as number}mL/min` : '-'}</td>
                    <td className="px-4 py-3 text-xs text-gray-700">{(o.dryWeight as number) ?? '-'}<Unit>kg</Unit></td>
                    <td className="px-4 py-3"><span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 whitespace-nowrap">{(o.accessType as string) ?? '-'}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 투석 시작 모달 */}
      {startTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setStartTarget(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-gray-900"><T k="투석 시작 — 전(Pre) 활력징후" /></h3>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="체중 (kg)" /></label>
                <input value={startForm.preWeight} onChange={e => setStartForm(f => ({ ...f, preWeight: e.target.value }))} type="number" step="0.1" className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="혈압 (BP)" /></label>
                <input value={startForm.preBp} onChange={e => setStartForm(f => ({ ...f, preBp: e.target.value }))} placeholder="140/85" className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="심박수 (HR)" /></label>
                <input value={startForm.preHr} onChange={e => setStartForm(f => ({ ...f, preHr: e.target.value }))} type="number" placeholder={tAttr('회/분')} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="체온 (BT)" /></label>
                <input value={startForm.preTemp} onChange={e => setStartForm(f => ({ ...f, preTemp: e.target.value }))} type="number" step="0.1" className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => startSession.mutate({ id: startTarget.id, body: {
                preWeight: Number(startForm.preWeight) || undefined, preBp: startForm.preBp || undefined,
                preHr: Number(startForm.preHr) || undefined, preTemp: Number(startForm.preTemp) || undefined,
              } })} disabled={startSession.isPending}
                className="flex-1 py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-xl hover:bg-emerald-700 disabled:opacity-50">
                <T k={startSession.isPending ? '시작 중...' : '투석 시작'} /></button>
              <button onClick={() => setStartTarget(null)} className="px-4 py-2.5 bg-gray-100 text-gray-600 text-sm rounded-xl"><T k="취소" /></button>
            </div>
          </div>
        </div>
      )}

      {/* 투석 완료 모달 */}
      {completeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setCompleteTarget(null)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-gray-900"><T k="투석 완료 — 후(Post) 활력징후" /></h3>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="체중 (kg)" /></label>
                <input value={completeForm.postWeight} onChange={e => setCompleteForm(f => ({ ...f, postWeight: e.target.value }))} type="number" step="0.1" className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="혈압 (BP)" /></label>
                <input value={completeForm.postBp} onChange={e => setCompleteForm(f => ({ ...f, postBp: e.target.value }))} placeholder="125/75" className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="심박수 (HR)" /></label>
                <input value={completeForm.postHr} onChange={e => setCompleteForm(f => ({ ...f, postHr: e.target.value }))} type="number" placeholder={tAttr('회/분')} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="체온 (BT)" /></label>
                <input value={completeForm.postTemp} onChange={e => setCompleteForm(f => ({ ...f, postTemp: e.target.value }))} type="number" step="0.1" className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1">Kt/V</label>
                <input value={completeForm.ktV} onChange={e => setCompleteForm(f => ({ ...f, ktV: e.target.value }))} type="number" step="0.01" className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
            </div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1"><T k="비고" /></label>
              <textarea value={completeForm.notes} onChange={e => setCompleteForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder={tAttr('특이사항...')} className="w-full border rounded-xl px-3 py-2 text-sm" /></div>
            <div className="flex gap-2">
              <button onClick={() => completeSession.mutate({ id: completeTarget.id, body: {
                postWeight: Number(completeForm.postWeight) || undefined, postBp: completeForm.postBp || undefined,
                postHr: Number(completeForm.postHr) || undefined, postTemp: Number(completeForm.postTemp) || undefined,
                ktV: Number(completeForm.ktV) || undefined, notes: completeForm.notes || undefined,
              } })} disabled={completeSession.isPending}
                className="flex-1 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50">
                <T k={completeSession.isPending ? '저장 중...' : '투석 완료'} /></button>
              <button onClick={() => setCompleteTarget(null)} className="px-4 py-2.5 bg-gray-100 text-gray-600 text-sm rounded-xl"><T k="취소" /></button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
