'use client';

import { useState } from 'react';
import { isCriticalFlag, isAbnormalFlag } from '@hospital-run/shared';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { kdate } from '@/lib/ui-settings';

import { EmptyState, Unit } from '@/components/ui/display';
import { kstToday } from '@/lib/kst-today';
import { T, useTAttr } from '@/components/ui/i18n-text';

type Point = { value: number; measuredAt: string; flag: string | null; normalMin: number | null; normalMax: number | null; patientReported?: boolean };
type TrendLabel = 'IMPROVING' | 'WORSENING' | 'STABLE' | null;
type TrendResp = { series: Record<string, Point[]>; summary: Record<string, {
  latest: number | null; unit: string; measuredAt: string | null; delta: number | null; count: number; trend?: TrendLabel;
  /** 🔴 환자가 집에서 잰 값(참고용) — 결정 portal.patientReportedVitals = REFERENCE_ONLY */
  latestPatientReported?: boolean; patientReportedCount?: number;
  /** 의료진 측정 최신값 — 목표 미달 판정은 이것으로만 */
  clinical?: { latest: number; measuredAt: string } | null;
}> };
const TREND_BADGE: Record<string, { label: string; cls: string }> = {
  IMPROVING: { label: '개선', cls: 'bg-emerald-50 text-emerald-700' },
  WORSENING: { label: '악화', cls: 'bg-rose-50 text-rose-700' },
  STABLE: { label: '안정', cls: 'bg-gray-100 text-gray-500' },
};

const CODE_META: Record<string, { label: string; unit: string; target?: number; group: string }> = {
  HBA1C: { label: '당화혈색소(HbA1c)', unit: '%', target: 7, group: '당뇨' },
  FBS: { label: '공복혈당(FBS)', unit: 'mg/dL', target: 130, group: '당뇨' },
  PPG: { label: '식후2h혈당', unit: 'mg/dL', target: 180, group: '당뇨' },
  SBP: { label: '수축기혈압', unit: 'mmHg', target: 140, group: '혈압' },
  DBP: { label: '이완기혈압', unit: 'mmHg', target: 90, group: '혈압' },
  WEIGHT: { label: '체중', unit: 'kg', group: '체중' },
  BMI: { label: 'BMI', unit: 'kg/m²', target: 25, group: '체중' },
};
const ORDER = ['HBA1C', 'FBS', 'PPG', 'SBP', 'DBP', 'WEIGHT', 'BMI'];
const PERIODS: [string, number][] = [['6개월', 6], ['12개월', 12], ['18개월', 18]];

