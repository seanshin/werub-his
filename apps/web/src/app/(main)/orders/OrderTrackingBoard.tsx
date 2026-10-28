'use client';

/**
 * 오더 실시간 추적 보드(2026-10-06) — 부서(행) × 국면(열) 스윔레인.
 *
 * 🔴 단계·국면은 서버 정본(도메인 원장 단계 시각 → shared `orderTrackPhaseOf`) — 화면은 다시 판정하지 않는다.
 * 🔴 경과는 활성 오더에만 · "주의"는 원내 기준(`orders.tracking.attentionMin`)이 있을 때만 — 없으면 그 사실을 말하고 색으로 판정하지 않는다.
 * 🔴 모집단을 밝힌다 — 고른 날 발행분 + 아직 끝나지 않은 오더(날짜 무관). 지난 날 완료분의 결과 미확인은 결과 확인함이 정본.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ORDER_DEPTS, ORDER_DEPT_LABEL, ORDER_STAGE_LABEL, ORDER_TRACK_PHASE_LABEL, RATIO_UNAVAILABLE,
  type OrderDept, type OrderTrackPhase,
} from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { pollMs } from '@/lib/ui-settings';
import { useHasRole } from '@/hooks/use-admin-write';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { Duration, KDate, PatientName } from '@/components/ui/display';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { CARE_UI, CARE_ORDER } from './care-ui';
import { OrderPatientDrawer } from './OrderPatientDrawer';
import { DEPT_TONE, PHASE_TONE, type TrackOrder, type Tracking } from './tracking-types';

const BOARD_PHASES: OrderTrackPhase[] = ['WAITING', 'IN_PROCESS', 'RESULT_UNACK', 'DONE'];
/** 결과를 의사가 확인하는 부서 — 그 밖의 부서엔 결과 미확인 칸이 없다 */
const ACK_DEPTS = new Set<OrderDept>(['LAB', 'IMAGING']);
const CELL_PREVIEW = 5;

/** 같은 조회를 보드·매트릭스가 함께 쓴다(같은 키 — 한 번만 부른다) */
export function useOrderTracking(date: string, enabled: boolean) {
  return useQuery({
    queryKey: ['orders-tracking', date],
    queryFn: () => apiClient.get<{ data: Tracking }>(`/api/v1/orders/tracking?date=${date}`).then((r) => r.data),
    enabled,
    refetchInterval: pollMs('fast'),
  });
}

const prioRank = (p: string) => (p === 'STAT' ? 0 : p === 'URGENT' ? 1 : 2);
/** 칸 안 순서 — 긴급 → 위급 → 오래 머문 것 */
const cardOrder = (a: TrackOrder, b: TrackOrder) =>
  prioRank(a.priority) - prioRank(b.priority) || Number(b.critical) - Number(a.critical) || (b.sinceOrderedMin ?? -1) - (a.sinceOrderedMin ?? -1);

