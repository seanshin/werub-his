'use client';

/**
 * 환자 오더 드릴다운(2026-10-06) — 오른쪽 서랍. 한 환자의 최근 7일 + 끝나지 않은 오더를 결과·사람·처방 세부까지.
 *
 * 🔴 결과는 원장 값 그대로(수치·플래그·참고 범위 · 재반올림·재판정 없음) · 판독 문구 그대로.
 * 🔴 동작은 **기존 정본 EP 만** — 접수·시행 시작(`PATCH orders/:id/status` · 전이 규칙·시행 범위는 서버)·결과 확인(`PATCH doctors/orders/:id/acknowledge`).
 *    완료(결과 입력)는 각 워크스테이션의 일이라 여기서 하지 않는다(링크로).
 * 🔴 차트 연동 — 환자 차트의 해당 탭으로 바로(`?tab=`).
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  genderText, isAbnormalFlag, isCriticalFlag,
  ORDER_DEPTS, ORDER_DEPT_LABEL, ORDER_STAGE_LABEL, ORDER_TRACK_PHASES, ORDER_TRACK_PHASE_LABEL,
  type OrderDept, type OrderNote, type OrderTrackPhase,
} from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/error-utils';
import { pollMs } from '@/lib/ui-settings';
import { toast } from '@/stores/toast-store';
import { useHasRole } from '@/hooks/use-admin-write';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { Duration, KDate, PatientName } from '@/components/ui/display';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { AllergyStatusBadge } from '@/components/clinical/allergy-status';
import { CARE_UI } from './care-ui';
import { StageLine } from './OrderTrackingBoard';
import { NotesList } from './order-notes';
import { DEPT_TONE, PHASE_TONE, type TrackLocation, type TrackOrder, type TrackPatient } from './tracking-types';

export interface DetailOrder extends TrackOrder {
  prescription: { id: string; type: string; dosage: string | null; frequency: string | null; route: string | null; duration: number | null; quantity: number | null; durWarnings: string[]; durOverridden: boolean; durOverrideReason: string | null } | null;
  people: { received: string | null; started: string | null; completed: string | null; acknowledged: string | null; cancelled: string | null };
  notes: string | null;
  lab: { status: string; items: { name: string; value: string; unit: string; flag: string | null; range: { min: string | null; max: string | null } | null }[] } | null;
  imaging: { status: string; impression: string | null; finding: string | null; reportedAt: string | null } | null;
  dispensing: { status: string } | null;
}
interface PatientDetail {
  now: string; period: { from: string; days: number }; truncated: boolean; total: number;
  patient: TrackPatient | null; location: TrackLocation | null; careContext: string | null; doctors: string[];
  attention: { configured: boolean }; notes: OrderNote[];
  byDept: { department: OrderDept; total: number; byPhase: Record<OrderTrackPhase, number> }[];
  orders: DetailOrder[];
}

/** 차트 연동 — 환자 차트 탭(`?tab=` · 차트 화면의 탭 키와 같다) */
const CHART_LINKS: { tab: string | null; label: string }[] = [
  { tab: null, label: '차트 개요' }, { tab: 'labresults', label: '검사결과' }, { tab: 'imaging', label: '영상' },
  { tab: 'medications', label: '투약 이력' }, { tab: 'orders', label: '오더 추적' }, { tab: 'journey', label: '여정' },
];
/** 부서 업무 화면 — 결과 입력·조제는 거기서 */
const DEPT_WORK: Record<OrderDept, { href: string; label: string }> = {
  LAB: { href: '/lab', label: '검사실' }, IMAGING: { href: '/imaging', label: '영상' }, PHARMACY: { href: '/pharmacy', label: '약국' }, THERAPY: { href: '/rehab', label: '재활·치료' },
};
const DEPT_BAR: Record<OrderDept, string> = { LAB: '#14b8a6', IMAGING: '#6366f1', PHARMACY: '#f59e0b', THERAPY: '#d946ef' };

