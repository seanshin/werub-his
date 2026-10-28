'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AI_ORIGIN_TEXT,
  RATIO_UNAVAILABLE,
  SENTINEL_AUDIENCES,
  SENTINEL_AUDIENCE_LABEL,
  SENTINEL_AUDIENCE_DESC,
  SENTINEL_AUDIENCE_UNASSIGNED_LABEL,
  SENTINEL_JUDGMENT_VERDICTS,
  SENTINEL_JUDGMENT_LABEL,
  SENTINEL_JUDGMENT_EFFECT,
  SENTINEL_JUDGMENT_SOURCE_LABEL,
  type SentinelAudience,
  type SentinelJudgmentVerdict,
  type SentinelJudgmentSource,
} from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { pollMs } from '@/lib/ui-settings';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { KDate, EmptyState, Unknown, Unit } from '@/components/ui/display';
import { T, Tf, useTAttr, useTfAttr, Data } from '@/components/ui/i18n-text';

/**
 * 상시 감시 관제 — 기획 `his-sentinel-monitoring.plan.md` P0·P5.
 *
 * 🔴 이 화면의 존재 이유는 **미판정과 0을 다르게 그리는 것**이다.
 *    "위반 0건"과 "아직 안 재봤다"를 같은 초록으로 그리면, 이 화면 자체가
 *    이 감시자가 잡으려는 결함(근거 없이 안심시킴)이 된다.
 *
 * 구성(위에서 아래로 — "지금 볼 것"이 먼저다):
 *  ① 요약 스트립: 미판정 적색·재판정 필요·실시간 급변·스윕 생존 — 각 섹션으로 점프
 *  ② 축 카드(선택) ③ 발견 목록+판정 ④ 실시간 펄스 ⑤ 운영 지표·로그
 */

type Severity = 'RED' | 'AMBER' | 'INFO';

interface AxisView {
  key: string; label: string; implemented: boolean;
  open: number | null;
  bySeverity: { RED: number; AMBER: number; INFO: number } | null;
  resolved: number | null;
  unobservable: number | null;
  coverageNote?: string | null;
  lastRun: { at: string; ok: boolean; attempted: number; succeeded: number; failed: number; error: string | null; durationMs: number | null } | null;
  stale: boolean;
  unavailableReason: string | null;
}
interface Overview { axes: AxisView[]; generatedAt: string; intervalMin: number }

type Verdict =
  // z 는 중앙값·MAD 규칙에서만 나온다 — p95×2 로 판정한 지표에서는 null(안 잰 것이지 0 이 아니다)
  | { kind: 'NORMAL'; z: number | null; median: number; detail: string }
  | { kind: 'ANOMALY'; z: number | null; median: number; detail: string }
  | { kind: 'WARMING'; have: number; need: number; detail: string }
  | { kind: 'FLAT'; median: number; detail: string }
  // 🔴 분모가 모자라 값 자체를 낼 수 없음 — 0 도 정상도 아니다
  | { kind: 'NOT_COMPUTABLE'; have: number; need: number; detail: string };
interface PulseMetric {
  key: string; label: string; unit: string | null; severity: Severity; drillDown: string | null; why: string;
  current: number | null; lastAt: string | null; stale: boolean;
  series: { at: string; v: number }[];
  verdict: Verdict | null;
}
interface Pulse { metrics: PulseMetric[]; tickIntervalSec: number; generatedAt: string }
interface JudgmentView {
  verdict: SentinelJudgmentVerdict;
  valueAtJudgment: number;
  basis: string;
  source: SentinelJudgmentSource;
  judgedAt: string;
  judgedByName: string | null;
  /** 🔴 판정 이후 값이 늘었다 — 이 판정은 새 행을 설명하지 못한다(판정됨으로 그리지 않는다) */
  staleIncreased: boolean;
  increasedBy: number | null;
}
interface Finding {
  id: string; axis: string; checkKey: string; severity: Severity; label: string;
  value: number; prevValue: number | null; lastSeenAt: string; resolvedAt: string | null; drillDown: string | null;
  unobservable?: boolean; detail?: string | null; notifiedAt?: string | null;
  /** 🔴 소관은 표시 분류이지 권한이 아니다 — null = 미분류(지어내지 않음) */
  audience?: SentinelAudience | null;
  judgment?: JudgmentView | null;
}
type AdvisorResult =
  | {
      source: 'AI';
      verdictSuggestion: SentinelJudgmentVerdict;
      verdictLabel: string;
      rationale: string;
      verifySteps: string[];
      generatedAt: string;
    }
  | { source: 'UNAVAILABLE'; reason: string };
interface JudgmentLogRow {
  id: string; axis: string; checkKey: string; verdict: SentinelJudgmentVerdict;
  valueAtJudgment: number; basis: string; source: SentinelJudgmentSource;
  judgedAt: string; judgedByName: string | null;
}
interface Dashboard {
  redCoverage: {
    openRed: number; judged: number; staleIncreased: number; unjudged: number; unobservable: number;
    items: {
      axis: string; checkKey: string; label: string; value: number; firstSeenAt: string;
      dwellDays: number; state: 'UNOBSERVABLE' | 'UNJUDGED' | 'STALE_INCREASED' | 'JUDGED';
      audience: SentinelAudience | null;
      verdict: SentinelJudgmentVerdict | null; judgedAt: string | null; increasedBy: number | null;
    }[];
  };
  sweep24h: {
    axis: string; label: string; runs: number; ok: number; failedRuns: number;
    durationMsP50: number | null; durationMsMax: number | null;
  }[];
  resolution: { sampleN: number; bornResolvedN: number; medianDays: number | null };
  notified7d: number;
  runs: {
    axis: string; startedAt: string; ok: boolean; attempted: number; succeeded: number; failed: number;
    error: string | null; durationMs: number | null;
  }[];
  generatedAt: string;
}

const unwrap = <T,>(d: unknown): T => {
  const raw = (d as { data?: unknown })?.data;
  return (raw && typeof raw === 'object' && 'data' in (raw as object) ? (raw as { data: T }).data : raw) as T;
};

/** 심각도 표현 정본 — 점(dot)+칩. ⚪ 관측 항목은 0 이 목표가 아니라 경보색을 주지 않는다 */
const SEV_MARK: Record<Severity, { dot: string; tone: string; chip: string; label: string }> = {
  RED: { dot: 'bg-rose-500', tone: 'text-rose-600', chip: 'bg-rose-50 text-rose-700', label: '임상·재무 영향' },
  AMBER: { dot: 'bg-amber-400', tone: 'text-amber-600', chip: 'bg-amber-50 text-amber-700', label: '운영 혼선' },
  INFO: { dot: 'bg-gray-300', tone: 'text-gray-500', chip: 'bg-gray-100 text-gray-500', label: '관측(0이 목표가 아님)' },
};

