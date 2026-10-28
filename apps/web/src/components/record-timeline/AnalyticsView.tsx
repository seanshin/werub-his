'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { kdate } from '@/lib/ui-settings';
import { EmptyState, Ratio } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { roundBy } from '@hospital-run/shared';

/** 서버 `record-analytics.ts` 계약 */
type RangeState = 'IN' | 'OUT' | null;
type RangeMove = 'STAYED_IN' | 'ENTERED' | 'LEFT' | 'STAYED_OUT' | null;
interface Analyte {
  key: string; kind: 'LAB' | 'VITAL'; name: string; unit: string | null;
  codes: { loinc: string | null; code: string | null };
  n: number; first: { at: string; value: number } | null; last: { at: string; value: number } | null;
  delta: number | null; deltaPct: number | null; min: number | null; max: number | null; median: number | null; slopePer30d: number | null;
  range: { low: number | null; high: number | null; source: 'LAB_REFERENCE' | 'VITALS_CANON' | null };
  inRange: { numerator: number; denominator: number };
  abnormal: number; critical: number; rangeMove: RangeMove;
  excluded: { nonNumeric: number; otherUnit: number };
  series: { at: string; value: number; flag: string | null; range: RangeState }[];
  medEffects: { medId: string; name: string | null; start: string; meanBefore: number; nBefore: number; meanAfter: number; nAfter: number }[];
  medEffectsMore?: number;
}
interface MedLane {
  id: string; name: string | null; status: string; start: string; end: string | null; endKnown: boolean; ongoing: boolean;
  prescriptions?: number;
  segments?: { start: string; end: string | null; endKnown: boolean; status: string }[];
}
export interface RecordAnalytics {
  period: { from: string; to: string };
  analytes: Analyte[];
  meds: MedLane[];
  summary: { analytes: number; latestOutOfRange: number; criticalPoints: number; largestChanges: { key: string; name: string; deltaPct: number }[] };
  truncated: { labs: boolean; vitals: boolean; meds: boolean };
  vitalsThresholdSource: 'CONFIGURED' | 'DEFAULT';
}

const MOVE_LABEL: Record<Exclude<RangeMove, null>, { label: string; tone: string }> = {
  STAYED_IN: { label: '범위 안 유지', tone: 'bg-emerald-50 text-emerald-700' },
  ENTERED: { label: '범위 밖 → 안', tone: 'bg-sky-50 text-sky-700' },
  LEFT: { label: '범위 안 → 밖', tone: 'bg-amber-50 text-amber-800' },
  STAYED_OUT: { label: '범위 밖 유지', tone: 'bg-rose-50 text-rose-700' },
};
type Filter = 'ALL' | 'OUT' | 'LAB' | 'VITAL';
const signed = (x: number) => (x > 0 ? `+${x}` : `${x}`);

/**
 * 임상 기록 시계열 — **분석** 보기(2026-10-01 사람 요청: 진료의 방향과 의미를 판단하는 데 도움이 되는 통계).
 *  · 모든 그래프가 **같은 시간축**(조회 기간)을 쓴다 — 처방 기간 레인과 나란히 읽힌다
 *  · 항목 카드: 처음→최근·변화·범위 안 비율(분모)·중앙값·30일당 기울기·범위 이동 · 처방 시작 전·후 평균
 *  · 🔴 화면은 "호전·악화"를 말하지 않는다 — 참고 범위 기준의 사실과 크기만. 처방 전후 비교는 관련성 판단이 아니라고 그 자리에서 밝힌다
 */
