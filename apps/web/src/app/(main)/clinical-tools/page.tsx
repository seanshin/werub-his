'use client';

import { useState, useMemo } from 'react';
import { kdate } from '@/lib/ui-settings';
import { Unit } from '@/components/ui/display';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { usePatients } from '@/hooks/usePatients';
import { CLINICAL_CHARTS, chartsByCategory, ARCHETYPE_LABEL, getChart } from '@/lib/clinical-charts';
import { ClinicalChartRunner, type ClinicalChartValue } from '@/components/clinical-charts/ClinicalChartRunner';
import { useChartVerifications, effectiveVerified } from '@/components/clinical-charts/useChartVerifications';
import { T, Tf, useTAttr } from '@/components/ui/i18n-text';

const ARCHETYPE_BADGE: Record<string, string> = {
  scoring: 'bg-indigo-50 text-indigo-600',
  lookup: 'bg-teal-50 text-teal-600',
  formula: 'bg-purple-50 text-purple-600',
  criteria: 'bg-rose-50 text-rose-600',
  tree: 'bg-cyan-50 text-cyan-600',
};

interface PatientLite { id: string; mrn: string; familyName: string; givenName: string }
interface SavedResult { id: string; chartName: string; resultLabel?: string; resultLevel?: string; resultValue?: string | number; performedByName: string; performedAt: string }

