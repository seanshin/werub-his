'use client';

import { useState, useMemo } from 'react';
import { Unit } from '@/components/ui/display';
import { useQuery } from '@tanstack/react-query';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { apiClient } from '@/lib/api-client';
import { T } from '@/components/ui/i18n-text';

interface TherapyOrder {
  id: string;
  therapyType: string;
  scheduledDate: string;
  scheduledTime?: string;
  duration?: number;
  stationId?: string;
  sessionNo?: number;
  totalSessions?: number;
  isRecurring?: boolean;
  recurPattern?: string;
  resultData?: Record<string, unknown>;
  completedAt?: string;
  createdAt: string;
  therapist?: { familyName?: string; givenName?: string };
  order?: { status: string };
}

const THERAPY_COLOR: Record<string, string> = {
  '운동치료': 'bg-blue-100 text-blue-700',
  '도수치료': 'bg-indigo-100 text-indigo-700',
  '열전기치료': 'bg-amber-100 text-amber-700',
  '작업치료': 'bg-emerald-100 text-emerald-700',
  '언어치료': 'bg-violet-100 text-violet-700',
  '호흡재활': 'bg-cyan-100 text-cyan-700',
  '수치료': 'bg-sky-100 text-sky-700',
  '투석': 'bg-red-100 text-red-700',
  '항암치료': 'bg-pink-100 text-pink-700',
  '방사선치료': 'bg-orange-100 text-orange-700',
};

const RECUR_LABEL: Record<string, string> = {
  DAILY: '매일', MWF: '월수금', TTS: '화목토', WEEKLY: '매주',
};

interface TherapyHistoryTabProps {
  patientId: string;
}

