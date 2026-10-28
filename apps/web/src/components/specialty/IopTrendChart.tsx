'use client';

import { useState } from 'react';

import { T, useTAttr } from '@/components/ui/i18n-text';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/**
 * 🔴 미측정은 `null` 이다 — 0 을 넘기지 않는다. 안압 0 mmHg 는 임상적으로 존재할 수 없는 값이라
 *    "안 쟀다"를 0 으로 접으면 차트가 **급락**으로 그린다(호출부가 `?? 0` 을 쓰고 있었다).
 *    이 컴포넌트는 null 점을 그리지 않고 선도 그 자리에서 끊는다(사이를 이으면 보간을 지어내는 것).
 */
export interface IopDataPoint {
  date: string;
  od: number | null;
  os: number | null;
}

interface IopTrendChartProps {
  data: IopDataPoint[];
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const Y_MIN = 5;
const Y_MAX = 35;
const CHART_W = 500;
const CHART_H = 240;
const MARGIN = { top: 24, right: 30, bottom: 40, left: 44 };
const PLOT_W = CHART_W - MARGIN.left - MARGIN.right;
const PLOT_H = CHART_H - MARGIN.top - MARGIN.bottom;

function yToSvg(v: number): number {
  const clamped = Math.max(Y_MIN, Math.min(Y_MAX, v));
  return MARGIN.top + ((Y_MAX - clamped) / (Y_MAX - Y_MIN)) * PLOT_H;
}

function xToSvg(i: number, total: number): number {
  if (total <= 1) return MARGIN.left + PLOT_W / 2;
  return MARGIN.left + (i / (total - 1)) * PLOT_W;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function IopTrendChart({ data }: IopTrendChartProps) {
  const [hovered, setHovered] = useState<{ idx: number; eye: 'od' | 'os' } | null>(null);
  const tAttr = useTAttr();

  if (data.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400 text-sm"><T k="안압 데이터 없음" /></div>
    );
  }

  const n = data.length;

  /** 측정된 점만 잇는다. 미측정에서 선을 끊어 **없는 값을 이어 그리지 않는다**. */
  const segmentsOf = (eye: 'od' | 'os'): string[] => {
    const segs: string[] = [];
    let cur: string[] = [];
    data.forEach((d, i) => {
      const v = d[eye];
      if (v == null) {
        if (cur.length > 0) segs.push(cur.join(' '));
        cur = [];
        return;
      }
      cur.push(`${xToSvg(i, n)},${yToSvg(v)}`);
    });
    if (cur.length > 0) segs.push(cur.join(' '));
    return segs;
  };
  const odSegments = segmentsOf('od');
  const osSegments = segmentsOf('os');
  const measured = (eye: 'od' | 'os') =>
    data.map((d, i) => ({ i, v: d[eye] })).filter((p): p is { i: number; v: number } => p.v != null);
  const missingCount = data.filter((d) => d.od == null || d.os == null).length;

  // Y-axis ticks
  const yTicks = [5, 10, 15, 20, 21, 25, 30, 35];

  return (
    <div className="w-full max-w-[560px] mx-auto">
      <p className="text-sm font-bold text-gray-700 mb-2"><T k="안압 추이 (IOP Trend)" /></p>
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="w-full h-auto"
        aria-label={tAttr('안압 추이 차트')}
      >
        {/* Background bands */}
        {/* Normal: 10-21 green */}
        <rect
          x={MARGIN.left}
          y={yToSvg(21)}
          width={PLOT_W}
          height={yToSvg(10) - yToSvg(21)}
          fill="#22C55E"
          opacity={0.08}
        />
        {/* Caution: 22-25 yellow */}
        <rect
          x={MARGIN.left}
          y={yToSvg(25)}
          width={PLOT_W}
          height={yToSvg(22) - yToSvg(25)}
          fill="#EAB308"
          opacity={0.1}
        />
        {/* Danger: 26+ red */}
        <rect
          x={MARGIN.left}
          y={yToSvg(Y_MAX)}
          width={PLOT_W}
          height={yToSvg(26) - yToSvg(Y_MAX)}
          fill="#EF4444"
          opacity={0.08}
        />

        {/* Grid & Y-axis labels */}
        {yTicks.map((v) => (
          <g key={v}>
            <line
              x1={MARGIN.left}
              y1={yToSvg(v)}
              x2={MARGIN.left + PLOT_W}
              y2={yToSvg(v)}
              stroke={v === 21 ? '#22C55E' : '#E5E7EB'}
              strokeWidth={v === 21 ? 1.2 : 0.5}
              strokeDasharray={v === 21 ? '4,3' : undefined}
            />
            <text
              x={MARGIN.left - 6}
              y={yToSvg(v) + 3}
              textAnchor="end"
              fontSize={8}
              fill={v === 21 ? '#22C55E' : '#9CA3AF'}
              fontWeight={v === 21 ? 600 : 400}
            >
              {v}
            </text>
          </g>
        ))}

        {/* Y-axis title */}
        <text
          x={10}
          y={MARGIN.top + PLOT_H / 2}
          textAnchor="middle"
          fontSize={8}
          fill="#9CA3AF"
          transform={`rotate(-90, 10, ${MARGIN.top + PLOT_H / 2})`}
        >
          mmHg
        </text>

        {/* X-axis date labels */}
        {data.map((d, i) => (
          <text
            key={i}
            x={xToSvg(i, n)}
            y={CHART_H - MARGIN.bottom + 16}
            textAnchor="middle"
            fontSize={7}
            fill="#9CA3AF"
          >
            {d.date}
          </text>
        ))}

        {/* OS line (dashed blue, drawn first so OD is on top) */}
        {osSegments.map((pts, si) => (
          <polyline
            key={`os-seg-${si}`}
            points={pts}
            fill="none"
            stroke="#3B82F6"
            strokeWidth={2}
            strokeDasharray="6,3"
          />
        ))}
        {measured('os').map(({ i, v }) => (
          <circle
            key={`os-${i}`}
            cx={xToSvg(i, n)}
            cy={yToSvg(v)}
            r={hovered?.idx === i && hovered?.eye === 'os' ? 5 : 3.5}
            fill="#3B82F6"
            stroke="white"
            strokeWidth={1.5}
            onMouseEnter={() => setHovered({ idx: i, eye: 'os' })}
            onMouseLeave={() => setHovered(null)}
            style={{ cursor: 'pointer' }}
          />
        ))}

        {/* OD line (solid red) */}
        {odSegments.map((pts, si) => (
          <polyline
            key={`od-seg-${si}`}
            points={pts}
            fill="none"
            stroke="#EF4444"
            strokeWidth={2}
          />
        ))}
        {measured('od').map(({ i, v }) => (
          <circle
            key={`od-${i}`}
            cx={xToSvg(i, n)}
            cy={yToSvg(v)}
            r={hovered?.idx === i && hovered?.eye === 'od' ? 5 : 3.5}
            fill="#EF4444"
            stroke="white"
            strokeWidth={1.5}
            onMouseEnter={() => setHovered({ idx: i, eye: 'od' })}
            onMouseLeave={() => setHovered(null)}
            style={{ cursor: 'pointer' }}
          />
        ))}

        {/* Hover tooltip */}
        {hovered && (() => {
          const d = data[hovered.idx];
          const val = hovered.eye === 'od' ? d.od : d.os;
          if (val == null) return null;
          const cx = xToSvg(hovered.idx, n);
          const cy = yToSvg(val);
          const label = `${hovered.eye === 'od' ? 'OD' : 'OS'}: ${val} mmHg`;
          return (
            <g pointerEvents="none">
              <rect
                x={cx - 36}
                y={cy - 22}
                width={72}
                height={18}
                rx={4}
                fill="#1F2937"
                opacity={0.9}
              />
              <text x={cx} y={cy - 10} textAnchor="middle" fontSize={9} fill="white">
                {label}
              </text>
            </g>
          );
        })()}
      </svg>

      {/* Legend */}
      <div className="flex justify-center gap-4 mt-2">
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-4 h-0.5 rounded" style={{ backgroundColor: '#EF4444' }} />
          <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: '#EF4444' }} />
          <span className="text-[10px] text-gray-600 whitespace-nowrap"><T k="OD (우안)" /></span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-4 h-0.5 rounded border-t-2 border-dashed" style={{ borderColor: '#3B82F6' }} />
          <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: '#3B82F6' }} />
          <span className="text-[10px] text-gray-600 whitespace-nowrap"><T k="OS (좌안)" /></span>
        </div>
      </div>
      {/* 🔴 자르면 잘랐다고 말한다 — 미측정 지점에서 선이 끊긴 이유를 밝힌다 */}
      {missingCount > 0 && (
        <p className="text-[10px] text-gray-400 text-center mt-1">
          {data.length}<T k="회 중" /> {missingCount}<T k="회는 한쪽 이상이 미측정이라 그 지점에서 선이 끊깁니다" />
        </p>
      )}
    </div>
  );
}
