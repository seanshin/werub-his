'use client';

import { useMemo } from 'react';
import { kdate } from '@/lib/ui-settings';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler } from 'chart.js';

import { T, useTAttr } from '@/components/ui/i18n-text';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Filler);

interface VitalEntry {
  recordedAt: string;
  systolicBp?: number | null;
  diastolicBp?: number | null;
  heartRate?: number | null;
  spo2?: number | null;
  temperature?: number | null;
  painScore?: number | null;
}

interface Props {
  entries: VitalEntry[];
  className?: string;
}

export function VitalTrendChart({ entries, className }: Props) {
  const tAttr = useTAttr();
  const data = useMemo(() => {
    const sorted = [...entries].sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());
    const labels = sorted.map(e => {
      try { return kdate(new Date(e.recordedAt), 'time'); } catch { return ''; }
    });

    return {
      labels,
      datasets: [
        {
          label: tAttr('수축기 BP'),
          data: sorted.map(e => e.systolicBp ?? null),
          borderColor: '#3B82F6',
          backgroundColor: 'rgba(59,130,246,0.1)',
          borderWidth: 2,
          pointRadius: 3,
          pointBackgroundColor: '#3B82F6',
          tension: 0.3,
          fill: false,
          yAxisID: 'yBP',
        },
        {
          label: tAttr('이완기 BP'),
          data: sorted.map(e => e.diastolicBp ?? null),
          borderColor: '#93C5FD',
          borderWidth: 1.5,
          borderDash: [4, 2],
          pointRadius: 2,
          tension: 0.3,
          fill: false,
          yAxisID: 'yBP',
        },
        {
          label: 'HR',
          data: sorted.map(e => e.heartRate ?? null),
          borderColor: '#EF4444',
          borderWidth: 2,
          pointRadius: 3,
          pointBackgroundColor: '#EF4444',
          tension: 0.3,
          fill: false,
          yAxisID: 'yHR',
        },
        {
          label: 'SpO2',
          data: sorted.map(e => e.spo2 ?? null),
          borderColor: '#10B981',
          borderWidth: 2,
          pointRadius: 3,
          pointBackgroundColor: '#10B981',
          tension: 0.3,
          fill: false,
          yAxisID: 'ySpO2',
        },
        {
          label: tAttr('통증 NRS'),
          data: sorted.map(e => e.painScore ?? null),
          borderColor: '#F59E0B',
          borderWidth: 2,
          pointRadius: 3,
          pointBackgroundColor: '#F59E0B',
          tension: 0.3,
          fill: false,
          yAxisID: 'yNRS',
        },
      ],
    };
  }, [entries, tAttr]);

  if (entries.length === 0) return null;

  return (
    <div className={`bg-white rounded-xl border border-gray-100 p-4 ${className ?? ''}`}>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-bold text-gray-700"><T k="바이탈 트렌드" /></h4>
        <div className="flex gap-3 text-[10px]">
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-blue-500 inline-block" /> BP</span>
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-red-500 inline-block" /> HR</span>
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-emerald-500 inline-block" /> SpO2</span>
          <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-amber-500 inline-block" /> NRS</span>
        </div>
      </div>
      <div className="h-36">
        <Line
          data={data}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: { tooltip: { titleFont: { size: 10 }, bodyFont: { size: 10 } } },
            scales: {
              x: { grid: { display: false }, ticks: { font: { size: 9 }, maxRotation: 0 } },
              yBP: { type: 'linear', position: 'left', min: 60, max: 200, grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { font: { size: 9 }, stepSize: 40 }, title: { display: false } },
              yHR: { type: 'linear', position: 'right', min: 40, max: 140, display: false },
              ySpO2: { type: 'linear', position: 'right', min: 85, max: 100, display: false },
              yNRS: { type: 'linear', position: 'right', min: 0, max: 10, display: false },
            },
          }}
        />
      </div>
      {/* 근무조 배경 구간 */}
      <div className="flex mt-2 h-1.5 rounded-full overflow-hidden">
        <div className="flex-[7] bg-amber-200/50" title={tAttr('주간 07-15')} />
        <div className="flex-[8] bg-blue-200/50" title={tAttr('준야 15-23')} />
        <div className="flex-[9] bg-slate-200/50" title={tAttr('야간 23-07')} />
      </div>
      <div className="flex text-[9px] text-gray-400 mt-0.5">
        {/* 🔴 `주간` 은 outpatient 카탈로그가 'Week'(주 단위)로 선점했다 — 여기는 **근무조**(day shift)다.
            바로 위 툴팁('주간 07-15' = Day shift)과 이 라벨(Week)이 같은 부품 안에서 모순됐다(2026-09-09 실측). */}
        <span className="flex-[7] text-center"><T k="주간@근무조" /></span>
        <span className="flex-[8] text-center"><T k="준야" /></span>
        <span className="flex-[9] text-center"><T k="야간" /></span>
      </div>
    </div>
  );
}
