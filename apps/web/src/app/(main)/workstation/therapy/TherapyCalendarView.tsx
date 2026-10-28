'use client';

import { useState, useMemo } from 'react';
import { Unit } from '@/components/ui/display';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { pollMs } from '@/lib/ui-settings';
import { kstToday } from '@/lib/kst-today';
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
  completedAt?: string;
  order?: {
    status: string;
    prescription?: { encounter?: { patient?: { familyName?: string; givenName?: string; mrn?: string } } };
  };
  therapist?: { familyName?: string; givenName?: string };
}

const THERAPY_COLORS: Record<string, string> = {
  '운동치료': 'bg-blue-100 text-blue-700 border-blue-200',
  '도수치료': 'bg-indigo-100 text-indigo-700 border-indigo-200',
  '열전기치료': 'bg-amber-100 text-amber-700 border-amber-200',
  '작업치료': 'bg-emerald-100 text-emerald-700 border-emerald-200',
  '언어치료': 'bg-violet-100 text-violet-700 border-violet-200',
  '호흡재활': 'bg-cyan-100 text-cyan-700 border-cyan-200',
  '수치료': 'bg-sky-100 text-sky-700 border-sky-200',
  '투석': 'bg-red-100 text-red-700 border-red-200',
  '항암치료': 'bg-pink-100 text-pink-700 border-pink-200',
  '방사선치료': 'bg-orange-100 text-orange-700 border-orange-200',
};

type ViewMode = 'week' | 'month';

