'use client';

/**
 * AI 감독 관제 — 표시 부품.
 *
 * 🔴 `page.tsx` 는 App Router 가 **정해진 export 만** 허용한다(`default`·`metadata` …).
 *    부품을 거기 두고 export 하면 `next build` 가 실패한다(2026-08-18 실측: tsc·vitest 는 통과했다).
 *    그래서 화면 부품·타입은 이 파일에 두고 페이지는 default 하나만 낸다.
 *
 * 🔴 이 화면의 규칙: **모르는 것을 값으로 그리지 않는다.**
 *    · 비율은 `<Ratio numerator denominator />` — 분모 0/미상이면 정본이 '산출 불가'를 그린다
 *      (문구를 화면이 손으로 적지 않는다 — 적으면 규칙이 갈라진다).
 *    · 분포는 표본이 모자라면 값 자리에 사유를 쓴다(`p90=0초` 로 접지 않는다).
 *    · 승인 건수는 수정 있음/없음/**미측정** 셋으로 나눠 그린다(null 을 0 에 합치지 않는다).
 */

import React, { type ReactNode } from 'react';
import { RATIO_UNAVAILABLE } from '@hospital-run/shared';
import { Ratio, EmptyState, Unknown } from '@/components/ui/display';
import { T, Tf, useTfAttr } from '@/components/ui/i18n-text';

/* ═══════════════════ 서버 계약 ═══════════════════ */

export interface RateValue {
  numerator: number | null;
  denominator: number | null;
  pct: number | null;
  unavailableReason: 'NO_DENOMINATOR' | 'ZERO_DENOMINATOR' | 'NO_NUMERATOR' | null;
  denominatorLabel: string;
}

export interface DeciderLabel {
  name: string;
  department: string;
}

export interface AxisRow {
  key: string | null;
  label: DeciderLabel | null;
  total: number;
  byStatus: Record<string, number>;
  decided?: number;
  acceptedRate?: RateValue;
  rejectedRate?: RateValue;
}

export interface QuickAcceptItem {
  proposalId: string;
  kind: string;
  modelRef: string | null;
  decidedBy: string | null;
  seconds: number | null;
  editDistance: number | null;
}

export interface ReviewTiming {
  sample: number;
  decidedSample: number;
  truncated: boolean;
  p50Sec: number | null;
  p90Sec: number | null;
  minSampleForDistribution: number;
  distributionUnavailableReason: string | null;
  notPresentedDecided: number;
  negativeInterval: number;
  quickAccept: { thresholdSec: number; count: number; items: QuickAcceptItem[] };
}

export interface OversightSummary {
  windowDays: number;
  since: string;
  generatedAt: string;
  filters: {
    kind: string | null;
    modelRef: string | null;
    userId: string | null;
    dept: string | null;
    deptMatchedUsers: number | null;
    deptNote: string | null;
  };
  total: number;
  byStatus: Record<string, number>;
  decided: number;
  rates: { accepted: RateValue; edited: RateValue; rejected: RateValue; expired: RateValue };
  accepted: { total: number; withEdits: number; unedited: number; editUnmeasured: number };
  byKind: AxisRow[];
  byModelRef: AxisRow[];
  byDecider: AxisRow[];
  review: ReviewTiming;
  note: string;
}

export interface QuickAcceptPolicy {
  seconds: number;
  configured: boolean;
  note: string;
}

export interface CallsResult {
  windowDays: number;
  distribution: {
    sample: number;
    rows: { skill: string; requestedModel: string | null; modelRef: string | null; calls: number; ok: number; failed: number; unknownStatus: number; mismatch: boolean }[];
    byStatusClass: { label: string; calls: number }[];
    note: string;
  };
  latency: {
    sample: number;
    p50Ms: number | null;
    p90Ms: number | null;
    minSampleForDistribution: number;
    unavailableReason: string | null;
  };
}

/* ═══════════════════ 부품 ═══════════════════ */

const CARD = 'rounded-2xl border border-gray-100 bg-white p-4 shadow-sm';

