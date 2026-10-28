'use client';

import { useState } from 'react';
import { kdate } from '@/lib/ui-settings';
import { StationConfigNotice } from '@/components/workstation/StationConfigNotice';
import { Unit } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T } from '@/components/ui/i18n-text';

// ─── 인터페이스 정의 ───────────────────────────────────────────────
interface WsPatient {
  mrn: string;
  familyName: string;
  givenName: string;
  birthDate?: string;
  gender?: string;
}

interface WsOrder {
  orderId: string;
  status: 'ORDERED' | 'RECEIVED' | 'IN_PROGRESS' | 'COMPLETED';
  priority: 'ROUTINE' | 'URGENT' | 'STAT';
  procedureCode?: string;
  procedureName?: string;
  patient?: WsPatient;
  requestedAt?: string;
  startedAt?: string;
  completedAt?: string;
  therapyType?: string;
  therapistName?: string;
  sessionNo?: number;
  totalSessions?: number;
  durationMin?: number;
}

// ─── 상수 ────────────────────────────────────────────────────────
const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  ORDERED:     { label: '대기',   cls: 'bg-gray-100 text-gray-600' },
  RECEIVED:    { label: '접수',   cls: 'bg-violet-100 text-violet-700' },
  IN_PROGRESS: { label: '치료중', cls: 'bg-amber-100 text-amber-700' },
  COMPLETED:   { label: '완료',   cls: 'bg-violet-200 text-violet-800' },
};

const WORKFLOW_STEPS = ['접수', '치료준비', '치료수행', '완료'];

const THERAPY_TYPE_LABEL: Record<string, { label: string; desc: string }> = {
  PT:    { label: 'PT', desc: '물리치료' },
  OT:    { label: 'OT', desc: '작업치료' },
  ST:    { label: 'ST', desc: '언어치료' },
  OTHER: { label: '기타', desc: '기타치료' },
};

// ─── 유틸 ────────────────────────────────────────────────────────
function FormatTime(iso?: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '-';
  return kdate(d, 'time');
}

