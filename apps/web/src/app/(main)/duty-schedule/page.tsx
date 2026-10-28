'use client';

import { useMemo, useState } from 'react';
import { Unit, EmptyState } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useDepartments, DeptLoadError } from '@/lib/use-departments';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from '@/stores/toast-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, useTAttr } from '@/components/ui/i18n-text';

/* ════════════════════════════════════════════════
 * Types
 * ════════════════════════════════════════════════ */

interface ShiftEntry {
  id: string;
  shift: string;
  staffId: string;
  staffName: string;
  /** 배정 당시 직군 스냅샷('doctor'|'nurse') — 법정 기록이라 서버가 덮어쓰지 않는다 */
  role: string;
  department: string;
  /** 🔴 지금의 UserRole(서버 재검증). 스냅샷과 다르면 roleMismatch */
  roleNow?: string | null;
  roleMismatch?: boolean;
  staffInactive?: boolean;
}

interface LeaveOnDay { userId: string; name: string; type: string }
interface UnderstaffedItem { shift: string; required: number; actual: number }

interface DaySchedule {
  date: string;
  dayOfWeek: string;
  shifts: ShiftEntry[];
  leaves?: LeaveOnDay[];
  understaffed?: UnderstaffedItem[];
}

interface ScheduleResponse {
  ok: boolean;
  data: {
    month: string;
    department: string;
    schedules: DaySchedule[];
    totalEntries: number;
  };
}

interface OnCallResponse {
  ok: boolean;
  data: {
    date: string;
    shifts: Array<{ shift: string; staff: Array<{ staffId: string; staffName: string; role: string; department: string }> }>;
    unassignedShifts?: string[];
    totalOnCall: number;
  };
}

interface StaffUser {
  id: string;
  familyName: string;
  givenName: string;
  role: string;
  department?: string | null;
  isActive: boolean;
}

interface HoursData {
  staffId: string;
  /** 🔴 미상은 null — 서버가 '-' 라는 이름을 지어내지 않는다 */
  staffName: string | null;
  staffRole: string | null;
  staffDepartment: string | null;
  staffKnown: boolean;
  staffInactive: boolean | null;
  weekStart: string;
  weekEnd: string;
  shifts: Array<{ date: string; shift: string; hours: number }>;
  totalHours: number;
  /** 직군별 상한(의사 80 / 그 외 52) — 상수 80 이 아니다 */
  maxAllowed: number;
  maxWeeklyHours: { doctor: number; other: number };
  isOverLimit: boolean;
}

interface Violation {
  staffId: string;
  staffName: string;
  department: string;
  /** 'doctor' | 'nurse' — 어느 기준으로 판정했는지 */
  role: string;
  weekStart: string;
  totalHours: number;
  maxAllowed: number;
  overBy: number;
}

interface ViolationsData {
  maxWeeklyHours: { doctor: number; other: number };
  violations: Violation[];
  totalViolations: number;
}

interface StatsResponse {
  ok: boolean;
  data: {
    month: string;
    totalEntries: number;
    byDepartment: Array<{ department: string; day: number; evening: number; night: number; total: number }>;
    byPerson: Array<{ name: string; department: string; role: string; day: number; evening: number; night: number; total: number }>;
  };
}

interface FairnessSample {
  totalEntries: number;
  totalDays: number;
  coveredDays: number;
  unassignedDays: number;
  dayCoverage: number;
  insufficient: boolean;
}

interface FairnessResponse {
  ok: boolean;
  data: {
    month: string;
    fairnessIndex: number;
    stdDeviation: number;
    mean: number;
    rating: string;
    sample?: FairnessSample;
    persons: Array<{
      name: string;
      department: string;
      role: string;
      total: number;
      night: number;
      deviation: number;
    }>;
  };
}

/* ════════════════════════════════════════════════
 * Constants
 * ════════════════════════════════════════════════ */

type TabKey = 'schedule' | 'swap-leave' | 'hours' | 'stats';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'schedule', label: '당직표' },
  { key: 'swap-leave', label: '교환/휴가' },
  { key: 'hours', label: '근무시간' },
  { key: 'stats', label: '통계' },
];

/**
 * 🔴 W7 교대 라벨 — 종전엔 `EVENING:'야간(전)'` · `NIGHT:'야간'` 이라 표 헤더의 **두 열이 모두
 *    "야간"** 으로 읽혔다. 누가 초번이고 누가 심야인지 화면만 보고 구분할 수 없었다.
 *    이 화면 안에서는 한 벌만 쓰고(헤더도 이 상수로 그린다), 형제 화면
 *    `/admin/duty-schedule` 과 같은 라벨로 맞춘다.
 *
 * ⚠ 승격 후보(이 배치 소유 밖): 앱 6곳이 같은 `EVENING` 을 6가지로 부른다
 *    (`야간(전)`·`저녁(E)`·`초번`·`초번(E)`·`준야 (15-23)`·`E (준야)`).
 *    전역 수렴은 `packages/shared` 정본이 필요하다 — 보고서 참조.
 */
const SHIFT_ORDER = ['DAY', 'EVENING', 'NIGHT'] as const;
const SHIFT_LABEL: Record<string, string> = { DAY: '주간(D)', EVENING: '저녁(E)', NIGHT: '심야(N)' };
const SHIFT_COLOR: Record<string, string> = {
  DAY: 'bg-sky-100 text-sky-800',
  EVENING: 'bg-amber-100 text-amber-800',
  NIGHT: 'bg-indigo-100 text-indigo-800',
};

