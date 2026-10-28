'use client';

/**
 * 환자별 오더 매트릭스(2026-10-06) — 환자(행) × 부서(열) + 환자별 확인 사항.
 *
 * 🔴 칸의 수·국면은 서버가 센 값(국면 정본 그대로) — 화면이 다시 판정하지 않는다. 오더가 없는 칸은 비운다(0 을 그리지 않는다).
 * 🔴 정렬은 서버 순서(STAT → 위급 → 가장 오래된 대기) — 위에서부터 먼저 볼 환자.
 * 🔴 확인 사항은 **기록에서 규칙으로 센 사실**(shared `patientOrderNotes`) — 임상 판단·처방 권고가 아니다.
 *    "지연"은 원내 주의 기준이 있을 때만 말한다(없으면 경과만).
 * 외국인 환자는 원어 이름과 한국식 호칭을 함께(PatientName · shared `patientNameView`).
 */
import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  genderText, ORDER_DEPTS, ORDER_DEPT_LABEL, ORDER_STAGE_LABEL, ORDER_TRACK_PHASES, ORDER_TRACK_PHASE_LABEL,
  type OrderDept,
} from '@hospital-run/shared';
import { useHasRole } from '@/hooks/use-admin-write';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { Duration, PatientName } from '@/components/ui/display';
import { T, Tf } from '@/components/ui/i18n-text';
import { CARE_UI } from './care-ui';
import { useOrderTracking, PopulationNote, StageLine } from './OrderTrackingBoard';
import { DEPT_TONE, PHASE_TONE, type TrackCell, type TrackOrder, type Tracking } from './tracking-types';
import { NotesList } from './order-notes';
import { OrderPatientDrawer } from './OrderPatientDrawer';

/** 칸 안에 바로 보이는 오더 줄 수 — 넘으면 "+N" (칸을 누르면 전부) */
const CELL_LINES = 3;
const prioRank = (p: string) => (p === 'STAT' ? 0 : p === 'URGENT' ? 1 : 2);
const phaseRank = (ph: string) => ORDER_TRACK_PHASES.indexOf(ph as (typeof ORDER_TRACK_PHASES)[number]);

function CellBody({ c, orders }: { c: TrackCell; orders: TrackOrder[] }) {
  const sorted = [...orders].sort((a, b) => prioRank(a.priority) - prioRank(b.priority) || Number(b.critical) - Number(a.critical) || phaseRank(a.phase) - phaseRank(b.phase));
  return (
    <div>
      <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-gray-100" aria-hidden>
        {ORDER_TRACK_PHASES.map((ph) => c.byPhase[ph] > 0 && (
          <span key={ph} className={PHASE_TONE[ph].bar} style={{ width: `${(c.byPhase[ph] / c.total) * 100}%` }} />
        ))}
      </div>
      <ul className="mt-1.5 space-y-0.5">
        {sorted.slice(0, CELL_LINES).map((o) => (
          <li key={o.id} className="flex items-center gap-1 text-[11px]" data-track-cell-order={o.id}>
            <span className={`h-2 w-2 shrink-0 rounded-full ${PHASE_TONE[o.phase].bar}`} title={ORDER_TRACK_PHASE_LABEL[o.phase]} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-gray-800" title={o.name ?? undefined}>{o.name ?? <T k="이름 없음" />}</span>
            {o.priority === 'STAT' && <span className="rounded bg-rose-600 px-1 text-[9px] font-bold text-white">STAT</span>}
            {o.critical && <span className="rounded bg-rose-100 px-1 text-[9px] font-semibold text-rose-700"><T k="위급" /></span>}
            {o.current && <span className="shrink-0 text-[10px] text-gray-400"><T k={ORDER_STAGE_LABEL[o.current.key]} /></span>}
            {o.sinceOrderedMin != null && <span className={`shrink-0 tabular-nums text-[10px] ${o.attention ? 'font-semibold text-rose-600' : 'text-gray-500'}`}><Duration minutes={o.sinceOrderedMin} dense /></span>}
          </li>
        ))}
      </ul>
      {sorted.length > CELL_LINES && <p className="mt-0.5 text-[10px] text-gray-400"><Tf k="+{수}건 더" params={{ 수: sorted.length - CELL_LINES }} /></p>}
    </div>
  );
}

