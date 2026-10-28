'use client';

/**
 * 예약 진료실까지 길안내(포털 B1 남은 몫 · 2026-10-26) — **접수 전**.
 *  · 펼칠 때만 부른다 · 접수 뒤면 대기표 길안내로 보낸다(서버가 queueId 만 준다)
 *  · 🔴 진료실은 진료표 기준 **예정**이다 — 접수 때 바뀔 수 있다고 먼저 말한다 · 진료표에 없으면 진료실을 지어내지 않는다
 *  · 🔴 먼저 접수가 필요하다 — 접수 창구는 서버가 준 전부를 보여 준다(하나를 고르지 않는다)
 *  · 경로를 못 구하면 이유(직선·추정 경로를 그리지 않는다) · 조회 실패 ≠ 경로 없음
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { RouteStep } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { RouteSteps } from '@/components/space/RouteSteps';
import { RouteFloorPlans, type RouteFloor } from '@/components/space/RouteFloorPlans';
import { PT, usePortalTAttr } from '../_shared/PT';

interface RouteResult {
  available: boolean;
  reason?: string;
  notice?: string | null;
  walkM?: number;
  steps?: RouteStep[];
  segments?: { floor: string; points: [number, number][] }[];
  floors?: RouteFloor[];
  targetSpaceNodeId?: string;
  entrances: { id: string; name: string; floor: string; main: boolean }[];
}
export type AppointmentRoute =
  | { appointmentId: string; checkedIn: true; queueId: string }
  | {
      appointmentId: string; checkedIn: false; scheduledAt: string; departmentName: string | null;
      room: { name: string; basis: 'CLINIC_SCHEDULE' } | null;
      receptions: { name: string; floor: number | null }[];
      route: RouteResult;
    };

const ROUTE_REASON: Record<string, string> = {
  ROOM_NOT_ASSIGNED: '진료실이 아직 정해지지 않았습니다 — 접수할 때 안내해 드립니다.',
  ROOM_NOT_LINKED: '이 진료실은 아직 위치가 등록되지 않았습니다. 안내 데스크에 문의해 주세요.',
  NO_GEOMETRY: '병원 도면이 아직 준비되지 않았습니다.',
  TARGET_NOT_IN_DRAWING: '이 진료실은 도면에 없습니다. 안내 데스크에 문의해 주세요.',
  START_UNKNOWN: '출발 위치를 찾을 수 없습니다.',
  NO_PATH: '경로를 찾지 못했습니다. 안내 데스크에 문의해 주세요.',
};

/** 층 번호 → 표기(지하 B1 · 지상 1F) — 모르면 빈 칸(층을 지어내지 않는다) */
const floorLabel = (f: number | null) => (f == null ? '' : f < 0 ? `B${-f}` : `${f}F`);

