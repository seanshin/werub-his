'use client';

import { CalendarDays, ClipboardList, FileClock, Hourglass, Receipt, Stethoscope, type LucideIcon } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { MiniStat } from '../shared';
import { pollMs } from '@/lib/ui-settings';
import { T } from '@/components/ui/i18n-text';

export interface DashboardOverview {
  myWaiting?: number;
  todayAppointments?: number;
  todayEncounters?: number;
  draftEncounters?: number;
  pendingOrders?: number;
  pendingBillings?: number;
}

/**
 * 🔴 라벨은 **지표 키가 정한다**(역할이 정하지 않는다 · 2026-09-29).
 *    `/dashboard/overview` 는 summary 의 별칭이라 전 값이 **병원 전체** 집계다. 그런데 역할별 목록이 라벨을 따로 적어
 *    의사에게는 "내 대기 환자·오늘 내 예약·내 미완료 차트·내 검사결과"(전부 병원 전체 값),
 *    간호사에게는 DRAFT 진료 수를 "입원 환자", 전체 대기 오더를 "투약 대기"로 말하고 있었다(P1·P11).
 *    역할은 **어떤 키를 어떤 순서로** 보일지만 고른다 — 라벨을 다시 적으면 같은 일이 되풀이된다.
 */
export const OVERVIEW_KEY_LABEL: Record<keyof DashboardOverview, string> = {
  myWaiting: '대기 환자',
  todayAppointments: '오늘 예약',
  todayEncounters: '오늘 진료',
  draftEncounters: '미완료 차트',
  pendingOrders: '대기 오더',
  pendingBillings: '미수납',
};
const KEY_COLOR: Record<keyof DashboardOverview, string> = {
  myWaiting: 'blue', todayAppointments: 'indigo', todayEncounters: 'emerald',
  draftEncounters: 'amber', pendingOrders: 'rose', pendingBillings: 'gray',
};
const KEY_HREF: Record<keyof DashboardOverview, string> = {
  myWaiting: '/reception', todayAppointments: '/schedule', todayEncounters: '/patients',
  draftEncounters: '/patients', pendingOrders: '/orders', pendingBillings: '/billing',
};
export const ROLE_KEYS: Record<string, Array<keyof DashboardOverview>> = {
  DOCTOR: ['myWaiting', 'todayAppointments', 'todayEncounters', 'draftEncounters', 'pendingOrders'],
  NURSE: ['myWaiting', 'todayAppointments', 'pendingOrders', 'draftEncounters', 'pendingBillings'],
  ADMIN: ['myWaiting', 'todayAppointments', 'todayEncounters', 'draftEncounters', 'pendingOrders', 'pendingBillings'],
};

/** 지표 아이콘 — 값의 성격(대기·예약·진료·미완료·오더·수납)을 알아보는 표식일 뿐 색은 쓰지 않는다(색은 주의 값에만) */
const KEY_ICON: Record<keyof DashboardOverview, LucideIcon> = {
  myWaiting: Hourglass,
  todayAppointments: CalendarDays,
  todayEncounters: Stethoscope,
  draftEncounters: FileClock,
  pendingOrders: ClipboardList,
  pendingBillings: Receipt,
};

export default function StatBarWidget() {
  const { user } = useAuthStore();
  // 🔴 종전 `.catch(() => ({ data: null }))` — 조회 실패가 다른 결측과 구분되지 않아 전 칸이 조용히 '-' 였다(P17)
  const { data, isError } = useQuery({
    queryKey: ['dashboard-overview'],
    queryFn: () => apiClient.get<{ data: DashboardOverview }>('/api/v1/dashboard/overview'),
    refetchInterval: pollMs('normal'),
  });

  const overview = data?.data;
  const keys = ROLE_KEYS[user?.role ?? ''] ?? ROLE_KEYS.ADMIN;

  if (isError) return <div className="text-xs text-red-600 py-2 text-center"><T k="지표 조회 실패 — 확인 필요" /></div>;

  return (
    /**
     * 🔴 **열 수를 화면 폭과 무관하게 고정하면 라벨이 잘린다**(2026-09-03).
     *    종전 `repeat(${cols.length}, 1fr)` 은 역할당 5~6열을 모든 폭에 강제했다.
     *    이 위젯은 `strip`(col-span-12) 이라 전 역할 대시보드 **상단에 고정**돼 있는데,
     *    375px 화면에서 한 칸이 50px 남짓이라 `내 미완료 차트` 같은 라벨이 통째로 사라졌다.
     *    카드 최소 폭을 정하고 들어갈 만큼만 넣는다 — 좁으면 줄이 늘어날 뿐 글자는 남는다.
     */
    <div>
    {/* 🔴 (2026-10-02) 이 띠의 값은 전부 **병원 전체**다 — '내 업무' 화면 맨 위에서 범위를 말하지 않으면 내 숫자로 읽힌다.
        기간은 지표마다 다르다(미완료 차트·대기 오더·미수납은 전 기간) — "오늘"로 묶지 않는다 */}
    <p className="mb-1 text-[11px] text-gray-400" data-statbar-scope><T k="병원 전체" /></p>
    <div className="grid gap-2 grid-cols-[repeat(auto-fit,minmax(124px,1fr))]">
      {keys.map((key) => (
        <MiniStat
          key={key}
          label={OVERVIEW_KEY_LABEL[key]}
          value={overview?.[key] ?? '-'}
          color={KEY_COLOR[key]}
          href={KEY_HREF[key]}
          icon={KEY_ICON[key]}
        />
      ))}
    </div>
    </div>
  );
}