export function AnalyticsView({ patientId, months }: { patientId: string; months: number | null }) {
  const tAttr = useTAttr();
  const [filter, setFilter] = useState<Filter>('ALL');
  const [q, setQ] = useState('');
  const from = months ? new Date(Date.now() - months * 30 * 86_400_000).toISOString() : new Date('2000-01-01T00:00:00Z').toISOString();
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['record-analytics', patientId, months],
    queryFn: () => apiClient.get<{ data: RecordAnalytics }>(`/api/v1/patients/${patientId}/record-timeline/analytics`, { from }),
  });
  const r = data?.data;
  const shown = useMemo(() => {
    if (!r) return [];
    const needle = q.trim().toLowerCase();
    return r.analytes.filter((a) =>
      (filter === 'ALL' || (filter === 'OUT' ? a.series[a.series.length - 1]?.range === 'OUT' : a.kind === filter))
      && (!needle || a.name.toLowerCase().includes(needle)));
  }, [r, filter, q]);

  if (isLoading) return <div className="space-y-2" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-40 animate-pulse rounded-xl bg-gray-100" />)}</div>;
  if (isError) return <QueryErrorFallback error={error} onRetry={() => refetch()} />;
  if (!r || r.analytes.length === 0) {
    return <EmptyState icon="📈" title="분석할 수치 기록이 없습니다" hint="검사 결과·활력이 쌓이면 항목별 추이와 처방 기간을 함께 보여 줍니다" />;
  }
  const axis = { from: Date.parse(r.period.from), to: Date.parse(r.period.to) };
  const dataStart = Math.min(...r.analytes.flatMap((a) => a.series.map((p) => Date.parse(p.at))));
  // 축은 조회 기간이되, 데이터가 훨씬 늦게 시작하면(‘전체’) 첫 기록부터 — 빈 축을 그리지 않는다
  const ax = { from: Math.max(axis.from, Number.isFinite(dataStart) ? dataStart - 3 * 86_400_000 : axis.from), to: axis.to };

  return (
    <div className="space-y-4" data-record-analytics>
      {/* 요약 띠 */}
      <section className="grid gap-3 lg:grid-cols-[1fr_2fr]">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="분석 항목" value={r.summary.analytes} />
          <Stat label="최근 값 범위 밖" value={r.summary.latestOutOfRange} tone={r.summary.latestOutOfRange ? 'text-amber-700' : undefined} />
          <Stat label="위급 값 기록" value={r.summary.criticalPoints} tone={r.summary.criticalPoints ? 'text-rose-700' : undefined} />
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-3">
          <div className="mb-1.5 text-[11px] font-semibold text-gray-500"><T k="변화가 큰 항목(처음 대비 · 크기만)" /></div>
          {r.summary.largestChanges.length === 0 ? (
            <p className="text-xs text-gray-400"><T k="두 번 이상 측정된 검사가 없습니다" /></p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {r.summary.largestChanges.map((c) => (
                <a key={c.key} href={`#analyte-${encodeURIComponent(c.key)}`} className="rounded-full border border-gray-200 px-2.5 py-0.5 text-xs text-gray-700 hover:bg-gray-50">
                  {c.name} <span className="tabular-nums font-semibold">{signed(c.deltaPct)}%</span>
                </a>
              ))}
            </div>
          )}
        </div>
      </section>

      <p className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
        <T k="수치 사실만 정리합니다 — 좋아졌다·나빠졌다는 판단은 하지 않습니다(참고 범위 기준 이동과 크기만). 진료 판단은 의료진이 합니다." />
        {r.vitalsThresholdSource === 'DEFAULT' && <> <T k="활력 범위는 코드 기본값입니다(원내 개정 미설정)." /></>}
        {(r.truncated.labs || r.truncated.vitals || r.truncated.meds) && <> <span className="text-amber-700"><T k="조회 상한에 걸려 일부 기록만 분석했습니다 — 기간을 좁혀 보세요." /></span></>}
      </p>

      {/* 처방 기간 레인 — 그래프와 같은 시간축 */}
      {r.meds.length > 0 && <MedLanes meds={r.meds} ax={ax} />}

      {/* 필터 */}
      <div className="flex flex-wrap items-center gap-1.5">
        {(['ALL', 'OUT', 'LAB', 'VITAL'] as const).map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1 text-xs ${filter === f ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            <T k={f === 'ALL' ? '전체' : f === 'OUT' ? '최근 값 범위 밖' : f === 'LAB' ? '검사' : '활력'} />
          </button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tAttr('항목 이름으로 찾기')} aria-label={tAttr('항목 이름으로 찾기')}
          className="ml-auto min-h-[32px] w-48 rounded-lg border border-gray-200 px-2 text-xs" />
      </div>

      {shown.length === 0 ? (
        <EmptyState compact title="이 조건에 맞는 항목이 없습니다" />
      ) : (
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(360px,1fr))]">
          {shown.map((a) => <AnalyteCard key={a.key} a={a} ax={ax} meds={r.meds} />)}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-3">
      <div className={`text-2xl font-bold tabular-nums ${tone ?? 'text-gray-900'}`}>{value.toLocaleString()}</div>
      <div className="text-[11px] text-gray-500"><T k={label} /></div>
    </div>
  );
}

