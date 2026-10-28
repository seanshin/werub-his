'use client';

import { LocalChecklistNotice } from '@/components/workstation/LocalChecklistNotice';
import { useState, useMemo } from 'react';
import { StationConfigNotice } from '@/components/workstation/StationConfigNotice';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { useAuthStore } from '@/stores/auth-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { pollMs, kdate } from '@/lib/ui-settings';
import { bloodTypeText } from '@hospital-run/shared';
import { T } from '@/components/ui/i18n-text';

/* ── 타입 ── */
interface PatientRef { familyName?: string; givenName?: string; mrn?: string; birthDate?: string; gender?: string }
interface WsOrder {
  orderId: string;
  status: string;
  priority?: string;
  procedureName?: string;
  procedureCode?: string;
  createdAt?: string;
  patient?: PatientRef;
  bloodType?: string;
  productType?: string;
  unitNumber?: string;
  crossmatchResult?: string;
  crossmatchStatus?: string;
  units?: number;
  requestedBy?: string;
}

/* ── 상수 ── */
/**
 * 🔴 label 은 표시 문자열이 아니라 **t() 키**다(유일 소비처가 `<T k=…>` — ko 렌더는 `@문맥` 이 잘려 동일).
 *    '접수'는 nav 의 Reception(창구), '취소'는 common 의 Cancel(버튼)이 선점한다 — 상태 어휘는 문맥 키로 가른다.
 */
const STATUS_MAP: Record<string, { label: string; cls: string }> = {
  ORDERED:     { label: '접수대기', cls: 'bg-gray-100 text-gray-600' },
  RECEIVED:    { label: '접수@상태', cls: 'bg-blue-100 text-blue-700' },
  IN_PROGRESS: { label: '교차시험', cls: 'bg-amber-100 text-amber-700' },
  DISPENSED:   { label: '혈액배정', cls: 'bg-red-100 text-red-700' },
  COMPLETED:   { label: '완료',     cls: 'bg-emerald-100 text-emerald-700' },
  CANCELLED:   { label: '취소@상태', cls: 'bg-gray-200 text-gray-500' },
};

const PRIORITY_CLS: Record<string, string> = {
  STAT:   'bg-red-600 text-white',
  URGENT: 'bg-orange-500 text-white',
  PRN:    'bg-violet-500 text-white',
};

const CROSSMATCH_CLS: Record<string, string> = {
  COMPATIBLE:   'text-emerald-700 bg-emerald-50',
  INCOMPATIBLE: 'text-red-700 bg-red-50',
  PENDING:      'text-amber-700 bg-amber-50',
};

type FilterKey = 'ALL' | 'ORDERED' | 'IN_PROGRESS' | 'DISPENSED' | 'COMPLETED';

// 수혈 체크리스트 폴백 — 정본은 간호 체크리스트 템플릿 마스터(TRANSFUSION·§7 P2 편입, 위원회 개정 표면)
const CHECKLIST_FALLBACK = [
  '환자 확인 (이름/생년월일)',
  '혈액형 확인 (ABO/Rh)',
  '교차시험 결과 확인',
  '라벨 정보 확인',
  '수혈 동의서 확인',
];

