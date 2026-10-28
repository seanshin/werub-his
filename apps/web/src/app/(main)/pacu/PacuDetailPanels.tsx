'use client';

/**
 * 회복실 상세 패널(2026-10-07 회복실 상세화).
 *  · 마취 인계 — 같은 수술의 마취기록·수술 중 기록을 읽기만(종전 화면은 SBAR 자유 글만 받았다) · 없으면 "기록 없음"
 *  · 점수 이력 — Aldrete·PADSS·PONV 입실·중간·퇴실 전 추이(종전엔 마지막 값 하나)
 *  · 활력 추이 — 기록된 측정만 선으로(빈 칸을 0 으로 잇지 않는다) · 기준선은 서버 설정
 *  · 섭취·배설 · 간호기록 · 자리·지연 사유·마취과 퇴실 확인
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PACU_DELAY_REASONS, PACU_DELAY_REASON_LABEL, RATIO_UNAVAILABLE, formatNum, PACU_IO_ROUTES, PACU_IO_ROUTE_LABEL, PACU_SCORE_PHASE_LABEL, RASS_LABEL, pacuIoTotals,
  type PacuScoreEntry,
} from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/error-utils';
import { toast } from '@/stores/toast-store';
import { useAuthStore } from '@/stores/auth-store';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { KDate } from '@/components/ui/display';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

export interface PacuDetailRecord {
  id: string;
  dischargeTime?: string | null;
  scoreHistory?: PacuScoreEntry[] | null;
  ioEntries?: { kind: 'IN' | 'OUT'; route: string; ml: number; note?: string | null; at: string }[] | null;
  nursingNotes?: { text: string; at: string }[] | null;
  anesthesiaSignOffAt?: string | null;
  delayReason?: string | null;
  delayNote?: string | null;
  bayCode?: string | null;
}

const unwrap = <X,>(r: unknown): X => ((r as { data?: X })?.data ?? r) as X;
const fmtList = (v: unknown): string | null => {
  if (!Array.isArray(v) || !v.length) return null;
  return v.map((x) => (x && typeof x === 'object' ? Object.values(x as Record<string, unknown>).filter((y) => y != null && y !== '').join(' ') : String(x))).join(' · ');
};

/** 수술실 → 회복실 마취 인계 — 마취기록·수술 중 기록(읽기만) */
export function AnesthesiaHandoffCard({ recordId }: { recordId: string }) {
  const q = useQuery({
    queryKey: ['pacu-handoff-context', recordId],
    queryFn: async () => unwrap<{
      surgery: { procedureName: string; anesthesiaType?: string | null; startedAt?: string | null; endedAt?: string | null; surgeon?: { familyName?: string; givenName?: string } | null } | null;
      anesthesia: { asaClass?: string | null; anesthesiaType: string; airwayType?: string | null; ettSize?: string | null; extubationTime?: string | null; analgesics?: unknown; reversal?: unknown; fluidInput?: unknown; bloodProducts?: unknown; ebl?: number | null; urineOutput?: number | null; anesthetist?: { familyName?: string; givenName?: string } | null } | null;
      intraop: { total: number; truncated: boolean; byKind: Record<string, number> };
    }>(await apiClient.get(`/api/v1/pacu/${recordId}/handoff-context`)),
  });
  if (q.isError) return <QueryErrorFallback error={q.error} onRetry={() => q.refetch()} size="compact" />;
  if (q.isLoading || !q.data) return <div className="h-20 animate-pulse rounded-xl bg-gray-50" />;
  const a = q.data.anesthesia;
  const row = (label: string, v: React.ReactNode) => (
    <div className="flex gap-2 text-xs"><span className="w-20 shrink-0 text-gray-500"><T k={label} /></span><span className="min-w-0 text-gray-800">{v ?? <span className="text-gray-400"><T k="기록 없음" /></span>}</span></div>
  );
  return (
    <section className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-3" data-pacu-handoff-card>
      <p className="mb-1.5 text-xs font-bold text-indigo-900"><T k="마취 인계(수술실 기록)" /></p>
      {!a ? <p className="text-xs text-amber-700" data-pacu-handoff-none><T k="이 수술의 마취기록이 없습니다 — 인계는 아래 SBAR 로만 남아 있습니다" /></p> : (
        <div className="grid gap-1 sm:grid-cols-2">
          {row('마취', `${a.anesthesiaType}${a.asaClass ? ` · ASA ${a.asaClass}` : ''}`)}
          {row('기도', a.airwayType ? `${a.airwayType}${a.ettSize ? ` ${a.ettSize}` : ''}` : null)}
          {row('발관', a.extubationTime ? <KDate value={a.extubationTime} mode="time" /> : null)}
          {row('역전제', fmtList(a.reversal))}
          {row('진통제', fmtList(a.analgesics))}
          {row('수액', fmtList(a.fluidInput))}
          {row('수혈', fmtList(a.bloodProducts))}
          {row('출혈·소변', a.ebl != null || a.urineOutput != null ? `EBL ${a.ebl ?? '—'} mL · U/O ${a.urineOutput ?? '—'} mL` : null)}
        </div>
      )}
      <p className="mt-1.5 text-[11px] text-gray-500" data-pacu-intraop-total={q.data.intraop.total}>
        <Tf k="수술 중 기록 {n}건" params={{ n: q.data.intraop.total }} />{q.data.intraop.truncated && <> · <T k="상한으로 잘림" /></>}
      </p>
    </section>
  );
}

