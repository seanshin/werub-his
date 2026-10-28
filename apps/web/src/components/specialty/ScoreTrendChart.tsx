'use client';

import { T, useTAttr } from '@/components/ui/i18n-text';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ScoreSeries {
  name: string;
  data: { date: string; value: number }[];
  color: string;
  maxScore: number;
  referenceValue?: number;
  referenceLabel?: string;
}

interface ScoreTrendChartProps {
  series: ScoreSeries[];
}

/* ------------------------------------------------------------------ */
/*  Chart dimensions                                                   */
/* ------------------------------------------------------------------ */

const CHART_W = 400;
const CHART_H = 250;
const MARGIN = { top: 20, right: 60, bottom: 36, left: 40 };
const PLOT_W = CHART_W - MARGIN.left - MARGIN.right;
const PLOT_H = CHART_H - MARGIN.top - MARGIN.bottom;

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ScoreTrendChart({ series }: ScoreTrendChartProps) {
  const tAttr = useTAttr();
  if (series.length === 0) {
    return <div className="text-center py-8 text-gray-400 text-sm"><T k="데이터 없음" /></div>;
  }

  // Determine Y range from all series maxScores
  const yMax = Math.max(...series.map((s) => s.maxScore));
  const yMin = 0;

  // Collect all unique dates across all series
  const allDates = Array.from(new Set(series.flatMap((s) => s.data.map((d) => d.date)))).sort();
  const dateCount = allDates.length;

  function xToSvg(i: number): number {
    if (dateCount <= 1) return MARGIN.left + PLOT_W / 2;
    return MARGIN.left + (i / (dateCount - 1)) * PLOT_W;
  }

  function yToSvg(v: number): number {
    return MARGIN.top + ((yMax - v) / (yMax - yMin)) * PLOT_H;
  }

  // Y-axis ticks
  const yStep = yMax <= 10 ? 2 : yMax <= 30 ? 5 : 10;
  const yTicks: number[] = [];
  for (let v = yMin; v <= yMax; v += yStep) yTicks.push(v);
  if (!yTicks.includes(yMax)) yTicks.push(yMax);

  return (
    <div className="w-full max-w-[440px] mx-auto">
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full h-auto" aria-label={tAttr('점수 추이 차트')}>
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

        {/* X-axis date labels */}
        {allDates.map((date, i) => (
          <text key={date} x={xToSvg(i)} y={CHART_H - MARGIN.bottom + 14} textAnchor="middle" fontSize={7} fill="#9CA3AF">
            {date.length > 5 ? date.slice(5) : date}
          </text>
        ))}

        {/* Reference lines */}
        {series.map((s) =>
          s.referenceValue !== undefined ? (
            <g key={`ref-${s.name}`}>
              <line
                x1={MARGIN.left} y1={yToSvg(s.referenceValue)}
                x2={MARGIN.left + PLOT_W} y2={yToSvg(s.referenceValue)}
                stroke={s.color} strokeWidth={1} strokeDasharray="6,3" opacity={0.5}
              />
              <text
                x={MARGIN.left + PLOT_W + 4}
                y={yToSvg(s.referenceValue) + 3}
                fontSize={7} fill={s.color} opacity={0.7}
              >
                {s.referenceLabel ?? s.referenceValue}
              </text>
            </g>
          ) : null,
        )}

        {/* Lines and dots for each series */}
        {series.map((s) => {
          // Map series data to allDates indices
          const dateValueMap = new Map(s.data.map((d) => [d.date, d.value]));
          const points: { x: number; y: number; date: string; value: number }[] = [];

          allDates.forEach((date, i) => {
            const val = dateValueMap.get(date);
            if (val !== undefined) {
              points.push({ x: xToSvg(i), y: yToSvg(val), date, value: val });
            }
          });

          const polyline = points.map((p) => `${p.x},${p.y}`).join(' ');

          return (
            <g key={s.name}>
              {points.length > 1 && (
                <polyline points={polyline} fill="none" stroke={s.color} strokeWidth={2} />
              )}
              {points.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={3.5} fill={s.color} stroke="white" strokeWidth={1.5}>
                  <title>{`${s.name}: ${p.value} (${p.date})`}</title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-4 mt-2">
        {series.map((s) => (
          <div key={s.name} className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: s.color }} />
            <span className="text-[10px] text-gray-600 whitespace-nowrap">{s.name} (0-{s.maxScore})</span>
          </div>
        ))}
      </div>
    </div>
  );
}
