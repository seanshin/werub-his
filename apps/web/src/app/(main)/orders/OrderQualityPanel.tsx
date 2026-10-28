'use client';

/**
 * CPOE 질 지표(2026-10-07) — 처방·오더 원장에서 센 분자·분모·문제 건·주별 추이·소요 시간·처방의별.
 *
 * 🔴 수치는 서버가 원장에서 센 그대로 — 분모 0 은 "산출 불가"(0% 가 아니다) · 잘렸으면 말한다.
 * 🔴 판정(달성/미달)은 질 지표 원장(/quality)에 등재된 지표만 — 목표·방향은 원장 정본, 이 화면은 정하지 않는다.
 *    미등재 지표는 "원장 미등재"로 말하고, 방향이 분명하지 않은 관찰 지표는 방향을 지어내지 않는다.
 * 🔴 의사는 본인 처방만(서버 강제) · 처방의별 비교는 관리자 병원 전체에서만.
 * 🔴 월 측정 기록은 끝난 달·병원 전체·서버 재집계 — 화면이 보낸 수를 쓰지 않는다.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CPOE_QI_DEFS, CPOE_QI_GROUPS, RATIO_UNAVAILABLE, formatNum, CPOE_QI_GROUP_LABEL, ORDER_DEPT_LABEL, P_CHART_RUN_LENGTH, QI_SETTINGS, QI_SETTING_LABEL,
  type CpoeQiKey, type OrderDept, type PChart, type QiSetting,
} from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/error-utils';
import { toast } from '@/stores/toast-store';
import { useHasRole } from '@/hooks/use-admin-write';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { Duration, KDate, PatientName, Ratio } from '@/components/ui/display';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';
import { OrderPatientDrawer } from './OrderPatientDrawer';
import { QualityAlertsSection } from './QualityAlertsSection';
import { ImprovementCreateForm, ImprovementsSection } from './QualityImprovements';
import { QiAgendaSlot } from './committee-agenda-ui';

type Direction = 'LOWER_IS_BETTER' | 'HIGHER_IS_BETTER' | null;
interface Count { numerator: number; denominator: number }
interface Item { id: string; kind: 'RX' | 'ORDER' | 'INTERVENTION' | 'CDSS' | 'CRITICAL'; at: string; patientId: string | null; name: string | null; prescriber: string | null }
interface Indicator {
  key: CpoeQiKey; numerator: number; denominator: number; value: number | null;
  offenders: { total: number; items: Item[] } | null;
  trend: { start: string; numerator: number; denominator: number }[];
  strata: { setting: Record<QiSetting, Count>; department: ({ department: string | null } & Count)[] };
  qi:
    | { registered: false; name: string; direction: Direction; directionSource: 'REGISTRY' | 'HINT' | null }
    | { registered: true; indicatorId: string; name: string; target: number | null; unit: string | null; valueScale: number; direction: Direction; directionSource: string | null;
        current: { value: number | null; meetTarget: boolean | null }; latest: { period: string; value: number; meetTarget: boolean | null } | null };
}
interface Tat { department: OrderDept; priority: 'STAT' | 'ROUTINE'; median: number | null; p90: number | null; n: number }
interface AckTime { kind: 'RESULT' | 'CRITICAL'; median: number | null; p90: number | null; n: number }
interface PrescriberRow { prescriber: string; prescriptions: number; durOverridden: number; durOverrideNoReason: number; verbal: number; verbalUncosigned: number; noDiagnosis: number; discontinueNoReason: number; resultUnack: number; criticalUnack: number }
export interface CpoeQuality {
  period: { from: string; to: string; fromDate: string; toDate: string };
  scope: { prescriberId: string | null; hospitalWide: boolean };
  truncated: Record<'prescriptions' | 'orders' | 'interventions' | 'cdss' | 'criticals', boolean>;
  totals: Record<'prescriptions' | 'orders' | 'interventions' | 'cdss' | 'criticals', number>;
  indicators: Indicator[];
  tat: Tat[];
  ackTimes: AckTime[];
  byPrescriber: PrescriberRow[] | null;
  names: { patients: Record<string, { name: string; koreanName: string | null; mrn: string }>; users: Record<string, { name: string; department: string | null }> };
}

const DIRECTION_LABEL: Record<'LOWER_IS_BETTER' | 'HIGHER_IS_BETTER', string> = { LOWER_IS_BETTER: '낮을수록 바람직', HIGHER_IS_BETTER: '높을수록 바람직' };

function prevMonth(now = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** 주별 추이 — 분모 0 인 주는 선을 끊는다(0 으로 그리지 않는다) */
function TrendLine({ trend }: { trend: Indicator['trend'] }) {
  const W = 120; const H = 28;
  const n = trend.length;
  if (n < 2) return null;
  const x = (i: number) => (i / (n - 1)) * (W - 4) + 2;
  const segs: string[][] = [];
  let cur: string[] = [];
  trend.forEach((t, i) => {
    if (!t.denominator) { if (cur.length) segs.push(cur); cur = []; return; }
    cur.push(`${x(i)},${H - 2 - (t.numerator / t.denominator) * (H - 4)}`);
  });
  if (cur.length) segs.push(cur);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-7 w-28" role="img" aria-label="weekly trend" data-qi-trend>
      <line x1={2} x2={W - 2} y1={H - 2} y2={H - 2} stroke="#e5e7eb" />
      {segs.map((s, i) => (s.length > 1
        ? <polyline key={i} points={s.join(' ')} fill="none" stroke="#2563eb" strokeWidth={1.5} />
        : <circle key={i} cx={Number(s[0].split(',')[0])} cy={Number(s[0].split(',')[1])} r={1.8} fill="#2563eb" />))}
    </svg>
  );
}

