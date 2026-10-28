'use client';

import { useMemo, useState } from 'react';
import { kdate } from '@/lib/ui-settings';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { truncatedFieldsOf, truncationSummary } from '@/lib/truncated-fields';
import { APPOINTMENT_STATUS_LABEL } from '@hospital-run/shared';

import { EmptyState } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface ScheduleItem {
  at: string;
  source: string;
  refType?: string | null;
  refId?: string | null;
  title: string;
  status?: string | null;
  detail?: Record<string, unknown>;
}

interface ScheduleData {
  from: string;
  to: string;
  items: ScheduleItem[];
  counts: Record<string, number>;
}

const SOURCE_META: Record<string, { label: string; icon: string; cls: string }> = {
  APPOINTMENT: { label: '예약', icon: '📅', cls: 'bg-blue-50 text-blue-700' },
  SURGERY: { label: '수술', icon: '🔪', cls: 'bg-red-50 text-red-700' },
  MEDICATION: { label: '투약', icon: '💊', cls: 'bg-emerald-50 text-emerald-700' },
  PRE_ORDER: { label: '사전처방', icon: '📝', cls: 'bg-violet-50 text-violet-700' },
  PLAN: { label: '치료계획', icon: '🗓️', cls: 'bg-indigo-50 text-indigo-700' },
  PATHWAY: { label: '임상경로', icon: '🛤️', cls: 'bg-amber-50 text-amber-700' },
};

// 정본(appointment)+치료계획 확장(PENDING/MODIFIED/APPROVED/PLANNED/LINKED — 부분 오버라이드 패턴)
const STATUS_LABEL: Record<string, string> = {
  ...APPOINTMENT_STATUS_LABEL, IN_PROGRESS: '진행중',
  PENDING: '대기', MODIFIED: '수정', APPROVED: '승인', PLANNED: '계획', LINKED: '연계됨',
};

const RANGES = [
  { key: '2w', label: '2주', past: 3, future: 14 },
  { key: '2m', label: '2개월', past: 7, future: 60 },
  { key: '6m', label: '6개월', past: 30, future: 180 },
];

const ymd = (d: Date) => d.toISOString().slice(0, 10);