export function TherapyHistoryTab({ patientId }: TherapyHistoryTabProps) {
  const [filter, setFilter] = useState<'all' | 'active' | 'completed'>('all');

  // 환자별 치료 오더 이력 — 전용 EP(therapy-orders/patient/:id, 감사 보류건 해소)
  const { data: ordersData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['patient-therapy-history', patientId],
    queryFn: async () => {
      // 🔴 종전엔 `.catch(() => ({ data: [] }))` 라 조회 실패가 "치료 이력 없음"으로 보였다.
      //    `isError` 는 이미 구조분해돼 있었지만 catch 때문에 영원히 false 였다(도달 불가).
      const res = await apiClient.get<{ data: TherapyOrder[] }>(`/api/v1/therapy-orders/patient/${patientId}`);
      const raw = res.data;
      return Array.isArray(raw) ? raw : (raw as Record<string, unknown>)?.data as TherapyOrder[] ?? [];
    },
    enabled: !!patientId,
  });

  const orders = ordersData ?? [];

  // Group by therapy type for summary
  const grouped = useMemo(() => {
    const map: Record<string, TherapyOrder[]> = {};
    for (const o of orders) {
      const t = o.therapyType || '기타';
      if (!map[t]) map[t] = [];
      map[t].push(o);
    }
    return map;
  }, [orders]);

  const filtered = useMemo(() => {
    if (filter === 'active') return orders.filter(o => !o.completedAt);
    if (filter === 'completed') return orders.filter(o => !!o.completedAt);
    return orders;
  }, [orders, filter]);

  const completedCount = orders.filter(o => o.completedAt).length;
  const activeCount = orders.length - completedCount;
  const progressPercent = orders.length > 0 ? Math.round((completedCount / orders.length) * 100) : 0;

  // 🔴 에러를 로딩·빈 상태보다 먼저 판정한다 — "없음"과 "못 불러옴"은 다른 사실이다.
  if (isError) {
    return <QueryErrorFallback error={error} onRetry={refetch} />;
  }

  if (isLoading) {
    return <div className="py-12 text-center text-gray-400 animate-pulse"><T k="치료 이력 로딩 중..." /></div>;
  }

  if (orders.length === 0) {
    return (
      <div className="py-16 text-center">
        <div className="text-4xl mb-3">🏋️</div>
        <p className="text-gray-500 text-sm"><T k="등록된 치료 오더가 없습니다" /></p>
        <p className="text-gray-400 text-xs mt-1"><T k="처방 화면에서 치료 오더를 생성하세요" /></p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-white border rounded-xl p-3">
          <div className="text-lg font-bold text-gray-900">{orders.length}</div>
          <div className="text-[10px] text-gray-500"><T k="총 세션" /></div>
        </div>
        <div className="bg-white border rounded-xl p-3">
          <div className="text-lg font-bold text-emerald-600">{completedCount}</div>
          <div className="text-[10px] text-gray-500"><T k="완료" /></div>
        </div>
        <div className="bg-white border rounded-xl p-3">
          <div className="text-lg font-bold text-blue-600">{activeCount}</div>
          <div className="text-[10px] text-gray-500"><T k="예정/진행" /></div>
        </div>
        <div className="bg-white border rounded-xl p-3">
          <div className="text-lg font-bold text-violet-600">{progressPercent}<Unit>%</Unit></div>
          <div className="text-[10px] text-gray-500"><T k="진행률" /></div>
          <div className="mt-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
      </div>

      {/* Type Summary */}
      <div className="bg-white border rounded-xl p-4">
        <h4 className="text-xs font-semibold text-gray-700 mb-2"><T k="치료 유형별 현황" /></h4>
        <div className="flex flex-wrap gap-2">
          {Object.entries(grouped).map(([type, items]) => {
            const done = items.filter(i => i.completedAt).length;
            const color = THERAPY_COLOR[type] ?? 'bg-gray-100 text-gray-700';
            return (
              <div key={type} className={`px-3 py-1.5 rounded-lg ${color} text-xs font-medium`}>
                {type} <span className="opacity-70">{done}/{items.length}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Filter */}
      <div className="flex gap-1.5">
        {([
          { k: 'all' as const, l: `전체 (${orders.length})` },
          { k: 'active' as const, l: `예정/진행 (${activeCount})` },
          { k: 'completed' as const, l: `완료 (${completedCount})` },
        ]).map(f => (
          <button key={f.k} onClick={() => setFilter(f.k)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
              filter === f.k ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
            }`}>{f.l}</button>
        ))}
      </div>

      {/* Timeline */}
      <div className="space-y-2">
        {filtered.map(o => {
          const color = THERAPY_COLOR[o.therapyType] ?? 'bg-gray-100 text-gray-700';
          const isDone = !!o.completedAt;
          return (
            <div key={o.id} className={`bg-white border rounded-xl p-3 flex items-center gap-3 ${isDone ? 'opacity-70' : ''}`}>
              {/* Status indicator */}
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isDone ? 'bg-emerald-500' : 'bg-amber-400'}`} />

              {/* Date */}
              <div className="w-20 flex-shrink-0">
                <div className="text-xs font-medium text-gray-900">{o.scheduledDate?.slice(5)}</div>
                {o.scheduledTime && <div className="text-[10px] text-gray-400">{o.scheduledTime}</div>}
              </div>

              {/* Type badge */}
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${color}`}>
                {o.therapyType}
              </span>

              {/* Details */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 text-xs text-gray-600">
                  {o.duration && <span>{o.duration}<Unit>분</Unit></span>}
                  {o.isRecurring && o.recurPattern && (
                    <span className="text-violet-600">🔄 {RECUR_LABEL[o.recurPattern] ?? o.recurPattern}</span>
                  )}
                  {o.sessionNo && o.totalSessions && (
                    <span className="text-gray-400">{o.sessionNo}/{o.totalSessions}<Unit>회</Unit></span>
                  )}
                </div>
              </div>

              {/* Therapist */}
              {o.therapist && (
                <span className="text-[10px] text-gray-400 flex-shrink-0">
                  {o.therapist.familyName}{o.therapist.givenName}
                </span>
              )}

              {/* Status */}
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap flex-shrink-0 ${
                isDone ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
              }`}>
                {isDone ? '완료' : '예정'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
