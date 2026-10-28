'use client';

import { LocalChecklistNotice } from '@/components/workstation/LocalChecklistNotice';
import { useState } from 'react';
import { StationConfigNotice } from '@/components/workstation/StationConfigNotice';
import { Unit } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T } from '@/components/ui/i18n-text';

// ── 인터페이스 정의 ──────────────────────────────────────────────
interface InfectionPatient {
  familyName: string;
  givenName: string;
  mrn: string;
  ward?: string;
  room?: string;
}

interface ContactTrace {
  name: string;
  role: string;
  contactDate: string;
  status: 'NOTIFIED' | 'PENDING';
}

interface InfectionOrder {
  orderId: string;
  status: 'ORDERED' | 'RECEIVED' | 'IN_PROGRESS' | 'COMPLETED';
  priority: 'STAT' | 'ROUTINE';
  patient?: InfectionPatient;
  infectionType?: string;
  procedureName?: string;
  procedureCode?: string;
  isolationLevel?: 'CONTACT' | 'DROPLET' | 'AIRBORNE' | 'STANDARD';
  contacts?: ContactTrace[];
  requestedAt?: string;
  completedAt?: string;
  notes?: string;
}

type FilterTab = 'ALL' | 'ORDERED' | 'IN_PROGRESS' | 'COMPLETED';

// ── 상수 ────────────────────────────────────────────────────────
// label·항목 문자열은 표시값이 아니라 **t() 키**다(소비처가 `<T k=…>` — `@문맥` 은 ko 렌더에서 잘린다)
const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  ORDERED:     { label: '접수대기',  cls: 'bg-gray-100 text-gray-600' },
  RECEIVED:    { label: '역학조사',  cls: 'bg-amber-100 text-amber-700' },
  IN_PROGRESS: { label: '격리조치', cls: 'bg-red-100 text-red-700' },
  COMPLETED:   { label: '완료',      cls: 'bg-emerald-100 text-emerald-700' },
};

const WORKFLOW_STEPS = ['접수@오더', '조사', '격리조치', '완료'] as const;

const WORKFLOW_STATUS_MAP: Record<string, number> = {
  ORDERED: 0,
  RECEIVED: 1,
  IN_PROGRESS: 2,
  COMPLETED: 3,
};

const ISOLATION_BADGE: Record<string, { label: string; cls: string }> = {
  AIRBORNE:  { label: '공기주의',   cls: 'bg-red-100 text-red-700' },
  DROPLET:   { label: '비말주의',   cls: 'bg-orange-100 text-orange-700' },
  CONTACT:   { label: '접촉주의',   cls: 'bg-amber-100 text-amber-700' },
  STANDARD:  { label: '표준주의',   cls: 'bg-blue-100 text-blue-700' },
};

const INFECTION_TYPE_COLORS: Record<string, string> = {
  MRSA:    'bg-red-100 text-red-700',
  VRE:     'bg-purple-100 text-purple-700',
  'C.diff': 'bg-amber-100 text-amber-700',
  TB:      'bg-orange-100 text-orange-700',
  CRE:     'bg-rose-100 text-rose-700',
};

const CHECKLIST_ITEMS = [
  '검체채취',
  '배양확인',
  '격리지시',
  '보호구착용',
  '접촉자목록',
  '보고완료',
] as const;