export function AppointmentRoutePanel({ appointmentId }: { appointmentId: string }) {
  const tAttr = usePortalTAttr();
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState('');
  const [accessible, setAccessible] = useState(false);
  const q = useQuery({
    queryKey: ['portal-appointment-route', appointmentId, origin, accessible],
    queryFn: () => {
      const qs = new URLSearchParams({ ...(origin ? { origin } : {}), ...(accessible ? { accessible: '1' } : {}) });
      const tail = qs.toString() ? `?${qs}` : '';
      return apiClient.get<{ data: AppointmentRoute }>(`/api/v1/portal/appointments/${appointmentId}/route${tail}`);
    },
    enabled: open,
    retry: false,
    // 출발 위치·엘리베이터를 바꿔 다시 부르는 동안 직전 결과를 둔다 — 종전엔 조작부까지 사라져 다시 고를 수 없었다
    placeholderData: (prev) => prev,
  });
  const d = q.data?.data;

  return (
    <div className="mt-2 pt-2 border-t">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} data-portal-route-toggle
        className="min-h-[44px] text-xs font-medium text-blue-700 hover:text-blue-900">
        <PT k="진료실 가는 길" /> {open ? '▲' : '▼'}
      </button>
      {open && (
        <div className="mt-2 space-y-2 rounded-lg border border-blue-100 bg-blue-50/40 px-3 py-2 text-xs" data-portal-route>
          {q.isLoading && <p className="text-gray-500"><PT k="불러오는 중…" /></p>}
          {q.isError && <p className="text-rose-600" data-portal-route-error><PT k="길 안내를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요." /></p>}
          {d?.checkedIn && (
            <a href={`/guide/${d.queueId}`} target="_blank" rel="noopener noreferrer" data-portal-route-queue-guide
              className="inline-flex min-h-[44px] items-center font-semibold text-blue-700 underline">
              <PT k="접수가 끝났습니다 — 대기표 길안내 열기" />
            </a>
          )}
          {d && !d.checkedIn && (
            <>
              {/* 1) 먼저 접수 — 창구는 전부(고르지 않는다) */}
              <div data-portal-route-receptions>
                <p className="font-semibold text-gray-700"><PT k="먼저 접수가 필요합니다" /></p>
                {d.receptions.length > 0
                  ? <ul className="mt-0.5 text-gray-600">{d.receptions.map((r) => <li key={`${r.floor}-${r.name}`}>· {floorLabel(r.floor)} {r.name}</li>)}</ul>
                  : <p className="text-gray-500" data-portal-route-receptions-none><PT k="접수 창구 위치가 등록되어 있지 않습니다 — 안내 데스크에 문의해 주세요." /></p>}
              </div>
              {/* 2) 예정 진료실 — 진료표 기준 · 접수 때 바뀔 수 있다 */}
              <div data-portal-route-room={d.room?.name ?? 'UNKNOWN'}>
                <p className="font-semibold text-gray-700">
                  <PT k="예정 진료실" />: {d.room ? d.room.name : <PT k="아직 정해지지 않음" />}
                </p>
                {d.room && <p className="text-[11px] text-gray-500" data-portal-route-room-basis><PT k="진료 일정표 기준 예정입니다 — 접수할 때 바뀔 수 있습니다." /></p>}
              </div>
              {/* 3) 경로 */}
              <div className="flex flex-wrap items-center gap-2">
                <select className="min-h-[40px] flex-1 rounded-lg border bg-white px-2" value={origin} onChange={(e) => setOrigin(e.target.value)} aria-label={tAttr('출발 위치')} data-portal-route-origin>
                  <option value="">{d.route.entrances.find((e) => e.main)?.name ?? tAttr('주출입구')}</option>
                  {d.route.entrances.filter((e) => !e.main).map((e) => <option key={e.id} value={e.id}>{e.floor} {e.name}</option>)}
                </select>
                <label className="flex min-h-[40px] items-center gap-1">
                  <input type="checkbox" checked={accessible} onChange={(e) => setAccessible(e.target.checked)} data-portal-route-accessible />
                  <PT k="휠체어·유모차(엘리베이터만)" />
                </label>
              </div>
              {!d.route.available && (
                <p className="text-amber-700" data-portal-route-reason={d.route.reason ?? 'UNKNOWN'}>
                  <PT k={ROUTE_REASON[d.route.reason ?? ''] ?? '길 안내를 할 수 없습니다.'} />
                </p>
              )}
              {d.route.available && (
                <div className="space-y-2" data-portal-route-available>
                  {d.route.notice && <p className="rounded bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700">{d.route.notice}</p>}
                  {d.route.walkM != null && <p className="text-gray-500"><PT k="걷는 거리" /> {d.route.walkM}m</p>}
                  <RouteSteps steps={d.route.steps ?? []} />
                  <RouteFloorPlans segments={d.route.segments ?? []} floors={d.route.floors ?? []} notice={d.route.notice} targetSpaceNodeId={d.route.targetSpaceNodeId} />
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
