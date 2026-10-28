'use client';

/**
 * 판독 보조 패널 (RADS·영상 분류) — 영상 탭/판독 화면에서 사용.
 * 영상·병리 카테고리 임상도구(BI/LI/PI/Lung/O/CAD-RADS·Bosniak·TI-RADS·골절/척추 분류·AAST·TICI 등)를
 * 선택→입력→판정하고, 환자(선택 시 검사 연관)에 결과를 영속(ClinicalChartResult).
 * HIS 측 판독 보조 UI — PACS(OpenPACS)는 링크만 제공(수정 금지 규칙 준수).
 */
import { useMemo, useState } from 'react';
import { kdate } from '@/lib/ui-settings';
import { Unit } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { CLINICAL_CHARTS, getChart, ARCHETYPE_LABEL } from '@/lib/clinical-charts';
import { ClinicalChartRunner, type ClinicalChartValue } from './ClinicalChartRunner';

export interface RadsStudyRef { uid: string; label: string }

interface SavedResult {
  id: string; chartId: string; chartName: string;
  resultLabel?: string | null; resultLevel?: string | null; resultValue?: string | number | null;
  performedByName: string; performedAt: string;
  inputs?: Record<string, unknown> | null;
}

const IMAGING_CATEGORIES = ['영상', '병리'];

export function RadsAssistPanel({ patientId, studies }: { patientId?: string; studies?: RadsStudyRef[] }) {
  const charts = useMemo(
    () => CLINICAL_CHARTS.filter((c) => IMAGING_CATEGORIES.includes(c.category)).sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    [],
  );
  const imagingIds = useMemo(() => new Set(charts.map((c) => c.chartId)), [charts]);

  const [chartId, setChartId] = useState('');
  const [studyUid, setStudyUid] = useState('');
  const [current, setCurrent] = useState<ClinicalChartValue | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const tAttr = useTAttr();

  const selected = chartId ? getChart(chartId) : null;

  // 이 환자의 영상 관련 임상도구 최근 결과
  const { data: savedData, refetch: refetchSaved } = useQuery({
    queryKey: ['rads-results', patientId],
    queryFn: () => apiClient.get<{ data: SavedResult[] }>('/api/v1/clinical-chart-results', { patientId: patientId! }),
    enabled: !!patientId,
  });
  const saved: SavedResult[] = useMemo(() => {
    const raw = savedData?.data;
    const list: SavedResult[] = Array.isArray(raw) ? raw : (raw as { data?: SavedResult[] } | undefined)?.data ?? [];
    return list.filter((r) => imagingIds.has(r.chartId)).slice(0, 5);
  }, [savedData, imagingIds]);

  const saveMut = useMutation({
    mutationFn: () => {
      if (!patientId || !selected || !current) throw new Error('no data');
      const r = current.result;
      const study = studies?.find((s) => s.uid === studyUid);
      return apiClient.post('/api/v1/clinical-chart-results', {
        patientId,
        chartId: selected.chartId,
        chartName: selected.name,
        archetype: selected.archetype,
        sourceVersion: selected.sourceVersion,
        // 연관 검사(선택)는 inputs 에 동봉 — 스키마 무변경
        inputs: study ? { ...current.inputs, _study: { uid: study.uid, label: study.label } } : current.inputs,
        resultLabel: r.label,
        resultLevel: r.level,
        resultValue: typeof r.value === 'number' ? r.value : (typeof r.total === 'number' ? r.total : undefined),
        recommendation: r.recommendation,
        flags: r.flags,
      });
    },
    onSuccess: () => { setMsg(tAttr('판독 보조 결과 저장됨')); setCurrent(null); refetchSaved(); setTimeout(() => setMsg(null), 3000); },
    onError: () => setMsg(tAttr('저장 실패')),
  });

  const canSave = !!patientId && !!current && (current.result.label != null || current.result.value != null || current.result.total != null);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-bold text-gray-700"><T k="판독 보조 (RADS·영상 분류)" /></h3>
        <span className="text-[11px] text-gray-400"><T k="보조도구 · 최종 판독/판단은 판독의·의사 귀속" /></span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500 block mb-1"><T k="분류 도구" /> ({charts.length}<Unit>{tAttr('종')}</Unit>)</label>
          <select value={chartId} onChange={(e) => { setChartId(e.target.value); setCurrent(null); }}
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-blue-400 focus:outline-none">
            <option value="">{tAttr('— 선택 —')}</option>
            {charts.map((c) => <option key={c.chartId} value={c.chartId}>{c.name} [{ARCHETYPE_LABEL[c.archetype]}]</option>)}
          </select>
        </div>
        {studies && studies.length > 0 && (
          <div>
            <label className="text-xs text-gray-500 block mb-1"><T k="연관 검사 (선택)" /></label>
            <select value={studyUid} onChange={(e) => setStudyUid(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-blue-400 focus:outline-none">
              <option value="">{tAttr('— 없음 —')}</option>
              {studies.map((s) => <option key={s.uid} value={s.uid}>{s.label}</option>)}
            </select>
          </div>
        )}
      </div>

      {selected && (
        <>
          <ClinicalChartRunner key={selected.chartId} def={selected} onChange={setCurrent} />
          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={() => saveMut.mutate()} disabled={!canSave || saveMut.isPending}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-40">
              <T k={saveMut.isPending ? '저장 중…' : '환자 차트에 저장'} />
            </button>
            {!patientId && <span className="text-xs text-gray-400"><T k="환자 컨텍스트가 없어 저장할 수 없습니다." /></span>}
            {patientId && !canSave && <span className="text-xs text-gray-400"><T k="등급을 선택/판정하면 저장할 수 있습니다." /></span>}
            {msg && <span className="text-xs font-medium text-emerald-600">{msg}</span>}
          </div>
        </>
      )}

      {saved.length > 0 && (
        <div className="pt-3 border-t border-gray-50">
          <p className="text-xs font-semibold text-gray-500 mb-2"><T k="최근 판독 보조 기록" /></p>
          <ul className="space-y-1.5">
            {saved.map((s) => {
              const study = (s.inputs as { _study?: { label?: string } } | null | undefined)?._study;
              return (
                <li key={s.id} className="flex items-center justify-between text-[11px] gap-2">
                  <span className="text-gray-700 min-w-0 truncate">
                    <b>{s.chartName}</b> — {s.resultLabel ?? (s.resultValue != null ? String(s.resultValue) : '-')}
                    {study?.label && <span className="text-gray-400"> · {study.label}</span>}
                  </span>
                  <span className="text-gray-400 whitespace-nowrap">{s.performedByName} · {kdate(new Date(s.performedAt), 'date')}</span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
