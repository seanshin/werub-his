'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { toast } from '@/stores/toast-store';
import { pollMs, kdate } from '@/lib/ui-settings';

import { EmptyState, Unit } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

interface QcRecord {
  id: string;
  testCode: string;
  qcLevel: string;
  measuredValue: number | string;
  // 🔴 목표 SD 가 0/미설정이면 서버가 z 를 **산출하지 않는다**(`null`) — 종전엔 0 을 내려
  //    Levey-Jennings 점이 평균선 한가운데 초록으로 찍혔다(P17).
  zScore: number | string | null;
  westgardRule: string;
  performedAt?: string;
  instrument?: { name: string };
}

interface QcInstrumentDashboard {
  instrumentId: string;
  instrumentName: string;
  serialNumber: string;
  failed: number;
  warning: number;
  notEvaluable?: number;
  total: number;
  records?: QcRecord[];
}

interface QcDashboard {
  date?: string;
  summary: { passed: number; warning: number; failed: number; notEvaluable?: number; total?: number };
  instruments: QcInstrumentDashboard[];
}

/** 🔴 서버 `QC_NOT_EVALUABLE` 과 같은 문자열이어야 한다(계약) — 지어내지 않는다. */
const NOT_EVALUABLE = 'NOT_EVALUABLE';

const WESTGARD_COLOR: Record<string, string> = {
  PASS: 'bg-emerald-100 text-emerald-700',
  '1-2s': 'bg-amber-100 text-amber-700',
  '1-3s': 'bg-red-100 text-red-700',
  // 🔴 회색 — 초록(합격)도 빨강(실패)도 아니다. 잴 수 없었다는 사실만 말한다.
  [NOT_EVALUABLE]: 'bg-gray-100 text-gray-600',
};

const WESTGARD_LABEL: Record<string, string> = {
  PASS: 'PASS',
  '1-2s': 'WARNING (1-2s)',
  '1-3s': 'FAIL (1-3s)',
  [NOT_EVALUABLE]: '산출 불가 (목표 SD 없음)',
};

/** z 가 `null`(산출 불가)이면 숫자로 만들지 않는다 — `parseFloat(String(null))` 은 NaN 이다. */
function zOf(r: { zScore: number | string | null }): number | null {
  if (r.zScore == null) return null;
  const n = parseFloat(String(r.zScore));
  return Number.isFinite(n) ? n : null;
}

function LeveyJennings({ zScore }: { zScore: number }) {
  const levels = [
    { label: '+3SD', value: 3 },
    { label: '+2SD', value: 2 },
    { label: 'Mean', value: 0 },
    { label: '-2SD', value: -2 },
    { label: '-3SD', value: -3 },
  ];

  const clampedZ = Math.max(-3.5, Math.min(3.5, zScore));
  // Map z-score to position: -3.5 -> 100%, +3.5 -> 0% (top)
  const dotPercent = ((3.5 - clampedZ) / 7) * 100;

  return (
    <div className="relative w-12 h-20 border border-gray-200 rounded bg-white">
      {levels.map((l) => {
        const top = ((3.5 - l.value) / 7) * 100;
        const color = Math.abs(l.value) === 3 ? 'border-red-300' : Math.abs(l.value) === 2 ? 'border-amber-300' : 'border-gray-300';
        return (
          <div key={l.label} className={`absolute left-0 right-0 border-t ${color}`} style={{ top: `${top}%` }}>
            <span className="absolute -left-7 -top-1.5 text-[6px] text-gray-400 whitespace-nowrap"><T k={l.label} /></span>
          </div>
        );
      })}
      <div
        className={`absolute left-1/2 -translate-x-1/2 w-2 h-2 rounded-full ${
          Math.abs(zScore) > 3 ? 'bg-red-500' : Math.abs(zScore) > 2 ? 'bg-amber-500' : 'bg-emerald-500'
        }`}
        style={{ top: `calc(${dotPercent}% - 4px)` }}
      />
    </div>
  );
}