export default function ClinicalToolsPage() {
  const tAttr = useTAttr();
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [patient, setPatient] = useState<PatientLite | null>(null);
  const [pq, setPq] = useState('');
  const [current, setCurrent] = useState<ClinicalChartValue | null>(null);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const { map: verMap, fourEyes } = useChartVerifications();

  const groups = useMemo(() => {
    const all = chartsByCategory();
    if (!q.trim()) return all;
    const kw = q.trim().toLowerCase();
    return all
      .map((g) => ({ category: g.category, charts: g.charts.filter((c) => c.name.toLowerCase().includes(kw) || c.chartId.toLowerCase().includes(kw) || c.category.toLowerCase().includes(kw)) }))
      .filter((g) => g.charts.length > 0);
  }, [q]);

  const selected = selectedId ? getChart(selectedId) : null;

  // 환자 검색
  const { data: patientsData } = usePatients(pq.trim().length >= 1 ? { q: pq.trim(), limit: 8 } : {});
  const patientResults = (patientsData?.data ?? []) as PatientLite[];

  // 저장된 결과(선택 환자+차트)
  const { data: savedData, refetch: refetchSaved } = useQuery({
    queryKey: ['ccr', patient?.id, selectedId],
    queryFn: () => apiClient.get<{ data: SavedResult[] }>('/api/v1/clinical-chart-results', { patientId: patient!.id, chartId: selectedId! }),
    enabled: !!patient && !!selectedId,
  });
  const saved = (savedData?.data ?? []) as SavedResult[];

  const saveMut = useMutation({
    mutationFn: () => {
      if (!patient || !selected || !current) throw new Error('no data');
      const r = current.result;
      return apiClient.post('/api/v1/clinical-chart-results', {
        patientId: patient.id,
        chartId: selected.chartId,
        chartName: selected.name,
        archetype: selected.archetype,
        sourceVersion: selected.sourceVersion,
        inputs: current.inputs,
        resultLabel: r.label,
        resultLevel: r.level,
        resultValue: typeof r.value === 'number' ? r.value : (typeof r.total === 'number' ? r.total : undefined),
        recommendation: r.recommendation,
        flags: r.flags,
      });
    },
    onSuccess: () => { setSaveMsg(tAttr('환자 차트에 저장됨')); setCurrent(null); refetchSaved(); setTimeout(() => setSaveMsg(null), 3000); },
    onError: (e: unknown) => setSaveMsg(`${tAttr('저장 실패')}${(e as { message?: string })?.message ? ` — ${(e as { message: string }).message}` : ''}`),
  });

  const total = CLINICAL_CHARTS.length;
  const canSave = !!patient && !!current && (current.result.label != null || current.result.value != null || current.result.total != null);

  return (
    <div className="max-w-6xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900"><T k="임상 도구 (점수·분류·계산)" /></h1>
        {/* 🔴 캐비아트(보조도구·의사 귀속)는 숫자·강조가 문장 한가운데 걸려 있다 — 한 키로 옮긴다(조각 금지) */}
        <Tf
          className="text-sm text-gray-500 mt-1 block"
          k="임상 점수표·판독 분류·계산식 {종수}. 모든 산출은 {보조도구}이며 최종 임상판단은 의사에게 귀속합니다. 미검증 차트는 「미검증 참조용」 배지로 표시됩니다."
          params={{ 종수: <>{total}<Unit>종</Unit></>, 보조도구: <b><T k="보조도구" /></b> }}
        />
      </div>

      {/* 환자 컨텍스트 바 */}
      <div className="bg-white rounded-xl border border-gray-100 p-3 flex flex-wrap items-center gap-3">
        <span className="text-xs font-semibold text-gray-500"><T k="환자(선택 시 결과 저장 가능)" /></span>
        {patient ? (
          <span className="px-3 py-1 rounded-lg bg-blue-50 text-blue-700 text-sm font-medium">
            {patient.familyName}{patient.givenName} · {patient.mrn}
            <button onClick={() => { setPatient(null); setPq(''); }} className="ml-2 text-blue-400 hover:text-blue-600">✕</button>
          </span>
        ) : (
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <input value={pq} onChange={(e) => setPq(e.target.value)} placeholder={tAttr('이름/MRN 검색…')}
              className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:border-blue-400 focus:outline-none" />
            {pq.trim() && patientResults.length > 0 && (
              <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                {patientResults.map((p) => (
                  <button key={p.id} onClick={() => { setPatient(p); setPq(''); }} className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50">
                    {p.familyName}{p.givenName} <span className="text-gray-400 text-xs">· {p.mrn}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5">
        {/* 목록 */}
        <aside className="space-y-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tAttr('이름·카테고리 검색…')}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-blue-400 focus:outline-none" />
          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            {groups.length === 0 && <p className="text-sm text-gray-400 text-center py-8"><T k="검색 결과 없음" /></p>}
            {groups.map((g) => (
              <div key={g.category}>
                <p className="text-[11px] font-semibold text-gray-400 uppercase mb-1.5">{g.category}</p>
                <div className="space-y-1">
                  {g.charts.map((c) => (
                    <button key={c.chartId} onClick={() => { setSelectedId(c.chartId); setCurrent(null); }}
                      className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition-colors flex items-center gap-2 ${selectedId === c.chartId ? 'bg-blue-50 border-blue-400' : 'bg-white border-gray-200 hover:border-blue-300'}`}>
                      <span className="flex-1 min-w-0 truncate text-gray-800">{c.name}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap ${ARCHETYPE_BADGE[c.archetype]}`}>{ARCHETYPE_LABEL[c.archetype]}</span>
                      {effectiveVerified(c, verMap[c.chartId], fourEyes)
                        ? <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" title={tAttr('검증됨')} />
                        : <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 shrink-0" title={tAttr(verMap[c.chartId]?.status === 'REJECTED' ? '검수 반려' : '미검증')} />}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* 실행 */}
        <main className="space-y-3">
          {selected ? (
            <>
              <ClinicalChartRunner key={selected.chartId} def={selected} onChange={setCurrent} />

              {/* 저장 액션 */}
              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={() => saveMut.mutate()} disabled={!canSave || saveMut.isPending}
                  className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40">
                  <T k={saveMut.isPending ? '저장 중…' : '환자 차트에 저장'} />
                </button>
                {!patient && <span className="text-xs text-gray-400"><T k="환자를 선택하면 저장할 수 있습니다." /></span>}
                {patient && !canSave && !current?.result.incomplete && <span className="text-xs text-gray-400"><T k="값을 입력/판정하면 저장할 수 있습니다." /></span>}
                {patient && current?.result.incomplete && (
                  <span className="text-xs text-amber-700" data-chart-incomplete>
                    <Tf k="모든 항목을 골라야 저장됩니다 ({answered}/{required})" params={{ answered: current.result.incomplete.answered, required: current.result.incomplete.required }} />
                  </span>
                )}
                {saveMsg && <span className="text-xs font-medium text-emerald-600">{saveMsg}</span>}
              </div>

              {/* 최근 저장 결과 */}
              {patient && saved.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-100 p-4">
                  <Tf className="text-xs font-semibold text-gray-500 mb-2 block" k="{환자} · {도구} 최근 기록" params={{ 환자: `${patient.familyName}${patient.givenName}`, 도구: selected.name }} />
                  <ul className="space-y-1.5">
                    {saved.map((s) => (
                      <li key={s.id} className="flex items-center justify-between text-xs border-b border-gray-50 pb-1.5">
                        <span className="text-gray-800 font-medium">{s.resultLabel ?? (s.resultValue != null ? String(s.resultValue) : '-')}</span>
                        <span className="text-gray-400">{s.performedByName} · {kdate(s.performedAt, 'datetimeSec')}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <div className="bg-white rounded-2xl border border-dashed border-gray-200 p-12 text-center text-gray-400">
              <p className="text-3xl mb-2">🩺</p>
              <T k="왼쪽에서 임상 도구를 선택하세요." />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
