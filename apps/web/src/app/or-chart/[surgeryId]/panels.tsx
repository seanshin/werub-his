'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ageOf, anesthesiaText, intraopVitalsOf,
  INTRAOP_EVENT_LABEL, INTRAOP_PHASE_STAMPS, INTRAOP_PHASE_STAMP_LABEL, OUTPUT_TYPES, OUTPUT_TYPE_LABEL,
  type IntraopEventKind, type IntraopVitalPoint, type OrPanel,
} from '@hospital-run/shared';
import { apiClient } from '@/lib/api-client';
import { extractErrorMessage } from '@/lib/error-utils';
import { toast } from '@/stores/toast-store';
import { useAuthStore } from '@/stores/auth-store';
import { Duration, KDate, PatientName, genderText } from '@/components/ui/display';
import StatusBadge from '@/components/ui/StatusBadge';
import { T, Tf, Data, useTAttr } from '@/components/ui/i18n-text';
import { AllergyStatusBadge } from '@/components/clinical/allergy-status';
import { SurgicalChecklistPanel } from '@/app/(main)/surgery/components/SurgicalChecklistPanel';
import OpNotePanel from '@/app/(main)/surgery/components/OpNotePanel';
import { useHasRole } from '@/hooks/use-admin-write';
import { OrVoiceDictation } from './or-voice';
import { FlowStrip, SummaryPanel } from './flow-summary';
import type { ChartEvent, OrChart } from './chart-types';

/** 살아 있는 줄(무효 아님) */
const live = (es: ChartEvent[], kind?: IntraopEventKind) => es.filter((e) => !e.voidedAt && (!kind || e.kind === kind));
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function Panel({ title, children, right }: { title: React.ReactNode; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="flex min-h-0 flex-col rounded-2xl border border-gray-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-gray-100 px-4 py-2.5">
        <h2 className="text-sm font-bold text-gray-900">{title}</h2>
        {right}
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
    </section>
  );
}

/** 기록 저장 — 성공하면 차트를 다시 받는다 · 실패는 서버 문장 그대로(400·409) */
function useAddEvent(surgeryId: string, queryKey: unknown[]) {
  const qc = useQueryClient();
  const tAttr = useTAttr();
  return useMutation({
    mutationFn: (v: { kind: IntraopEventKind; payload: Record<string, unknown>; occurredAt?: string }) =>
      apiClient.post(`/api/v1/surgery/${surgeryId}/intraop/events`, v),
    onSuccess: () => { toast.success(tAttr('기록했습니다.')); qc.invalidateQueries({ queryKey }); },
    onError: (e) => toast.error(extractErrorMessage(e) || tAttr('기록하지 못했습니다.')),
  });
}

/** 발생 시각 입력 — 비우면 지금(서버가 RECORDED) · 넣으면 그 시각(USER_CLAIMED) */
function AtInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const tAttr = useTAttr();
  return (
    <label className="flex items-center gap-1 text-[11px] text-gray-500">
      <T k="시각" />
      <input type="datetime-local" value={value} onChange={(e) => onChange(e.target.value)} aria-label={tAttr('발생 시각')}
        className="rounded-md border border-gray-200 px-1.5 py-1 text-xs" />
      {!value && <span className="text-gray-400">(<T k="지금" />)</span>}
    </label>
  );
}
const isoOf = (local: string) => (local ? new Date(local).toISOString() : undefined);

