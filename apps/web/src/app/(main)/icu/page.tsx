'use client';

import { useState } from 'react';
import { Ratio, Unit } from '@/components/ui/display';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { useHasRole } from '@/hooks/use-admin-write';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { PatientAvatar } from '@/components/PatientAvatar';
import StatCard from '@/components/ui/StatCard';
import { pollMs, kdate } from '@/lib/ui-settings';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { VitalHeaderCells, VitalRowCells, VitalSignsStrip } from '@/components/vitals/VitalSigns';
import { useVitalsThresholds } from '@/lib/vital-flags';
import type { VitalSignKey } from '@hospital-run/shared';

/** 플로시트 활력 열(표준 순서는 부품이 정한다) · 병상 카드·목록은 핵심 셋 */
const ICU_FLOW_VITALS: readonly VitalSignKey[] = ['respiratoryRate', 'spo2', 'systolicBp', 'heartRate', 'temperature'];
const ICU_CARD_VITALS: readonly VitalSignKey[] = ['spo2', 'systolicBp', 'heartRate'];

// ─── Types ─────────────────────────────────────────────────────────────────

interface IcuRecord {
  id: string;
  recordedAt: string;
  heartRate?: number;
  systolicBp?: number;
  diastolicBp?: number;
  spo2?: number;
  respiratoryRate?: number;
  temperature?: number;
  gcScore?: number;
  consciousness?: string;
  pupilReaction?: string;
  intakeOral?: number;
  intakeIv?: number;
  intakeOther?: number;
  outputUrine?: number;
  outputDrain?: number;
  outputOther?: number;
  ventMode?: string;
  fio2?: number;
  peep?: number;
  tidalVolume?: number;
  pip?: number;
  apacheScore?: number;
  sofaScore?: number;
  painScore?: number;
  sedationScore?: number;
  notes?: string;
}

interface IcuPatient {
  familyName: string;
  givenName: string;
  patientNumber?: string;
}

interface IcuAdmission {
  /** 실제로 점수가 기록된 가장 최근 값 — APACHE·SOFA 는 매 활력마다 적지 않는다 */
  latestScores?: { apacheScore: number | null; sofaScore: number | null; scoredAt: string } | null;
  id: string;
  severity?: string;
  ventilator?: boolean;
  isolation?: boolean;
  admitReason?: string;
  admitDate?: string;
  patient?: IcuPatient;
  icuBed?: { bedNumber: string };
  records?: IcuRecord[];
  /** 🔴 기록이 없는 항목·합계는 null(기록 없음) — 0 과 다른 사실(2026-09-15 서버 봉합) */
  ioTotal?: IoTotals;
  ioTotals?: IoTotals;
  ventilatorSettings?: Record<string, unknown>;
}

interface IoTotals {
  totalIntake?: number | null; totalOutput?: number | null; balance?: number | null;
  intakeOral?: number | null; intakeIv?: number | null; outputUrine?: number | null; outputDrain?: number | null;
}

interface IcuBed {
  id: string;
  bedNumber: string;
  status: string;
  unitName: string;
  admissions?: IcuAdmission[];
}

interface IcuDashboard {
  totalBeds: number;
  occupied: number;
  available: number;
  /** 🔴 등록 ICU 병상 0 이면 `null`(산출 불가) — 0% 가 아니다(2026-08-20 서버 봉합) */
  occupancyRate: number | null;
  ventilatorCount?: number;
  isolationCount?: number;
  severityCounts?: Record<string, number>;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const SEVERITY_COLOR: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-700 border-red-200',
  SEVERE:   'bg-orange-100 text-orange-700 border-orange-200',
  MODERATE: 'bg-yellow-100 text-yellow-700 border-yellow-200',
};
const STATUS_DOT: Record<string, string> = {
  AVAILABLE:   'bg-emerald-400',
  OCCUPIED:    'bg-red-400',
  MAINTENANCE: 'bg-gray-400',
};
/* 🔴 색만으로 병상 상태를 말하지 않는다(§4.6) — 의미는 색이 아니라 bed.status 에서 가져온다.
   STATUS_DOT 에 없는 상태는 '사용 가능'으로 접지 않고 원문 그대로 말한다. */