/** 만성질환(당뇨) 추이 — 코드별 라인 + 정상범위 음영 + 목가상읍 + 최신/Δ. /chronic-observations API 사용 */
function Sparkline({ pts, target }: { pts: Point[]; target?: number }) {
  if (pts.length < 2) return <div className="h-12 flex items-center text-[11px] text-gray-300"><T k="데이터 부족" /></div>;
  const W = 280, H = 48, pad = 4;
  const vals = pts.map((p) => p.value);
  const nm = pts[0].normalMin, nx = pts[0].normalMax;
  const lo = Math.min(...vals, nm ?? Infinity, target ?? Infinity);
  const hi = Math.max(...vals, nx ?? -Infinity, target ?? -Infinity);
  const range = hi - lo || 1;
  const x = (i: number) => pad + (i / (pts.length - 1)) * (W - 2 * pad);
  const y = (v: number) => H - pad - ((v - lo) / range) * (H - 2 * pad);
  const line = pts.map((p, i) => `${x(i)},${y(p.value)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-12">
      {nm != null && nx != null && <rect x={0} y={y(nx)} width={W} height={Math.max(0, y(nm) - y(nx))} fill="#dcfce7" opacity={0.5} />}
      {target != null && <line x1={0} y1={y(target)} x2={W} y2={y(target)} stroke="#f59e0b" strokeWidth={1} strokeDasharray="4 3" />}
      <polyline points={line} fill="none" stroke="#2563eb" strokeWidth={1.5} />
      {pts.map((p, i) => p.patientReported
        // 환자 입력(참고용)은 속 빈 회색 점 — 판정 색을 칠하지 않는다
        ? <circle key={i} cx={x(i)} cy={y(p.value)} r={2.5} fill="#fff" stroke="#9ca3af" strokeWidth={1.2} data-patient-reported />
        : <circle key={i} cx={x(i)} cy={y(p.value)} r={isCriticalFlag(p.flag) ? 3 : 2} fill={isCriticalFlag(p.flag) ? '#b91c1c' : isAbnormalFlag(p.flag) ? '#dc2626' : '#2563eb'} />)}
    </svg>
  );
}

/** 빠른 측정값 기록 — 혈압·체중·혈당·HbA1c를 한 번에 입력(POST /chronic-observations) */
const ENTRY_FIELDS: { code: string; label: string; unit: string; ph: string; step?: string }[] = [
  { code: 'SBP', label: '수축기', unit: 'mmHg', ph: '120' },
  { code: 'DBP', label: '이완기', unit: 'mmHg', ph: '80' },
  { code: 'WEIGHT', label: '체중', unit: 'kg', ph: '65', step: '0.1' },
  { code: 'FBS', label: '공복혈당', unit: 'mg/dL', ph: '95' },
  { code: 'HBA1C', label: 'HbA1c', unit: '%', ph: '6.5', step: '0.1' },
];
const SOURCES: [string, string][] = [['CLINIC', '외래'], ['SMBG', '자가측정'], ['DEVICE', '기기']];

function QuickEntry({ patientId, onSaved }: { patientId: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [source, setSource] = useState('CLINIC');
  const [date, setDate] = useState(() => kstToday());
  const filled = Object.entries(vals).filter(([, v]) => v.trim() !== '' && !isNaN(Number(v)));

  const mut = useMutation({
    mutationFn: async () => {
      const measuredAt = new Date(`${date}T12:00:00`).toISOString();
      for (const [code, v] of filled) {
        await apiClient.post(`/api/v1/patients/${patientId}/chronic-observations`, { code, value: Number(v), source, measuredAt });
      }
    },
    onSuccess: () => { setVals({}); setOpen(false); onSaved(); },
  });

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700"><T k="+ 측정값 기록" /></button>
    );
  }
  return (
    <div className="bg-white rounded-2xl border border-blue-200 shadow-sm p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-bold text-gray-800"><T k="측정값 기록" /></span>
        <button onClick={() => setOpen(false)} className="text-xs text-gray-400 hover:text-gray-600"><T k="닫기" /></button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {ENTRY_FIELDS.map((f) => (
          <label key={f.code} className="flex flex-col gap-0.5">
            <span className="text-[11px] text-gray-500">{f.label} <span className="text-gray-300">{f.unit}</span></span>
            <input type="number" step={f.step ?? '1'} placeholder={f.ph} value={vals[f.code] ?? ''}
              onChange={(e) => setVals((s) => ({ ...s, [f.code]: e.target.value }))}
              className="border border-gray-200 rounded-lg px-2 py-1 text-sm" />
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <input type="date" value={date} max={kstToday()} onChange={(e) => setDate(e.target.value)}
          className="border border-gray-200 rounded-lg px-2 py-1 text-xs" />
        <div className="flex gap-1">
          {SOURCES.map(([v, lbl]) => (
            <button key={v} onClick={() => setSource(v)} className={`px-2.5 py-1 rounded-lg text-xs border ${source === v ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-500'}`}>{lbl}</button>
          ))}
        </div>
        <button disabled={!filled.length || mut.isPending} onClick={() => mut.mutate()}
          className="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40">
          {mut.isPending ? '저장 중…' : `저장${filled.length ? ` (${filled.length})` : ''}`}
        </button>
      </div>
      {mut.isError && <p className="text-xs text-rose-600"><T k="저장 실패 — 입력값을 확인해주세요." /></p>}
    </div>
  );
}