/** 점수 이력 — 종류별로 입실·중간·퇴실 전 */
export function ScoreHistory({ history }: { history: PacuScoreEntry[] | null | undefined }) {
  const list = Array.isArray(history) ? history : [];
  if (!list.length) return <p className="text-xs text-gray-400" data-pacu-score-history="none"><T k="점수 이력 없음(이 기능 이전 기록은 마지막 값만 있습니다)" /></p>;
  const kinds: PacuScoreEntry['kind'][] = ['ALDRETE', 'PADSS', 'PONV'];
  return (
    <div className="space-y-1.5" data-pacu-score-history={list.length}>
      {kinds.filter((k) => list.some((e) => e.kind === k)).map((k) => (
        <div key={k} className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className="w-16 font-semibold text-gray-700">{k === 'ALDRETE' ? 'Aldrete' : k === 'PADSS' ? 'PADSS' : 'PONV'}</span>
          {list.filter((e) => e.kind === k).map((e, i) => (
            <span key={i} className="rounded-lg bg-gray-50 px-2 py-0.5 ring-1 ring-gray-200" data-pacu-score-entry={`${k}-${e.phase}`}>
              <b>{e.score}</b> <span className="text-gray-500"><T k={PACU_SCORE_PHASE_LABEL[e.phase] ?? e.phase} /> <KDate value={e.at} mode="time" /></span>
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

type V = { time: string; bp?: string; hr?: number; spo2?: number; temp?: number; rass?: number };
/** 활력 추이 — 기록된 점만 잇는다(측정 없는 칸을 0 으로 내리지 않는다) */
export function VitalsTrend({ vitals, spo2Low }: { vitals: V[]; spo2Low?: number | null }) {
  const pts = [...vitals].filter((v) => v.time).sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
  if (pts.length < 2) return <p className="text-xs text-gray-400" data-pacu-trend="few"><T k="추이는 측정이 2회 이상일 때 그립니다" /></p>;
  const W = 520; const H = 120; const t0 = Date.parse(pts[0].time); const t1 = Date.parse(pts[pts.length - 1].time) || t0 + 1;
  const x = (t: string) => 24 + ((Date.parse(t) - t0) / Math.max(1, t1 - t0)) * (W - 40);
  const series: { key: string; color: string; get: (v: V) => number | null; min: number; max: number }[] = [
    { key: 'HR', color: '#e11d48', get: (v) => (typeof v.hr === 'number' ? v.hr : null), min: 30, max: 160 },
    { key: 'SBP', color: '#2563eb', get: (v) => { const s = v.bp ? parseInt(v.bp.split('/')[0], 10) : NaN; return Number.isFinite(s) ? s : null; }, min: 60, max: 200 },
    { key: 'SpO2', color: '#059669', get: (v) => (typeof v.spo2 === 'number' ? v.spo2 : null), min: 80, max: 100 },
  ];
  const y = (val: number, min: number, max: number) => H - 10 - ((Math.min(max, Math.max(min, val)) - min) / (max - min)) * (H - 20);
  return (
    <div data-pacu-trend={pts.length}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-28 w-full" role="img" aria-label="활력 추이">
        {spo2Low != null && <line x1={24} x2={W - 16} y1={y(spo2Low, 80, 100)} y2={y(spo2Low, 80, 100)} stroke="#059669" strokeDasharray="3 3" strokeOpacity={0.5} />}
        {series.map((s) => {
          const segs: string[] = []; let cur = '';
          for (const v of pts) {
            const val = s.get(v);
            if (val == null) { if (cur) segs.push(cur); cur = ''; continue; }
            cur += `${cur ? 'L' : 'M'}${x(v.time)},${y(val, s.min, s.max)} `; // SVG 좌표(표시 수치 아님)
          }
          if (cur) segs.push(cur);
          return segs.map((d, i) => <path key={`${s.key}${i}`} d={d} fill="none" stroke={s.color} strokeWidth={1.8} />);
        })}
      </svg>
      <p className="flex flex-wrap gap-3 text-[10px] text-gray-500">
        {series.map((s) => <span key={s.key}><span style={{ color: s.color }}>●</span> {s.key}</span>)}
        {spo2Low != null && <span>┄ SpO2 <T k="경보 기준" /> {spo2Low}</span>}
        {pts.some((v) => typeof v.rass === 'number') && <span>RASS {pts.filter((v) => typeof v.rass === 'number').map((v) => v.rass).join('→')}</span>}
      </p>
    </div>
  );
}

function useRecordMutation<B>(recordId: string, path: string, method: 'post' | 'patch', okMsg: string) {
  const qc = useQueryClient();
  const tAttr = useTAttr();
  return useMutation({
    mutationFn: (body: B) => (method === 'post' ? apiClient.post(`/api/v1/pacu/${recordId}/${path}`, body) : apiClient.patch(`/api/v1/pacu/${recordId}/${path}`, body)),
    onSuccess: () => { toast.success(tAttr(okMsg)); qc.invalidateQueries({ queryKey: ['pacu-patients'] }); qc.invalidateQueries({ queryKey: ['pacu-stats'] }); },
    onError: (e) => toast.error(extractErrorMessage(e) || tAttr('저장하지 못했습니다')),
  });
}

/** 회복실 섭취·배설 — 양은 정수 mL · 빈 값은 저장 막힘(0 은 측정된 0) */
export function PacuIoPanel({ record }: { record: PacuDetailRecord }) {
  const tAttr = useTAttr();
  const [kind, setKind] = useState<'IN' | 'OUT'>('IN');
  const [route, setRoute] = useState('');
  const [ml, setMl] = useState('');
  const mut = useRecordMutation<{ kind: string; route: string; ml: number }>(record.id, 'io', 'post', '섭취·배설을 기록했습니다');
  const list = record.ioEntries ?? [];
  const totals = pacuIoTotals(list);
  const open = !record.dischargeTime;
  const valid = !!route && /^\d+$/.test(ml.trim());
  return (
    <div className="space-y-2" data-pacu-io>
      <p className="text-xs text-gray-600">
        <T k="섭취" /> {totals.inMl ?? '—'} mL · <T k="배설" /> {totals.outMl ?? '—'} mL · <T k="수지" /> <b data-pacu-io-balance>{totals.balance ?? '—'}</b>
        {totals.balance == null && list.length > 0 && <span className="ml-1 text-gray-400"><T k="(섭취·배설 둘 다 기록돼야 수지)" /></span>}
      </p>
      {list.length > 0 && (
        <ul className="max-h-28 space-y-0.5 overflow-auto text-[11px] text-gray-600">
          {[...list].reverse().map((e, i) => <li key={i}><KDate value={e.at} mode="time" /> · <T k={e.kind === 'IN' ? '섭취' : '배설'} /> <T k={PACU_IO_ROUTE_LABEL[e.route] ?? e.route} /> {e.ml} mL{e.note ? ` · ${e.note}` : ''}</li>)}
        </ul>
      )}
      {open && (
        <div className="flex flex-wrap items-center gap-1.5">
          <select value={kind} onChange={(e) => { setKind(e.target.value as 'IN' | 'OUT'); setRoute(''); }} className="rounded-lg border px-2 py-1 text-xs" aria-label={tAttr('종류')}>
            <option value="IN">{tAttr('섭취')}</option><option value="OUT">{tAttr('배설')}</option>
          </select>
          <select value={route} onChange={(e) => setRoute(e.target.value)} className="rounded-lg border px-2 py-1 text-xs" aria-label={tAttr('경로')} data-pacu-io-route>
            <option value="">{tAttr('— 경로 —')}</option>
            {PACU_IO_ROUTES[kind].map((r) => <option key={r} value={r}>{tAttr(PACU_IO_ROUTE_LABEL[r] ?? r)}</option>)}
          </select>
          <input value={ml} onChange={(e) => setMl(e.target.value)} inputMode="numeric" className="w-20 rounded-lg border px-2 py-1 text-xs" aria-label="mL" placeholder="mL" />
          <button type="button" disabled={!valid || mut.isPending} onClick={() => mut.mutate({ kind, route, ml: parseInt(ml, 10) }, { onSuccess: () => { setMl(''); setRoute(''); } })}
            className="min-h-[44px] rounded-lg bg-teal-600 px-3 text-xs font-semibold text-white disabled:opacity-40" data-pacu-io-save><T k="기록" /></button>
        </div>
      )}
    </div>
  );
}

/** 회복실 간호기록(덧붙이기) */
export function PacuNotesPanel({ record }: { record: PacuDetailRecord }) {
  const tAttr = useTAttr();
  const [text, setText] = useState('');
  const mut = useRecordMutation<{ text: string }>(record.id, 'note', 'post', '간호기록을 남겼습니다');
  const list = record.nursingNotes ?? [];
  return (
    <div className="space-y-2" data-pacu-notes={list.length}>
      {list.length === 0 ? <p className="text-xs text-gray-400"><T k="회복실 간호기록 없음" /></p> : (
        <ul className="max-h-32 space-y-1 overflow-auto text-xs text-gray-700">
          {[...list].reverse().map((n, i) => <li key={i} className="rounded bg-gray-50 px-2 py-1"><span className="text-gray-400"><KDate value={n.at} mode="time" /></span> {n.text}</li>)}
        </ul>
      )}
      {!record.dischargeTime && (
        <div className="flex gap-1.5">
          <input value={text} onChange={(e) => setText(e.target.value)} className="min-w-0 flex-1 rounded-lg border px-2 py-1 text-xs" aria-label={tAttr('간호기록')} />
          <button type="button" disabled={!text.trim() || mut.isPending} onClick={() => mut.mutate({ text: text.trim() }, { onSuccess: () => setText('') })}
            className="min-h-[44px] rounded-lg bg-gray-800 px-3 text-xs font-semibold text-white disabled:opacity-40" data-pacu-note-save><T k="남기기" /></button>
        </div>
      )}
    </div>
  );
}

/** 자리(베이)·퇴실 지연 사유·마취과 퇴실 확인 */
export function PacuOpsBar({ record }: { record: PacuDetailRecord }) {
  const tAttr = useTAttr();
  const role = useAuthStore((s) => s.user?.role);
  const [bay, setBay] = useState(record.bayCode ?? '');
  const bayMut = useRecordMutation<{ bayCode: string }>(record.id, 'bay', 'patch', '자리를 바꿨습니다');
  const delayMut = useRecordMutation<{ reason: string | null; note?: string }>(record.id, 'delay', 'patch', '퇴실 지연 사유를 기록했습니다');
  const signMut = useRecordMutation<Record<string, never>>(record.id, 'sign-off', 'post', '마취과 퇴실 확인을 기록했습니다');
  const open = !record.dischargeTime;
  const canSign = role === 'DOCTOR' || role === 'ADMIN';
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" data-pacu-ops>
      <span className="text-gray-500"><T k="자리" /></span>
      {open ? (
        <>
          <input value={bay} onChange={(e) => setBay(e.target.value.slice(0, 10))} className="w-16 rounded-lg border px-2 py-1" aria-label={tAttr('자리')} data-pacu-bay />
          <button type="button" disabled={bayMut.isPending || bay === (record.bayCode ?? '')} onClick={() => bayMut.mutate({ bayCode: bay })} className="min-h-[36px] rounded-lg border px-2 disabled:opacity-40"><T k="저장" /></button>
        </>
      ) : <b>{record.bayCode ?? '—'}</b>}
      <span className="ml-2 text-gray-500"><T k="퇴실 지연 사유" /></span>
      {open ? (
        <select value={record.delayReason ?? ''} onChange={(e) => delayMut.mutate({ reason: e.target.value || null })} className="rounded-lg border px-2 py-1" data-pacu-delay>
          <option value="">{tAttr('— 없음 —')}</option>
          {PACU_DELAY_REASONS.map((r) => <option key={r} value={r}>{tAttr(PACU_DELAY_REASON_LABEL[r])}</option>)}
        </select>
      ) : <span>{record.delayReason ? tAttr(PACU_DELAY_REASON_LABEL[record.delayReason as keyof typeof PACU_DELAY_REASON_LABEL] ?? record.delayReason) : '—'}</span>}
      <span className="ml-2 text-gray-500"><T k="마취과 퇴실 확인" /></span>
      {record.anesthesiaSignOffAt
        ? <span className="font-semibold text-emerald-700" data-pacu-signoff="done"><KDate value={record.anesthesiaSignOffAt} mode="time" /></span>
        : canSign
          ? <button type="button" disabled={signMut.isPending} onClick={() => signMut.mutate({})} className="min-h-[44px] rounded-lg bg-indigo-600 px-3 font-semibold text-white" data-pacu-signoff="button"><T k="확인 서명" /></button>
          : <span className="text-amber-700" data-pacu-signoff="pending"><T k="미확인(의사 몫)" /></span>}
    </div>
  );
}

export const RASS_OPTIONS = Object.keys(RASS_LABEL).map(Number).sort((a, b) => b - a);
export { RASS_LABEL };

type Rate = { num: number; den: number; rate: number | null };
export interface PacuQuality { sample: number; ponvModerate: Rate; arrivalHypothermia: Rate & { thresholdC: number }; respiratoryEvent: Rate; icuDisposition: Rate & { plannedUnknown: boolean }; anesthesiaSignOff: Rate }
/** 회복실 질 지표 — 최근 퇴실 기준 · 분자/분모 · 표본 0 = 산출 불가 */
export function PacuQualityStrip({ quality, delayReasonCounts }: { quality?: PacuQuality | null; delayReasonCounts?: Record<string, number> | null }) {
  const tAttr = useTAttr();
  if (!quality) return null;
  const cell = (label: string, r: Rate, note?: string, key?: string) => (
    <div className="rounded-xl bg-white p-3 ring-1 ring-gray-100" data-pacu-qi={key}>
      <p className="text-[11px] text-gray-500"><T k={label} /></p>
      <p className="text-xl font-bold text-gray-900">{r.rate == null ? <span className="text-sm text-gray-400"><T k={RATIO_UNAVAILABLE} /></span> : formatNum(r.rate * 100, 'percent', { unit: true })}</p>
      <p className="text-[10px] text-gray-400">{r.num}/{r.den}{note ? ` · ${note}` : ''}</p>
    </div>
  );
  const delays = Object.entries(delayReasonCounts ?? {});
  return (
    <section className="space-y-2" data-pacu-quality={quality.sample}>
      <p className="text-xs font-semibold text-gray-600"><Tf k="회복실 질 지표 — 최근 퇴실 {n}건 기준(기록된 것만)" params={{ n: quality.sample }} /></p>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {cell('PONV 2점 이상', quality.ponvModerate, tAttr('평가된 기록 중'), 'ponv')}
        {cell('입실 저체온', quality.arrivalHypothermia, `< ${quality.arrivalHypothermia.thresholdC}℃`, 'hypothermia')}
        {cell('호흡기 사건', quality.respiratoryEvent, tAttr('기도·호흡저하·재삽관·탈포화'), 'resp')}
        {cell('ICU 퇴실', quality.icuDisposition, tAttr('계획 여부 미기록'), 'icu')}
        {cell('마취과 퇴실 확인', quality.anesthesiaSignOff, undefined, 'signoff')}
      </div>
      {delays.length > 0 && (
        <p className="text-[11px] text-amber-700" data-pacu-delay-counts>
          <T k="지금 퇴실 지연" />: {delays.map(([k, n]) => `${tAttr(PACU_DELAY_REASON_LABEL[k as keyof typeof PACU_DELAY_REASON_LABEL] ?? k)} ${n}`).join(' · ')}
        </p>
      )}
    </section>
  );
}
