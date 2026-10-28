'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ORDER_STAGE_LABEL, type OrderStageKey } from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { kdate } from '@/lib/ui-settings';
import { Duration, EmptyState, Ratio } from '@/components/ui/display';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

/** 서버 `journey/clinical-lens.ts` 계약 — 단계 어휘·라벨은 shared 정본(오더 실시간 추적과 같은 표) */
type StageKey = OrderStageKey;
interface Sampled { value: number | null; n: number }
interface LensOrder {
  id: string; department: string; name: string | null; status: string; priority: string;
  stages: { key: StageKey; at: string | null }[];
  orderToResultMin: number | null; resultToAckMin: number | null;
  critical: boolean; abnormal: boolean; unacknowledged: boolean; waitingSinceMin: number | null; collectedSameAsReceived: boolean;
  collectionSource?: string | null; collectionToReceiptMin?: number | null;
}
interface LensRx {
  id: string; type: string; name: string | null; status: string; priority: string; createdAt: string;
  dosage: string | null; frequency: string | null;
  dosing: { state: 'DOSING' | 'ENDED' | 'UNKNOWN'; endsAt: string | null };
  orderSource: string; verbal: { readBackAt: string | null; cosignedAt: string | null } | null;
  dur: { checked: boolean; overridden: boolean; warnings: number };
  discontinuedAt: string | null; discontinueReason: string | null; renewedFromId: string | null; dischargeMed: boolean;
  mar: { total: number; administered: number; held: number; refused: number; missed: number; pastDueUnrecorded: number; delayMedianMin: Sampled };
}
interface LensCritical { id: string; testName: string; value: string; unit: string; status: string; notifiedAt: string; acknowledgedAt: string | null; actedAt: string | null; escalatedAt: string | null; closedAt: string | null; toAckMin: number | null }
interface ClinicalLens {
  period: { from: string; to: string };
  orders: LensOrder[]; prescriptions: LensRx[]; criticals: LensCritical[];
  truncated: { orders: boolean; prescriptions: boolean; criticals: boolean };
  quality: {
    resultAck: { numerator: number; denominator: number }; resultToAckMin: Sampled;
    orderToResultMin: { LAB: Sampled; IMAGING: Sampled };
    awaitingReceipt: { n: number; oldestMin: number | null };
    specimenCollection?: { numerator: number; denominator: number }; collectionToReceiptMin?: Sampled;
    critical: { total: number; unacknowledged: number; toAckMin: Sampled };
    verbal: { total: number; uncosigned: number };
    dur: { medications: number; checked: number; overridden: number };
    mar: { scheduledPast: number; recorded: number; pastDueUnrecorded: number; delayMin: Sampled };
    discontinued: number; renewed: number;
  };
}

const STAGE_LABEL = ORDER_STAGE_LABEL;
const DEPT_LABEL: Record<string, { label: string; tone: string }> = {
  LAB: { label: '검사', tone: 'bg-teal-50 text-teal-700' },
  IMAGING: { label: '영상', tone: 'bg-indigo-50 text-indigo-700' },
  PHARMACY: { label: '약제', tone: 'bg-amber-50 text-amber-800' },
  THERAPY: { label: '치료', tone: 'bg-fuchsia-50 text-fuchsia-700' },
};
const RANGES = [{ days: 30, label: '30일' }, { days: 90, label: '90일' }, { days: 365, label: '1년' }] as const;

/**
 * 의료진 관점 여정(2026-10-01 사람 요청) — 환자 경로(접수·입원·퇴원)가 아니라 **의료진이 확인하는 처방·오더·질관리**의 흐름.
 *  · 상단: 질관리 점검 — 수·분모·중앙값(표본 수) · "지연" 같은 판정 임계는 원내 정책이라 두지 않는다
 *  · 오더 한 건마다 단계 줄(발행→접수→…→의사 확인) · 단계 시각이 없으면 빈 점(기록 없음)
 *  · 처방: 투여 상태·DUR·구두 처방 사후 확인·투약 기록(예정 대비)·중단/갱신
 *  · 위급값: 알림 → 확인 → 조치 → 종결
 *  · 정본은 도메인 원장(오더·결과·조제·투약·위급값) — 여정 사건이 아니다
 */