export function TherapyCalendarView() {
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [baseDate, setBaseDate] = useState(() => new Date());

  // Calculate date range
  const { startDate, endDate, days } = useMemo(() => {
    const start = new Date(baseDate);
    if (viewMode === 'week') {
      const dow = start.getDay();
      start.setDate(start.getDate() - (dow === 0 ? 6 : dow - 1)); // Monday
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      const d: Date[] = [];
      for (let i = 0; i < 7; i++) {
        const day = new Date(start);
        day.setDate(start.getDate() + i);
        d.push(day);
      }
      return { startDate: start, endDate: end, days: d };
    } else {
      start.setDate(1);
      const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
      // Start from Monday of the week containing the 1st
      const dow = start.getDay();
      const calStart = new Date(start);
      calStart.setDate(start.getDate() - (dow === 0 ? 6 : dow - 1));
      const d: Date[] = [];
      for (let i = 0; i < 42; i++) { // 6 weeks max
        const day = new Date(calStart);
        day.setDate(calStart.getDate() + i);
        d.push(day);
      }
      return { startDate: calStart, endDate: end, days: d };
    }
  }, [baseDate, viewMode]);

  // Fetch therapy orders for the range
  /**
   * 🔴 한 캘린더가 날짜 기준 셋을 섞어 쓰고 있었다(2026-09-02) — 라벨은 로컬(`getDate()`),
   *    키·조회 범위는 **UTC**(`toISOString()`), 오늘 판정만 KST(`kstToday()`).
   *    KST 00~09시에는 `toISOString()` 이 전날을 주므로 조회 범위 전체가 하루 당겨진다
   *    (재활 치료사가 그날 일정을 세팅하는 아침이 정확히 그 구간이다).
   *    가드 `utc-today-guard` 는 인라인 `new Date().toISOString()` 만 잡아 이 형태를 놓쳤다.
   */
  const ymdKst = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  const fromStr = ymdKst(startDate);
  const toStr = viewMode === 'week' ? ymdKst(endDate) : ymdKst(days[days.length - 1]);

  const { data: ordersData, isLoading, refetch } = useQuery({
    queryKey: ['therapy-calendar', fromStr, toStr],
    queryFn: async () => {
      // Fetch each day in range (API supports single date)
      // Use stats endpoint for overview
      const results: TherapyOrder[] = [];
      const failed: string[] = [];
      const dates: string[] = [];
      const current = new Date(fromStr);
      const end = new Date(toStr);
      while (current <= end) {
        dates.push(current.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }));
        current.setDate(current.getDate() + 1);
      }
      // Fetch in batches of 7
      for (let i = 0; i < dates.length; i += 7) {
        const batch = dates.slice(i, i + 7);
        // 🔴 하루치 조회가 실패하면 종전엔 `[]` 로 접었다 — 그 날은 화면에서 **"예약 없음"**이 됐다.
        //    치료사가 "그날은 일정이 없다"고 읽는다. 실패한 날짜를 그대로 들고 나가 화면이 말하게 한다.
        const promises = batch.map(d =>
          apiClient.get<{ data: TherapyOrder[] }>('/api/v1/therapy-orders/schedule', { date: d })
            .then(r => ({ date: d, ok: true, rows: (Array.isArray(r.data) ? r.data : (r.data as any)?.data ?? []) as TherapyOrder[] }))
            .catch(() => ({ date: d, ok: false, rows: [] as TherapyOrder[] }))
        );
        const batchResults = await Promise.all(promises);
        for (const b of batchResults) {
          if (b.ok) results.push(...b.rows);
          else failed.push(b.date);
        }
      }
      return { orders: results, failedDates: failed };
    },
    refetchInterval: pollMs('normal'),
  });

  const orders = ordersData?.orders ?? [];
  // 🔴 불러오지 못한 날 — 그 날의 빈 칸은 "예약 없음"이 아니라 "모름"이다.
  const failedDates = new Set(ordersData?.failedDates ?? []);

  // Group orders by date
  const ordersByDate = useMemo(() => {
    const map: Record<string, TherapyOrder[]> = {};
    for (const o of orders) {
      const d = o.scheduledDate?.slice(0, 10);
      if (!d) continue;
      if (!map[d]) map[d] = [];
      map[d].push(o);
    }
    return map;
  }, [orders]);

  // Navigation
  const navigate = (dir: -1 | 1) => {
    const d = new Date(baseDate);
    if (viewMode === 'week') d.setDate(d.getDate() + dir * 7);
    else d.setMonth(d.getMonth() + dir);
    setBaseDate(d);
  };

  const todayStr = kstToday();
  const DOW = ['월', '화', '수', '목', '금', '토', '일'];

  const getPatientName = (o: TherapyOrder) => {
    const p = o.order?.prescription?.encounter?.patient;
    return p ? `${p.familyName ?? ''}${p.givenName ?? ''}` : '';
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={() => navigate(-1)} className="px-2 py-1 bg-gray-100 rounded hover:bg-gray-200 text-sm">◀</button>
          <h3 className="text-sm font-semibold text-gray-900 min-w-[140px] text-center">
            {viewMode === 'week'
              ? `${startDate.getMonth() + 1}/${startDate.getDate()} ~ ${endDate.getMonth() + 1}/${endDate.getDate()}`
              : `${baseDate.getFullYear()}년 ${baseDate.getMonth() + 1}월`
            }
          </h3>
          <button onClick={() => navigate(1)} className="px-2 py-1 bg-gray-100 rounded hover:bg-gray-200 text-sm">▶</button>
          <button onClick={() => setBaseDate(new Date())} className="px-3 py-1 bg-gray-100 rounded-lg text-xs ml-2"><T k="오늘" /></button>
        </div>
        <div className="flex gap-1 bg-gray-100 p-0.5 rounded-lg">
          <button onClick={() => setViewMode('week')}
            className={`px-3 py-1 text-xs rounded-md ${viewMode === 'week' ? 'bg-white shadow-sm font-medium' : 'text-gray-500'}`}><T k="주간" /></button>
          <button onClick={() => setViewMode('month')}
            className={`px-3 py-1 text-xs rounded-md ${viewMode === 'month' ? 'bg-white shadow-sm font-medium' : 'text-gray-500'}`}><T k="월간" /></button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(THERAPY_COLORS).map(([type, cls]) => (
          <span key={type} className={`px-2 py-0.5 text-[10px] rounded-full border ${cls}`}>{type}</span>
        ))}
      </div>

      {isLoading && (
        <div className="py-8 text-center text-gray-400 animate-pulse"><T k="캘린더 데이터 로딩 중..." /></div>
      )}

      {/* 🔴 부분 실패를 숨기지 않는다 — 아래 집계는 불러온 날짜만의 값이다 */}
      {!isLoading && failedDates.size > 0 && (
        <div className="flex items-center justify-between gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <span>{failedDates.size}일치를 불러오지 못했습니다 — 그 날의 일정은 <b>비어 있는 것이 아니라 모르는 상태</b>입니다.</span>
          <button onClick={() => refetch()} className="px-2 py-0.5 rounded-lg border border-red-300 hover:bg-red-100 whitespace-nowrap"><T k="재시도" /></button>
        </div>
      )}

      {/* Week View */}
      {!isLoading && viewMode === 'week' && (
        <div className="grid grid-cols-7 gap-1">
          {/* Header */}
          {days.map((d, i) => {
            const dateStr = d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
            const isToday = dateStr === todayStr;
            const isSat = d.getDay() === 6;
            const isSun = d.getDay() === 0;
            return (
              <div key={i} className={`text-center py-2 rounded-t-lg ${isToday ? 'bg-blue-600 text-white' : 'bg-gray-50'}`}>
                <div className={`text-[10px] ${isToday ? 'text-blue-100' : isSun ? 'text-red-400' : isSat ? 'text-blue-400' : 'text-gray-400'}`}>{DOW[i]}</div>
                <div className={`text-sm font-bold ${isToday ? '' : isSun ? 'text-red-600' : isSat ? 'text-blue-600' : 'text-gray-900'}`}>{d.getDate()}</div>
              </div>
            );
          })}
          {/* Content */}
          {days.map((d, i) => {
            const dateStr = d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
            const dayOrders = ordersByDate[dateStr] ?? [];
            const isToday = dateStr === todayStr;
            return (
              <div key={`c-${i}`} className={`min-h-[120px] border rounded-b-lg p-1 space-y-0.5 overflow-y-auto ${isToday ? 'border-blue-300 bg-blue-50/30' : 'border-gray-100'}`}>
                {failedDates.has(dateStr) && (
                  <div className="text-[10px] text-red-600 bg-red-50 border border-red-200 rounded px-1 py-0.5"><T k="불러오지 못함" /></div>
                )}
                {dayOrders.slice(0, 8).map(o => {
                  const color = THERAPY_COLORS[o.therapyType] ?? 'bg-gray-100 text-gray-600 border-gray-200';
                  return (
                    <div key={o.id} className={`px-1.5 py-0.5 rounded border text-[10px] leading-tight truncate ${color} ${o.completedAt ? 'opacity-50 line-through' : ''}`}
                      title={`${o.therapyType} - ${getPatientName(o)} ${o.scheduledTime ?? ''}`}>
                      {o.scheduledTime && <span className="font-mono mr-0.5">{o.scheduledTime}</span>}
                      {getPatientName(o) || o.therapyType}
                    </div>
                  );
                })}
                {dayOrders.length > 8 && (
                  <div className="text-[9px] text-gray-400 text-center">+{dayOrders.length - 8}<Unit>건</Unit></div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Month View */}
      {!isLoading && viewMode === 'month' && (
        <div className="grid grid-cols-7 gap-px bg-gray-200 rounded-lg overflow-hidden">
          {/* Header */}
          {DOW.map(d => (
            <div key={d} className="bg-gray-50 text-center py-1.5 text-[10px] font-medium text-gray-500">{d}</div>
          ))}
          {/* Days */}
          {days.map((d, i) => {
            const dateStr = d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
            const dayOrders = ordersByDate[dateStr] ?? [];
            const isToday = dateStr === todayStr;
            const isCurrentMonth = d.getMonth() === baseDate.getMonth();
            const completed = dayOrders.filter(o => o.completedAt).length;
            const pending = dayOrders.length - completed;
            return (
              <div key={i} className={`bg-white min-h-[60px] p-1 ${!isCurrentMonth ? 'opacity-40' : ''}`}>
                <div className={`text-xs font-medium mb-0.5 ${isToday ? 'bg-blue-600 text-white w-5 h-5 rounded-full flex items-center justify-center' : 'text-gray-700'}`}>
                  {d.getDate()}
                </div>
                {failedDates.has(dateStr) && (
                  <div className="text-[9px] text-red-600"><T k="불러오지 못함" /></div>
                )}
                {dayOrders.length > 0 && (
                  <div className="space-y-0.5">
                    {dayOrders.slice(0, 3).map(o => {
                      const color = THERAPY_COLORS[o.therapyType] ?? 'bg-gray-100 text-gray-600 border-gray-200';
                      return (
                        <div key={o.id} className={`px-1 py-px rounded text-[9px] truncate ${color} ${o.completedAt ? 'opacity-50' : ''}`}>
                          {getPatientName(o) || o.therapyType}
                        </div>
                      );
                    })}
                    {dayOrders.length > 3 && (
                      <div className="text-[9px] text-gray-400">+{dayOrders.length - 3}</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Stats Summary */}
      {!isLoading && (
        <div className="grid grid-cols-4 gap-3">
          {(() => {
            const total = orders.length;
            const done = orders.filter(o => o.completedAt).length;
            const types = [...new Set(orders.map(o => o.therapyType))];
            const patients = [...new Set(orders.map(o => getPatientName(o)).filter(Boolean))];
            return (
              <>
                <div className="bg-white border rounded-xl p-3 text-center">
                  <div className="text-lg font-bold text-gray-900">{total}</div>
                  <div className="text-[10px] text-gray-500">총 일정{failedDates.size > 0 && <span className="text-red-600"> · {failedDates.size}일 제외</span>}</div>
                </div>
                <div className="bg-white border rounded-xl p-3 text-center">
                  <div className="text-lg font-bold text-emerald-600">{done}</div>
                  <div className="text-[10px] text-gray-500"><T k="완료" /></div>
                </div>
                <div className="bg-white border rounded-xl p-3 text-center">
                  <div className="text-lg font-bold text-blue-600">{types.length}</div>
                  <div className="text-[10px] text-gray-500"><T k="치료 유형" /></div>
                </div>
                <div className="bg-white border rounded-xl p-3 text-center">
                  <div className="text-lg font-bold text-violet-600">{patients.length}</div>
                  <div className="text-[10px] text-gray-500"><T k="환자 수" /></div>
                </div>
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}