/**
 * 비율 카드 — 🔴 **분모를 값과 함께** 그린다.
 * 표본이 없으면 `<Ratio>` 가 정본 문구를 내고, 왜 못 세는지는 `hint` 로 아래 줄에 붙는다.
 */
export function RateCard({ title, rate, hint }: { title: string; rate: RateValue | undefined; hint?: string }) {
  return (
    <div className={CARD} data-testid={`rate-${title}`}>
      <p className="text-[11px] font-medium text-gray-500"><T k={title} /></p>
      <p className="mt-1 text-xl font-bold text-gray-900">
        {rate ? (
          <Ratio numerator={rate.numerator} denominator={rate.denominator} unavailableHint={hint ?? '표본 0'} />
        ) : (
          <Unknown kind="PENDING" />
        )}
      </p>
      {/* 🔴 분모가 무엇인지 적는다 — 축마다 분모가 다른데 이름이 없으면 같은 것으로 읽힌다 */}
      {/* 분모 이름(`denominatorLabel`)은 서버가 정한 문자열이라 번역하지 않고 그대로 끼운다 */}
      <p className="mt-1 text-[10px] leading-tight text-gray-400"><Tf k="분모: {분모}" params={{ 분모: rate?.denominatorLabel ?? '-' }} /></p>
    </div>
  );
}

/** 단순 계수 카드 — 값은 사실이고, 그 값이 무슨 뜻인지 한 줄로 말한다 */
/**
 * `title`·문자열 `subtitle` 은 **한국어 원문 키**로 받아 여기서 `<T>` 로 그린다.
 * 숫자가 낀 부제는 호출부가 `<Tf>` 노드로 넘긴다(조각으로 쪼개지 않게).
 */
export function CountCard({ title, value, subtitle, tone = 'slate' }: { title: string; value: number | null; subtitle?: ReactNode; tone?: 'slate' | 'amber' | 'rose' }) {
  const cls = tone === 'amber' ? 'text-amber-700' : tone === 'rose' ? 'text-rose-700' : 'text-gray-900';
  return (
    <div className={CARD}>
      <p className="text-[11px] font-medium text-gray-500"><T k={title} /></p>
      <p className={`mt-1 text-xl font-bold ${cls}`}>{value == null ? <Unknown kind="UNRECORDED" /> : value}</p>
      {subtitle && <p className="mt-1 text-[10px] leading-tight text-gray-400">{typeof subtitle === 'string' ? <T k={subtitle} /> : subtitle}</p>}
    </div>
  );
}

/**
 * 검토 소요시간 — 🔴 표본이 모자라면 **값 자리에 사유**를 쓴다.
 *    `p90 = 0초` 는 "빨리 검토했다"로 읽히지만 사실은 "재지 못했다"이다.
 */
export function ReviewTimingPanel({ review }: { review: ReviewTiming }) {
  const unavailable = review.distributionUnavailableReason;
  return (
    <div className={CARD} data-testid="review-timing">
      <h3 className="text-sm font-bold text-gray-900"><T k="검토 소요시간 (노출 → 결정)" /></h3>
      {unavailable ? (
        <p className="mt-2 text-xs text-gray-500" data-testid="review-unavailable">
          {unavailable}
        </p>
      ) : (
        <div className="mt-2 flex gap-6">
          <div>
            <p className="text-lg font-bold text-gray-900"><Tf k="{초}초" params={{ 초: review.p50Sec ?? '' }} /></p>
            <p className="text-[10px] text-gray-400">p50</p>
          </div>
          <div>
            <p className="text-lg font-bold text-gray-900"><Tf k="{초}초" params={{ 초: review.p90Sec ?? '' }} /></p>
            <p className="text-[10px] text-gray-400">p90</p>
          </div>
        </div>
      )}
      <dl className="mt-3 space-y-1 text-[11px] text-gray-500">
        <div className="flex justify-between gap-2">
          <dt><T k="잴 수 있었던 건 / 결정된 건" /></dt>
          <dd className="font-mono text-gray-700">
            {review.sample} / {review.decidedSample}
          </dd>
        </div>
        {/* 🔴 노출 기록 없이 결정된 건 — "0초 검토"가 아니라 못 잰 건이다 */}
        <div className="flex justify-between gap-2">
          <dt><T k="노출 기록 없이 결정(측정 불가)" /></dt>
          <dd className="font-mono text-gray-700">{review.notPresentedDecided}</dd>
        </div>
        {review.negativeInterval > 0 && (
          <div className="flex justify-between gap-2 text-amber-700">
            <dt><T k="결정이 노출보다 앞선 건(시각 어긋남)" /></dt>
            <dd className="font-mono">{review.negativeInterval}</dd>
          </div>
        )}
        {review.truncated && <p className="text-amber-700"><T k="표본을 상한까지만 훑었습니다 — 이 분포는 전건이 아닙니다." /></p>}
      </dl>
    </div>
  );
}