function WorkflowStep({ status }: { status: string }) {
  const idx =
    status === 'ORDERED'     ? 0 :
    status === 'RECEIVED'    ? 1 :
    status === 'IN_PROGRESS' ? 2 : 3;

  return (
    <div className="flex items-center gap-1">
      {WORKFLOW_STEPS.map((step, i) => (
        <div key={step} className="flex items-center gap-1">
          <div className={`flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold ${
            i < idx  ? 'bg-violet-500 text-white' :
            i === idx ? 'bg-violet-600 text-white ring-2 ring-violet-200' :
            'bg-gray-100 text-gray-400'
          }`}>
            {i < idx ? '✓' : i + 1}
          </div>
          <span className={`text-[10px] font-medium ${i === idx ? 'text-violet-700' : i < idx ? 'text-violet-500' : 'text-gray-400'}`}>
            {step}
          </span>
          {i < WORKFLOW_STEPS.length - 1 && (
            <div className={`w-4 h-0.5 ${i < idx ? 'bg-violet-400' : 'bg-gray-200'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── 상세 패널 ────────────────────────────────────────────────────
function DetailPanel({
  order,
  onReceive,
  onStart,
  onComplete,
  onClose,
}: {
  order: WsOrder;
  onReceive: () => void;
  onStart: () => void;
  onComplete: () => void;
  onClose: () => void;
}) {
  const fullName = `${order.patient?.familyName ?? ''}${order.patient?.givenName ?? ''}`;
  const therapyInfo = THERAPY_TYPE_LABEL[order.therapyType ?? ''];

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-96 bg-white border-l shadow-2xl flex flex-col overflow-y-auto">
      {/* 헤더 */}
      <div className="sticky top-0 z-10 bg-violet-600 px-5 py-4 flex items-center justify-between">
        <div>
          <p className="text-xs text-violet-100"><T k="재활 업무 상세" /></p>
          <p className="text-lg font-bold text-white">{fullName}</p>
        </div>
        <button onClick={onClose} className="text-violet-100 hover:text-white text-xl font-bold leading-none">×</button>
      </div>

      <div className="flex-1 p-5 space-y-5">
        {/* 환자 정보 */}
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2"><T k="환자 정보" /></h3>
          <div className="bg-gray-50 rounded-xl p-4 grid grid-cols-2 gap-y-2 text-sm">
            <span className="text-gray-500"><T k="환자번호" /></span>
            <span className="font-medium text-gray-800">{order.patient?.mrn ?? '-'}</span>
            <span className="text-gray-500"><T k="성명" /></span>
            <span className="font-medium text-gray-800">{fullName || '-'}</span>
            <span className="text-gray-500"><T k="생년월일" /></span>
            <span className="font-medium text-gray-800">{order.patient?.birthDate ?? '-'}</span>
            <span className="text-gray-500"><T k="성별" /></span>
            <span className="font-medium text-gray-800">{order.patient?.gender === 'M' ? '남' : order.patient?.gender === 'F' ? '여' : '-'}</span>
          </div>
        </section>

        {/* 치료 정보 */}
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2"><T k="치료 정보" /></h3>
          <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500"><T k="업무명" /></span>
              <span className="font-medium text-gray-800">{order.procedureName || order.procedureCode || '-'}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-gray-500"><T k="치료유형" /></span>
              <div className="text-right">
                {therapyInfo ? (
                  <span className="font-bold text-violet-700">{therapyInfo.label}
                    <span className="ml-1 text-xs font-normal text-gray-500">({therapyInfo.desc})</span>
                  </span>
                ) : (
                  <span className="font-medium text-gray-800">{order.therapyType ?? '-'}</span>
                )}
              </div>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500"><T k="치료사" /></span>
              <span className="font-medium text-gray-800">{order.therapistName ?? '-'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500"><T k="세션" /></span>
              <span className="font-medium text-violet-700">
                {order.sessionNo != null && order.totalSessions != null
                  ? `${order.sessionNo} / ${order.totalSessions} 회`
                  : '-'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500"><T k="치료시간" /></span>
              <span className="font-medium text-gray-800">
                {order.durationMin != null ? `${order.durationMin}분` : '-'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500"><T k="접수시각" /></span>
              <span className="font-medium text-gray-800">{FormatTime(order.requestedAt)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500"><T k="우선순위" /></span>
              <span className={`font-semibold whitespace-nowrap ${order.priority === 'STAT' ? 'text-red-600' : order.priority === 'URGENT' ? 'text-amber-600' : 'text-gray-600'}`}>
                {order.priority === 'STAT' ? 'STAT' : order.priority === 'URGENT' ? '긴급' : '일반'}
              </span>
            </div>
          </div>
        </section>

        {/* 세션 진행률 */}
        {order.sessionNo != null && order.totalSessions != null && (
          <section>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2"><T k="세션 진행률" /></h3>
            <div className="bg-gray-50 rounded-xl p-4">
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span><T k="진행" /></span>
                <span>{order.sessionNo}/{order.totalSessions} 회</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-violet-500 h-2 rounded-full transition-all"
                  style={{ width: `${Math.min((order.sessionNo / order.totalSessions) * 100, 100)}%` }}
                />
              </div>
            </div>
          </section>
        )}

        {/* 워크플로우 */}
        <section>
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2"><T k="진행 단계" /></h3>
          <div className="bg-gray-50 rounded-xl p-4">
            <WorkflowStep status={order.status} />
          </div>
        </section>
      </div>

      {/* 액션 버튼 */}
      <div className="sticky bottom-0 bg-white border-t p-4 space-y-2">
        {order.status === 'ORDERED' && (
          <button
            onClick={onReceive}
            className="w-full py-2.5 bg-violet-600 text-white rounded-xl text-sm font-semibold hover:bg-violet-700 transition-colors"
          >
            <T k="접수@버튼" />
          </button>
        )}
        {order.status === 'RECEIVED' && (
          <button
            onClick={onStart}
            className="w-full py-2.5 bg-amber-500 text-white rounded-xl text-sm font-semibold hover:bg-amber-600 transition-colors"
          >
            <T k="치료 시작" />
          </button>
        )}
        {order.status === 'IN_PROGRESS' && (
          <button
            onClick={onComplete}
            className="w-full py-2.5 bg-violet-700 text-white rounded-xl text-sm font-semibold hover:bg-violet-800 transition-colors"
          >
            <T k="치료 완료" />
          </button>
        )}
        <Link href="/therapy" className="block w-full py-2 border border-violet-300 text-violet-700 rounded-xl text-sm font-medium text-center hover:bg-violet-50 transition-colors">
          <T k="치료실 메인 바로가기" />
        </Link>
      </div>
    </div>
  );
}

// ─── 메인 페이지 ─────────────────────────────────────────────────
export default function RehabStationWorkstationPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'ALL' | 'ORDERED' | 'IN_PROGRESS' | 'COMPLETED'>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: queueRes, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['ws-rehab-station-queue'],
    queryFn: () => apiClient.get<{ data: WsOrder[] }>('/api/v1/workstation/station/rehab-station/queue'),
    refetchInterval: 8000,
  });

  const allOrders: WsOrder[] = queueRes?.data ?? [];
  const stationMeta = (queueRes as { meta?: Record<string, unknown> } | undefined)?.meta;
  const waiting    = allOrders.filter(o => o.status === 'ORDERED');
  const inProgress = allOrders.filter(o => o.status === 'RECEIVED' || o.status === 'IN_PROGRESS');
  const completed  = allOrders.filter(o => o.status === 'COMPLETED');

  const filtered =
    tab === 'ALL'         ? allOrders :
    tab === 'ORDERED'     ? waiting :
    tab === 'IN_PROGRESS' ? inProgress :
                            completed;

  const selectedOrder = allOrders.find(o => o.orderId === selectedId) ?? null;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['ws-rehab-station-queue'] });

  const receive = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/workstation/order/${id}/receive`),
    onSuccess: () => { invalidate(); toast.success('접수 완료'); },
  });
  const start = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/workstation/order/${id}/start`),
    onSuccess: () => { invalidate(); toast.success('재활 치료 시작'); },
  });
  const complete = useMutation({
    mutationFn: (id: string) => apiClient.patch(`/api/v1/workstation/order/${id}/complete`),
    onSuccess: () => { invalidate(); toast.success('재활 치료 완료'); setSelectedId(null); },
  });

  const TABS = [
    { key: 'ALL',         label: '전체',   count: allOrders.length },
    { key: 'ORDERED',     label: '대기',   count: waiting.length },
    { key: 'IN_PROGRESS', label: '진행중', count: inProgress.length },
    { key: 'COMPLETED',   label: '완료',   count: completed.length },
  ] as const;

  return (
    <div className="space-y-5">
      <StationConfigNotice meta={stationMeta} />
      {/* 헤더 */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900"><T k="재활 워크스테이션" /></h1>
          <p className="text-sm text-gray-500 mt-0.5">8초 자동 갱신 · 오늘 총 {allOrders.length}<Unit>건</Unit></p>
        </div>
        <Link href="/therapy" className="px-3 py-1.5 text-xs font-medium border border-violet-300 text-violet-700 rounded-lg hover:bg-violet-50 transition-colors whitespace-nowrap">
          <T k="치료실 메인" />
        </Link>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white border rounded-xl p-4 flex flex-col gap-1">
          <span className="text-xs text-gray-500 font-medium"><T k="대기" /></span>
          <span className="text-3xl font-bold text-gray-700">{waiting.length}</span>
          <span className="text-xs text-gray-400">건</span>
        </div>
        <div className="bg-white border border-amber-200 rounded-xl p-4 flex flex-col gap-1">
          <span className="text-xs text-amber-600 font-medium"><T k="진행중" /></span>
          <span className="text-3xl font-bold text-amber-600">{inProgress.length}</span>
          <span className="text-xs text-amber-400">건</span>
        </div>
        <div className="bg-white border border-violet-200 rounded-xl p-4 flex flex-col gap-1">
          <span className="text-xs text-violet-600 font-medium"><T k="완료" /></span>
          <span className="text-3xl font-bold text-violet-600">{completed.length}</span>
          <span className="text-xs text-violet-400">건</span>
        </div>
      </div>

      {/* 필터 탭 */}
      <div className="flex gap-1 border-b border-gray-100">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-3 py-2 text-xs font-semibold rounded-t transition-colors ${
              tab === t.key
                ? 'bg-violet-50 text-violet-700 border-b-2 border-violet-600'
                : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            {t.label} ({t.count})
          </button>
        ))}
      </div>

      {/* 테이블 */}
      {isLoading ? (
        <div className="py-20 text-center text-gray-400">
          <div className="w-8 h-8 border-2 border-violet-400 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <T k="로딩 중..." />
        </div>
      ) : isError ? (
        <QueryErrorFallback error={error} onRetry={refetch} />
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center text-gray-400">
          <div className="text-4xl mb-3">🏃</div>
          <p><T k="해당 업무가 없습니다" /></p>
        </div>
      ) : (
        <div className="bg-white border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500"><T k="긴급" /></th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500"><T k="상태" /></th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500"><T k="환자" /></th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500"><T k="업무" /></th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500"><T k="치료유형" /></th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500"><T k="치료사" /></th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500"><T k="세션" /></th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500"><T k="시간" /></th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500"><T k="작업" /></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(item => (
                <tr
                  key={item.orderId}
                  onClick={() => setSelectedId(item.orderId === selectedId ? null : item.orderId)}
                  className={`cursor-pointer hover:bg-violet-50/40 transition-colors ${
                    item.priority === 'STAT' ? 'bg-red-50/40' :
                    selectedId === item.orderId ? 'bg-violet-50' : ''
                  }`}
                >
                  <td className="px-4 py-3">
                    {item.priority === 'STAT' && (
                      <span className="px-1.5 py-0.5 bg-red-600 text-white text-[10px] font-bold rounded animate-pulse whitespace-nowrap">STAT</span>
                    )}
                    {item.priority === 'URGENT' && (
                      <span className="px-1.5 py-0.5 bg-amber-500 text-white text-[10px] font-bold rounded whitespace-nowrap"><T k="긴급" /></span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${STATUS_BADGE[item.status]?.cls ?? 'bg-gray-100'}`}>
                      {STATUS_BADGE[item.status]?.label ?? item.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-gray-900">
                      {item.patient?.familyName}{item.patient?.givenName}
                    </p>
                    <p className="text-xs text-gray-400">{item.patient?.mrn}</p>
                  </td>
                  <td className="px-4 py-3 text-gray-700">
                    {item.procedureName || item.procedureCode || '-'}
                  </td>
                  <td className="px-4 py-3">
                    {item.therapyType ? (
                      <span className="text-xs font-bold text-violet-700 bg-violet-50 px-2 py-0.5 rounded-full whitespace-nowrap">
                        {THERAPY_TYPE_LABEL[item.therapyType]?.label ?? item.therapyType}
                      </span>
                    ) : '-'}
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs">
                    {item.therapistName ?? '-'}
                  </td>
                  <td className="px-4 py-3 text-gray-600 text-xs whitespace-nowrap">
                    {item.sessionNo != null && item.totalSessions != null
                      ? `${item.sessionNo}/${item.totalSessions}회`
                      : '-'}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">
                    {FormatTime(item.requestedAt)}
                  </td>
                  <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                    <div className="flex gap-1">
                      {item.status === 'ORDERED' && (
                        <button
                          onClick={() => receive.mutate(item.orderId)}
                          className="px-2.5 py-1 bg-violet-600 text-white rounded-lg text-xs font-medium hover:bg-violet-700 whitespace-nowrap"
                        >
                          <T k="접수@버튼" />
                        </button>
                      )}
                      {item.status === 'RECEIVED' && (
                        <button
                          onClick={() => start.mutate(item.orderId)}
                          className="px-2.5 py-1 bg-amber-500 text-white rounded-lg text-xs font-medium hover:bg-amber-600 whitespace-nowrap"
                        >
                          <T k="시작" />
                        </button>
                      )}
                      {item.status === 'IN_PROGRESS' && (
                        <button
                          onClick={() => complete.mutate(item.orderId)}
                          className="px-2.5 py-1 bg-violet-700 text-white rounded-lg text-xs font-medium hover:bg-violet-800 whitespace-nowrap"
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

      {/* 상세 패널 */}
      {selectedOrder && (
        <>
          <div className="fixed inset-0 z-30 bg-black/20" onClick={() => setSelectedId(null)} />
          <DetailPanel
            order={selectedOrder}
            onReceive={() => receive.mutate(selectedOrder.orderId)}
            onStart={() => start.mutate(selectedOrder.orderId)}
            onComplete={() => complete.mutate(selectedOrder.orderId)}
            onClose={() => setSelectedId(null)}
          />
        </>
      )}
    </div>
  );
}