export default function BloodBankWorkstationPage() {
  // 템플릿 마스터(TRANSFUSION) 우선 — 실패/미등재면 폴백(화면은 항상 산다)
  const { data: tplRes, isError: tplIsError, error: tplError, refetch: refetchTpl } = useQuery({
    queryKey: ['nursing-checklist-templates'],
    queryFn: () => apiClient.get<{ data: { code: string; items: unknown }[] }>('/api/v1/nursing/checklist-templates'),
    staleTime: 300_000,
  });
  const tplRows = (Array.isArray(tplRes?.data) ? tplRes?.data : (tplRes?.data as { data?: { code: string; items: unknown }[] } | undefined)?.data) ?? [];
  const tplItems = tplRows.find((t) => t.code === 'TRANSFUSION')?.items;
  const CHECKLIST_ITEMS = Array.isArray(tplItems) && tplItems.length && tplItems.every((i) => typeof i === 'string')
    ? (tplItems as string[]) : CHECKLIST_FALLBACK;
  const qc = useQueryClient();
  const [filter, setFilter] = useState<FilterKey>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checklist, setChecklist] = useState<Record<number, boolean>>({});

  /* ── 대기열 ── */
  const { data: queueRes, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['ws-blood-bank-queue'],
    queryFn: () => apiClient.get<{ data: WsOrder[] }>('/api/v1/workstation/station/blood-bank/queue'),
    refetchInterval: 8000,
  });
  const stationMeta = (queueRes as { meta?: Record<string, unknown> } | undefined)?.meta;
  const allOrders: WsOrder[] = useMemo(() => {
    const raw = queueRes?.data;
    return Array.isArray(raw) ? raw : [];
  }, [queueRes]);

  const counts = useMemo(() => ({
    ALL:         allOrders.length,
    ORDERED:     allOrders.filter(o => o.status === 'ORDERED').length,
    IN_PROGRESS: allOrders.filter(o => o.status === 'IN_PROGRESS' || o.status === 'RECEIVED').length,
    DISPENSED:   allOrders.filter(o => o.status === 'DISPENSED').length,
    COMPLETED:   allOrders.filter(o => o.status === 'COMPLETED').length,
  }), [allOrders]);

  const filtered = useMemo(() => {
    if (filter === 'ALL') return allOrders;
    if (filter === 'IN_PROGRESS') return allOrders.filter(o => o.status === 'IN_PROGRESS' || o.status === 'RECEIVED');
    return allOrders.filter(o => o.status === filter);
  }, [allOrders, filter]);

  /* ── 상세 ── */
  const selectedOrder = allOrders.find(o => o.orderId === selectedId);

  /* ── 뮤테이션 ── */
  const invalidate = () => qc.invalidateQueries({ queryKey: ['ws-blood-bank-queue'] });
  const receive  = useMutation({ mutationFn: (id: string) => apiClient.patch(`/api/v1/workstation/order/${id}/receive`),  onSuccess: () => { invalidate(); toast.success('접수 완료'); } });
  const start    = useMutation({ mutationFn: (id: string) => apiClient.patch(`/api/v1/workstation/order/${id}/start`),    onSuccess: () => { invalidate(); toast.success('교차시험 시작'); } });
  const complete = useMutation({ mutationFn: (id: string) => apiClient.patch(`/api/v1/workstation/order/${id}/complete`), onSuccess: () => { invalidate(); toast.success('혈액 배정 완료'); } });

  /* ── 체크리스트 ── */
  const toggleCheck = (i: number) => setChecklist(prev => ({ ...prev, [i]: !prev[i] }));
  const allChecked = CHECKLIST_ITEMS.every((_, i) => checklist[i]);

  const priority = (o: WsOrder) => o.priority ?? 'ROUTINE';

  return (
    <div className="space-y-5">
      <StationConfigNotice meta={stationMeta} />
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="혈액은행 워크스테이션" /></h1>
          <p className="text-sm text-gray-500 mt-0.5"><T k="접수 → 교차시험 → 혈액 배정 → 완료" /></p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/blood-bank" className="px-3 py-1.5 text-xs font-medium bg-red-50 text-red-700 rounded-lg hover:bg-red-100"><T k="혈액은행 메인" /></Link>
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] text-gray-400">8s</span>
        </div>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: '접수대기', count: counts.ORDERED,     cls: 'text-gray-600 bg-gray-50' },
          { label: '교차시험', count: counts.IN_PROGRESS, cls: 'text-amber-700 bg-amber-50' },
          { label: '혈액배정', count: counts.DISPENSED,   cls: 'text-red-700 bg-red-50' },
          { label: '완료',     count: counts.COMPLETED,   cls: 'text-emerald-700 bg-emerald-50' },
        ].map(s => (
          <div key={s.label} className={`rounded-xl p-3 ${s.cls}`}>
            <p className="text-[10px] font-medium opacity-70"><T k={s.label} /></p>
            <p className="text-2xl font-bold">{s.count}</p>
          </div>
        ))}
      </div>

      {/* 워크플로우 단계 */}
      <div className="flex items-center gap-1 text-xs text-gray-400">
        <span className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 font-medium"><T k="접수@오더" /></span>
        <span>&rarr;</span>
        <span className="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 font-medium"><T k="교차시험" /></span>
        <span>&rarr;</span>
        <span className="px-2.5 py-1 rounded-lg bg-red-50 text-red-700 font-medium"><T k="혈액 배정" /></span>
        <span>&rarr;</span>
        <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-medium"><T k="완료" /></span>
      </div>

      {/* 필터 탭 */}
      <div className="flex gap-1.5">
        {([
          { key: 'ALL' as FilterKey,         label: '전체' },
          { key: 'ORDERED' as FilterKey,     label: '접수대기' },
          { key: 'IN_PROGRESS' as FilterKey, label: '교차시험' },
          { key: 'DISPENSED' as FilterKey,   label: '혈액배정' },
          { key: 'COMPLETED' as FilterKey,   label: '완료' },
        ]).map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              filter === f.key ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>
            <T k={f.label} />
            {counts[f.key] > 0 && (
              <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${filter === f.key ? 'bg-white/20' : 'bg-gray-200'}`}>
                {counts[f.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 테이블 + 상세 패널 */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-4">
        {/* 대기열 테이블 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[60px]"><T k="긴급" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="상태" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="환자" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="업무" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="혈액형" /></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[55px]"><T k="시간" /></th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 w-[130px]"><T k="작업" /></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b border-gray-50">
                    <td colSpan={7} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td>
                  </tr>
                ))
              ) : isError ? (
                <tr><td colSpan={7} className="py-8"><QueryErrorFallback error={error} onRetry={refetch} /></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={7} className="py-16 text-center text-gray-400 text-sm"><T k="대기 중인 혈액 요청이 없습니다" /></td></tr>
              ) : filtered.map(o => {
                const pri = priority(o);
                const isSelected = selectedId === o.orderId;
                return (
                  <tr key={o.orderId} onClick={() => { setSelectedId(o.orderId); setChecklist({}); }}
                    className={`border-b border-gray-50 cursor-pointer transition-colors ${isSelected ? 'bg-red-50' : 'hover:bg-gray-50/50'} ${pri === 'STAT' ? 'bg-red-50/30' : ''}`}>
                    <td className="px-4 py-3">
                      {pri !== 'ROUTINE' && (
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${PRIORITY_CLS[pri] ?? ''}`}>{pri}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS_MAP[o.status]?.cls ?? 'bg-gray-100'}`}>
                        <T k={STATUS_MAP[o.status]?.label ?? o.status} />
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">{o.patient?.familyName}{o.patient?.givenName}</p>
                      <p className="text-[10px] text-gray-400">{o.patient?.mrn}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-gray-800 truncate max-w-[180px]">{o.procedureName ?? o.productType ?? o.procedureCode ?? '-'}</p>
                      {o.unitNumber && <p className="text-[10px] text-gray-400"><T k="단위번호" />: {o.unitNumber}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-sm font-bold text-red-700">{o.bloodType ?? '-'}</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-400 font-mono">
                      {o.createdAt ?kdate(o.createdAt, 'time') : ''}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-1 justify-end" onClick={e => e.stopPropagation()}>
                        {o.status === 'ORDERED'     && <button onClick={() => receive.mutate(o.orderId)} className="min-h-[44px] px-3 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"><T k="접수@오더" /></button>}
                        {o.status === 'RECEIVED'    && <button onClick={() => start.mutate(o.orderId)}   className="min-h-[44px] px-3 py-2 text-xs font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600"><T k="교차시험" /></button>}
                        {o.status === 'IN_PROGRESS' && <button onClick={() => complete.mutate(o.orderId)} className="min-h-[44px] px-3 py-2 text-xs font-medium bg-red-600 text-white rounded-lg hover:bg-red-700"><T k="배정" /></button>}
                        {o.status === 'DISPENSED'   && <button onClick={() => complete.mutate(o.orderId)} className="min-h-[48px] px-3 py-3 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"><T k="완료@버튼" /></button>}
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
          {!selectedId ? (
            <div className="text-center py-12">
              <svg className="w-10 h-10 mx-auto text-gray-200 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
              <p className="text-sm text-gray-400"><T k="혈액 요청을 선택하세요" /></p>
            </div>
          ) : !selectedOrder ? (
            <div className="text-center py-6"><p className="text-xs text-gray-400"><T k="요청을 찾을 수 없습니다" /></p></div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-900"><T k="혈액 요청 상세" /></h3>
                <button onClick={() => { setSelectedId(null); setChecklist({}); }} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>

              {/* 환자 정보 */}
              <div className="bg-blue-50 rounded-xl p-3 space-y-0.5">
                <p className="text-xs text-blue-600 font-medium"><T k="환자 정보" /></p>
                <p className="text-sm font-bold text-gray-900">{selectedOrder.patient?.familyName}{selectedOrder.patient?.givenName}</p>
                <p className="text-[10px] text-gray-500">MRN: {selectedOrder.patient?.mrn}</p>
                {selectedOrder.patient?.birthDate && <p className="text-[10px] text-gray-500"><T k="생년월일" />: {selectedOrder.patient.birthDate}</p>}
              </div>

              {/* 혈액 정보 */}
              <div className="bg-red-50 rounded-xl p-3 space-y-2">
                <p className="text-xs text-red-600 font-medium"><T k="혈액 정보" /></p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-gray-400"><T k="혈액형" />:</span>
                    <span className="ml-1 font-bold text-red-700 text-sm">{selectedOrder.bloodType ?? '-'}</span>
                  </div>
                  <div>
                    <span className="text-gray-400"><T k="제품유형" />:</span>
                    <span className="ml-1 font-medium">{selectedOrder.productType ?? '-'}</span>
                  </div>
                  <div>
                    <span className="text-gray-400"><T k="단위번호" />:</span>
                    <span className="ml-1 font-mono text-[10px]">{selectedOrder.unitNumber ?? '-'}</span>
                  </div>
                  <div>
                    <span className="text-gray-400"><T k="단위수" />:</span>
                    <span className="ml-1 font-medium">{selectedOrder.units ?? '-'} unit</span>
                  </div>
                </div>
                {selectedOrder.requestedBy && (
                  <p className="text-[10px] text-gray-500"><T k="요청의" />: {selectedOrder.requestedBy}</p>
                )}
              </div>

              {/* 교차시험 결과 */}
              <div className="bg-gray-50 rounded-xl p-3 space-y-1.5">
                <p className="text-xs text-gray-500 font-medium"><T k="교차시험 결과" /></p>
                {selectedOrder.crossmatchStatus ? (
                  <span className={`inline-block text-xs font-bold px-2.5 py-1 rounded-full ${CROSSMATCH_CLS[selectedOrder.crossmatchStatus] ?? 'bg-gray-100 text-gray-600'}`}>
                    {selectedOrder.crossmatchStatus === 'COMPATIBLE' ? '적합' :
                     selectedOrder.crossmatchStatus === 'INCOMPATIBLE' ? '부적합 — 수혈 금지' : '판정 대기'}
                  </span>
                ) : (
                  <span className="text-xs text-gray-400">교차시험 미완료</span>
                )}
                {selectedOrder.crossmatchResult && (
                  <p className="text-[10px] text-gray-600 bg-white rounded-lg p-2 mt-1">{selectedOrder.crossmatchResult}</p>
                )}
                {selectedOrder.crossmatchStatus === 'INCOMPATIBLE' && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-2 mt-1">
                    <p className="text-[10px] text-red-700 font-semibold">부적합 — 수혈 진행 불가. 담당의 즉시 통보 필요</p>
                  </div>
                )}
              </div>

              {/* 수혈 전 체크리스트 */}
              <div className="bg-amber-50 rounded-xl p-3 space-y-2">
                <p className="text-xs text-amber-700 font-semibold"><T k="수혈 전 확인 체크리스트" /></p>
                <div className="space-y-1.5">
                  <LocalChecklistNotice className="mb-1.5" />
                  {/* 🔴 템플릿 마스터 조회 실패 — 아래는 폴백 항목이지 원내 정본이 아니다 */}
                  {tplIsError && <QueryErrorFallback error={tplError} onRetry={refetchTpl} size="compact" />}
                  {CHECKLIST_ITEMS.map((item, i) => (
                    <label key={i} className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={!!checklist[i]} onChange={() => toggleCheck(i)}
                        className="w-3.5 h-3.5 accent-red-600" />
                      <span className={`text-xs ${checklist[i] ? 'line-through text-gray-400' : 'text-gray-700'}`}>{item}</span>
                    </label>
                  ))}
                </div>
                {allChecked && (
                  <p className="text-[10px] text-emerald-700 font-semibold bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1">
                    <T k="모든 항목 확인 완료" />
                  </p>
                )}
              </div>

              {/* 액션 버튼 */}
              <div className="flex gap-2 pt-2 border-t border-gray-100">
                {selectedOrder.status === 'ORDERED' && (
                  <button onClick={() => receive.mutate(selectedOrder.orderId)} className="flex-1 min-h-[44px] px-3 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"><T k="접수@오더" /></button>
                )}
                {selectedOrder.status === 'RECEIVED' && (
                  <button onClick={() => start.mutate(selectedOrder.orderId)} className="flex-1 min-h-[44px] px-3 py-2 text-xs font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600"><T k="교차시험 시작" /></button>
                )}
                {selectedOrder.status === 'IN_PROGRESS' && (
                  <button onClick={() => complete.mutate(selectedOrder.orderId)} className="flex-1 min-h-[44px] px-3 py-2 text-xs font-medium bg-red-600 text-white rounded-lg hover:bg-red-700"><T k="혈액 배정" /></button>
                )}
                {selectedOrder.status === 'DISPENSED' && (
                  <button onClick={() => complete.mutate(selectedOrder.orderId)} disabled={false} /* 🔴 가짜 게이트 제거 — 서버에 남지 않는 체크로 업무를 막지 않는다 */
                    className="flex-1 min-h-[48px] py-3 text-sm font-semibold bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed">
                    {allChecked ? '수혈 완료' : `체크리스트 ${Object.keys(checklist).filter(k => checklist[Number(k)]).length}/${CHECKLIST_ITEMS.length}`}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 수혈 실행 (bedside) — 출고된 수혈 건의 2인 확인+스캔 대조·시작·완료 (R2-1 FE 배선) */}
      <TransfusionExecPanel />
    </div>
  );
}

/**
 * 수혈 실행 패널 — PENDING(2인확인 대기)→VERIFIED→IN_PROGRESS→완료. 스캔 불일치는 서버가 항상 차단.
 *
 * 🔴 2026-08-26 F3 — **수혈 부작용을 보고할 경로가 이 시스템 어디에도 없었다.**
 *    `PATCH transfusions/:id/reaction` 과 `POST transfusions/:id/reaction-report` 는 둘 다 호출부 0이었고,
 *    `/blood-bank` 화면은 반응 보고 **목록만 GET** 했다(등록 경로 없이 목록만 보는 화면).
 *    운영 `transfusion_reaction_reports` 1행은 시드다 — 개통 이래 사람이 보고한 적이 없다.
 *    급성용혈·TRALI 는 즉시 중단해야 하는 응급이고 혈액원 통보는 법정 사항이다(혈액관리법).
 *  · 상세 보고(`reaction-report`)만 배선한다. `PATCH .../reaction` 은 같은 사실을 더 적게 적는
 *    구 경로라 화면을 두 벌 만들지 않는다(정본이 둘이면 갈라진다).
 *  · 🔴 **혈액원 신고는 이 시스템이 보내지 않는다.** 전송 코드가 존재하지 않으므로 체크박스는
 *    "시스템이 신고했다"가 아니라 "사람이 신고한 사실을 원내에 기록한다"로만 말한다.
 */
function TransfusionExecPanel() {
  const qc = useQueryClient();
  const [scan, setScan] = useState<Record<string, { band: string; unit: string; nurse2: string }>>({});
  const [reactionFor, setReactionFor] = useState<string | null>(null);
  const { data } = useQuery({
    queryKey: ['ws-transfusions'],
    queryFn: () => apiClient.get<{ data: Array<Record<string, unknown>> }>('/api/v1/blood-bank/transfusions').then(r => {
      const raw = r.data as unknown as { data?: Array<Record<string, unknown>> };
      return raw?.data ?? (r.data as unknown as Array<Record<string, unknown>>) ?? [];
    }),
    refetchInterval: pollMs('fast'),
  });
  /**
   * 🔴 지연성 용혈반응(HEMOLYTIC_DELAYED)은 수혈이 끝난 뒤에 나타난다. 기본 목록은
   *    PENDING/VERIFIED/IN_PROGRESS 만 담으므로, 완료·반응 건을 따로 불러야 보고할 수 있다.
   *    (보고하면 상태가 REACTION 이 되어 두 목록 어디에도 없게 되던 것도 함께 막는다.)
   */
  const completedQ = useQuery({
    queryKey: ['ws-transfusions-done'],
    queryFn: async () => {
      const pick = (r: { data: unknown }) => {
        const raw = r.data as { data?: Array<Record<string, unknown>> };
        return raw?.data ?? (r.data as Array<Record<string, unknown>>) ?? [];
      };
      const [done, rxn] = await Promise.all([
        apiClient.get<{ data: Array<Record<string, unknown>> }>('/api/v1/blood-bank/transfusions?status=COMPLETED'),
        apiClient.get<{ data: Array<Record<string, unknown>> }>('/api/v1/blood-bank/transfusions?status=REACTION'),
      ]);
      return [...pick(rxn), ...pick(done)];
    },
    refetchInterval: pollMs('slow'),
  });
  const { data: nursesRes, isError: nursesIsError, error: nursesError, refetch: refetchNurses } = useQuery({
    queryKey: ['nurse-list-mini'],
    queryFn: () => apiClient.get<{ data: Array<{ id: string; familyName?: string; givenName?: string }> }>('/api/v1/users?role=NURSE&limit=50'),
    staleTime: 300000,
  });
  const nurses = (Array.isArray(nursesRes?.data) ? nursesRes?.data : (nursesRes?.data as unknown as { data?: Array<{ id: string; familyName?: string; givenName?: string }> })?.data) ?? [];
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['ws-transfusions'] });
    qc.invalidateQueries({ queryKey: ['ws-transfusions-done'] });
    qc.invalidateQueries({ queryKey: ['bb-reactions'] });
  };
  const act = (path: string, body?: Record<string, unknown>) =>
    apiClient.patch(`/api/v1/blood-bank/transfusions/${path}`, body ?? {});
  const verify = useMutation({
    mutationFn: ({ id, band, unit, nurse2 }: { id: string; band: string; unit: string; nurse2: string }) =>
      act(`${id}/verify`, { nurse1Id: getAuthUserId(), nurse2Id: nurse2, patientBandScan: band, bloodUnitScan: unit }),
    onSuccess: () => { invalidate(); toast.success('2인 확인·스캔 대조 완료 (VERIFIED)'); },
    onError: (e) => toast.error((e as { message?: string })?.message || '대조 실패 — 수혈 중단·재확인'),
  });
  const startTx = useMutation({ mutationFn: (id: string) => act(`${id}/start`), onSuccess: () => { invalidate(); toast.success('수혈 시작'); }, onError: (e) => toast.error((e as { message?: string })?.message || '실패') });
  // 🔴 종전엔 `volumeTransfused: 320` 을 상수로 보냈다 — 실제 투여량을 묻지 않고 **원장에 날조**한 것이다.
  //    물을 수 없으면 보내지 않는다(서버가 미기재로 남긴다). 값은 아래 입력에서 받는다.
  // 🔴 값은 **행마다** 따로 담는다 — 한 칸을 공유하면 A 환자에게 적은 투여량이 B 환자 원장에 실린다.
  const [txVolume, setTxVolume] = useState<Record<string, string>>({});
  const completeTx = useMutation({
    mutationFn: (id: string) => {
      const raw = (txVolume[id] ?? '').trim();
      const v = raw === '' ? null : Number(raw);
      return act(`${id}/complete`, v != null && Number.isFinite(v) && v > 0 ? { volumeTransfused: v } : {});
    },
    onSuccess: (_r, id) => { invalidate(); setTxVolume(prev => { const n = { ...prev }; delete n[id]; return n; }); toast.success('수혈 완료'); },
    onError: (e) => toast.error((e as { message?: string })?.message || '실패'),
  });

  /** 수혈반응 상세 보고 — 서버가 수혈 상태를 REACTION 으로 바꾸고 보고서를 upsert 한다 */
  const reactionMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      apiClient.post(`/api/v1/blood-bank/transfusions/${id}/reaction-report`, body),
    onSuccess: () => { invalidate(); setReactionFor(null); toast.success('수혈반응을 보고했습니다.'); },
    // 🔴 실패를 삼키지 않는다 — 보고되지 않은 반응은 보고되지 않은 것이다
    onError: (e) => toast.error((e as { message?: string })?.message || '수혈반응 보고 실패 — 기록되지 않았습니다'),
  });

  const rows = data ?? [];
  const doneRows = completedQ.data ?? [];
  /** 진행 중 + (지연반응 보고를 위한) 완료·반응 건. 완료분은 뒤에 온다. */
  const allRows = [...rows, ...doneRows];
  if (!allRows.length) return null;
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-red-700">수혈 실행 (bedside 대조)</h2>
        <span className="text-[10px] text-gray-400">스캔 불일치는 서버가 항상 차단합니다</span>
      </div>
      {/* 🔴 완료 건을 함께 싣는 이유를 화면이 밝힌다 — 목록에 왜 끝난 수혈이 있는지 모르면 안 누른다 */}
      {completedQ.isError ? (
        <p className="text-[11px] text-rose-700">완료·반응 수혈을 불러오지 못했습니다 — 지연성 반응을 보고할 건이 있는지 알 수 없습니다.</p>
      ) : doneRows.length > 0 && (
        <p className="text-[10px] text-gray-400">완료·반응 {doneRows.length}건도 함께 표시합니다 — 지연성 용혈반응은 수혈이 끝난 뒤에 나타납니다.</p>
      )}
      <div className="space-y-2">
        {allRows.map((t) => {
          const id = String(t.id);
          const pt = (t.patient ?? {}) as Record<string, string>;
          const bp = (t.bloodProduct ?? {}) as Record<string, string>;
          const st = String(t.status);
          const sc = scan[id] ?? { band: '', unit: '', nurse2: '' };
          const setSc = (patch: Partial<typeof sc>) => setScan(prev => ({ ...prev, [id]: { ...sc, ...patch } }));
          return (
            <div key={id} className="border border-gray-100 rounded-xl p-3">
              <div className="flex items-center gap-2 text-xs">
                {/* 🔴 REACTION 을 초록으로 그리지 않는다 — 부작용이 보고된 건이 '정상 완료'로 보이면 안 된다 */}
                <span className={`px-1.5 py-0.5 rounded font-medium ${st === 'PENDING' ? 'bg-amber-100 text-amber-700' : st === 'VERIFIED' ? 'bg-blue-100 text-blue-700' : st === 'REACTION' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>{st}</span>
                <span className="font-medium text-gray-800">{pt.familyName}{pt.givenName} <span className="text-gray-400">{pt.mrn}</span></span>
                {/* Rh 정본 표기 — 미입력을 '-'(음성)로 단정하지 않는다(P10) */}
                <span className="text-gray-500">{bp.productType} {bloodTypeText(bp.bloodType, bp.rhFactor)} · {bp.unitNumber}</span>
              </div>
              {st === 'PENDING' && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <input value={sc.band} onChange={e => setSc({ band: e.target.value })} placeholder="손목밴드 스캔(MRN)" className="text-[11px] border border-gray-200 rounded-lg px-2 py-1 w-40" />
                  <input value={sc.unit} onChange={e => setSc({ unit: e.target.value })} placeholder="혈액백 스캔(유닛번호)" className="text-[11px] border border-gray-200 rounded-lg px-2 py-1 w-44" />
                  <select value={sc.nurse2} onChange={e => setSc({ nurse2: e.target.value })} className="text-[11px] border border-gray-200 rounded-lg px-1.5 py-1 bg-white w-32">
                    <option value="">2차 확인 간호사</option>
                    {nurses.map(n => <option key={n.id} value={n.id}>{n.familyName}{n.givenName}</option>)}
                  </select>
                  {/* 🔴 2차 확인 간호사 목록 조회 실패를 "간호사 없음"으로 말하지 않는다 */}
                  {nursesIsError && <QueryErrorFallback error={nursesError} onRetry={refetchNurses} size="compact" />}
                  <button onClick={() => verify.mutate({ id, band: sc.band, unit: sc.unit, nurse2: sc.nurse2 })}
                    disabled={!sc.band || !sc.unit || !sc.nurse2}
                    className="min-h-[44px] px-3 py-2 text-xs font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-40">2인 확인+대조</button>
                </div>
              )}
              {st === 'VERIFIED' && (
                <button onClick={() => startTx.mutate(id)} className="mt-2 min-h-[48px] px-4 py-3 text-sm font-semibold bg-blue-600 text-white rounded-lg hover:bg-blue-700">수혈 시작</button>
              )}
              {st === 'IN_PROGRESS' && (
                /* 🔴 실제 투여량을 묻는다 — 종전엔 320mL 상수를 원장에 적었다.
                   비워 두면 보내지 않는다(미기재로 남는다). 강제하면 아무 값이나 넣어 통과한다. */
                <div className="mt-2 flex items-center gap-1.5">
                  <input
                    type="number" min="1" inputMode="numeric"
                    value={txVolume[id] ?? ''} onChange={(e) => setTxVolume(prev => ({ ...prev, [id]: e.target.value }))}
                    placeholder="투여량"
                    className="w-20 min-h-[44px] px-2 py-1 border border-gray-200 rounded-lg text-[12px]"
                    aria-label="실제 투여량(mL)"
                  />
                  <span className="text-[10px] text-gray-400">mL</span>
                  <button onClick={() => completeTx.mutate(id)}
                    className="min-h-[44px] px-3 py-1 text-[12px] font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
                    수혈 완료
                  </button>
                </div>
              )}
              {/* 🔴 수혈이 시작된 뒤에만 반응을 보고할 수 있다 — 시작 전(PENDING/VERIFIED)에는
                  일어날 수 없는 일이므로 경로를 열지 않는다(열면 없는 사실이 기록된다). */}
              {(st === 'IN_PROGRESS' || st === 'COMPLETED' || st === 'REACTION') && (
                reactionFor === id ? (
                  <ReactionReportForm
                    pending={reactionMut.isPending}
                    onCancel={() => setReactionFor(null)}
                    onSubmit={(body) => reactionMut.mutate({ id, body })}
                  />
                ) : (
                  <button onClick={() => setReactionFor(id)}
                    className="mt-2 min-h-[44px] px-3 py-1 text-[12px] font-medium bg-rose-600 text-white rounded-lg hover:bg-rose-700">
                    ⚠ 수혈반응 보고
                  </button>
                )
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * 수혈반응 상세 보고 폼.
 *
 * 🔴 **초기값은 전부 미선택**이다 — 반응 유형·중증도를 미리 골라두면 클릭 한 번에 틀린 유형이 원장에 남는다.
 * 🔴 **혈액원 신고 체크는 "시스템이 보냈다"가 아니다.** 이 시스템에는 혈액원 전송 코드가 없다
 *    (대외 발신 3조건 중 ①구현이 없다). 사람이 유선·공문으로 신고한 사실만 원내에 기록한다.
 */
const REACTION_TYPES = [
  { value: 'FEBRILE', label: '발열성 비용혈성(FNHTR)' },
  { value: 'ALLERGIC', label: '알레르기' },
  { value: 'HEMOLYTIC_ACUTE', label: '급성 용혈' },
  { value: 'HEMOLYTIC_DELAYED', label: '지연성 용혈' },
  { value: 'TRALI', label: 'TRALI(수혈관련 급성폐손상)' },
  { value: 'TACO', label: 'TACO(수혈관련 순환과부하)' },
  { value: 'SEPSIS', label: '패혈증(세균오염)' },
  { value: 'OTHER', label: '기타' },
] as const;

const REACTION_SEVERITIES = [
  { value: 'MILD', label: '경증' },
  { value: 'MODERATE', label: '중등증' },
  { value: 'SEVERE', label: '중증' },
  { value: 'LIFE_THREATENING', label: '생명위협' },
] as const;

function ReactionReportForm({ onSubmit, onCancel, pending }: {
  onSubmit: (body: Record<string, unknown>) => void;
  onCancel: () => void;
  pending: boolean;
}) {
  // 🔴 초기값 '' = 미선택. 저장은 표시보다 위험하다.
  const [reactionType, setReactionType] = useState('');
  const [severity, setSeverity] = useState('');
  const [signs, setSigns] = useState('');
  const [managementNote, setManagementNote] = useState('');
  const [outcome, setOutcome] = useState('');
  const [reportedToBloodCenter, setReportedToBloodCenter] = useState(false);

  const canSave = !!reactionType && !!severity && !pending;

  return (
    <div className="mt-2 rounded-xl border border-rose-200 bg-rose-50/60 p-3 space-y-2">
      <p className="text-[11px] font-bold text-rose-800">수혈반응 보고 — 수혈 중단·활력 확인이 먼저입니다</p>
      <div className="flex flex-wrap gap-1.5">
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-gray-500">반응 유형 (필수)</span>
          <select value={reactionType} onChange={(e) => setReactionType(e.target.value)}
            className="min-h-[44px] px-2 py-1 border border-gray-200 rounded-lg text-[12px] bg-white">
            <option value="">— 선택 —</option>
            {REACTION_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-gray-500">중증도 (필수)</span>
          <select value={severity} onChange={(e) => setSeverity(e.target.value)}
            className="min-h-[44px] px-2 py-1 border border-gray-200 rounded-lg text-[12px] bg-white">
            <option value="">— 선택 —</option>
            {REACTION_SEVERITIES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-gray-500">경과(선택)</span>
          <input value={outcome} onChange={(e) => setOutcome(e.target.value)} maxLength={30}
            className="min-h-[44px] w-32 px-2 py-1 border border-gray-200 rounded-lg text-[12px]" />
        </label>
      </div>
      <textarea value={signs} onChange={(e) => setSigns(e.target.value)} rows={2} maxLength={2000}
        placeholder="증상·징후 (관찰한 것만 적습니다)"
        className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-[12px]" />
      <textarea value={managementNote} onChange={(e) => setManagementNote(e.target.value)} rows={2} maxLength={2000}
        placeholder="처치 내용"
        className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-[12px]" />
      <label className="flex items-start gap-2 text-[11px] leading-relaxed text-gray-700">
        <input type="checkbox" checked={reportedToBloodCenter} className="mt-0.5"
          onChange={(e) => setReportedToBloodCenter(e.target.checked)} />
        <span>
          혈액원에 <b>사람이 직접</b> 신고했습니다(유선·공문).
          <span className="block text-gray-500">
            🔴 이 시스템은 혈액원으로 전송하지 않습니다 — 체크는 원내 기록일 뿐 전송이 아닙니다.
          </span>
        </span>
      </label>
      <div className="flex items-center gap-1.5">
        <button onClick={() => onSubmit({
          reactionType, severity,
          ...(signs.trim() ? { signs: signs.trim() } : {}),
          ...(managementNote.trim() ? { managementNote: managementNote.trim() } : {}),
          ...(outcome.trim() ? { outcome: outcome.trim() } : {}),
          reportedToBloodCenter,
        })} disabled={!canSave}
          className="min-h-[44px] px-4 py-1 text-[12px] font-medium bg-rose-600 text-white rounded-lg hover:bg-rose-700 disabled:opacity-40">
          반응 보고 저장
        </button>
        <button onClick={onCancel} className="min-h-[44px] px-3 py-1 text-[12px] text-gray-600 hover:underline">취소</button>
      </div>
    </div>
  );
}

/** 현재 로그인 사용자 id (1차 확인 간호사=본인) */
function getAuthUserId(): string {
  return useAuthStore.getState().user?.id ?? '';
}
