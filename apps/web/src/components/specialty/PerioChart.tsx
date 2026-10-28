'use client';

import { useState } from 'react';

import { T, useTAttr } from '@/components/ui/i18n-text';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface PerioChartProps {
  teeth: string[];
  pocketDepths: Record<string, number[]>;
  bleeding: Record<string, boolean[]>;
  mobility?: Record<string, number>;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const POINT_LABELS = ['MB', 'B', 'DB', 'ML', 'L', 'DL'];
const MAX_DEPTH = 10;
const BAR_W = 6;
const BAR_GAP = 2;
const TOOTH_GROUP_W = POINT_LABELS.length * (BAR_W + BAR_GAP) + 8;
const CHART_H = 120;
const MARGIN_TOP = 30;
const MARGIN_BOTTOM = 50;
const MARGIN_LEFT = 32;

function depthColor(d: number): string {
  if (d <= 3) return '#22C55E';
  if (d <= 5) return '#EAB308';
  return '#EF4444';
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function PerioChart({
  teeth,
  pocketDepths,
  bleeding,
  mobility,
}: PerioChartProps) {
  const [hovered, setHovered] = useState<{ tooth: string; idx: number } | null>(null);
  const tAttr = useTAttr();

  const totalW = MARGIN_LEFT + teeth.length * TOOTH_GROUP_W + 10;
  const totalH = MARGIN_TOP + CHART_H + MARGIN_BOTTOM;

  return (
    <div className="w-full overflow-x-auto">
      <p className="text-sm font-bold text-gray-700 mb-2 px-1"><T k="치주 차트 (6-Point Pocket Depth)" /></p>
      <svg
        viewBox={`0 0 ${totalW} ${totalH}`}
        className="min-w-[600px] h-auto"
        aria-label={tAttr('치주 6점 포켓 깊이 차트')}
      >
        {/* Y-axis reference lines */}
        {[0, 3, 6, MAX_DEPTH].map((d) => {
          const y = MARGIN_TOP + (d / MAX_DEPTH) * CHART_H;
          return (
            <g key={d}>
              <line
                x1={MARGIN_LEFT - 4}
                y1={y}
                x2={totalW - 4}
                y2={y}
                stroke={d === 3 ? '#22C55E' : d === 6 ? '#EF4444' : '#E5E7EB'}
                strokeWidth={d === 3 || d === 6 ? 1 : 0.5}
                strokeDasharray={d === 3 || d === 6 ? '4,3' : undefined}
              />
              <text x={MARGIN_LEFT - 8} y={y + 3} textAnchor="end" fontSize={8} fill="#9CA3AF">
                {d}mm
              </text>
            </g>
          );
        })}

        {/* Gum line at 0 */}
        <line
          x1={MARGIN_LEFT}
          y1={MARGIN_TOP}
          x2={totalW - 4}
          y2={MARGIN_TOP}
          stroke="#F9A8D4"
          strokeWidth={2}
        />

        {/* Teeth groups */}
        {teeth.map((tooth, ti) => {
          const depths = pocketDepths[tooth] ?? [0, 0, 0, 0, 0, 0];
          const bleeds = bleeding[tooth] ?? [false, false, false, false, false, false];
          const mob = mobility?.[tooth];
          const groupX = MARGIN_LEFT + ti * TOOTH_GROUP_W;

          return (
            <g key={tooth}>
              {/* Tooth number */}
              <text
                x={groupX + TOOTH_GROUP_W / 2 - 4}
                y={MARGIN_TOP + CHART_H + 16}
                textAnchor="middle"
                fontSize={8}
                fontWeight={600}
                fill="#374151"
              >
                #{tooth}
              </text>

              {/* Mobility indicator */}
              {mob != null && mob > 0 && (
                <text
                  x={groupX + TOOTH_GROUP_W / 2 - 4}
                  y={MARGIN_TOP + CHART_H + 28}
                  textAnchor="middle"
                  fontSize={7}
                  fill="#EF4444"
                  fontWeight={700}
                >
                  M{mob}
                </text>
              )}

              {/* 6-point bars + bleeding dots */}
              {depths.map((d, pi) => {
                const barH = (Math.min(d, MAX_DEPTH) / MAX_DEPTH) * CHART_H;
                const bx = groupX + pi * (BAR_W + BAR_GAP);
                const by = MARGIN_TOP;
                const isHov =
                  hovered?.tooth === tooth && hovered?.idx === pi;

                return (
                  <g
                    key={pi}
                    onMouseEnter={() => setHovered({ tooth, idx: pi })}
                    onMouseLeave={() => setHovered(null)}
                    style={{ cursor: 'pointer' }}
                  >
                    <rect
                      x={bx}
                      y={by}
                      width={BAR_W}
                      height={barH}
                      fill={depthColor(d)}
                      opacity={isHov ? 1 : 0.8}
                      rx={1}
                    />
                    {/* Bleeding dot */}
                    {bleeds[pi] && (
                      <circle
                        cx={bx + BAR_W / 2}
                        cy={by + barH + 6}
                        r={2.5}
                        fill="#DC2626"
                      />
                    )}
                    {/* Point label */}
                    <text
                      x={bx + BAR_W / 2}
                      y={MARGIN_TOP + CHART_H + 40}
                      textAnchor="middle"
                      fontSize={5}
                      fill="#9CA3AF"
                    >
                      {POINT_LABELS[pi]}
                    </text>
                    {/* Hover tooltip */}
                    {isHov && (
                      <g pointerEvents="none">
                        <rect
                          x={bx - 16}
                          y={by + barH - 20}
                          width={40}
                          height={16}
                          rx={3}
                          fill="#1F2937"
                          opacity={0.9}
                        />
                        <text
                          x={bx + BAR_W / 2}
                          y={by + barH - 8}
                          textAnchor="middle"
                          fontSize={8}
                          fill="white"
                        >
                          {d}mm{bleeds[pi] ? ' BOP' : ''}
                        </text>
                      </g>
                    )}
                  </g>
                );
              })}

              {/* Separator line */}
              {ti < teeth.length - 1 && (
                <line
                  x1={groupX + TOOTH_GROUP_W - 4}
                  y1={MARGIN_TOP - 4}
                  x2={groupX + TOOTH_GROUP_W - 4}
                  y2={MARGIN_TOP + CHART_H + 2}
                  stroke="#E5E7EB"
                  strokeWidth={0.5}
                />
              )}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-2 px-1">
        <div className="flex items-center gap-1">
          <span className="inline-block w-3 h-2 rounded-sm" style={{ backgroundColor: '#22C55E' }} />
          <span className="text-[9px] text-gray-500 whitespace-nowrap"><T k="1-3mm (정상)" /></span>
        </div>
        <div className="flex items-center gap-1">
          <span className="inline-block w-3 h-2 rounded-sm" style={{ backgroundColor: '#EAB308' }} />
          <span className="text-[9px] text-gray-500 whitespace-nowrap"><T k="4-5mm (주의)" /></span>
        </div>
        <div className="flex items-center gap-1">
          <span className="inline-block w-3 h-2 rounded-sm" style={{ backgroundColor: '#EF4444' }} />
          <span className="text-[9px] text-gray-500 whitespace-nowrap"><T k="6mm+ (위험)" /></span>
        </div>
        <div className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: '#DC2626' }} />
          <span className="text-[9px] text-gray-500 whitespace-nowrap"><T k="출혈(BOP)" /></span>
        </div>
      </div>
    </div>
  );
}
