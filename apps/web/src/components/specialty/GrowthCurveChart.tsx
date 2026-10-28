'use client';

import { T, useTAttr } from '@/components/ui/i18n-text';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface GrowthDataPoint {
  ageMonths: number;
  weight?: number;
  height?: number;
}

/**
 * 🔴 성별은 3상태다 — `null` = 미상.
 *    참조 백분위 곡선은 성별로 다르므로, 모르면 **곡선을 그리지 않고 모른다고 말한다**.
 *    (종전 호출부 2곳이 `gender="male"` 을 하드코딩해 여아를 남아 곡선 위에 그렸다. 2026-08-26)
 */
export type GrowthSex = 'male' | 'female' | null;

interface GrowthCurveChartProps {
  data: GrowthDataPoint[];
  type: 'weight' | 'height' | 'bmi';
  gender: GrowthSex;
}

/* ------------------------------------------------------------------ */
/*  Percentile reference data (approximate WHO/Korean standard)        */
/* ------------------------------------------------------------------ */

const PERCENTILES = [3, 15, 50, 85, 97] as const;

// Weight (kg) percentile reference at key age points (months: 0, 6, 12, 24, 36, 48, 60)
const WEIGHT_REF_MALE: Record<number, number[]> = {
  0: [2.5, 2.9, 3.3, 3.9, 4.3],
  6: [6.4, 7.1, 7.9, 8.8, 9.5],
  12: [7.8, 8.7, 9.6, 10.8, 11.8],
  24: [9.8, 10.8, 12.2, 13.6, 14.8],
  36: [11.3, 12.7, 14.3, 16.2, 17.7],
  48: [12.7, 14.4, 16.3, 18.8, 20.9],
  60: [14.1, 16.0, 18.3, 21.2, 24.2],
};

const WEIGHT_REF_FEMALE: Record<number, number[]> = {
  0: [2.4, 2.8, 3.2, 3.7, 4.2],
  6: [5.8, 6.5, 7.3, 8.2, 8.9],
  12: [7.2, 8.0, 8.9, 10.1, 11.0],
  24: [9.2, 10.2, 11.5, 13.0, 14.2],
  36: [10.8, 12.1, 13.9, 15.8, 17.2],
  48: [12.3, 13.9, 16.1, 18.5, 20.4],
  60: [13.7, 15.8, 18.2, 21.4, 23.5],
};

// Height (cm) percentile reference
const HEIGHT_REF_MALE: Record<number, number[]> = {
  0: [46.3, 47.9, 49.9, 51.8, 53.4],
  6: [63.6, 65.5, 67.6, 69.8, 71.6],
  12: [71.3, 73.4, 75.7, 78.1, 80.2],
  24: [81.7, 84.1, 87.1, 90.2, 92.9],
  36: [89.4, 92.1, 95.1, 98.7, 101.6],
  48: [95.8, 98.9, 102.3, 106.2, 109.4],
  60: [101.2, 105.0, 108.9, 113.4, 116.7],
};

const HEIGHT_REF_FEMALE: Record<number, number[]> = {
  0: [45.6, 47.2, 49.1, 51.0, 52.7],
  6: [61.8, 63.5, 65.7, 67.9, 69.8],
  12: [69.2, 71.4, 73.7, 76.4, 78.6],
  24: [80.0, 82.5, 85.7, 88.9, 91.4],
  36: [87.7, 90.4, 93.9, 97.5, 100.2],
  48: [94.1, 97.3, 101.1, 105.2, 108.3],
  60: [99.9, 103.5, 107.7, 112.3, 115.6],
};

const REF_AGES = [0, 6, 12, 24, 36, 48, 60];

/* ------------------------------------------------------------------ */
/*  Chart dimensions                                                   */
/* ------------------------------------------------------------------ */

const CHART_W = 400;
const CHART_H = 300;
const MARGIN = { top: 20, right: 40, bottom: 36, left: 44 };
const PLOT_W = CHART_W - MARGIN.left - MARGIN.right;
const PLOT_H = CHART_H - MARGIN.top - MARGIN.bottom;

const X_MIN = 0;
const X_MAX = 60;

function xToSvg(months: number): number {
  return MARGIN.left + ((months - X_MIN) / (X_MAX - X_MIN)) * PLOT_W;
}

function getYRange(type: 'weight' | 'height' | 'bmi'): [number, number] {
  if (type === 'weight') return [0, 28];
  if (type === 'height') return [40, 120];
  return [10, 22];
}

function yToSvg(v: number, yMin: number, yMax: number): number {
  return MARGIN.top + ((yMax - v) / (yMax - yMin)) * PLOT_H;
}