function SevDot({ severity }: { severity: Severity }) {
  const tAttr = useTAttr();
  const s = SEV_MARK[severity] ?? SEV_MARK.INFO;
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${s.dot}`} title={tAttr(s.label)} aria-label={tAttr(s.label)} />;
}

/** 소관 칩 색 — 라벨 어휘는 shared 정본(SENTINEL_AUDIENCE_LABEL)이 갖는다 */
const AUDIENCE_CHIP: Record<SentinelAudience, string> = {
  ADMIN: 'bg-indigo-50 text-indigo-700 ring-indigo-100',
  CLINICAL: 'bg-teal-50 text-teal-700 ring-teal-100',
  ADMIN_STAFF: 'bg-orange-50 text-orange-700 ring-orange-100',
};

/**
 * 소관 배지 — 🔴 표시 분류이지 권한이 아니다(화면 노출은 종전대로 관리자 전용).
 * null = 미분류(그 사실을 그대로 쓴다) · undefined = 응답에 소관이 없다(그리지 않는다 —
 * 없는 것을 미분류라고 주장하지 않는다).
 */
function AudienceBadge({ audience }: { audience: SentinelAudience | null | undefined }) {
  const tAttr = useTAttr();
  if (audience === undefined) return null;
  if (audience === null) {
    return <span className="rounded px-1.5 py-0.5 text-[10px] text-gray-400 ring-1 ring-inset ring-gray-200"><T k={SENTINEL_AUDIENCE_UNASSIGNED_LABEL} /></span>;
  }
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] ring-1 ring-inset ${AUDIENCE_CHIP[audience]}`} title={tAttr(SENTINEL_AUDIENCE_DESC[audience])}>
      <T k={SENTINEL_AUDIENCE_LABEL[audience]} />
    </span>
  );
}

/** 추이 — 이전 값이 없으면 '처음 본 항목'이다(0에서 늘었다고 말하지 않는다) */
function Trend({ value, prev }: { value: number; prev: number | null }) {
  const tAttr = useTAttr();
  if (prev === null) return <span className="text-[11px] text-gray-400" title={tAttr('이번 스윕에서 처음 본 항목입니다')}><T k="신규" /></span>;
  const d = value - prev;
  if (d === 0) return <span className="text-[11px] text-gray-300">→</span>;
  return (
    <span className={`text-[11px] tabular-nums ${d > 0 ? 'text-rose-500' : 'text-emerald-600'}`}>
      {d > 0 ? '↗' : '↘'} {d > 0 ? '+' : ''}{d.toLocaleString('ko-KR')}
    </span>
  );
}

const AXIS_HINT: Record<string, string> = {
  DATA: '67개 불변식 — 데이터가 서로 모순되지 않는가',
  FLOW: '접수→진료→수납 흐름이 끝까지 가는가',
  CONTRACT: '생산자·소비자 계약이 어긋나지 않는가',
  PIPE: '크론·백업·배포 파이프가 살아 있는가',
};