function LedgerBadge({ qi }: { qi: Indicator['qi'] }) {
  if (!qi.registered) {
    return (
      <p className="text-[10px] text-gray-400" data-qi-ledger="unregistered">
        <T k="질 지표 원장 미등재" />{' · '}
        {qi.direction ? <><T k={DIRECTION_LABEL[qi.direction]} />{qi.directionSource === 'HINT' && <> (<T k="이름 추정" />)</>}</> : <T k="방향 미정(관찰 지표)" />}
      </p>
    );
  }
  const meet = qi.current.meetTarget;
  return (
    <p className="text-[10px] text-gray-600" data-qi-ledger="registered">
      <T k="목표" /> {qi.target ?? '—'}{qi.unit ?? ''}
      {qi.direction && <> · <T k={DIRECTION_LABEL[qi.direction]} /></>}
      {' · '}
      {meet == null
        ? <span className="text-gray-400" data-qi-meet="unknown"><T k="판정 불가" /></span>
        : meet
          ? <span className="font-semibold text-emerald-700" data-qi-meet="met"><T k="이 기간 목표 충족" /></span>
          : <span className="font-semibold text-rose-700" data-qi-meet="unmet"><T k="이 기간 목표 미충족" /></span>}
      {qi.latest && <> · <Tf k="최근 기록 {기간}" params={{ 기간: qi.latest.period }} /></>}
    </p>
  );
}

function RecordMonth({ ind }: { ind: Indicator }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [month, setMonth] = useState(prevMonth);
  // 관리자만(useHasRole() = ADMIN) — 서버는 qi:measure:write 로 다시 막는다
  const canRecord = useHasRole();
  const rec = useMutation({
    mutationFn: () => apiClient.post('/api/v1/orders/quality/measurements', { key: ind.key, period: month }),
    onSuccess: () => { toast.success(tAttr('질 지표 원장에 측정을 기록했습니다.')); qc.invalidateQueries({ queryKey: ['cpoe-quality'] }); },
    onError: (e) => toast.error(extractErrorMessage(e) || tAttr('측정을 기록하지 못했습니다.')),
  });
  if (!canRecord || !ind.qi.registered) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-t border-gray-50 pt-2" data-qi-record={ind.key}>
      <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label={tAttr('측정 연월')} className="rounded border border-gray-200 px-1.5 py-1 text-[11px]" />
      <button type="button" disabled={rec.isPending || !month} onClick={() => rec.mutate()}
        className="min-h-[44px] rounded-lg bg-gray-900 px-3 text-xs font-semibold text-white disabled:opacity-50">
        <T k="월 측정 기록" />
      </button>
      <span className="text-[10px] text-gray-400"><T k="병원 전체·끝난 달만 · 서버가 다시 셉니다" /></span>
    </div>
  );
}