const STATUS_WORD: Record<string, string> = {
  AVAILABLE: '사용 가능', OCCUPIED: '재실', MAINTENANCE: '정비 중',
};
const bedStatusWord = (s?: string | null) => (s ? STATUS_WORD[s] ?? s : '상태 미상');
const EMPTY_FORM = {
  heartRate: '', systolicBp: '', diastolicBp: '', spo2: '', respiratoryRate: '', temperature: '',
  gcScore: '', consciousness: '', pupilReaction: '',
  intakeOral: '', intakeIv: '', intakeOther: '', outputUrine: '', outputDrain: '', outputOther: '',
  ventMode: '', fio2: '', peep: '', tidalVolume: '', pip: '',
  apacheScore: '', sofaScore: '', painScore: '', sedationScore: '',
  notes: '',
};

// ─── Sub-components ──────────────────────────────────────────────────────────

/* StatCard: moved to @/components/ui/StatCard */

function SeverityBadge({ severity }: { severity?: string }) {
  if (!severity) return null;
  return (
    <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded-full border ${SEVERITY_COLOR[severity] ?? 'bg-gray-100 text-gray-600 border-gray-200'}`}>
      {severity === 'CRITICAL' ? '위험' : severity === 'SEVERE' ? '중증' : '중등'}
    </span>
  );
}

function IOBalanceCard({ detail }: { detail: IcuAdmission }) {
  const io = detail?.ioTotal ?? detail?.ioTotals;
  if (!io) return null;
  // 🔴 (2026-09-15) 종전 `(io.totalIntake ?? 0) - (io.totalOutput ?? 0)` 은 I/O 를 적지 않은 날을 균형 0,
  //    섭취만 적은 날을 섭취량 전체만큼 양의 균형으로 그렸다. 한쪽이라도 기록이 없으면 균형은 산출 불가.
  const balance = io.totalIntake != null && io.totalOutput != null ? io.totalIntake - io.totalOutput : null;
  const isPos = balance != null && balance >= 0;
  const ml = (v?: number | null) => (v == null ? <span className="text-xs font-medium text-gray-400"><T k="기록 없음" /></span> : v);
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <h4 className="text-xs font-bold text-gray-500 mb-3"><T k="수분 I/O (오늘)" /></h4>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <p className="text-[10px] text-gray-400"><T k="섭취" /></p>
          <p className="text-lg font-bold text-blue-600">{ml(io.totalIntake)}</p>
          <p className="text-[10px] text-gray-400">ml</p>
        </div>
        <div>
          <p className="text-[10px] text-gray-400"><T k="배출" /></p>
          <p className="text-lg font-bold text-red-600">{ml(io.totalOutput)}</p>
          <p className="text-[10px] text-gray-400">ml</p>
        </div>
        <div>
          <p className="text-[10px] text-gray-400"><T k="균형" /></p>
          {balance == null ? (
            <p className="text-xs font-medium text-gray-400 py-1.5"><T k="기록 없음" /></p>
          ) : (
            <p className={`text-lg font-bold ${isPos ? 'text-blue-600' : 'text-red-600'}`}>
              {isPos ? '+' : ''}{balance}
            </p>
          )}
          <p className="text-[10px] text-gray-400">ml</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-1 text-[11px]">
        <span className="text-gray-500"><T k="경구" />: <b>{ml(io.intakeOral)}</b></span>
        <span className="text-gray-500">IV: <b>{ml(io.intakeIv)}</b></span>
        <span className="text-gray-500"><T k="소변" />: <b>{ml(io.outputUrine)}</b></span>
        <span className="text-gray-500"><T k="배액" />: <b>{ml(io.outputDrain)}</b></span>
      </div>
    </div>
  );
}

function VentilatorCard({ detail }: { detail: IcuAdmission }) {
  const raw = detail?.ventilatorSettings ?? detail?.records?.[0];
  if (!raw || !detail?.ventilator) return null;
  const v = raw as Record<string, unknown>;
  return (
    <div className="bg-white rounded-2xl border border-amber-100 shadow-sm p-4">
      <h4 className="text-xs font-bold text-gray-500 mb-3"><T k="인공호흡기 설정" /></h4>
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          { label: '모드', value: (v.ventMode as string) ?? '-' },
          { label: 'FiO₂', value: v.fio2 != null ? `${v.fio2}%` : '-' },
          { label: 'PEEP', value: v.peep != null ? `${v.peep} cmH₂O` : '-' },
          { label: '일회호흡량', value: v.tidalVolume != null ? `${v.tidalVolume} ml` : '-' },
          { label: 'PIP', value: v.pip != null ? `${v.pip} cmH₂O` : '-' },
        ].map(({ label, value }) => (
          <div key={label} className="bg-amber-50 rounded-xl p-2">
            <T k={label} className="text-[10px] text-amber-600 block" />
            <p className="text-sm font-bold text-amber-800">{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScoresCard({ detail }: { detail: IcuAdmission }) {
  const r = detail?.records?.[0];
  if (!r) return null;
  const scores = [
    { label: 'APACHE II', value: r.apacheScore, max: 71, color: 'red' },
    { label: 'SOFA', value: r.sofaScore, max: 24, color: 'orange' },
    { label: 'GCS', value: r.gcScore, max: 15, color: 'blue' },
    { label: '통증 (NRS)', value: r.painScore, max: 10, color: 'purple' },
    { label: '진정 (RASS)', value: r.sedationScore, max: null, color: 'slate' },
  ];
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <h4 className="text-xs font-bold text-gray-500 mb-3"><T k="중증도 점수" /></h4>
      <div className="grid grid-cols-5 gap-2 text-center">
        {scores.map(({ label, value, max }) => (
          <div key={label} className="bg-gray-50 rounded-xl p-2">
            <T k={label} className="text-[10px] text-gray-400 leading-tight block" />
            <p className="text-base font-bold text-gray-800">{value ?? '-'}</p>
            {max && <p className="text-[10px] text-gray-400">/ {max}</p>}
          </div>
        ))}
      </div>
      <AutoScores admissionId={detail.id} />
    </div>
  );
}

// 실계산 자동 산출(APACHE II·SOFA) — 최신 활력 기반, 검사성분 미연동 명시
function AutoScores({ admissionId }: { admissionId: string }) {
  const [show, setShow] = useState(false);
  const uw = (d: unknown) => { const raw = (d as { data?: unknown })?.data; return (raw && typeof raw === 'object' && 'data' in (raw as object) ? (raw as { data: unknown }).data : raw) as Record<string, unknown> | undefined; };
  const apache = useQuery({ queryKey: ['icu-apache', admissionId], queryFn: () => apiClient.get(`/api/v1/icu/${admissionId}/apache`), enabled: show });
  const sofa = useQuery({ queryKey: ['icu-sofa', admissionId], queryFn: () => apiClient.get(`/api/v1/icu/${admissionId}/sofa`), enabled: show });
  const a = uw(apache.data); const s = uw(sofa.data);
  const note = (a?.note as string) || (s?.note as string);
  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      {!show ? (
        <button onClick={() => setShow(true)} className="text-[11px] text-blue-600 hover:underline"><T k="최신 활력으로 자동 산출(APACHE II·SOFA)" /></button>
      ) : (
        <div className="space-y-1.5">
          <div className="flex gap-2 text-xs">
            <span className="px-2 py-1 rounded-lg bg-red-50 text-red-700 font-medium">APACHE II <b>{a?.score != null ? String(a.score) : '-'}</b></span>
            <span className="px-2 py-1 rounded-lg bg-orange-50 text-orange-700 font-medium">SOFA <b>{s?.totalScore != null ? String(s.totalScore) : '-'}</b></span>
            {a?.mortalityEstimate != null && <span className="px-2 py-1 rounded-lg bg-gray-50 text-gray-600"><T k="추정 사망률" /> ~{String(a.mortalityEstimate)}<Unit>%</Unit></span>}
          </div>
          {note && <p className="text-[10px] text-amber-600 leading-tight">⚠ {note}</p>}
        </div>
      )}
    </div>
  );
}

function FlowsheetTable({ admissionId }: { admissionId: string }) {
  const { data } = useQuery({
    queryKey: ['icu-flowsheet', admissionId],
    queryFn: () => apiClient.get<{ data: { records: IcuRecord[] } }>(`/api/v1/icu/${admissionId}/flowsheet`),
    refetchInterval: pollMs('normal'),
  });
  const records: IcuRecord[] = data?.data?.records ?? [];
  const vitalsRule = useVitalsThresholds();
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <h4 className="text-xs font-bold text-gray-500"><T k="플로우시트 (최근 24시간)" /></h4>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              <th className="px-3 py-2 text-left font-medium text-gray-500 whitespace-nowrap"><T k="시간" /></th>
              {/* 활력 열은 표시 부품 정본(표준 순서·단위는 머리줄) */}
              <VitalHeaderCells keys={ICU_FLOW_VITALS} className="px-3 py-2 text-left font-medium text-gray-500 whitespace-nowrap" />
              {['GCS', '섭취', '배출', 'Vent모드', '비고'].map((h) => (
                <th key={h} className="px-3 py-2 text-left font-medium text-gray-500 whitespace-nowrap"><T k={h} /></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {records.length === 0 ? (
              <tr><td colSpan={11} className="py-8 text-center text-gray-400"><T k="기록 없음" /></td></tr>
            ) : records.map((rec) => {
              const intakeSum = (rec.intakeOral ?? 0) + (rec.intakeIv ?? 0) + (rec.intakeOther ?? 0);
              const outputSum = (rec.outputUrine ?? 0) + (rec.outputDrain ?? 0) + (rec.outputOther ?? 0);
              // 🔴 **배설량 0 은 감출 값이 아니다.** 무뇨(anuria)·핍뇨는 신부전·쇼크의 신호다.
              //    종전 `sum > 0 ? sum : '-'` 은 기록된 0 을 "기록 없음"처럼 보이게 했다.
              //    같은 표에서 심박수·SpO2 는 `?? '-'` 로 null 과 0 을 구분한다 — I/O 만 예외였다.
              const intakeRecorded = rec.intakeOral != null || rec.intakeIv != null || rec.intakeOther != null;
              const outputRecorded = rec.outputUrine != null || rec.outputDrain != null || rec.outputOther != null;
              return (
                <tr key={rec.id} className="border-b border-gray-50 hover:bg-blue-50/20">
                  <td className="px-3 py-2 tabular-nums text-gray-600 whitespace-nowrap">
                    {kdate(rec.recordedAt, 'time')}
                  </td>
                  {/* 🔴 (2026-10-07) 혈압 truthy(0 숨김)·`°` 단위·이상 색 없음 → 표시 부품 정본(미측정 '—'·임계 정본 색) */}
                  <VitalRowCells vitals={rec as unknown as Record<string, unknown>} keys={ICU_FLOW_VITALS} rule={vitalsRule} className="px-3 py-2 tabular-nums whitespace-nowrap" />
                  <td className="px-3 py-2 tabular-nums">{rec.gcScore ?? '-'}</td>
                  <td className="px-3 py-2 tabular-nums">{intakeRecorded ? intakeSum : '-'}</td>
                  <td className={`px-3 py-2 tabular-nums ${outputRecorded && outputSum === 0 ? 'font-bold text-red-600' : ''}`}
                      title={outputRecorded && outputSum === 0 ? '배설량 0 — 무뇨/핍뇨 확인 필요' : undefined}>
                    {outputRecorded ? outputSum : '-'}
                  </td>
                  <td className="px-3 py-2">{rec.ventMode ?? '-'}</td>
                  <td className="px-3 py-2 text-gray-500 max-w-[120px] truncate">{rec.notes ?? ''}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RecordForm({ admissionId, onSuccess }: { admissionId: string; onSuccess: () => void }) {
  const tA = useTAttr();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: (payload: Record<string, string | number>) =>
      apiClient.post(`/api/v1/icu/${admissionId}/record`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['icu-flowsheet', admissionId] });
      qc.invalidateQueries({ queryKey: ['icu-detail', admissionId] });
      qc.invalidateQueries({ queryKey: ['icu-patients'] });
      setForm({ ...EMPTY_FORM });
      onSuccess();
    },
  });

  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const handleSubmit = () => {
    const payload: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(form)) {
      if (v !== '') payload[k] = isNaN(Number(v)) ? v : Number(v);
    }
    mutation.mutate(payload);
  };

  const inputCls = 'w-full rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400';
  const labelCls = 'text-[11px] text-gray-500 mb-0.5 block';

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
      >
        <span className="text-xs font-bold text-gray-700">+ <T k="기록 입력" /></span>
        <svg className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-gray-100 space-y-4">
          {/* Vitals */}
          <div>
            <p className="text-[11px] font-bold text-blue-600 mt-3 mb-2"><T k="바이탈" /></p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {[
                { k: 'heartRate', label: '심박수' }, { k: 'systolicBp', label: '수축기BP' },
                { k: 'diastolicBp', label: '이완기BP' }, { k: 'spo2', label: 'SpO₂(%)' },
                { k: 'respiratoryRate', label: '호흡수' }, { k: 'temperature', label: '체온' },
              ].map(({ k, label }) => (
                <div key={k}>
                  <label className={labelCls}><T k={label} /></label>
                  <input type="number" value={form[k as keyof typeof form]} onChange={(e) => set(k, e.target.value)} className={inputCls} />
                </div>
              ))}
            </div>
          </div>

          {/* Consciousness */}
          <div>
            <p className="text-[11px] font-bold text-blue-600 mb-2"><T k="의식" /></p>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className={labelCls}><T k="GCS (3–15)" /></label>
                <input type="number" min={3} max={15} value={form.gcScore} onChange={(e) => set('gcScore', e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}><T k="의식수준" /></label>
                <select value={form.consciousness} onChange={(e) => set('consciousness', e.target.value)} className={inputCls}>
                  <option value="">{tA('선택')}</option>
                  {['ALERT', 'VERBAL', 'PAIN', 'UNRESPONSIVE'].map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}><T k="동공반응" /></label>
                <input type="text" value={form.pupilReaction} onChange={(e) => set('pupilReaction', e.target.value)} className={inputCls} />
              </div>
            </div>
          </div>

          {/* I/O */}
          <div>
            <p className="text-[11px] font-bold text-blue-600 mb-2"><T k="수분 I/O (ml)" /></p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {[
                { k: 'intakeOral', label: '경구' }, { k: 'intakeIv', label: 'IV' }, { k: 'intakeOther', label: '기타섭취' },
                { k: 'outputUrine', label: '소변' }, { k: 'outputDrain', label: '배액' }, { k: 'outputOther', label: '기타배출' },
              ].map(({ k, label }) => (
                <div key={k}>
                  <label className={labelCls}><T k={label} /></label>
                  <input type="number" value={form[k as keyof typeof form]} onChange={(e) => set(k, e.target.value)} className={inputCls} />
                </div>
              ))}
            </div>
          </div>

          {/* Ventilator */}
          <div>
            <p className="text-[11px] font-bold text-blue-600 mb-2"><T k="인공호흡기" /></p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              <div>
                <label className={labelCls}><T k="모드" /></label>
                <select value={form.ventMode} onChange={(e) => set('ventMode', e.target.value)} className={inputCls}>
                  <option value="">{tA('선택')}</option>
                  {['AC', 'SIMV', 'PS', 'CPAP', 'T-piece'].map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
              {[
                { k: 'fio2', label: 'FiO₂(%)' }, { k: 'peep', label: 'PEEP' },
                { k: 'tidalVolume', label: '일회량(ml)' }, { k: 'pip', label: 'PIP' },
              ].map(({ k, label }) => (
                <div key={k}>
                  <label className={labelCls}><T k={label} /></label>
                  <input type="number" value={form[k as keyof typeof form]} onChange={(e) => set(k, e.target.value)} className={inputCls} />
                </div>
              ))}
            </div>
          </div>

          {/* Scores */}
          <div>
            <p className="text-[11px] font-bold text-blue-600 mb-2"><T k="중증도 점수" /></p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { k: 'apacheScore', label: 'APACHE II (0–71)' }, { k: 'sofaScore', label: 'SOFA (0–24)' },
                { k: 'painScore', label: '통증 NRS (0–10)' }, { k: 'sedationScore', label: '진정 RASS (-5~+4)' },
              ].map(({ k, label }) => (
                <div key={k}>
                  <label className={labelCls}><T k={label} /></label>
                  <input type="number" value={form[k as keyof typeof form]} onChange={(e) => set(k, e.target.value)} className={inputCls} />
                </div>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className={labelCls}><T k="비고" /></label>
            <textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} className={`${inputCls} resize-none`} />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setOpen(false)} className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"><T k="취소" /></button>
            <button
              onClick={handleSubmit}
              disabled={mutation.isPending}
              className="px-4 py-1.5 text-xs rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50"
            >
              <T k={mutation.isPending ? '저장중…' : '저장'} />
            </button>
          </div>
          {mutation.isError && <p className="text-xs text-red-500 text-right"><T k="저장 실패. 다시 시도해주세요." /></p>}
        </div>
      )}
    </div>
  );
}

function PatientDetail({ admissionId, onClose }: { admissionId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['icu-detail', admissionId],
    queryFn: () => apiClient.get<{ data: IcuAdmission }>(`/api/v1/icu/${admissionId}`),
  });
  const detail = data?.data;

  /** 🔴 ICU 퇴실 결정은 서버가 `@Roles(DOCTOR, ADMIN)` — 간호사에게 띄우면 누를 때마다 403 이었다.
   *     중증도 점수(APACHE·SOFA)는 반대로 **간호사 본업이라 서버를 열었다**(성격이 다르다). */
  const canDischarge = useHasRole('DOCTOR');
  const dischargeMutation = useMutation({
    mutationFn: () => apiClient.patch(`/api/v1/icu/${admissionId}/discharge`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['icu-beds'] });
      qc.invalidateQueries({ queryKey: ['icu-patients'] });
      qc.invalidateQueries({ queryKey: ['icu-dashboard'] });
      onClose();
    },
  });

  if (isLoading) return <div className="py-12 text-center text-sm text-gray-400 animate-pulse"><T k="로딩중…" /></div>;
  if (!detail) return null;

  const p = detail.patient;
  const admitDate = detail.admitDate ?kdate(detail.admitDate, 'date') : '-';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <PatientAvatar gender={(p as any)?.gender} dateOfBirth={(p as any)?.dateOfBirth} familyName={p?.familyName} givenName={p?.givenName} size="sm" />
          <div>
            <h3 className="text-base font-bold text-gray-900">{p?.familyName}{p?.givenName}</h3>
            <p className="text-xs text-gray-400">MRN: {p?.patientNumber ?? '-'} · <T k="병상" />: {detail.icuBed?.bedNumber ?? '-'} · <T k="입실" />: {admitDate}</p>
          </div>
          <SeverityBadge severity={detail.severity} />
        </div>
        <div className="flex gap-2">
          {canDischarge && <button
            onClick={() => { if (confirm('퇴실 처리하시겠습니까?')) dischargeMutation.mutate(); }}
            disabled={dischargeMutation.isPending}
            className="px-3 py-1.5 text-xs rounded-lg bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 disabled:opacity-50"
          >
            <T k="퇴실@병동" />
          </button>}
          <button onClick={onClose} className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50"><T k="닫기" /></button>
        </div>
      </div>

      {detail.admitReason && (
        <p className="text-xs text-gray-500 bg-gray-50 rounded-xl px-3 py-2"><T k="입실사유" />: {detail.admitReason}</p>
      )}

      {/* Cards row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <IOBalanceCard detail={detail} />
        <VentilatorCard detail={detail} />
        <ScoresCard detail={detail} />
      </div>

      {/* Flowsheet */}
      <FlowsheetTable admissionId={admissionId} />

      {/* Record form */}
      <RecordForm admissionId={admissionId} onSuccess={() => {}} />
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function IcuPage() {
  const tA = useTAttr();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: dashData } = useQuery({
    queryKey: ['icu-dashboard'],
    queryFn: () => apiClient.get<{ data: IcuDashboard }>('/api/v1/icu/dashboard'),
    refetchInterval: pollMs('normal'),
  });
  const { data: bedsData, isLoading: bedsLoading, isError: bedsError, error: bedsErrorData, refetch: refetchBeds } = useQuery({
    queryKey: ['icu-beds'],
    queryFn: () => apiClient.get<{ data: IcuBed[] }>('/api/v1/icu/beds'),
    refetchInterval: pollMs('fast'),
  });
  const { data: patientsData } = useQuery({
    queryKey: ['icu-patients'],
    queryFn: () => apiClient.get<{ data: IcuAdmission[] }>('/api/v1/icu/patients'),
    refetchInterval: pollMs('fast'),
  });

  const dash = dashData?.data;
  const _bedsRaw = bedsData?.data;
  const beds: IcuBed[] = Array.isArray(_bedsRaw) ? _bedsRaw : (_bedsRaw as unknown as { data?: IcuBed[] })?.data ?? [];
  const _patientsRaw = patientsData?.data;
  const patients: IcuAdmission[] = Array.isArray(_patientsRaw) ? _patientsRaw : (_patientsRaw as unknown as { data?: IcuAdmission[] })?.data ?? [];

  if (bedsError) return <QueryErrorFallback error={bedsErrorData} onRetry={refetchBeds} />;

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900"><T k="중환자실 (ICU)" /></h2>
          <p className="text-sm text-gray-500 mt-0.5"><T k="병상 현황 · 환자 모니터링 · 플로우시트" /></p>
        </div>
      </div>

      {/* Dashboard stats bar */}
      {dash && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard title={tA('총 병상')} value={dash.totalBeds} color="slate" />
          <StatCard title={tA('사용중')} value={dash.occupied} color="red" />
          <StatCard title={tA('가용')} value={dash.available} color="green" />
          {/* 🔴 등록 ICU 병상이 0이면 점유율은 0% 가 아니라 산출 불가 — 분모와 함께 낸다(§3.3) */}
          <StatCard title={tA('점유율')} value={<Ratio numerator={dash.occupied} denominator={dash.totalBeds} unavailableHint="등록 ICU 병상 0" />} color="blue" />
          <StatCard title={tA('인공호흡기')} value={dash.ventilatorCount ?? 0} color="amber" />
          <StatCard title={tA('격리')} value={dash.isolationCount ?? 0} color="purple" />
        </div>
      )}

      {/* Severity counts */}
      {dash?.severityCounts && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(dash.severityCounts as Record<string, number>).map(([sev, cnt]) => (
            <span key={sev} className={`text-xs font-bold px-3 py-1 rounded-full border ${SEVERITY_COLOR[sev] ?? 'bg-gray-100 text-gray-600 border-gray-200'}`}>
              {sev === 'CRITICAL' ? '위험' : sev === 'SEVERE' ? '중증' : '중등'}: {cnt}명
            </span>
          ))}
        </div>
      )}

      {/* Bed grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {bedsLoading
          ? Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 animate-pulse h-28" />
            ))
          : beds.map((bed) => {
              const adm = bed.admissions?.[0];
              const patient = adm?.patient;
              const v = adm?.records?.[0];
              const isSelected = selectedId === adm?.id;
              return (
                <button
                  key={bed.id}
                  onClick={() => adm && setSelectedId(isSelected ? null : adm.id)}
                  className={`text-left bg-white rounded-2xl border shadow-sm p-4 hover:shadow-md transition-all ${isSelected ? 'border-blue-400 ring-2 ring-blue-100' : 'border-gray-100'} ${!adm ? 'cursor-default' : 'cursor-pointer'}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <span aria-label={bedStatusWord(bed.status)} title={bedStatusWord(bed.status)}
                        className={`w-2 h-2 rounded-full ${STATUS_DOT[bed.status] ?? 'bg-gray-300'}`} />
                      <span className="text-sm font-bold text-gray-900">{bed.bedNumber}</span>
                    </div>
                    <span className="text-[10px] text-gray-400 uppercase">{bed.unitName}</span>
                  </div>
                  {patient ? (
                    <div>
                      <p className="text-sm font-semibold text-gray-800 truncate">{patient.familyName}{patient.givenName}</p>
                      <div className="flex items-center gap-1 mt-1">
                        <SeverityBadge severity={adm.severity} />
                        {adm.ventilator && <span className="text-[10px] font-medium text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">Vent</span>}
                        {adm.isolation && <span className="text-[10px] font-medium text-purple-600 bg-purple-50 px-1.5 py-0.5 rounded">격리</span>}
                      </div>
                      {v && (
                        <VitalSignsStrip vitals={v as unknown as Record<string, unknown>} keys={ICU_CARD_VITALS} className="mt-2 text-[10px]" />
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-400 mt-1"><T k={bed.status === 'MAINTENANCE' ? '정비중' : '비어있음'} /></p>
                  )}
                </button>
              );
            })}
      </div>

      {/* Patient detail panel */}
      {selectedId && (
        <div className="bg-gray-50 rounded-2xl border border-blue-100 p-4">
          <PatientDetail admissionId={selectedId} onClose={() => setSelectedId(null)} />
        </div>
      )}

      {/* Patient table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-gray-900"><T k="ICU 입실 환자 목록" /></h3>
          <span className="text-xs text-gray-400">{patients.length}<Unit>명</Unit></span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                {['환자', '병상', '중증도'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap"><T k={h} /></th>
                ))}
                <VitalHeaderCells keys={ICU_CARD_VITALS} className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap" />
                {['GCS', 'APACHE', '입실사유'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 whitespace-nowrap"><T k={h} /></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {patients.length === 0 ? (
                <tr><td colSpan={9} className="py-16 text-center text-sm text-gray-400"><T k="ICU 환자 없음" /></td></tr>
              ) : patients.map((adm) => {
                const v = adm.records?.[0];
                const isSelected = selectedId === adm.id;
                return (
                  <tr
                    key={adm.id}
                    onClick={() => setSelectedId(isSelected ? null : adm.id)}
                    className={`border-b border-gray-50 cursor-pointer transition-colors ${isSelected ? 'bg-blue-50' : 'hover:bg-blue-50/30'}`}
                  >
                    <td className="px-4 py-3.5 font-medium text-gray-900">{adm.patient?.familyName}{adm.patient?.givenName}</td>
                    <td className="px-4 py-3.5 text-gray-600 tabular-nums">{adm.icuBed?.bedNumber ?? '-'}</td>
                    <td className="px-4 py-3.5"><SeverityBadge severity={adm.severity} /></td>
                    {/* 🔴 (2026-10-07) `${systolicBp}/${diastolicBp}` 가 미측정에 "null/null" 을 그렸다 → 표시 부품 정본 */}
                    <VitalRowCells vitals={v as unknown as Record<string, unknown> | undefined} keys={ICU_CARD_VITALS} className="px-4 py-3.5 tabular-nums text-gray-700 whitespace-nowrap" />
                    <td className="px-4 py-3.5 tabular-nums text-gray-700">{v?.gcScore ?? '-'}</td>
                    {/* 🔴 APACHE 는 입실 시 산출 후 갱신하지 않는다 — '최신 활력 기록'에서 찾으면
                         늘 비어 보인다. 실제로 기록된 가장 최근 점수를 시점과 함께 보여준다. */}
                    <td className="px-4 py-3.5 tabular-nums text-gray-700">
                      {adm.latestScores?.apacheScore != null ? (
                        <span title={`측정 ${kdate(adm.latestScores.scoredAt, 'datetimeSec')}`}>
                          {adm.latestScores.apacheScore}
                        </span>
                      ) : '-'}
                    </td>
                    <td className="px-4 py-3.5 text-gray-600 truncate max-w-[180px]">{adm.admitReason}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
