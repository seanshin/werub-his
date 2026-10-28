'use client';
import { NurseOnlyGuard } from '@/components/nursing/NurseOnlyGuard';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { useAuthStore } from '@/stores/auth-store';
import { toast } from '@/stores/toast-store';
import { kstToday } from '@/lib/kst-today';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { useVitalsThresholds } from '@/lib/vital-flags';
import { VitalHeaderCells, VitalRowCells } from '@/components/vitals/VitalSigns';
import { ACVPU_LABEL, ACVPU_VALUES, type VitalSignKey } from '@hospital-run/shared';
import { VitalsRuleNote } from '@/components/vitals/VitalsRuleNote';
import { RiskHistoryPanel } from '@/components/nursing/RiskHistoryPanel';
import { IoBalancePanel } from '@/components/nursing/IoBalancePanel';
import { hasAnyFlowsheetValue, toFlowsheetBody } from '@/lib/flowsheet-form';

interface FlowEntry {
  id: string; recordedAt: string;
  systolicBp?: number; diastolicBp?: number; heartRate?: number; temperature?: number; spo2?: number; respiratoryRate?: number;
  consciousness?: string; painScore?: number;
  intakeOral?: number; intakeIv?: number; intakeOther?: number;
  outputUrine?: number; outputDrain?: number; outputOther?: number;
  notes?: string;
  nurse?: { familyName?: string; givenName?: string };
  /** 어느 원장의 행인가 — PREVISIT = 간호 스테이션·차트 빠른 입력(재원 중 외래 원장 · 2026-10-10) */
  ledger?: 'FLOWSHEET' | 'PREVISIT';
}

/** io = 그 2시간 칸의 섭취·배설 합(두 원장 · 서버 계산) — 기록이 없으면 null(0 과 다르다) */
interface GridItem { hour: string; entry: FlowEntry | null; io?: { intake: number; output: number; rows: number } | null }

/**
 * 활력 칸 — 부품 정본(`VitalHeaderCells`/`VitalRowCells`)이 그린다(이상 색 = 서버 병합 임계).
 * 🔴 (2026-10-01) 종전 `isAbnormal` 은 이 화면만의 숫자였고 혈압 칸은 "120/80" 문자열이라 어떤 혈압도 이상 표시가 안 됐다.
 * 🔴 (2026-10-07) 혈압 truthy 검사·체온 `String(v)`·호흡수 열 없음 → 표준 순서·정본 자릿수·미측정 '—'.
 */
/** ACVPU — 정본 어휘·라벨(shared `ACVPU_VALUES`·`ACVPU_LABEL`) · 라벨만 카탈로그를 탄다 */
const ACVPU_OPTIONS = ACVPU_VALUES.map((v) => [v, ACVPU_LABEL[v]] as const);

const FLOWSHEET_VITAL_KEYS: readonly VitalSignKey[] = ['respiratoryRate', 'spo2', 'systolicBp', 'heartRate', 'consciousness', 'temperature', 'painScore'];