/** 시간 축 차트 — 오더마다 발행→(완료 또는 지금) 막대 · 단계 시각 눈금 · 활성은 끝이 열려 있다 */
function OrderTimelineChart({ orders, from, now, onPick, picked }: { orders: DetailOrder[]; from: string; now: string; onPick: (id: string) => void; picked: string | null }) {
  const rows = [...orders].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-30);
  const t0 = Math.min(Date.parse(from), ...rows.map((o) => Date.parse(o.createdAt)));
  const t1 = Date.parse(now);
  const W = 640; const L = 150; const RH = 16; const H = rows.length * RH + 22;
  const x = (t: number) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - 8);
  const days = Math.ceil((t1 - t0) / 86_400_000);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="order timeline" data-drawer-timeline>
      {Array.from({ length: days + 1 }, (_, i) => t0 + i * 86_400_000).filter((t) => t <= t1).map((t) => (
        <g key={t}><line x1={x(t)} x2={x(t)} y1={0} y2={H - 16} stroke="#f1f5f9" /><text x={x(t) + 2} y={H - 4} fontSize="8" fill="#94a3b8">{new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Seoul', month: '2-digit', day: '2-digit' })}</text></g>
      ))}
      {rows.map((o, i) => {
        const y = i * RH + 4;
        const start = Date.parse(o.createdAt);
        const lastAt = o.stages.filter((s) => s.at).map((s) => Date.parse(s.at!)).sort((a, b) => b - a)[0] ?? start;
        const active = o.phase === 'WAITING' || o.phase === 'IN_PROCESS' || o.phase === 'RESULT_UNACK';
        const end = active ? t1 : lastAt;
        return (
          <g key={o.id} onClick={() => onPick(o.id)} className="cursor-pointer" data-timeline-row={o.id}>
            <title>{`${o.name ?? ''} · ${ORDER_TRACK_PHASE_LABEL[o.phase]}`}</title>
            <rect x={0} y={y - 2} width={W} height={RH} fill={picked === o.id ? '#eff6ff' : 'transparent'} />
            <text x={4} y={y + 9} fontSize="9" fill="#334155">{(o.name ?? '').slice(0, 20)}</text>
            <rect x={x(start)} y={y + 2} width={Math.max(2, x(end) - x(start))} height={8} rx={3} fill={DEPT_BAR[o.department]} opacity={o.phase === 'CANCELLED' ? 0.25 : active ? 0.55 : 0.9} />
            {active && <polygon points={`${x(end)},${y + 2} ${x(end) + 5},${y + 6} ${x(end)},${y + 10}`} fill={DEPT_BAR[o.department]} />}
            {o.stages.filter((s) => s.at && s.key !== 'ORDERED').map((s) => <rect key={s.key} x={x(Date.parse(s.at!)) - 0.75} y={y + 1} width={1.5} height={10} fill="#0f172a" opacity={0.6} />)}
            {o.priority === 'STAT' && <circle cx={x(start) - 4} cy={y + 6} r={2.5} fill="#e11d48" />}
          </g>
        );
      })}
    </svg>
  );
}