export function ClinicalLensView({ patientId }: { patientId: string }) {
  const tAttr = useTAttr();
  const [days, setDays] = useState<number>(90);
  const [dept, setDept] = useState<string>('ALL');
  const [onlyOpen, setOnlyOpen] = useState(false);
  const from = useMemo(() => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10), [days]);
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['clinical-lens', patientId, days],
    queryFn: () => apiClient.get<{ data: ClinicalLens }>(`/api/v1/journey/${patientId}/clinical-lens`, { from }),
  });
  const r = data?.data;
  const orders = useMemo(() => (r?.orders ?? []).filter((o) =>
    (dept === 'ALL' || o.department === dept) && (!onlyOpen || o.unacknowledged || o.waitingSinceMin != null)), [r, dept, onlyOpen]);

  return (
    <section className="space-y-4" aria-label={tAttr('진료 관점 여정')} data-clinical-lens>
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg bg-gray-100 p-0.5" role="group" aria-label={tAttr('조회 기간')}>
          {RANGES.map((x) => (
            <button key={x.days} type="button" aria-pressed={days === x.days} onClick={() => setDays(x.days)}
              className={`rounded-md px-3 py-1 text-xs ${days === x.days ? 'bg-white font-semibold text-gray-900 shadow-sm' : 'text-gray-500'}`}>
              <T k={x.label} />
            </button>
          ))}
        </div>
        <span className="text-[11px] text-gray-400"><T k="정본: 오더·결과·조제·투약·위급값 원장(발행 시각 기준 기간)" /></span>
      </div>

      {isLoading ? (
        <div className="grid gap-2 md:grid-cols-4" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-gray-100" />)}</div>
      ) : isError ? (
        <QueryErrorFallback error={error} onRetry={() => refetch()} />
      ) : !r ? null : (
        <>
          <QualityGrid q={r.quality} />

          {/* 오더 */}
          <section className="rounded-2xl border border-gray-100 bg-white p-4">
            <header className="mb-3 flex flex-wrap items-center gap-2">
              <h4 className="text-sm font-semibold text-gray-900"><T k="오더 단계" /> <span className="font-normal text-gray-400">({r.orders.length})</span></h4>
              <div className="flex flex-wrap gap-1">
                {['ALL', 'LAB', 'IMAGING', 'PHARMACY', 'THERAPY'].map((d) => (
                  <button key={d} type="button" aria-pressed={dept === d} onClick={() => setDept(d)}
                    className={`rounded-full border px-2.5 py-0.5 text-[11px] ${dept === d ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-600'}`}>
                    {d === 'ALL' ? <T k="전체" /> : <T k={DEPT_LABEL[d].label} />}
                  </button>
                ))}
              </div>
              <label className="ml-auto flex items-center gap-1 text-[11px] text-gray-600">
                <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
                <T k="미확인·접수 대기만" />
              </label>
            </header>
            {r.truncated.orders && <p className="mb-2 text-[11px] text-amber-700"><T k="조회 상한에 걸려 최근 오더만 보입니다 — 기간을 좁혀 보세요" /></p>}
            {orders.length === 0 ? (
              <EmptyState compact title="이 조건에 맞는 오더가 없습니다" />
            ) : (
              <ol className="divide-y divide-gray-50">
                {orders.map((o) => <OrderRow key={o.id} o={o} />)}
              </ol>
            )}
            {r.orders.some((o) => o.collectedSameAsReceived) && (
              <p className="mt-2 text-[10px] text-gray-400"><T k="채취 기록이 없는 과거 검사는 검사실 접수 순간이 '채취'로 찍혀 있습니다(2026-10-01 이전 경로)" /></p>
            )}
          </section>

          {/* 처방 */}
          <section className="rounded-2xl border border-gray-100 bg-white p-4">
            <h4 className="mb-3 text-sm font-semibold text-gray-900"><T k="처방·투약" /> <span className="font-normal text-gray-400">({r.prescriptions.length})</span></h4>
            {r.truncated.prescriptions && <p className="mb-2 text-[11px] text-amber-700"><T k="조회 상한에 걸려 최근 처방만 보입니다 — 기간을 좁혀 보세요" /></p>}
            {r.prescriptions.length === 0 ? <EmptyState compact title="이 기간 처방이 없습니다" /> : (
              <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(340px,1fr))]">
                {r.prescriptions.map((p) => <RxCard key={p.id} p={p} />)}
              </div>
            )}
          </section>

          {/* 위급값 */}
          <section className="rounded-2xl border border-gray-100 bg-white p-4">
            <h4 className="mb-3 text-sm font-semibold text-gray-900"><T k="위급값 알림·확인" /> <span className="font-normal text-gray-400">({r.criticals.length})</span></h4>
            {r.criticals.length === 0 ? <EmptyState compact title="이 기간 위급값 알림이 없습니다" /> : (
              <ol className="divide-y divide-gray-50">
                {r.criticals.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-xs">
                    <span className="font-medium text-gray-900">{c.testName}</span>
                    <span className="tabular-nums text-rose-700">{c.value} {c.unit}</span>
                    <Stepper stages={[
                      { label: '알림', at: c.notifiedAt }, ...(c.escalatedAt ? [{ label: '승급', at: c.escalatedAt }] : []),
                      { label: '확인', at: c.acknowledgedAt }, { label: '조치', at: c.actedAt }, { label: '종결', at: c.closedAt },
                    ]} />
                    {c.toAckMin != null && <span className="text-gray-500"><T k="확인까지" /> <Duration minutes={c.toAckMin} /></span>}
                    {!c.acknowledgedAt && <span className="rounded bg-rose-100 px-1.5 text-[10px] font-medium text-rose-700"><T k="미확인" /></span>}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </section>
  );
}

function QCard({ title, children, tone }: { title: string; children: React.ReactNode; tone?: string }) {
  return (
    <div className={`rounded-xl border p-3 ${tone ?? 'border-gray-100 bg-white'}`}>
      <div className="mb-1 text-[11px] font-semibold text-gray-500"><T k={title} /></div>
      <div className="space-y-0.5 text-xs text-gray-700">{children}</div>
    </div>
  );
}
/** 표본 있는 소요 시간 — 음수(예정보다 이른 투약)는 "이른 N분"으로(Duration 은 음수를 그리지 않는다) */
const SampledText = ({ s }: { s: Sampled }) => (s.value == null
  ? <span className="text-gray-400"><T k="표본 없음" /></span>
  : <>{s.value < 0 ? <><T k="이른" /> <Duration minutes={Math.abs(s.value)} /></> : <Duration minutes={s.value} />} <span className="text-gray-400">(n={s.n})</span></>);

function QualityGrid({ q }: { q: ClinicalLens['quality'] }) {
  return (
    <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(200px,1fr))]" data-clinical-quality>
      <QCard title="결과 의사 확인" tone={q.resultAck.denominator - q.resultAck.numerator > 0 ? 'border-amber-200 bg-amber-50/40' : undefined}>
        <div className="text-lg font-bold"><Ratio numerator={q.resultAck.numerator} denominator={q.resultAck.denominator} /></div>
        <div><T k="결과→확인 중앙값" /> <SampledText s={q.resultToAckMin} /></div>
      </QCard>
      <QCard title="오더→결과 중앙값">
        <div><T k="검사" /> <SampledText s={q.orderToResultMin.LAB} /></div>
        <div><T k="영상" /> <SampledText s={q.orderToResultMin.IMAGING} /></div>
      </QCard>
      <QCard title="위급값" tone={q.critical.unacknowledged > 0 ? 'border-rose-200 bg-rose-50/40' : undefined}>
        <div><Tf k="알림 {a}건 · 미확인 {b}건" params={{ a: q.critical.total, b: q.critical.unacknowledged }} /></div>
        <div><T k="알림→확인 중앙값" /> <SampledText s={q.critical.toAckMin} /></div>
      </QCard>
      {q.specimenCollection && (
        <QCard title="검체 채취 기록" tone={q.specimenCollection.denominator - q.specimenCollection.numerator > 0 ? 'border-amber-200 bg-amber-50/40' : undefined}>
          <div><T k="접수된 검사 중" /> <Ratio numerator={q.specimenCollection.numerator} denominator={q.specimenCollection.denominator} /></div>
          {q.collectionToReceiptMin && <div><T k="채취→접수 중앙값" /> <SampledText s={q.collectionToReceiptMin} /></div>}
        </QCard>
      )}
      <QCard title="접수 대기 오더">
        <div><Tf k="{수}건" params={{ 수: q.awaitingReceipt.n }} /></div>
        {q.awaitingReceipt.oldestMin != null && <div><T k="가장 오래" /> <Duration minutes={q.awaitingReceipt.oldestMin} /></div>}
      </QCard>
      <QCard title="구두·전화 처방 사후 확인" tone={q.verbal.uncosigned > 0 ? 'border-amber-200 bg-amber-50/40' : undefined}>
        <div><Tf k="{a}건 중 미확인 {b}건" params={{ a: q.verbal.total, b: q.verbal.uncosigned }} /></div>
      </QCard>
      <QCard title="약물 DUR">
        <div><T k="점검" /> <Ratio numerator={q.dur.checked} denominator={q.dur.medications} /></div>
        <div><Tf k="경고 무시 {수}건" params={{ 수: q.dur.overridden }} /></div>
      </QCard>
      <QCard title="투약 기록(예정 시각이 지난 것)" tone={q.mar.pastDueUnrecorded > 0 ? 'border-amber-200 bg-amber-50/40' : undefined}>
        <div><T k="기록" /> <Ratio numerator={q.mar.recorded} denominator={q.mar.scheduledPast} /></div>
        <div><Tf k="기록 없음 {수}건" params={{ 수: q.mar.pastDueUnrecorded }} /></div>
        <div><T k="예정→투약 중앙값" /> <SampledText s={q.mar.delayMin} /></div>
      </QCard>
      <QCard title="처방 변경">
        <div><Tf k="중단 {a} · 갱신 {b}" params={{ a: q.discontinued, b: q.renewed }} /></div>
      </QCard>
    </div>
  );
}