// ── 컴포넌트 ─────────────────────────────────────────────────────
export default function InfectionControlWorkstationPage() {
  const queryClient = useQueryClient();
  const [filterTab, setFilterTab] = useState<FilterTab>('ALL');
  const [selectedOrder, setSelectedOrder] = useState<InfectionOrder | null>(null);
  const [checklist, setChecklist] = useState<Record<string, boolean>>({});

  const { data: queueRes, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['ws-infection-control-queue'],
    queryFn: () =>
      apiClient.get<{ data: InfectionOrder[] }>('/api/v1/workstation/station/infection-control/queue'),
    refetchInterval: 8000,
  });

  const allOrders: InfectionOrder[] = queueRes?.data ?? [];
  const stationMeta = (queueRes as { meta?: Record<string, unknown> } | undefined)?.meta;
  const waitingCount = allOrders.filter((o) => o.status === 'ORDERED').length;
  const progressCount = allOrders.filter(
    (o) => o.status === 'RECEIVED' || o.status === 'IN_PROGRESS',
  ).length;
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
      queryClient.invalidateQueries({ queryKey: ['ws-infection-control-queue'] });
      toast.success('접수 완료');
    },
  });

  const start = useMutation({
    mutationFn: (orderId: string) =>
      apiClient.patch(`/api/v1/workstation/order/${orderId}/start`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ws-infection-control-queue'] });
      toast.success('격리 조치 시작');
    },
  });

  const complete = useMutation({
    mutationFn: (orderId: string) =>
      apiClient.patch(`/api/v1/workstation/order/${orderId}/complete`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ws-infection-control-queue'] });
      setSelectedOrder(null);
      toast.success('감염 관리 완료');
    },
  });

  function ToggleChecklist(key: string) {
    setChecklist((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  function SelectOrder(order: InfectionOrder) {
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
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900"><T k="감염관리 워크스테이션" /></h1>
            <p className="text-sm text-gray-500 mt-0.5"><T k="감염 감시 · 격리 · 보고 · 8초 자동 갱신" /></p>
          </div>
          <a
            href="/safety"
            className="px-3 py-1.5 bg-amber-50 border border-amber-200 text-amber-700 rounded-lg text-xs font-medium hover:bg-amber-100 transition-colors whitespace-nowrap"
          >
            <T k="안전/질관리" />
          </a>
        </div>

        {/* 통계 카드 */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white border rounded-xl p-4">
            <p className="text-xs text-gray-500"><T k="접수대기" /></p>
            <p className="text-2xl font-bold text-gray-800 mt-1">{waitingCount}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">건</p>
          </div>
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-4">
            <p className="text-xs text-amber-600"><T k="조사/격리중" /></p>
            <p className="text-2xl font-bold text-amber-700 mt-1">{progressCount}</p>
            <p className="text-[10px] text-amber-400 mt-0.5">건</p>
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
            // 🔴 라벨과 건수를 분리한다 — 보간 문자열은 t() 키가 될 수 없다(ko 렌더 문자는 동일)
            const labels: Record<FilterTab, string> = {
              ALL: '전체', ORDERED: '접수대기', IN_PROGRESS: '처리중', COMPLETED: '완료',
            };
            const counts: Record<FilterTab, number> = {
              ALL: allOrders.length, ORDERED: waitingCount, IN_PROGRESS: progressCount, COMPLETED: completedCount,
            };
            return (
              <button
                key={tab}
                onClick={() => setFilterTab(tab)}
                className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                  filterTab === tab
                    ? 'border-amber-600 text-amber-700'
                    : 'border-transparent text-gray-400 hover:text-gray-600'
                }`}
              >
                <T k={labels[tab]} /> ({counts[tab]})
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
                  <th className="px-4 py-3 text-left"><T k="환자" /></th>
                  <th className="px-4 py-3 text-left"><T k="병동/호실" /></th>
                  <th className="px-4 py-3 text-left"><T k="감염유형" /></th>
                  <th className="px-4 py-3 text-left"><T k="격리등급" /></th>
                  <th className="px-4 py-3 text-left"><T k="상태" /></th>
                  <th className="px-4 py-3 text-left"><T k="접촉자" /></th>
                  <th className="px-4 py-3 text-left"><T k="작업" /></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredOrders.map((item) => (
                  <tr
                    key={item.orderId}
                    onClick={() => SelectOrder(item)}
                    className={`cursor-pointer transition-colors hover:bg-amber-50/30 ${
                      selectedOrder?.orderId === item.orderId ? 'bg-amber-50' : ''
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
                        {item.patient
                          ? `${item.patient.familyName}${item.patient.givenName}`
                          : '-'}
                      </p>
                      <p className="text-xs text-gray-400">{item.patient?.mrn || ''}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {item.patient?.ward || '-'}
                      {item.patient?.room ? ` / ${item.patient.room}호` : ''}
                    </td>
                    <td className="px-4 py-3">
                      {item.infectionType ? (
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${
                            INFECTION_TYPE_COLORS[item.infectionType] ?? 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {item.infectionType}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">
                          {item.procedureName || '-'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {item.isolationLevel ? (
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${
                            ISOLATION_BADGE[item.isolationLevel]?.cls ?? 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          <T k={ISOLATION_BADGE[item.isolationLevel]?.label ?? item.isolationLevel} />
                        </span>
                      ) : (
                        <span className="text-gray-300 text-xs">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${
                          STATUS_BADGE[item.status]?.cls ?? 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        <T k={STATUS_BADGE[item.status]?.label ?? item.status} />
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {item.contacts ? `${item.contacts.length}명` : '-'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
                        {item.status === 'ORDERED' && (
                          <button
                            onClick={() => receive.mutate(item.orderId)}
                            disabled={receive.isPending}
                            className="min-h-[44px] px-2.5 py-1 bg-amber-600 text-white rounded-lg text-xs font-medium hover:bg-amber-700 disabled:opacity-50 whitespace-nowrap"
                          >
                            <T k="접수@오더" />
                          </button>
                        )}
                        {item.status === 'RECEIVED' && (
                          <button
                            onClick={() => start.mutate(item.orderId)}
                            disabled={start.isPending}
                            className="min-h-[44px] px-2.5 py-1 bg-red-500 text-white rounded-lg text-xs font-medium hover:bg-red-600 disabled:opacity-50 whitespace-nowrap"
                          >
                            <T k="격리조치" />
                          </button>
                        )}
                        {item.status === 'IN_PROGRESS' && (
                          <button
                            onClick={() => complete.mutate(item.orderId)}
                            disabled={complete.isPending}
                            className="min-h-[44px] px-2.5 py-1 bg-emerald-600 text-white rounded-lg text-xs font-medium hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap"
                          >
                            <T k="완료" />
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
          {/* 환자 정보 */}
          <div className="bg-white rounded-xl border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-900"><T k="환자 정보" /></h2>
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
                  <div key={step} className="flex items-center gap-1 shrink-0">
                    <div
                      className={`flex items-center justify-center w-6 h-6 rounded-full text-[10px] font-bold ${
                        isDone
                          ? 'bg-amber-600 text-white'
                          : isCurrent
                          ? 'bg-amber-100 text-amber-700 ring-2 ring-amber-400'
                          : 'bg-gray-100 text-gray-400'
                      }`}
                    >
                      {isDone ? '✓' : idx + 1}
                    </div>
                    <span
                      className={`text-[10px] ${
                        isCurrent ? 'text-amber-700 font-semibold' : 'text-gray-400'
                      }`}
                    >
                      <T k={step} />
                    </span>
                    {idx < WORKFLOW_STEPS.length - 1 && (
                      <div
                        className={`w-3 h-px ${isDone ? 'bg-amber-400' : 'bg-gray-200'}`}
                      />
                    )}
                  </div>
                );
              })}
            </div>

            <div className="space-y-1.5 text-xs">
              {selectedOrder.patient && (
                <>
                  <div className="flex justify-between">
                    <span className="text-gray-500"><T k="환자명" /></span>
                    <span className="font-medium text-gray-800">
                      {selectedOrder.patient.familyName}{selectedOrder.patient.givenName}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">MRN</span>
                    <span className="text-gray-700 font-mono text-[11px]">
                      {selectedOrder.patient.mrn}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500"><T k="병동/호실" /></span>
                    <span className="text-gray-700">
                      {selectedOrder.patient.ward || '-'}
                      {selectedOrder.patient.room ? ` / ${selectedOrder.patient.room}호` : ''}
                    </span>
                  </div>
                </>
              )}
              <div className="pt-1 border-t border-gray-50 flex justify-between">
                <span className="text-gray-500"><T k="감염유형" /></span>
                {selectedOrder.infectionType ? (
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${
                      INFECTION_TYPE_COLORS[selectedOrder.infectionType] ?? 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {selectedOrder.infectionType}
                  </span>
                ) : (
                  <span className="text-gray-700">{selectedOrder.procedureName || '-'}</span>
                )}
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500"><T k="격리등급" /></span>
                {selectedOrder.isolationLevel ? (
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${
                      ISOLATION_BADGE[selectedOrder.isolationLevel]?.cls ?? 'bg-gray-100'
                    }`}
                  >
                    <T k={ISOLATION_BADGE[selectedOrder.isolationLevel]?.label ?? ''} />
                  </span>
                ) : (
                  <span className="text-gray-300">-</span>
                )}
              </div>
            </div>
          </div>

          {/* 접촉자 추적 */}
          {selectedOrder.contacts && selectedOrder.contacts.length > 0 && (
            <div className="bg-white rounded-xl border p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-gray-900"><T k="접촉자 추적" /></h2>
                <span className="text-[10px] text-gray-400">{selectedOrder.contacts.length}<Unit>명</Unit></span>
              </div>
              <div className="space-y-2">
                {selectedOrder.contacts.map((contact, idx) => (
                  <div key={idx} className="flex items-center justify-between text-xs">
                    <div>
                      <p className="text-gray-700 font-medium">{contact.name}</p>
                      <p className="text-gray-400">{contact.role} · {contact.contactDate}</p>
                    </div>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap ${
                        contact.status === 'NOTIFIED'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-amber-100 text-amber-700'
                      }`}
                    >
                      <T k={contact.status === 'NOTIFIED' ? '통보완료' : '대기중'} />
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 체크리스트 */}
          <div className="bg-white rounded-xl border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-gray-900"><T k="감염관리 체크리스트" /></h2>
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
                        ? 'bg-amber-600 border-amber-600'
                        : 'border-gray-300 group-hover:border-amber-400'
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
                    <T k={item} />
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* 비고 */}
          {selectedOrder.notes && (
            <div className="bg-white rounded-xl border p-4">
              <h2 className="text-sm font-bold text-gray-900 mb-2"><T k="비고" /></h2>
              <p className="text-xs text-gray-600">{selectedOrder.notes}</p>
            </div>
          )}

          {/* 액션 버튼 */}
          <div className="space-y-2">
            {selectedOrder.status === 'ORDERED' && (
              <button
                onClick={() => receive.mutate(selectedOrder.orderId)}
                disabled={receive.isPending}
                className="min-h-[44px] w-full py-2.5 bg-amber-600 text-white rounded-xl text-sm font-semibold hover:bg-amber-700 disabled:opacity-50 transition-colors"
              >
                <T k="역학조사 접수" />
              </button>
            )}
            {selectedOrder.status === 'RECEIVED' && (
              <button
                onClick={() => start.mutate(selectedOrder.orderId)}
                disabled={start.isPending}
                className="min-h-[44px] w-full py-2.5 bg-red-600 text-white rounded-xl text-sm font-semibold hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                <T k="격리 조치 시작" />
              </button>
            )}
            {selectedOrder.status === 'IN_PROGRESS' && (
              <button
                onClick={() => complete.mutate(selectedOrder.orderId)}
                disabled={complete.isPending} /* 🔴 로컬 체크는 게이트가 아니다 */
                className="min-h-[44px] w-full py-2.5 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                {allChecked
                  ? <T k="감염관리 완료 처리" />
                  : <><T k="체크리스트 확인 필요" /> ({CHECKLIST_ITEMS.filter((i) => checklist[i]).length}/{CHECKLIST_ITEMS.length})</>}
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
