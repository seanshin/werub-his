'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend,
} from 'chart.js';
import { QueryErrorFallback } from '@/components/ui/QueryErrorFallback';
import { apiClient } from '@/lib/api-client';
import { subMonths, subYears } from 'date-fns';
import { safeFormat as format } from '@/lib/safe-date';
import { formatTemp } from '@/lib/vital-ranges';
import { useVitalsThresholds } from '@/lib/vital-flags';
import { VitalHeaderCells, VitalRowCells } from '@/components/vitals/VitalSigns';
import { VitalsRuleNote } from '@/components/vitals/VitalsRuleNote';
import { VITAL_SETS, type VitalSignKey } from '@hospital-run/shared';

import { EmptyState } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';
import { kdate } from '@/lib/ui-settings';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

interface VitalRecord {
  source: 'OPD' | 'IPD' | 'EWS';
  at: string;
  systolicBp: number | null;
  diastolicBp: number | null;
  heartRate: number | null;
  spo2: number | null;
  temperature: number | null;
  respiratoryRate: number | null;
  painScore: number | null;
  weight: number | null;
  bmi: number | null;
  ewsScore: number | null;
}

/** 표 열 — 표준 줄(RR·SpO₂·BP·HR·BT·통증) + 계측(체중·BMI) */
const TABLE_VITAL_KEYS: readonly VitalSignKey[] = [...VITAL_SETS.standard, 'weight', 'bmi'];

const SOURCE_META: Record<string, { label: string; cls: string }> = {
  OPD: { label: '외래', cls: 'bg-blue-100 text-blue-700' },
  IPD: { label: '입원', cls: 'bg-purple-100 text-purple-700' },
  EWS: { label: 'NEWS2', cls: 'bg-amber-100 text-amber-700' },
};

/**
 * 바이탈 시계열 멀티축 라인차트 — BP(수축/이완)·HR·SpO2·체온을 한 축 위에 시간순으로 겹쳐 본다.
 * 스케일이 다른 지표(BP 60–200·SpO2 85–100·BT 35–40)라 y축을 분리하고, x축은 기간에 맞춰
 * 날짜/시각 라벨을 찍는다. null(결측)은 이어붙이지 않고 끊는다(spanGaps=false).
 */
function VitalsTimeSeriesChart({ vitals, periodMonths }: { vitals: VitalRecord[]; periodMonths: number }) {
  const chart = useMemo(() => {
    const fmtLabel = (iso: string) => {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      // 단기(1~3개월)는 날짜+시각, 장기는 날짜만
      return periodMonths <= 3
        ? kdate(d, 'datetimeShort')
        // 차트 축은 폭이 좁아 두 자리 연도를 유지한다 — 정본 `dateShortYear`(정책·로케일 경유)
        : kdate(d, 'dateShortYear');
    };
    const labels = vitals.map(v => fmtLabel(v.at));
    const round1 = (n: number | null) => (n == null ? null : Math.round(Number(n) * 10) / 10);
    const line = (data: (number | null)[], color: string, yAxisID: string, label: string, dash?: number[]) => ({
      label, data, borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: 2.5,
      pointHoverRadius: 4, pointBackgroundColor: color, tension: 0.25, fill: false, spanGaps: false, yAxisID,
      ...(dash ? { borderDash: dash, borderWidth: 1.5, pointRadius: 1.5 } : {}),
    });
    return {
      labels,
      datasets: [
        line(vitals.map(v => v.systolicBp), '#3B82F6', 'yBP', '수축기 BP'),
        line(vitals.map(v => v.diastolicBp), '#60A5FA', 'yBP', '이완기 BP', [4, 2]),
        line(vitals.map(v => v.heartRate), '#EF4444', 'yHR', 'HR'),
        line(vitals.map(v => v.spo2), '#6366F1', 'ySpO2', 'SpO₂'),
        line(vitals.map(v => round1(v.temperature)), '#F59E0B', 'yBT', '체온'),
      ],
    };
  }, [vitals, periodMonths]);

  return (
    <div className="h-72">
      <Line
        data={chart}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 }, usePointStyle: true } },
            tooltip: {
              titleFont: { size: 11 }, bodyFont: { size: 11 },
              callbacks: {
                label: (ctx) => {
                  const y = ctx.dataset.yAxisID;
                  const v = ctx.parsed.y;
                  if (v == null) return '';
                  if (y === 'yBT') return `체온 ${formatTemp(Number(v))}`; // formatTemp 가 ℃ 를 붙인다(단위 중복 금지) · 수치정책(temperature) 경유
                  if (y === 'ySpO2') return `SpO₂ ${v}%`;
                  if (y === 'yHR') return `HR ${v} bpm`;
                  return `${ctx.dataset.label} ${v} mmHg`;
                },
              },
            },
          },
          scales: {
            x: { grid: { display: false }, ticks: { font: { size: 9 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
            yBP: { type: 'linear', position: 'left', min: 40, max: 200, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { size: 9 }, stepSize: 40 }, title: { display: true, text: 'BP', font: { size: 9 } } },
            yHR: { type: 'linear', position: 'right', min: 40, max: 160, display: false },
            ySpO2: { type: 'linear', position: 'right', min: 80, max: 100, display: false },
            yBT: { type: 'linear', position: 'right', min: 34, max: 41, display: false },
          },
        }}
      />
    </div>
  );
}