const LEAVE_TYPE_LABEL: Record<string, string> = {
  ANNUAL: '연차', HALF: '반차', SICK: '병가', PERSONAL: '개인', MATERNITY: '출산', SPECIAL: '경조',
};

/** UserRole → 표시명. 목록에 없으면 원본 코드를 그대로 보인다(모르는 것을 아는 척하지 않는다) */
const USER_ROLE_LABEL: Record<string, string> = {
  ADMIN: '관리자', DOCTOR: '의사', NURSE: '간호사', PHARMACIST: '약사', LAB_TECH: '검사',
  RECEPTIONIST: '원무', NUTRITION: '급양', ADMIN_STAFF: '행정', MEDICAL_RECORDS: '의무기록',
  CHECKUP: '검진', EXECUTIVE: '경영', READ: '조회',
};
function userRoleLabel(role?: string | null): string | null {
  if (!role) return null;
  return USER_ROLE_LABEL[role] ?? role;
}

/** 당직 배정 스냅샷 직군('doctor'|'nurse') 표시명 */
function snapshotRoleLabel(role: string): string {
  return role === 'doctor' ? '의사' : role === 'nurse' ? '간호사' : role;
}

/** 근무표 마스터 — 컨트롤러 `DUTY_MASTER_ROLES`(hours/:userId self-scope)와 같은 집합 */
const DUTY_MASTER_ROLES = ['ADMIN', 'NURSE'];
/** 근무시간 조회 대상 직군 — 당직 대상(의사·간호사) */
const DUTY_STAFF_ROLES = ['DOCTOR', 'NURSE'];

// 진료과 목록 정본 = 마스터(useDepartments) — 종전 로컬 6과는 마스터의 부분집합이라 나머지 과 당직을 필터로 못 봤다

/* ── 날짜 유틸 (전부 로컬 달력 기준) ──────────────
 * 🔴 W7: `new Date().toISOString().split('T')[0]` 은 **UTC 날짜**다. KST 09:00 이전에 접속하면
 *    어제로 밀린다(주 시작일·오늘 날짜가 하루 어긋난다). 로컬 달력 성분으로만 만든다.
 */
function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function currentMonth(): string {
  return localDateKey(new Date()).slice(0, 7);
}

function currentWeekStart(): string {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay());
  return localDateKey(d);
}

const DOW = ['일', '월', '화', '수', '목', '금', '토'];

/** `YYYY-MM` → 그 달의 모든 날(로컬 달력). 🔴 미배정일을 표에서 빼지 않기 위해 필요하다 */
function daysOfMonth(month: string): { date: string; dayOfWeek: string }[] {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return [];
  const n = new Date(y, m, 0).getDate();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(y, m - 1, i + 1);
    return { date: localDateKey(d), dayOfWeek: DOW[d.getDay()] };
  });
}

function md(date: string): string {
  return date.split('-').slice(1).join('/');
}

/* ════════════════════════════════════════════════
 * Page Component
 * ════════════════════════════════════════════════ */