export default function FlowSheetPage() {
  const { admissionId } = useParams();
  const tAttr = useTAttr();
  const qc = useQueryClient();
  const user = useAuthStore(s => s.user);
  const canEdit = user?.role === 'NURSE' || user?.role === 'ADMIN';
  const [date] = useState(kstToday());
  const vitalsRule = useVitalsThresholds();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({});

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['flowsheet', admissionId, date],
    queryFn: () => apiClient.get<any>(`/api/v1/admissions/${admissionId}/flowsheet?date=${date}`),
    enabled: !!admissionId,
  });

  const raw = data?.data?.data ?? data?.data;
  const grid: GridItem[] = raw?.grid ?? [];
  const totals = raw?.totals ?? {};

  const addEntry = useMutation({
    mutationFn: (body: Record<string, any>) => apiClient.post(`/api/v1/admissions/${admissionId}/flowsheet`, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['flowsheet'] }); toast.success(tAttr('기록 추가')); setShowForm(false); setForm({}); },
    onError: () => toast.error(tAttr('기록 추가 실패')),
  });

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href={`/inpatient/${admissionId}/nursing/timeline`} className="text-sm text-blue-600 hover:underline">← <T k="타임라인" /></Link>
          <h1 className="text-xl font-bold text-gray-900 mt-1">Flow Sheet</h1>
          <p className="text-sm text-gray-500"><T k="시간별 바이탈 + I/O 기록표" /></p>
        </div>
        {canEdit ? (
          <button onClick={() => setShowForm(!showForm)} className="min-h-[44px] px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"><T k="+ 기록 추가" /></button>
        ) : (
          <span className="px-3 py-1 bg-blue-50 text-blue-600 text-xs font-medium rounded-full border border-blue-200"><T k="읽기전용" /></span>
        )}
      </div>

      {/* 근무조 판단 재료(2026-10-10) — 위험 평가 추이·I/O 수지(두 원장 · 서버 계산) */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <RiskHistoryPanel admissionId={String(admissionId)} />
        <IoBalancePanel admissionId={String(admissionId)} />
      </div>

      {/* 입력 폼 */}
      {showForm && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-bold text-blue-800"><T k="바이탈 + I/O 입력" /></h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { k: 'systolicBp', l: '수축기BP', p: 'mmHg' }, { k: 'diastolicBp', l: '이완기BP', p: 'mmHg' },
              { k: 'heartRate', l: '맥박', p: 'bpm' }, { k: 'temperature', l: '체온', p: '℃' },
              { k: 'spo2', l: 'SpO2', p: '%' }, { k: 'respiratoryRate', l: '호흡수', p: '/min' },
              { k: 'painScore', l: '통증(NRS)', p: '0-10' },
              { k: 'intakeOral', l: '경구섭취', p: 'mL' }, { k: 'intakeIv', l: '수액', p: 'mL' },
              { k: 'outputUrine', l: '소변', p: 'mL' }, { k: 'outputDrain', l: '배액', p: 'mL' },
            ].map(f => (
              <div key={f.k}>
                <label className="text-[10px] text-gray-500"><T k={f.l} /> ({f.p})</label>
                <input type="number" value={form[f.k] ?? ''} onChange={e => setForm({ ...form, [f.k]: e.target.value ? Number(e.target.value) : undefined })}
                  className="w-full border rounded-lg px-2 py-1.5 text-sm" placeholder={f.p} />
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3">
            {/* 🔴 (2026-10-10) 측정 시각·산소 투여 칸이 없어 이 폼의 기록은 전부 '측정 시각 미상'이었고 NEWS2 가 한 번도 산출되지 않았다(7요소 중 산소 미관측).
                의식은 ACVPU(NEWS2 정본 어휘) — 종전 AVPU 'VERBAL'·혼돈(C) 없음 */}
            <label className="text-[10px] text-gray-500 flex flex-col"><T k="측정 시각" />
              <input type="datetime-local" value={form.recordedAtLocal ?? ''} onChange={e => setForm({ ...form, recordedAtLocal: e.target.value || undefined })} className="border rounded-lg px-2 py-1.5 text-sm" data-fs-measured-at />
            </label>
            <select value={form.consciousness ?? ''} onChange={e => setForm({ ...form, consciousness: e.target.value || undefined })} className="border rounded-lg px-2 py-1.5 text-sm" aria-label={tAttr('의식수준')} data-fs-acvpu>
              <option value="">{tAttr('의식수준')}</option>
              {ACVPU_OPTIONS.map(([v, l]) => <option key={v} value={v}>{tAttr(l)}</option>)}
            </select>
            <select value={form.supplementalO2 == null ? '' : form.supplementalO2 ? 'Y' : 'N'} onChange={e => setForm({ ...form, supplementalO2: e.target.value === '' ? undefined : e.target.value === 'Y' })} className="border rounded-lg px-2 py-1.5 text-sm" aria-label={tAttr('산소 투여')} data-fs-o2>
              <option value="">{tAttr('산소 투여(미관측)')}</option>
              <option value="Y">{tAttr('산소 투여 중')}</option>
              <option value="N">{tAttr('실내 공기')}</option>
            </select>
            <input type="text" value={form.notes ?? ''} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder={tAttr('메모')} className="flex-1 border rounded-lg px-2 py-1.5 text-sm" />
            <button onClick={() => addEntry.mutate(toFlowsheetBody(form))} disabled={addEntry.isPending || !hasAnyFlowsheetValue(form)} data-fs-save className="min-h-[44px] px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"><T k="저장" /></button>
          </div>
        </div>
      )}

      {/* Flow Sheet 테이블 */}
      {isLoading ? <div className="h-40 bg-gray-100 rounded-xl animate-pulse" /> : isError ? <QueryErrorFallback error={error} onRetry={refetch} /> : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-gray-50">
                <th className="px-2 py-2 text-left font-bold text-gray-600 border-b w-16"><T k="시간" /></th>
                {/* 표준 순서(NEWS2: RR → SpO₂ → BP → HR → 의식 → BT) + 통증 — 종전엔 호흡수 열이 없었다 */}
                <VitalHeaderCells keys={FLOWSHEET_VITAL_KEYS} className="px-2 py-2 text-center font-bold text-gray-600 border-b" />
                <th className="px-2 py-2 text-center font-bold text-blue-600 border-b"><T k="섭취" /></th>
                <th className="px-2 py-2 text-center font-bold text-amber-600 border-b"><T k="배출" /></th>
              </tr>
            </thead>
            <tbody>
              {grid.map((g, i) => {
                const e = g.entry;
                // 🔴 (2026-10-10) I/O 는 서버가 두 원장(I/O 원장 + 플로시트 칸)에서 합친 칸 값 — 종전엔 이 행의 플로시트 칸만 더해
                //    I/O 화면에서 적은 섭취·배설이 보이지 않았고, 측정한 0 mL(무뇨)도 '-' 로 지웠다
                const io = g.io ?? null;
                return (
                  <tr key={i} className={`${i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} hover:bg-blue-50/30`}>
                    <td className="px-2 py-2 font-mono text-gray-500 border-b">
                      {g.hour}
                      {e?.ledger === 'PREVISIT' && (
                        <span className="ml-1 rounded bg-slate-100 px-1 text-[10px] font-sans text-slate-600 whitespace-nowrap" title={tAttr('간호 스테이션·차트 빠른 입력으로 외래 원장에 기록된 재원 중 활력입니다.')}>
                          <T k="스테이션 입력" />
                        </span>
                      )}
                    </td>
                    {/* 혈압 truthy·체온 String(v) 대신 부품 정본 — 미측정 '—'·정본 자릿수·서버 임계 색 */}
                    <VitalRowCells vitals={e as Record<string, unknown> | null | undefined} keys={FLOWSHEET_VITAL_KEYS} rule={vitalsRule} className="px-2 py-2 text-center border-b" />
                    <td className="px-2 py-2 text-center border-b text-blue-600" data-fs-io-intake={io ? io.intake : 'none'}>{io ? io.intake : <span className="text-gray-300">-</span>}</td>
                    <td className="px-2 py-2 text-center border-b text-amber-600" data-fs-io-output={io ? io.output : 'none'}>{io ? io.output : <span className="text-gray-300">-</span>}</td>
                  </tr>
                );
              })}
              {/* 합계 행 */}
              <tr className="bg-gray-100 font-bold">
                <td className="px-2 py-2 border-t text-gray-700"><T k="합계" /></td>
                <td colSpan={FLOWSHEET_VITAL_KEYS.length} className="px-2 py-2 border-t" />
                <td className="px-2 py-2 text-center border-t text-blue-700">{totals.totalIntake ?? 0}</td>
                <td className="px-2 py-2 text-center border-t text-amber-700">{totals.totalOutput ?? 0}</td>
              </tr>
              <tr className="bg-gray-50">
                <td className="px-2 py-2 text-gray-700 font-bold">Balance</td>
                <td colSpan={FLOWSHEET_VITAL_KEYS.length + 2} className={`px-2 py-2 text-center font-bold ${(totals.balance ?? 0) >= 0 ? 'text-blue-700' : 'text-red-700'}`}>
                  {(totals.balance ?? 0) >= 0 ? '+' : ''}{totals.balance ?? 0} mL
                </td>
              </tr>
            </tbody>
          </table>
          <VitalsRuleNote rule={vitalsRule} className="px-2 py-2" />
        </div>
      )}
    </div>
  );
}