/** 층화 — 진료 유형별(그 진료 기록 기준)·진료과별(책임 처방의 소속) · 대상 0 인 층은 싣지 않는다 */
function Strata({ ind }: { ind: Indicator }) {
  const depts = ind.strata.department.filter((d) => d.denominator > 0);
  return (
    <div className="space-y-1.5 rounded-lg bg-gray-50 p-2 text-[11px]" data-qi-strata={ind.key}>
      <div className="flex flex-wrap gap-1.5">
        {QI_SETTINGS.filter((s) => ind.strata.setting[s].denominator > 0).map((s) => (
          <span key={s} className={`rounded px-1.5 py-0.5 ${s === 'UNKNOWN' ? 'bg-amber-50 text-amber-800' : 'bg-white text-gray-700'}`} data-qi-stratum={s}>
            <T k={QI_SETTING_LABEL[s]} /> <Ratio numerator={ind.strata.setting[s].numerator} denominator={ind.strata.setting[s].denominator} />
          </span>
        ))}
      </div>
      {depts.length > 0 && (
        <table className="w-full">
          <tbody>
            {depts.slice(0, 8).map((d) => (
              <tr key={d.department ?? '-'} className="border-t border-gray-100">
                <td className="py-0.5 text-gray-600">{d.department ?? <span className="text-amber-700"><T k="진료과 미상" /></span>}</td>
                <td className="text-right tabular-nums"><Ratio numerator={d.numerator} denominator={d.denominator} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {depts.length > 8 && <p className="text-[10px] text-gray-400"><Tf k="진료과 상위 {수}곳만 · 전체 {전체}곳" params={{ 수: 8, 전체: depts.length }} /></p>}
      <p className="text-[10px] text-gray-400"><T k="진료 유형은 처방이 난 진료 기록 기준(지금 위치가 아님) · 진료과는 책임 처방의 소속" /></p>
    </div>
  );
}

function IndicatorCard({ ind, data, canRecord, onPatient, onSpc, onImprove }: { ind: Indicator; data: CpoeQuality; canRecord: boolean; onPatient: (id: string) => void; onSpc: (k: CpoeQiKey) => void; onImprove?: (k: CpoeQiKey) => void }) {
  const def = CPOE_QI_DEFS.find((d) => d.key === ind.key)!;
  const [open, setOpen] = useState(false);
  const [strata, setStrata] = useState(false);
  return (
    <div className="space-y-1.5 rounded-xl border border-gray-100 bg-white p-3" data-qi-card={ind.key}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-gray-800"><T k={def.label} /></p>
          <p className="text-[10px] text-gray-400"><T k={def.numerator} /> / <T k={def.denominator} /></p>
        </div>
        <TrendLine trend={ind.trend} />
      </div>
      <p className="text-lg font-black text-gray-900" data-qi-value>
        <Ratio numerator={ind.numerator} denominator={ind.denominator} unavailableHint="이 기간 대상 없음" />
      </p>
      <LedgerBadge qi={ind.qi} />
      {/* 원장 등록·목표는 위원회 몫 — 이 카드에서 안건으로 올린다 · 방향은 원장 등록값·코드 등재표가 아니면 함께 정한다 */}
      <QiAgendaSlot indicatorKey={ind.key} registered={ind.qi.registered}
        needsDirection={!(ind.qi.directionSource === 'COLUMN' || ind.qi.directionSource === 'REGISTRY')} />
      <div className="flex flex-wrap gap-2 text-[11px]">
        {ind.denominator > 0 && (
          <button type="button" onClick={() => setStrata(!strata)} className="font-medium text-blue-700" data-qi-strata-toggle>
            <T k="유형·진료과별" /> {strata ? '▲' : '▼'}
          </button>
        )}
        <button type="button" onClick={() => onSpc(ind.key)} className="font-medium text-blue-700" data-qi-spc-open={ind.key}>
          <T k="월별 관리도" /> →
        </button>
        {onImprove && (
          <button type="button" onClick={() => onImprove(ind.key)} className="font-medium text-emerald-700" data-qi-improve-open={ind.key}>
            <T k="개선 활동 시작" /> +
          </button>
        )}
      </div>
      {strata && <Strata ind={ind} />}
      {def.asOf && <p className="text-[10px] text-amber-700" data-qi-asof><T k="지금 상태 기준 — 최근 건은 아직 처리 전일 수 있습니다" /></p>}
      {ind.offenders && ind.offenders.total > 0 && (
        <div>
          <button type="button" onClick={() => setOpen(!open)} className="text-[11px] font-medium text-blue-700" data-qi-offenders-toggle>
            <Tf k="해당 건 {수}" params={{ 수: ind.offenders.total }} /> {open ? '▲' : '▼'}
          </button>
          {open && (
            <ul className="mt-1 max-h-56 space-y-0.5 overflow-y-auto text-[11px]" data-qi-offenders={ind.key}>
              {ind.offenders.items.map((it) => {
                const p = it.patientId ? data.names.patients[it.patientId] : null;
                const u = it.prescriber ? data.names.users[it.prescriber] : null;
                return (
                  <li key={it.id} className="flex flex-wrap items-center gap-1.5 border-b border-gray-50 py-0.5">
                    <span className="tabular-nums text-gray-400"><KDate value={it.at} mode="datetimeShort" /></span>
                    <span className="min-w-0 flex-1 truncate text-gray-700">{it.name ?? <T k="이름 없음" />}</span>
                    {p && it.patientId && (
                      <button type="button" onClick={() => onPatient(it.patientId!)} className="text-blue-700 hover:underline" data-qi-patient={it.patientId}>
                        <PatientName name={p.name} koreanName={p.koreanName} mrn={p.mrn} maskable />
                      </button>
                    )}
                    {u && <span className="text-gray-400">{u.name}</span>}
                  </li>
                );
              })}
              {ind.offenders.total > ind.offenders.items.length && (
                <li className="pt-1 text-[10px] text-amber-700"><Tf k="최근 {수}건만 표시 · 전체 {전체}건" params={{ 수: ind.offenders.items.length, 전체: ind.offenders.total }} /></li>
              )}
            </ul>
          )}
        </div>
      )}
      {canRecord && <RecordMonth ind={ind} />}
    </div>
  );
}

interface Spc { key: CpoeQiKey; months: number; scope: { prescriberId: string | null; hospitalWide: boolean }; truncated: Record<string, boolean>; chart: PChart; target: { value: number; direction: string | null } | null }

/**
 * 월별 p 관리도 — 점(월 비율)·중심선·관리 한계(점마다 n 이 달라 계단)·원장 목표(있으면 점선).
 * 🔴 신호는 "원인을 찾아볼 자리"이지 결함 판정이 아니다 · 진행 중인 달은 빈 점(중심선 계산에서 뺐다) · 분모 0 달은 점 없음.
 */
function SpcPanel({ k, prescriberId, onClose, onImprove }: { k: CpoeQiKey; prescriberId: string; onClose: () => void; onImprove?: (k: CpoeQiKey, trigger?: string) => void }) {
  const def = CPOE_QI_DEFS.find((d) => d.key === k)!;
  const [months, setMonths] = useState(12);
  const qs = `key=${k}&months=${months}${prescriberId ? `&prescriberId=${prescriberId}` : ''}`;
  const q = useQuery({
    queryKey: ['cpoe-quality-spc', qs],
    queryFn: () => apiClient.get<{ data: Spc }>(`/api/v1/orders/quality/spc?${qs}`).then((r) => r.data),
  });
  const s = q.data;
  const W = 640; const H = 200; const L = 36; const B = 22;
  const pts = s?.chart.points ?? [];
  const yMax = Math.max(0.05, ...pts.map((p) => Math.max(p.p ?? 0, p.ucl ?? 0)), s?.target?.value ?? 0);
  const x = (i: number) => L + (pts.length < 2 ? 0 : (i / (pts.length - 1)) * (W - L - 10));
  const y = (v: number) => H - B - (v / yMax) * (H - B - 10);
  // 수치 정본(percent 1자리) — toFixed 직접 호출 금지
  const pct = (v: number) => formatNum(v * 100, 'percent');
  const signals = pts.filter((p) => p.signal).length;
  return (
    <section className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm" data-qi-spc={k}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="text-sm font-bold text-gray-900"><T k={def.label} /> — <T k="월별 관리도(p 관리도)" /></p>
        {[12, 24].map((m) => (
          <button key={m} type="button" onClick={() => setMonths(m)} className={`rounded px-2 py-0.5 text-[11px] ${months === m ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>
            <Tf k="{개월}개월" params={{ 개월: m }} />
          </button>
        ))}
        <button type="button" onClick={onClose} className="ml-auto rounded-lg px-2 py-1 text-sm text-gray-500 hover:bg-gray-100" aria-label="close">✕</button>
      </div>
      {q.isError ? <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} />
        : !s ? <div className="h-48 animate-pulse rounded-xl bg-gray-100" />
          : (
            <>
              <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="p chart" data-qi-spc-chart>
                {[0, yMax / 2, yMax].map((v) => (
                  <g key={v}><line x1={L} x2={W - 6} y1={y(v)} y2={y(v)} stroke="#f1f5f9" /><text x={2} y={y(v) + 3} fontSize="9" fill="#94a3b8">{pct(v)}</text></g>
                ))}
                {s.chart.center != null && <line x1={L} x2={W - 6} y1={y(s.chart.center)} y2={y(s.chart.center)} stroke="#334155" strokeWidth={1} data-qi-spc-center />}
                {s.target && <line x1={L} x2={W - 6} y1={y(s.target.value)} y2={y(s.target.value)} stroke="#059669" strokeDasharray="4 3" data-qi-spc-target />}
                {pts.map((p, i) => p.ucl != null && (
                  <g key={`l${i}`}>
                    <line x1={x(i) - 8} x2={x(i) + 8} y1={y(p.ucl)} y2={y(p.ucl)} stroke="#f43f5e" strokeWidth={1} opacity={0.6} />
                    <line x1={x(i) - 8} x2={x(i) + 8} y1={y(p.lcl!)} y2={y(p.lcl!)} stroke="#f43f5e" strokeWidth={1} opacity={0.6} />
                  </g>
                ))}
                <polyline fill="none" stroke="#2563eb" strokeWidth={1.5}
                  points={pts.map((p, i) => (p.p == null ? null : `${x(i)},${y(p.p)}`)).filter(Boolean).join(' ')} />
                {pts.map((p, i) => p.p != null && (
                  <circle key={`p${i}`} cx={x(i)} cy={y(p.p)} r={p.signal ? 4.5 : 3}
                    fill={p.partial ? '#fff' : p.signal ? '#e11d48' : '#2563eb'} stroke={p.signal ? '#e11d48' : '#2563eb'} strokeWidth={1.5}
                    data-qi-spc-point={p.period} data-signal={p.signal ?? ''}>
                    <title>{`${p.period} · ${p.numerator}/${p.denominator}${p.signal ? ` · ${p.signal}` : ''}`}</title>
                  </circle>
                ))}
                {pts.map((p, i) => <text key={`t${i}`} x={x(i)} y={H - 6} fontSize="8" fill="#94a3b8" textAnchor="middle">{p.period.slice(2)}</text>)}
              </svg>
              <div className="mt-1 flex flex-wrap gap-3 text-[10px] text-gray-500">
                <span>— <T k="중심선(완결된 달 평균)" /> {s.chart.center == null ? <T k={RATIO_UNAVAILABLE} /> : pct(s.chart.center)}</span>
                <span className="text-rose-600">— <T k="관리 한계(±3σ · 달마다 표본 수로 다름)" /></span>
                {s.target && <span className="text-emerald-700">- - <T k="원장 목표" /> {pct(s.target.value)}</span>}
                <span>○ <T k="진행 중인 달(중심선 계산 제외)" /></span>
              </div>
              {s.chart.degenerate
                ? <p className="mt-1 text-[11px] text-gray-500" data-qi-spc-degenerate><T k="중심선이 0% 또는 100% 이거나 표본이 없어 관리 한계를 그릴 수 없습니다 — 신호를 내지 않습니다." /></p>
                : <p className="mt-1 text-[11px] text-gray-700" data-qi-spc-signals>
                    {signals > 0
                      ? <Tf k="신호 {수}개 — 한계 밖이거나 중심선 한쪽에 {연속}점 이상 연속입니다. 원인을 찾아볼 자리이지 결함 판정이 아닙니다." params={{ 수: signals, 연속: P_CHART_RUN_LENGTH }} />
                      : <T k="통계적 신호 없음 — 이것이 목표 달성을 뜻하지는 않습니다." />}
                  </p>}
              <p className="mt-0.5 text-[10px] text-gray-400"><Tf k="완결된 달 {수}개로 계산 · 점이 20개보다 적으면 한계가 불안정합니다" params={{ 수: s.chart.basis.months }} /></p>
              {onImprove && signals > 0 && (
                <button type="button" onClick={() => onImprove(k, [...pts].reverse().find((p) => p.signal)?.period)} data-qi-spc-improve
                  className="mt-2 min-h-[44px] rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white">
                  <T k="이 신호로 개선 활동 시작" />
                </button>
              )}
            </>
          )}
    </section>
  );
}

export function OrderQualityPanel() {
  const tAttr = useTAttr();
  // 서버 @Roles(ADMIN·DOCTOR) 와 같은 판정 — 권한 밖이면 부르지 않는다
  const canView = useHasRole('DOCTOR');
  // 관리자만(useHasRole() 인자 없음 = ADMIN) — 병원 전체·처방의별·월 측정 기록
  const isAdmin = useHasRole();
  const [days, setDays] = useState<number | null>(30);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [prescriberId, setPrescriberId] = useState('');
  const [drawer, setDrawer] = useState<string | null>(null);
  const [spcKey, setSpcKey] = useState<CpoeQiKey | null>(null);
  const [improve, setImprove] = useState<{ key: CpoeQiKey; trigger?: string } | null>(null);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    if (days == null) { if (from) p.set('from', from); if (to) p.set('to', to); }
    else {
      const end = new Date(); const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (days - 1));
      const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      p.set('from', ymd(start)); p.set('to', ymd(end));
    }
    if (isAdmin && prescriberId) p.set('prescriberId', prescriberId);
    return p.toString();
  }, [days, from, to, prescriberId, isAdmin]);

  const q = useQuery({
    queryKey: ['cpoe-quality', query],
    queryFn: () => apiClient.get<{ data: CpoeQuality }>(`/api/v1/orders/quality?${query}`).then((r) => r.data),
    enabled: canView,
  });
  const d = q.data;
  const anyTruncated = d ? Object.values(d.truncated).some(Boolean) : false;
  const scopeName = d?.scope.prescriberId ? d.names.users[d.scope.prescriberId]?.name : null;

  if (!canView) return <p className="text-sm text-gray-500"><T k="CPOE 질 지표는 의사(본인 처방)·관리자가 봅니다." /></p>;

  return (
    <div className="space-y-4" data-cpoe-quality>
      <div className="flex flex-wrap items-center gap-1.5">
        {[7, 30, 90].map((n) => (
          <button key={n} type="button" onClick={() => setDays(n)}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium ${days === n ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 ring-1 ring-gray-200'}`}>
            <Tf k="최근 {일}일" params={{ 일: n }} />
          </button>
        ))}
        <button type="button" onClick={() => setDays(null)}
          className={`rounded-lg px-2.5 py-1 text-xs font-medium ${days == null ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 ring-1 ring-gray-200'}`}>
          <T k="기간 지정" />
        </button>
        {days == null && (
          <>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label={tAttr('시작일')} className="rounded-lg border border-gray-200 px-2 py-1 text-xs" />
            <span className="text-xs text-gray-400">~</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label={tAttr('종료일')} className="rounded-lg border border-gray-200 px-2 py-1 text-xs" />
          </>
        )}
        {isAdmin && prescriberId && (
          <button type="button" onClick={() => setPrescriberId('')} className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700" data-qi-clear-prescriber>
            {scopeName ?? prescriberId} ✕
          </button>
        )}
        <Link href="/quality" className="ml-auto text-xs text-blue-700 hover:underline"><T k="질 지표 원장(목표·측정 이력) →" /></Link>
      </div>

      {q.isError ? <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} />
        : !d ? <div className="h-64 animate-pulse rounded-2xl bg-gray-100" />
          : (
            <>
              <div className="flex flex-wrap items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-xs text-gray-600 shadow-sm" data-qi-scope>
                <span className="font-bold text-gray-900">
                  {d.scope.hospitalWide ? <T k="병원 전체" /> : isAdmin ? <Tf k="처방의 {이름}" params={{ 이름: scopeName ?? '—' }} /> : <T k="내 처방" />}
                </span>
                <span>{d.period.fromDate} ~ {d.period.toDate}</span>
                <span>· <T k="처방" /> {d.totals.prescriptions} · <T k="오더" /> {d.totals.orders} · <T k="위급값 통보" /> {d.totals.criticals} · <T k="약사 중재" /> {d.totals.interventions} · CDSS {d.totals.cdss}</span>
                {anyTruncated && <span className="font-semibold text-amber-700" data-qi-truncated><T k="행 상한을 넘어 일부만 셌습니다 — 기간을 줄이세요" /></span>}
              </div>

              {spcKey && <SpcPanel k={spcKey} prescriberId={isAdmin ? prescriberId : ''} onClose={() => setSpcKey(null)}
                onImprove={isAdmin ? (key, trigger) => setImprove({ key, trigger }) : undefined} />}
              {/* 개선 활동은 병원 전체 기준선으로 — 관리자 전용(서버 @Roles(ADMIN)) */}
              {improve && isAdmin && (
                <ImprovementCreateForm key={`${improve.key}-${improve.trigger ?? ''}`} indicatorKey={improve.key} triggerPeriod={improve.trigger}
                  defaultFrom={d.period.fromDate} defaultTo={d.period.toDate} onClose={() => setImprove(null)} />
              )}

              {CPOE_QI_GROUPS.map((g) => {
                const list = d.indicators.filter((i) => CPOE_QI_DEFS.find((x) => x.key === i.key)?.group === g);
                return (
                  <section key={g} data-qi-group={g}>
                    <p className="mb-1.5 text-xs font-bold text-gray-700"><T k={CPOE_QI_GROUP_LABEL[g]} /></p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                      {list.map((ind) => <IndicatorCard key={ind.key} ind={ind} data={d} canRecord={isAdmin && d.scope.hospitalWide} onPatient={setDrawer} onSpc={setSpcKey}
                        onImprove={isAdmin ? (key) => setImprove({ key }) : undefined} />)}
                    </div>
                  </section>
                );
              })}

              <section className="rounded-2xl bg-white p-4 shadow-sm" data-qi-tat>
                <p className="mb-2 text-xs font-bold text-gray-700"><T k="오더 소요 시간 — 발행→완료(결과·조제)" /></p>
                <table className="w-full text-xs">
                  <thead className="text-gray-400"><tr>
                    <th className="text-left font-medium"><T k="부서" /></th><th className="text-left font-medium"><T k="긴급도" /></th>
                    <th className="text-right font-medium"><T k="중앙값" /></th><th className="text-right font-medium">90%</th><th className="text-right font-medium">n</th>
                  </tr></thead>
                  <tbody>
                    {d.tat.map((c) => (
                      <tr key={`${c.department}-${c.priority}`} className="border-t border-gray-50" data-qi-tat-cell={`${c.department}-${c.priority}`}>
                        <td className="py-1"><T k={ORDER_DEPT_LABEL[c.department]} /></td>
                        <td>{c.priority === 'STAT' ? <span className="rounded bg-rose-600 px-1 text-[9px] font-bold text-white">STAT</span> : <T k="일반" />}</td>
                        <td className="text-right tabular-nums">{c.median == null ? <span className="text-gray-400"><T k="표본 없음" /></span> : <Duration minutes={c.median} dense />}</td>
                        <td className="text-right tabular-nums">{c.p90 == null ? '—' : <Duration minutes={c.p90} dense />}</td>
                        <td className="text-right tabular-nums text-gray-500">{c.n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-1 text-[10px] text-gray-400"><T k="완료된 오더만 표본 · 완료가 발행보다 이른 기록은 뺍니다 · 지연 기준은 정하지 않습니다" /></p>
                <p className="mb-1 mt-3 text-xs font-bold text-gray-700"><T k="결과 확인 소요" /></p>
                <table className="w-full text-xs">
                  <tbody>
                    {d.ackTimes.map((a) => (
                      <tr key={a.kind} className="border-t border-gray-50" data-qi-ack={a.kind}>
                        <td className="py-1">{a.kind === 'RESULT' ? <T k="검사·영상 결과 → 의사 확인" /> : <T k="위급값 통보 → 확인" />}</td>
                        <td className="text-right tabular-nums">{a.median == null ? <span className="text-gray-400"><T k="표본 없음" /></span> : <Duration minutes={a.median} dense />}</td>
                        <td className="text-right tabular-nums">{a.p90 == null ? '—' : <Duration minutes={a.p90} dense />}</td>
                        <td className="text-right tabular-nums text-gray-500">{a.n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-1 text-[10px] text-gray-400"><T k="확인된 건만 표본 — 아직 확인 안 된 건은 미확인률이 셉니다" /></p>
              </section>

              <QualityAlertsSection query={query} />
              <ImprovementsSection />

              {d.byPrescriber && (
                <section className="overflow-x-auto rounded-2xl bg-white p-4 shadow-sm" data-qi-prescribers>
                  <p className="mb-2 text-xs font-bold text-gray-700"><T k="처방의별 — 누르면 그 처방의로 좁힙니다" /></p>
                  <table className="w-full min-w-[800px] text-xs">
                    <thead className="text-gray-400"><tr>
                      <th className="text-left font-medium"><T k="처방의" /></th>
                      <th className="text-right font-medium"><T k="처방" /></th>
                      <th className="text-right font-medium"><T k="DUR 무시" /></th>
                      <th className="text-right font-medium"><T k="무시 사유 없음" /></th>
                      <th className="text-right font-medium"><T k="구두·전화" /></th>
                      <th className="text-right font-medium"><T k="서명 미완료" /></th>
                      <th className="text-right font-medium"><T k="상병 미연결" /></th>
                      <th className="text-right font-medium"><T k="중단 사유 없음" /></th>
                      <th className="text-right font-medium"><T k="결과 미확인" /></th>
                      <th className="text-right font-medium"><T k="위급값 미확인" /></th>
                    </tr></thead>
                    <tbody>
                      {d.byPrescriber.map((r) => {
                        const u = d.names.users[r.prescriber];
                        const cell = (v: number) => <td className={`text-right tabular-nums ${v > 0 ? 'font-semibold text-gray-900' : 'text-gray-300'}`}>{v}</td>;
                        return (
                          <tr key={r.prescriber} className="cursor-pointer border-t border-gray-50 hover:bg-blue-50/40" onClick={() => setPrescriberId(r.prescriber)} data-qi-prescriber={r.prescriber}>
                            <td className="py-1">{u?.name ?? <T k="이름 미상" />}{u?.department && <span className="ml-1 text-gray-400">{u.department}</span>}</td>
                            {cell(r.prescriptions)}{cell(r.durOverridden)}{cell(r.durOverrideNoReason)}{cell(r.verbal)}{cell(r.verbalUncosigned)}{cell(r.noDiagnosis)}{cell(r.discontinueNoReason)}{cell(r.resultUnack)}{cell(r.criticalUnack)}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="mt-1 text-[10px] text-gray-400"><T k="처방 수가 다르면 건수를 바로 비교할 수 없습니다 — 처방의를 눌러 비율로 보세요" /></p>
                </section>
              )}

              <p className="text-[10px] text-gray-400" data-qi-disclaimer>
                <T k="처방·오더 기록에서 정해진 규칙으로 센 수입니다 — 개인 평가나 임상 판단이 아닙니다. 목표와 방향은 질 지표 원장에서 위원회가 정합니다." />
              </p>
            </>
          )}
      {drawer && <OrderPatientDrawer patientId={drawer} onClose={() => setDrawer(null)} />}
    </div>
  );
}
