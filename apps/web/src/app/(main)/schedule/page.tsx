'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { format, addDays, addMonths, startOfWeek, startOfMonth, endOfMonth, endOfWeek, eachDayOfInterval, isSameDay, isSameMonth } from 'date-fns';
import { ko } from 'date-fns/locale';
import Link from 'next/link';
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Percent, Plus, UserX } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { useAppointmentCalendar, useChangeAppointmentStatus, useConfirmAppointment, useNoShowAppointment } from '@/hooks/useAppointments';
import { STATUS_LABEL, STATUS_COLOR, TYPE_LABEL } from '@/types/appointment';
import type { Appointment, AppointmentStatus } from '@/types/appointment';
import DayTimeGrid from './_components/DayTimeGrid';
import HourHeatmapStrip from './_components/HourHeatmapStrip';

import { EmptyState, Unit } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { RATIO_UNAVAILABLE } from '@hospital-run/shared';

type ViewMode = 'day' | 'week' | 'month' | 'list';
interface ScheduleRow { departmentName?: string }

// 주말 색: 토=연한 파랑, 일=연한 빨강
function weekendCls(day: Date): string {
  const d = day.getDay();
  return d === 0 ? 'text-red-400' : d === 6 ? 'text-blue-400' : '';
}
// 월요일 시작 요일 라벨(월~일) + 색
const MONTH_HEADERS = [
  { label: '월', cls: 'text-gray-400' }, { label: '화', cls: 'text-gray-400' }, { label: '수', cls: 'text-gray-400' },
  { label: '목', cls: 'text-gray-400' }, { label: '금', cls: 'text-gray-400' },
  { label: '토', cls: 'text-blue-400' }, { label: '일', cls: 'text-red-400' },
];

/**
 * 상태 칩 — 라벨은 배지와 같은 정본(STATUS_LABEL)을 쓴다.
 * 🔴 종전 필터는 '신청(확정대기)'·'노쇼', 배지는 '예약'·'미내원' — 같은 상태를 두 이름으로 불렀다(P12).
 * 🔴 노쇼·취소를 어느 뷰로도 다시 볼 수 없었다 — 사후 조회 필터로 노출(P2·P8). 이 둘은 고를 때만 불러온다.
 */
