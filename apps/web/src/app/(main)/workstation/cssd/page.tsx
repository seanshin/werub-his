'use client';

import { LocalChecklistNotice } from '@/components/workstation/LocalChecklistNotice';
import { useState } from 'react';
import { StationConfigNotice } from '@/components/workstation/StationConfigNotice';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { kdate } from '@/lib/ui-settings';
import { T } from '@/components/ui/i18n-text';

// ── 인터페이스 정의 ──────────────────────────────────────────────
interface CssdPatient {
  familyName: string;
  givenName: string;
  mrn: string;
  ward?: string;
}

interface CssdOrder {
  orderId: string;
  status: 'ORDERED' | 'RECEIVED' | 'IN_PROGRESS' | 'COMPLETED';
  priority: 'STAT' | 'ROUTINE';
  patient?: CssdPatient;
  procedureName?: string;
  procedureCode?: string;
  instrumentSet?: string;
  washMethod?: string;
  sterilizeMethod?: string;
  biResult?: 'PASS' | 'FAIL' | 'PENDING';
  expiryDate?: string;
  requestedAt?: string;
  completedAt?: string;
  notes?: string;
}

type FilterTab = 'ALL' | 'ORDERED' | 'IN_PROGRESS' | 'COMPLETED';

// ── 상수 ────────────────────────────────────────────────────────
const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  ORDERED:     { label: '수거대기', cls: 'bg-gray-100 text-gray-600' },
  RECEIVED:    { label: '세척중',   cls: 'bg-cyan-100 text-cyan-700' },
  IN_PROGRESS: { label: '멸균중',   cls: 'bg-amber-100 text-amber-700' },
  COMPLETED:   { label: '완료',     cls: 'bg-emerald-100 text-emerald-700' },
};

const WORKFLOW_STEPS = ['수거', '세척', '멸균', '완료'] as const;

const WORKFLOW_STATUS_MAP: Record<string, number> = {
  ORDERED: 0,
  RECEIVED: 1,
  IN_PROGRESS: 2,
  COMPLETED: 3,
};

const BI_BADGE: Record<string, { label: string; cls: string }> = {
  PASS:    { label: 'PASS', cls: 'bg-emerald-100 text-emerald-700' },
  FAIL:    { label: 'FAIL', cls: 'bg-red-100 text-red-700' },
  PENDING: { label: '판독중', cls: 'bg-amber-100 text-amber-700' },
};

const CHECKLIST_ITEMS = [
  '분류완료',
  '세척완료',
  '포장확인',
  '멸균기확인',
  'BI확인',
  '라벨부착',
] as const;