export default function DutySchedulePage() {
  const me = useAuthStore((s) => s.user);
  const isMaster = !!me && DUTY_MASTER_ROLES.includes(me.role);

  const [tab, setTab] = useState<TabKey>('schedule');
  const [month, setMonth] = useState(currentMonth());
  const [department, setDepartment] = useState('전체');
  const { names: departments } = useDepartments({ category: 'CLINICAL', include: [department === '전체' ? null : department] });
  // 🔴 W7: 기본 선택이 하드코딩 mock id(`doc-001`)였다 — 실존하지 않아 항상 0시간이 나왔다.
  //    기본은 **본인**(hours/:userId self-scope 상 항상 허용되는 유일한 대상)이다.
  const [hoursStaffId, setHoursStaffId] = useState<string>('');
  const [weekStart, setWeekStart] = useState(currentWeekStart());

  const queryClient = useQueryClient();

  const effectiveStaffId = hoursStaffId || me?.id || '';

  /* ── Queries ─────────────────────────────── */

  const scheduleQ = useQuery<ScheduleResponse>({
    queryKey: ['duty-schedule', month, department],
    queryFn: () =>
      apiClient.get('/api/v1/duty/schedule', {
        month,
        department: department === '전체' ? undefined : department,
      }),
  });

  // 🔴 W7: `GET /api/v1/duty/on-call` 은 존재하는데 **부르는 화면이 없었다**(오늘 당직자를 물을
  //    곳이 없음). 당직표 탭 상단에 배선한다 — date 를 비워 서버 로컬(KST) 오늘을 쓴다.
  const onCallQ = useQuery<OnCallResponse>({
    queryKey: ['duty-oncall-today'],
    queryFn: () => apiClient.get('/api/v1/duty/on-call'),
    enabled: tab === 'schedule',
  });

  const statsQ = useQuery<StatsResponse>({
    queryKey: ['duty-stats', month],
    queryFn: () => apiClient.get('/api/v1/duty/stats', { month }),
    enabled: tab === 'stats',
  });

  const fairnessQ = useQuery<FairnessResponse>({
    queryKey: ['duty-fairness', month],
    queryFn: () => apiClient.get('/api/v1/duty/fairness', { month }),
    enabled: tab === 'stats',
  });

  // 🔴 W7: 종전 직원 목록은 하드코딩 10명(mock id)이었다 — 실 직원 60명 중 아무도 고를 수 없었다.
  //    실제 `User.id` 를 주는 EP 로 교체한다(GET /api/v1/users 는 ADMIN·DOCTOR·NURSE 허용).
  const staffQ = useQuery<{ data: StaffUser[] }>({
    queryKey: ['duty-staff-users'],
    queryFn: () => apiClient.get('/api/v1/users'),
    enabled: tab === 'hours' && isMaster,
    staleTime: 5 * 60_000,
  });

  const hoursQ = useQuery<{ ok: boolean; data: HoursData }>({
    queryKey: ['duty-hours', effectiveStaffId, weekStart],
    queryFn: () => apiClient.get(`/api/v1/duty/hours/${effectiveStaffId}`, { weekStart }),
    enabled: tab === 'hours' && !!effectiveStaffId,
  });

  const violationsQ = useQuery<{ ok: boolean; data: ViolationsData }>({
    queryKey: ['duty-violations'],
    queryFn: () => apiClient.get('/api/v1/duty/violations'),
    enabled: tab === 'hours',
  });

  /* ── Mutations ───────────────────────────── */

  const autoGenMut = useMutation({
    mutationFn: (body: { month: string; department: string; constraints: Record<string, number> }) =>
      apiClient.post('/api/v1/duty/auto-generate', body),
    onSuccess: () => {
      toast.success('당직표가 자동 생성되었습니다');
      queryClient.invalidateQueries({ queryKey: ['duty-schedule'] });
      queryClient.invalidateQueries({ queryKey: ['duty-oncall-today'] });
    },
    onError: () => toast.error('자동 생성에 실패했습니다'),
  });

  /* ── Derived data ────────────────────────── */

  const schedules = scheduleQ.data?.data?.schedules ?? [];

  /**
   * 🔴 W7: 종전 표는 **배정이 있는 날만** 그렸다(8월 31일 중 3행). 28일이 미배정인데 화면은
   *    "총 3일"이라 말했다 — 빈 날은 "아무 일 없음"이 아니라 **경고**다.
   *    그 달의 모든 날을 축으로 세우고, 서버가 준 날(배정/휴가)을 얹는다.
   */
  const monthRows = useMemo(() => {
    const byDate = new Map(schedules.map((s) => [s.date, s]));
    return daysOfMonth(month).map((d) => {
      const found = byDate.get(d.date);
      return {
        date: d.date,
        dayOfWeek: d.dayOfWeek,
        shifts: found?.shifts ?? [],
        leaves: found?.leaves ?? [],
        understaffed: found?.understaffed ?? [],
      };
    });
  }, [schedules, month]);

  const assignedDays = monthRows.filter((r) => r.shifts.length > 0).length;
  const unassignedDays = monthRows.length - assignedDays;

  // 모든 hook 이후 조건부 return (React #300 방지)
  if (scheduleQ.isError) return <QueryErrorFallback error={scheduleQ.error} onRetry={scheduleQ.refetch} />;

  /* ════════════════════════════════════════════
   * Render
   * ════════════════════════════════════════════ */

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900"><T k="당직 관리" /></h1>
        <div className="flex items-center gap-3">
          <input
            type="month"
            value={month}
            onChange={e => setMonth(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          />
          <select
            value={department}
            onChange={e => setDepartment(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          >
            {['전체', ...departments].map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-gray-200">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? 'border-b-2 border-indigo-600 text-indigo-600'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <T k={t.label} />
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'schedule' && (
        <ScheduleTab
          rows={monthRows}
          assignedDays={assignedDays}
          unassignedDays={unassignedDays}
          onCall={onCallQ.data?.data ?? null}
          onCallLoading={onCallQ.isLoading}
          onCallError={!!onCallQ.isError}
          loading={scheduleQ.isLoading}
          month={month}
          department={department}
          onAutoGenerate={() =>
            autoGenMut.mutate({
              month,
              department: department === '전체' ? '전체' : department,
              constraints: { maxConsecutiveNights: 3, maxWeeklyHours: 80, minRestHours: 8 },
            })
          }
          generating={autoGenMut.isPending}
        />
      )}

      {tab === 'swap-leave' && <SwapLeaveTab />}

      {tab === 'hours' && (
        <HoursTab
          hoursData={hoursQ.data?.data ?? null}
          hoursError={hoursQ.error}
          violations={violationsQ.data?.data ?? null}
          loading={hoursQ.isLoading}
          staffId={effectiveStaffId}
          staffList={staffQ.data?.data ?? []}
          staffLoading={staffQ.isLoading}
          isMaster={isMaster}
          me={me}
          weekStart={weekStart}
          onStaffChange={setHoursStaffId}
          onWeekChange={setWeekStart}
        />
      )}

      {tab === 'stats' && (
        <StatsTab
          stats={statsQ.data?.data ?? null}
          fairness={fairnessQ.data?.data ?? null}
          loading={statsQ.isLoading}
        />
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════
 * Tab: 당직표
 * ════════════════════════════════════════════════ */

interface MonthRow {
  date: string;
  dayOfWeek: string;
  shifts: ShiftEntry[];
  leaves: LeaveOnDay[];
  understaffed: UnderstaffedItem[];
}

function ScheduleTab({
  rows,
  assignedDays,
  unassignedDays,
  onCall,
  onCallLoading,
  onCallError,
  loading,
  month,
  department,
  onAutoGenerate,
  generating,
}: {
  rows: MonthRow[];
  assignedDays: number;
  unassignedDays: number;
  onCall: OnCallResponse['data'] | null;
  onCallLoading: boolean;
  onCallError: boolean;
  loading: boolean;
  month: string;
  department: string;
  onAutoGenerate: () => void;
  generating: boolean;
}) {
  if (loading) return <LoadingSkeleton />;

  return (
    <div className="space-y-4">
      {/* 🔴 W7: 오늘 당직자를 물을 곳이 없었다 — /api/v1/duty/on-call 배선 */}
      <TodayOnCallCard data={onCall} loading={onCallLoading} error={onCallError} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
          <span>{month} / {department}</span>
          <span className="text-gray-300">·</span>
          <span><T k="배정" /> <b className="text-gray-900">{assignedDays}</b><Unit>일</Unit> / 총 {rows.length}<Unit>일</Unit></span>
          {/* 🔴 미배정을 숨기지 않는다 — 종전 표는 미배정일을 아예 빼서 경고가 없었다 */}
          {unassignedDays > 0 && (
            <span className="whitespace-nowrap rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">
              <T k="미배정" /> {unassignedDays}<Unit>일</Unit>
            </span>
          )}
        </div>
        <button
          onClick={onAutoGenerate}
          disabled={generating}
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          <T k={generating ? '생성 중...' : '자동 생성'} />
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase"><T k="날짜" /></th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase"><T k="요일" /></th>
              {/* 라벨 상수로만 그린다 — 헤더와 셀이 갈라지지 않게 */}
              {SHIFT_ORDER.map(s => (
                <th key={s} className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase"><T k={SHIFT_LABEL[s]} /></th>
              ))}
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase"><T k="휴가 · 경고" /></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {rows.map(day => {
              const isWeekend = day.dayOfWeek === '토' || day.dayOfWeek === '일';
              const noAssignment = day.shifts.length === 0;
              return (
                <tr
                  key={day.date}
                  className={noAssignment ? 'bg-red-50/60' : isWeekend ? 'bg-amber-50/40' : ''}
                >
                  <td className="whitespace-nowrap px-4 py-2 text-sm font-medium text-gray-900">{md(day.date)}</td>
                  <td className={`whitespace-nowrap px-4 py-2 text-sm ${isWeekend ? 'font-semibold text-red-600' : 'text-gray-600'}`}>
                    {day.dayOfWeek}
                  </td>
                  {SHIFT_ORDER.map(sh => (
                    <td key={sh} className="px-4 py-2">
                      {renderShiftCells(day.shifts.filter(s => s.shift === sh))}
                    </td>
                  ))}
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap items-center gap-1">
                      {/* 🔴 W7: 서버가 보낸 leaves 를 화면이 버리고 있었다 — 8/24 는 근무 3칸이 모두
                          비어 "아무도 없는 날"로 읽혔지만 실제로는 휴가자가 있었다 */}
                      {day.leaves.map(l => (
                        <span key={`${l.userId}-${l.type}`} className="whitespace-nowrap rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
                          <T k="휴가" /> {l.name}{LEAVE_TYPE_LABEL[l.type] ? <>·<T k={LEAVE_TYPE_LABEL[l.type]} /></> : ''}
                        </span>
                      ))}
                      {/* 🔴 W7: understaffed(인력기준 미달)도 응답에 있는데 미렌더였다 */}
                      {day.understaffed.map(u => (
                        <span
                          key={u.shift}
                          className="whitespace-nowrap rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700"
                          title={`${SHIFT_LABEL[u.shift] ?? u.shift} 최소 ${u.required}명 필요 / 현재 ${u.actual}명`}
                        >
                          <T k="인력부족" /> <T k={SHIFT_LABEL[u.shift] ?? u.shift} /> {u.actual}/{u.required}
                        </span>
                      ))}
                      {noAssignment && (
                        <span className="whitespace-nowrap rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">
                          <T k="미배정" />
                        </span>
                      )}
                      {!noAssignment && day.leaves.length === 0 && day.understaffed.length === 0 && (
                        <span className="text-xs text-gray-300">-</span>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">
                  <T k="월을 선택하세요" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TodayOnCallCard({ data, loading, error }: { data: OnCallResponse['data'] | null; loading: boolean; error: boolean }) {
  if (loading) {
    return <div className="h-20 animate-pulse rounded-lg bg-gray-100" />;
  }
  if (error || !data) {
    // 🔴 조회 실패를 "당직 없음"으로 보이게 하지 않는다
    return (
      <div className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-sm text-gray-500">
        <T k="오늘 당직자 — 조회하지 못했습니다(새로고침 후 다시 시도)" />
      </div>
    );
  }
  const byShift = new Map(data.shifts.map((s) => [s.shift, s.staff]));
  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-sm font-semibold text-gray-900"><T k="오늘 당직" /> <span className="font-normal text-gray-500">({data.date})</span></span>
        {SHIFT_ORDER.map((sh) => {
          const staff = byShift.get(sh) ?? [];
          return (
            <span key={sh} className="flex items-center gap-1 text-sm">
              <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${SHIFT_COLOR[sh]}`}><T k={SHIFT_LABEL[sh]} /></span>
              {staff.length > 0 ? (
                <span className="text-gray-800">{staff.map((s) => s.staffName).join(', ')}</span>
              ) : (
                // 배정이 실제로 없다 = 경고. 표본 부재가 아니라 사실이다.
                <span className="font-semibold text-red-600"><T k="미배정" /></span>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function renderShiftCells(entries: ShiftEntry[]) {
  if (entries.length === 0) return <span className="text-xs text-gray-300">-</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {entries.map(e => {
        // 🔴 W7: 뱃지 색·툴팁이 배정 당시 스냅샷(role)만 보고 있어, v3.96 에서 ADMIN_STAFF 로
        //    재배정된 직원이 여전히 "간호사"로 표시됐다. 지금의 UserRole 로 표시하고,
        //    스냅샷과 다르면 눈에 보이게 표시한다(스냅샷은 법정 기록이라 지우지 않는다).
        const nowLabel = userRoleLabel(e.roleNow);
        const snapLabel = snapshotRoleLabel(e.role);
        const mismatch = !!e.roleMismatch;
        const tone = mismatch
          ? 'bg-orange-50 text-orange-800 ring-1 ring-orange-300'
          : (e.roleNow ?? '') === 'DOCTOR' || (!e.roleNow && e.role === 'doctor')
            ? 'bg-blue-50 text-blue-700'
            : 'bg-green-50 text-green-700';
        return (
          <span
            key={e.id}
            className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${tone}`}
            title={
              mismatch
                ? `${e.department} / 배정 당시 ${snapLabel} → 현재 ${nowLabel ?? '미상'} (직군 변경 — 임상 당직 자격 재확인 필요)`
                : `${e.department} / ${nowLabel ?? snapLabel}`
            }
          >
            {e.staffName}
            {mismatch && <span className="ml-1 font-semibold">⚠{nowLabel ?? <T k="직군변경" />}</span>}
            {e.staffInactive && <span className="ml-1 font-semibold text-red-600">·<T k="비활성" /></span>}
          </span>
        );
      })}
    </div>
  );
}

/* ════════════════════════════════════════════════
 * Tab: 교환/휴가
 * ════════════════════════════════════════════════ */

/**
 * 🔴 W7 — 이 탭은 통째로 **프론트 하드코딩 날조**였다(P15).
 *
 *   교대 요청 2건(김태현→이수진 오늘 야간↔주간 "개인 사유" 등)과 휴가 4건("장민지 병가 **승인**")이
 *   `useMemo` 안에 리터럴로 박혀 있었고, **API 호출 자체가 없었다**. 실제 `duty_swap_requests`
 *   0행 · `duty_leave_requests` 0행. 근무 인력을 오판하게 만드는 값이었다.
 *
 *   그 위의 [승인]/[거절] 버튼은 진짜 API 를 때렸다 — `PATCH /api/v1/duty/swap-request/swap-001`.
 *   `id` 는 `@db.Uuid` 라 Prisma P2023 → 500. 승인 기능이 구조적으로 100% 실패했고,
 *   실재하는 요청은 화면에 뜨지도 않았다.
 *
 * 지금 무엇을 할 수 있나 — **목록 조회 EP 가 없다**.
 *   컨트롤러에 있는 것: `POST swap-request` · `PATCH swap-request/:id` ·
 *                      `POST leave-request` · `PATCH leave-request/:id`
 *   없는 것: `GET swap-request` · `GET leave-request`
 *   (서비스에 `getSwapRequests()`/`getLeaveRequests()` 헬퍼는 있으나 **어떤 라우트에도 붙어 있지 않다**)
 *
 * 목록이 없으면 승인/거절도 대상이 없다. 없는 목록을 지어내는 대신 **미구현임을 정직하게** 말하고,
 * 실제로 운영 중인 경로(ESS 전자결재)로 안내한다. 조회 EP 가 배선되는 순간 이 자리에 실목록을 붙인다.
 */
function SwapLeaveTab() {
  const tAttr = useTAttr();
  return (
    <div className="space-y-4">
      <EmptyState
        icon="🔌"
        title="교대 교환 · 휴가 목록은 아직 이 화면에서 조회할 수 없습니다"
        hint="목록 조회 API(GET /api/v1/duty/swap-request · GET /api/v1/duty/leave-request)가 없습니다. 신청/승인 EP 만 있어 목록을 표시할 수 없습니다."
      />

      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold"><T k="종전 이 화면이 보여주던 교대 2건 · 휴가 4건은 실제 데이터가 아니었습니다." /></p>
        <p className="mt-1">
          <T k="프론트에 하드코딩된 예시였고(서버 테이블은 0행), [승인] 버튼은 존재하지 않는 요청 id 로 API 를 호출해 항상 실패했습니다. 근무 인력을 오판할 수 있어 제거했습니다." />
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-700">
        <p className="font-semibold text-gray-900"><T k="지금 실제로 운영 중인 경로" /></p>
        <ul className="mt-2 space-y-1.5">
          <li>
            · <b>휴가</b> — 신청·조회·취소는 <a href="/ess" className="text-indigo-600 underline">내 행정(ESS)</a> 의 휴가 섹션에서 합니다.
            승인된 휴가는 이 화면 <b>당직표 탭</b>의 날짜별 &quot;휴가&quot; 칩으로 함께 보입니다.
          </li>
          <li>
            · <b>교대 교환</b> — 설정 <code className="rounded bg-gray-100 px-1">duty.swap.eApproval</code> 이 켜져 있으면
            교대 요청이 전자결재(HR_DUTY_SWAP)로 상신되어 상대 직원이 결재함에서 승인합니다.
          </li>
          <li>
            · 부서 단위 당직 편성·인력기준·on-call 배정은 <a href="/admin/duty-schedule" className="text-indigo-600 underline">당직 편성 관리</a> 에서 합니다.
          </li>
        </ul>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════
 * Tab: 근무시간
 * ════════════════════════════════════════════════ */

function HoursTab({
  hoursData,
  hoursError,
  violations,
  loading,
  staffId,
  staffList,
  staffLoading,
  isMaster,
  me,
  weekStart,
  onStaffChange,
  onWeekChange,
}: {
  hoursData: HoursData | null;
  hoursError: unknown;
  violations: ViolationsData | null;
  loading: boolean;
  staffId: string;
  staffList: StaffUser[];
  staffLoading: boolean;
  isMaster: boolean;
  me: { id: string; familyName: string; givenName: string; role: string } | null;
  weekStart: string;
  onStaffChange: (id: string) => void;
  onWeekChange: (date: string) => void;
}) {
  const tAttr = useTAttr();
  // 🔴 W7: 종전 드롭다운은 하드코딩 10명(mock id)이라 실직원을 아무도 고를 수 없었다.
  //    실 사용자 목록에서 당직 대상 직군(의사·간호사)·활성만 남긴다.
  const options = useMemo(() => {
    const list = staffList
      .filter((u) => u.isActive && DUTY_STAFF_ROLES.includes(u.role))
      .map((u) => ({
        id: u.id,
        label: `${u.familyName}${u.givenName} · ${userRoleLabel(u.role)}${u.department ? ` · ${u.department}` : ''}`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ko'));
    if (me && !list.some((o) => o.id === me.id)) {
      list.unshift({ id: me.id, label: `${me.familyName}${me.givenName} (나)` });
    }
    return list;
  }, [staffList, me]);

  const forbidden = (hoursError as { code?: string } | null)?.code === 'DUTY_HOURS_SELF_ONLY';
  const limits = violations?.maxWeeklyHours ?? hoursData?.maxWeeklyHours ?? null;

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium text-gray-700"><T k="직원" /></label>
        {isMaster ? (
          <select
            value={staffId}
            onChange={e => onStaffChange(e.target.value)}
            disabled={staffLoading}
            className="min-w-[16rem] rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          >
            {staffLoading && <option value={staffId}>{tAttr('불러오는 중…')}</option>}
            {!staffLoading && options.length === 0 && <option value="">{tAttr('조회 가능한 직원이 없습니다')}</option>}
            {!staffLoading && options.map(o => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        ) : (
          // 🔴 컨트롤러 self-scope(DUTY_HOURS_SELF_ONLY)와 어긋나지 않게 — 비마스터는 본인만.
          //    선택지를 열어두면 고를 때마다 403 이 난다.
          <span className="rounded-md border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-700">
            {me ? `${me.familyName}${me.givenName} (나)` : <T k="로그인 정보를 불러오는 중…" />}
            <span className="ml-2 text-xs text-gray-500"><T k="타인 근무시간은 근무표 마스터(관리자·간호관리자)만 조회할 수 있습니다" /></span>
          </span>
        )}
        <label className="text-sm font-medium text-gray-700"><T k="주 시작일" /></label>
        <input
          type="date"
          value={weekStart}
          onChange={e => onWeekChange(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        />
      </div>

      {forbidden ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <T k="타인의 근무시간은 근무표 마스터(관리자·간호관리자)만 조회할 수 있습니다." />
        </div>
      ) : loading ? (
        <LoadingSkeleton />
      ) : hoursData ? (
        <div className="space-y-4">
          {/* Summary card */}
          <div className={`rounded-lg border p-4 ${hoursData.isOverLimit ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-white'}`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-lg font-semibold text-gray-900">
                  {/* 🔴 이름을 모르면 지어내지 않는다 */}
                  {hoursData.staffName || <span className="text-gray-400"><T k="이름 미상" /></span>}
                  {hoursData.staffRole && (
                    <span className="ml-2 whitespace-nowrap rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
                      {userRoleLabel(hoursData.staffRole)}
                    </span>
                  )}
                  {hoursData.staffInactive && (
                    <span className="ml-1 whitespace-nowrap rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700"><T k="비활성 계정" /></span>
                  )}
                </p>
                <p className="text-sm text-gray-500">
                  {hoursData.staffDepartment ? `${hoursData.staffDepartment} · ` : ''}{hoursData.weekStart} ~ {hoursData.weekEnd}
                </p>
              </div>
              <div className="text-right">
                <p className={`text-3xl font-bold ${hoursData.isOverLimit ? 'text-red-600' : 'text-indigo-600'}`}>
                  {hoursData.totalHours}시간
                </p>
                {/* 🔴 W7: 상한이 늘 "80시간"으로 찍혀 간호사(52h) 기준을 감췄다 — 서버가 준
                    직군별 상한(maxAllowed)과 그 근거를 함께 보인다 */}
                <p className="text-sm text-gray-500">
                  / {hoursData.maxAllowed}<Unit>시간</Unit> <T k="제한" />
                  <span className="ml-1 text-xs text-gray-400">
                    ({userRoleLabel(hoursData.staffRole) ?? tAttr('직군 미상')} 기준)
                  </span>
                </p>
              </div>
            </div>
            {hoursData.isOverLimit && (
              <div className="mt-3 rounded bg-red-100 px-3 py-2 text-sm font-medium text-red-800">
                주 {hoursData.maxAllowed}시간 초과 위반 (+{hoursData.totalHours - hoursData.maxAllowed}시간)
              </div>
            )}
            {!hoursData.staffKnown && (
              <div className="mt-3 rounded bg-amber-100 px-3 py-2 text-sm text-amber-900">
                <T k="이 사용자 계정을 찾을 수 없습니다 — 집계는 당직 기록만으로 산출됐습니다." />
              </div>
            )}
            {/* Progress bar */}
            <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-gray-200">
              <div
                className={`h-full rounded-full transition-all ${hoursData.isOverLimit ? 'bg-red-500' : 'bg-indigo-500'}`}
                style={{ width: `${Math.min(100, (hoursData.totalHours / Math.max(1, hoursData.maxAllowed)) * 100)}%` }}
              />
            </div>
          </div>

          {/* Shift detail */}
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600"><T k="날짜" /></th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600"><T k="근무" /></th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600"><T k="시간" /></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {hoursData.shifts.map((s, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap px-4 py-2 text-sm text-gray-900">{s.date}</td>
                    <td className="whitespace-nowrap px-4 py-2">
                      <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${SHIFT_COLOR[s.shift] ?? 'bg-gray-100 text-gray-700'}`}>
                        <T k={SHIFT_LABEL[s.shift] ?? s.shift} />
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-right text-sm font-medium text-gray-900">{s.hours}h</td>
                  </tr>
                ))}
                {hoursData.shifts.length === 0 && (
                  <tr><td colSpan={3} className="px-4 py-6 text-center text-sm text-gray-400"><T k="해당 주 당직 배정 없음" /></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* Violations */}
      <section>
        <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold text-gray-900">
          {/* 🔴 W7: 헤더가 "80시간 초과"라 간호사 52h 기준을 감췄다 — 서버 기준을 그대로 쓴다 */}
          <T k="주간 근무시간 상한 초과" />
          {(violations?.totalViolations ?? 0) > 0 && (
            <span className="rounded-full bg-red-600 px-2 py-0.5 text-xs font-medium text-white whitespace-nowrap">
              {violations?.totalViolations}건
            </span>
          )}
        </h2>
        <p className="mb-3 text-xs text-gray-500">
          {limits
            ? `기준 — 의사 ${limits.doctor}시간 / 그 외 직군 ${limits.other}시간 (주당)`
            : <T k="기준 — 조회 중" />}
        </p>
        {(violations?.violations.length ?? 0) > 0 ? (
          <div className="overflow-x-auto rounded-lg border border-red-200">
            <table className="min-w-full divide-y divide-red-100">
              <thead className="bg-red-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-red-700"><T k="이름" /></th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-red-700"><T k="부서" /></th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-red-700"><T k="직종" /></th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-red-700"><T k="주 시작일" /></th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-red-700"><T k="총 시간" /></th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-red-700"><T k="적용 상한" /></th>
                  <th className="px-4 py-3 text-right text-xs font-semibold text-red-700"><T k="초과" /></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-red-50 bg-white">
                {violations?.violations.map((v, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap px-4 py-2 text-sm font-medium text-gray-900">{v.staffName}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-sm text-gray-600">{v.department}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-sm text-gray-600"><T k={snapshotRoleLabel(v.role)} /></td>
                    <td className="whitespace-nowrap px-4 py-2 text-sm text-gray-600">{v.weekStart}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right text-sm font-medium text-red-600">{v.totalHours}h</td>
                    {/* 🔴 어느 기준으로 위반인지 행마다 밝힌다(의사 80 / 간호사 52) */}
                    <td className="whitespace-nowrap px-4 py-2 text-right text-sm text-gray-700">{v.maxAllowed}h</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right text-sm font-bold text-red-700">+{v.overBy}h</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-lg border border-gray-200 bg-white px-4 py-8 text-center text-sm text-gray-400">
            <T k="위반 사항 없음" />
          </div>
        )}
      </section>
    </div>
  );
}

/* ════════════════════════════════════════════════
 * Tab: 통계
 * ════════════════════════════════════════════════ */

function StatsTab({
  stats,
  fairness,
  loading,
}: {
  stats: StatsResponse['data'] | null;
  fairness: FairnessResponse['data'] | null;
  loading: boolean;
}) {
  const tAttr = useTAttr();
  if (loading) return <LoadingSkeleton />;

  const sample = fairness?.sample;

  return (
    <div className="space-y-8">
      {/* Fairness card */}
      {fairness && (
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-lg font-semibold text-gray-900"><T k="공정성 리포트" /></h2>

          {/* 🔴 W7: 공정성 지수는 `100 - 표준편차*10` 이라 **배정이 적을수록 점수가 올라간다**.
              월의 90%가 미배정이면 편차가 0 에 수렴해 "매우 공정"이 뜬다.
              계산식은 실집계라 손대지 않고, 표본이 얼마나 얇은지를 함께 말한다. */}
          {sample?.insufficient && (
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <p className="font-semibold"><T k="표본이 부족해 이 지수를 신뢰할 수 없습니다." /></p>
              <p className="mt-1">
                {sample.totalDays}일 중 <b>{sample.coveredDays}일</b>만 배정돼 있습니다(미배정 {sample.unassignedDays}일 · 배정 {sample.totalEntries}건).
                배정이 적을수록 편차가 작아져 지수가 <b>높게</b> 나옵니다 — 편중이 없다는 뜻이 아닙니다.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <MetricCard
              label={tAttr('공정성 지수')}
              value={fairness.fairnessIndex}
              suffix="/100"
              color={fairness.fairnessIndex >= 70 ? 'text-emerald-600' : fairness.fairnessIndex >= 50 ? 'text-amber-600' : 'text-red-600'}
            />
            <MetricCard label={tAttr('평가@등급')} value={sample?.insufficient ? `${fairness.rating} (참고용)` : fairness.rating} />
            <MetricCard label={tAttr('평균 배정 수')} value={fairness.mean} suffix={tAttr('회')} />
            <MetricCard label={tAttr('표준편차')} value={fairness.stdDeviation} />
          </div>

          {sample && !sample.insufficient && (
            <p className="mt-2 text-xs text-gray-500">
              표본 — {sample.totalDays}일 중 {sample.coveredDays}일 배정 · 총 {sample.totalEntries}건
            </p>
          )}

          {/* Per-person fairness */}
          {fairness.persons.length > 0 ? (
            <div className="mt-6 overflow-x-auto rounded-lg border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600"><T k="이름" /></th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600"><T k="부서" /></th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600"><T k="직종" /></th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600"><T k="총 배정" /></th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600"><T k={SHIFT_LABEL.NIGHT} /></th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600"><T k="편차" /></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 bg-white">
                  {fairness.persons.map((p, i) => (
                    <tr key={i}>
                      <td className="whitespace-nowrap px-4 py-2 text-sm font-medium text-gray-900">{p.name}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-sm text-gray-600">{p.department}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-sm text-gray-600"><T k={snapshotRoleLabel(p.role)} /></td>
                      <td className="whitespace-nowrap px-4 py-2 text-right text-sm font-medium text-gray-900">{p.total}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-right text-sm text-gray-600">{p.night}</td>
                      <td className={`whitespace-nowrap px-4 py-2 text-right text-sm font-medium ${
                        p.deviation > 2 ? 'text-red-600' : p.deviation < -2 ? 'text-blue-600' : 'text-gray-600'
                      }`}>
                        {p.deviation > 0 ? '+' : ''}{p.deviation}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="mt-6 rounded-lg border border-gray-200 px-4 py-8 text-center text-sm text-gray-400">
              <T k="이 달에 배정된 당직이 없습니다" />
            </div>
          )}
        </div>
      )}

      {/* Department stats */}
      {stats && (
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">
            <T k="부서별 당직 현황" />
            <span className="ml-2 text-sm font-normal text-gray-500">({stats.month}, 총 {stats.totalEntries}<Unit>건</Unit>)</span>
          </h2>
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600"><T k="부서" /></th>
                  {SHIFT_ORDER.map(s => (
                    <th key={s} className="px-4 py-3 text-right text-xs font-semibold text-gray-600"><T k={SHIFT_LABEL[s]} /></th>
                  ))}
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600"><T k="합계" /></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {stats.byDepartment.filter(d => d.total > 0).map(d => (
                  <tr key={d.department}>
                    <td className="whitespace-nowrap px-4 py-2 text-sm font-medium text-gray-900">{d.department}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right text-sm text-gray-700">{d.day}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right text-sm text-gray-700">{d.evening}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right text-sm text-gray-700">{d.night}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right text-sm font-semibold text-gray-900">{d.total}</td>
                  </tr>
                ))}
                {stats.byDepartment.filter(d => d.total > 0).length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-400"><T k="이 달에 배정된 당직이 없습니다" /></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Person stats */}
      {stats && (
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="mb-4 text-lg font-semibold text-gray-900"><T k="개인별 당직 현황" /></h2>
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600"><T k="이름" /></th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600"><T k="부서" /></th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600"><T k="직종" /></th>
                  {SHIFT_ORDER.map(s => (
                    <th key={s} className="px-4 py-3 text-right text-xs font-semibold text-gray-600"><T k={SHIFT_LABEL[s]} /></th>
                  ))}
                  <th className="px-4 py-3 text-right text-xs font-semibold text-gray-600"><T k="합계" /></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {stats.byPerson.map((p, i) => (
                  <tr key={i}>
                    <td className="whitespace-nowrap px-4 py-2 text-sm font-medium text-gray-900">{p.name}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-sm text-gray-600">{p.department}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-sm text-gray-600"><T k={snapshotRoleLabel(p.role)} /></td>
                    <td className="whitespace-nowrap px-4 py-2 text-right text-sm text-gray-700">{p.day}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right text-sm text-gray-700">{p.evening}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right text-sm text-gray-700">{p.night}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right text-sm font-semibold text-gray-900">{p.total}</td>
                  </tr>
                ))}
                {stats.byPerson.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-6 text-center text-sm text-gray-400"><T k="이 달에 배정된 당직이 없습니다" /></td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════
 * Shared Components
 * ════════════════════════════════════════════════ */

function MetricCard({ label, value, suffix, color }: { label: string; value: string | number; suffix?: string; color?: string }) {
  return (
    <div className="rounded-lg border border-gray-100 bg-gray-50 p-4 text-center">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color ?? 'text-gray-900'}`}>
        {value}{suffix && <span className="text-sm font-normal text-gray-500">{suffix}</span>}
      </p>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-lg bg-gray-100" />
      ))}
    </div>
  );
}
