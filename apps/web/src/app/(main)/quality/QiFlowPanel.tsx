'use client';

/**
 * 질 지표 한 행의 흐름 패널(QI-FLOW-001 · 2026-10-08) — 측정 → 분석 → 판정 → 개선 → 위원회.
 *
 *  · 자동 산출 미리보기 — 공급원이 원장에서 다시 센 분자·분모. 🔴 산출 불가면 이유를 그대로(0 으로 접지 않는다).
 *    결정 전(분모·기구일수 원천)은 "결정 전"이라고 말하고, 분자만 대조 근거로 보여준다.
 *  · 관리도 — 지표 종류대로 p/u(서버가 고른다) · 신호는 원인을 찾을 자리이지 결함 판정이 아니다
 *  · 목표는 화면이 바꾸지 않는다 — 위원회(QPS)에 후보 + "정하지 않음"을 안건으로 올린다(의결되면 엔진이 반영)
 *  · 개선 활동(PDCA) — 공급원이 있으면 서버가 다시 세고, 없으면 사람이 센 수(출처 '수기')
 */
import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  formatNum, QI_MEASUREMENT_SOURCE_LABEL, RATIO_UNAVAILABLE, QI_SUPPLY_UNAVAILABLE_TEXT, QI_SUPPLIERS,
  type PChart, type QiMeasurementSource, type QiSupplierKey,
} from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/error-utils';
import { toast } from '@/stores/toast-store';
import { useHasRole } from '@/hooks/use-admin-write';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { ImprovementCreateForm, ImprovementsSection } from '../orders/QualityImprovements';
import type { QiIndicator } from './quality-types';