const STATUS_ORDER: AppointmentStatus[] = ['SCHEDULED', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW', 'CANCELLED'];
const INACTIVE: AppointmentStatus[] = ['NO_SHOW', 'CANCELLED'];

export default function SchedulePage() {
  const tt = useTAttr();
  const router = useRouter();
  const [baseDate, setBaseDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<ViewMode>('week');
  const [deptFilter, setDeptFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<AppointmentStatus | 'ALL'>('ALL');
  // 일 뷰(타임그리드) 컨트롤
  const [laneBy, setLaneBy] = useState<'doctor' | 'room'>('doctor');
  const [density, setDensity] = useState<'compact' | 'comfortable'>('comfortable');
  const [timeRange, setTimeRange] = useState<'all' | 'am' | 'pm'>('all');

  const changeStatus = useChangeAppointmentStatus();
  const confirmAppt = useConfirmAppointment();
  const noShowAppt = useNoShowAppointment();

  // 이번 달 통계
  const { data: statsRes, isError: statsIsError, error: statsError, refetch: refetchStats } = useQuery({
    queryKey: ['appointment-stats', format(startOfMonth(baseDate), 'yyyy-MM-dd')],
    queryFn: () => apiClient.get<{ data: { total: number; noShow: number; completed: number; noShowRate: number | null; noShowDenominator?: number; noShowRateUnavailableReason?: string | null; byStatus: Record<string, number> } }>(
      `/api/v1/appointments/stats?dateFrom=${format(startOfMonth(baseDate), 'yyyy-MM-dd')}&dateTo=${format(endOfMonth(baseDate), 'yyyy-MM-dd')}`,
    ),
    staleTime: 60 * 1000,
  });
  const stats = statsRes?.data;

  const calView = viewMode === 'week' ? 'week' : 'month';
  // 노쇼·취소 필터 선택 시에만 비활성 예약 포함 요청(달력 기본 동작 보존)
  const wantsInactive = statusFilter === 'NO_SHOW' || statusFilter === 'CANCELLED';
  const { data, isLoading, isError: calIsError, error: calError, refetch: refetchCal } = useAppointmentCalendar({ view: calView, date: format(baseDate, 'yyyy-MM-dd'), ...(wantsInactive ? { includeInactive: 'true' } : {}) });

  const { data: schedRes } = useQuery({
    queryKey: ['clinic-schedule-week-depts'],
    queryFn: () => apiClient.get<{ data: ScheduleRow[] }>('/api/v1/clinic-schedule/week'),
    staleTime: 5 * 60 * 1000,
  });
  const departments = useMemo(() => {
    // /clinic-schedule/week는 이중 래핑({data:{data:[...]}}) — 배열/객체 모두 방어적 언랩
    const raw = schedRes?.data as unknown;
    const rows = (Array.isArray(raw) ? raw : (raw as { data?: ScheduleRow[] })?.data ?? []) as ScheduleRow[];
    return [...new Set(rows.map((r) => r.departmentName).filter(Boolean) as string[])].sort();
  }, [schedRes]);

  const _raw = data?.data;
  const allAppts: Appointment[] = Array.isArray(_raw) ? _raw : (_raw as unknown as { data?: Appointment[] })?.data ?? [];
  const scheduleList = useMemo(
    () => allAppts.filter((a) =>
      (statusFilter === 'ALL' || a.status === statusFilter) &&
      (!deptFilter || (a as Appointment & { departmentName?: string }).departmentName === deptFilter),
    ),
    [allAppts, statusFilter, deptFilter],
  );
  const apptsForDay = (day: Date) => scheduleList.filter((a) => isSameDay(new Date(a.scheduledAt), day));

  const pendingCount = allAppts.filter((a) => a.status === 'SCHEDULED').length;

  const handleConfirm = async (id: string) => {
    try {
      const res = await confirmAppt.mutateAsync(id);
      const warnings = (res as { meta?: { warnings?: string[] } })?.meta?.warnings ?? [];
      if (warnings.length) toast.warning(warnings.join(' '));
      else toast.success(tt('예약이 확정되었습니다.'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tt('확정 실패'));
    }
  };
  const handleStatusChange = (id: string, status: AppointmentStatus) => changeStatus.mutate({ id, status });
  const handleNoShow = async (id: string) => {
    try { await noShowAppt.mutateAsync(id); toast.success(tt('노쇼 처리되었습니다.')); }
    catch (e) { toast.error(e instanceof Error ? e.message : tt('노쇼 처리 실패')); }
  };
  const handleStartEncounter = (apt: Appointment) => {
    changeStatus.mutate({ id: apt.id, status: 'IN_PROGRESS' });
    router.push(`/patients/${apt.patientId}/encounter/new`);
  };

  const shiftBase = (dir: number) => setBaseDate(
    viewMode === 'month' || viewMode === 'list' ? addMonths(baseDate, dir) : viewMode === 'day' ? addDays(baseDate, dir) : addDays(baseDate, dir * 7),
  );
  const dayStr = format(baseDate, 'yyyy-MM-dd');
  const handleEmptySlot = (_doctorId: string, isoTime: string) => {
    router.push(`/schedule/new?date=${dayStr}${deptFilter ? `&department=${encodeURIComponent(deptFilter)}` : ''}&at=${encodeURIComponent(isoTime)}`);
  };

  // 🔴 취소·미내원은 한 번에 눌리지 않게 — 카드가 즉시 사라져(필터 밖으로) 무엇을 눌렀는지 모르게 된다
  const askCancel = (id: string) => { if (window.confirm(tt('이 예약을 취소하시겠습니까?'))) handleStatusChange(id, 'CANCELLED'); };
  const askNoShow = (id: string) => { if (window.confirm(tt('미내원(노쇼)으로 처리하시겠습니까?'))) void handleNoShow(id); };

  const btn = 'text-[10px] font-medium px-2 py-1 rounded-lg transition-colors';
  const AptActions = ({ apt }: { apt: Appointment }) => (
    <>
      {apt.status === 'SCHEDULED' && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          <button onClick={() => handleConfirm(apt.id)} className={`${btn} bg-blue-50 text-blue-700 hover:bg-blue-100`}><T k="확정" /></button>
          <button onClick={() => askCancel(apt.id)} className={`${btn} bg-gray-50 text-gray-500 hover:bg-gray-100`}><T k="취소" /></button>
          <button onClick={() => askNoShow(apt.id)} className={`${btn} bg-red-50 text-red-600 hover:bg-red-100`}><T k="노쇼" /></button>
        </div>
      )}
      {apt.status === 'CONFIRMED' && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          <button onClick={() => handleStatusChange(apt.id, 'CHECKED_IN')} className={`${btn} bg-amber-50 text-amber-700 hover:bg-amber-100`}><T k="접수@동작" /></button>
          <button onClick={() => askCancel(apt.id)} className={`${btn} bg-gray-50 text-gray-500 hover:bg-gray-100`}><T k="취소" /></button>
          <button onClick={() => askNoShow(apt.id)} className={`${btn} bg-red-50 text-red-600 hover:bg-red-100`}><T k="노쇼" /></button>
        </div>
      )}
      {apt.status === 'CHECKED_IN' && (
        <button onClick={() => handleStartEncounter(apt)} className={`mt-1.5 ${btn} bg-violet-50 text-violet-700 hover:bg-violet-100`}><T k="진료 시작" /></button>
      )}
      {apt.status === 'IN_PROGRESS' && (
        <button onClick={() => handleStatusChange(apt.id, 'COMPLETED')} className={`mt-1.5 ${btn} bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}><T k="완료@버튼" /></button>
      )}
    </>
  );

  /** 상태 배지 — 정본 라벨·색(로컬 재정의 없음) */
  const StatusChip = ({ status }: { status: AppointmentStatus }) => (
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLOR[status]}`}><T k={STATUS_LABEL[status]} /></span>
  );
  /** 왼쪽 상태 띠 — 정본 색의 글자색(700)을 bg-current 로 받아 쓴다(색 표를 새로 만들지 않는다) */
  const StatusBar = ({ status }: { status: AppointmentStatus }) => (
    <span className={`w-1 shrink-0 self-stretch rounded-full bg-transparent ${STATUS_COLOR[status]}`} aria-hidden><span className="block h-full w-full rounded-full bg-current opacity-70" /></span>
  );

  const AptCard = ({ apt }: { apt: Appointment }) => (
    <div className="flex gap-2 rounded-xl border border-slate-200/70 bg-white p-2 text-xs transition-all hover:border-slate-300 hover:shadow-[0_4px_12px_-6px_rgba(15,23,42,0.15)]" data-apt-card={apt.id}>
      <StatusBar status={apt.status} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1">
          <span className="font-bold tabular-nums text-slate-900">{format(new Date(apt.scheduledAt), 'HH:mm')}</span>
          <StatusChip status={apt.status} />
        </div>
        <div className="mt-0.5 truncate font-medium text-slate-700">{apt.patient.familyName}{apt.patient.givenName}</div>
        <div className="mt-0.5 text-[10px] text-slate-400"><T k={TYPE_LABEL[apt.type]} /> · {apt.duration}<Unit>분</Unit></div>
        <AptActions apt={apt} />
      </div>
    </div>
  );

  // 날짜 범위 계산
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(baseDate, { weekStartsOn: 1 }), i));
  const monthDays = eachDayOfInterval({
    start: startOfWeek(startOfMonth(baseDate), { weekStartsOn: 1 }),
    end: endOfWeek(endOfMonth(baseDate), { weekStartsOn: 1 }),
  });
  const listItems = [...scheduleList].sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  // 목록은 날짜별로 묶는다(한 줄에 날짜를 반복하지 않는다)
  const listGroups = listItems.reduce<{ key: string; day: Date; items: Appointment[] }[]>((acc, a) => {
    const d = new Date(a.scheduledAt); const key = format(d, 'yyyy-MM-dd');
    const last = acc[acc.length - 1];
    if (last && last.key === key) last.items.push(a); else acc.push({ key, day: d, items: [a] });
    return acc;
  }, []);
  // 상태 칩 수 — 지금 불러온 범위(주/월) 기준. 노쇼·취소는 고를 때만 불러오므로 **그 전엔 수를 모른다**(0 으로 그리지 않는다)
  const statusCounts = allAppts.reduce<Record<string, number>>((m, a) => { m[a.status] = (m[a.status] ?? 0) + 1; return m; }, {});
  // 목록 뷰는 달(月) 범위를 불러온다 — 이동 단위도 달이다(종전엔 목록에서 이동 버튼이 사라져 다른 달을 볼 수 없었다)
  const navUnit: 'day' | 'week' | 'month' = viewMode === 'day' ? 'day' : viewMode === 'week' ? 'week' : 'month';
  const rangeLabel = navUnit === 'month' ? format(baseDate, 'yyyy.MM')
    : navUnit === 'day' ? format(baseDate, 'M.d(EEE)', { locale: ko })
    : `${format(weekDays[0], 'M.d')} – ${format(weekDays[6], 'M.d')}`;

  const kpis = stats ? [
    { label: '이번 달 전체', value: stats.total, Icon: CalendarDays, tone: 'bg-slate-100 text-slate-600', num: 'text-slate-900', sub: null as string | null },
    { label: '완료', value: stats.completed, Icon: CheckCircle2, tone: 'bg-emerald-50 text-emerald-600', num: 'text-emerald-600', sub: null },
    { label: '미내원', value: stats.noShow, Icon: UserX, tone: 'bg-rose-50 text-rose-600', num: 'text-rose-600', sub: null },
    // 🔴 (2026-09-16 J3) 서버가 내원 대상 0건이면 `noShowRate: null`(산출 불가) — `null%` 로 그리지 않는다 · 비율엔 분모를 함께
    { label: '노쇼율', value: stats.noShowRate != null ? `${stats.noShowRate}%` : RATIO_UNAVAILABLE, Icon: Percent, tone: 'bg-rose-50 text-rose-600', num: 'text-rose-600',
      sub: stats.noShowDenominator != null ? `${tt('분모')} ${stats.noShowDenominator}${tt('건')}` : (stats.noShowRateUnavailableReason ?? null) },
  ] : [];

  const seg = (on: boolean) => `px-3 py-1.5 text-sm font-medium transition-colors ${on ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-gray-900"><T k="예약 관리" /></h2>
          <p className="mt-1 text-sm text-gray-500">
            <T k="예약 현황을 확인합니다" />
            {pendingCount > 0 && (
              <button type="button" onClick={() => setStatusFilter('SCHEDULED')} className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 hover:bg-blue-100">
                <T k="확정 대기" /> {pendingCount}<Unit>건</Unit>
              </button>
            )}
          </p>
        </div>
        <Link href="/schedule/new" className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-[0_6px_16px_-8px_rgba(37,99,235,0.8)] hover:bg-blue-700">
          <Plus className="h-4 w-4" aria-hidden /><T k="예약 생성" />
        </Link>
      </div>

      {/* 이번 달 통계 — 🔴 조회 실패면 카드가 조용히 사라졌다 → 실패라고 말한다 */}
      {statsIsError ? (
        <QueryErrorFallback error={statsError} onRetry={() => refetchStats()} size="compact" className="mb-5" />
      ) : kpis.length > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4" data-schedule-kpis>
          {kpis.map(({ label, value, Icon, tone, num, sub }) => (
            <div key={label} className="rounded-2xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <div className="flex items-center gap-1.5">
                <span className={`grid h-6 w-6 place-items-center rounded-lg ${tone}`} aria-hidden><Icon className="h-3.5 w-3.5" /></span>
                <p className="text-xs font-medium text-slate-500"><T k={label} /></p>
              </div>
              <p className={`mt-2 text-2xl font-bold tabular-nums leading-none ${num}`}>{value}</p>
              {sub && <p className="mt-1 text-[11px] text-slate-400">{sub}</p>}
            </div>
          ))}
        </div>
      )}

      {/* 컨트롤 바 */}
      <div className="mb-4 space-y-3 rounded-2xl border border-slate-200/70 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl bg-slate-100 p-1" role="tablist" aria-label={tt('보기')}>
            {(['day', 'week', 'month', 'list'] as ViewMode[]).map((v) => (
              <button key={v} role="tab" aria-selected={viewMode === v} onClick={() => setViewMode(v)} className={`${seg(viewMode === v)} rounded-lg`}>
                <T k={v === 'day' ? '일@뷰' : v === 'week' ? '주간' : v === 'month' ? '월간' : '목록'} />
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1" data-schedule-nav>
            <button onClick={() => shiftBase(-1)} aria-label={tt('이전')} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"><ChevronLeft className="h-4 w-4" /></button>
            <span className="min-w-[128px] text-center text-sm font-semibold tabular-nums text-slate-900">{rangeLabel}</span>
            <button onClick={() => shiftBase(1)} aria-label={tt('다음')} className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"><ChevronRight className="h-4 w-4" /></button>
            <button onClick={() => setBaseDate(new Date())} className="ml-1 h-9 rounded-lg border border-blue-200 px-3 text-sm font-medium text-blue-600 hover:bg-blue-50"><T k="오늘" /></button>
          </div>
          <div className="flex-1" />
          <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} aria-label={tt('전체 진료과')} className="h-9 rounded-lg border border-slate-200 px-3 text-sm text-slate-700">
            <option value="">{tt('전체 진료과')}</option>
            {departments.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        {viewMode !== 'day' && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={tt('상태로 거르기')}>
            {(['ALL', ...STATUS_ORDER] as (AppointmentStatus | 'ALL')[]).map((st) => {
              const on = statusFilter === st;
              const inactive = st !== 'ALL' && INACTIVE.includes(st);
              // 노쇼·취소는 고르기 전엔 불러오지 않았다 — 수를 모르므로 그리지 않는다
              const n = st === 'ALL' ? allAppts.filter((a) => !INACTIVE.includes(a.status)).length : inactive && !on ? null : (statusCounts[st] ?? 0);
              return (
                <button key={st} type="button" onClick={() => setStatusFilter(st)} aria-pressed={on} data-status-chip={st}
                  className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${on ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}>
                  <T k={st === 'ALL' ? '전체' : STATUS_LABEL[st]} />
                  {n != null && <span className={`ml-1 tabular-nums ${on ? 'text-white/80' : 'text-slate-400'}`}>{n}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* 일 뷰 컨트롤: 레인 기준·시간대·밀도 */}
      {viewMode === 'day' && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-xs">
          <div className="inline-flex rounded-xl bg-slate-100 p-1">
            {([['doctor', '의사'], ['room', '진료실']] as const).map(([g, l]) => (
              <button key={g} onClick={() => setLaneBy(g)} className={`rounded-lg px-3 py-1 font-medium ${laneBy === g ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}><T k={l} /> <T k="레인" /></button>
            ))}
          </div>
          <div className="inline-flex rounded-xl bg-slate-100 p-1">
            {([['all', '전체'], ['am', '오전'], ['pm', '오후']] as const).map(([t, l]) => (
              <button key={t} onClick={() => setTimeRange(t)} className={`rounded-lg px-3 py-1 font-medium ${timeRange === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}><T k={l} /></button>
            ))}
          </div>
          <div className="inline-flex rounded-xl bg-slate-100 p-1">
            {([['comfortable', '보통'], ['compact', '조밀']] as const).map(([d, l]) => (
              <button key={d} onClick={() => setDensity(d)} className={`rounded-lg px-3 py-1 font-medium ${density === d ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}><T k={d === 'comfortable' ? '보통@밀도' : l} /></button>
            ))}
          </div>
        </div>
      )}

      {viewMode === 'day' ? (
        <>
          {/* 시간대 혼잡 미니맵(기획 §4.2·§4.4 P2) — 일 뷰 상단 */}
          <HourHeatmapStrip date={dayStr} departmentName={deptFilter || undefined} />
          <DayTimeGrid date={dayStr} departmentName={deptFilter || undefined} groupBy={laneBy} density={density} timeRange={timeRange} onEmptySlot={handleEmptySlot} />
        </>
      ) : calIsError ? (
        /* 🔴 종전엔 isError 를 보지 않아 조회 실패가 모든 날 '예약 없음'으로 그려졌다 */
        <QueryErrorFallback error={calError} onRetry={() => refetchCal()} />
      ) : isLoading ? (
        <div className="rounded-2xl border border-slate-200/70 bg-white p-10 text-center text-sm text-slate-400"><T k="불러오는 중..." /></div>
      ) : viewMode === 'week' ? (
        /* 좁은 화면에서 7열을 우겨넣지 않는다 — 열 최소 폭을 지키고 가로로 민다 */
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <div className="grid min-w-[980px] grid-cols-7 gap-2.5" data-week-grid>
            {weekDays.map((day) => {
              const isToday = isSameDay(day, new Date());
              const appointments = apptsForDay(day);
              return (
                <div key={day.toISOString()} className={`flex min-h-[220px] flex-col rounded-2xl border bg-white ${isToday ? 'border-blue-300 shadow-[0_0_0_3px_rgba(59,130,246,0.12)]' : 'border-slate-200/70'}`}>
                  <div className={`flex items-center justify-between border-b px-3 py-2.5 ${isToday ? 'border-blue-100 bg-blue-50/50' : 'border-slate-100'} rounded-t-2xl`}>
                    <div className="flex items-baseline gap-1.5">
                      <span className={`text-lg font-bold tabular-nums ${isToday ? 'text-blue-600' : (weekendCls(day) || 'text-slate-900')}`}>{format(day, 'd')}</span>
                      <span className={`text-xs font-medium ${isToday ? 'text-blue-500' : (weekendCls(day) || 'text-slate-400')}`}>{format(day, 'EEE', { locale: ko })}</span>
                    </div>
                    {appointments.length > 0 && <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${isToday ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'}`}>{appointments.length}</span>}
                  </div>
                  <div className="flex-1 space-y-1.5 p-2">
                    {appointments.map((apt) => <AptCard key={apt.id} apt={apt} />)}
                    {appointments.length === 0 && <div className="py-6 text-center text-[10px] text-slate-300"><T k="예약 없음" /></div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : viewMode === 'month' ? (
        <div className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50/60">
            {MONTH_HEADERS.map((h) => <div key={h.label} className={`px-2 py-2 text-center text-xs font-medium ${h.cls}`}><T k={`${h.label}@요일`} /></div>)}
          </div>
          <div className="grid grid-cols-7">
            {monthDays.map((day) => {
              const isToday = isSameDay(day, new Date());
              const inMonth = isSameMonth(day, baseDate);
              const appointments = apptsForDay(day);
              return (
                <button type="button" key={day.toISOString()} onClick={() => { setBaseDate(day); setViewMode('day'); }}
                  title={tt('이 날짜를 일 보기로 열기')}
                  className={`min-h-[110px] border-b border-r border-slate-100 p-1.5 text-left align-top transition-colors hover:bg-blue-50/40 ${!inMonth ? 'bg-slate-50/60' : ''}`}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className={`grid h-6 min-w-6 place-items-center rounded-full px-1 text-xs font-semibold tabular-nums ${isToday ? 'bg-blue-600 text-white' : !inMonth ? 'text-slate-300' : (weekendCls(day) || 'text-slate-700')}`}>{format(day, 'd')}</span>
                    {appointments.length > 0 && <span className="text-[10px] tabular-nums text-slate-400">{appointments.length}</span>}
                  </div>
                  <div className="space-y-1">
                    {appointments.slice(0, 3).map((apt) => (
                      <div key={apt.id} className={`truncate rounded-md px-1.5 py-0.5 text-[10px] ${STATUS_COLOR[apt.status]}`} title={`${apt.patient.familyName}${apt.patient.givenName}`}>
                        <span className="tabular-nums">{format(new Date(apt.scheduledAt), 'HH:mm')}</span> {apt.patient.familyName}{apt.patient.givenName}
                      </div>
                    ))}
                    {appointments.length > 3 && <div className="text-[10px] text-slate-400">+{appointments.length - 3}</div>}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        /* 목록 — 날짜별 묶음 */
        <div className="space-y-3">
          {listItems.length === 0 && <div className="rounded-2xl border border-slate-200/70 bg-white"><EmptyState icon="📅" title="예약이 없습니다." /></div>}
          {listGroups.map((g) => (
            <div key={g.key} className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]" data-list-group={g.key}>
              <div className={`flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-xs font-semibold ${isSameDay(g.day, new Date()) ? 'text-blue-600' : (weekendCls(g.day) || 'text-slate-600')}`}>
                <span>{format(g.day, 'M.d(EEE)', { locale: ko })}</span>
                <span className="tabular-nums text-slate-400">{g.items.length}</span>
              </div>
              <div className="divide-y divide-slate-100">
                {g.items.map((apt) => {
                  const doc = (apt as Appointment & { doctor?: { familyName?: string; givenName?: string } }).doctor;
                  return (
                    <div key={apt.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
                      <StatusBar status={apt.status} />
                      <span className="w-12 text-sm font-bold tabular-nums text-slate-900">{format(new Date(apt.scheduledAt), 'HH:mm')}</span>
                      <span className="w-16"><StatusChip status={apt.status} /></span>
                      <span className="min-w-[6rem] text-sm font-medium text-slate-800">{apt.patient.familyName}{apt.patient.givenName}</span>
                      <span className="flex-1 text-xs text-slate-400"><T k={TYPE_LABEL[apt.type]} /> · {apt.duration}<Unit>분</Unit>{doc ? ` · ${doc.familyName ?? ''}${doc.givenName ?? ''}` : ''}</span>
                      <div className="shrink-0 [&>div]:mt-0 [&>button]:mt-0"><AptActions apt={apt} /></div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