function LabTable({ lab }: { lab: NonNullable<DetailOrder['lab']> }) {
  if (!lab.items.length) return <p className="text-[11px] text-gray-400"><T k="결과 항목 없음" /></p>;
  return (
    <table className="mt-1 w-full text-[11px]" data-drawer-lab>
      <thead className="text-gray-400"><tr><th className="text-left font-medium"><T k="항목" /></th><th className="text-right font-medium"><T k="결과" /></th><th className="text-left font-medium pl-2"><T k="참고 범위" /></th></tr></thead>
      <tbody>
        {lab.items.map((i, k) => {
          const tone = isCriticalFlag(i.flag) ? 'text-rose-700 font-bold' : isAbnormalFlag(i.flag) ? 'text-amber-700 font-semibold' : 'text-gray-800';
          return (
            <tr key={`${i.name}-${k}`} className="border-t border-gray-50">
              <td className="py-0.5 text-gray-700">{i.name}</td>
              <td className={`py-0.5 text-right tabular-nums ${tone}`}>{i.value} <span className="font-normal text-gray-400">{i.unit}</span>{i.flag && <span className="ml-1 rounded bg-gray-100 px-1 text-[9px]">{i.flag}</span>}</td>
              <td className="py-0.5 pl-2 tabular-nums text-gray-400">{i.range ? `${i.range.min ?? ''}–${i.range.max ?? ''}` : '—'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function OrderCard({ o, open, onToggle, queryKeys }: { o: DetailOrder; open: boolean; onToggle: () => void; queryKeys: unknown[][] }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  // 서버 @Roles 와 같은 판정 — 상태 변경(PATCH orders/:id/status: 약사·검사·간호·의사·관리자) · 결과 확인(의사·관리자)
  const canStatus = useHasRole('PHARMACIST', 'LAB_TECH', 'NURSE', 'DOCTOR');
  const canAck = useHasRole('DOCTOR');
  const refresh = () => { for (const k of queryKeys) qc.invalidateQueries({ queryKey: k }); };
  const status = useMutation({
    mutationFn: (next: 'RECEIVED' | 'IN_PROGRESS') => apiClient.patch(`/api/v1/orders/${o.id}/status`, { status: next }),
    onSuccess: () => { toast.success(tAttr('오더 상태를 바꿨습니다.')); refresh(); },
    onError: (e) => toast.error(extractErrorMessage(e) || tAttr('오더 상태를 바꾸지 못했습니다.')),
  });
  const ack = useMutation({
    mutationFn: () => apiClient.patch(`/api/v1/doctors/orders/${o.id}/acknowledge`, {}),
    onSuccess: () => { toast.success(tAttr('결과를 확인했습니다.')); refresh(); },
    onError: (e) => toast.error(extractErrorMessage(e) || tAttr('결과를 확인하지 못했습니다.')),
  });
  const rx = o.prescription;
  return (
    <li className={`rounded-xl border bg-white ${open ? 'border-blue-200 shadow-sm' : 'border-gray-100'}`} data-drawer-order={o.id}>
      <button type="button" onClick={onToggle} className="flex w-full flex-wrap items-center gap-1.5 px-3 py-2 text-left">
        <span className={`h-2 w-2 rounded-full ${PHASE_TONE[o.phase].bar}`} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900">{o.name ?? <T k="이름 없음" />}</span>
        {o.priority === 'STAT' && <span className="rounded bg-rose-600 px-1 text-[9px] font-bold text-white">STAT</span>}
        {o.critical && <span className="rounded bg-rose-100 px-1 text-[9px] font-semibold text-rose-700"><T k="위급" /></span>}
        {!o.critical && o.abnormal && <span className="rounded bg-amber-100 px-1 text-[9px] font-semibold text-amber-800"><T k="이상" /></span>}
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${PHASE_TONE[o.phase].soft} ${PHASE_TONE[o.phase].text}`}><T k={ORDER_TRACK_PHASE_LABEL[o.phase]} /></span>
        <span className="text-[10px] tabular-nums text-gray-400"><KDate value={o.createdAt} mode="datetimeShort" /></span>
        {o.sinceOrderedMin != null && <span className={`text-[10px] tabular-nums ${o.attention ? 'font-semibold text-rose-600' : 'text-gray-500'}`}><Duration minutes={o.sinceOrderedMin} dense /></span>}
        {o.totalMin != null && <span className="text-[10px] tabular-nums text-gray-400"><T k="총" /> <Duration minutes={o.totalMin} dense /></span>}
      </button>
      {open && (
        <div className="space-y-2 border-t border-gray-50 px-3 pb-3 pt-2" data-drawer-order-detail>
          <div className="overflow-x-auto"><StageLine o={o} /></div>
          {rx && o.department === 'PHARMACY' && (
            <p className="text-[11px] text-gray-600" data-drawer-rx>
              {[rx.dosage, rx.frequency, rx.route].filter(Boolean).join(' · ')}{rx.duration != null && <> · <Tf k="{일}일" params={{ 일: rx.duration }} /></>}{rx.quantity != null && <> · <T k="총량" /> {rx.quantity}</>}
            </p>
          )}
          {rx && rx.durWarnings.length > 0 && (
            <div className="rounded-lg bg-amber-50 px-2 py-1.5 text-[11px] text-amber-900" data-drawer-dur>
              <p className="font-semibold">DUR {rx.durOverridden ? <T k="경고 후 무시" /> : <T k="경고" />}</p>
              <ul className="list-inside list-disc">{rx.durWarnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
              {rx.durOverridden && <p className="mt-0.5"><T k="무시 사유" />: {rx.durOverrideReason ?? <span className="text-amber-700"><T k="기록 없음" /></span>}</p>}
            </div>
          )}
          {o.lab && <LabTable lab={o.lab} />}
          {o.imaging && (
            <div className="text-[11px]" data-drawer-imaging>
              {o.imaging.impression ? <p className="whitespace-pre-wrap text-gray-800"><b><T k="판독 소견" /></b> {o.imaging.impression}</p> : <p className="text-gray-400"><T k="판독 소견 없음" /></p>}
              {o.imaging.finding && <p className="mt-0.5 whitespace-pre-wrap text-gray-500">{o.imaging.finding}</p>}
            </div>
          )}
          {o.notes && <p className="text-[11px] text-gray-500"><T k="메모" />: {o.notes}</p>}
          <p className="text-[10px] text-gray-400">
            {o.doctor && <><T k="진료의" /> {o.doctor} · </>}
            {o.people.received && <><T k="접수" /> {o.people.received} · </>}
            {o.people.started && <><T k="시행" /> {o.people.started} · </>}
            {o.people.completed && <><T k="완료" /> {o.people.completed} · </>}
            {o.people.acknowledged && <><T k="의사 확인" /> {o.people.acknowledged} · </>}
            {o.people.cancelled && <><T k="취소" /> {o.people.cancelled}</>}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {canStatus && o.status === 'ORDERED' && (
              <button type="button" disabled={status.isPending} onClick={() => status.mutate('RECEIVED')} data-drawer-action="receive"
                className="min-h-[36px] rounded-lg bg-sky-600 px-3 text-xs font-semibold text-white disabled:opacity-50"><T k="접수" /></button>
            )}
            {canStatus && o.status === 'RECEIVED' && (
              <button type="button" disabled={status.isPending} onClick={() => status.mutate('IN_PROGRESS')} data-drawer-action="start"
                className="min-h-[36px] rounded-lg bg-sky-600 px-3 text-xs font-semibold text-white disabled:opacity-50"><T k="시행 시작" /></button>
            )}
            {canAck && o.phase === 'RESULT_UNACK' && (
              <button type="button" disabled={ack.isPending} onClick={() => ack.mutate()} data-drawer-action="ack"
                className="min-h-[36px] rounded-lg bg-violet-600 px-3 text-xs font-semibold text-white disabled:opacity-50"><T k="결과 확인" /></button>
            )}
            <Link href={DEPT_WORK[o.department].href} className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] text-gray-600 hover:bg-gray-50">
              <Tf k="{화면}에서 처리 →" params={{ 화면: tAttr(DEPT_WORK[o.department].label) }} />
            </Link>
          </div>
        </div>
      )}
    </li>
  );
}

export function OrderPatientDrawer({ patientId, onClose }: { patientId: string; onClose: () => void }) {
  // 서버 @Roles(ADMIN·DOCTOR·NURSE·PHARMACIST·LAB_TECH) 와 같은 판정 — 권한 밖이면 부르지 않는다
  const canView = useHasRole('DOCTOR', 'NURSE', 'PHARMACIST', 'LAB_TECH');
  const key = ['orders-tracking-patient', patientId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => apiClient.get<{ data: PatientDetail }>(`/api/v1/orders/tracking/patient/${patientId}`).then((r) => r.data),
    enabled: canView,
    refetchInterval: pollMs('fast'),
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const [dept, setDept] = useState<OrderDept | ''>('');
  const d = q.data;
  const list = useMemo(() => (d ? d.orders.filter((o) => !dept || o.department === dept) : []), [d, dept]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/20" onClick={onClose} data-order-drawer>
      <aside className="h-full w-full max-w-3xl overflow-y-auto bg-slate-50 shadow-2xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="patient orders">
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-gray-200 bg-white px-5 py-3">
          <p className="text-xs font-semibold text-gray-500"><T k="환자 오더 상세" /></p>
          <button type="button" onClick={onClose} className="ml-auto rounded-lg px-2 py-1 text-sm text-gray-500 hover:bg-gray-100" aria-label="close">✕</button>
        </div>
        {!canView ? <p className="m-5 text-sm text-gray-500"><T k="오더 실시간 추적은 의사·간호사·약사·임상병리사가 봅니다." /></p>
          : q.isError ? <div className="p-5"><QueryErrorFallback error={q.error} onRetry={() => q.refetch()} /></div>
            : !d ? <div className="m-5 h-64 animate-pulse rounded-2xl bg-gray-100" />
              : (
                <div className="space-y-4 p-5">
                  <section className="rounded-2xl bg-white p-4 shadow-sm" data-drawer-header>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-lg font-black text-gray-900">{d.patient ? <PatientName name={d.patient.name} koreanName={d.patient.koreanName} showMrn={false} maskable /> : '—'}</p>
                      {d.patient && <span className="font-mono text-xs text-gray-500">{d.patient.mrn}</span>}
                      {d.patient?.age != null && <span className="text-xs text-gray-500"><Tf k="{나이}세" params={{ 나이: d.patient.age }} /> {d.patient.gender && <T k={genderText(d.patient.gender)} />}</span>}
                      <AllergyStatusBadge patientId={patientId} />
                    </div>
                    <p className="mt-1 flex flex-wrap gap-1.5 text-[11px] text-gray-500">
                      {d.careContext && CARE_UI[d.careContext] && <span className={`rounded px-1.5 ${CARE_UI[d.careContext].cls}`}>{CARE_UI[d.careContext].icon} <T k={CARE_UI[d.careContext].label} /></span>}
                      {d.location && <span className="rounded bg-gray-100 px-1.5">{d.location.ward ?? ''} {d.location.room}-{d.location.bed}</span>}
                      {d.doctors.length > 0 && <span><T k="진료의" /> {d.doctors.join(', ')}</span>}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1.5" data-drawer-chart-links>
                      {CHART_LINKS.map((c) => (
                        <Link key={c.label} href={c.tab ? `/patients/${patientId}?tab=${c.tab}` : `/patients/${patientId}`}
                          className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-100">
                          <T k={c.label} /> →
                        </Link>
                      ))}
                    </div>
                  </section>

                  <section className="rounded-2xl bg-white p-4 shadow-sm">
                    <p className="mb-2 text-xs font-bold text-gray-700"><T k="권고·확인 사항" /></p>
                    <NotesList notes={d.notes} />
                  </section>

                  <section className="rounded-2xl bg-white p-4 shadow-sm">
                    <div className="mb-2 flex flex-wrap items-center gap-1.5">
                      <p className="text-xs font-bold text-gray-700"><T k="오더 시간 축" /></p>
                      <span className="text-[10px] text-gray-400"><Tf k="최근 {일}일 + 끝나지 않은 오더 · 막대 = 발행→완료(활성은 지금까지) · 눈금 = 단계 시각" params={{ 일: d.period.days }} /></span>
                    </div>
                    {d.orders.length ? <OrderTimelineChart orders={d.orders} from={d.period.from} now={d.now} picked={openId} onPick={(id) => setOpenId(id)} /> : <p className="text-xs text-gray-400"><T k="기간 안 오더가 없습니다." /></p>}
                    {d.orders.length > 30 && <p className="text-[10px] text-gray-400"><T k="시간 축은 최근 30건만 그립니다." /></p>}
                  </section>

                  <section className="space-y-2">
                    <div className="flex flex-wrap items-center gap-1">
                      <button type="button" onClick={() => setDept('')} className={`rounded-lg px-2.5 py-1 text-[11px] font-medium ${dept === '' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600'}`}><T k="전 부서" /> {d.orders.length}</button>
                      {d.byDept.filter((b) => b.total > 0).map((b) => (
                        <button key={b.department} type="button" onClick={() => setDept(dept === b.department ? '' : b.department)}
                          className={`rounded-lg px-2.5 py-1 text-[11px] font-medium ring-1 ${dept === b.department ? 'bg-gray-900 text-white ring-gray-900' : DEPT_TONE[b.department]}`}>
                          <T k={ORDER_DEPT_LABEL[b.department]} /> {b.total}
                          <span className="ml-1 inline-flex gap-0.5 align-middle">{ORDER_TRACK_PHASES.map((ph) => b.byPhase[ph] > 0 && <span key={ph} className={`h-1.5 w-1.5 rounded-full ${PHASE_TONE[ph].bar}`} aria-hidden />)}</span>
                        </button>
                      ))}
                      {d.truncated && <span className="ml-auto text-[10px] font-semibold text-amber-700"><Tf k="전체 {전체}건 중 최근 {수}건" params={{ 전체: d.total, 수: d.orders.length }} /></span>}
                    </div>
                    <ul className="space-y-1.5" data-drawer-orders>
                      {ORDER_DEPTS.flatMap((dp) => list.filter((o) => o.department === dp)).map((o) => (
                        <OrderCard key={o.id} o={o} open={openId === o.id} onToggle={() => setOpenId(openId === o.id ? null : o.id)} queryKeys={[key, ['orders-tracking']]} />
                      ))}
                    </ul>
                  </section>
                  <p className="text-[10px] text-gray-400"><T k="결과·판독은 원장 값 그대로입니다. 결과 입력·조제 완료는 각 부서 화면에서 합니다." /></p>
                </div>
              )}
      </aside>
    </div>
  );
}