const PERIOD_OPTIONS = [
  { label: '1개월', value: 1 },
  { label: '3개월', value: 3 },
  { label: '6개월', value: 6 },
  { label: '1년', value: 12 },
] as const;

export function VitalsTab({ patientId }: { patientId: string }) {
  // 이상 판정은 임계 정본(shared + 환자안전위 개정) — 화면이 숫자를 따로 적지 않는다(2026-10-01)
  const vitalsRule = useVitalsThresholds();
  const tAttr = useTAttr();
  const [periodMonths, setPeriodMonths] = useState<number>(3);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['patient-vitals-timeline', patientId],
    queryFn: () => apiClient.get<{ data: VitalRecord[] }>(`/api/v1/patients/${patientId}/vitals-timeline`),
    enabled: !!patientId,
  });

  const _raw = data?.data;
  const allVitals: VitalRecord[] = Array.isArray(_raw) ? _raw : (_raw as Record<string, unknown> | undefined)?.data as VitalRecord[] ?? [];

  const cutoff = useMemo(() => {
    return periodMonths === 12 ? subYears(new Date(), 1) : subMonths(new Date(), periodMonths);
  }, [periodMonths]);

  const vitals = useMemo(() => {
    return allVitals
      .filter(v => new Date(v.at) >= cutoff)
      .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }, [allVitals, cutoff]);

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-gray-900"><T k="바이탈 (Vitals)" /></h3>
        <div className="flex gap-1">
          {PERIOD_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setPeriodMonths(opt.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                periodMonths === opt.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : isError ? (
        /* 🔴 조회 실패를 "없습니다"로 그리지 않는다 — import 만 있고 렌더가 없던 자리(2026-09-02) */
        <QueryErrorFallback error={error} onRetry={() => refetch()} />
      ) : vitals.length === 0 ? (
        <EmptyState icon="🩺" title="바이탈 기록이 없습니다" />
      ) : (
        <div className="space-y-6">
          {/* 통합 시계열 차트 — BP·HR·SpO2·체온을 시간순으로 겹쳐 본다 */}
          {vitals.length >= 2 ? (
            <div className="border border-gray-100 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-gray-700"><T k="바이탈 추이" /></h4>
                <span className="text-[10px] text-gray-400"><T k="정상 BP 90–140 · HR 60–100 · SpO₂ ≥95 · BT 36–37.5" /></span>
              </div>
              <VitalsTimeSeriesChart vitals={vitals} periodMonths={periodMonths} />
            </div>
          ) : (
            <div className="border border-gray-100 rounded-xl p-4 text-center text-xs text-gray-400">
              추이 그래프는 2회 이상 측정 시 표시됩니다 (현재 {vitals.length}회)
            </div>
          )}

          {/* Table */}
          <div className="border border-gray-100 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap"><T k="날짜" /></th>
                    <VitalHeaderCells keys={TABLE_VITAL_KEYS} className="px-4 py-2 text-center text-xs font-medium text-gray-500 whitespace-nowrap" />
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap"><T k="소스" /></th>
                  </tr>
                </thead>
                <tbody>
                  {[...vitals].reverse().map((v, i) => {
                    const sm = SOURCE_META[v.source] ?? { label: v.source, cls: 'bg-gray-100 text-gray-600' };
                    return (
                      <tr key={`${v.source}-${v.at}-${i}`} className="border-b border-gray-50 hover:bg-gray-50/50">
                        <td className="px-4 py-2 text-gray-700 whitespace-nowrap">{format(new Date(v.at), 'yyyy-MM-dd HH:mm')}</td>
                        <VitalRowCells vitals={v as unknown as Record<string, unknown>} keys={TABLE_VITAL_KEYS} rule={vitalsRule} className="px-4 py-2 text-center font-mono whitespace-nowrap" />
                        <td className="px-4 py-2 whitespace-nowrap">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${sm.cls}`}>{sm.label}</span>
                          {/* NEWS2 위험도별 색 — ≥7 HIGH(위급 빨강)·5–6 MEDIUM(amber)·0–4 LOW(회색). 종전 위험도 무관 amber 고정 개선 */}
                          {v.ewsScore != null && <span className={`ml-1 text-[10px] font-medium ${v.ewsScore >= 7 ? 'text-red-600 font-bold' : v.ewsScore >= 5 ? 'text-amber-600' : 'text-gray-500'}`}>EWS {v.ewsScore}{v.ewsScore >= 7 ? ' 🔴' : ''}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <VitalsRuleNote rule={vitalsRule} className="px-4 py-2" />
          </div>
        </div>
      )}
    </div>
  );
}