// ── 컴포넌트 ─────────────────────────────────────────────────────
export default function CssdWorkstationPage() {
  const queryClient = useQueryClient();
  const [filterTab, setFilterTab] = useState<FilterTab>('ALL');
  const [selectedOrder, setSelectedOrder] = useState<CssdOrder | null>(null);
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});

  const { data: queueRes, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['ws-cssd-queue'],
    queryFn: () => apiClient.get<{ data: CssdOrder[] }>('/api/v1/workstation/station/cssd/queue'),
    refetchInterval: 8000,
  });

  const allOrders: CssdOrder[] = queueRes?.data ?? [];
  const stationMeta = (queueRes as { meta?: Record<string, unknown> } | undefined)?.meta;
  const waitingCount = allOrders.filter((o) => o.status === 'ORDERED').length;
  const progressCount = allOrders.filter((o) => o.status === 'RECEIVED' || o.status === 'IN_PROGRESS').length;
  const completedCount = allOrders.filter((o) => o.status === 'COMPLETED').length;

  const filteredOrders = allOrders.filter((o) => {
    if (filterTab === 'ALL') return true;
    if (filterTab === 'IN_PROGRESS') return o.status === 'RECEIVED' || o.status === 'IN_PROGRESS';
    return o.status === filterTab;
  });

  const receive = useMutation({
    mutationFn: (orderId: string) =>
      apiClient.patch(`/api/v1/workstation/order/${orderId}/receive`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ws-cssd-queue'] });
      toast.success('수거 접수 완료');
    },
  });

  const start = useMutation({
    mutationFn: (orderId: string) =>
      apiClient.patch(`/api/v1/workstation/order/${orderId}/start`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ws-cssd-queue'] });
      toast.success('멸균 처리 시작');
    },
  });

  const complete = useMutation({
    mutationFn: (orderId: string) =>
      apiClient.patch(`/api/v1/workstation/order/${orderId}/complete`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ws-cssd-queue'] });
      setSelectedOrder(null);
      toast.success('멸균 처리 완료');
    },
  });

  function ToggleChecklist(key: string) {
    setChecklist((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function SelectOrder(order: CssdOrder) {
    setSelectedOrder((prev) => (prev?.orderId === order.orderId ? null : order));
    setChecklist({});
  }

  const allChecked = CHECKLIST_ITEMS.every((item) => checklist[item]);

  return (
    <>
      {/* 🔴 배너는 flex/grid 컨테이너 **밖**에 둔다 — 안에 두면 컬럼 하나를 차지해
           본문이 절반으로 밀린다(2026-08-12 실측: 장비·중앙공급·감염관리 3화면). */}
      <StationConfigNotice meta={stationMeta} />
    <div className="flex gap-5 h-full">
      {/* 메인 패널 */}
      <div className="flex-1 space-y-5 min-w-0">
        {/* 헤더 */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="중앙공급 워크스테이션" /></h1>
          <p className="text-sm text-gray-500 mt-0.5"><T k="수거 → 세척/멸균 → 완료 · 8초 자동 갱신" /></p>
        </div>

        {/* 통계 카드 */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white border rounded-xl p-4">
            <p className="text-xs text-gray-500"><T k="수거대기" /></p>
            <p className="text-2xl font-bold text-gray-800 mt-1">{waitingCount}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">건</p>
          </div>
          <div className="bg-cyan-50 border border-cyan-100 rounded-xl p-4">
            <p className="text-xs text-cyan-600"><T k="세척/멸균중" /></p>
            <p className="text-2xl font-bold text-cyan-700 mt-1">{progressCount}</p>
            <p className="text-[10px] text-cyan-400 mt-0.5">건</p>
          </div>
          <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4">
            <p className="text-xs text-emerald-600"><T k="완료" /></p>
            <p className="text-2xl font-bold text-emerald-700 mt-1">{completedCount}</p>
            <p className="text-[10px] text-emerald-400 mt-0.5">건</p>
          </div>
        </div>

        {/* 필터 탭 */}
        <div className="flex gap-1 border-b border-gray-100">
          {(['ALL', 'ORDERED', 'IN_PROGRESS', 'COMPLETED'] as FilterTab[]).map((tab) => {
            const labels: Record<FilterTab, string> = {
              ALL: `전체 (${allOrders.length})`,
              ORDERED: `수거대기 (${waitingCount})`,
              IN_PROGRESS: `처리중 (${progressCount})`,
              COMPLETED: `완료 (${completedCount})`,
            };
            return (
              <button
                key={tab}
                onClick={() => setFilterTab(tab)}
                className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                  filterTab === tab
                    ? 'border-cyan-600 text-cyan-700'
                    : 'border-transparent text-gray-400 hover:text-gray-600'
                }`}
              >
                {labels[tab]}
              </button>
            );
          })}
        </div>

        {/* 테이블 */}
        {isLoading ? (
          <div className="py-16 text-center text-gray-400">
            <div className="animate-spin text-3xl mb-2 inline-block">⟳</div>
            <p><T k="로딩 중..." /></p>
          </div>
        ) : isError ? (
          <QueryErrorFallback error={error} onRetry={refetch} />
        ) : filteredOrders.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <p className="text-3xl mb-3">✓</p>
            <p className="text-sm"><T k="해당 상태의 업무가 없습니다" /></p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left w-12"><T k="긴급" /></th>
                  <th className="px-4 py-3 text-left"><T k="기구세트" /></th>
                  <th className="px-4 py-3 text-left"><T k="요청병동" /></th>
                  <th className="px-4 py-3 text-left"><T k="상태" /></th>
                  <th className="px-4 py-3 text-left">BI</th>
                  <th className="px-4 py-3 text-left"><T k="유효기간" /></th>
                  <th className="px-4 py-3 text-left"><T k="작업" /></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredOrders.map((item) => (
                  <tr
                    key={item.orderId}
                    onClick={() => SelectOrder(item)}
                    className={`cursor-pointer transition-colors hover:bg-cyan-50/30 ${
                      selectedOrder?.orderId === item.orderId ? 'bg-cyan-50' : ''
                    } ${item.priority === 'STAT' ? 'bg-red-50/20' : ''}`}
                  >
                    <td className="px-4 py-3">
                      {item.priority === 'STAT' && (
                        <span className="px-1.5 py-0.5 bg-red-600 text-white text-[10px] font-bold rounded animate-pulse whitespace-nowrap">
                          STAT
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900">
                        {item.instrumentSet || item.procedureName || '-'}
                      </p>
                      <p className="text-xs text-gray-400">{item.procedureCode || ''}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      {item.patient?.ward || '-'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${
                          STATUS_BADGE[item.status]?.cls ?? 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {STATUS_BADGE[item.status]?.label ?? item.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {item.biResult ? (
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${
                            BI_BADGE[item.biResult]?.cls ?? 'bg-gray-100'
                          }`}
                        >
                          {BI_BADGE[item.biResult]?.label ?? item.biResult}
                        </span>
                      ) : (
                        <span className="text-gray-300 text-xs">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {item.expiryDate
                        ?kdate(item.expiryDate, 'date')
                        : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                        {item.status === 'ORDERED' && (
                          <button
                            onClick={() => receive.mutate(item.orderId)}
                            disabled={receive.isPending}
                            className="min-h-[44px] px-3 py-2 bg-cyan-600 text-white rounded-lg text-xs font-medium hover:bg-cyan-700 disabled:opacity-50 whitespace-nowrap"
                          >
                            <T k="수거접수" />
                          </button>
                        )}
                        {item.status === 'RECEIVED' && (
                          <button
                            onClick={() => start.mutate(item.orderId)}
                            disabled={start.isPending}
                            className="min-h-[44px] px-3 py-2 bg-amber-500 text-white rounded-lg text-xs font-medium hover:bg-amber-600 disabled:opacity-50 whitespace-nowrap"
                          >
                            <T k="멸균시작" />
                          </button>
                        )}
                        {item.status === 'IN_PROGRESS' && (
                          <button
                            onClick={() => complete.mutate(item.orderId)}
                            disabled={complete.isPending}
                            className="min-h-[48px] px-3 py-3 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap"
                          >
                            <T k="완료@버튼" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 상세 패널 */}
      {selectedOrder && (
        <div className="w-80 shrink-0 space-y-4">
          {/* 기구세트 정보 */}
          <div className="bg-white rounded-xl border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-900"><T k="기구세트 정보" /></h2>
              {selectedOrder.priority === 'STAT' && (
                <span className="px-2 py-0.5 bg-red-600 text-white text-[10px] font-bold rounded whitespace-nowrap">
                  STAT
                </span>
              )}
            </div>

            {/* 워크플로우 진행 표시 */}
            <div className="flex items-center gap-1">
              {WORKFLOW_STEPS.map((step, idx) => {
                const currentStep = WORKFLOW_STATUS_MAP[selectedOrder.status] ?? 0;
                const isDone = idx < currentStep;
                const isCurrent = idx === currentStep;
                return (
                  <div key={step} className="flex items-center gap-1">
                    <div
                      className={`flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold ${
                        isDone
                          ? 'bg-cyan-600 text-white'
                          : isCurrent
                          ? 'bg-cyan-100 text-cyan-700 ring-2 ring-cyan-400'
                          : 'bg-gray-100 text-gray-400'
                      }`}
                    >
                      {isDone ? '✓' : idx + 1}
                    </div>
                    <span
                      className={`text-[10px] ${
                        isCurrent ? 'text-cyan-700 font-semibold' : 'text-gray-400'
                      }`}
                    >
                      {step}
                    </span>
                    {idx < WORKFLOW_STEPS.length - 1 && (
                      <div
                        className={`w-3 h-px ${isDone ? 'bg-cyan-400' : 'bg-gray-200'}`}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-500"><T k="기구세트" /></span>
                <span className="font-medium text-gray-800">
                  {selectedOrder.instrumentSet || selectedOrder.procedureName || '-'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500"><T k="요청병동" /></span>
                <span className="text-gray-700">{selectedOrder.patient?.ward || '-'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500"><T k="세척방법" /></span>
                <span className="text-gray-700">{selectedOrder.washMethod || '표준세척'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500"><T k="멸균방법" /></span>
                <span className="text-gray-700">{selectedOrder.sterilizeMethod || '고압증기'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500"><T k="BI 지시기" /></span>
                {selectedOrder.biResult ? (
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${
                      BI_BADGE[selectedOrder.biResult]?.cls ?? 'bg-gray-100'
                    }`}
                  >
                    {BI_BADGE[selectedOrder.biResult]?.label}
                  </span>
                ) : (
                  <span className="text-gray-300">-</span>
                )}
              </div>
              {selectedOrder.expiryDate && (
                <div className="flex justify-between">
                  <span className="text-gray-500"><T k="유효기간" /></span>
                  <span className="text-gray-700">
                    {kdate(new Date(selectedOrder.expiryDate))}
                  </span>
                </div>
              )}
              {selectedOrder.notes && (
                <div className="pt-1 border-t border-gray-50">
                  <p className="text-gray-500 mb-0.5"><T k="비고" /></p>
                  <p className="text-gray-700">{selectedOrder.notes}</p>
                </div>
              )}
            </div>
          </div>

          {/* 체크리스트 */}
          <div className="bg-white rounded-xl border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-900"><T k="처리 체크리스트" /></h2>
              <span className="text-[10px] text-gray-400">
                {CHECKLIST_ITEMS.filter((i) => checklist[i]).length}/{CHECKLIST_ITEMS.length}
              </span>
            </div>
            <div className="space-y-2">
              <LocalChecklistNotice className="mb-1.5" />
              {CHECKLIST_ITEMS.map((item) => (
                <label
                  key={item}
                  className="flex items-center gap-2.5 cursor-pointer group"
                >
                  <div
                    onClick={() => ToggleChecklist(item)}
                    className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-colors ${
                      checklist[item]
                        ? 'bg-cyan-600 border-cyan-600'
                        : 'border-gray-300 group-hover:border-cyan-400'
                    }`}
                  >
                    {checklist[item] && (
                      <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 10" fill="none">
                        <path d="M1.5 5l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                  <span
                    className={`text-xs transition-colors ${
                      checklist[item] ? 'line-through text-gray-400' : 'text-gray-700'
                    }`}
                  >
                    {item}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* 액션 버튼 */}
          <div className="space-y-2">
            {selectedOrder.status === 'ORDERED' && (
              <button
                onClick={() => receive.mutate(selectedOrder.orderId)}
                disabled={receive.isPending}
                className="w-full min-h-[44px] px-3 py-2 bg-cyan-600 text-white rounded-xl text-xs font-medium hover:bg-cyan-700 disabled:opacity-50 transition-colors"
              >
                <T k="수거 접수" />
              </button>
            )}
            {selectedOrder.status === 'RECEIVED' && (
              <button
                onClick={() => start.mutate(selectedOrder.orderId)}
                disabled={start.isPending}
                className="w-full min-h-[44px] px-3 py-2 bg-amber-500 text-white rounded-xl text-xs font-medium hover:bg-amber-600 disabled:opacity-50 transition-colors"
              >
                <T k="멸균 처리 시작" />
              </button>
            )}
            {selectedOrder.status === 'IN_PROGRESS' && (
              <button
                onClick={() => complete.mutate(selectedOrder.orderId)}
                disabled={complete.isPending} /* 🔴 로컬 체크는 게이트가 아니다 */
                className="w-full min-h-[48px] py-3 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                {allChecked ? '멸균 완료 처리' : `체크리스트 확인 필요 (${CHECKLIST_ITEMS.filter((i) => checklist[i]).length}/${CHECKLIST_ITEMS.length})`}
              </button>
            )}
            <button
              onClick={() => setSelectedOrder(null)}
              className="w-full py-2 border border-gray-200 text-gray-600 rounded-xl text-sm hover:bg-gray-50 transition-colors"
            >
              <T k="닫기" />
            </button>
          </div>
        </div>
      )}
    </div>
    </>
  );
}