function interpolateRef(refs: Record<number, number[]>, age: number, pIdx: number): number {
  if (age <= 0) return refs[0][pIdx];
  if (age >= 60) return refs[60][pIdx];
  let lo = 0;
  let hi = 6;
  for (let i = 0; i < REF_AGES.length - 1; i++) {
    if (age >= REF_AGES[i] && age <= REF_AGES[i + 1]) {
      lo = REF_AGES[i];
      hi = REF_AGES[i + 1];
      break;
    }
  }
  const t = (age - lo) / (hi - lo);
  return refs[lo][pIdx] + t * (refs[hi][pIdx] - refs[lo][pIdx]);
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function GrowthCurveChart({ data, type, gender }: GrowthCurveChartProps) {
  const tAttr = useTAttr();
  const [yMin, yMax] = getYRange(type);
  const yLabel = type === 'weight' ? 'kg' : type === 'height' ? 'cm' : 'BMI';

  // 성별 미상이면 참조선을 고르지 못한다 — 임의로 남아 표를 쓰지 않는다.
  const refData = gender == null ? null : type === 'weight'
    ? (gender === 'male' ? WEIGHT_REF_MALE : WEIGHT_REF_FEMALE)
    : (gender === 'male' ? HEIGHT_REF_MALE : HEIGHT_REF_FEMALE);

  // Generate percentile line points
  const percentileLines = type !== 'bmi' && refData
    ? PERCENTILES.map((p, pIdx) => {
        const points: string[] = [];
        for (let m = 0; m <= 60; m += 2) {
          const val = interpolateRef(refData, m, pIdx);
          points.push(`${xToSvg(m)},${yToSvg(val, yMin, yMax)}`);
        }
        return { percentile: p, points: points.join(' '), labelY: yToSvg(interpolateRef(refData, 60, pIdx), yMin, yMax) + 3 };
      })
    : [];

  // Patient data points
  const measured = data
    .map((d) => ({
      age: d.ageMonths,
      value: type === 'weight' ? d.weight : type === 'height' ? d.height : undefined,
    }))
    .filter((d) => d.value != null && Number.isFinite(d.age)) as { age: number; value: number }[];

  // 🔴 참조표가 0~60개월뿐이라 그 밖의 계측은 도표 밖에 찍힌다 — **자르면 잘랐다고 말한다**.
  const patientValues = measured.filter((d) => d.age >= X_MIN && d.age <= X_MAX).sort((a, b) => a.age - b.age);
  const outOfRange = measured.length - patientValues.length;

  const patientLine = patientValues
    .map((d) => `${xToSvg(d.age)},${yToSvg(d.value, yMin, yMax)}`)
    .join(' ');

  // Y-axis ticks
  const yStep = type === 'weight' ? 4 : type === 'height' ? 10 : 2;
  const yTicks: number[] = [];
  for (let v = yMin; v <= yMax; v += yStep) yTicks.push(v);

  // X-axis ticks
  const xTicks = [0, 6, 12, 18, 24, 30, 36, 42, 48, 54, 60];

  return (
    <div className="w-full max-w-[440px] mx-auto">
      <p className="text-sm font-bold text-gray-700 mb-2">
        <T k="성장곡선" /> (<T k={type === 'weight' ? '체중' : type === 'height' ? '신장' : 'BMI'} /> / <T k={gender === 'male' ? '남아' : gender === 'female' ? '여아' : '성별 미상'} />)
      </p>
      {/* 🔴 참조곡선 표는 근사 5점(출처 미확인) — 곡선 위치로 판정하지 않게 그 사실을 상시 말한다(2026-10-10) */}
      <p className="text-[10px] text-gray-500 mb-1" data-growth-ref="APPROXIMATE"><T k="참조곡선은 근사값(출처 확인 전) — 백분위 판정에 쓰지 마세요" /></p>
      {gender == null && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 mb-2">
          <T k="환자 성별이 확인되지 않아" /> <b><T k="백분위 참조곡선을 표시하지 않습니다" /></b><T k=" — 계측값만 그립니다." />
        </p>
      )}
      {outOfRange > 0 && (
        <p className="text-[11px] text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1 mb-2">
          <T k="참조표 범위(0~60개월) 밖 계측" /> {outOfRange}<T k="건은 도표에서 제외했습니다." />
        </p>
      )}
      {measured.length === 0 && (
        <p className="text-[11px] text-gray-500 mb-2"><T k="표시할 계측값이 없습니다." /></p>
      )}

      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full h-auto" aria-label={tAttr('성장곡선 차트')}>
        {/* Grid */}
        {yTicks.map((v) => (
          <g key={v}>
            <line
              x1={MARGIN.left} y1={yToSvg(v, yMin, yMax)}
              x2={MARGIN.left + PLOT_W} y2={yToSvg(v, yMin, yMax)}
              stroke="#E5E7EB" strokeWidth={0.5}
            />
            <text x={MARGIN.left - 6} y={yToSvg(v, yMin, yMax) + 3} textAnchor="end" fontSize={8} fill="#9CA3AF">
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
          {yLabel}
        </text>

        {/* X-axis labels */}
        {xTicks.map((m) => (
          <text key={m} x={xToSvg(m)} y={CHART_H - MARGIN.bottom + 14} textAnchor="middle" fontSize={7} fill="#9CA3AF">
            {m}{tAttr('개월')}
          </text>
        ))}

        {/* Percentile reference lines */}
        {percentileLines.map(({ percentile, points, labelY }) => (
          <g key={percentile}>
            <polyline
              points={points}
              fill="none"
              stroke="#D1D5DB"
              strokeWidth={percentile === 50 ? 1.2 : 0.8}
              strokeDasharray={percentile === 50 ? undefined : '4,3'}
            />
            {/* Label at end */}
            <text
              x={MARGIN.left + PLOT_W + 4}
              y={labelY}
              fontSize={7} fill="#9CA3AF"
            >
              {percentile}%
            </text>
          </g>
        ))}

        {/* Patient data line */}
        {patientValues.length > 1 && (
          <polyline points={patientLine} fill="none" stroke="#3B82F6" strokeWidth={2} />
        )}

        {/* Patient data dots */}
        {patientValues.map((d, i) => (
          <circle
            key={i}
            cx={xToSvg(d.age)}
            cy={yToSvg(d.value, yMin, yMax)}
            r={3.5}
            fill="#3B82F6"
            stroke="white"
            strokeWidth={1.5}
          >
            <title>{`${d.age}${tAttr('개월')}: ${d.value}${yLabel}`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}
