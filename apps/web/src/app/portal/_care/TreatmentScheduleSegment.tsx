'use client';

import { useQuery } from '@tanstack/react-query';
import { portalDateText } from '../_shared/portal-date';
import { apiClient } from '@/lib/api-client';
import { PT } from '../_shared/PT';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';

interface PortalScheduleItem {
  at: string;
  source: 'APPOINTMENT' | 'SURGERY' | 'PRE_ORDER' | 'PLAN' | string;
  title: string;
  status: string | null;
}
interface PortalSchedule {
  from: string;
  to: string;
  items: PortalScheduleItem[];
  counts: Record<string, number>;
}

const SOURCE_META: Record<string, { label: string; cls: string }> = {
  APPOINTMENT: { label: '예약', cls: 'bg-blue-100 text-blue-700' },
  SURGERY: { label: '수술', cls: 'bg-red-100 text-red-700' },
  PRE_ORDER: { label: '예정 검사', cls: 'bg-amber-100 text-amber-700' },
  PLAN: { label: '치료 계획', cls: 'bg-emerald-100 text-emerald-700' },
};

const STATUS_LABEL: Record<string, string> = {
  SCHEDULED: '예정', CONFIRMED: '확정', COMPLETED: '완료', CANCELLED: '취소',
  PLANNED: '계획', LINKED: '예정', PENDING: '예정', MODIFIED: '예정', APPROVED: '확정',
  CHECKED_IN: '접수', IN_PROGRESS: '진행 중', NO_SHOW: '미방문',
};

/** 치료 일정(P3) — 예약·수술·검사 예정·치료계획 read-only 병합 뷰 (변경은 병원 문의) */
export default function TreatmentScheduleSegment() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['portal-treatment-schedule'],
    queryFn: () => apiClient.get<{ data: PortalSchedule }>('/api/v1/portal/treatment-schedule'),
    staleTime: 60_000,
  });
  const raw = data?.data as unknown;
  const schedule: PortalSchedule | null = raw ? ((raw as { data?: PortalSchedule })?.data ?? (raw as PortalSchedule)) : null;

  if (isLoading) return <div className="h-40 bg-gray-100 rounded-xl animate-pulse" />;
  // 🔴 (포털 A6) 실패를 "예정된 일정 없음"으로 그리지 않는다
  if (isError) return <QueryErrorFallback error={error} onRetry={() => refetch()} size="compact" />;

  const items = schedule?.items ?? [];
  const todayKey = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  const byDate = new Map<string, PortalScheduleItem[]>();
  for (const it of items) {
    const key = new Date(it.at).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
    if (key < todayKey) continue; // 지난 일정은 진료이력이 SoT — 예정만 노출
    const list = byDate.get(key) ?? [];
    list.push(it);
    byDate.set(key, list);
  }
  const dates = [...byDate.keys()].sort();

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900"><PT k="치료 일정" /></h3>
        <span className="text-[11px] text-gray-400"><PT k="앞으로 60일" /></span>
      </div>

      {dates.length === 0 ? (
        <div className="bg-white rounded-xl border p-6 text-center">
          <p className="text-2xl mb-1">🗓️</p>
          <p className="text-sm text-gray-500"><PT k="예정된 치료 일정이 없습니다" /></p>
        </div>
      ) : (
        dates.map(date => {
          const isToday = date === todayKey;
          return (
            <div key={date} className={`bg-white rounded-xl border p-4 ${isToday ? 'border-emerald-300 ring-1 ring-emerald-100' : ''}`}>
              <p className={`text-xs font-semibold mb-2 ${isToday ? 'text-emerald-700' : 'text-gray-500'}`}>
                {portalDateText(`${date}T00:00:00+09:00`, 'monthDayWeekday')}
                {isToday && ' · 오늘'}
              </p>
              <div className="space-y-2">
                {byDate.get(date)!.map((it, i) => {
                  const meta = SOURCE_META[it.source] ?? { label: it.source, cls: 'bg-gray-100 text-gray-500' };
                  const time = portalDateText(it.at, 'time', { timeZone: 'Asia/Seoul' }) // 🔴 병원 시간대 고정은 종전 그대로;
                  return (
                    <div key={`${it.source}-${i}`} className="flex items-center gap-2 text-sm">
                      <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium ${meta.cls}`}>{meta.label}</span>
                      <span className="flex-1 min-w-0 truncate text-gray-800" title={it.title}>{it.title}</span>
                      {it.source !== 'PLAN' && <span className="shrink-0 text-[11px] text-gray-400">{time}</span>}
                      {it.status && (
                        <span className="shrink-0 text-[10px] text-gray-400">{STATUS_LABEL[it.status] ?? it.status}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}

      <p className="text-[10px] text-gray-400">
        치료 계획은 병원에서 수립한 예정 일정으로 실제 진행과 다를 수 있습니다. 변경·문의는 대표번호 또는 예약 탭을 이용해 주세요.
      </p>
    </div>
  );
}