const W = 600;
const H = 140;
const PAD = { l: 34, r: 8, t: 10, b: 18 };

function MedLanes({ meds, ax }: { meds: MedLane[]; ax: { from: number; to: number } }) {
  const x = (t: number) => ((Math.min(Math.max(t, ax.from), ax.to) - ax.from) / Math.max(ax.to - ax.from, 1)) * 100;
  return (
    <section className="rounded-xl border border-gray-100 bg-white p-3" aria-label="처방 기간">
      <div className="mb-2 flex items-baseline justify-between">
        <h4 className="text-xs font-semibold text-gray-700"><T k="처방 기간" /> <span className="font-normal text-gray-400">({meds.length})</span></h4>
        <span className="text-[10px] text-gray-400">{kdate(new Date(ax.from), 'date')} ~ {kdate(new Date(ax.to), 'date')}</span>
      </div>
      <ul className="max-h-60 space-y-1 overflow-y-auto pr-1">
        {meds.map((m) => {
          // 약 하나 = 레인 하나 — 반복·갱신 처방은 같은 줄의 기간 조각
          const segs = m.segments?.length ? m.segments : [{ start: m.start, end: m.end, endKnown: m.endKnown, status: m.status }];
          return (
            <li key={m.id} className="grid grid-cols-[minmax(120px,30%)_1fr] items-center gap-2 text-[11px]">
              <span className="truncate text-gray-700" title={m.name ?? undefined}>
                {m.name ?? <T k="약 이름 없음" />}
                {(m.prescriptions ?? 1) > 1 && <span className="ml-1 text-gray-400">×{m.prescriptions}</span>}
                {!m.ongoing && m.status === 'DISCONTINUED' && <span className="ml-1 text-gray-400"><T k="(중단)" /></span>}
              </span>
              <span className="relative h-3 rounded bg-gray-50">
                {segs.map((g, i) => {
                  const s0 = Date.parse(g.start);
                  const e0 = g.end ? Date.parse(g.end) : ax.to;
                  const left = x(s0);
                  const width = Math.max(x(e0) - left, 0.6);
                  return (
                    <span key={i} className={`absolute top-0 h-3 rounded ${g.status === 'DISCONTINUED' ? 'bg-gray-300' : g.endKnown ? 'bg-indigo-300' : 'bg-gradient-to-r from-indigo-300 to-transparent'}`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      title={`${kdate(new Date(s0), 'date')} ~ ${g.end ? kdate(new Date(g.end), 'date') : '?'}`} />
                  );
                })}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-1 text-[10px] text-gray-400"><T k="막대가 흐려지는 것은 끝(투여일수·중단)을 모르는 처방입니다" /></p>
    </section>
  );
}

function AnalyteCard({ a, ax, meds }: { a: Analyte; ax: { from: number; to: number }; meds: MedLane[] }) {
  const latest = a.series[a.series.length - 1];
  const vals = a.series.map((p) => p.value);
  const lo = Math.min(...vals, a.range.low ?? Infinity);
  const hi = Math.max(...vals, a.range.high ?? -Infinity);
  const span = hi - lo || Math.abs(hi) || 1;
  const yMin = lo - span * 0.1;
  const yMax = hi + span * 0.1;
  const X = (t: number) => PAD.l + ((t - ax.from) / Math.max(ax.to - ax.from, 1)) * (W - PAD.l - PAD.r);
  const Y = (v: number) => PAD.t + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD.t - PAD.b);
  const pts = a.series.map((p) => ({ x: X(Date.parse(p.at)), y: Y(p.value), p }));
  const effectMeds = new Set(a.medEffects.map((m) => m.medId));
  const move = a.rangeMove ? MOVE_LABEL[a.rangeMove] : null;
  return (
    <article id={`analyte-${encodeURIComponent(a.key)}`} className={`rounded-xl border bg-white p-3 ${latest?.range === 'OUT' ? 'border-amber-200' : 'border-gray-100'}`}>
      <header className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h4 className="text-sm font-semibold text-gray-900">{a.name}</h4>
        {a.unit && <span className="text-[11px] text-gray-400">{a.unit}</span>}
        <span className="rounded bg-gray-100 px-1.5 text-[10px] text-gray-500"><T k={a.kind === 'LAB' ? '검사' : '활력'} /></span>
        {move && <span className={`rounded px-1.5 text-[10px] font-medium ${move.tone}`}><T k={move.label} /></span>}
        {a.critical > 0 && <span className="rounded bg-rose-100 px-1.5 text-[10px] font-medium text-rose-700"><Tf k="위급 {수}회" params={{ 수: a.critical }} /></span>}
        <span className="ml-auto text-right">
          <span className={`text-lg font-bold tabular-nums ${latest?.range === 'OUT' ? 'text-amber-700' : 'text-gray-900'}`}>{a.last?.value ?? '-'}</span>
          {a.last && <span className="block text-[10px] text-gray-400"><T k="최근" /> {kdate(new Date(a.last.at), 'date')}</span>}
        </span>
      </header>

      <svg viewBox={`0 0 ${W} ${H}`} className="h-36 w-full" role="img" aria-label={`${a.name} 추이`} preserveAspectRatio="none">
        {(a.range.low != null || a.range.high != null) && (
          <rect x={PAD.l} width={W - PAD.l - PAD.r}
            y={Y(Math.min(a.range.high ?? yMax, yMax))}
            height={Math.max(Y(Math.max(a.range.low ?? yMin, yMin)) - Y(Math.min(a.range.high ?? yMax, yMax)), 0)}
            className="fill-emerald-50" />
        )}
        {[yMin + (yMax - yMin) * 0.1, yMax - (yMax - yMin) * 0.1].map((v, i) => (
          <text key={i} x={PAD.l - 4} y={Y(v) + 3} textAnchor="end" className="fill-gray-400 text-[10px]">{roundBy(v, 'labValue')}</text>
        ))}
        {meds.filter((m) => effectMeds.has(m.id)).map((m) => {
          const mx = X(Date.parse(m.start));
          return <line key={m.id} x1={mx} x2={mx} y1={PAD.t} y2={H - PAD.b} className="stroke-indigo-300" strokeDasharray="3 3" />;
        })}
        {pts.length > 1 && <polyline points={pts.map((q) => `${q.x},${q.y}`).join(' ')} className="fill-none stroke-gray-400" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
        {pts.map((q, i) => (
          <circle key={i} cx={q.x} cy={q.y} r={3.5} vectorEffect="non-scaling-stroke"
            className={q.p.flag && ['HH', 'LL', 'CRITICAL', 'PANIC', 'C', 'CC', 'AA'].includes(q.p.flag) ? 'fill-rose-600' : q.p.range === 'OUT' ? 'fill-amber-500' : q.p.range === 'IN' ? 'fill-emerald-500' : 'fill-gray-400'}>
            <title>{`${kdate(new Date(q.p.at), 'datetimeShort')} · ${q.p.value}${q.p.flag ? ` (${q.p.flag})` : ''}`}</title>
          </circle>
        ))}
        <text x={PAD.l} y={H - 4} className="fill-gray-400 text-[10px]">{kdate(new Date(ax.from), 'date')}</text>
        <text x={W - PAD.r} y={H - 4} textAnchor="end" className="fill-gray-400 text-[10px]">{kdate(new Date(ax.to), 'date')}</text>
      </svg>

      <dl className="mt-1 grid grid-cols-3 gap-x-3 gap-y-1 text-[11px]">
        <div><dt className="text-gray-400"><T k="처음 → 최근" /></dt><dd className="tabular-nums text-gray-800">{a.first?.value ?? '-'} → {a.last?.value ?? '-'}</dd></div>
        <div><dt className="text-gray-400"><T k="변화" /></dt><dd className="tabular-nums text-gray-800">{a.delta == null ? '-' : signed(a.delta)}{a.deltaPct != null && <span className="text-gray-400"> ({signed(a.deltaPct)}%)</span>}</dd></div>
        <div><dt className="text-gray-400"><T k="범위 안" /></dt><dd className="tabular-nums text-gray-800"><Ratio numerator={a.inRange.numerator} denominator={a.inRange.denominator} /></dd></div>
        <div><dt className="text-gray-400"><T k="측정" /></dt><dd className="tabular-nums text-gray-800"><Tf k="{수}회" params={{ 수: a.n }} /></dd></div>
        <div><dt className="text-gray-400"><T k="중앙값 · 범위" /></dt><dd className="tabular-nums text-gray-800">{a.median ?? '-'} · {a.min ?? '-'}~{a.max ?? '-'}</dd></div>
        <div><dt className="text-gray-400"><T k="30일당 기울기" /></dt><dd className="tabular-nums text-gray-800">{a.slopePer30d == null ? <span className="text-gray-400"><T k="3회 미만" /></span> : signed(a.slopePer30d)}</dd></div>
      </dl>
      <p className="mt-1 text-[10px] text-gray-400">
        <T k="참고 범위" />{' '}
        {a.range.low != null || a.range.high != null
          ? <>{a.range.low ?? '-'} ~ {a.range.high ?? '-'} · <T k={a.range.source === 'VITALS_CANON' ? '활력 판정 기준' : '최근 결과의 참고 범위'} /></>
          : <T k="없음 — 범위 안 비율은 플래그로 판정" />}
        {(a.excluded.nonNumeric > 0 || a.excluded.otherUnit > 0) && (
          <> · <Tf k="계산에서 뺌: 수치 아님 {a}·다른 단위 {b}" params={{ a: a.excluded.nonNumeric, b: a.excluded.otherUnit }} /></>
        )}
      </p>
      {a.medEffects.length > 0 && (
        <div className="mt-2 rounded-lg bg-indigo-50/60 p-2 text-[11px]">
          <div className="mb-0.5 font-medium text-indigo-900"><T k="처방 시작 전·후 평균(90일 · 관련성 판단 아님)" /></div>
          <ul className="space-y-0.5">
            {a.medEffects.map((m) => (
              <li key={m.medId} className="flex flex-wrap gap-x-2 text-indigo-900">
                <span className="truncate">{m.name ?? '-'}</span>
                <span className="text-indigo-700">{kdate(new Date(m.start), 'date')}</span>
                <span className="tabular-nums">{m.meanBefore} <span className="text-gray-400">(n={m.nBefore})</span> → {m.meanAfter} <span className="text-gray-400">(n={m.nAfter})</span></span>
              </li>
            ))}
          </ul>
          {(a.medEffectsMore ?? 0) > 0 && <p className="mt-0.5 text-[10px] text-indigo-700"><Tf k="외 {수}건(약마다 첫 시작 기준 · 시작 순)" params={{ 수: a.medEffectsMore }} /></p>}
        </div>
      )}
    </article>
  );
}
