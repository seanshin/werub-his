'use client';

import { LocalChecklistNotice } from '@/components/workstation/LocalChecklistNotice';
import { kdate } from '@/lib/ui-settings';
import { useState, useMemo } from 'react';
import { StationConfigNotice } from '@/components/workstation/StationConfigNotice';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T } from '@/components/ui/i18n-text';

/* ── 타입 ── */
interface PatientRef { familyName?: string; givenName?: string; mrn?: string; dateOfBirth?: string; gender?: string }
interface WsOrder {
  orderId: string; status: string; priority?: string;
  procedureName?: string; procedureCode?: string; createdAt?: string;
  patient?: PatientRef;
  departmentName?: string; roomName?: string; bedNumber?: string;
  admitDiagnosis?: string; requestingDoctor?: string; notes?: string;
  insuranceType?: string;
}

const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  ORDERED:     { label: '대기',   cls: 'bg-gray-100 text-gray-600' },
  RECEIVED:    { label: '접수',   cls: 'bg-blue-100 text-blue-700' },
  IN_PROGRESS: { label: '진행중', cls: 'bg-amber-100 text-amber-700' },
  COMPLETED:   { label: '완료',   cls: 'bg-emerald-100 text-emerald-700' },
};

type FilterKey = 'ALL' | 'ORDERED' | 'IN_PROGRESS' | 'COMPLETED';

/* ── 입원 체크리스트 ── */
const CHECKLIST_ITEMS = [
  { key: 'identity', label: '환자 신분 확인' },
  { key: 'consent', label: '입원 동의서' },
  { key: 'insurance', label: '보험 확인' },
  { key: 'bed', label: '병실 배정' },
  { key: 'orientation', label: '병동 오리엔테이션' },
  { key: 'wristband', label: '환자 인식밴드 착용' },
];

