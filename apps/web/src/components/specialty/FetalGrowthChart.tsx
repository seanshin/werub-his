'use client';

import { T, useTAttr } from '@/components/ui/i18n-text';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface FetalGrowthDataPoint {
  gestationalWeek: number;
  bpd?: number;
  fl?: number;
  ac?: number;
  efw?: number;
}

interface FetalGrowthChartProps {
  data: FetalGrowthDataPoint[];
  metric: 'bpd' | 'fl' | 'ac' | 'efw';
}

/* ------------------------------------------------------------------ */
/*  Reference data (approximate 10th, 50th, 90th percentile)           */
/* ------------------------------------------------------------------ */

const PERCENTILES = [10, 50, 90] as const;

// BPD (mm) at weeks 12,16,20,24,28,32,36,40
const BPD_REF: Record<number, number[]> = {
  12: [18, 21, 24],
  16: [31, 35, 39],
  20: [44, 48, 52],
  24: [56, 61, 66],
  28: [67, 73, 78],
  32: [77, 82, 88],
  36: [84, 89, 94],
  40: [88, 94, 99],
};

// FL (mm)
const FL_REF: Record<number, number[]> = {
  12: [7, 9, 11],
  16: [17, 20, 23],
  20: [29, 33, 37],
  24: [40, 44, 48],
  28: [49, 53, 57],
  32: [57, 62, 66],
  36: [64, 69, 73],
  40: [69, 74, 79],
};

// AC (mm)
const AC_REF: Record<number, number[]> = {
  12: [50, 58, 66],
  16: [90, 102, 114],
  20: [137, 152, 167],
  24: [183, 201, 219],
  28: [225, 247, 269],
  32: [264, 290, 316],
  36: [295, 325, 355],
  40: [316, 350, 384],
};

// EFW (g)
const EFW_REF: Record<number, number[]> = {
  12: [14, 18, 22],
  16: [100, 120, 140],
  20: [275, 330, 390],
  24: [550, 660, 780],
  28: [920, 1100, 1300],
  32: [1500, 1800, 2100],
  36: [2200, 2620, 3040],
  40: [2800, 3350, 3900],
};

const REF_WEEKS = [12, 16, 20, 24, 28, 32, 36, 40];

const METRIC_CONFIG: Record<string, { label: string; unit: string; refs: Record<number, number[]> }> = {
  bpd: { label: 'BPD (두정골간 직경)', unit: 'mm', refs: BPD_REF },
  fl: { label: 'FL (대퇴골 길이)', unit: 'mm', refs: FL_REF },
  ac: { label: 'AC (복부 둘레)', unit: 'mm', refs: AC_REF },
  efw: { label: 'EFW (추정 태아 체중)', unit: 'g', refs: EFW_REF },
};

/* ------------------------------------------------------------------ */
/*  Chart dimensions                                                   */
/* ------------------------------------------------------------------ */

const CHART_W = 400;
const CHART_H = 300;
const MARGIN = { top: 20, right: 40, bottom: 36, left: 50 };
const PLOT_W = CHART_W - MARGIN.left - MARGIN.right;
const PLOT_H = CHART_H - MARGIN.top - MARGIN.bottom;
const X_MIN = 12;
const X_MAX = 42;

function xToSvg(week: number): number {
  return MARGIN.left + ((week - X_MIN) / (X_MAX - X_MIN)) * PLOT_W;
}