export default function QcTab() {
  const tAttr = useTAttr();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    instrumentId: '', qcLevel: 'LEVEL_1', testCode: '',
    measuredValue: '', targetMean: '', targetSD: '',
  });

  // Preview z-score and Westgard
  const previewZ = form.measuredValue && form.targetMean && form.targetSD && parseFloat(form.targetSD) !== 0
    ? (parseFloat(form.measuredValue) - parseFloat(form.targetMean)) / parseFloat(form.targetSD)
    : null;
  const previewWestgard = previewZ != null
    ? Math.abs(previewZ) > 3 ? '1-3s' : Math.abs(previewZ) > 2 ? '1-2s' : 'PASS'
    : null;

  const { data: dashboardData, isLoading: dashLoading } = useQuery({
    queryKey: ['qc-dashboard'],
    queryFn: () => apiClient.get<{ data: QcDashboard | { data: QcDashboard } }>('/api/v1/lab/qc/dashboard'),
    refetchInterval: pollMs('normal'),
  });

  const { data: recordsData, isLoading: recLoading } = useQuery({
    queryKey: ['qc-records'],
    queryFn: () => apiClient.get<{ data: QcRecord[] | { data: QcRecord[] } }>('/api/v1/lab/qc/records'),
    refetchInterval: pollMs('normal'),
  });

  const addMut = useMutation({
    mutationFn: () => apiClient.post('/api/v1/lab/qc/records', {
      instrumentId: form.instrumentId,
      qcLevel: form.qcLevel,
      testCode: form.testCode,
      measuredValue: parseFloat(form.measuredValue),
      targetMean: parseFloat(form.targetMean),
      targetSD: parseFloat(form.targetSD),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['qc-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['qc-records'] });
      setShowForm(false);
      setForm({ instrumentId: '', qcLevel: 'LEVEL_1', testCode: '', measuredValue: '', targetMean: '', targetSD: '' });
      toast.success('QC 기록 완료');
    },
    onError: () => toast.error('QC 기록 실패'),
  });

  const dashboard: QcDashboard | null = dashboardData?.data
    ? ((dashboardData.data as { data: QcDashboard })?.data ?? dashboardData.data) as QcDashboard
    : null;
  const records: QcRecord[] = (() => {
    const r = recordsData?.data;
    return Array.isArray(r) ? r : (r as { data: QcRecord[] })?.data ?? [];
  })();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-900"><T k="정도관리 (QC)" /></h3>
        <button onClick={() => setShowForm(!showForm)}
          className="px-3 py-1.5 text-xs font-medium bg-cyan-600 text-white rounded-lg hover:bg-cyan-700"><T k="+ QC 기록" /></button>
      </div>

      {/* QC 입력 폼 */}
      {showForm && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
          <p className="text-xs font-bold text-gray-700"><T k="QC 측정값 입력" /></p>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="text-[10px] text-gray-500"><T k="장비 ID *" /></label>
              <input value={form.instrumentId} onChange={(e) => setForm({ ...form, instrumentId: e.target.value })}
                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs" placeholder="UUID" /></div>
            <div><label className="text-[10px] text-gray-500">QC Level</label>
              <select value={form.qcLevel} onChange={(e) => setForm({ ...form, qcLevel: e.target.value })}
                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs bg-white">
                <option value="LEVEL_1">Level 1 (Low)</option>
                <option value="LEVEL_2">Level 2 (Normal)</option>
                <option value="LEVEL_3">Level 3 (High)</option>
              </select></div>
            <div><label className="text-[10px] text-gray-500"><T k="검사코드 *" /></label>
              <input value={form.testCode} onChange={(e) => setForm({ ...form, testCode: e.target.value })}
                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs" placeholder={tAttr('예: GLU, HGB')} /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="text-[10px] text-gray-500"><T k="측정값 *" /></label>
              <input value={form.measuredValue} onChange={(e) => setForm({ ...form, measuredValue: e.target.value })}
                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs" type="number" step="0.001" /></div>
            <div><label className="text-[10px] text-gray-500"><T k="목표 평균 *" /></label>
              <input value={form.targetMean} onChange={(e) => setForm({ ...form, targetMean: e.target.value })}
                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs" type="number" step="0.001" /></div>
            <div><label className="text-[10px] text-gray-500"><T k="목표 SD *" /></label>
              <input value={form.targetSD} onChange={(e) => setForm({ ...form, targetSD: e.target.value })}
                className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-xs" type="number" step="0.001" /></div>
          </div>

          {/* Preview */}
          {previewZ != null && (
            <div className="flex items-center gap-4 bg-gray-50 rounded-xl p-3">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-500">Z-Score:</span>
                  <span className={`text-sm font-bold ${Math.abs(previewZ) > 3 ? 'text-red-700' : Math.abs(previewZ) > 2 ? 'text-amber-700' : 'text-emerald-700'}`}>
                    {previewZ.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[10px] text-gray-500">Westgard:</span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${WESTGARD_COLOR[previewWestgard!]}`}>
                    <T k={WESTGARD_LABEL[previewWestgard!]} />
                  </span>
                </div>
              </div>
              <div className="ml-8">
                <LeveyJennings zScore={previewZ} />
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={() => addMut.mutate()}
              disabled={!form.instrumentId || !form.testCode || !form.measuredValue || !form.targetMean || !form.targetSD || addMut.isPending}
              className="flex-1 py-1.5 text-xs font-medium bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 disabled:opacity-50">
              <T k={addMut.isPending ? '기록 중...' : 'QC 기록'} /></button>
            <button onClick={() => setShowForm(false)} className="px-3 py-1.5 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg"><T k="취소" /></button>
          </div>
        </div>
      )}

      {/* 대시보드 */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-bold text-gray-700"><T k="오늘 QC 대시보드" /></p>
          {dashboard?.date && <span className="text-[10px] text-gray-400">{dashboard.date}</span>}
        </div>

        {dashLoading ? (
          <div className="h-20 bg-gray-100 rounded animate-pulse" />
        ) : !dashboard?.instruments?.length ? (
          <EmptyState icon="📝" title="오늘 QC 기록이 없습니다" />
        ) : (
          <>
            {/* Summary */}
            <div className="flex gap-3 mb-4">
              <div className="flex-1 bg-emerald-50 rounded-xl p-3 text-center">
                <p className="text-[10px] text-emerald-500">PASS</p>
                <p className="text-lg font-bold text-emerald-700">{dashboard.summary.passed}</p>
              </div>
              <div className="flex-1 bg-amber-50 rounded-xl p-3 text-center">
                <p className="text-[10px] text-amber-500">WARNING</p>
                <p className="text-lg font-bold text-amber-700">{dashboard.summary.warning}</p>
              </div>
              <div className="flex-1 bg-red-50 rounded-xl p-3 text-center">
                <p className="text-[10px] text-red-500">FAIL</p>
                <p className="text-lg font-bold text-red-700">{dashboard.summary.failed}</p>
              </div>
              {/* 🔴 판정 불가 칸 — 이 칸이 없으면 목표 SD 미설정 건이 PASS 나 FAIL 중 한쪽으로 샌다.
                  0 건이어도 **분모가 무엇인지** 보이도록 상시 노출한다. */}
              <div className="flex-1 bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-[10px] text-gray-500"><T k="산출 불가" /></p>
                <p className="text-lg font-bold text-gray-700">{dashboard.summary.notEvaluable ?? 0}</p>
              </div>
            </div>

            {/* Per instrument */}
            <div className="space-y-2">
              {dashboard.instruments.map((inst: QcInstrumentDashboard) => (
                <div key={inst.instrumentId} className="bg-gray-50 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-xs font-bold text-gray-900">{inst.instrumentName}</p>
                      <p className="text-[10px] text-gray-400">{inst.serialNumber}</p>
                    </div>
                    <div className="flex gap-1.5">
                      {/* 🔴 장비 배지가 'PASS' 라고 말하려면 **그 장비의 전건이 판정됐어야** 한다.
                          판정 불가가 섞여 있으면 초록으로 접지 않는다(P17). */}
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${inst.failed > 0 ? 'bg-red-100 text-red-700' : inst.warning > 0 ? 'bg-amber-100 text-amber-700' : (inst.notEvaluable ?? 0) > 0 ? 'bg-gray-100 text-gray-600' : 'bg-emerald-100 text-emerald-700'}`}>
                        {inst.failed > 0 ? 'FAIL' : inst.warning > 0 ? 'WARNING' : (inst.notEvaluable ?? 0) > 0 ? <T k="일부 산출 불가" /> : 'PASS'}
                      </span>
                      <span className="text-[10px] text-gray-400 whitespace-nowrap">{inst.total}<Unit><T k="건" /></Unit></span>
                    </div>
                  </div>
                  {inst.records && inst.records.length > 0 && (
                    <div className="space-y-1">
                      {inst.records.map((r: QcRecord) => {
                        const z = zOf(r);
                        return (
                        <div key={r.id} className="flex items-center gap-2 text-[10px]">
                          <span className={`font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${WESTGARD_COLOR[r.westgardRule] ?? 'bg-gray-100 text-gray-500'}`}>
                            <T k={WESTGARD_LABEL[r.westgardRule] ?? r.westgardRule} />
                          </span>
                          <span className="text-gray-700 font-medium">{r.testCode}</span>
                          <span className="text-gray-400">{r.qcLevel}</span>
                          {/* 🔴 z 가 없으면 `NaN` 도 `0.00` 도 그리지 않는다 */}
                          <span className="text-gray-500">{z != null ? `z=${z.toFixed(2)}` : <T k="z 산출 불가" />}</span>
                          <span className="text-gray-400">{String(r.measuredValue)}</span>
                          <div className="ml-auto">
                            {z != null ? <LeveyJennings zScore={z} /> : <span className="text-[9px] text-gray-400">—</span>}
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* History table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <p className="text-xs font-bold text-gray-700"><T k="QC 기록 이력" /></p>
        </div>
        <table className="w-full text-sm">
          <thead><tr className="border-b border-gray-100 bg-gray-50/50">
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[90px]"><T k="판정" /></th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500"><T k="장비" /></th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[70px]"><T k="검사" /></th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[60px]">Level</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[70px]"><T k="측정값" /></th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[60px]">Z</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[60px]">L-J</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 w-[80px]"><T k="시간" /></th>
          </tr></thead>
          <tbody>
            {recLoading ? (
              Array.from({ length: 3 }).map((_, i) => <tr key={i}><td colSpan={8} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>)
            ) : records.length === 0 ? (
              <tr><td colSpan={8} className="py-12 text-center text-gray-400"><T k="QC 기록이 없습니다" /></td></tr>
            ) : records.slice(0, 50).map((r: QcRecord) => {
              const z = zOf(r);
              return (
                <tr key={r.id} className="border-b border-gray-50">
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${WESTGARD_COLOR[r.westgardRule] ?? 'bg-gray-100 text-gray-500'}`}>
                      <T k={WESTGARD_LABEL[r.westgardRule] ?? r.westgardRule} />
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-700">{r.instrument?.name ?? '-'}</td>
                  <td className="px-4 py-3 text-xs font-mono text-gray-700">{r.testCode}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{r.qcLevel}</td>
                  <td className="px-4 py-3 text-xs text-gray-700">{String(r.measuredValue)}</td>
                  <td className="px-4 py-3 text-xs">
                    {z == null ? (
                      <span className="font-medium text-gray-500"><T k="산출 불가" /></span>
                    ) : (
                      <span className={`font-bold ${Math.abs(z) > 3 ? 'text-red-700' : Math.abs(z) > 2 ? 'text-amber-700' : 'text-emerald-700'}`}>
                        {z.toFixed(2)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {z != null ? <LeveyJennings zScore={z} /> : <span className="text-[10px] text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-400 font-mono">
                    {r.performedAt ?kdate(r.performedAt, 'time') : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