export default function AdmissionWorkstationPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<FilterKey>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});

  const { data: queueRes, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['ws-admission-queue'],
    queryFn: () => apiClient.get<{ data: WsOrder[] }>('/api/v1/workstation/station/admission/queue'),
    refetchInterval: 8000,
  });
  const stationMeta = (queueRes as { meta?: Record<string, unknown> } | undefined)?.meta;

  const allOrders: WsOrder[] = useMemo(() => {
    const raw = queueRes?.data;
    return Array.isArray(raw) ? raw : [];
  }, [queueRes]);

  const counts = useMemo(() => ({
    ALL: allOrders.length,
    ORDERED: allOrders.filter(o => o.status === 'ORDERED').length,
    IN_PROGRESS: allOrders.filter(o => o.status === 'IN_PROGRESS' || o.status === 'RECEIVED').length,
    COMPLETED: allOrders.filter(o => o.status === 'COMPLETED').length,
  }), [allOrders]);

  const filtered = useMemo(() => {
    if (filter === 'ALL') return allOrders;
    if (filter === 'IN_PROGRESS') return allOrders.filter(o => o.status === 'IN_PROGRESS' || o.status === 'RECEIVED');
    return allOrders.filter(o => o.status === filter);
  }, [allOrders, filter]);

  const selectedOrder = allOrders.find(o => o.orderId === selectedId);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['ws-admission-queue'] });
  const receive  = useMutation({ mutationFn: (id: string) => apiClient.patch(`/api/v1/workstation/order/${id}/receive`),  onSuccess: () => { invalidate(); toast.success('접수 완료'); } });
  const start    = useMutation({ mutationFn: (id: string) => apiClient.patch(`/api/v1/workstation/order/${id}/start`),    onSuccess: () => { invalidate(); toast.success('입원 처리 시작'); } });
  const completeMut = useMutation({ mutationFn: (id: string) => apiClient.patch(`/api/v1/workstation/order/${id}/complete`), onSuccess: () => { invalidate(); toast.success('입원 처리 완료'); } });

  const stats = [
    { label: '대기', count: counts.ORDERED, cls: 'text-gray-600 bg-gray-50' },
    { label: '진행중', count: counts.IN_PROGRESS, cls: 'text-amber-700 bg-amber-50' },
    { label: '완료', count: counts.COMPLETED, cls: 'text-emerald-700 bg-emerald-50' },
  ];

  const checklistDone = CHECKLIST_ITEMS.filter(c => checklist[c.key]).length;
  const checklistTotal = CHECKLIST_ITEMS.length;

  return (
    <div className="space-y-5">
      <StationConfigNotice meta={stationMeta} />
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="입원 워크스테이션" /></h1>
          <p className="text-sm text-gray-500 mt-0.5"><T k="접수 → 동의서 → 병실배정 → 오리엔테이션" /></p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/inpatient" className="px-3 py-1.5 text-xs font-medium bg-indigo-50 text-indigo-700 rounded-lg hover:bg-indigo-100"><T k="입원 목록" /></Link>
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] text-gray-400">8s</span>
        </div>
      </div>

      {/* 통계 */}
      <div className="grid grid-cols-3 gap-3">
        {stats.map(s => (
          <div key={s.label} className={`rounded-xl p-3 ${s.cls}`}>
            <p className="text-[10px] font-medium opacity-70">{s.label}</p>
            <p className="text-2xl font-bold">{s.count}</p>
          </div>
        ))}
      </div>

      {/* 워크플로우 */}
      <div className="flex items-center gap-1 text-xs text-gray-400">
        <span className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 font-medium"><T k="접수@상태" /></span>
        <span>&rarr;</span>
        <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 font-medium"><T k="동의서" /></span>
        <span>&rarr;</span>
        <span className="px-2.5 py-1 rounded-lg bg-violet-50 text-violet-700 font-medium"><T k="병실 배정" /></span>
        <span>&rarr;</span>
        <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-medium"><T k="완료" /></span>
      </div>

      {/* 필터 */}
      <div className="flex gap-1.5">
        {([
          { key: 'ALL' as FilterKey, label: '전체' },
          { key: 'ORDERED' as FilterKey, label: '대기' },
          { key: 'IN_PROGRESS' as FilterKey, label: '진행중' },
          { key: 'COMPLETED' as FilterKey, label: '완료' },
        ]).map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              filter === f.key ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            {f.label}
            {counts[f.key] > 0 && <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${filter === f.key ? 'bg-white/20' : 'bg-gray-200'}`}>{counts[f.key]}</span>}
          </button>
        ))}
      </div>

      {/* 테이블 + 상세 */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[60px]"><T k="긴급" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[70px]"><T k="상태" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="진단" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="배정 병실" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[55px]"><T k="시간" /></th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 w-[120px]"><T k="작업" /></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-50"><td colSpan={7} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>
                ))
              ) : isError ? (
                <tr><td colSpan={7}><QueryErrorFallback error={error} onRetry={refetch} /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="py-16 text-center text-gray-400 text-sm"><T k="대기 중인 입원이 없습니다" /></td></tr>
              ) : filtered.map(o => {
                const isSelected = selectedId === o.orderId;
                return (
                  <tr key={o.orderId} onClick={() => { setSelectedId(o.orderId); setChecklist({}); }}
                    className={`border-b border-gray-50 cursor-pointer transition-colors ${isSelected ? 'bg-indigo-50' : 'hover:bg-gray-50/50'} ${o.priority === 'STAT' ? 'bg-red-50/30' : ''}`}>
                    <td className="px-4 py-3">
                      {o.priority === 'STAT' && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-600 text-white animate-pulse whitespace-nowrap">STAT</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_MAP[o.status]?.cls ?? 'bg-gray-100'}`}>
                        {STATUS_MAP[o.status]?.label ?? o.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{o.patient?.familyName}{o.patient?.givenName}</p>
                      <p className="text-[10px] text-gray-400">{o.patient?.mrn}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 truncate max-w-[150px]">
                      {o.admitDiagnosis ?? o.procedureName ?? o.procedureCode ?? '-'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {o.roomName ?? '-'}{o.bedNumber ? `-${o.bedNumber}` : ''}
                      {o.departmentName && <p className="text-[10px] text-gray-400">{o.departmentName}</p>}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 font-mono">
                      {o.createdAt ?kdate(o.createdAt, 'time') : ''}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-1 justify-end" onClick={e => e.stopPropagation()}>
                        {o.status === 'ORDERED' && <button onClick={() => receive.mutate(o.orderId)} className="min-h-[44px] px-3 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"><T k="접수@버튼" /></button>}
                        {o.status === 'RECEIVED' && <button onClick={() => start.mutate(o.orderId)} className="min-h-[44px] px-3 py-2 text-xs font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600"><T k="시작" /></button>}
                        {o.status === 'IN_PROGRESS' && <button onClick={() => completeMut.mutate(o.orderId)} className="min-h-[48px] px-3 py-3 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"><T k="완료" /></button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 상세 패널 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          {!selectedOrder ? (
            <div className="text-center py-12">
              <svg className="w-10 h-10 mx-auto text-gray-200 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 7.5h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" />
              </svg>
              <p className="text-sm text-gray-400"><T k="환자를 선택하세요" /></p>
            </div>
          ) : (
            <div className="space-y-4 max-h-[calc(100vh-280px)] overflow-y-auto">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-900"><T k="입원 상세" /></h3>
                <button onClick={() => setSelectedId(null)} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>

              {/* 환자 정보 */}
              <div className="bg-blue-50 rounded-xl p-3">
                <p className="text-xs text-blue-600 font-medium"><T k="환자" /></p>
                <p className="text-sm font-bold text-gray-900">{selectedOrder.patient?.familyName}{selectedOrder.patient?.givenName}</p>
                <p className="text-[10px] text-gray-500">MRN: {selectedOrder.patient?.mrn}</p>
                <div className="grid grid-cols-2 gap-2 text-xs mt-2">
                  <div><span className="text-gray-400"><T k="성별:" /></span> <span className="font-medium">{selectedOrder.patient?.gender === 'M' ? '남' : selectedOrder.patient?.gender === 'F' ? '여' : '-'}</span></div>
                  <div><span className="text-gray-400"><T k="생년월일:" /></span> <span className="font-medium">{selectedOrder.patient?.dateOfBirth?.split('T')[0] ?? '-'}</span></div>
                  <div><span className="text-gray-400"><T k="보험:" /></span> <span className="font-medium">{selectedOrder.insuranceType ?? '-'}</span></div>
                  <div><span className="text-gray-400"><T k="요청의:" /></span> <span className="font-medium">{selectedOrder.requestingDoctor ?? '-'}</span></div>
                </div>
              </div>

              {/* 입원 경로 */}
              <div className="bg-teal-50 rounded-xl p-3 space-y-2">
                <p className="text-xs font-semibold text-teal-700"><T k="입원 경로" /></p>
                <div className="flex gap-1 flex-wrap">
                  {['OUTPATIENT', 'EMERGENCY', 'TRANSFER', 'PLANNED'].map(route => {
                    const labels: Record<string, string> = { OUTPATIENT: '외래', EMERGENCY: '응급', TRANSFER: '전원', PLANNED: '계획' };
                    return (
                      <span key={route} className="px-2.5 py-1 text-[10px] font-medium rounded-lg bg-white text-teal-700 border border-teal-200">
                        {labels[route]}
                      </span>
                    );
                  })}
                </div>
              </div>

              {/* 입원 정보 */}
              <div className="bg-indigo-50 rounded-xl p-3 space-y-1.5">
                <p className="text-xs text-indigo-600 font-medium"><T k="입원 정보" /></p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div><span className="text-gray-400"><T k="진단:" /></span> <span className="font-medium">{selectedOrder.admitDiagnosis ?? selectedOrder.procedureName ?? '-'}</span></div>
                  <div><span className="text-gray-400"><T k="과:" /></span> <span className="font-medium">{selectedOrder.departmentName ?? '-'}</span></div>
                  <div><span className="text-gray-400"><T k="병실:" /></span> <span className="font-medium">{selectedOrder.roomName ?? '미배정'}{selectedOrder.bedNumber ? `-${selectedOrder.bedNumber}` : ''}</span></div>
                </div>
                {selectedOrder.notes && (
                  <div className="bg-white rounded-lg p-2 mt-1">
                    <p className="text-[10px] text-gray-400 mb-0.5"><T k="메모" /></p>
                    <p className="text-xs text-gray-700">{selectedOrder.notes}</p>
                  </div>
                )}
              </div>

              {/* 빈 침상 조회 바로가기 */}
              <div className="bg-sky-50 rounded-xl p-3 space-y-2">
                <p className="text-xs font-semibold text-sky-700"><T k="병실 배정" /></p>
                <Link href="/bed?status=AVAILABLE" className="block text-center px-3 py-2 text-xs font-medium bg-sky-600 text-white rounded-lg hover:bg-sky-700">
                  <T k="빈 침상 조회 / 배정" />
                </Link>
              </div>

              {/* 동의서 연동 */}
              <div className="bg-violet-50 rounded-xl p-3 space-y-1.5">
                <p className="text-xs font-semibold text-violet-700"><T k="필수 동의서" /></p>
                <div className="space-y-1">
                  {['입원 동의서', '개인정보 활용 동의서', '응급시 동의서'].map(doc => (
                    <div key={doc} className="flex items-center justify-between bg-white rounded-lg px-3 py-2">
                      <span className="text-xs text-gray-700">{doc}</span>
                      <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 whitespace-nowrap"><T k="미서명" /></span>
                    </div>
                  ))}
                </div>
              </div>

              {/* 입원 체크리스트 */}
              <div className="bg-violet-50 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-violet-700"><T k="입원 체크리스트" /></p>
                  <span className="text-[10px] font-medium text-violet-600">{checklistDone}/{checklistTotal}</span>
                </div>
                <div className="w-full bg-violet-200 rounded-full h-1.5">
                  <div className="bg-violet-600 h-1.5 rounded-full transition-all" style={{ width: `${(checklistDone / checklistTotal) * 100}%` }} />
                </div>
                <div className="space-y-1">
                  <LocalChecklistNotice className="mb-1.5" />
                  {CHECKLIST_ITEMS.map(item => (
                    <label key={item.key} className="flex items-center gap-2 cursor-pointer group">
                      <input type="checkbox" checked={!!checklist[item.key]}
                        onChange={e => setChecklist(prev => ({ ...prev, [item.key]: e.target.checked }))}
                        className="w-3.5 h-3.5 rounded border-violet-300 text-violet-600 focus:ring-violet-500" />
                      <span className={`text-xs transition-colors ${checklist[item.key] ? 'text-violet-400 line-through' : 'text-gray-700 group-hover:text-violet-700'}`}>
                        {item.label}
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* 액션 버튼 */}
              <div className="flex gap-2 pt-2 border-t border-gray-100">
                {selectedOrder.status === 'ORDERED' && (
                  <button onClick={() => receive.mutate(selectedOrder.orderId)} className="flex-1 min-h-[44px] px-3 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"><T k="접수@버튼" /></button>
                )}
                {selectedOrder.status === 'RECEIVED' && (
                  <button onClick={() => start.mutate(selectedOrder.orderId)} className="flex-1 min-h-[44px] px-3 py-2 text-xs font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600"><T k="입원 처리 시작" /></button>
                )}
                {selectedOrder.status === 'IN_PROGRESS' && (
                  <button onClick={() => completeMut.mutate(selectedOrder.orderId)}
                    disabled={false} /* 🔴 가짜 게이트 제거 — 서버에 남지 않는 체크로 업무를 막지 않는다 */
                    className="flex-1 min-h-[48px] py-3 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed">
                    {`입원 처리 완료`}{checklistDone < checklistTotal ? ` (확인 ${checklistDone}/${checklistTotal})` : ''}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