/**
 * 무검토 승인 의심 — 🔴 **임계가 어디서 왔는지**를 같은 자리에 적는다.
 *    코드 기본값을 원내 정책인 척하지 않는다.
 */
export function QuickAcceptPanel({ review, policy }: { review: ReviewTiming; policy?: QuickAcceptPolicy }) {
  // EmptyState 의 title 은 문자열 prop 이라 보간 문장은 여기서 문자열로 만들어 넘긴다
  const tfAttr = useTfAttr();
  return (
    <div className={CARD} data-testid="quick-accept">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-bold text-gray-900"><T k="무검토 승인 의심" /></h3>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
          <Tf k="{초}초 미만 승인" params={{ 초: review.quickAccept.thresholdSec }} />
        </span>
      </div>
      {policy && (
        <p className={`mt-1 text-[10px] leading-tight ${policy.configured ? 'text-gray-400' : 'text-amber-700'}`} data-testid="quick-accept-policy">
          {policy.note}
        </p>
      )}
      {review.sample === 0 ? (
        // 🔴 잴 수 있는 건이 없으면 "의심 0건"이라 말하지 않는다 — 판정 자체가 불가능했다
        <EmptyState
          icon="⏱"
          title="검토 소요를 잴 수 있는 건이 없습니다"
          hint="노출(presented) 기록이 있는 결정 건이 있어야 판정할 수 있습니다 — '의심 0건'이 아닙니다"
          compact
        />
      ) : review.quickAccept.items.length === 0 ? (
        <EmptyState icon="✓" title={<Tf k="{수}건을 봤고 임계 미만 승인은 없었습니다" params={{ 수: review.sample }} />} compact />
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="text-gray-400">
              <tr>
                <th className="py-1 pr-3 font-medium"><T k="소요" /></th>
                <th className="py-1 pr-3 font-medium"><T k="종류" /></th>
                <th className="py-1 pr-3 font-medium"><T k="모델" /></th>
                <th className="py-1 font-medium"><T k="수정량" /></th>
              </tr>
            </thead>
            <tbody>
              {review.quickAccept.items.map((q) => (
                <tr key={q.proposalId} className="border-t border-gray-50">
                  <td className="py-1 pr-3 font-mono font-bold text-amber-700"><Tf k="{초}초" params={{ 초: q.seconds ?? '' }} /></td>
                  <td className="py-1 pr-3 text-gray-700">{q.kind}</td>
                  <td className="py-1 pr-3 font-mono text-gray-500">{q.modelRef ?? <Unknown kind="UNRECORDED" />}</td>
                  {/* 🔴 편집거리 null = 재지 않았다(0 이 아니다) */}
                  <td className="py-1 font-mono text-gray-500" data-testid={`quick-edit-${q.proposalId}`}>
                    {q.editDistance == null ? <Unknown kind="UNRECORDED" /> : q.editDistance}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** 축 표(kind·모델·결정자) — 비율에는 분모가 붙는다 */
export function AxisTable({ title, rows, emptyHint }: { title: string; rows: AxisRow[]; emptyHint: string }) {
  return (
    <div className={CARD}>
      <h3 className="text-sm font-bold text-gray-900"><T k={title} /></h3>
      {rows.length === 0 ? (
        <EmptyState icon="—" title="이 기간에 기록된 제안이 없습니다" hint={emptyHint} compact />
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="text-gray-400">
              <tr>
                <th className="py-1 pr-3 font-medium"><T k="구분" /></th>
                <th className="py-1 pr-3 font-medium"><T k="제안" /></th>
                <th className="py-1 pr-3 font-medium"><T k="수용률" /></th>
                <th className="py-1 font-medium"><T k="거부율" /></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key ?? '(미상)'} className="border-t border-gray-50">
                  <td className="py-1 pr-3 text-gray-700">
                    {r.label ? (
                      <>
                        {r.label.name}
                        <span className="ml-1 text-[10px] text-gray-400">{r.label.department}</span>
                      </>
                    ) : (
                      // 🔴 모델 태그가 없는 건은 '(미상)' — 상류가 안 알려준 것이지 "모델 없음"이 아니다
                      (r.key ?? <Unknown kind="UNRECORDED" />)
                    )}
                  </td>
                  <td className="py-1 pr-3 font-mono text-gray-700">{r.total}</td>
                  <td className="py-1 pr-3">
                    <Ratio numerator={r.acceptedRate?.numerator} denominator={r.acceptedRate?.denominator} unavailableHint="결정된 건 없음" />
                  </td>
                  <td className="py-1">
                    <Ratio numerator={r.rejectedRate?.numerator} denominator={r.rejectedRate?.denominator} unavailableHint="결정된 건 없음" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** 상태 분포 — 전 상태를 0 까지 그린다(키가 없는 것과 0 은 다르게 보인다) */
export function StatusBar({ byStatus, total }: { byStatus: Record<string, number>; total: number }) {
  const entries = Object.entries(byStatus);
  return (
    <div className={CARD} data-testid="status-dist">
      <h3 className="text-sm font-bold text-gray-900">
        <T k="상태 분포" /> <span className="ml-1 text-[11px] font-normal text-gray-400"><Tf k="전체 {수}건" params={{ 수: total }} /></span>
      </h3>
      {/* 🔴 `items-baseline` 을 쓰지 않는다 — 값·라벨 가로 배치는 기준선 동결 대상이고(2026-09-03
          라벨이 지워진 사고), 여기서는 정렬이 미관일 뿐이라 기준선을 건드릴 이유가 없다 */}
      <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
        {entries.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between border-b border-gray-50 py-1 text-[11px]">
            <span className="text-gray-500">{k}</span>
            <span className={`font-mono font-bold ${v > 0 ? 'text-gray-900' : 'text-gray-300'}`}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 호출 분포 — 정본(call-stats) 위임분 + 지연 분포 */
export function CallsPanel({ calls }: { calls: CallsResult }) {
  const tfAttr = useTfAttr();
  return (
    <div className={CARD} data-testid="calls-panel">
      <h3 className="text-sm font-bold text-gray-900">
        <T k="AI 호출 분포" /> <span className="ml-1 text-[11px] font-normal text-gray-400"><Tf k="표본 {수}건" params={{ 수: calls.distribution.sample }} /></span>
      </h3>
      <div className="mt-2 flex flex-wrap gap-6 text-[11px]">
        <div>
          <p className="text-lg font-bold text-gray-900">
            {/* 🔴 표본 부족이면 사유를 쓴다 — 0ms 로 접지 않는다 */}
            {calls.latency.p50Ms == null ? <span className="text-xs font-normal text-gray-500">{calls.latency.unavailableReason}</span> : `${calls.latency.p50Ms}ms`}
          </p>
          <p className="text-[10px] text-gray-400"><Tf k="지연 p50 (기록된 {수}건)" params={{ 수: calls.latency.sample }} /></p>
        </div>
        {calls.latency.p90Ms != null && (
          <div>
            <p className="text-lg font-bold text-gray-900">{calls.latency.p90Ms}ms</p>
            <p className="text-[10px] text-gray-400"><T k="지연 p90" /></p>
          </div>
        )}
      </div>
      {calls.distribution.rows.length === 0 ? (
        <EmptyState icon="—" title="이 기간에 기록된 AI 호출이 없습니다" hint="원장은 aiEgressFetch 를 지난 호출만 담습니다" compact />
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="text-gray-400">
              <tr>
                <th className="py-1 pr-3 font-medium"><T k="스킬" /></th>
                <th className="py-1 pr-3 font-medium"><T k="모델(상류 보고)" /></th>
                <th className="py-1 pr-3 font-medium"><T k="호출@AI" /></th>
                <th className="py-1 pr-3 font-medium"><T k="성공" /></th>
                <th className="py-1 font-medium"><T k="실패" /></th>
              </tr>
            </thead>
            <tbody>
              {calls.distribution.rows.map((r, i) => (
                <tr key={`${r.skill}-${r.modelRef}-${i}`} className="border-t border-gray-50">
                  <td className="py-1 pr-3 text-gray-700">{r.skill}</td>
                  <td className="py-1 pr-3 font-mono text-gray-500">
                    {r.modelRef ?? <Unknown kind="UNRECORDED" />}
                    {r.mismatch && <span className="ml-1 text-amber-700" title={tfAttr('요청 {모델}', { 모델: String(r.requestedModel) })}><T k="≠요청" /></span>}
                  </td>
                  <td className="py-1 pr-3 font-mono text-gray-700">{r.calls}</td>
                  <td className="py-1 pr-3 font-mono text-emerald-700">{r.ok}</td>
                  <td className="py-1 font-mono text-rose-700">{r.failed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-[10px] leading-tight text-gray-400">{calls.distribution.note}</p>
      <div className="mt-1 flex flex-wrap gap-2 text-[10px] text-gray-500">
        {calls.distribution.byStatusClass.map((s) => (
          <span key={s.label} className="rounded bg-gray-50 px-1.5 py-0.5">
            {s.label} {s.calls}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════ 스크라이브 초안 ↔ 확정 수정량 ═══════════════════ */

/** 서버 계약 — `GET /api/v1/admin/ai-oversight/scribe-edits` (집계만 · 환자·본문 없음) */
export interface EditDistribution {
  drafted: number;
  capped: number;
  measured: number;
  medianPct: number | null;
  p90Pct: number | null;
  minSampleForDistribution: number;
  /** 코드만 온다 — 문장은 화면이 조립한다 */
  distributionUnavailableReason: 'NO_SAMPLE' | 'BELOW_MIN_SAMPLE' | null;
  unchanged: RateValue;
}

export type ScribeSoapField = 'subjective' | 'objective' | 'assessment' | 'plan';

export interface ScribeEditStats {
  windowDays: number;
  truncated: boolean;
  funnel: {
    signedScribed: number;
    notCurrentlySigned: number;
    amendedAfterSign: number;
    eligible: number;
    noDraftSnapshot: number;
    capped: number;
    measured: number;
  };
  overall: EditDistribution;
  sections: Record<ScribeSoapField, EditDistribution>;
  draftedWithoutApply: number;
}

// 라벨은 렌더 지점에서 바로 `<T>` 로 — 문자열 표로 들고 다니면 번역 층을 지나는지 스캐너가 확인하지 못한다
const SECTION_ROWS: { key: ScribeSoapField; label: ReactNode }[] = [
  { key: 'subjective', label: <T k="S 주관" /> },
  { key: 'objective', label: <T k="O 객관" /> },
  { key: 'assessment', label: <T k="A 평가" /> },
  { key: 'plan', label: <T k="P 계획" /> },
];

/** 🔴 표본이 모자라면 값 자리에 사유 — `0%` 로 접지 않는다 */
function PctOrReason({ value, d }: { value: number | null; d: EditDistribution }) {
  if (value != null) return <span className="font-mono text-gray-800">{value}%</span>;
  return (
    <span className="text-[10px] text-gray-400">
      {/* 표본 0 의 문구는 정본(`RATIO_UNAVAILABLE`) 하나 — 화면이 '산출 불가'를 자체로 적지 않는다 */}
      {d.measured === 0 ? <T k={RATIO_UNAVAILABLE} /> : <Tf k="표본 {수}건 — 최소 {최소}건 미만" params={{ 수: d.measured, 최소: d.minSampleForDistribution }} />}
    </span>
  );
}

/**
 * 스크라이브 초안 ↔ 서명 진료기록 수정량 — 🔴 분모를 단계별로 보이고, 표본 부재를 0% 로 그리지 않는다.
 * 정의·한계는 서버 정본(`scribe-edit-measure.ts`)과 같은 내용을 화면 언어로 그린다.
 */
export function ScribeEditPanel({ stats }: { stats: ScribeEditStats }) {
  const f = stats.funnel;
  const rows: { key: string; label: ReactNode; d: EditDistribution }[] = [
    { key: 'overall', label: <T k="전체" />, d: stats.overall },
    ...SECTION_ROWS.map((r) => ({ key: r.key, label: r.label, d: stats.sections[r.key] })),
  ];
  return (
    <div className={CARD} data-testid="scribe-edit-panel">
      <h3 className="text-sm font-bold text-gray-900">
        <T k="스크라이브 초안 ↔ 확정 수정량" />{' '}
        <span className="ml-1 text-[11px] font-normal text-gray-400"><Tf k="측정 {수}건" params={{ 수: f.measured }} /></span>
      </h3>
      {/* 🔴 어디서 빠졌는지를 숫자로 — 조용히 빼지 않는다 */}
      <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-gray-600">
        <span className="rounded bg-gray-50 px-1.5 py-0.5"><Tf k="서명된 스크라이브 진료 {수}" params={{ 수: f.signedScribed }} /></span>
        <span className="rounded bg-gray-50 px-1.5 py-0.5"><Tf k="정정 중 제외 {수}" params={{ 수: f.notCurrentlySigned }} /></span>
        <span className="rounded bg-gray-50 px-1.5 py-0.5"><Tf k="서명 후 정정 제외 {수}" params={{ 수: f.amendedAfterSign }} /></span>
        <span className="rounded bg-gray-50 px-1.5 py-0.5"><Tf k="초안 스냅샷 없음 {수}" params={{ 수: f.noDraftSnapshot }} /></span>
        <span className="rounded bg-gray-50 px-1.5 py-0.5"><Tf k="상한 초과 {수}" params={{ 수: f.capped }} /></span>
        <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800"><Tf k="녹음 초안 반영 기록 없음 {수}" params={{ 수: stats.draftedWithoutApply }} /></span>
        {stats.truncated && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800"><T k="조회 상한에서 잘림" /></span>}
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-left text-[11px]">
          <thead className="text-gray-400">
            <tr>
              <th className="py-1 pr-3 font-medium"><T k="범위" /></th>
              <th className="py-1 pr-3 font-medium"><T k="초안 있음" /></th>
              <th className="py-1 pr-3 font-medium"><T k="측정" /></th>
              <th className="py-1 pr-3 font-medium"><T k="수정량 중앙값" /></th>
              <th className="py-1 pr-3 font-medium"><T k="수정량 p90" /></th>
              <th className="py-1 font-medium"><T k="무수정 서명" /></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-gray-50">
                <td className="py-1 pr-3 text-gray-700">{r.label}</td>
                <td className="py-1 pr-3 font-mono text-gray-700">{r.d.drafted}</td>
                <td className="py-1 pr-3 font-mono text-gray-700">{r.d.measured}</td>
                <td className="py-1 pr-3"><PctOrReason value={r.d.medianPct} d={r.d} /></td>
                <td className="py-1 pr-3"><PctOrReason value={r.d.p90Pct} d={r.d} /></td>
                <td className="py-1"><Ratio numerator={r.d.unchanged.numerator} denominator={r.d.unchanged.denominator} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[10px] leading-tight text-gray-400">
        <T k="수정량 = 문자 단위 편집거리 ÷ 초안·확정 중 긴 쪽 길이. 0% 는 초안 그대로 서명, 초안 섹션을 지우면 100%. 상한을 넘는 글은 재지 않고 따로 셉니다." />
      </p>
      <p className="mt-1 text-[10px] leading-tight text-gray-400">
        <T k="한계: 반영 전 의사가 직접 쓴 글도 수정량에 들어가 값이 높은 쪽으로 치우칩니다. 서명 후 정정한 기록은 처음 확정본이 남지 않아 뺐습니다." />
      </p>
    </div>
  );
}