/** 단계 점 줄 — 시각이 있으면 채운 점 + 시각, 없으면 빈 점(기록 없음) */
function Stepper({ stages }: { stages: { label: string; at: string | null; tone?: string }[] }) {
  return (
    <ol className="flex flex-wrap items-start gap-0">
      {stages.map((s, i) => (
        <li key={`${s.label}-${i}`} className="flex items-start">
          {i > 0 && <span className={`mt-[7px] h-px w-5 ${s.at ? 'bg-gray-300' : 'bg-gray-200'} `} aria-hidden />}
          <span className="flex min-w-[46px] flex-col items-center text-center">
            <span className={`h-3.5 w-3.5 rounded-full border-2 ${s.at ? (s.tone ?? 'border-blue-500 bg-blue-500') : 'border-gray-300 bg-white'}`} aria-hidden />
            <span className={`mt-0.5 text-[10px] ${s.at ? 'text-gray-700' : 'text-gray-400'}`}><T k={s.label} /></span>
            <span className="text-[10px] tabular-nums text-gray-400">{s.at ? kdate(new Date(s.at), 'datetimeShort') : '—'}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function OrderRow({ o }: { o: LensOrder }) {
  const d = DEPT_LABEL[o.department] ?? { label: o.department, tone: 'bg-gray-100 text-gray-600' };
  return (
    <li className="grid gap-2 py-2.5 lg:grid-cols-[minmax(200px,26%)_1fr]" data-lens-order={o.department}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`rounded px-1.5 text-[10px] font-medium ${d.tone}`}><T k={d.label} /></span>
          {o.priority === 'STAT' && <span className="rounded bg-rose-600 px-1.5 text-[10px] font-semibold text-white">STAT</span>}
          {o.critical && <span className="rounded bg-rose-100 px-1.5 text-[10px] font-medium text-rose-700"><T k="위급" /></span>}
          {!o.critical && o.abnormal && <span className="rounded bg-amber-100 px-1.5 text-[10px] font-medium text-amber-800"><T k="이상" /></span>}
          {o.unacknowledged && <span className="rounded border border-amber-300 px-1.5 text-[10px] text-amber-800"><T k="결과 미확인" /></span>}
        </div>
        <div className="mt-0.5 truncate text-sm font-medium text-gray-900" title={o.name ?? undefined}>{o.name ?? <T k="이름 없음" />}</div>
        <div className="text-[11px] text-gray-500">
          {o.orderToResultMin != null && <><T k="결과까지" /> <Duration minutes={o.orderToResultMin} /></>}
          {o.resultToAckMin != null && <> · <T k="확인까지" /> <Duration minutes={o.resultToAckMin} /></>}
          {o.collectionToReceiptMin != null && <> · <T k="채취→접수" /> <Duration minutes={o.collectionToReceiptMin} /></>}
          {o.collectionSource === 'ENTERED_LATER' && <> · <span className="text-amber-700"><T k="채취 시각 입력값" /></span></>}
          {o.waitingSinceMin != null && <span className="text-amber-700"><T k="접수 대기" /> <Duration minutes={o.waitingSinceMin} /></span>}
        </div>
      </div>
      <div className="overflow-x-auto">
        <Stepper stages={o.stages.map((s) => ({ label: STAGE_LABEL[s.key], at: s.at, tone: s.key === 'CANCELLED' ? 'border-gray-500 bg-gray-500' : s.key === 'ACKNOWLEDGED' ? 'border-emerald-500 bg-emerald-500' : undefined }))} />
      </div>
    </li>
  );
}

function RxCard({ p }: { p: LensRx }) {
  const dosingLabel = p.status === 'CANCELLED' ? '취소' : p.status === 'DISCONTINUED' ? '중단' : p.dosing.state === 'DOSING' ? '투여 중' : p.dosing.state === 'ENDED' ? '기간 종료' : '기간 모름';
  const m = p.mar;
  return (
    <article className="rounded-xl border border-gray-100 p-3" data-lens-rx>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="truncate text-sm font-medium text-gray-900" title={p.name ?? undefined}>{p.name ?? <T k="이름 없음" />}</span>
        <span className={`rounded px-1.5 text-[10px] ${p.dosing.state === 'DOSING' && p.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}><T k={dosingLabel} /></span>
        {p.dischargeMed && <span className="rounded bg-sky-50 px-1.5 text-[10px] text-sky-700"><T k="퇴원약" /></span>}
        {p.renewedFromId && <span className="rounded bg-indigo-50 px-1.5 text-[10px] text-indigo-700"><T k="갱신" /></span>}
      </div>
      <div className="text-[11px] text-gray-500">{[p.dosage, p.frequency].filter(Boolean).join(' · ')} · {kdate(new Date(p.createdAt), 'datetimeShort')}</div>
      <div className="mt-2 overflow-x-auto">
        <Stepper stages={[
          { label: '처방', at: p.createdAt },
          ...(p.verbal ? [{ label: '복창', at: p.verbal.readBackAt }, { label: '사후 확인', at: p.verbal.cosignedAt }] : []),
          ...(p.discontinuedAt ? [{ label: '중단', at: p.discontinuedAt, tone: 'border-gray-500 bg-gray-500' }] : []),
        ]} />
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-[11px]">
        <span className={p.dur.overridden ? 'text-amber-700' : 'text-gray-500'}>
          DUR {p.dur.checked ? <T k="점검" /> : <T k="미점검" />}{p.dur.warnings > 0 && <> · <Tf k="경고 {수}" params={{ 수: p.dur.warnings }} /></>}{p.dur.overridden && <> · <T k="무시" /></>}
        </span>
        {p.discontinueReason && <span className="text-gray-500"><T k="중단 사유" /> {p.discontinueReason}</span>}
      </div>
      {m.total > 0 && (
        <div className="mt-2">
          <div className="flex h-2 overflow-hidden rounded bg-gray-100" aria-hidden>
            {[
              [m.administered, 'bg-emerald-500'], [m.held, 'bg-amber-400'], [m.refused, 'bg-orange-500'], [m.missed, 'bg-rose-500'], [m.pastDueUnrecorded, 'bg-rose-200'],
            ].map(([n, c], i) => (n as number) > 0 && <span key={i} className={c as string} style={{ width: `${((n as number) / m.total) * 100}%` }} />)}
          </div>
          <div className="mt-0.5 text-[10px] text-gray-500">
            <Tf k="투약 {a}/{b} · 보류 {c} · 거부 {d} · 누락 {e} · 기록 없음 {f}" params={{ a: m.administered, b: m.total, c: m.held, d: m.refused, e: m.missed, f: m.pastDueUnrecorded }} />
            {m.delayMedianMin.value != null && <> · <T k="예정→투약 중앙값" /> <SampledText s={m.delayMedianMin} /></>}
          </div>
        </div>
      )}
    </article>
  );
}
