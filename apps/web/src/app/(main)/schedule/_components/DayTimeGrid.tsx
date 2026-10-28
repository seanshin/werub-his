'use client';

import { useMemo, useState, useRef } from 'react';
import { Unit } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { useConfirmAppointment, useChangeAppointmentStatus, useNoShowAppointment, useUpdateAppointment } from '@/hooks/useAppointments';
import { STATUS_COLOR, STATUS_LABEL, TYPE_LABEL } from '@/types/appointment';
import type { AppointmentStatus, AppointmentType } from '@/types/appointment';

const SLOT_MIN = 30;

interface DayBlock { id: string; patientId: string; scheduledAt: string; duration: number; status: AppointmentStatus; type: string; patientName: string; mrn: string }
interface DaySession { period?: string; startTime: string; endTime: string; maxPatients: number; roomName?: string; closed: boolean }
interface DayLane { laneKey: string; title: string; subtitle: string; doctorId?: string; departmentName: string; sessions: DaySession[]; appointments: DayBlock[]; booked: number; maxPatients: number }
interface DayData { date: string; dayOfWeek: number; workStart: string; workEnd: string; coreStart: string; coreEnd: string; groupBy: string; lanes: DayLane[] }

export type DayGroupBy = 'doctor' | 'room';
export type DayDensity = 'compact' | 'comfortable';
export type DayTimeRange = 'all' | 'am' | 'pm';

const hhmmToMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
// 드래그 이동 가능 상태 — 종료(완료/취소/노쇼)·진행중 제외(BE update 거부와 일치)
const MOVABLE = (s: string) => !['COMPLETED', 'CANCELLED', 'NO_SHOW', 'IN_PROGRESS'].includes(s);
// scheduledAt(ISO/UTC) → KST 당일 분(minute of day)
const kstMinOfDay = (iso: string) => { const k = new Date(new Date(iso).getTime() + 9 * 3600000); return k.getUTCHours() * 60 + k.getUTCMinutes(); };

/** 레인 내 겹침 블록에 컬럼 배치(단순 구간 분할). */
function layout(appts: DayBlock[]): { b: DayBlock; col: number; cols: number }[] {
  const sorted = [...appts].sort((a, b) => kstMinOfDay(a.scheduledAt) - kstMinOfDay(b.scheduledAt));
  const out: { b: DayBlock; col: number; cols: number; start: number; end: number }[] = [];
  const colEnds: number[] = []; // 각 컬럼의 마지막 종료분
  let cluster: typeof out = [];
  const flush = () => { const c = Math.max(1, colEnds.length); cluster.forEach((x) => (x.cols = c)); cluster = []; colEnds.length = 0; };
  let clusterEnd = -1;
  for (const b of sorted) {
    const start = kstMinOfDay(b.scheduledAt);
    const end = start + b.duration;
    if (start >= clusterEnd && cluster.length) flush(); // 겹침 끊김 → 클러스터 확정
    let col = colEnds.findIndex((e) => e <= start);
    if (col === -1) { col = colEnds.length; colEnds.push(end); } else { colEnds[col] = end; }
    const item = { b, col, cols: 1, start, end };
    out.push(item); cluster.push(item);
    clusterEnd = Math.max(clusterEnd, end);
  }
  flush();
  return out;
}

