'use client';

import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { usePollInterval, kdate } from '@/lib/ui-settings';
import { Money, Duration, EmptyState, Ratio, Unit, KDate } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { usePatientNotifyConfirm, patientPushMessage } from '@/components/notification/PatientNotifyConfirm';
import { JOURNEY_FLAG_ORDER, journeyEventDisplay, journeyFlagLabel } from '@hospital-run/shared';
import { DelayAck } from './delay-ack';
import { LiveStreamBadge, useJourneyConsoleStream } from './live-stream';
import { RecordingHealth } from './recording-health';
import { JourneyTimelineCompact, type CompactJourneyEvent } from '@/components/journey/journey-timeline-compact';
import { ExportReadiness } from './export-readiness';

/**
 * 환자여정 관제 콘솔 — 재설계(2026-08-10 · journey-console-redesign.plan.md).
 *
 * 설계 원칙: 관제는 **지금 개입해야 할 사람**을 보여준다.
 *  - 완료는 카드가 아니라 카운트다(종전엔 '수납 완료' 329장이 보드를 지배했다).
 *  - 가장 오래 기다린 사람이 맨 위에 온다(종전엔 쿼리 순서였다).
 *  - 🔴 표본이 없으면 `0` 이 아니라 **산출 불가**로 말한다. `0` 은 "대기 없음"으로 읽힌다.
 */

type R = Record<string, unknown>;

interface Card {
  patientId: string; name: string; mrn: string; track: 'OPD' | 'IPD' | 'ER';
  stage: string; dept?: string; room?: string; ward?: string; bed?: string;
  doctorName?: string; encounterId?: string; queueNumber?: number; queueId?: string;
  stayMin?: number; stayDays?: number; admitDate?: string; unpaid: number;
  ktas?: string; chiefComplaint?: string; totalMin?: number;
  insuranceType?: string; flags: string[];
  /** 유효한 지연 확인 — 🔴 있어도 지연은 지연이다(숨기지 않는다) */
  ack?: { note: string; ackedByName: string | null; ackedAt: string; expiresAt: string };
}
interface Board {
  asOf: string; opd: Card[]; ipd: Card[]; er?: Card[];
  /** 🔴 확인 기록을 못 읽었으면 "확인 없음"으로 그리지 않는다 */
  ackUnavailable?: boolean;
}
interface Sample { value: number | null; n: number }
interface Kpi {
  activeOpd: number; activeIpd: number;
  avgWait?: Sample; avgStay?: Sample;
  unpaidTotal: number; unpaidCount: number; bedOccupancy: number | null;
  revenueToday: { confirmed: number; n?: number };
  thresholds?: { opdWaitMin: number; callDelayMin: number; cashierDelayMin: number; consultDelayMin: number; highUnpaid: number };
  /** 🔴 그 기준이 원내 설정값인지 코드 기본값인지 — 기본값을 정책인 척하지 않는다 */
  thresholdSources?: Record<string, 'CONFIG' | 'FALLBACK'>;
  /** 🔴 현장 화면이 쓰는 다른 기준 */
  fieldWaitThresholds?: { warnMinutes: number | null; dangerMinutes: number | null; source: string; screen: string };
  bedOccupied?: number; bedTotal?: number | null; bedDenominatorNote?: string;
  alerts?: Record<string, number>;
}
interface Bottleneck { track: string; stage: string; avg: number; breachRate: number | null; breachCount: number | null; count: number }

const OPD_STAGES = [
  { key: 'RECEPTION', label: '접수대기' },
  { key: 'CALLED', label: '호출됨' },
  { key: 'IN_CONSULT', label: '진료중' },
  { key: 'CASHIER_WAITING', label: '수납대기' },
];
const IPD_STAGES = [
  { key: 'ADMITTED', label: '입원' },
  { key: 'INWARD', label: '재원' },
  { key: 'DISCHARGE_PLANNED', label: '퇴원 예정' },
];
const ER_STAGES = [
  { key: 'ER_ARRIVED', label: '도착(트리아지 전)' },
  { key: 'ER_TRIAGED', label: '분류 완료' },
  { key: 'ER_TREATMENT', label: '처치중' },
  { key: 'ER_DISPOSITION', label: '퇴실 결정' },
];
/** 종결 단계 — 카드가 아니라 카운트로만 보여준다(관제 대상이 아니다). 클릭하면 펼쳐진다. */
const OPD_DONE = { key: 'DONE', label: '수납 완료' };
const IPD_DONE = { key: 'DISCHARGED', label: '퇴원/정산' };
const ER_DONE = { key: 'ER_DONE', label: '퇴실 완료' };

/** 🔴 라벨 정본은 shared 하나 — 여기에 다시 적었다가 상황판과 갈라졌다(2026-08-26) */
const FLAG_LABEL: Record<string, string> = Object.fromEntries(
  JOURNEY_FLAG_ORDER.map((f) => [f, journeyFlagLabel(f)]),
)
/** 🔴 순서도 정본에서 — 화면마다 다시 정렬하지 않는다 */
const ALERT_ORDER: string[] = JOURNEY_FLAG_ORDER;
/** KTAS 등급 색 — 1(소생)이 가장 위급 */
const KTAS_TONE: Record<string, string> = {
  LEVEL_1: 'bg-rose-100 text-rose-700', LEVEL_2: 'bg-orange-100 text-orange-700',
  LEVEL_3: 'bg-amber-100 text-amber-700', LEVEL_4: 'bg-green-100 text-green-700', LEVEL_5: 'bg-sky-100 text-sky-700',
};
const KTAS_LABEL: Record<string, string> = { LEVEL_1: 'KTAS 1', LEVEL_2: 'KTAS 2', LEVEL_3: 'KTAS 3', LEVEL_4: 'KTAS 4', LEVEL_5: 'KTAS 5' };