export default function SentinelPage() {
  const tAttr = useTAttr();
  const [axis, setAxis] = useState<string>('DATA');
  const [showResolved, setShowResolved] = useState(false);
  /** 소관 필터 — 🔴 표시 필터일 뿐 권한이 아니다. 숨겨진 항목 수는 칩이 계속 말한다 */
  const [audFilter, setAudFilter] = useState<SentinelAudience | 'ALL' | 'UNASSIGNED'>('ALL');
  /** 판정 폼이 열린 발견(axis:checkKey) — 한 번에 하나만 연다 */
  const [judging, setJudging] = useState<string | null>(null);

  const ovQ = useQuery({
    queryKey: ['sentinel-overview'],
    queryFn: () => apiClient.get('/api/v1/admin/sentinel/overview').then((r) => unwrap<Overview>(r)),
    refetchInterval: pollMs('slow'),
    retry: 1,
  });
  // 🔴 실시간 축은 1분마다 갱신되므로 화면은 그보다 촘촘히 본다(최대 지연 10초)
  const pQ = useQuery({
    queryKey: ['sentinel-pulse'],
    queryFn: () => apiClient.get('/api/v1/admin/sentinel/pulse?minutes=120').then((r) => unwrap<Pulse>(r)),
    refetchInterval: pollMs('fast'),
    retry: 1,
  });

  const fQ = useQuery({
    queryKey: ['sentinel-findings', axis, showResolved],
    queryFn: () => apiClient
      .get(`/api/v1/admin/sentinel/findings?axis=${axis}${showResolved ? '&includeResolved=true' : ''}`)
      .then((r) => unwrap<Finding[]>(r)),
    refetchInterval: pollMs('slow'),
    retry: 1,
  });

  const dQ = useQuery({
    queryKey: ['sentinel-dashboard'],
    queryFn: () => apiClient.get('/api/v1/admin/sentinel/dashboard').then((r) => unwrap<Dashboard>(r)),
    refetchInterval: pollMs('slow'),
    retry: 1,
  });
  const jlQ = useQuery({
    queryKey: ['sentinel-judgment-log'],
    queryFn: () => apiClient.get('/api/v1/admin/sentinel/judgments').then((r) => unwrap<JudgmentLogRow[]>(r)),
    refetchInterval: pollMs('slow'),
    retry: 1,
  });

  if (ovQ.isError) return <div className="p-6"><QueryErrorFallback error={ovQ.error} onRetry={() => ovQ.refetch()} /></div>;

  const ov = ovQ.data;
  const dataAxis = ov?.axes.find((a) => a.key === 'DATA');
  const cov = dQ.data?.redCoverage ?? null;
  const rows = fQ.data ?? [];
  const audCount = (a: SentinelAudience | 'UNASSIGNED') =>
    rows.filter((f) => (a === 'UNASSIGNED' ? f.audience === null : f.audience === a)).length;
  const visibleRows = audFilter === 'ALL'
    ? rows
    : rows.filter((f) => (audFilter === 'UNASSIGNED' ? f.audience === null : f.audience === audFilter));
  const anomalies = (pQ.data?.metrics ?? []).filter((m) => m.verdict?.kind === 'ANOMALY').length;
  const pulseReady = !!pQ.data;
  const sweepOk = dQ.data ? dQ.data.sweep24h.reduce((s, a) => s + a.ok, 0) : null;
  const sweepRuns = dQ.data ? dQ.data.sweep24h.reduce((s, a) => s + a.runs, 0) : null;

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-gray-900"><T k="상시 감시" /></h1>
          <p className="mt-1 text-xs leading-relaxed text-gray-500">
            <T k="데이터 정합성 · 흐름 완결성 · 계약 드리프트 · 파이프 생존 — 감시자는 별도 프로세스로 돌며" />{' '}
            <b className="font-medium text-gray-600"><T k="데이터를 고치지 않습니다" /></b>. <T k="교정과 판정은 사람이 합니다." />
          </p>
        </div>
        {/* 🔴 감시자가 죽으면 그 사실이 숫자보다 먼저 보여야 한다 */}
        <SentinelHeartbeat axis={dataAxis} intervalMin={ov?.intervalMin} loading={ovQ.isLoading} />
      </header>

      {/*
       * 지금 볼 것 — 각 칸이 해당 섹션으로 점프한다.
       * 🔴 로딩·집계 실패는 '—' 다(0 이 아니다). 초록 안심 배지는 두지 않는다.
       */}
      <nav className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={tAttr('지금 볼 것')}>
        <SummaryChip
          href="#ops"
          label="적색 미판정"
          value={cov ? cov.unjudged.toLocaleString('ko-KR') : null}
          sub={cov ? <>/ <Tf k="미해결 적색 {건수}" params={{ 건수: cov.openRed.toLocaleString('ko-KR') }} /></> : <T k={dQ.isError ? '집계 실패' : '집계 중'} />}
          hot={!!cov && cov.unjudged > 0}
        />
        <SummaryChip
          href="#ops"
          label="재판정 필요"
          value={cov ? cov.staleIncreased.toLocaleString('ko-KR') : null}
          sub={<T k={cov ? '판정 이후 건수 증가' : dQ.isError ? '집계 실패' : '집계 중'} />}
          hot={!!cov && cov.staleIncreased > 0}
        />
        <SummaryChip
          href="#pulse"
          label="실시간 급변"
          value={pulseReady ? anomalies.toLocaleString('ko-KR') : null}
          sub={<T k={pulseReady ? '최근 2시간 · 자기 이력 대비' : pQ.isError ? '관측 실패' : '관측 중'} />}
          hot={pulseReady && anomalies > 0}
        />
        <SummaryChip
          href="#ops"
          label="스윕 성공 24h"
          value={sweepRuns === null ? null : sweepRuns === 0 ? '기록 없음' : `${(sweepOk ?? 0).toLocaleString('ko-KR')}/${sweepRuns.toLocaleString('ko-KR')}`}
          sub={<T k={sweepRuns === 0 ? '감시자 정지 의심' : '성공 / 시도(네 축 합)'} />}
          hot={sweepRuns === 0}
        />
      </nav>

      {/* 축 카드 — 발견 목록의 필터이기도 하다 */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        {(ov?.axes ?? []).map((a) => (
          <button
            key={a.key}
            onClick={() => setAxis(a.key)}
            aria-pressed={axis === a.key}
            className={`rounded-xl border p-3.5 text-left transition-all ${
              axis === a.key
                ? 'border-blue-400 bg-blue-50/50 shadow-sm ring-1 ring-blue-200'
                : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
            }`}
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[13px] font-semibold text-gray-900">{a.label}</span>
              {a.stale && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700"><T k="낡음" /></span>}
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              {/* 🔴 미판정은 숫자가 아니다 */}
              {a.open === null
                ? <span className="text-2xl font-bold leading-none text-gray-300">—</span>
                : <span className="text-2xl font-bold leading-none tabular-nums text-gray-900">{a.open.toLocaleString('ko-KR')}</span>}
              <span className="text-[10px] text-gray-400">{a.open === null ? <T k="미판정" /> : <T k="미해결" />}</span>
            </div>
            {a.bySeverity ? (
              <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] tabular-nums">
                <span className="flex items-center gap-1 text-rose-600"><SevDot severity="RED" />{a.bySeverity.RED}</span>
                <span className="flex items-center gap-1 text-amber-600"><SevDot severity="AMBER" />{a.bySeverity.AMBER}</span>
                <span className="flex items-center gap-1 text-gray-400"><SevDot severity="INFO" />{a.bySeverity.INFO}</span>
                {/* 🔴 관측 불가는 위반도 해결도 아니다 — 세 번째 칸으로 뺀다
                    🔴 null(미판정)을 0 으로 접고 비교하지 않는다 — 그 폴백이 이 화면이 잡으려는 결함이다 */}
                {a.unobservable != null && a.unobservable > 0 && (
                  <span className="text-gray-500" title={tAttr('프로브가 실패해 값을 믿을 수 없는 항목입니다(위반 0건이 아닙니다)')}>
                    ? <T k="관측 불가" /> {a.unobservable}
                  </span>
                )}
              </div>
            ) : (
              <p className="mt-2 text-[10px] leading-snug text-gray-400"><T k={AXIS_HINT[a.key] ?? ''} /></p>
            )}
            {a.unavailableReason && (
              <p className="mt-1.5 text-[10px] leading-snug text-gray-400">{a.unavailableReason}</p>
            )}
            {/* 🔴 '0건'이 어디까지의 0인지 — 관측 범위를 밝히지 않으면 화면이 안 보는 곳을 정상이라 말한다 */}
            {a.coverageNote && (
              <p className="mt-1.5 text-[10px] leading-snug text-amber-600">{a.coverageNote}</p>
            )}
          </button>
        ))}
      </div>

      <section id="findings" className="scroll-mt-6 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-gray-50/60 px-4 py-2.5">
          <h2 className="text-sm font-semibold text-gray-900">
            <T k="발견 목록" />
            <span className="ml-2 font-normal text-gray-400">{ov?.axes.find((a) => a.key === axis)?.label ?? axis}</span>
            <span className="ml-1.5 text-[10px] font-normal text-gray-300"><T k={AXIS_HINT[axis] ?? ''} /></span>
          </h2>
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-500">
            <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
            <T k="해결된 항목도 보기" />
          </label>
        </div>

        {/* 소관 필터 — 🔴 표시 필터이지 권한이 아니다. 각 칩이 건수를 계속 말해 숨긴 것이 사라진 척하지 않는다 */}
        {rows.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-gray-50 px-4 py-2" role="group" aria-label={tAttr('소관 필터')}>
            <span className="text-[10px] text-gray-400"><T k="소관" /></span>
            <AudienceFilterChip active={audFilter === 'ALL'} onClick={() => setAudFilter('ALL')} label="전체" count={rows.length} />
            {SENTINEL_AUDIENCES.map((a) => (
              <AudienceFilterChip
                key={a}
                active={audFilter === a}
                onClick={() => setAudFilter(audFilter === a ? 'ALL' : a)}
                label={SENTINEL_AUDIENCE_LABEL[a]}
                count={audCount(a)}
                title={tAttr(SENTINEL_AUDIENCE_DESC[a])}
              />
            ))}
            {/* 🔴 미분류는 있을 때만 — 없는 분류 칸을 지어내지 않는다 */}
            {audCount('UNASSIGNED') > 0 && (
              <AudienceFilterChip
                active={audFilter === 'UNASSIGNED'}
                onClick={() => setAudFilter(audFilter === 'UNASSIGNED' ? 'ALL' : 'UNASSIGNED')}
                label={SENTINEL_AUDIENCE_UNASSIGNED_LABEL}
                count={audCount('UNASSIGNED')}
                title={tAttr('소관 매핑이 아직 없는 항목 — 지어내지 않고 그 사실을 보입니다')}
              />
            )}
          </div>
        )}

        {fQ.isError ? (
          <div className="p-4"><QueryErrorFallback error={fQ.error} onRetry={() => fQ.refetch()} /></div>
        ) : fQ.isLoading ? (
          <div className="p-6 text-xs text-gray-400"><T k="불러오는 중…" /></div>
        ) : (fQ.data ?? []).length === 0 ? (
          <div className="p-4">
            {/* 🔴 빈 목록의 뜻이 축마다 다르다 — 미판정을 '이상 없음'이라 쓰지 않는다 */}
            <EmptyState
              title={dataAxisUnknown(ov, axis) ? '아직 판정하지 않았습니다' : '미해결 항목이 없습니다'}
              hint={dataAxisUnknown(ov, axis)
                // 🔴 서버가 준 사유는 카탈로그 키가 아니다 — `<T>` 로 보내면 "번역 미등록" 티가 거짓으로 붙는다
                ? (axisUnavailableReason(ov, axis) ?? '스윕 결과가 없습니다.')
                : '마지막 스윕에서 이 축의 모든 항목이 0이었습니다.'}
            />
          </div>
        ) : visibleRows.length === 0 ? (
          <div className="p-4 text-xs text-gray-500">
            <Tf k="이 소관 필터에 해당하는 항목이 없습니다 — 전체 {건수}건은 다른 소관에 있습니다." params={{ 건수: rows.length.toLocaleString('ko-KR') }} />
          </div>
        ) : (
          <ul className="divide-y divide-gray-50">
            {visibleRows.map((f) => {
              const sev = SEV_MARK[f.severity] ?? SEV_MARK.INFO;
              const jKey = `${f.axis}:${f.checkKey}`;
              return (
                <li key={f.id} className="px-4 py-3 transition-colors hover:bg-gray-50/40">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <SevDot severity={f.severity} />
                    <span className="min-w-0 flex-1 text-[13px] text-gray-800">
                      {f.label}
                      <span className="ml-1.5 font-mono text-[10px] text-gray-300">{f.checkKey}</span>
                      <span className="ml-1.5"><AudienceBadge audience={f.audience} /></span>
                      {f.resolvedAt && !f.unobservable && <span className="ml-1.5 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700"><T k="해결" /></span>}
                      {/* 🔴 알림은 **신규 발생과 재발만** 간다 — 이 배지가 없다고 놓친 것이 아니다 */}
                      {f.notifiedAt && <span className="ml-1.5 text-[10px] text-gray-400" title={tAttr('신규 발생 시 관리자에게 알림이 갔습니다(기존 항목은 다시 알리지 않습니다)')}><T k="알림 발신" /></span>}
                      {f.detail && <span className="mt-0.5 block text-[11px] leading-snug text-gray-400">{f.detail}</span>}
                    </span>
                    {/* 🔴 관측하지 못한 값을 숫자로 그리지 않는다 */}
                    {f.unobservable
                      ? <span className="shrink-0 text-xs text-gray-400" title={f.detail ?? undefined}><T k="관측 불가" /></span>
                      : <>
                          <span className={`shrink-0 text-sm font-bold tabular-nums ${sev.tone}`}>{f.value.toLocaleString('ko-KR')}</span>
                          <Trend value={f.value} prev={f.prevValue} />
                        </>}
                    {/* 🔴 갈 화면을 모르면 지어내지 않는다 — 그 사실을 쓴다 */}
                    {f.drillDown
                      ? <Link href={f.drillDown} className="shrink-0 text-[11px] text-blue-600 hover:underline"><T k="→ 화면" /></Link>
                      : <span className="shrink-0 text-[11px] text-gray-300" title={tAttr('이 항목을 고칠 화면이 아직 연결되지 않았습니다')}><T k="연결된 화면 없음" /></span>}
                  </div>
                  <JudgmentLine
                    finding={f}
                    open={judging === jKey}
                    onToggle={() => setJudging(judging === jKey ? null : jKey)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section id="pulse" className="scroll-mt-6">
        <PulseBoard q={pQ} />
      </section>

      <section id="ops" className="scroll-mt-6">
        <OpsDashboard q={dQ} logQ={jlQ} />
      </section>
    </div>
  );
}

/** 소관 필터 칩 — 표시 필터. 건수를 항상 병기해 숨긴 것이 없어진 척하지 않는다 */
function AudienceFilterChip({ active, onClick, label, count, title }: {
  active: boolean; onClick: () => void; label: string; count: number; title?: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
        active
          ? 'border-gray-800 bg-gray-900 text-white'
          : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
      }`}
    >
      <T k={label} /> <span className={`tabular-nums ${active ? 'text-gray-300' : 'text-gray-400'}`}>{count.toLocaleString('ko-KR')}</span>
    </button>
  );
}

/**
 * 요약 스트립 칸 — 🔴 값이 없으면 '—'(0 이 아니다). hot 은 사실 강조지 경보 색 남용이 아니다.
 * `sub` 는 호출부가 `<T>`/`<Tf>` 로 배선해 넘긴다 — 종전엔 숫자가 섞인 sub 를 "보간 문자열이라 원문 유지"로
 * 흘려 보냈고, 그 결과 `/ 미해결 적색 N` 이 모든 언어에서 한국어로 남았다(자리표시자 키로 회수).
 */
function SummaryChip({ href, label, value, sub, hot }: {
  href: string; label: string; value: string | null; sub: ReactNode; hot: boolean;
}) {
  return (
    <a
      href={href}
      className={`group rounded-xl border p-3 transition-all hover:shadow-sm ${
        hot ? 'border-amber-200 bg-amber-50/50 hover:border-amber-300' : 'border-gray-200 bg-white hover:border-gray-300'
      }`}
    >
      <div className="text-[11px] text-gray-500"><T k={label} /></div>
      <div className="mt-1 flex items-baseline gap-1.5">
        {value === null
          ? <span className="text-lg font-bold leading-none text-gray-300">—</span>
          : <span className={`text-lg font-bold leading-none tabular-nums ${hot ? 'text-amber-700' : 'text-gray-900'}`}>{/\d/.test(value) ? value : <T k={value} />}</span>}
      </div>
      <div className="mt-1 text-[10px] leading-snug text-gray-400">{sub}</div>
    </a>
  );
}

/** 서버가 준 축별 사유 — 데이터라서 번역 조회를 태우지 않는다(`<Data>`) */
function axisUnavailableReason(ov: Overview | undefined, axis: string) {
  const r = ov?.axes.find((a) => a.key === axis)?.unavailableReason;
  return r ? <Data>{r}</Data> : null;
}

function dataAxisUnknown(ov: Overview | undefined, axis: string) {
  const a = ov?.axes.find((x) => x.key === axis);
  return !a || a.open === null;
}

/** 감시자 생존 — 🔴 마지막 **성공** 스윕이 기준이다(시도만으로는 살아 있다고 말하지 않는다) */
function SentinelHeartbeat({ axis, intervalMin, loading }: { axis?: AxisView; intervalMin?: number; loading: boolean }) {
  if (loading) return <span className="text-xs text-gray-400"><T k="확인 중…" /></span>;
  if (!axis?.lastRun) {
    return (
      <span className="rounded-lg bg-gray-50 px-2.5 py-1.5 text-xs text-gray-500">
        <T k="감시자 상태" /> <Unknown kind="PENDING" /> — <T k="스윕 기록이 없습니다" />
      </span>
    );
  }
  const r = axis.lastRun;
  const alive = !axis.stale && r.ok;
  const tone = alive ? 'bg-emerald-50 text-emerald-800 border-emerald-100' : 'bg-amber-50 text-amber-800 border-amber-100';
  return (
    <span className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs ${tone}`}>
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${alive ? 'bg-emerald-500' : 'bg-amber-500'}`} aria-hidden="true" />
      <T k="마지막 스윕" /> <KDate value={r.at} mode="datetime" />
      {' · '}
      {r.ok ? <T k="정상" /> : <Tf k="부분 실패 {실패}/{시도}" params={{ 실패: r.failed, 시도: r.attempted }} />}
      {axis.stale && <> · <Tf k="{분}분 초과(감시자 정지 의심)" params={{ 분: intervalMin ? intervalMin * 2 : 0 }} /></>}
      {r.error && <span className="ml-1 text-[11px] opacity-80" title={r.error}><T k="사유 있음" /></span>}
    </span>
  );
}

/** 스파크라인 — 라이브러리 없이. 값이 하나뿐이면 선을 그리지 않는다(점 하나를 추세라 하지 않는다) */
function Spark({ series, tone }: { series: { v: number }[]; tone: string }) {
  if (series.length < 2) return <div className="h-6 w-full" />;
  const vs = series.map((s) => s.v);
  const min = Math.min(...vs); const max = Math.max(...vs);
  const span = max - min || 1;
  const w = 100; const h = 24;
  const pts = vs.map((v, i) => `${(i / (vs.length - 1)) * w},${h - ((v - min) / span) * (h - 3) - 1.5}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-6 w-full" aria-hidden="true">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5"
        vectorEffect="non-scaling-stroke" className={tone} />
    </svg>
  );
}

/* ── 판정 기록 ─────────────────────────────────────────────────────────────── */

const VERDICT_BADGE: Record<SentinelJudgmentVerdict, string> = {
  SEED_ARTIFACT: 'bg-slate-100 text-slate-600',
  FIXED_RESIDUAL: 'bg-sky-50 text-sky-700',
  REAL_DEFECT: 'bg-rose-50 text-rose-700',
  UNDETERMINED: 'bg-gray-100 text-gray-500',
};

/**
 * 발견 1건의 판정 표시 + 기록 폼.
 *
 * 🔴 판정 이후 값이 늘었으면 "판정됨"으로 그리지 않는다 — 그 판정은 새 행을 설명하지
 *    못한다. 옛 판정으로 새 위반을 조용히 덮는 것이 이 원장이 막으려는 거짓 안심이다.
 */
function JudgmentLine({ finding, open, onToggle }: { finding: Finding; open: boolean; onToggle: () => void }) {
  const tfAttr = useTfAttr();
  const j = finding.judgment ?? null;
  // 툴팁 문장 — 숫자·근거가 든 문장이라 자리표시자 키로 번역한다(값은 번역하지 않는다)
  const staleTitle = j ? tfAttr('판정 당시 {당시}건 → 현재 {현재}건. 근거: {근거}', { 당시: j.valueAtJudgment.toLocaleString('ko-KR'), 현재: finding.value.toLocaleString('ko-KR'), 근거: j.basis }) : undefined;
  return (
    <div className="mt-1 pl-5">
      <div className="flex flex-wrap items-center gap-2">
        {j ? (
          j.staleIncreased ? (
            <span
              className="rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700 ring-1 ring-inset ring-amber-100"
              title={staleTitle}
            >
              <T k="판정 이후" /> +{(j.increasedBy ?? 0).toLocaleString('ko-KR')} — <T k="재판정 필요" />
              <span className="ml-1 opacity-70">(<T k={SENTINEL_JUDGMENT_LABEL[j.verdict] ?? j.verdict} /> · <KDate value={j.judgedAt} mode="date" />)</span>
            </span>
          ) : (
            <span
              className={`rounded-md px-1.5 py-0.5 text-[11px] ${VERDICT_BADGE[j.verdict] ?? 'bg-gray-100 text-gray-500'}`}
              title={tfAttr('근거: {근거}', { 근거: j.basis })}
            >
              <T k="판정" />: <T k={SENTINEL_JUDGMENT_LABEL[j.verdict] ?? j.verdict} />
              <span className="ml-1 opacity-70">
                <KDate value={j.judgedAt} mode="date" /> · {j.judgedByName ?? <T k={SENTINEL_JUDGMENT_SOURCE_LABEL[j.source] ?? j.source} />}
                {' · '}<Tf k="당시 {건수}건" params={{ 건수: j.valueAtJudgment.toLocaleString('ko-KR') }} />
              </span>
            </span>
          )
        ) : finding.severity !== 'INFO' && !finding.resolvedAt ? (
          // 🔴 미판정은 사실이다 — 배지를 숨겨 "판정할 것 없음"처럼 보이게 하지 않는다
          <span className="rounded-md bg-gray-50 px-1.5 py-0.5 text-[11px] text-gray-400 ring-1 ring-inset ring-gray-100"><T k="미판정" /></span>
        ) : null}
        {!finding.resolvedAt && (
          <button
            onClick={onToggle}
            className="min-h-[44px] rounded-md px-2 text-[11px] font-medium text-blue-600 hover:bg-blue-50"
          >
            <T k={open ? '판정 닫기' : j ? '재판정' : '판정 기록'} />
          </button>
        )}
      </div>
      {open && <JudgmentForm finding={finding} onDone={onToggle} />}
    </div>
  );
}

function JudgmentForm({ finding, onDone }: { finding: Finding; onDone: () => void }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  // 🔴 쓰기 폼의 초기값은 "미선택"이다 — 기본 판정을 골라 두면 안 읽고 저장된다
  const [verdict, setVerdict] = useState<SentinelJudgmentVerdict | null>(null);
  const [basis, setBasis] = useState('');

  const mut = useMutation({
    mutationFn: () => apiClient.post('/api/v1/admin/sentinel/judgments', {
      axis: finding.axis, checkKey: finding.checkKey, verdict, basis: basis.trim(),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sentinel-findings'] });
      qc.invalidateQueries({ queryKey: ['sentinel-dashboard'] });
      qc.invalidateQueries({ queryKey: ['sentinel-judgment-log'] });
      onDone();
    },
  });

  return (
    <div className="mt-2 rounded-xl border border-gray-200 bg-gray-50/60 p-3">
      <p className="text-[11px] leading-relaxed text-gray-500">
        <Tf
          k={'판정은 발견을 없애지 않습니다 — 스윕은 계속 세고, 판정 시점 건수(현재 {건수}건)가 서버에서 함께 저장됩니다. 이후 값이 늘면 이 판정은 "재판정 필요"로 되돌아갑니다.'}
          params={{ 건수: finding.unobservable ? tAttr('관측 불가') : finding.value.toLocaleString('ko-KR') }}
        />
      </p>
      <AdvisorPanel finding={finding} />
      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
        {SENTINEL_JUDGMENT_VERDICTS.map((v) => (
          <label key={v} className={`flex min-h-[44px] cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-xs transition-colors ${
            verdict === v ? 'border-blue-300 bg-blue-50/50 ring-1 ring-blue-200' : 'border-gray-200 bg-white hover:border-gray-300'
          }`}>
            <input type="radio" className="mt-0.5" name={`verdict-${finding.checkKey}`} checked={verdict === v} onChange={() => setVerdict(v)} />
            <span>
              <span className="font-medium text-gray-800"><T k={SENTINEL_JUDGMENT_LABEL[v]} /></span>
              <span className="mt-0.5 block text-[11px] leading-snug text-gray-500"><T k={SENTINEL_JUDGMENT_EFFECT[v]} /></span>
            </span>
          </label>
        ))}
      </div>
      <textarea
        value={basis}
        onChange={(e) => setBasis(e.target.value)}
        rows={2}
        placeholder={tAttr('판정 근거(필수·10자 이상) — 무엇을 실측했고 어느 문서를 참조했는지')}
        className="mt-2 w-full rounded-lg border border-gray-200 p-2 text-xs focus:border-blue-300 focus:outline-none"
      />
      {mut.isError && (
        <p className="mt-1.5 text-[11px] text-rose-600" role="alert">
          <T k="기록하지 못했습니다" />: {(mut.error as { message?: string })?.message ?? tAttr('알 수 없는 오류')}
        </p>
      )}
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={() => mut.mutate()}
          disabled={!verdict || basis.trim().length < 10 || mut.isPending}
          className="min-h-[44px] rounded-lg bg-gray-900 px-4 text-xs font-medium text-white transition-colors hover:bg-gray-700 disabled:opacity-40"
        >
          <T k={mut.isPending ? '기록 중…' : '판정 기록'} />
        </button>
        <button onClick={onDone} className="min-h-[44px] rounded-lg px-3 text-xs text-gray-500 hover:bg-gray-100">
          <T k="취소" />
        </button>
        {(!verdict || basis.trim().length < 10) && (
          <span className="text-[11px] text-gray-400"><T k="판정 선택과 근거(10자 이상)가 필요합니다" /></span>
        )}
      </div>
    </div>
  );
}

/**
 * AI 판정 보조 — 관계 모드는 **보조·초안**이고 화면이 그 사실을 밝힌다.
 *
 * 🔴 AI 제안은 폼을 채우지 않는다 — verdict 라디오·근거 입력은 사람이 직접 한다
 *    (쓰기 폼 초기값 미선택 규약 — 제안이 폼을 채우면 안 읽고 저장된다).
 * 🔴 출처는 AI | UNAVAILABLE 둘뿐 — 못 하면 못 한다고 말하고, 지어낸 초안을 그리지 않는다.
 */
function AdvisorPanel({ finding }: { finding: Finding }) {
  const tAttr = useTAttr();
  const mut = useMutation({
    mutationFn: () => apiClient
      .post('/api/v1/admin/sentinel/findings/ai-advice', { axis: finding.axis, checkKey: finding.checkKey })
      .then((r) => unwrap<AdvisorResult>(r)),
  });
  const r = mut.data;

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => mut.mutate()}
          disabled={mut.isPending}
          className="min-h-[44px] rounded-lg border border-violet-200 bg-violet-50 px-3 text-[11px] font-medium text-violet-700 transition-colors hover:bg-violet-100 disabled:opacity-40"
        >
          {/* 🔴 AI 표기(AI_ORIGIN_TEXT)는 번역하지 않는다 — 자리표시자 값으로만 넘긴다(AI기본법 §31 표기 병기) */}
          <Tf k={mut.isPending ? '{AI표기} 분석 중…' : '{AI표기} 판정 보조'} params={{ AI표기: AI_ORIGIN_TEXT }} />
        </button>
        <span className="text-[10px] text-gray-400"><T k="보조·초안 — 확정 판정은 사람이 합니다. 제안이 폼을 채우지 않습니다." /></span>
      </div>
      {mut.isError && (
        <p className="mt-1.5 text-[11px] text-rose-600" role="alert">
          <Tf k="{AI표기} 보조 요청이 실패했습니다: {사유}" params={{ AI표기: AI_ORIGIN_TEXT, 사유: (mut.error as { message?: string })?.message ?? tAttr('알 수 없는 오류') }} />
        </p>
      )}
      {r && r.source === 'UNAVAILABLE' && (
        <p className="mt-1.5 rounded-lg border border-gray-200 bg-white p-2 text-[11px] text-gray-500">
          <Tf k="{AI표기} 초안 없음 — {사유}" params={{ AI표기: AI_ORIGIN_TEXT, 사유: r.reason }} />
        </p>
      )}
      {r && r.source === 'AI' && (
        <div className="mt-1.5 rounded-lg border border-violet-100 bg-violet-50/40 p-2.5 text-[11px]">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-medium text-violet-700"><Tf k="{AI표기} 초안" params={{ AI표기: AI_ORIGIN_TEXT }} /></span>
            <span className="text-gray-700"><T k="제안 판정" />: <b>{r.verdictLabel}</b></span>
            <span className="text-[10px] text-gray-400"><T k="확정 아님 — 아래 확인 후 직접 판정하세요" /></span>
          </div>
          <p className="mt-1 leading-snug text-gray-600">{r.rationale}</p>
          {r.verifySteps.length > 0 ? (
            <ul className="mt-1 list-disc pl-4 text-gray-500">
              {r.verifySteps.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          ) : (
            <p className="mt-1 text-[10px] text-gray-400"><T k="확인 방법을 제시하지 못했습니다 — 근거 없는 제안은 그만큼 약하게 읽으세요." /></p>
          )}
        </div>
      )}
    </div>
  );
}

/* ── 운영 지표·로그 대시보드 ───────────────────────────────────────────────── */

const COVERAGE_STATE_VIEW = {
  UNJUDGED: { label: '미판정', tone: 'text-gray-500 bg-gray-50 ring-gray-100' },
  STALE_INCREASED: { label: '재판정 필요', tone: 'text-amber-700 bg-amber-50 ring-amber-100' },
  JUDGED: { label: '판정됨', tone: 'text-slate-600 bg-slate-100 ring-slate-200' },
  UNOBSERVABLE: { label: '관측 불가', tone: 'text-gray-400 bg-gray-50 ring-gray-100' },
} as const;

/**
 * 감시 운영 지표 — 🔴 전부 사실만 그린다: 비율 대신 분자/분모, 표본 없으면 '산출 불가',
 * 체류일은 사실이고 "지연" 판정은 하지 않는다. 초록은 실제로 판정·측정된 것에만 준다.
 */
function OpsDashboard({ q, logQ }: {
  q: { data?: Dashboard; isLoading: boolean; isError: boolean; error: unknown; refetch: () => void };
  logQ: { data?: JudgmentLogRow[]; isLoading: boolean; isError: boolean; error: unknown; refetch: () => void };
}) {
  const tfAttr = useTfAttr();
  if (q.isError) {
    return (
      <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} />
      </section>
    );
  }
  const d = q.data;
  const cov = d?.redCoverage;
  const sweepOk = d ? d.sweep24h.reduce((s, a) => s + a.ok, 0) : null;
  const sweepRuns = d ? d.sweep24h.reduce((s, a) => s + a.runs, 0) : null;
  const attention = cov ? cov.items.filter((i) => i.state === 'UNJUDGED' || i.state === 'STALE_INCREASED') : [];

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 bg-gray-50/60 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-gray-900">
          <T k="운영 지표·로그" /> <span className="ml-1 font-normal text-gray-400"><T k="판정 커버리지 · 스윕 · 판정 이력" /></span>
        </h2>
      </div>

      {q.isLoading && !d ? (
        <div className="p-6 text-xs text-gray-400"><T k="불러오는 중…" /></div>
      ) : d && cov ? (
        <div className="space-y-5 p-4">
          {/* 측정수치 — 분모 병기·표본 병기·산출 불가는 산출 불가라고 */}
          <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2">
            <MiniMetric
              label="적색 미판정"
              value={`${cov.unjudged.toLocaleString('ko-KR')} / ${cov.openRed.toLocaleString('ko-KR')}`}
              hint="미해결 적색 중 사람 판정이 없는 항목 / 미해결 적색 전체"
              emphasize={cov.unjudged > 0}
            />
            <MiniMetric
              label="재판정 필요"
              value={cov.staleIncreased.toLocaleString('ko-KR')}
              hint="판정 이후 건수가 늘어 옛 판정이 새 행을 설명하지 못하는 항목"
              emphasize={cov.staleIncreased > 0}
            />
            <MiniMetric
              label="스윕 성공(24h)"
              value={sweepRuns ? `${(sweepOk ?? 0).toLocaleString('ko-KR')} / ${sweepRuns.toLocaleString('ko-KR')}` : null}
              hint="최근 24시간 성공한 스윕 / 시도한 스윕(네 축 합)"
              nullText="스윕 없음"
            />
            <MiniMetric
              label="발견→해결 중앙값"
              value={d.resolution.medianDays !== null ? <Tf k="{일수}일" params={{ 일수: d.resolution.medianDays }} /> : null}
              hint="해결된 발견 표본 {표본}건 기준(전 기간 · 생성과 동시 해결로 태어난 행 {제외}건은 발견이 아니라 제외)"
              hintParams={{ 표본: d.resolution.sampleN.toLocaleString('ko-KR'), 제외: d.resolution.bornResolvedN.toLocaleString('ko-KR') }}
              nullText={`${RATIO_UNAVAILABLE} — 표본 0`}
            />
            <MiniMetric
              label="알림 발신(7일)"
              value={d.notified7d.toLocaleString('ko-KR')}
              hint="신규 발생·재발로 실제 발신된 알림(기존 항목 재알림 없음)"
            />
          </div>

          {/* 판정 워크리스트 — 잔여 작업의 정본 표현은 줄어드는 목록이다 */}
          {attention.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-700"><T k="판정이 필요한 적색" /> <span className="font-normal text-gray-400">· <Tf k="{건수}건" params={{ 건수: attention.length }} /></span></h3>
              <ul className="mt-1.5 divide-y divide-gray-50 overflow-hidden rounded-lg border border-gray-200">
                {attention.map((i) => {
                  const st = COVERAGE_STATE_VIEW[i.state];
                  return (
                    <li key={`${i.axis}:${i.checkKey}`} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2 text-xs hover:bg-gray-50/40">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] ring-1 ring-inset ${st.tone}`}><T k={st.label} /></span>
                      <AudienceBadge audience={i.audience} />
                      <span className="min-w-0 flex-1 text-gray-700">{i.label}<span className="ml-1.5 font-mono text-[10px] text-gray-300">{i.checkKey}</span></span>
                      <span className="font-semibold tabular-nums text-rose-600">{i.value.toLocaleString('ko-KR')}</span>
                      {i.increasedBy !== null && <span className="text-[10px] text-amber-600"><T k="판정 이후" /> +{i.increasedBy.toLocaleString('ko-KR')}</span>}
                      {/* 체류일은 사실이다 — "지연" 판정은 하지 않는다 */}
                      <span className="text-[10px] text-gray-400" title={tfAttr('최초 관측 {시각}', { 시각: i.firstSeenAt })}><T k="체류" /> {i.dwellDays.toLocaleString('ko-KR')}<Unit>일</Unit></span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            {/* 스윕 런 로그 */}
            <div>
              <h3 className="text-xs font-semibold text-gray-700"><T k="스윕 이력" /> <span className="font-normal text-gray-400">· <Tf k="최근 24시간 {전체}회 중 {표시}" params={{ 전체: sweepRuns?.toLocaleString('ko-KR') ?? '', 표시: 40 }} /></span></h3>
              <div className="mt-1.5 max-h-64 overflow-y-auto rounded-lg border border-gray-200">
                <table className="w-full text-[11px]">
                  <thead className="sticky top-0 bg-gray-50 text-gray-500">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium"><T k="축" /></th>
                      <th className="px-2 py-1.5 text-left font-medium"><T k="시각" /></th>
                      <th className="px-2 py-1.5 text-right font-medium"><T k="평가" /></th>
                      <th className="px-2 py-1.5 text-right font-medium"><T k="소요" /></th>
                      <th className="px-2 py-1.5 text-left font-medium"><T k="결과" /></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {d.runs.length === 0 ? (
                      <tr><td colSpan={5} className="px-2 py-3 text-center text-gray-400"><T k="최근 24시간 스윕 기록이 없습니다 — 감시자 정지 의심" /></td></tr>
                    ) : d.runs.map((r, idx) => (
                      <tr key={idx} className="text-gray-600 odd:bg-gray-50/30">
                        <td className="px-2 py-1 font-mono text-[10px]">{r.axis}</td>
                        <td className="px-2 py-1"><KDate value={r.startedAt} mode="datetime" /></td>
                        <td className="px-2 py-1 text-right tabular-nums">{r.succeeded}/{r.attempted}</td>
                        <td className="px-2 py-1 text-right tabular-nums">{r.durationMs !== null ? `${r.durationMs.toLocaleString('ko-KR')}ms` : '—'}</td>
                        <td className="px-2 py-1">
                          {r.ok
                            ? <span className="text-emerald-600"><T k="정상" /></span>
                            : <span className="text-rose-600" title={r.error ?? undefined}><Tf k="실패 {건수}건" params={{ 건수: r.failed }} />{r.error ? <> · <T k="사유 있음" /></> : ''}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* 소요시간 요약 — 표본 없으면 말하지 않는다 */}
              <p className="mt-1 text-[10px] text-gray-400">
                {d.sweep24h.filter((a) => a.durationMsP50 !== null).map((a) =>
                  `${a.axis} p50 ${a.durationMsP50!.toLocaleString('ko-KR')}ms·max ${a.durationMsMax!.toLocaleString('ko-KR')}ms`,
                ).join(' · ') || <T k="소요시간 표본 없음" />}
              </p>
            </div>

            {/* 판정 로그 — append-only 이력 그대로 */}
            <div>
              <h3 className="text-xs font-semibold text-gray-700"><T k="판정 이력" /> <span className="font-normal text-gray-400">· <T k="최신순(수정·삭제 없음)" /></span></h3>
              {logQ.isError ? (
                <div className="mt-1.5"><QueryErrorFallback error={logQ.error} onRetry={() => logQ.refetch()} /></div>
              ) : logQ.isLoading ? (
                <div className="mt-1.5 p-3 text-[11px] text-gray-400"><T k="불러오는 중…" /></div>
              ) : (logQ.data ?? []).length === 0 ? (
                <div className="mt-1.5 rounded-lg border border-gray-200 p-3 text-[11px] text-gray-400">
                  <T k="기록된 판정이 아직 없습니다." />
                </div>
              ) : (
                <ul className="mt-1.5 max-h-64 divide-y divide-gray-50 overflow-y-auto rounded-lg border border-gray-200">
                  {(logQ.data ?? []).map((r) => (
                    <li key={r.id} className="px-3 py-2 text-[11px] hover:bg-gray-50/40">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] ${VERDICT_BADGE[r.verdict] ?? 'bg-gray-100 text-gray-500'}`}>
                          <T k={SENTINEL_JUDGMENT_LABEL[r.verdict] ?? r.verdict} />
                        </span>
                        <span className="font-mono text-[10px] text-gray-500">{r.checkKey}</span>
                        <span className="tabular-nums text-gray-400"><Tf k="당시 {건수}건" params={{ 건수: r.valueAtJudgment.toLocaleString('ko-KR') }} /></span>
                        <span className="ml-auto text-gray-400">
                          <KDate value={r.judgedAt} mode="datetime" /> · {r.judgedByName ?? <T k={SENTINEL_JUDGMENT_SOURCE_LABEL[r.source] ?? r.source} />}
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-2 leading-snug text-gray-500" title={r.basis}>{r.basis}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="p-6 text-xs text-gray-400"><T k="지표를 불러오지 못했습니다." /></div>
      )}
    </section>
  );
}

/**
 * 작은 지표 타일 — 라벨 위·값 아래(세로 배치 정본). null 은 이유를 말한다.
 * 🔴 `hint` 는 **자리표시자 키**다(값은 `hintParams`). 종전엔 숫자가 섞인 hint 를 "보간 문자열이라 원문 유지"로
 *    흘려 보내 모든 언어에서 한국어로 남았다 — 문장을 통째로 키로 두고 값만 끼운다(조각 배선 금지).
 */
function MiniMetric({ label, value, hint, hintParams, nullText, emphasize }: {
  label: string; value: ReactNode | null; hint: string; hintParams?: Record<string, string | number>; nullText?: string; emphasize?: boolean;
}) {
  const tfAttr = useTfAttr();
  const params = hintParams ?? {};
  return (
    <div className={`rounded-lg border p-3 ${emphasize ? 'border-amber-200 bg-amber-50/40' : 'border-gray-200 bg-white'}`} title={tfAttr(hint, params)}>
      <div className="text-[11px] text-gray-500"><T k={label} /></div>
      {value === null
        ? <div className="mt-1 text-xs text-gray-400"><NullReason text={nullText ?? RATIO_UNAVAILABLE} /></div>
        : <div className={`mt-1 text-lg font-bold leading-none tabular-nums ${emphasize ? 'text-amber-700' : 'text-gray-900'}`}>{value}</div>}
      <p className="mt-1 text-[10px] leading-snug text-gray-400"><Tf k={hint} params={params} /></p>
    </div>
  );
}

/**
 * 값이 없는 사유 — `'산출 불가 — 표본 0'` 처럼 **독립 구절을 ' — ' 로 이은** 문구다(숫자 어순이 걸린 문장이 아니다).
 * 구절마다 번역한다 — 통째로 키를 두면 shared 정본(RATIO_UNAVAILABLE)의 문구가 카탈로그 키에 박혀 갈라진다.
 */
function NullReason({ text }: { text: string }) {
  const parts = text.split(' — ');
  return <>{parts.map((p, i) => <span key={i}>{i > 0 && ' — '}<T k={p} /></span>)}</>;
}

const VERDICT_VIEW: Record<Verdict['kind'], { text: string; tone: string; ring: string }> = {
  // 🔴 '급변' 단독 키는 검사실 델타 체크(Delta) 뜻으로 먼저 등재돼 있다 — 감시 축은 문맥 키로 가른다
  ANOMALY: { text: '급변@감시', tone: 'text-rose-600', ring: 'border-rose-300 bg-rose-50/40' },
  NORMAL: { text: '평상 범위', tone: 'text-emerald-600', ring: 'border-gray-100 bg-white' },
  // 🔴 축적 중·변동 없음은 '정상'이 아니다 — 초록으로 그리면 판정하지 않은 것을 안심으로 말하게 된다
  WARMING: { text: '축적 중', tone: 'text-gray-400', ring: 'border-gray-100 bg-white' },
  FLAT: { text: '판정 보류', tone: 'text-gray-400', ring: 'border-gray-100 bg-white' },
  // 🔴 표본이 모자라 값이 없는 것이지 관측이 멈춘 것도, 0 인 것도 아니다
  NOT_COMPUTABLE: { text: '산출 불가', tone: 'text-gray-400', ring: 'border-gray-100 bg-white' },
};

/**
 * 실시간 축 — "지금 무슨 일이 일어나고 있는가".
 *
 * 🔴 이 보드의 규칙은 축 카드와 같다: **판정하지 않은 것을 정상으로 그리지 않는다.**
 *    축적 중(WARMING)과 변동 없음(FLAT)은 회색이고, 초록은 실제로 판정한 것에만 준다.
 */
function PulseBoard({ q }: { q: { data?: Pulse; isLoading: boolean; isError: boolean; error: unknown; refetch: () => void } }) {
  if (q.isError) return <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"><QueryErrorFallback error={q.error} onRetry={() => q.refetch()} /></div>;
  const metrics = q.data?.metrics ?? [];
  const anomalies = metrics.filter((m) => m.verdict?.kind === 'ANOMALY');
  // 🔴 '산출 불가'(표본 부족)는 틱이 멈춘 것이 아니다 — 그것까지 세면 '감시자 정지 의심'이 오진이 된다
  const tickable = metrics.filter((m) => m.verdict?.kind !== 'NOT_COMPUTABLE');
  const staleAll = tickable.length > 0 && tickable.every((m) => m.stale);

  return (
    <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-gray-50/60 px-4 py-2.5">
        <h2 className="text-sm font-semibold text-gray-900">
          <T k="실시간" /> <span className="ml-1 font-normal text-gray-400"><T k="1분마다 관측 · 최근 2시간" /></span>
        </h2>
        {/* 🔴 틱이 멈추면 값보다 그 사실이 먼저 보여야 한다 */}
        {staleAll
          ? <span className="rounded bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700"><T k="관측이 3분 넘게 없습니다 — 감시자 정지 의심" /></span>
          : anomalies.length > 0
            ? <span className="rounded bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700"><Tf k="급변 {건수}건" params={{ 건수: anomalies.length }} /></span>
            : <span className="text-[11px] text-gray-400"><T k="급변 없음" /></span>}
      </div>

      {q.isLoading && metrics.length === 0 ? (
        <div className="p-6 text-xs text-gray-400"><T k="불러오는 중…" /></div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-px bg-gray-100/60">
          {metrics.map((m) => {
            const v = m.verdict ? VERDICT_VIEW[m.verdict.kind] : null;
            return (
              <div key={m.key} className={`border-l-2 bg-white p-3 ${m.verdict?.kind === 'ANOMALY' ? 'border-l-rose-400' : 'border-l-transparent'}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[12px] text-gray-500" title={m.why}>{m.label}</span>
                  <span className={`shrink-0 text-[10px] ${v?.tone ?? 'text-gray-300'}`}><T k={v?.text ?? '관측 없음'} /></span>
                </div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  {/* 🔴 관측이 없거나 낡았으면 숫자를 '지금'이라 말하지 않는다 */}
                  {m.current === null
                    ? <span className="text-xl font-bold leading-none text-gray-300">—</span>
                    : <span className={`text-xl font-bold leading-none tabular-nums ${m.stale ? 'text-gray-400' : 'text-gray-900'}`}>
                        {m.current.toLocaleString('ko-KR')}
                      </span>}
                  {m.unit && <span className="text-[11px] text-gray-400">{m.unit}</span>}
                  {m.stale && m.current !== null && (
                    <span className="text-[10px] text-amber-600" title={m.lastAt ?? undefined}><T k="낡음" /></span>
                  )}
                </div>
                <Spark series={m.series} tone={m.verdict?.kind === 'ANOMALY' ? 'text-rose-400' : 'text-gray-300'} />
                <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-gray-400" title={m.verdict?.detail}>
                  {m.verdict?.detail ?? <T k="아직 관측값이 없습니다." />}
                </p>
                {m.drillDown && m.verdict?.kind === 'ANOMALY' && (
                  <Link href={m.drillDown} className="mt-1 inline-block text-[11px] text-blue-600 hover:underline"><T k="→ 화면" /></Link>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