export function TrackFilters({ date, setDate, dept, setDept, care, setCare, statOnly, setStatOnly, search, setSearch }: {
  date: string; setDate: (v: string) => void; dept: OrderDept | ''; setDept: (v: OrderDept | '') => void;
  care: string; setCare: (v: string) => void; statOnly: boolean; setStatOnly: (v: boolean) => void; search: string; setSearch: (v: string) => void;
}) {
  const tAttr = useTAttr();
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-gray-100 bg-white px-3 py-2 shadow-sm" data-track-filters>
      <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label={tAttr('발행일')}
        className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
      <span className="h-5 w-px bg-gray-200" />
      <div className="flex gap-1">
        <button type="button" onClick={() => setDept('')} className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${dept === '' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}><T k="전 부서" /></button>
        {ORDER_DEPTS.map((d) => (
          <button key={d} type="button" onClick={() => setDept(dept === d ? '' : d)}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${dept === d ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            <T k={ORDER_DEPT_LABEL[d]} />
          </button>
        ))}
      </div>
      <span className="h-5 w-px bg-gray-200" />
      <div className="flex gap-1">
        {CARE_ORDER.map((c) => (
          <button key={c} type="button" onClick={() => setCare(care === c ? '' : c)} title={tAttr(CARE_UI[c].hint)}
            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium ${care === c ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {CARE_UI[c].icon} <T k={CARE_UI[c].label} />
          </button>
        ))}
      </div>
      <button type="button" onClick={() => setStatOnly(!statOnly)}
        className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${statOnly ? 'bg-rose-600 text-white' : 'border border-gray-200 text-gray-600 hover:border-rose-300 hover:text-rose-600'}`}>STAT</button>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={tAttr('환자·MRN·오더명')}
        className="ml-auto w-48 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs" />
    </div>
  );
}

export function PopulationNote({ t }: { t: Tracking }) {
  return (
    <p className="text-[11px] text-gray-500" data-track-population>
      <Tf k="{날짜} 발행분 + 아직 끝나지 않은 오더(날짜 무관 · 이전 발행 {수}건)" params={{ 날짜: t.date, 수: t.summary.carriedOver }} />
      {' · '}<T k="지난 날 완료분의 결과 미확인은 결과 확인함에서" />
      {' · '}<T k="갱신" /> <KDate value={t.now} mode="timeSec" />
      {t.truncated && <span className="ml-1 font-semibold text-amber-700"> · <Tf k="전체 {전체}건 중 {수}건만 표시(오래된 순)" params={{ 전체: t.total, 수: t.orders.length }} /></span>}
    </p>
  );
}

function Kpi({ label, value, tone, sub, data }: { label: React.ReactNode; value: React.ReactNode; tone: string; sub?: React.ReactNode; data?: string }) {
  return (
    <div className={`rounded-2xl px-4 py-3 ${tone}`} data-track-kpi={data}>
      <p className="text-[11px] font-medium opacity-80">{label}</p>
      <p className="text-2xl font-black tabular-nums leading-tight">{value}</p>
      {sub && <p className="mt-0.5 text-[10px] opacity-75">{sub}</p>}
    </div>
  );
}

/** 단계 줄 — 시각이 있는 단계만 채운다(빈 단계는 기록 없음) */
export function StageLine({ o }: { o: TrackOrder }) {
  return (
    <ol className="flex flex-wrap items-start" data-track-stages>
      {o.stages.map((s, i) => {
        const isCur = o.current?.key === s.key;
        const isNext = o.next === s.key;
        return (
          <li key={`${s.key}-${i}`} className="flex items-start">
            {i > 0 && <span className={`mt-[7px] h-px w-4 ${s.at ? 'bg-gray-400' : 'bg-gray-200'}`} aria-hidden />}
            <span className="flex min-w-[44px] flex-col items-center text-center">
              <span className={`h-3.5 w-3.5 rounded-full border-2 ${s.key === 'CANCELLED' ? 'border-gray-500 bg-gray-500' : s.at ? (isCur ? 'border-blue-600 bg-blue-600 ring-4 ring-blue-100' : 'border-emerald-500 bg-emerald-500') : isNext ? 'border-blue-400 bg-white' : 'border-gray-300 bg-white'}`} aria-hidden />
              <span className={`mt-0.5 text-[10px] ${s.at ? 'text-gray-700' : 'text-gray-400'}`}><T k={ORDER_STAGE_LABEL[s.key]} /></span>
              <span className="text-[10px] tabular-nums text-gray-400">{s.at ? <KDate value={s.at} mode="time" /> : '—'}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function OrderCard({ o, selected, onSelect }: { o: TrackOrder; selected: boolean; onSelect: () => void }) {
  const bar = o.priority === 'STAT' ? 'bg-rose-500' : o.priority === 'URGENT' ? 'bg-amber-400' : 'bg-gray-200';
  return (
    <button type="button" onClick={onSelect} data-track-card={o.id}
      className={`group relative flex w-full overflow-hidden rounded-xl border bg-white text-left shadow-sm transition hover:shadow-md ${selected ? 'border-blue-400 ring-2 ring-blue-100' : o.attention ? 'border-rose-300' : 'border-gray-100'}`}>
      <span className={`w-1 shrink-0 ${bar}`} aria-hidden />
      <span className="min-w-0 flex-1 px-2.5 py-1.5">
        <span className="flex items-center gap-1 text-[11px]">
          <span className="truncate font-semibold text-gray-900">{o.patient ? <PatientName name={o.patient.name} koreanName={o.patient.koreanName} showMrn={false} maskable /> : '—'}</span>
          {o.priority === 'STAT' && <span className="rounded bg-rose-600 px-1 text-[9px] font-bold text-white">STAT</span>}
          {o.critical && <span className="rounded bg-rose-100 px-1 text-[9px] font-semibold text-rose-700"><T k="위급" /></span>}
          {o.carriedOver && <span className="rounded bg-gray-100 px-1 text-[9px] text-gray-500"><T k="이전 발행" /></span>}
        </span>
        <span className="block truncate text-[11px] text-gray-600">{o.name ?? <T k="이름 없음" />}</span>
        <span className="mt-0.5 flex items-center gap-1 text-[10px] text-gray-500">
          {CARE_UI[o.careContext] && <span>{CARE_UI[o.careContext].icon}</span>}
          {o.current && <span><T k={ORDER_STAGE_LABEL[o.current.key]} /></span>}
          {o.inStageMin != null && <span className={`tabular-nums ${o.attention ? 'font-semibold text-rose-600' : ''}`}>· <Duration minutes={o.inStageMin} dense /></span>}
          {o.totalMin != null && <span className="tabular-nums">· <T k="총" /> <Duration minutes={o.totalMin} dense /></span>}
        </span>
      </span>
    </button>
  );
}

function OrderDetail({ o, onDrill }: { o: TrackOrder; onDrill: (patientId: string) => void }) {
  return (
    <div className="rounded-2xl border border-blue-100 bg-blue-50/40 p-4" data-track-detail={o.id}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1 ${DEPT_TONE[o.department]}`}><T k={ORDER_DEPT_LABEL[o.department]} /></span>
        <p className="text-sm font-bold text-gray-900">{o.name ?? <T k="이름 없음" />}</p>
        {o.patient && (
          <Link href={`/patients/${o.patient.id}`} className="text-xs text-blue-700 hover:underline">
            <PatientName name={o.patient.name} koreanName={o.patient.koreanName} mrn={o.patient.mrn} maskable />
          </Link>
        )}
        <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold ${PHASE_TONE[o.phase].soft} ${PHASE_TONE[o.phase].text}`}><T k={ORDER_TRACK_PHASE_LABEL[o.phase]} /></span>
      </div>
      <p className="mt-1 text-[11px] text-gray-500">
        <T k="발행" /> <KDate value={o.createdAt} mode="datetimeShort" />
        {o.doctor && <> · <T k="진료의" /> {o.doctor}</>}
        {o.next && <> · <T k="다음 단계" /> <b><T k={ORDER_STAGE_LABEL[o.next]} /></b></>}
        {o.sinceOrderedMin != null && <> · <T k="발행 후" /> <Duration minutes={o.sinceOrderedMin} /></>}
      </p>
      <div className="mt-3 overflow-x-auto"><StageLine o={o} /></div>
      {o.patient && (
        <button type="button" onClick={() => onDrill(o.patient!.id)} data-track-drill={o.patient.id}
          className="mt-3 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50">
          <T k="이 환자의 오더 전체·결과 보기" /> ›
        </button>
      )}
    </div>
  );
}

export function OrderTrackingBoard({ date, filters }: { date: string; filters: { dept: OrderDept | ''; care: string; statOnly: boolean; search: string } }) {
  // 서버 @Roles(ADMIN·DOCTOR·NURSE·PHARMACIST·LAB_TECH) 와 같은 판정 — 권한 밖이면 부르지 않는다
  const canView = useHasRole('DOCTOR', 'NURSE', 'PHARMACIST', 'LAB_TECH');
  const q = useOrderTracking(date, canView);
  const [selected, setSelected] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [drawer, setDrawer] = useState<string | null>(null);

  const visible = useMemo(() => {
    const t = q.data;
    if (!t) return [];
    const s = filters.search.trim().toLowerCase();
    return t.orders.filter((o) =>
      (!filters.dept || o.department === filters.dept) &&
      (!filters.care || o.careContext === filters.care) &&
      (!filters.statOnly || o.priority === 'STAT') &&
      (!s || `${o.patient?.name ?? ''} ${o.patient?.mrn ?? ''} ${o.name ?? ''}`.toLowerCase().includes(s)));
  }, [q.data, filters]);

  if (!canView) return <p className="rounded-xl bg-white p-6 text-sm text-gray-500"><T k="오더 실시간 추적은 의사·간호사·약사·임상병리사가 봅니다." /></p>;
  if (q.isError) return <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} />;
  const t = q.data;
  if (!t) return <div className="h-64 animate-pulse rounded-2xl bg-gray-100" />;
  const s = t.summary;
  const sel = selected ? t.orders.find((o) => o.id === selected) ?? null : null;
  const depts = filters.dept ? [filters.dept] : [...ORDER_DEPTS];
  const filtered = visible.length !== t.orders.length;

  return (
    <div className="space-y-4" data-track-board>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
        <Kpi data="active" label={<T k="처리 중(활성)" />} value={s.active} tone="bg-gray-900 text-white" />
        <Kpi data="waiting" label={<T k="접수 대기" />} value={s.waiting} tone="bg-amber-50 text-amber-900"
          sub={t.lanes.some((l) => l.oldestWaitingMin != null) ? <><T k="가장 오래" /> <Duration minutes={Math.max(...t.lanes.map((l) => l.oldestWaitingMin ?? 0))} dense /></> : undefined} />
        <Kpi data="inProcess" label={<T k="진행 중" />} value={s.inProcess} tone="bg-sky-50 text-sky-900" />
        <Kpi data="resultUnack" label={<T k="결과 미확인" />} value={s.resultUnack} tone="bg-violet-50 text-violet-900" />
        <Kpi data="stat" label={<T k="STAT 진행" />} value={s.statActive} tone={s.statActive ? 'bg-rose-600 text-white' : 'bg-gray-50 text-gray-500'} />
        <Kpi data="critical" label={<T k="위급 결과" />} value={s.critical} tone={s.critical ? 'bg-rose-50 text-rose-800' : 'bg-gray-50 text-gray-500'} />
        <Kpi data="done" label={<T k="완료" />} value={s.done} tone="bg-emerald-50 text-emerald-900" sub={<><T k="취소" /> {s.cancelled}</>} />
        <Kpi data="attention" label={<T k="주의(기준 초과)" />}
          value={s.attention == null ? <span className="text-sm font-semibold"><T k="기준 미설정" /></span> : s.attention}
          tone={s.attention ? 'bg-rose-50 text-rose-800' : 'bg-gray-50 text-gray-500'}
          sub={s.attention == null ? <T k="경과만 표시 — 지연을 판정하지 않습니다" /> : undefined} />
      </div>

      <PopulationNote t={t} />
      {filtered && <p className="text-[11px] text-blue-700"><Tf k="필터 적용 — {전체}건 중 {수}건" params={{ 전체: t.orders.length, 수: visible.length }} /></p>}

      {/* 스윔레인 — 부서(행) × 국면(열) */}
      <div className="overflow-x-auto rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="grid min-w-[960px] grid-cols-[180px_repeat(4,minmax(0,1fr))]">
          <div className="border-b border-gray-100 bg-gray-50/80 px-3 py-2 text-[11px] font-semibold text-gray-500"><T k="부서" /></div>
          {BOARD_PHASES.map((ph) => (
            <div key={ph} className="flex items-center gap-1.5 border-b border-l border-gray-100 bg-gray-50/80 px-3 py-2 text-[11px] font-semibold text-gray-600">
              <span className={`h-2 w-2 rounded-full ${PHASE_TONE[ph].bar}`} aria-hidden /><T k={ORDER_TRACK_PHASE_LABEL[ph]} />
            </div>
          ))}
          {depts.map((d) => {
            const lane = t.lanes.find((l) => l.department === d)!;
            return (
              <div key={d} className="contents" data-track-lane={d}>
                <div className="border-b border-gray-100 px-3 py-3">
                  <span className={`rounded-md px-2 py-0.5 text-xs font-bold ring-1 ${DEPT_TONE[d]}`}><T k={ORDER_DEPT_LABEL[d]} /></span>
                  <p className="mt-1.5 text-[11px] text-gray-500"><Tf k="전체 {수}" params={{ 수: lane.total }} />{lane.byPhase.CANCELLED > 0 && <> · <T k="취소" /> {lane.byPhase.CANCELLED}</>}</p>
                  {lane.stat > 0 && <p className="text-[11px] font-semibold text-rose-600">STAT {lane.stat}</p>}
                  <p className="text-[10px] text-gray-400" data-track-tat>
                    <T k="발행→결과 중앙값" />{' '}
                    {lane.turnaroundMin.value == null ? <><T k={RATIO_UNAVAILABLE} /> — <T k="표본 없음" /></> : <><Duration minutes={lane.turnaroundMin.value} dense /> (n={lane.turnaroundMin.n})</>}
                  </p>
                </div>
                {BOARD_PHASES.map((ph) => {
                  if (ph === 'RESULT_UNACK' && !ACK_DEPTS.has(d)) {
                    return <div key={ph} className="border-b border-l border-gray-100 bg-gray-50/40 px-3 py-3 text-center text-[11px] text-gray-300" data-track-na><T k="해당 없음" /></div>;
                  }
                  const xs = visible.filter((o) => o.department === d && o.phase === ph).sort(cardOrder);
                  const key = `${d}-${ph}`;
                  const shown = expanded[key] ? xs : xs.slice(0, CELL_PREVIEW);
                  return (
                    <div key={ph} className={`space-y-1.5 border-b border-l border-gray-100 px-2 py-2 ${xs.length ? PHASE_TONE[ph].soft : ''}`} data-track-cell={key}>
                      <p className={`px-1 text-[11px] font-bold tabular-nums ${PHASE_TONE[ph].text}`}>{xs.length}</p>
                      {shown.map((o) => <OrderCard key={o.id} o={o} selected={selected === o.id} onSelect={() => setSelected(selected === o.id ? null : o.id)} />)}
                      {xs.length > CELL_PREVIEW && (
                        <button type="button" onClick={() => setExpanded({ ...expanded, [key]: !expanded[key] })} className="w-full rounded-lg py-1 text-[11px] text-gray-500 hover:bg-white">
                          {expanded[key] ? <T k="접기" /> : <Tf k="+{수}건 더" params={{ 수: xs.length - CELL_PREVIEW }} />}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {sel && <OrderDetail o={sel} onDrill={setDrawer} />}
      {drawer && <OrderPatientDrawer patientId={drawer} onClose={() => setDrawer(null)} />}
      <p className="text-[10px] text-gray-400">
        <T k="카드: 왼쪽 띠 = 긴급도(STAT·응급) · 지금 단계와 그 단계에 머문 시간 · 완료는 발행→완료 총 시간" />
        {t.attention.configured && <> · <T k="빨간 테두리 = 원내 주의 기준 초과" /></>}
      </p>
    </div>
  );
}