/** 지난달(로컬) — 끝난 달만 산출·마감한다 */
export function lastClosedPeriod(now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function SourceBadge({ source }: { source: string | null | undefined }) {
  if (!source) return <span className="rounded bg-gray-100 px-1.5 text-[10px] text-gray-500" data-qi-source="UNKNOWN"><T k="출처 기록 없음" /></span>;
  const label = QI_MEASUREMENT_SOURCE_LABEL[source as QiMeasurementSource] ?? source;
  const tone = source === 'AUTO' || source === 'CPOE' ? 'bg-sky-50 text-sky-700' : source === 'SEED' ? 'bg-gray-100 text-gray-500' : 'bg-amber-50 text-amber-700';
  return <span className={`rounded px-1.5 text-[10px] ${tone}`} data-qi-source={source}><T k={label} /></span>;
}

/** 측정값 표시 — 분자/분모 × 배율(정본 반올림 formatNum) */
export function scaled(numerator: number, denominator: number, scale: number): string | null {
  return denominator > 0 ? formatNum((numerator / denominator) * scale, 'qiValue') : null;
}

interface Preview {
  indicator: { id: string; name: string; supplierKey: QiSupplierKey | null; unit: string | null; valueScale: number };
  period: string;
  supply:
    | { available: true; supplierKey: QiSupplierKey; numerator: number; denominator: number; evidence: Record<string, unknown> }
    | { available: false; supplierKey: QiSupplierKey | null; reason: string; numerator: number | null; detail?: Record<string, unknown> };
  ledger: { id: string; source: string | null; sourceKey: string; numerator: number; denominator: number; value: number }[];
  /** 병동 층(분석용 · 판정에 쓰지 않음) */
  strata?: { id: string; wardKey: string; wardName: string | null; source: string | null; numerator: number; denominator: number; value: number }[];
}

function SupplyPreview({ indicator, period }: { indicator: QiIndicator; period: string }) {
  const q = useQuery({
    queryKey: ['qi-flow-preview', indicator.id, period],
    queryFn: () => apiClient.get<{ data: Preview }>(`/api/v1/quality-flow/indicators/${indicator.id}/preview?period=${period}`).then((r) => r.data),
  });
  if (q.isError) return <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} />;
  const p = q.data;
  if (!p) return <div className="h-12 animate-pulse rounded-lg bg-gray-100" />;
  const unit = p.indicator.unit ? ` ${p.indicator.unit}` : '';
  const s = p.supply;
  return (
    <div className="space-y-1.5 text-xs" data-qi-preview={s.available ? 'AVAILABLE' : s.reason}>
      {s.supplierKey && <p className="text-[11px] text-gray-500"><T k="공급원" />: <T k={QI_SUPPLIERS[s.supplierKey].label} /></p>}
      {s.available ? (
        <p className="text-gray-800">
          <T k="원장에서 다시 센 값" />: <b className="tabular-nums">{scaled(s.numerator, s.denominator, p.indicator.valueScale)}{unit}</b>
          <span className="text-gray-500"> ({s.numerator}/{s.denominator})</span>
        </p>
      ) : (
        <p className="text-amber-700" data-qi-unavailable={s.reason}>
          <T k="원장에서 자동으로 셀 수 없음" /> — <T k={QI_SUPPLY_UNAVAILABLE_TEXT[s.reason] ?? s.reason} />
          {s.numerator != null && <span className="ml-1 text-gray-600">(<Tf k="분자만 {n}건 — 대조 근거" params={{ n: s.numerator }} />)</span>}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2" data-qi-ledger-rows>
        <span className="text-[11px] text-gray-500"><Tf k="{기간} 원장" params={{ 기간: period }} />:</span>
        {p.ledger.length === 0
          ? <span className="text-[11px] text-gray-400"><T k="측정 없음" /></span>
          : p.ledger.map((r) => (
            <span key={r.id} className="inline-flex items-center gap-1">
              <SourceBadge source={r.source} />
              <span className="tabular-nums">{formatNum(r.value, 'qiValue')}{unit}</span>
              <span className="text-gray-400">({r.numerator}/{r.denominator})</span>
            </span>
          ))}
      </div>
      {(p.strata ?? []).length > 0 && (
        <div className="text-[11px] text-gray-600" data-qi-strata>
          <span className="text-gray-500"><T k="병동별(분석용 · 판정은 병원 전체)" />:</span>{' '}
          {p.strata!.map((r) => (
            <span key={r.id} className="mr-2 inline-flex items-center gap-1" data-qi-stratum={r.wardKey}>
              {r.wardName ?? r.wardKey} <b className="tabular-nums">{formatNum(r.value, 'qiValue')}{unit}</b> <span className="text-gray-400">({r.numerator}/{r.denominator})</span>
            </span>
          ))}
        </div>
      )}
      {s.available && p.ledger.some((r) => r.sourceKey === 'MANUAL') && (
        <p className="text-[10px] text-gray-500"><T k="수기 값과 원장 재집계가 나란히 남습니다 — 어느 쪽을 정본으로 볼지는 위원회 결정(qi.autoManual.precedence)입니다." /></p>
      )}
    </div>
  );
}

interface Spc {
  indicator: { id: string; name: string; unit: string | null; valueScale: number; target: number; direction: string | null; supplierKey: string | null };
  kind: 'P' | 'U';
  precedence: string;
  sources: { period: string; source: string | null; hasAlternate: boolean }[];
  chart: PChart;
}

function SpcChart({ indicatorId }: { indicatorId: string }) {
  const [months, setMonths] = useState(24);
  const q = useQuery({
    queryKey: ['qi-flow-spc', indicatorId, months],
    queryFn: () => apiClient.get<{ data: Spc }>(`/api/v1/quality-flow/indicators/${indicatorId}/spc?months=${months}`).then((r) => r.data),
  });
  if (q.isError) return <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} />;
  const s = q.data;
  if (!s) return <div className="h-40 animate-pulse rounded-lg bg-gray-100" />;
  const pts = s.chart.points;
  const scale = s.indicator.valueScale;
  const unit = s.indicator.unit ? ` ${s.indicator.unit}` : '';
  const show = (v: number) => `${formatNum(v * scale, 'qiValue')}${unit}`;
  const targetFrac = Number.isFinite(s.indicator.target) && scale > 0 ? s.indicator.target / scale : null;
  const yMax = Math.max(0.000001, ...pts.flatMap((p) => [p.p ?? 0, p.ucl ?? 0]), targetFrac ?? 0) * 1.1;
  const W = 560; const H = 170; const L = 44;
  const x = (i: number) => L + ((W - L - 10) * (pts.length <= 1 ? 0.5 : i / (pts.length - 1)));
  const y = (v: number) => 10 + (H - 30) * (1 - v / yMax);
  const signals = pts.filter((p) => p.signal).length;
  return (
    <section className="space-y-1" data-qi-flow-spc={s.kind}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-bold text-gray-800"><T k={s.kind === 'P' ? '월별 관리도(p 관리도 — 비율)' : '월별 관리도(u 관리도 — 노출 단위당 발생)'} /></p>
        {[12, 24].map((m) => (
          <button key={m} type="button" onClick={() => setMonths(m)} className={`rounded px-2 py-0.5 text-[11px] ${months === m ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>
            <Tf k="{개월}개월" params={{ 개월: m }} />
          </button>
        ))}
      </div>
      {pts.length === 0 ? (
        <p className="text-[11px] text-gray-400" data-qi-spc-empty><T k="측정이 없어 관리도를 그릴 수 없습니다." /></p>
      ) : (
        <>
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-2xl" role="img" aria-label="control chart" data-qi-flow-spc-chart>
            {[0, yMax / 2, yMax].map((v) => (
              <g key={v}><line x1={L} x2={W - 6} y1={y(v)} y2={y(v)} stroke="#f1f5f9" /><text x={2} y={y(v) + 3} fontSize="9" fill="#94a3b8">{formatNum(v * scale, 'qiValue')}</text></g>
            ))}
            {s.chart.center != null && <line x1={L} x2={W - 6} y1={y(s.chart.center)} y2={y(s.chart.center)} stroke="#334155" />}
            {targetFrac != null && <line x1={L} x2={W - 6} y1={y(targetFrac)} y2={y(targetFrac)} stroke="#059669" strokeDasharray="4 3" />}
            {pts.map((p, i) => p.ucl != null && (
              <g key={`l${i}`}>
                <line x1={x(i) - 8} x2={x(i) + 8} y1={y(p.ucl)} y2={y(p.ucl)} stroke="#f43f5e" opacity={0.6} />
                <line x1={x(i) - 8} x2={x(i) + 8} y1={y(p.lcl!)} y2={y(p.lcl!)} stroke="#f43f5e" opacity={0.6} />
              </g>
            ))}
            <polyline fill="none" stroke="#2563eb" strokeWidth={1.5} points={pts.map((p, i) => (p.p == null ? null : `${x(i)},${y(p.p)}`)).filter(Boolean).join(' ')} />
            {pts.map((p, i) => p.p != null && (
              <circle key={`p${i}`} cx={x(i)} cy={y(p.p)} r={p.signal ? 4.5 : 3} fill={p.signal ? '#e11d48' : '#2563eb'} data-qi-spc-point={p.period} data-signal={p.signal ?? ''}>
                <title>{`${p.period} · ${p.numerator}/${p.denominator} · ${show(p.p)}${s.sources[i]?.source ? ` · ${s.sources[i].source}` : ''}`}</title>
              </circle>
            ))}
            {pts.map((p, i) => <text key={`t${i}`} x={x(i)} y={H - 6} fontSize="8" fill="#94a3b8" textAnchor="middle">{p.period.slice(2)}</text>)}
          </svg>
          <div className="flex flex-wrap gap-3 text-[10px] text-gray-500">
            <span>— <T k="중심선(완결된 달 평균)" /> {s.chart.center == null ? <T k={RATIO_UNAVAILABLE} /> : show(s.chart.center)}</span>
            <span className="text-rose-600">— <T k="관리 한계(±3σ · 달마다 표본 수로 다름)" /></span>
            <span className="text-emerald-700">- - <T k="원장 목표" /> {formatNum(s.indicator.target, 'qiValue')}{unit}</span>
          </div>
          {s.chart.degenerate
            ? <p className="text-[11px] text-gray-500"><T k="중심선이 0 이거나 표본이 없어 관리 한계를 그릴 수 없습니다 — 신호를 내지 않습니다." /></p>
            : <p className="text-[11px] text-gray-700" data-qi-flow-spc-signals>
                {signals > 0
                  ? <Tf k="신호 {수}개 — 원인을 찾아볼 자리이지 결함 판정이 아닙니다." params={{ 수: signals }} />
                  : <T k="통계적 신호 없음 — 이것이 목표 달성을 뜻하지는 않습니다." />}
              </p>}
          <p className="text-[10px] text-gray-400"><Tf k="완결된 달 {수}개로 계산 · 같은 달 수기·자동 중 정본은 위원회 결정을 따릅니다" params={{ 수: s.chart.basis.months }} /></p>
        </>
      )}
    </section>
  );
}

function TargetAgendaForm({ indicator, onDone }: { indicator: QiIndicator; onDone: () => void }) {
  const tAttr = useTAttr();
  // 🔴 후보는 빈칸으로 시작한다(현재 목표를 미리 넣으면 "바꾸지 않음"과 구분이 안 된다)
  const [targets, setTargets] = useState(['', '', '']);
  const [note, setNote] = useState('');
  const parsed = useMemo(() => targets.map((t) => t.trim()).filter(Boolean).map(Number), [targets]);
  const valid = parsed.length > 0 && parsed.every((n) => Number.isFinite(n) && n >= 0);
  const submit = useMutation({
    mutationFn: () => apiClient.post(`/api/v1/quality-flow/indicators/${indicator.id}/agenda`, { targets: parsed, ...(note.trim() ? { note: note.trim() } : {}) }),
    onSuccess: () => { toast.success(tAttr('위원회(QPS) 안건으로 올렸습니다 — 의결되면 원장 목표가 바뀝니다.')); onDone(); },
    onError: (e) => toast.error(extractErrorMessage(e) || tAttr('안건을 올리지 못했습니다.')),
  });
  return (
    <section className="space-y-2 rounded-xl border border-indigo-100 bg-indigo-50/40 p-3 text-xs" data-qi-target-agenda={indicator.id}>
      <p className="font-semibold text-indigo-900"><T k="목표 후보를 위원회 안건으로" /></p>
      <p className="text-[11px] text-indigo-800"><T k="이 화면은 목표를 바꾸지 않습니다. 후보(1~3개)와 '정하지 않음'이 선택지로 올라가고, 의결된 값만 원장에 반영됩니다." /></p>
      <div className="flex flex-wrap items-center gap-2">
        {targets.map((t, i) => (
          <input key={i} inputMode="decimal" value={t} onChange={(e) => setTargets(targets.map((x, j) => (j === i ? e.target.value : x)))}
            aria-label={tAttr('목표 후보')} placeholder={tAttr('목표 후보')} className="w-24 rounded-lg border border-gray-200 bg-white px-2 py-1" />
        ))}
        {indicator.unit && <span className="text-gray-500">{indicator.unit}</span>}
      </div>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} aria-label={tAttr('제안 사유')} placeholder={tAttr('제안 사유(선택)')} className="w-full rounded-lg border border-gray-200 bg-white px-2 py-1" />
      <button type="button" disabled={!valid || submit.isPending} onClick={() => submit.mutate()} data-qi-target-agenda-submit
        className="min-h-[44px] rounded-lg bg-indigo-600 px-4 font-semibold text-white disabled:opacity-40">
        <T k="안건 올리기" />
      </button>
    </section>
  );
}

export default function QiFlowPanel({ indicator }: { indicator: QiIndicator }) {
  const [period, setPeriod] = useState(lastClosedPeriod());
  // 고르기 전엔 아무것도 부르지 않는다(측정 패널을 열 때마다 조회가 따라 나가지 않게)
  const [tab, setTab] = useState<'preview' | 'spc' | 'agenda' | 'pdca' | null>(null);
  const [creating, setCreating] = useState(false);
  // 개선 활동 목록 EP 는 관리자·의사(서버 @Roles) — 시작은 관리자
  const canPdca = useHasRole('DOCTOR');
  const canStart = useHasRole();
  const preview = useQuery({
    enabled: tab === 'pdca',
    queryKey: ['qi-flow-preview', indicator.id, period],
    queryFn: () => apiClient.get<{ data: Preview }>(`/api/v1/quality-flow/indicators/${indicator.id}/preview?period=${period}`).then((r) => r.data),
  });
  type Tab = NonNullable<typeof tab>;
  const tabs: Array<[Tab, string]> = [['preview', '자동 산출'], ['spc', '관리도'], ['agenda', '목표 안건'], ...(canPdca ? [['pdca', '개선 활동'] as [Tab, string]] : [])];
  const now = new Date();
  const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return (
    <div className="mt-3 space-y-2 rounded-xl border border-gray-200 bg-white p-3" data-qi-flow-panel={indicator.id}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] font-semibold text-gray-600"><T k="질관리 흐름" /></span>
        {tabs.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(tab === k ? null : k)} data-qi-flow-tab={k}
            className={`rounded-lg px-2.5 py-1 text-[11px] ${tab === k ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>
            <T k={label} />
          </button>
        ))}
        {(tab === 'preview' || tab === 'pdca') && (
          <input type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} className="ml-auto rounded-lg border border-gray-200 px-2 py-0.5 text-[11px]" aria-label="period" />
        )}
      </div>
      {tab === 'preview' && <SupplyPreview indicator={indicator} period={period} />}
      {tab === 'spc' && <SpcChart indicatorId={indicator.id} />}
      {tab === 'agenda' && <TargetAgendaForm indicator={indicator} onDone={() => setTab('preview')} />}
      {tab === 'pdca' && (
        <div className="space-y-2">
          {canStart && !creating && (
            <button type="button" onClick={() => setCreating(true)} disabled={!preview.data} data-qi-flow-pdca-start
              className="min-h-[44px] rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white disabled:opacity-40">
              <T k="이 지표로 개선 활동 시작" />
            </button>
          )}
          {creating && preview.data && (
            <ImprovementCreateForm indicatorId={indicator.id} indicatorLabel={indicator.name}
              manualCounts={!preview.data.indicator.supplierKey}
              defaultFrom={ymd(new Date(now.getFullYear(), now.getMonth() - 3, 1))} defaultTo={ymd(new Date(now.getFullYear(), now.getMonth(), 0))}
              onClose={() => setCreating(false)} />
          )}
          <ImprovementsSection indicatorId={indicator.id} />
        </div>
      )}
    </div>
  );
}