export function ChronicTrendPanel({ patientId }: { patientId: string }) {
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const [months, setMonths] = useState(12);
  const from = new Date(Date.now() - months * 30 * 86400000).toISOString();
  const { data, isLoading } = useQuery({
    queryKey: ['chronic-trend', patientId, months],
    queryFn: () => apiClient.get<{ data: TrendResp }>(`/api/v1/patients/${patientId}/chronic-observations?from=${encodeURIComponent(from)}`),
    enabled: !!patientId,
  });
  const resp = data?.data;
  const series = resp?.series ?? {};
  const summary = resp?.summary ?? {};
  const present = ORDER.filter((c) => (series[c]?.length ?? 0) > 0);

  const onSaved = () => qc.invalidateQueries({ queryKey: ['chronic-trend', patientId] });

  if (isLoading) return <div className="p-4 text-sm text-gray-400"><T k="불러오는 중…" /></div>;
  if (!present.length) return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900"><T k="만성질환 추이" /> <span className="text-xs font-normal text-gray-400"><T k="(당뇨·혈압·체중)" /></span></h3>
        <QuickEntry patientId={patientId} onSaved={onSaved} />
      </div>
      <EmptyState icon="📝" title="만성질환 측정 기록이 없습니다." hint="상단 “측정값 기록”으로 첫 측정을 추가하세요." className="bg-white rounded-2xl border border-gray-100" />
    </div>
  );

  const groups = Array.from(new Set(present.map((c) => CODE_META[c].group)));

  // CDSS — 최신값 목표 미달 경고 · 🔴 의료진 측정만(환자 입력은 참고용 — 결정 portal.patientReportedVitals)
  //    서버가 clinical 을 주지 않던 옛 응답이면 최신값이 환자 입력이 아닐 때만 쓴다
  const L = (c: string) => {
    const s = summary[c];
    if (!s) return null;
    if (s.clinical !== undefined) return s.clinical?.latest ?? null;
    return s.latestPatientReported ? null : s.latest;
  };
  const warns: string[] = [];
  const hba1c = L('HBA1C'); if (hba1c != null && hba1c >= 7) warns.push(`HbA1c ${hba1c}% (목표 <7)`);
  const fbs = L('FBS'); if (fbs != null && fbs >= 130) warns.push(`공복혈당 ${fbs} (목표 <130)`);
  const sbp = L('SBP'), dbp = L('DBP'); if ((sbp != null && sbp >= 140) || (dbp != null && dbp >= 90)) warns.push(`혈압 ${sbp ?? '-'}/${dbp ?? '-'} (목표 <140/90)`);
  const bmi = L('BMI'); if (bmi != null && bmi >= 25) warns.push(`BMI ${bmi} (목표 <25)`);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-lg font-semibold text-gray-900"><T k="만성질환 추이" /> <span className="text-xs font-normal text-gray-400"><T k="(당뇨·혈압·체중)" /></span></h3>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {PERIODS.map(([lbl, m]) => (
              <button key={m} onClick={() => setMonths(m)} className={`px-2.5 py-1 rounded-lg text-xs border ${months === m ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-500'}`}>{lbl}</button>
            ))}
          </div>
          <QuickEntry patientId={patientId} onSaved={onSaved} />
        </div>
      </div>

      {warns.length > 0 && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl px-4 py-3 flex items-start gap-2">
          <svg className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" /></svg>
          <div>
            <div className="text-xs font-bold text-rose-700">관리 목표 미달 {warns.length}<Unit>건</Unit></div>
            <div className="text-xs text-rose-600 mt-0.5">{warns.join(' · ')}</div>
          </div>
        </div>
      )}

      {Object.values(summary).some((s) => s.patientReportedCount != null && s.patientReportedCount > 0) && (
        <p className="text-[11px] text-gray-500" data-patient-reported-note>
          <T k="속 빈 점은 환자가 집에서 잰 값입니다 — 참고용이며 목표 미달 경고·추세 판정에는 쓰지 않습니다." />
        </p>
      )}

      {groups.map((g) => (
        <div key={g} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
          <div className="text-sm font-bold text-gray-700 mb-3">{g}</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {present.filter((c) => CODE_META[c].group === g).map((c) => {
              const m = CODE_META[c]; const s = summary[c]; const pts = series[c];
              const up = (s?.delta ?? 0) > 0, down = (s?.delta ?? 0) < 0;
              return (
                <div key={c} className="border border-gray-100 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-800">
                      {m.label}
                      {s?.trend && TREND_BADGE[s.trend] && <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${TREND_BADGE[s.trend].cls}`}>{TREND_BADGE[s.trend].label}</span>}
                    </span>
                    <span className="text-sm font-bold text-gray-900">
                      {s?.latest ?? '-'}<span className="text-[11px] font-normal text-gray-400 ml-0.5">{m.unit}</span>
                      {s?.delta != null && s.delta !== 0 && (
                        <span className={`ml-1.5 text-[11px] ${down ? 'text-emerald-600' : up ? 'text-rose-600' : 'text-gray-400'}`}>{up ? '▲' : '▼'}{Math.abs(s.delta)}</span>
                      )}
                    </span>
                  </div>
                  <Sparkline pts={pts} target={m.target} />
                  <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                    <span>{pts.length}<Unit>회</Unit> · 최근 {s?.measuredAt ? kdate(s.measuredAt) : '-'}
                      {s?.latestPatientReported && <span className="ml-1 px-1 rounded bg-gray-100 text-gray-500" data-patient-reported-latest><T k="환자 입력 · 참고용" /></span>}
                    </span>
                    {m.target != null && <span className="text-amber-600">목표 {m.target}{m.unit}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