export function TreatmentScheduleTab({ patientId }: { patientId: string }) {
  const tAttr = useTAttr();
  const [range, setRange] = useState(RANGES[1]);
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);

  const { from, to } = useMemo(() => {
    const now = Date.now();
    return { from: ymd(new Date(now - range.past * 86400_000)), to: ymd(new Date(now + range.future * 86400_000)) };
  }, [range]);

  const qc = useQueryClient();
  // P3 변경관리 — PLAN(치료계획) 항목: 연기(사유·선택적 이후 일괄이동)·취소(미결 사전처방 동반)
  const itemMut = useMutation({
    mutationFn: ({ itemId, body }: { itemId: string; body: { plannedAt?: string; cancel?: boolean; reason?: string; shiftFollowing?: boolean } }) =>
      apiClient.patch<{ data: { shiftedFollowing?: number } }>(`/api/v1/treatment-templates/schedule-items/${itemId}`, body),
    onSuccess: (res) => {
      const shifted = (res.data as { shiftedFollowing?: number })?.shiftedFollowing;
      toast.success(`일정을 변경했습니다${shifted ? ` (이후 ${shifted}건 일괄 이동)` : ''}`);
      // 🔴 (U4) 사유 150자·누적 메모 300자를 넘으면 서버가 잘라 저장한다(메모는 최신을 남긴다) — 그 사실을 말한다
      const cut = truncatedFieldsOf(res);
      if (cut.length) toast.warning(`${tAttr('저장 한도를 넘은 칸을 잘라 저장했습니다')}: ${truncationSummary(cut)}`);
      qc.invalidateQueries({ queryKey: ['patient-schedule', patientId] });
    },
    onError: (e) => toast.error((e as { message?: string })?.message || '변경 실패'),
  });
  const postpone = (it: ScheduleItem) => {
    const itemId = it.detail?.itemId as string | undefined;
    if (!itemId) return;
    const daysStr = window.prompt('며칠 연기할까요? (음수=앞당김)', '7');
    if (daysStr === null) return;
    const days = Number(daysStr);
    if (!days || isNaN(days)) { toast.error('일수를 숫자로 입력하세요'); return; }
    const reason = window.prompt('변경 사유 (필수)');
    if (!reason?.trim()) { toast.error('사유가 필요합니다'); return; }
    const shiftFollowing = window.confirm('이 항목 이후의 일정도 함께 이동할까요?');
    const newAt = new Date(new Date(it.at).getTime() + days * 86400_000).toISOString();
    itemMut.mutate({ itemId, body: { plannedAt: newAt, reason: reason.trim(), shiftFollowing } });
  };
  const cancelItem = (it: ScheduleItem) => {
    const itemId = it.detail?.itemId as string | undefined;
    if (!itemId) return;
    const reason = window.prompt('취소 사유 (선택)') ?? undefined;
    itemMut.mutate({ itemId, body: { cancel: true, reason } });
  };

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['patient-schedule', patientId, from, to],
    queryFn: () => apiClient.get<{ data: ScheduleData }>(`/api/v1/patients/${patientId}/schedule`, { from, to }),
  });

  const schedule: ScheduleData | null = data?.data
    ? ((data.data as { data?: ScheduleData })?.data ?? (data.data as ScheduleData))
    : null;
  const items = (schedule?.items ?? []).filter(it => !sourceFilter || it.source === sourceFilter);

  // 날짜별 그룹
  const grouped = useMemo(() => {
    const map = new Map<string, ScheduleItem[]>();
    for (const it of items) {
      const key = it.at.slice(0, 10);
      map.set(key, [...(map.get(key) ?? []), it]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  const today = ymd(new Date());

  if (isError) return <QueryErrorFallback error={error} onRetry={refetch} />;
  if (isLoading) return <div className="h-40 bg-gray-100 rounded-2xl animate-pulse" />;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-900"><T k="치료일정 (통합)" /></h3>
          <p className="text-[11px] text-gray-400 mt-0.5"><T k="예약·수술·투약·사전처방·임상경로를 한 축으로 — 각 도메인이 원본" /></p>
        </div>
        <div className="flex gap-1">
          {RANGES.map(r => (
            <button key={r.key} onClick={() => setRange(r)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-lg ${range.key === r.key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* 소스 필터 칩 */}
      <div className="flex gap-1.5 flex-wrap">
        <button onClick={() => setSourceFilter(null)}
          className={`px-2.5 py-1 text-[11px] font-medium rounded-full ${!sourceFilter ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600'}`}>
          전체 {schedule?.items.length ?? 0}
        </button>
        {Object.entries(SOURCE_META).map(([key, meta]) => {
          const count = schedule?.counts?.[key] ?? 0;
          if (!count) return null;
          return (
            <button key={key} onClick={() => setSourceFilter(sourceFilter === key ? null : key)}
              className={`px-2.5 py-1 text-[11px] font-medium rounded-full ${sourceFilter === key ? 'bg-gray-800 text-white' : meta.cls}`}>
              {meta.icon} {meta.label} {count}
            </button>
          );
        })}
      </div>

      {grouped.length === 0 ? (
        <EmptyState icon="📅" title="기간 내 일정이 없습니다." />
      ) : (
        <div className="space-y-4">
          {grouped.map(([date, dayItems]) => {
            const d = new Date(`${date}T00:00:00`);
            const isToday = date === today;
            const isPast = date < today;
            return (
              <div key={date} className={`rounded-xl ${isToday ? 'ring-2 ring-blue-300 bg-blue-50/40' : ''}`}>
                <div className={`flex items-center gap-2 px-3 pt-2 pb-1 ${isPast ? 'opacity-60' : ''}`}>
                  <span className={`text-xs font-bold ${isToday ? 'text-blue-700' : 'text-gray-700'}`}>
                    {kdate(d, 'monthDayWeekday')}
                  </span>
                  {isToday && <span className="text-[10px] font-bold text-white bg-blue-600 px-1.5 py-0.5 rounded"><T k="오늘" /></span>}
                </div>
                <div className={`px-3 pb-2 space-y-1 ${isPast ? 'opacity-60' : ''}`}>
                  {dayItems.map((it, i) => {
                    const meta = SOURCE_META[it.source] ?? { label: it.source, icon: '○', cls: 'bg-gray-100 text-gray-600' };
                    return (
                      <div key={`${it.source}-${it.refId ?? i}`} className="flex items-center gap-2 text-sm py-1 border-b border-gray-50 last:border-0">
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded whitespace-nowrap ${meta.cls}`}>{meta.icon} {meta.label}</span>
                        <span className="text-gray-900 flex-1 min-w-0 truncate">{it.title}</span>
                        {it.source !== 'MEDICATION' && (
                          <span className="text-[10px] text-gray-400 font-mono whitespace-nowrap">
                            {kdate(it.at, 'time')}
                          </span>
                        )}
                        {it.status && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${
                            it.status === 'COMPLETED' ? 'bg-gray-100 text-gray-500'
                              : it.status === 'CANCELLED' || it.status === 'NO_SHOW' ? 'bg-red-50 text-red-500'
                              : 'bg-blue-50 text-blue-600'}`}>
                            {STATUS_LABEL[it.status] ?? it.status}
                          </span>
                        )}
                        {it.source === 'PLAN' && !!it.detail?.itemId && it.status !== 'CANCELLED' && (
                          <span className="flex gap-1 whitespace-nowrap">
                            <button onClick={() => postpone(it)} title={tAttr("일자 변경 (사유 필수·이후 일괄이동 선택)")}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 hover:bg-indigo-50 hover:text-indigo-600"><T k="연기" /></button>
                            <button onClick={() => cancelItem(it)} title={tAttr("계획 취소 (미결 사전처방 동반 취소)")}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 hover:bg-red-50 hover:text-red-600"><T k="취소" /></button>
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