function interpolateRef(refs: Record<number, number[]>, week: number, pIdx: number): number {
  if (week <= 12) return refs[12][pIdx];
  if (week >= 40) return refs[40][pIdx];
  let lo = 12;
  let hi = 16;
  for (let i = 0; i < REF_WEEKS.length - 1; i++) {
    if (week >= REF_WEEKS[i] && week <= REF_WEEKS[i + 1]) {
      lo = REF_WEEKS[i];
      hi = REF_WEEKS[i + 1];
      break;
    }
  }
  const t = (week - lo) / (hi - lo);
  return refs[lo][pIdx] + t * (refs[hi][pIdx] - refs[lo][pIdx]);
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function FetalGrowthChart({ data, metric }: FetalGrowthChartProps) {
  const tAttr = useTAttr();
  const config = METRIC_CONFIG[metric];
  const refs = config.refs;

  // Determine Y range
  const allRefVals = Object.values(refs).flat();
  const patientVals = data.map((d) => d[metric]).filter((v) => v !== undefined) as number[];
  const allVals = [...allRefVals, ...patientVals];
  const yMin = Math.floor(Math.min(...allVals) * 0.8);
  const yMax = Math.ceil(Math.max(...allVals) * 1.1);

  function yToSvg(v: number): number {
    return MARGIN.top + ((yMax - v) / (yMax - yMin)) * PLOT_H;
  }

  // Percentile lines
  const percentileLines = PERCENTILES.map((p, pIdx) => {
    const points: string[] = [];
    for (let w = 12; w <= 40; w += 1) {
      const val = interpolateRef(refs, w, pIdx);
      points.push(`${xToSvg(w)},${yToSvg(val)}`);
    }
    return { percentile: p, points: points.join(' ') };
  });

  // Patient data
  const patientData = data
    .map((d) => ({ week: d.gestationalWeek, value: d[metric] }))
    .filter((d) => d.value !== undefined)
    .sort((a, b) => a.week - b.week) as { week: number; value: number }[];

  const patientLine = patientData.map((d) => `${xToSvg(d.week)},${yToSvg(d.value)}`).join(' ');

  // Y ticks
  const yRange = yMax - yMin;
  const yStep = yRange <= 50 ? 5 : yRange <= 200 ? 20 : yRange <= 1000 ? 100 : 500;
  const yTicks: number[] = [];
  for (let v = Math.ceil(yMin / yStep) * yStep; v <= yMax; v += yStep) yTicks.push(v);

  // X ticks
  const xTicks: number[] = [];
  for (let w = 12; w <= 42; w += 2) xTicks.push(w);

  return (
    <div className="w-full max-w-[440px] mx-auto">
      <p className="text-sm font-bold text-gray-700 mb-2"><T k={config.label} /></p>

      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full h-auto" aria-label={tAttr('태아 성장 차트')}>
        {/* Grid */}
        {yTicks.map((v) => (
          <g key={v}>
            <line
              x1={MARGIN.left} y1={yToSvg(v)}
              x2={MARGIN.left + PLOT_W} y2={yToSvg(v)}
              stroke="#E5E7EB" strokeWidth={0.5}
            />
            <text x={MARGIN.left - 6} y={yToSvg(v) + 3} textAnchor="end" fontSize={8} fill="#9CA3AF">
              {v}
            </text>
          </g>
        ))}

        {/* Y-axis label */}
        <text
          x={10} y={MARGIN.top + PLOT_H / 2}
          textAnchor="middle" fontSize={8} fill="#9CA3AF"
          transform={`rotate(-90, 10, ${MARGIN.top + PLOT_H / 2})`}
        >
          {config.unit}
        </text>

        {/* X-axis labels */}
        {xTicks.map((w) => (
          <text key={w} x={xToSvg(w)} y={CHART_H - MARGIN.bottom + 14} textAnchor="middle" fontSize={7} fill="#9CA3AF">
            {w}{tAttr('주')}
          </text>
        ))}

        {/* Percentile reference lines */}
        {percentileLines.map(({ percentile, points }) => (
          <g key={percentile}>
            <polyline
              points={points}
              fill="none"
              stroke="#D1D5DB"
              strokeWidth={percentile === 50 ? 1.2 : 0.8}
              strokeDasharray={percentile === 50 ? undefined : '4,3'}
            />
            <text
              x={MARGIN.left + PLOT_W + 4}
              y={yToSvg(interpolateRef(refs, 40, PERCENTILES.indexOf(percentile))) + 3}
              fontSize={7} fill="#9CA3AF"
            >
              {percentile}%
            </text>
          </g>
        ))}

        {/* Patient data line */}
        {patientData.length > 1 && (
          <polyline points={patientLine} fill="none" stroke="#EC4899" strokeWidth={2} />
        )}

        {/* Patient dots */}
        {patientData.map((d, i) => (
          <circle
            key={i}
            cx={xToSvg(d.week)}
            cy={yToSvg(d.value)}
            r={3.5}
            fill="#EC4899"
            stroke="white"
            strokeWidth={1.5}
          >
            <title>{`${d.week}${tAttr('주')}: ${d.value}${config.unit}`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}