export function OrderPatientMatrix({ date, filters }: { date: string; filters: { dept: OrderDept | ''; care: string; statOnly: boolean; search: string } }) {
  // 서버 @Roles(ADMIN·DOCTOR·NURSE·PHARMACIST·LAB_TECH) 와 같은 판정 — 권한 밖이면 부르지 않는다
  const canView = useHasRole('DOCTOR', 'NURSE', 'PHARMACIST', 'LAB_TECH');
  const q = useOrderTracking(date, canView);
  const [open, setOpen] = useState<{ patientId: string; dept: OrderDept } | null>(null);
  /** 드릴다운 — 환자 이름을 누르면 그 환자의 오더 상세(결과·처방·사람·차트 연동) */
  const [drawer, setDrawer] = useState<string | null>(null);

  const rows = useMemo(() => {
    const t: Tracking | undefined = q.data;
    if (!t) return [];
    const s = filters.search.trim().toLowerCase();
    return t.matrix.filter((m) =>
      (!filters.care || m.careContext === filters.care) &&
      (!filters.statOnly || m.stat > 0) &&
      (!filters.dept || m.cells[filters.dept]) &&
      (!s || `${m.patient.name} ${m.patient.koreanName ?? ''} ${m.patient.mrn}`.toLowerCase().includes(s)));
  }, [q.data, filters]);
  const byId = useMemo(() => new Map((q.data?.orders ?? []).map((o) => [o.id, o])), [q.data]);

  if (!canView) return <p className="rounded-xl bg-white p-6 text-sm text-gray-500"><T k="오더 실시간 추적은 의사·간호사·약사·임상병리사가 봅니다." /></p>;
  if (q.isError) return <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} />;
  const t = q.data;
  if (!t) return <div className="h-64 animate-pulse rounded-2xl bg-gray-100" />;
  const depts = filters.dept ? [filters.dept] : [...ORDER_DEPTS];
  const openOrders = open ? t.orders.filter((o) => o.patient?.id === open.patientId && o.department === open.dept) : [];
  const ordersOf = (c: TrackCell | null) => (c ? c.orderIds.map((id) => byId.get(id)).filter((o): o is TrackOrder => !!o) : []);

  return (
    <div className="space-y-3" data-track-matrix>
      <div className="flex flex-wrap items-center gap-3">
        <PopulationNote t={t} />
        <span className="ml-auto flex flex-wrap items-center gap-2 text-[10px] text-gray-500" data-track-legend>
          {ORDER_TRACK_PHASES.map((ph) => <span key={ph} className="flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${PHASE_TONE[ph].bar}`} aria-hidden /><T k={ORDER_TRACK_PHASE_LABEL[ph]} /></span>)}
        </span>
      </div>
      {rows.length !== t.matrix.length && <p className="text-[11px] text-blue-700"><Tf k="필터 적용 — 환자 {전체}명 중 {수}명" params={{ 전체: t.matrix.length, 수: rows.length }} /></p>}

      {rows.length === 0 ? (
        <p className="rounded-2xl bg-white p-8 text-center text-sm text-gray-400"><T k="조건에 맞는 환자의 오더가 없습니다." /></p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white shadow-sm">
          <table className="w-full min-w-[1180px] table-fixed text-sm">
            <colgroup>
              <col className="w-[220px]" /><col className="w-[96px]" />
              {depts.map((d) => <col key={d} />)}
              <col className="w-[260px]" />
            </colgroup>
            <thead className="sticky top-0 z-10 bg-gray-50/95 text-[11px] text-gray-500 backdrop-blur">
              <tr>
                <th className="px-3 py-2 text-left font-semibold"><T k="환자" /></th>
                <th className="px-3 py-2 text-left font-semibold"><T k="처리 중 / 전체" /></th>
                {depts.map((d) => <th key={d} className="px-3 py-2 text-left font-semibold"><span className={`rounded px-1.5 py-0.5 ring-1 ${DEPT_TONE[d]}`}><T k={ORDER_DEPT_LABEL[d]} /></span></th>)}
                <th className="px-3 py-2 text-left font-semibold"><T k="권고·확인 사항" /></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((m) => (
                <Fragment key={m.patient.id}>
                  <tr className={m.stat > 0 ? 'bg-rose-50/30' : ''} data-track-row={m.patient.id}>
                    <td className="px-3 py-2.5 align-top">
                      <button type="button" onClick={() => setDrawer(m.patient.id)} data-track-drill={m.patient.id} className="block text-left font-semibold text-gray-900 hover:text-blue-700">
                        <PatientName name={m.patient.name} koreanName={m.patient.koreanName} showMrn={false} maskable />
                        <span className="ml-1 text-[10px] font-normal text-blue-600"><T k="상세" /> ›</span>
                      </button>
                      <Link href={`/patients/${m.patient.id}`} className="text-[10px] text-gray-400 hover:text-blue-700"><T k="차트 열기" /> →</Link>
                      <p className="text-[10px] text-gray-500">
                        {m.patient.mrn}
                        {(m.patient.age != null || m.patient.gender) && <> · {m.patient.age != null && <Tf k="{나이}세" params={{ 나이: m.patient.age }} />}{m.patient.gender && <> <T k={genderText(m.patient.gender)} /></>}</>}
                      </p>
                      <p className="mt-0.5 flex flex-wrap gap-1 text-[10px] text-gray-500">
                        {CARE_UI[m.careContext] && <span className={`rounded px-1 ${CARE_UI[m.careContext].cls}`}>{CARE_UI[m.careContext].icon} <T k={CARE_UI[m.careContext].label} /></span>}
                        {m.location && <span className="rounded bg-gray-100 px-1">{m.location.ward ?? ''} {m.location.room}-{m.location.bed}</span>}
                      </p>
                      {m.doctors && m.doctors.length > 0 && <p className="mt-0.5 truncate text-[10px] text-gray-400"><T k="진료의" /> {m.doctors.join(', ')}</p>}
                    </td>
                    <td className="px-3 py-2.5 align-top tabular-nums">
                      <span className="text-base font-bold text-gray-900">{m.active}</span><span className="text-gray-400"> / {m.total}</span>
                      {m.oldestActiveMin != null && <p className="text-[10px] text-gray-500"><T k="최장" /> <Duration minutes={m.oldestActiveMin} dense /></p>}
                      {m.critical > 0 && <p className="text-[10px] font-semibold text-rose-600"><T k="위급" /> {m.critical}</p>}
                    </td>
                    {depts.map((d) => {
                      const c = m.cells[d];
                      const isOpen = open?.patientId === m.patient.id && open.dept === d;
                      return (
                        <td key={d} className="px-2 py-2 align-top" data-track-matrix-cell={`${m.patient.id}-${d}`}>
                          {!c ? <span className="px-1 text-gray-200">·</span> : (
                            <button type="button" onClick={() => setOpen(isOpen ? null : { patientId: m.patient.id, dept: d })}
                              className={`w-full rounded-lg p-1.5 text-left transition hover:bg-gray-50 ${isOpen ? 'bg-blue-50 ring-1 ring-blue-200' : ''}`}>
                              <CellBody c={c} orders={ordersOf(c)} />
                            </button>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2.5 align-top"><NotesList notes={m.notes ?? []} /></td>
                  </tr>
                  {open?.patientId === m.patient.id && (
                    <tr data-track-matrix-detail>
                      <td colSpan={3 + depts.length} className="bg-blue-50/30 px-4 py-3">
                        <ul className="space-y-2">
                          {openOrders.map((o) => (
                            <li key={o.id} className="rounded-xl bg-white p-3 shadow-sm">
                              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                                <span className="font-semibold text-gray-900">{o.name ?? <T k="이름 없음" />}</span>
                                {o.priority === 'STAT' && <span className="rounded bg-rose-600 px-1 text-[9px] font-bold text-white">STAT</span>}
                                {o.critical && <span className="rounded bg-rose-100 px-1 text-[9px] font-semibold text-rose-700"><T k="위급" /></span>}
                                {o.doctor && <span className="text-[10px] text-gray-500"><T k="진료의" /> {o.doctor}</span>}
                                {o.next && <span className="text-[10px] text-gray-500"><T k="다음 단계" /> <b><T k={ORDER_STAGE_LABEL[o.next]} /></b></span>}
                                <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-semibold ${PHASE_TONE[o.phase].soft} ${PHASE_TONE[o.phase].text}`}><T k={ORDER_TRACK_PHASE_LABEL[o.phase]} /></span>
                              </div>
                              <div className="overflow-x-auto"><StageLine o={o} /></div>
                            </li>
                          ))}
                        </ul>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {drawer && <OrderPatientDrawer patientId={drawer} onClose={() => setDrawer(null)} />}
      <p className="text-[10px] text-gray-400" data-track-notes-disclaimer>
        <T k="권고·확인 사항은 오더 기록에서 정해진 규칙으로 센 사실입니다 — 임상 판단이나 처방 권고가 아닙니다. 지연은 원내 주의 기준이 있을 때만 말합니다(위원회 기준 탭)." />
      </p>
    </div>
  );
}