// ───────────────────────── 머리 ─────────────────────────
/** 순회 간호 자리 — 간호사가 맡기·내려놓기(서버 @Roles NURSE·ADMIN 과 같은 판정) */
function CirculatingSlot({ c, queryKey }: { c: OrChart; queryKey: unknown[] }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const me = useAuthStore((st) => st.user);
  const canTake = useHasRole('NURSE');
  const m = useMutation({
    mutationFn: (action: 'TAKE' | 'RELEASE') => apiClient.post(`/api/v1/surgery/${c.surgery.id}/intraop/circulating`, { action }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
    onError: (e) => toast.error(extractErrorMessage(e) || tAttr('순회 간호 자리를 바꾸지 못했습니다.')),
  });
  const cur = c.surgery.circulatingNurse;
  const mine = !!cur && cur.id === me?.id;
  return (
    <span className="flex items-center gap-1.5" data-or-circulating>
      <T k="순회 간호" /> <Data>{cur ? (cur.name ?? '—') : ''}</Data>{!cur && <span className="text-amber-300"><T k="지정 안 됨" /></span>}
      {canTake && !mine && (
        <button type="button" onClick={() => m.mutate('TAKE')} disabled={m.isPending} className="rounded-md bg-white/15 px-2 py-0.5 text-[11px] font-semibold hover:bg-white/25">
          {cur ? <T k="교대로 맡기" /> : <T k="순회 간호 맡기" />}
        </button>
      )}
      {mine && (
        <button type="button" onClick={() => m.mutate('RELEASE')} disabled={m.isPending} className="rounded-md bg-white/15 px-2 py-0.5 text-[11px] hover:bg-white/25"><T k="내려놓기" /></button>
      )}
    </span>
  );
}

function HeaderPanel({ c, queryKey }: { c: OrChart; queryKey: unknown[] }) {
  const s = c.surgery;
  const age = s.patient?.dateOfBirth ? ageOf(s.patient.dateOfBirth) : null;
  return (
    <section className="rounded-2xl border border-gray-900 bg-gray-900 px-4 py-3 text-white" data-or-header>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <p className="text-xl font-black">{s.patient ? <PatientName name={s.patient.name} koreanName={s.patient.koreanName} showMrn={false} /> : '—'}</p>
        {s.patient && <span className="font-mono text-sm text-gray-300">{s.patient.mrn}</span>}
        {age != null && <span className="text-sm text-gray-300"><Tf k="{나이}세" params={{ 나이: age }} /> · <T k={genderText(s.patient?.gender)} /></span>}
        {s.patient && <span className="rounded-lg bg-white px-1 py-0.5"><AllergyStatusBadge patientId={s.patient.id} /></span>}
        <span className="ml-auto"><StatusBadge domain="surgery" status={s.status} /></span>
      </div>
      <p className="mt-1 text-base font-semibold"><Data>{s.procedureName}</Data>
        {(s.bodySite || s.laterality) && <span className="ml-2 rounded bg-amber-400 px-1.5 py-0.5 text-xs font-bold text-gray-900"><Data>{[s.bodySite, s.laterality].filter(Boolean).join(' · ')}</Data></span>}
      </p>
      <p className="mt-0.5 text-xs text-gray-300">
        <T k="집도" /> <Data>{s.surgeon ?? '—'}</Data> · <T k="마취" /> {anesthesiaText(s.anesthesiaType)}{s.asaClass && <> · ASA <Data>{s.asaClass}</Data></>}
        {s.startedAt && <> · <T k="시작" /> <KDate value={s.startedAt} mode="time" /> (<Duration minutes={Math.floor(((s.endedAt ? Date.parse(s.endedAt) : Date.now()) - Date.parse(s.startedAt)) / 60000)} dense />)</>}
      </p>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-gray-300">
        <span><T k="소독 간호" /> <Data>{s.scrubNurse ? (s.scrubNurse.name ?? '—') : '—'}</Data></span>
        <CirculatingSlot c={c} queryKey={queryKey} />
      </p>
      <FlowStrip c={c} />
      {/* 녹화 — HIS 에 촬영·녹화 연동이 없다(결정 or.recording.cctvOperation 대기) · 녹화하는 척하지 않는다 */}
      <p className="mt-1 text-[11px] text-gray-400" data-or-recording="none"><T k="녹화 연동 없음 — 이 화면은 영상을 녹화하지 않습니다." /></p>
    </section>
  );
}

// ───────────────────────── 단계 ─────────────────────────
function PhasesPanel({ c, queryKey }: { c: OrChart; queryKey: unknown[] }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [at, setAt] = useState('');
  const stamp = useMutation({
    mutationFn: (phase: string) => apiClient.post(`/api/v1/surgery/${c.surgery.id}/intraop/phase`, { phase, at: isoOf(at) }),
    onSuccess: () => { toast.success(tAttr('단계 시각을 기록했습니다.')); setAt(''); qc.invalidateQueries({ queryKey }); },
    // 409(이미 기록됨)면 다른 사람이 먼저 찍은 것 — 차트를 다시 받아 그 시각을 보여 준다(다음 폴링까지 버튼이 남지 않게)
    onError: (e) => { toast.error(extractErrorMessage(e) || tAttr('단계를 기록하지 못했습니다.')); qc.invalidateQueries({ queryKey }); },
  });
  return (
    <Panel title={<T k="단계·시각" />} right={c.writePolicy.canWrite ? <AtInput value={at} onChange={setAt} /> : undefined}>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(120px,1fr))] gap-2" data-or-phases>
        {INTRAOP_PHASE_STAMPS.map((p) => {
          const t = c.phases[p];
          return t ? (
            <div key={p} className="rounded-xl bg-emerald-50 px-3 py-2 text-center">
              <p className="text-xs font-semibold text-emerald-800"><T k={INTRAOP_PHASE_STAMP_LABEL[p]} /></p>
              <p className="text-lg font-black tabular-nums text-emerald-900"><KDate value={t} mode="time" /></p>
            </div>
          ) : !c.writePolicy.canWrite ? (
            <div key={p} className="rounded-xl border-2 border-dashed border-gray-200 px-3 py-2 text-center text-gray-400">
              <p className="text-xs font-semibold"><T k={INTRAOP_PHASE_STAMP_LABEL[p]} /></p>
              <p className="text-[11px]">—</p>
            </div>
          ) : (
            <button key={p} type="button" onClick={() => stamp.mutate(p)} disabled={stamp.isPending}
              className="min-h-[64px] rounded-xl border-2 border-dashed border-gray-300 px-3 py-2 text-center hover:border-indigo-400 hover:bg-indigo-50 disabled:opacity-50">
              <p className="text-xs font-semibold text-gray-700"><T k={INTRAOP_PHASE_STAMP_LABEL[p]} /></p>
              <p className="text-[11px] text-indigo-600">{at ? <T k="입력한 시각으로 기록" /> : <T k="지금 기록" />}</p>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-gray-400">
        <T k="수술 시작" /> {c.phases.START ? <KDate value={c.phases.START} mode="time" /> : '—'} · <T k="수술 종료" /> {c.phases.END ? <KDate value={c.phases.END} mode="time" /> : '—'}
        {' · '}<T k="이미 기록된 단계는 덮어쓰지 않습니다 — 바로잡을 때는 수술 기록·마취 기록에서." />
      </p>
    </Panel>
  );
}

// ───────────────────────── 활력 ─────────────────────────
const SERIES: { key: keyof IntraopVitalPoint; label: string; color: string }[] = [
  { key: 'heartRate', label: 'HR', color: '#e11d48' },
  { key: 'systolicBp', label: 'SBP', color: '#2563eb' },
  { key: 'diastolicBp', label: 'DBP', color: '#60a5fa' },
  { key: 'spo2', label: 'SpO₂', color: '#0891b2' },
  { key: 'etco2', label: 'EtCO₂', color: '#7c3aed' },
];

function VitalsChart({ pts }: { pts: IntraopVitalPoint[] }) {
  const W = 640; const H = 180; const P = 28;
  const ts = pts.map((p) => Date.parse(p.at));
  const t0 = Math.min(...ts); const t1 = Math.max(...ts, t0 + 60_000);
  const x = (t: number) => P + ((t - t0) / (t1 - t0)) * (W - P * 2);
  const y = (v: number) => H - P - (Math.min(Math.max(v, 0), 200) / 200) * (H - P * 2);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-44 w-full" role="img" aria-label="vitals">
      {[0, 50, 100, 150, 200].map((g) => <g key={g}><line x1={P} x2={W - P} y1={y(g)} y2={y(g)} stroke="#e5e7eb" /><text x={4} y={y(g) + 3} fontSize="9" fill="#9ca3af">{g}</text></g>)}
      {SERIES.map((s) => {
        const xs = pts.map((p) => ({ t: Date.parse(p.at), v: p[s.key] as number | null })).filter((d): d is { t: number; v: number } => d.v != null);
        if (!xs.length) return null;
        return (
          <g key={s.key}>
            {xs.length > 1 && <path d={xs.map((d, i) => `${i ? 'L' : 'M'}${x(d.t)},${y(d.v)}`).join(' ')} fill="none" stroke={s.color} strokeWidth="1.8" />}
            {xs.map((d, i) => <circle key={i} cx={x(d.t)} cy={y(d.v)} r="2.5" fill={s.color} />)}
          </g>
        );
      })}
    </svg>
  );
}

function VitalsPanel({ c, queryKey }: { c: OrChart; queryKey: unknown[] }) {
  const tAttr = useTAttr();
  const add = useAddEvent(c.surgery.id, queryKey);
  const [f, setF] = useState<Record<string, string>>({});
  const [at, setAt] = useState('');
  const ledger = intraopVitalsOf(live(c.events, 'VITALS').map((e) => ({ ...e.payload, time: e.occurredAt }))) ?? [];
  const pts = [...(c.legacyVitals ?? []), ...ledger].sort((a, b) => a.at.localeCompare(b.at));
  const last = pts[pts.length - 1];
  const fields: { k: string; label: string }[] = [
    { k: 'heartRate', label: 'HR' }, { k: 'systolicBp', label: 'SBP' }, { k: 'diastolicBp', label: 'DBP' },
    { k: 'spo2', label: 'SpO₂' }, { k: 'etco2', label: 'EtCO₂' }, { k: 'temperature', label: 'Temp' },
  ];
  const submit = () => {
    const payload: Record<string, number> = {};
    for (const { k } of fields) if (f[k]?.trim()) payload[k] = Number(f[k]);
    add.mutate({ kind: 'VITALS', payload, occurredAt: isoOf(at) }, { onSuccess: () => { setF({}); setAt(''); } });
  };
  return (
    <Panel title={<T k="활력" />} right={last ? <span className="text-[11px] text-gray-500"><T k="마지막 측정" /> <KDate value={last.at} mode="time" /></span> : undefined}>
      {pts.length === 0
        ? <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800"><T k="수술 중 활력 기록 없음" /></p>
        : (
          <>
            <div className="mb-1 flex flex-wrap gap-3 text-xs" data-or-vitals-latest>
              {SERIES.map((s) => <span key={s.key}><span style={{ color: s.color }}>●</span> {s.label} <b className="tabular-nums">{num(last?.[s.key]) ?? '—'}</b></span>)}
            </div>
            <VitalsChart pts={pts} />
            {(c.legacyVitals?.length ?? 0) > 0 && <p className="text-[10px] text-gray-400"><Tf k="이전 마취 기록의 활력 {수}점 포함(읽기 전용)" params={{ 수: c.legacyVitals!.length }} /></p>}
          </>
        )}
      {c.writePolicy.canWrite && (<>
      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {fields.map(({ k, label }) => (
          <label key={k} className="text-[11px] text-gray-500">{label}
            <input inputMode="decimal" value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} aria-label={label}
              className="mt-0.5 w-full rounded-lg border border-gray-200 px-2 py-2 text-base tabular-nums" />
          </label>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <AtInput value={at} onChange={setAt} />
        <button type="button" onClick={submit} disabled={add.isPending || !fields.some(({ k }) => f[k]?.trim())}
          className="ml-auto min-h-[44px] rounded-xl bg-rose-600 px-4 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-40">
          {tAttr('활력 기록')}
        </button>
      </div>
      </>)}
    </Panel>
  );
}

// ───────────────────────── 약물·수액·배출 ─────────────────────────
type MedKind = 'DRUG' | 'FLUID' | 'BLOOD' | 'OUTPUT';
function MedsPanel({ c, queryKey }: { c: OrChart; queryKey: unknown[] }) {
  const tAttr = useTAttr();
  const add = useAddEvent(c.surgery.id, queryKey);
  const [kind, setKind] = useState<MedKind>('DRUG');
  const [f, setF] = useState<Record<string, string>>({});
  const [at, setAt] = useState('');
  // 합계는 서버 요약(정본 intraopSummaryOf · 무효 제외 · 정본 반올림)과 같은 값 — 기록이 없으면 '기록 없음'(0 mL 아님)
  const io = c.summary.io;
  const mlText = (v: number | null) => (v == null ? <span className="text-sm font-normal text-gray-400"><T k="기록 없음" /></span> : `${v} mL`);
  const inputs: Record<MedKind, { k: string; label: string; numeric?: boolean }[]> = {
    DRUG: [{ k: 'name', label: '약물' }, { k: 'dose', label: '용량', numeric: true }, { k: 'unit', label: '단위' }, { k: 'route', label: '경로' }],
    FLUID: [{ k: 'name', label: '수액' }, { k: 'volumeMl', label: 'mL', numeric: true }],
    BLOOD: [{ k: 'product', label: '제제' }, { k: 'units', label: '단위 수', numeric: true }, { k: 'volumeMl', label: 'mL', numeric: true }, { k: 'unitNo', label: '혈액번호' }],
    OUTPUT: [{ k: 'volumeMl', label: 'mL', numeric: true }],
  };
  const submit = () => {
    const payload: Record<string, unknown> = {};
    for (const i of inputs[kind]) if (f[i.k]?.trim()) payload[i.k] = i.numeric ? Number(f[i.k]) : f[i.k].trim();
    if (kind === 'OUTPUT') payload.type = f.type;
    add.mutate({ kind, payload, occurredAt: isoOf(at) }, { onSuccess: () => { setF({}); setAt(''); } });
  };
  const rows = live(c.events).filter((e) => ['DRUG', 'FLUID', 'BLOOD', 'OUTPUT'].includes(e.kind)).slice(-30).reverse();
  return (
    <Panel title={<T k="약물·수액·배출" />}>
      <div className="mb-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4" data-or-io>
        <div className="rounded-lg bg-sky-50 px-2.5 py-1.5"><p className="text-sky-700"><T k="수액" /></p><p className="text-base font-bold tabular-nums">{mlText(io.fluidMl)}</p></div>
        <div className="rounded-lg bg-rose-50 px-2.5 py-1.5"><p className="text-rose-700"><T k="혈액" /></p><p className="text-base font-bold tabular-nums">{mlText(io.bloodMl)}</p></div>
        <div className="rounded-lg bg-amber-50 px-2.5 py-1.5"><p className="text-amber-700"><T k="소변" /></p><p className="text-base font-bold tabular-nums">{mlText(io.urineMl)}</p></div>
        <div className="rounded-lg bg-red-50 px-2.5 py-1.5"><p className="text-red-700"><T k="실혈" /></p><p className="text-base font-bold tabular-nums">{mlText(io.bloodLossMl)}</p></div>
      </div>
      <p className="-mt-2 mb-2 text-[10px] text-gray-400"><T k="이 화면에 적힌 기록의 합 — mL 로 적지 않은 혈액(단위 수만)은 합에 들어가지 않습니다." /></p>
      {c.writePolicy.canWrite && (<>
      <div className="flex flex-wrap gap-1" role="tablist">
        {(['DRUG', 'FLUID', 'BLOOD', 'OUTPUT'] as MedKind[]).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => { setKind(k); setF({}); }}
            className={`min-h-[36px] rounded-lg px-3 text-xs font-semibold ${kind === k ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>
            <T k={INTRAOP_EVENT_LABEL[k]} />
          </button>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {kind === 'OUTPUT' && (
          <label className="text-[11px] text-gray-500"><T k="종류" />
            <select value={f.type ?? ''} onChange={(e) => setF({ ...f, type: e.target.value })} className="mt-0.5 w-full rounded-lg border border-gray-200 px-2 py-2 text-sm">
              <option value="">{tAttr('— 선택 —')}</option>
              {OUTPUT_TYPES.map((t) => <option key={t} value={t}>{tAttr(OUTPUT_TYPE_LABEL[t])}</option>)}
            </select>
          </label>
        )}
        {inputs[kind].map((i) => (
          <label key={i.k} className="text-[11px] text-gray-500"><T k={i.label} />
            <input inputMode={i.numeric ? 'decimal' : 'text'} value={f[i.k] ?? ''} onChange={(e) => setF({ ...f, [i.k]: e.target.value })}
              className="mt-0.5 w-full rounded-lg border border-gray-200 px-2 py-2 text-sm" />
          </label>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <AtInput value={at} onChange={setAt} />
        <button type="button" onClick={submit} disabled={add.isPending}
          className="ml-auto min-h-[44px] rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-40">
          <T k="기록" />
        </button>
      </div>
      </>)}
      <ul className="mt-3 divide-y divide-gray-100 text-xs">
        {rows.map((e) => <li key={e.id} className="flex gap-2 py-1.5"><span className="w-12 tabular-nums text-gray-500"><KDate value={e.occurredAt} mode="time" /></span><EventText e={e} /></li>)}
      </ul>
    </Panel>
  );
}

/** 기록 한 줄을 사람 말로 — 저장된 칸만(지어내지 않는다) */
function EventText({ e }: { e: ChartEvent }) {
  const p = e.payload;
  const s = (v: unknown) => (v == null ? '' : String(v));
  switch (e.kind) {
    case 'VITALS': return <span className="text-gray-700">{SERIES.filter((x) => p[x.key] != null).map((x) => `${x.label} ${s(p[x.key])}`).join(' · ')}{p.temperature != null && ` · Temp ${s(p.temperature)}`}</span>;
    case 'DRUG': return <span><Data>{`${s(p.name)} ${s(p.dose)}${s(p.unit)}${p.route ? ` ${s(p.route)}` : ''}`}</Data></span>;
    case 'FLUID': return <span><Data>{`${s(p.name)} ${s(p.volumeMl)}mL`}</Data></span>;
    case 'BLOOD': return <span><Data>{`${s(p.product)}${p.units != null ? ` ${s(p.units)}U` : ''}${p.volumeMl != null ? ` ${s(p.volumeMl)}mL` : ''}${p.unitNo ? ` #${s(p.unitNo)}` : ''}`}</Data></span>;
    case 'OUTPUT': return <span><T k={OUTPUT_TYPE_LABEL[p.type as keyof typeof OUTPUT_TYPE_LABEL] ?? '기타'} /> {s(p.volumeMl)}mL</span>;
    case 'PHASE': return <span className="font-semibold"><T k={INTRAOP_PHASE_STAMP_LABEL[p.phase as keyof typeof INTRAOP_PHASE_STAMP_LABEL] ?? s(p.phase)} /></span>;
    default: return (
      <span className="whitespace-pre-wrap">
        {p.inputMethod === 'VOICE' && <span className="mr-1 rounded bg-violet-100 px-1 text-[10px] text-violet-700"><T k="음성" /></span>}
        <Data>{s(p.text)}</Data>
      </span>
    );
  }
}

// ───────────────────────── 흐름 ─────────────────────────
function TimelinePanel({ c, queryKey }: { c: OrChart; queryKey: unknown[] }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const me = useAuthStore((s) => s.user);
  const [showVoided, setShowVoided] = useState(false);
  const voidM = useMutation({
    mutationFn: (v: { id: string; reason: string }) => apiClient.post(`/api/v1/surgery/${c.surgery.id}/intraop/events/${v.id}/void`, { reason: v.reason }),
    onSuccess: () => { toast.success(tAttr('무효로 처리했습니다.')); qc.invalidateQueries({ queryKey }); },
    onError: (e) => toast.error(extractErrorMessage(e) || tAttr('무효로 처리하지 못했습니다.')),
  });
  const [voiding, setVoiding] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const list = [...c.events].filter((e) => showVoided || !e.voidedAt).reverse();
  return (
    <Panel title={<T k="수술 중 기록 흐름" />} right={
      <label className="flex items-center gap-1 text-[11px] text-gray-500"><input type="checkbox" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} /><T k="무효 포함" /></label>
    }>
      {list.length === 0 ? <p className="text-sm text-gray-400"><T k="아직 기록이 없습니다." /></p> : (
        <ol className="space-y-1.5" data-or-timeline>
          {list.map((e) => (
            <li key={e.id} className={`rounded-lg border px-2.5 py-1.5 text-xs ${e.voidedAt ? 'border-gray-100 bg-gray-50 text-gray-400 line-through' : 'border-gray-100'}`}>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="tabular-nums font-semibold"><KDate value={e.occurredAt} mode="time" /></span>
                <span className="rounded bg-gray-100 px-1 text-[10px] text-gray-600"><T k={INTRAOP_EVENT_LABEL[e.kind]} /></span>
                <EventText e={e} />
                <span className="ml-auto text-[10px] text-gray-400 no-underline">
                  <Data>{e.recordedBy.name ?? '—'}</Data>
                  {e.occurredAtSource === 'USER_CLAIMED' && <> · <T k="입력한 시각" /></>}
                  {e.lateEntry && <> · <T k="수술 종료 후 기록" /></>}
                </span>
                {!e.voidedAt && e.kind !== 'PHASE' && (me?.id === e.recordedBy.id || me?.role === 'ADMIN') && (
                  <button type="button" onClick={() => { setVoiding(e.id); setReason(''); }} className="text-[10px] text-rose-600 hover:underline"><T k="무효" /></button>
                )}
              </div>
              {e.voidedAt && <p className="mt-0.5 text-[10px] no-underline"><T k="무효" /> · <Data>{e.voidedBy?.name ?? ''}</Data> · <Data>{e.voidReason ?? ''}</Data></p>}
              {voiding === e.id && (
                <div className="mt-1.5 flex gap-1.5">
                  <input value={reason} onChange={(ev) => setReason(ev.target.value)} placeholder={tAttr('무효 사유')} className="flex-1 rounded border border-gray-200 px-2 py-1" />
                  <button type="button" disabled={!reason.trim() || voidM.isPending} onClick={() => voidM.mutate({ id: e.id, reason }, { onSuccess: () => setVoiding(null) })}
                    className="rounded bg-rose-600 px-2 text-white disabled:opacity-40"><T k="무효 처리" /></button>
                  <button type="button" onClick={() => setVoiding(null)} className="rounded px-2 text-gray-500"><T k="취소" /></button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

// ───────────────────────── 메모 ─────────────────────────
function NotesPanel({ c, queryKey }: { c: OrChart; queryKey: unknown[] }) {
  const add = useAddEvent(c.surgery.id, queryKey);
  const [text, setText] = useState('');
  const [kind, setKind] = useState<'NOTE' | 'EVENT'>('NOTE');
  // 음성 인식 문장이 들어갔는지 — 저장 시 출처로 남긴다(사람이 고쳐 써도 출발은 음성)
  const [voiced, setVoiced] = useState(false);
  return (
    <Panel title={<T k="메모" />}>
      {!c.writePolicy.canWrite ? <p className="text-xs text-gray-500" data-or-readonly-notes><T k="읽기 전용 — 기록 흐름에서 메모를 봅니다." /></p> : (<>
      <div className="mb-2 flex gap-1">
        {(['NOTE', 'EVENT'] as const).map((k) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={`min-h-[36px] rounded-lg px-3 text-xs font-semibold ${kind === k ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>
            <T k={INTRAOP_EVENT_LABEL[k]} />
          </button>
        ))}
      </div>
      <OrVoiceDictation surgeryId={c.surgery.id} onText={(t) => { setText((cur) => (cur.trim() ? `${cur.trimEnd()} ${t}` : t)); setVoiced(true); }} />
      <textarea value={text} onChange={(e) => { setText(e.target.value); if (!e.target.value) setVoiced(false); }} rows={3} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" />
      <div className="mt-2 flex items-center">
        {voiced && <p className="text-[10px] text-violet-700"><T k="음성 인식 문장 포함 — 저장하면 '음성' 출처가 함께 남습니다." /></p>}
        <button type="button" disabled={!text.trim() || add.isPending}
          onClick={() => add.mutate({ kind, payload: { text, ...(voiced ? { inputMethod: 'VOICE' } : {}) } }, { onSuccess: () => { setText(''); setVoiced(false); } })}
          className="ml-auto min-h-[44px] rounded-xl bg-gray-900 px-4 text-sm font-semibold text-white disabled:opacity-40"><T k="기록" /></button>
      </div>
      </>)}
    </Panel>
  );
}

export function renderPanel(p: OrPanel, c: OrChart, queryKey: unknown[]): React.ReactNode {
  switch (p) {
    case 'header': return <HeaderPanel c={c} queryKey={queryKey} />;
    case 'phases': return <PhasesPanel c={c} queryKey={queryKey} />;
    case 'vitals': return <VitalsPanel c={c} queryKey={queryKey} />;
    case 'meds': return <MedsPanel c={c} queryKey={queryKey} />;
    case 'timeline': return <TimelinePanel c={c} queryKey={queryKey} />;
    case 'safety': return <Panel title={<T k="안전 체크리스트" />}><SurgicalChecklistPanel surgeryId={c.surgery.id} status={c.surgery.status} /></Panel>;
    case 'opnote': return <Panel title={<T k="수술 기록" />}><OpNotePanel surgeryId={c.surgery.id} /></Panel>;
    case 'notes': return <NotesPanel c={c} queryKey={queryKey} />;
    case 'summary': return <SummaryPanel c={c} Panel={Panel} />;
  }
}