/** 컬럼당 렌더 상한 — 종전엔 상한이 없어 530장이 전부 DOM 에 올라갔다. */
const COL_LIMIT = 12;

/** 임계 초과 우선 → 체류 내림차순. 관제에서 맨 위는 가장 위험한 사람이어야 한다. */
function byUrgency(a: Card, b: Card): number {
  if (a.flags.length !== b.flags.length) return b.flags.length - a.flags.length;
  const av = a.track === 'OPD' ? (a.stayMin ?? 0) : (a.stayDays ?? 0) * 1440;
  const bv = b.track === 'OPD' ? (b.stayMin ?? 0) : (b.stayDays ?? 0) * 1440;
  return bv - av;
}

export default function JourneyConsolePage() {
  const tAttr = useTAttr();
  const [track, setTrack] = useState<'ALL' | 'OPD' | 'IPD' | 'ER'>('ALL');
  const [selected, setSelected] = useState<Card | null>(null);
  const [actionOnly, setActionOnly] = useState(false);
  const [filters, setFilters] = useState({ dept: '', ward: '', insuranceType: '', minStayMin: '', minUnpaid: '' });
  const pollFast = usePollInterval('fast');
  const pollNormal = usePollInterval('normal');
  // FR-10 실시간 힌트 — 여정 이벤트가 저장되면 보드·KPI 를 다시 읽는다(폴링은 백업으로 유지)
  const qc = useQueryClient();
  const liveStatus = useJourneyConsoleStream(() => {
    qc.invalidateQueries({ queryKey: ['jc-board'] });
    qc.invalidateQueries({ queryKey: ['jc-kpi'] });
  });

  const query = useMemo(() => {
    const p = new URLSearchParams({ track });
    if (filters.dept) p.set('dept', filters.dept);
    if (filters.ward) p.set('ward', filters.ward);
    if (filters.insuranceType) p.set('insuranceType', filters.insuranceType);
    if (filters.minStayMin) p.set('minStayMin', filters.minStayMin);
    if (filters.minUnpaid) p.set('minUnpaid', filters.minUnpaid);
    return p.toString();
  }, [track, filters]);

  const { data: kpiData } = useQuery({
    queryKey: ['jc-kpi'],
    queryFn: () => apiClient.get<R>('/api/v1/journey-console/kpi'),
    refetchInterval: pollNormal, // 종전 20초 하드코딩 — ui 설정(폴링 정책) 경유로 통일
  });
  const { data: boardData, isLoading } = useQuery({
    queryKey: ['jc-board', query],
    queryFn: () => apiClient.get<R>(`/api/v1/journey-console/board?${query}`),
    refetchInterval: pollFast,
  });

  const kpi = ((kpiData?.data as R)?.data ?? kpiData?.data) as Kpi | undefined;
  const board = ((boardData?.data as R)?.data ?? boardData?.data) as Board | undefined;

  const opd = useMemo(() => (board?.opd ?? []).filter((c) => !actionOnly || c.flags.length > 0), [board, actionOnly]);
  const ipd = useMemo(() => (board?.ipd ?? []).filter((c) => !actionOnly || c.flags.length > 0), [board, actionOnly]);
  const er = useMemo(() => (board?.er ?? []).filter((c) => !actionOnly || c.flags.length > 0), [board, actionOnly]);

  const isAdmin = useAuthStore((s) => s.user?.role) === 'ADMIN';
  const alertTotal = kpi?.alerts ? Object.values(kpi.alerts).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className="max-w-[1600px] mx-auto pb-6">
      {/* ① 상황 스트립 — sticky. 스크롤해도 임계가 시야에서 사라지지 않는다 */}
      <div className="sticky top-0 z-20 -mx-4 px-4 pt-3 pb-2 bg-gray-50/95 backdrop-blur border-b border-gray-100">
        <div className="flex items-baseline justify-between mb-2">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-gray-900"><T k="환자여정 관제" /></h1>
            {/* 🔴 이 화면의 성격을 밝힌다 — 조치는 현장 화면에서 이뤄진다(2026-08-26 결정) */}
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-200 text-gray-600"><T k="관리 화면" /></span>
            <span className="hidden lg:inline text-[11px] text-gray-400">
              <T k="현장 조치는" />{' '}
              <Link href="/reception" className="text-blue-600 hover:underline"><T k="접수" /></Link>
              {' · '}
              <Link href="/clinic-queue" className="text-blue-600 hover:underline"><T k="진료실 대기" /></Link>
              {' '}<T k="화면에서 합니다" />
            </span>
          </div>
          <div className="text-xs text-gray-400">
            {board?.asOf ? kdate(new Date(board.asOf), 'timeSec') : ''} <T k="· 자동갱신" /> {Math.round(pollFast / 1000)}<T k="초" /> · <LiveStreamBadge status={liveStatus} />
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <Stat label="외래 활성" value={<>{kpi?.activeOpd ?? '-'}<Unit><T k="명" /></Unit></>} />
          <Stat label="입원 재원" value={<>{kpi?.activeIpd ?? '-'}<Unit><T k="명" /></Unit></>} />
          <Stat
            label="평균 대기"
            value={<SampleValue s={kpi?.avgWait} render={(v) => <Duration minutes={v} />} />}
            sub={kpi?.avgWait?.n ? `대기 ${kpi.avgWait.n}명 기준` : undefined}
          />
          <Stat label="미수납" value={<Money value={kpi?.unpaidTotal} />} sub={kpi ? `${kpi.unpaidCount}건` : ''} accent="amber" />
          {/* 🔴 비율에는 분모를 — 분모가 무엇인지 모르면 9% 와 16% 를 구별할 수 없다 */}
          <Stat
            label="병상 가동"
            value={kpi?.bedOccupancy != null ? <>{Math.round(kpi.bedOccupancy * 100)}<Unit>%</Unit></> : '-'}
            sub={kpi?.bedTotal ? `${kpi.bedOccupied}/${kpi.bedTotal} · ${kpi.bedDenominatorNote ?? ''}` : undefined}
          />
          <Stat
            label="오늘 수납"
            value={<SampleValue s={kpi ? { value: kpi.revenueToday.n === 0 ? null : kpi.revenueToday.confirmed, n: kpi.revenueToday.n ?? 0 } : undefined} render={(v) => <Money value={v} />} />}
            accent="blue"
          />
        </div>

        {/* 임계 스트립 — 접수지연이 여기 처음 등장한다(종전엔 감지 자체가 없었다) */}
        {kpi?.alerts && alertTotal > 0 && (
          <div className="flex items-center gap-2 flex-wrap mt-2 bg-rose-50/70 border border-rose-100 rounded-xl px-3 py-1.5">
            <span className="text-xs font-semibold text-rose-600 shrink-0"><T k="⚠ 조치 필요" /> {alertTotal}</span>
            {ALERT_ORDER.filter((k) => (kpi.alerts?.[k] ?? 0) > 0).map((k) => (
              <span key={k} className="text-xs px-2 py-0.5 rounded bg-white text-rose-700 border border-rose-200">
                <T k={FLAG_LABEL[k] ?? k} /> {kpi.alerts![k]}
              </span>
            ))}
            {kpi.thresholds && (
              <span className="text-[11px] text-rose-400 ml-auto">
                <T k="기준 대기" /> <Duration minutes={kpi.thresholds.opdWaitMin} />
                {/* 🔴 코드 기본값을 원내 정책인 척하지 않는다 */}
                {kpi.thresholdSources?.opdWaitMin === 'FALLBACK' && (
                  <span className="ml-1 text-amber-700" title={tAttr('qi.targets.opdWaitMinutes 가 설정되지 않아 코드 기본값을 씁니다')}>
                    <T k="(원내 미설정 · 기본값)" />
                  </span>
                )}
                {' · '}<T k="수납" /> <Duration minutes={kpi.thresholds.cashierDelayMin} />
              </span>
            )}
          </div>
        )}

        {/* 🔴 같은 "너무 오래 기다렸다"에 기준이 둘이다 — 관리자가 보는 수와 현장이 보는 색이 다르다.
            여기서 임의로 통일하지 않는다(원내 정책) — 다르다는 사실을 말한다. */}
        {kpi?.fieldWaitThresholds?.warnMinutes != null &&
          kpi?.thresholds &&
          kpi.fieldWaitThresholds.warnMinutes !== kpi.thresholds.opdWaitMin && (
            <p className="mt-1.5 text-[11px] text-gray-500">
              <T k="현장 화면(" /><Link href="/reception" className="text-blue-600 hover:underline"><T k="접수" /></Link><T k=")은 다른 기준을 씁니다 — 경고" /> <Duration minutes={kpi.fieldWaitThresholds.warnMinutes} />
              {kpi.fieldWaitThresholds.dangerMinutes != null && <> <T k="· 위험" /> <Duration minutes={kpi.fieldWaitThresholds.dangerMinutes} /></>}
              {' '}(<code className="bg-gray-100 px-1 rounded">{kpi.fieldWaitThresholds.source}</code><T k="). 같은 환자가 화면에 따라 지연으로 보이거나 보이지 않을 수 있습니다." />
            </p>
          )}
      </div>

      {/* ② 필터 바 — 서버가 이미 받던 파라미터를 화면에 연다 */}
      <div className="flex items-center gap-2 flex-wrap py-3">
        <div className="flex gap-1">
          {(['ALL', 'OPD', 'IPD', 'ER'] as const).map((t) => (
            <button key={t} onClick={() => setTrack(t)}
              className={`px-3.5 py-1.5 text-sm rounded-lg ${track === t ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              <T k={t === 'ALL' ? '전체' : t === 'OPD' ? '외래' : t === 'IPD' ? '입원' : '응급'} />
            </button>
          ))}
        </div>
        <FilterInput placeholder={tAttr('진료과')} value={filters.dept} onChange={(v) => setFilters((f) => ({ ...f, dept: v }))} />
        <FilterInput placeholder={tAttr('병동')} value={filters.ward} onChange={(v) => setFilters((f) => ({ ...f, ward: v }))} />
        <FilterInput placeholder={tAttr('체류≥분')} value={filters.minStayMin} onChange={(v) => setFilters((f) => ({ ...f, minStayMin: v }))} width="w-24" numeric />
        <FilterInput placeholder={tAttr('미수납≥원')} value={filters.minUnpaid} onChange={(v) => setFilters((f) => ({ ...f, minUnpaid: v }))} width="w-28" numeric />
        <button
          onClick={() => setActionOnly((v) => !v)}
          aria-pressed={actionOnly}
          className={`px-3 py-1.5 text-sm rounded-lg border ${actionOnly ? 'bg-rose-600 text-white border-rose-600' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
          <T k="⚠ 조치 필요만" />
        </button>
        <span className="text-[11px] text-gray-400 ml-auto"><T k="정렬: 임계 → 체류 긴 순" /></span>
        {/* 🔴 확인 기록을 못 읽었으면 "확인 없음"으로 그리지 않고 그 사실을 말한다 */}
        {board?.ackUnavailable && (
          <span className="w-full text-[11px] text-amber-700">
            <T k="확인·조치 기록을 불러오지 못했습니다 — 이미 확인된 건이 미확인으로 보일 수 있습니다." />
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-4 gap-3">{[1, 2, 3, 4].map((i) => <div key={i} className="h-56 bg-gray-100 rounded-2xl animate-pulse" />)}</div>
      ) : (
        <div className="space-y-5">
          {(track === 'ALL' || track === 'OPD') && (
            <Lane title={tAttr('외래')} stages={OPD_STAGES} done={OPD_DONE} cards={opd} onSelect={setSelected} selectedId={selected?.patientId} />
          )}
          {(track === 'ALL' || track === 'IPD') && (
            <Lane title={tAttr('입원')} stages={IPD_STAGES} done={IPD_DONE} cards={ipd} onSelect={setSelected} selectedId={selected?.patientId} />
          )}
          {(track === 'ALL' || track === 'ER') && (
            <Lane title={tAttr('응급')} stages={ER_STAGES} done={ER_DONE} cards={er} onSelect={setSelected} selectedId={selected?.patientId}
              note={tAttr('병상 배정은 응급실 베드 보드 소관 — 여기서는 흐름·지연만 본다')} link={{ href: '/admin/er-beds', label: '베드 보드 →' }} />
          )}
        </div>
      )}

      {/* ⑤ 병목 요약 — 접힘 기본. 펼칠 때만 호출한다(접힌 패널이 API 를 부르던 함정 회피) */}
      <BottleneckSummary track={track} />

      {/* ⑥ 여정 기록 상태(P2-5) — 운영자 전용·접힘 기본. EXECUTIVE 는 이 EP 권한이 없어 그리지 않는다 */}
      {isAdmin && <RecordingHealth />}
      {isAdmin && <ExportReadiness />}

      {/* ④ 드릴다운 — 선택 시에만 슬라이드-인. 빈 박스가 상시 폭을 점유하지 않는다 */}
      {selected && <Drilldown card={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

/* ── 상단 지표 ────────────────────────────────────────────────────────── */

function Stat({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: string; accent?: 'amber' | 'blue' }) {
  const color = accent === 'amber' ? 'text-amber-700' : accent === 'blue' ? 'text-blue-700' : 'text-gray-900';
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-3 py-2">
      <div className="text-[11px] text-gray-400"><T k={label} /></div>
      <div className={`text-lg font-bold ${color} font-mono leading-tight`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-400">{sub}</div>}
    </div>
  );
}

/**
 * 🔴 표본이 없으면 값을 지어내지 않는다. `0` 은 "없다"로 읽히지만 실제로는 "모른다"였다.
 */
function SampleValue({ s, render }: { s?: Sample; render: (v: number) => React.ReactNode }) {
  const tAttr = useTAttr();
  if (!s) return <span className="text-gray-300">-</span>;
  if (s.n === 0 || s.value == null) {
    return <span className="text-sm font-normal text-gray-400" title={tAttr('표본이 없어 산출할 수 없습니다(0 이 아닙니다)')}><T k="산출 불가" /><span className="text-[11px] ml-1">n=0</span></span>;
  }
  return <>{render(s.value)}</>;
}

function FilterInput({ placeholder, value, onChange, width = 'w-28', numeric }: {
  placeholder: string; value: string; onChange: (v: string) => void; width?: string; numeric?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(numeric ? e.target.value.replace(/[^\d]/g, '') : e.target.value)}
      placeholder={placeholder}
      aria-label={placeholder}
      inputMode={numeric ? 'numeric' : undefined}
      className={`${width} px-2.5 py-1.5 text-sm rounded-lg border border-gray-200 bg-white placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-300`}
    />
  );
}

/* ── 흐름 레인 ────────────────────────────────────────────────────────── */

function Lane({ title, stages, done, cards, onSelect, selectedId, note, link }: {
  title: string; stages: { key: string; label: string }[]; done: { key: string; label: string };
  cards: Card[]; onSelect: (c: Card) => void; selectedId?: string;
  note?: string; link?: { href: string; label: string };
}) {
  const [expandedDone, setExpandedDone] = useState(false);
  const doneCards = cards.filter((c) => c.stage === done.key);
  const active = stages.map((s) => ({ ...s, list: cards.filter((c) => c.stage === s.key).sort(byUrgency) }));
  const urgent = cards.filter((c) => c.flags.length > 0).length;

  return (
    <section>
      <div className="flex items-baseline gap-2 mb-2">
        <h2 className="text-sm font-semibold text-gray-700">{title}</h2>
        <span className="text-xs text-gray-400">{cards.length}<T k="명" /></span>
        {urgent > 0 && <span className="text-xs text-rose-600"><T k="· 조치" /> {urgent}</span>}
        {note && <span className="text-[11px] text-gray-300 hidden lg:inline">· {note}</span>}
        {link && <Link href={link.href} className="text-[11px] text-blue-600 hover:underline ml-auto"><T k={link.label} /></Link>}
      </div>

      <div className="flex gap-3 items-start">
        {active.map((s) => (
          <Column key={s.key} label={s.label} list={s.list} onSelect={onSelect} selectedId={selectedId} />
        ))}

        {/* 종결 단계 — 카드 미렌더. 관제 대상이 아니므로 숫자로 접는다 */}
        <div className={`shrink-0 ${expandedDone ? 'flex-1 min-w-0 max-w-[340px]' : 'w-36'}`}>
          <button
            onClick={() => setExpandedDone((v) => !v)}
            aria-expanded={expandedDone}
            className="w-full bg-gray-100/70 hover:bg-gray-100 rounded-2xl px-3 py-2.5 text-left transition">
            <div className="text-xs font-medium text-gray-500 flex justify-between">
              <span><T k={done.label} /></span><span>{doneCards.length}</span>
            </div>
            <div className="text-[11px] text-gray-400 mt-0.5"><T k={expandedDone ? '접기' : '펼치기'} /></div>
          </button>
          {expandedDone && (
            <div className="space-y-2 mt-2 max-h-[520px] overflow-auto pr-1">
              {doneCards.slice(0, 50).map((c) => (
                <PatientCard key={c.patientId + (c.encounterId ?? '')} card={c} onClick={() => onSelect(c)} active={selectedId === c.patientId} />
              ))}
              {doneCards.length > 50 && <div className="text-[11px] text-gray-400 text-center py-1"><T k="외" /> {doneCards.length - 50}<T k="명" /></div>}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Column({ label, list, onSelect, selectedId }: { label: string; list: Card[]; onSelect: (c: Card) => void; selectedId?: string }) {
  const [showAll, setShowAll] = useState(false);
  const urgent = list.filter((c) => c.flags.length > 0).length;
  const shown = showAll ? list : list.slice(0, COL_LIMIT);

  // 빈 컬럼은 폭을 접는다 — '진료중 0' 이 화면 폭을 점유할 이유가 없다
  if (list.length === 0) {
    return (
      <div className="w-24 shrink-0 bg-gray-50 rounded-2xl px-2 py-2.5 text-center">
        <div className="text-xs text-gray-400"><T k={label} /></div>
        <div className="text-lg font-semibold text-gray-300">0</div>
      </div>
    );
  }

  return (
    // max-w — 채워진 컬럼이 하나뿐일 때 그 컬럼이 폭을 다 먹어 카드가 가로로 늘어지던 것 방지
    // (입원 레인처럼 단계 하나에만 환자가 몰릴 때 발생). 컬럼이 많으면 flex-1 이 알아서 줄인다.
    <div className="flex-1 min-w-0 max-w-[340px] bg-gray-50 rounded-2xl p-2">
      <div className="text-xs font-medium text-gray-500 px-1 pb-2 flex justify-between items-center">
        <span><T k={label} />{urgent > 0 && <span className="text-rose-500 ml-1">⚠{urgent}</span>}</span>
        <span>{list.length}</span>
      </div>
      <div className="space-y-2">
        {shown.map((c) => (
          <PatientCard key={c.patientId + (c.encounterId ?? '')} card={c} onClick={() => onSelect(c)} active={selectedId === c.patientId} />
        ))}
      </div>
      {list.length > COL_LIMIT && (
        <button onClick={() => setShowAll((v) => !v)} className="w-full mt-2 py-1.5 text-xs text-gray-500 hover:text-gray-700 hover:bg-white rounded-lg transition">
          {showAll ? '접기' : `+${list.length - COL_LIMIT}명 더보기`}
        </button>
      )}
    </div>
  );
}

function PatientCard({ card, onClick, active }: { card: Card; onClick: () => void; active: boolean }) {
  const tAttr = useTAttr();
  const danger = card.flags.length > 0;
  return (
    <button onClick={onClick}
      className={`w-full text-left bg-white rounded-xl border p-2.5 shadow-sm hover:shadow transition ${active ? 'border-blue-400 ring-1 ring-blue-200' : danger ? 'border-rose-200' : 'border-gray-100'}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-gray-900 truncate">
          {danger && <span className="text-rose-500 mr-0.5" aria-hidden="true">⚠</span>}{card.name}
        </span>
        <span className="text-[11px] text-gray-400 shrink-0">{card.mrn}</span>
      </div>
      {card.track === 'ER' ? (
        <div className="flex items-center gap-1.5 mt-1">
          {card.ktas && <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${KTAS_TONE[card.ktas] ?? 'bg-gray-100 text-gray-600'}`}><T k={KTAS_LABEL[card.ktas] ?? card.ktas} /></span>}
          <span className="text-xs text-gray-500 truncate">{card.chiefComplaint ?? ''}</span>
        </div>
      ) : (
        <div className="text-xs text-gray-500 mt-0.5 truncate">
          {card.track === 'OPD' ? `${card.dept ?? ''} · ${card.doctorName ?? ''}` : `${card.ward ?? ''} ${card.bed ?? ''} · ${card.doctorName ?? ''}`}
        </div>
      )}
      <div className="flex items-center justify-between mt-1.5">
        <span className={`text-[11px] font-mono ${danger ? 'text-rose-600 font-semibold' : 'text-gray-400'}`}>
          {card.track === 'IPD' ? <>{card.stayDays ?? 0}<Unit><T k="일" /></Unit></> : <Duration minutes={card.stayMin} />}
          {card.track === 'ER' && card.totalMin != null && <span className="text-gray-300 ml-1" title={tAttr('도착 이후 총 체류')}><T k="(총" /> <Duration minutes={card.totalMin} dense />)</span>}
        </span>
        {card.unpaid > 0 && <span className="text-[11px] font-medium text-amber-700"><Money value={card.unpaid} /></span>}
      </div>
      {danger && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {card.flags.map((f) => <span key={f} className="text-[10px] px-1.5 py-0.5 rounded bg-rose-50 text-rose-600 whitespace-nowrap"><T k={FLAG_LABEL[f] ?? f} /></span>)}
        </div>
      )}
      {/* 🔴 확인해도 위 지연 배지는 그대로다 — 확인은 "누가 무엇을 했는지"를 덧붙일 뿐 숨기지 않는다 */}
      {card.ack && (
        <div className="mt-1.5 rounded-lg bg-sky-50 px-1.5 py-1 text-[10px] leading-tight text-sky-800">
          <span className="font-semibold"><T k="확인됨" /></span>
          {card.ack.ackedByName ? ` · ${card.ack.ackedByName}` : ''}
          <span className="text-sky-500"> · <KDate value={card.ack.ackedAt} mode="time" /></span>
          <div className="truncate text-sky-700">{card.ack.note}</div>
        </div>
      )}
    </button>
  );
}

/* ── 병목 요약 (분석 화면과 접합) ─────────────────────────────────────── */

/**
 * 🔴 분석 상세를 여기 다시 만들지 않는다. `/flow-analytics` 가 이미 정본이다.
 *    관제에는 **상위 3개만** 놓고 나머지는 딥링크로 넘긴다.
 */
function BottleneckSummary({ track }: { track: string }) {
  const tAttr = useTAttr();
  const [open, setOpen] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['jc-bottleneck'],
    queryFn: () => apiClient.get<R>('/api/v1/journey-console/analytics'),
    enabled: open, // 접힌 상태에서는 호출하지 않는다
    staleTime: 5 * 60_000,
  });
  const res = ((data?.data as R)?.data ?? data?.data) as { bottlenecks?: Bottleneck[] } | undefined;
  const top = (res?.bottlenecks ?? []).slice(0, 3);

  return (
    <section className="mt-5 bg-white rounded-2xl border border-gray-100 shadow-sm">
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="w-full flex items-center justify-between px-4 py-2.5 text-left">
        <span className="text-sm font-semibold text-gray-700"><T k="병목 요약" /> <span className="font-normal text-gray-400"><T k="최근 7일" /></span></span>
        <span className="text-xs text-gray-400"><T k={open ? '접기 ▲' : '펼치기 ▼'} /></span>
      </button>
      {open && (
        <div className="px-4 pb-3 border-t border-gray-50 pt-3">
          {isLoading ? <div className="h-6 bg-gray-100 rounded animate-pulse" />
            : top.length === 0 ? <EmptyState compact icon="📊" title="기간 내 분석 가능한 단계가 없습니다" />
            : (
              <div className="flex items-center gap-3 flex-wrap">
                {top.map((b, i) => (
                  <span key={`${b.track}-${b.stage}`} className="text-sm text-gray-700">
                    <span className="text-gray-400 font-mono text-xs mr-1">{i + 1}</span>
                    <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 mr-1">{b.track}</span>
                    {b.stage}
                    {/* 🔴 위반율은 분모와 함께(§3.3) — 서버가 위반 건수(분자)를 낸다(2026-08-20) */}
                    <span className="ml-1.5 font-semibold"><T k="위반" /> <Ratio className={b.breachRate != null && b.breachRate >= 50 ? 'text-rose-600' : b.breachRate != null && b.breachRate >= 20 ? 'text-amber-600' : 'text-gray-500'} numerator={b.breachCount} denominator={b.count} unavailableHint="목표 미설정" /></span>
                  </span>
                ))}
              </div>
            )}
          <Link href={`/flow-analytics${track !== 'ALL' ? `?track=${track}` : ''}`} className="inline-block mt-2 text-xs text-blue-600 hover:underline">
            <T k="이탈·지연 분석 전체 →" />
          </Link>
        </div>
      )}
    </section>
  );
}

/**
 * 대기열 호출/재호출 — **정본 EP** `PATCH /waiting-queue/:id/call`.
 * 관제에서 병목을 보고도 나가서 조치해야 하던 것을 한 흐름으로 잇는다.
 */
function CallAction({ queueId, stage }: { queueId: string; stage: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [msg, setMsg] = useState('');

  const notify = usePatientNotifyConfirm('호출');
  const call = async () => {
    setState('busy');
    try {
      // 🔴 관제에서의 호출도 환자 알림은 명시 승인이 필요하다
      const yes = await notify.ask();
      if (yes === null) { setState('idle'); return; }
      const r = await apiClient.patch<{ data: { patientPush?: { sent?: boolean; reason?: string; pushChannel?: string | null } } }>(
        // 🔴 정본은 `/api/v1/queue/:id/call` 이다 — `waiting-queue` prefix 는 서버에 없다(운영 404)
        `/api/v1/queue/${queueId}/call`, { notifyPatient: yes },
      );
      const msg = patientPushMessage(r?.data?.patientPush);
      if (msg) setMsg(msg);
      setState('done');
    } catch (e) {
      setState('error');
      setMsg(e instanceof Error ? e.message : '호출에 실패했습니다');
    }
  };

  return (
    <>
      {/* 🔴 승인 다이얼로그 — 렌더하지 않으면 물어보지 못하고, 물어보지 못하면 알림은 영원히 안 나간다 */}
      {notify.dialog}
    <div>
      <button onClick={call} disabled={state === 'busy' || state === 'done'}
        className={`w-full text-sm py-2 rounded-lg border transition ${state === 'done'
          ? 'border-green-200 bg-green-50 text-green-700'
          : 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 disabled:opacity-60'}`}>
        <T k={state === 'busy' ? '호출 중…' : state === 'done' ? '✓ 호출됨' : stage === 'CALLED' ? '재호출' : '진료실 호출'} />
      </button>
      {state === 'error' && <p className="text-[11px] text-rose-600 mt-1">{msg}</p>}
    </div>
    </>
  );
}

/* ── 드릴다운 ─────────────────────────────────────────────────────────── */

const DRILL_TL_LIMIT = 60;

function Drilldown({ card, onClose }: { card: Card; onClose: () => void }) {
  const tAttr = useTAttr();
  const isExecutive = useAuthStore((s) => s.user?.role) === 'EXECUTIVE';
  // 환자 드릴다운 열람 감사(fire-and-forget)
  useEffect(() => {
    if (card.patientId) apiClient.get(`/api/v1/journey-console/view/${card.patientId}`).catch(() => undefined);
  }, [card.patientId]);

  // Esc 로 닫기 — 오버레이의 기본 기대
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // 최근 20건만 — 전체 여정은 환자 차트(잘림은 화면이 말한다)
  const { data: tl, isLoading: tlLoading, isError: tlIsError, error: tlError, refetch: refetchTl } = useQuery({
    queryKey: ['jc-timeline', card.patientId],
    queryFn: () => apiClient.get<R>(`/api/v1/journey/${card.patientId}/timeline`, { limit: DRILL_TL_LIMIT }),
    /**
     * 🔴 개별 환자 타임라인 `/journey/:id/timeline` 은 임상 EP(@Roles DOCTOR·NURSE·ADMIN)라
     *    EXECUTIVE 는 상시 403 이다 — 바로 아래 중간 진료비와 **같은 판단**(읽기 전용 관찰자에겐
     *    화면이 부르지 않는 것이 답·EP 를 넓히지 않는다). 종전엔 이 쿼리만 게이트가 빠져
     *    경영진이 카드를 열 때마다 타임라인 자리에 빨간 오류가 떴다.
     */
    enabled: !isExecutive,
  });
  const { data: inv, isError: invIsError, error: invError, refetch: refetchInv } = useQuery({
    queryKey: ['jc-inv', card.encounterId, card.mrn],
    queryFn: () => apiClient.get<R>(`/api/v1/billing/erp-invoice?encounterId=${card.encounterId}&chartNo=${encodeURIComponent(card.mrn)}&interim=true`),
    /**
     * 🔴 경영진(EXECUTIVE)은 이 관제에서 **읽기 전용 관찰자**라 조작 버튼을 이미 숨긴다.
     *    중간 진료비는 개별 환자의 청구 상세이고 서버도 원무·임상 역할에만 연다 —
     *    여기서 부르면 상시 403 이 되므로 **화면이 부르지 않는 것이 답이다**(EP 를 넓히지 않는다).
     */
    enabled: !!card.encounterId && !isExecutive,
  });

  const events = ((((tl?.data as R)?.data ?? (tl?.data as unknown)) as Array<R> | undefined) ?? []).slice().reverse(); // 최신순
  const tlTruncated = !!(tl as { meta?: { truncated?: boolean } } | undefined)?.meta?.truncated;
  const invRes = ((inv?.data as R)?.data ?? inv?.data) as { available?: boolean; invoice?: R } | undefined;
  const invoice = invRes?.available ? (invRes.invoice as R) : null;
  const blocked = (invoice?.preReview as { blocked?: boolean })?.blocked;

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-30" onClick={onClose} aria-hidden="true" />
      {/* 🔴 (2026-10-01 사람 요청) 400px 패널에 타임라인을 380px 상자로 가둬 아래 절반이 비었다 —
          넓은 화면은 2단(왼쪽 타임라인이 남는 높이를 다 쓴다 · 오른쪽 진료비·조치), 좁은 화면은 한 단 스크롤 */}
      <aside role="dialog" aria-label={`${card.name} 여정 상세`}
        className="fixed inset-y-0 right-0 z-40 flex w-full max-w-full flex-col bg-white shadow-2xl lg:w-[920px]">
        <div className="shrink-0 space-y-2 border-b border-gray-100 px-5 pb-3 pt-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-base font-bold text-gray-900">{card.name} <span className="text-xs text-gray-400">{card.mrn}</span></div>
            <div className="text-xs text-gray-500">{card.track === 'OPD' ? `${card.dept ?? ''} · ${card.doctorName ?? ''}` : `${card.ward ?? ''} ${card.bed ?? ''}`}</div>
            <div className="text-xs text-gray-400 mt-0.5">
              <T k="체류" /> {card.track === 'OPD' ? <Duration minutes={card.stayMin} /> : <>{card.stayDays ?? 0}<T k="일" /></>}
            </div>
          </div>
          <button onClick={onClose} aria-label={tAttr('닫기')} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
        </div>
        {card.flags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {card.flags.map((f) => <span key={f} className="text-[11px] px-2 py-0.5 rounded bg-rose-50 text-rose-700 border border-rose-100"><T k={FLAG_LABEL[f] ?? f} /></span>)}
          </div>
        )}
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
          <div className="flex min-h-0 flex-1 flex-col px-5 py-4 lg:overflow-hidden">
        <section className="flex min-h-[50vh] flex-1 flex-col lg:min-h-0" aria-label={tAttr('여정 타임라인')}>
          <div className="mb-2 flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-gray-800"><T k="여정 타임라인" /></h3>
            {!isExecutive && <Link href={`/patients/${card.patientId}?tab=journey`} className="text-[11px] text-blue-600 hover:underline"><T k="전체 여정 보기" /></Link>}
          </div>
          {isExecutive ? (
            <p className="text-xs text-gray-400"><T k="경영 열람 역할에서는 개별 환자 타임라인을 표시하지 않습니다(집계는 KPI·보드에서)." /></p>
          ) : tlLoading ? (
            <div className="space-y-1.5" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className="h-9 animate-pulse rounded bg-gray-100" />)}</div>
          ) : tlIsError ? (
            <QueryErrorFallback error={tlError} onRetry={() => refetchTl()} size="compact" />
          ) : events.length === 0 ? (
            <EmptyState compact icon="🧭" title="여정 이벤트 없음" />
          ) : (
            <>
              <JourneyTimelineCompact events={events as unknown as CompactJourneyEvent[]} />
              {tlTruncated && (
                <p className="mt-2 shrink-0 text-[11px] text-amber-700"><Tf k="최근 {수}건만 표시 — 전체 여정은 환자 차트에서" params={{ 수: events.length }} /></p>
              )}
            </>
          )}
        </section>
          </div>
          <div className="space-y-4 border-t border-gray-100 px-5 py-4 lg:w-[340px] lg:shrink-0 lg:overflow-y-auto lg:border-l lg:border-t-0">
        {card.encounterId && !isExecutive && (
          <div className={`rounded-xl border p-3 ${blocked ? 'border-rose-200 bg-rose-50/40' : 'border-blue-100 bg-blue-50/30'}`}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold text-gray-700"><T k="중간 진료비 (ERP)" /></span>
              {blocked && <span className="text-[11px] text-rose-600"><T k="⚠ 사전심사" /></span>}
            </div>
            {invIsError ? (
              <QueryErrorFallback error={invError} onRetry={() => refetchInv()} size="compact" />
            ) : invoice ? (
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div><span className="text-xs text-gray-400"><T k="총액" /> </span><Money value={Number(invoice.total)} className="font-mono" /></div>
                <div><span className="text-xs text-gray-400"><T k="본인" /> </span><Money value={Number(invoice.patientShare)} className="font-mono text-amber-700" /></div>
                <div><span className="text-xs text-gray-400"><T k="기수납" /> </span><Money value={Number(invoice.prepaid)} className="font-mono text-gray-500" /></div>
                <div><span className="text-xs text-gray-400"><T k="미수납" /> </span><Money value={Number(invoice.balanceDue)} className="font-mono font-semibold text-blue-700" /></div>
              </div>
            ) : (
              <div className="text-xs text-gray-400"><T k="ERP 진료비 미연동 · HIS 미수납" /> <Money value={card.unpaid} /></div>
            )}
          </div>
        )}

        {/* 개입 — 정본 EP 경유(관제 전용 쓰기 경로 없음). EXECUTIVE 는 경영 열람 역할이라 쓰기를 숨긴다
            (숨김은 편의일 뿐 경계는 서버 @Roles 다 — 직접 호출해도 403). */}
        {!isExecutive && card.queueId && (card.stage === 'RECEPTION' || card.stage === 'CALLED') && (
          <CallAction queueId={card.queueId} stage={card.stage} />
        )}

        {/* 🔴 지연을 보고 무엇을 했는지 남는 자리 — 교대해도 이어진다 */}
        {!isExecutive && (
          <DelayAck patientId={card.patientId} track={card.track} stage={card.stage} flags={card.flags} ack={card.ack} />
        )}

        <div className="flex gap-2 pt-1">
          <Link href={`/patients/${card.patientId}`} className="flex-1 text-center text-sm py-2 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50"><T k="환자 차트" /></Link>
          {card.encounterId && !isExecutive && (
            <Link href={`/billing?encounterId=${card.encounterId}`} className="flex-1 text-center text-sm py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700"><T k="수납 상세" /></Link>
          )}
        </div>
          </div>
        </div>
      </aside>
    </>
  );
}