export default function DayTimeGrid({
  date, departmentName, groupBy = 'doctor', density = 'comfortable', timeRange = 'all', onEmptySlot,
}: {
  date: string;
  departmentName?: string;
  groupBy?: DayGroupBy;
  density?: DayDensity;
  timeRange?: DayTimeRange;
  onEmptySlot: (doctorId: string, isoTime: string) => void;
}) {
  const tt = useTAttr();
  const router = useRouter();
  const qc = useQueryClient();
  const confirmAppt = useConfirmAppointment();
  const changeStatus = useChangeAppointmentStatus();
  const noShowAppt = useNoShowAppointment();
  const updateAppt = useUpdateAppointment();
  const [sel, setSel] = useState<(DayBlock & { laneTitle: string }) | null>(null);
  const dragRef = useRef<{ id: string; laneKey: string; duration: number; scheduledAt: string } | null>(null);
  // 🔴 (2026-09-14) 드래그 이동은 기획 게이트 `schedule.grid.dnd`(기본 OFF · schedule-timegrid §7 P3) 뒤에 있어야 했는데
  //    그 키 없이 켜져 있었다. 설정이 `true` 일 때만 끌 수 있다 — 조회 실패·로딩 중에는 켜지 않는다(시간 변경은 예약 상세에서).
  const dndQ = useQuery({
    queryKey: ['cfg-schedule-grid-dnd'],
    queryFn: () => apiClient.get<{ data: unknown }>('/api/v1/config/schedule.grid.dnd'),
    staleTime: 60_000,
  });
  const dndEnabled = dndQ.data?.data === true;

  const afterAction = () => { qc.invalidateQueries({ queryKey: ['appointment-day'] }); setSel(null); };
  const doConfirm = async (id: string) => { try { await confirmAppt.mutateAsync(id); toast.success(tt('예약이 확정되었습니다.')); afterAction(); } catch (e) { toast.error(e instanceof Error ? e.message : tt('확정 실패')); } };
  const doStatus = async (id: string, status: AppointmentStatus) => { try { await changeStatus.mutateAsync({ id, status }); afterAction(); } catch (e) { toast.error(e instanceof Error ? e.message : tt('처리 실패')); } };
  const doNoShow = async (id: string) => { try { await noShowAppt.mutateAsync(id); toast.success(tt('노쇼 처리되었습니다.')); afterAction(); } catch (e) { toast.error(e instanceof Error ? e.message : tt('노쇼 실패')); } };

  const ROW_H = density === 'compact' ? 34 : 52; // 30분당 px
  const { data, isFetching } = useQuery({
    queryKey: ['appointment-day', date, departmentName, groupBy],
    queryFn: () => apiClient.get<{ data: DayData }>(`/api/v1/appointments/day?date=${date}&groupBy=${groupBy}${departmentName ? `&departmentName=${encodeURIComponent(departmentName)}` : ''}`),
  });
  const grid = data?.data;

  // 핵심 개원 시간대(core)만 30분 그리드. 새벽/야간은 압축 밴드로 별도 표시.
  const coreStart = grid ? hhmmToMin(grid.coreStart) : 9 * 60;
  const coreEnd = grid ? hhmmToMin(grid.coreEnd) : 18 * 60;
  // 시간대 필터: 오전(~12:00)·오후(12:00~) 클램프
  const startMin = timeRange === 'pm' ? Math.max(coreStart, 12 * 60) : coreStart;
  const endMin = timeRange === 'am' ? Math.min(coreEnd, 12 * 60) : coreEnd;
  const totalMin = Math.max(SLOT_MIN, endMin - startMin);
  const gridH = (totalMin / SLOT_MIN) * ROW_H;

  const rows = useMemo(() => {
    const r: string[] = [];
    for (let t = startMin; t < endMin; t += SLOT_MIN) r.push(`${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
    return r;
  }, [startMin, endMin]);

  // 현재시각 라인(오늘일 때만)
  const nowKst = new Date(Date.now() + 9 * 3600000);
  const todayStr = nowKst.toISOString().slice(0, 10);
  const nowMin = nowKst.getUTCHours() * 60 + nowKst.getUTCMinutes();
  const showNow = date === todayStr && nowMin >= startMin && nowMin <= endMin;
  const nowTop = ((nowMin - startMin) / SLOT_MIN) * ROW_H;

  if (isFetching && !grid) return <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center text-gray-400 text-sm"><T k="불러오는 중..." /></div>;
  if (!grid || grid.lanes.length === 0) {
    return <div className="bg-white rounded-2xl border border-gray-100 p-10 text-center text-sm text-gray-400"><T k="해당 날짜에 근무 시간표가 없습니다" />{!departmentName && <> (<T k="진료과를 선택해 보세요" />)</>}.</div>;
  }

  const laneClickTime = (e: React.MouseEvent<HTMLDivElement>, doctorId: string) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const min = startMin + Math.floor(y / ROW_H) * SLOT_MIN;
    const hh = String(Math.floor(min / 60)).padStart(2, '0');
    const mm = String(min % 60).padStart(2, '0');
    onEmptySlot(doctorId, new Date(`${date}T${hh}:${mm}:00+09:00`).toISOString());
  };

  // 드래그 이동(reschedule) — 같은 레인(의사) 내 시간 변경. 드롭 위치 슬롯 = 새 시작.
  const handleDrop = async (e: React.DragEvent<HTMLDivElement>, laneKey: string) => {
    e.preventDefault();
    const d = dragRef.current;
    dragRef.current = null;
    if (!dndEnabled) return; // 설정 게이트(schedule.grid.dnd) — 꺼져 있으면 드롭을 받지 않는다
    if (!d || d.laneKey !== laneKey) return; // 다른 의사 레인으로는 이동 안 함(P3)
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    let min = startMin + Math.floor(y / ROW_H) * SLOT_MIN;
    min = Math.max(startMin, Math.min(endMin - d.duration, min)); // core 범위 클램프
    const hh = String(Math.floor(min / 60)).padStart(2, '0');
    const mm = String(min % 60).padStart(2, '0');
    const newIso = new Date(`${date}T${hh}:${mm}:00+09:00`).toISOString();
    if (newIso === d.scheduledAt) return;
    try {
      await updateAppt.mutateAsync({ id: d.id, scheduledAt: newIso });
      toast.success(`예약을 ${hh}:${mm}로 이동했습니다.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tt('이동 실패(시간 겹침 등)'));
    }
  };

  // P2 인사이트 집계(그날 예약에서 계산 — 추가 EP 없음)
  const allAppts = grid.lanes.flatMap((l) => l.appointments);
  const hourStart = Math.floor(startMin / 60);
  const hourEnd = Math.ceil(endMin / 60);
  // 서버 booked 와 같은 모수(NO_SHOW 제외) — 종전엔 노쇼를 포함해 같은 카드 안 두 값의 합이 어긋났다(P12)
  const hourCounts = Array.from({ length: Math.max(0, hourEnd - hourStart) }, (_, i) =>
    allAppts.filter((a) => a.status !== 'NO_SHOW' && Math.floor(kstMinOfDay(a.scheduledAt) / 60) === hourStart + i).length,
  );
  const maxHour = Math.max(1, ...hourCounts);
  const topLanes = [...grid.lanes].filter((l) => l.booked > 0).sort((a, b) => b.booked - a.booked).slice(0, 3);
  const nearFull = grid.lanes.filter((l) => l.maxPatients > 0 && l.booked / l.maxPatients >= 0.8);
  const totalBooked = grid.lanes.reduce((n, l) => n + l.booked, 0);

  // 새벽(core 시작 전)·야간(core 종료 후) 예약 — 30분 행 대신 압축 밴드로 정리
  const isEarly = (iso: string) => kstMinOfDay(iso) < coreStart;
  const isLate = (iso: string) => kstMinOfDay(iso) >= coreEnd;
  const hasEarly = allAppts.some((a) => isEarly(a.scheduledAt));
  const hasLate = allAppts.some((a) => isLate(a.scheduledAt));
  const BAND_H = 32;
  const OffPeakChips = ({ items, laneTitle }: { items: DayBlock[]; laneTitle: string }) => (
    <div className="flex flex-wrap gap-0.5 p-0.5 overflow-hidden" style={{ maxHeight: BAND_H }}>
      {items.map((b) => (
        <button key={b.id} type="button" onClick={(e) => { e.stopPropagation(); setSel({ ...b, laneTitle }); }}
          title={`${b.patientName} · ${STATUS_LABEL[b.status]}`}
          className={`text-[9px] leading-none px-1 py-0.5 rounded border border-white/60 truncate max-w-full ${STATUS_COLOR[b.status]}`}>
          {new Date(new Date(b.scheduledAt).getTime() + 9 * 3600000).toISOString().slice(11, 16)} {b.patientName}
        </button>
      ))}
    </div>
  );

  return (
    <>
      {/* 인사이트: 시간대 혼잡도·부하 상위·정원 경고 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-gray-700"><T k="시간대 혼잡도" /> · <T k="예약" /> {totalBooked}<Unit>건</Unit></span>
          {nearFull.length > 0 && <span className="text-[11px] text-red-600 bg-red-50 px-2 py-0.5 rounded-full"><T k="정원 임박/초과" /> {nearFull.length}</span>}
        </div>
        <div className="flex gap-0.5">
          {hourCounts.map((c, i) => {
            const h = hourStart + i;
            return (
              <div key={h} className="flex-1 min-w-[16px] text-center" title={`${h}시 ${c}건`}>
                <div className="rounded-sm" style={{ height: 24, backgroundColor: c === 0 ? '#f3f4f6' : `rgba(37,99,235,${0.18 + (c / maxHour) * 0.72})` }} />
                <span className="text-[9px] text-gray-400">{h}</span>
              </div>
            );
          })}
        </div>
        {topLanes.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            <span className="text-[11px] text-gray-400"><T k="부하 상위" />:</span>
            {topLanes.map((l) => (
              <span key={l.laneKey} className="text-[11px] px-2 py-0.5 bg-gray-100 rounded-full text-gray-600">{l.title} {l.booked}/{l.maxPatients}</span>
            ))}
          </div>
        )}
      </div>

    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-auto">
      {dndQ.isError ? (
        <p className="text-[11px] text-amber-700 bg-amber-50 px-3 py-1.5"><T k="드래그 이동 설정을 확인하지 못해 꺼 두었습니다 — 시간 변경은 예약 상세에서 합니다." /></p>
      ) : dndQ.isSuccess && !dndEnabled ? (
        <p className="text-[11px] text-gray-500 bg-gray-50 px-3 py-1.5"><T k="드래그 이동 꺼짐(설정) — 시간 변경은 예약 상세에서 합니다." /></p>
      ) : null}
      {!departmentName && grid.lanes.length > 8 && (
        <p className="text-[11px] text-amber-600 bg-amber-50 px-3 py-1.5"><T k="의사" /> {grid.lanes.length}<Unit>명</Unit> <T k="표시 중 — 진료과 필터로 좁히면 보기 편합니다." /></p>
      )}
      <div className="flex min-w-max">
        {/* 시간축 */}
        <div className="sticky left-0 z-20 bg-white border-r border-gray-100 flex-shrink-0" style={{ width: 52 }}>
          <div style={{ height: 44 }} className="border-b border-gray-100" />
          {hasEarly && <div className="border-b border-gray-100 bg-indigo-50/40 text-[9px] text-indigo-400 flex items-center justify-end pr-1" style={{ height: BAND_H }}><T k="새벽" /></div>}
          <div className="relative" style={{ height: gridH }}>
            {rows.map((r, i) => (
              <div key={r} className="absolute left-0 right-0 text-[10px] text-gray-400 text-right pr-1" style={{ top: i * ROW_H - 6 }}>{r}</div>
            ))}
          </div>
          {hasLate && <div className="border-t border-gray-100 bg-indigo-50/40 text-[9px] text-indigo-400 flex items-center justify-end pr-1" style={{ height: BAND_H }}><T k="야간" /></div>}
        </div>
        {/* 레인 */}
        {grid.lanes.map((lane) => {
          // 표시창[startMin,endMin) 안만 그리드에 배치 — am/pm 필터 시 반대 반나절 예약이 음수 top으로 새는 것 방지
          const coreAppts = lane.appointments.filter((a) => { const m = kstMinOfDay(a.scheduledAt); return m >= startMin && m < endMin; });
          const earlyAppts = lane.appointments.filter((a) => isEarly(a.scheduledAt));
          const lateAppts = lane.appointments.filter((a) => isLate(a.scheduledAt));
          const placed = layout(coreAppts);
          const ratio = lane.maxPatients > 0 ? lane.booked / lane.maxPatients : 0;
          const full = ratio >= 1;
          const near = ratio >= 0.8 && ratio < 1;
          return (
            <div key={lane.laneKey} className="flex-shrink-0 border-r border-gray-100" style={{ width: density === 'compact' ? 120 : 150 }}>
              {/* 레인 헤더 */}
              <div className="h-11 px-2 border-b border-gray-100 flex flex-col justify-center bg-gray-50/50">
                <div className="flex items-center gap-1">
                  <span className="text-xs font-semibold text-gray-800 truncate">{lane.title}</span>
                  <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full ${full ? 'bg-red-100 text-red-600' : near ? 'bg-amber-100 text-amber-600' : 'bg-gray-100 text-gray-500'}`}>{lane.booked}/{lane.maxPatients}</span>
                </div>
                <span className="text-[10px] text-gray-400 truncate">{lane.subtitle}</span>
              </div>
              {/* 새벽 압축 밴드 */}
              {hasEarly && <div className="border-b border-gray-100 bg-indigo-50/20 overflow-hidden" style={{ height: BAND_H }}>{earlyAppts.length > 0 && <OffPeakChips items={earlyAppts} laneTitle={lane.title} />}</div>}
              {/* 그리드 본체 */}
              <div className="relative" style={{ height: gridH }}
                onClick={(e) => laneClickTime(e, lane.doctorId ?? '')}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => handleDrop(e, lane.laneKey)}>
                {/* 근무외/휴진 음영 */}
                {(() => {
                  const covered: boolean[] = new Array(rows.length).fill(false);
                  lane.sessions.forEach((s) => {
                    if (s.closed) return;
                    const a = Math.max(0, Math.floor((hhmmToMin(s.startTime) - startMin) / SLOT_MIN));
                    const b = Math.min(rows.length, Math.ceil((hhmmToMin(s.endTime) - startMin) / SLOT_MIN));
                    for (let i = a; i < b; i++) covered[i] = true;
                  });
                  return rows.map((_, i) => (
                    <div key={i} className={`absolute left-0 right-0 border-b ${i % 2 === 0 ? 'border-gray-100' : 'border-gray-50'} ${covered[i] ? '' : 'bg-gray-50/60'}`} style={{ top: i * ROW_H, height: ROW_H }} />
                  ));
                })()}
                {/* 예약 블록 */}
                {placed.map(({ b, col, cols }) => {
                  const top = ((kstMinOfDay(b.scheduledAt) - startMin) / SLOT_MIN) * ROW_H;
                  const h = Math.max(18, (b.duration / SLOT_MIN) * ROW_H - 2);
                  const w = 100 / cols;
                  const movable = dndEnabled && MOVABLE(b.status); // 종료/진행 상태는 드래그 이동 불가(BE update 거부와 일치)
                  return (
                    <button
                      key={b.id}
                      draggable={movable}
                      onDragStart={movable ? (e) => { e.stopPropagation(); dragRef.current = { id: b.id, laneKey: lane.laneKey, duration: b.duration, scheduledAt: b.scheduledAt }; e.dataTransfer.effectAllowed = 'move'; } : undefined}
                      onClick={(e) => { e.stopPropagation(); setSel({ ...b, laneTitle: lane.title }); }}
                      title={`${b.patientName} · ${STATUS_LABEL[b.status]}${movable ? ' · 드래그로 시간 이동' : ''}`}
                      className={`absolute rounded-md border px-1 py-0.5 text-left overflow-hidden ${movable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} ${STATUS_COLOR[b.status]} border-white/60 hover:ring-2 hover:ring-blue-300`}
                      style={{ top: top + 1, height: h, left: `calc(${col * w}% + 1px)`, width: `calc(${w}% - 2px)` }}
                    >
                      <span className="block text-[10px] font-semibold leading-tight truncate">{new Date(new Date(b.scheduledAt).getTime() + 9 * 3600000).toISOString().slice(11, 16)} {b.patientName}</span>
                    </button>
                  );
                })}
                {/* 현재시각 라인 */}
                {showNow && <div className="absolute left-0 right-0 z-10 border-t-2 border-red-500" style={{ top: nowTop }} />}
              </div>
              {/* 야간 압축 밴드 */}
              {hasLate && <div className="border-t border-gray-100 bg-indigo-50/20 overflow-hidden" style={{ height: BAND_H }}>{lateAppts.length > 0 && <OffPeakChips items={lateAppts} laneTitle={lane.title} />}</div>}
            </div>
          );
        })}
      </div>
    </div>

    {/* 블록 상세·상태 변경 팝오버 */}
    {sel && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4" onClick={() => setSel(null)}>
        <div className="bg-white rounded-2xl shadow-xl border border-gray-200 w-80 p-5" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-start justify-between mb-3">
            <div>
              <p className="text-lg font-bold text-gray-900">{sel.patientName}</p>
              <p className="text-xs text-gray-500">{sel.mrn} · {sel.laneTitle}</p>
            </div>
            <span className={`text-[11px] px-2 py-0.5 rounded-full ${STATUS_COLOR[sel.status]}`}>{STATUS_LABEL[sel.status]}</span>
          </div>
          <div className="text-sm text-gray-600 mb-4 space-y-0.5">
            <p>🕐 {new Date(new Date(sel.scheduledAt).getTime() + 9 * 3600000).toISOString().slice(11, 16)} · {sel.duration}<Unit>분</Unit></p>
            <p className="text-gray-400 text-xs">{TYPE_LABEL[sel.type as AppointmentType] ?? sel.type}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {sel.status === 'SCHEDULED' && <>
              <button onClick={() => doConfirm(sel.id)} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"><T k="확정" /></button>
              <button onClick={() => doStatus(sel.id, 'CANCELLED')} className="px-3 py-1.5 text-sm bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"><T k="취소" /></button>
              <button onClick={() => doNoShow(sel.id)} className="px-3 py-1.5 text-sm bg-red-50 text-red-600 rounded-lg hover:bg-red-100"><T k="노쇼" /></button>
            </>}
            {sel.status === 'CONFIRMED' && <>
              <button onClick={() => doStatus(sel.id, 'CHECKED_IN')} className="px-3 py-1.5 text-sm bg-amber-500 text-white rounded-lg hover:bg-amber-600"><T k="접수@동작" /></button>
              <button onClick={() => doStatus(sel.id, 'CANCELLED')} className="px-3 py-1.5 text-sm bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"><T k="취소" /></button>
              <button onClick={() => doNoShow(sel.id)} className="px-3 py-1.5 text-sm bg-red-50 text-red-600 rounded-lg hover:bg-red-100"><T k="노쇼" /></button>
            </>}
            {sel.status === 'CHECKED_IN' && <button onClick={() => { doStatus(sel.id, 'IN_PROGRESS'); router.push(`/patients/${sel.patientId}/encounter/new`); }} className="px-3 py-1.5 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700"><T k="진료 시작" /></button>}
            {sel.status === 'IN_PROGRESS' && <button onClick={() => doStatus(sel.id, 'COMPLETED')} className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"><T k="완료@버튼" /></button>}
            <button onClick={() => setSel(null)} className="ml-auto px-3 py-1.5 text-sm text-gray-400 hover:text-gray-600"><T k="닫기" /></button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
