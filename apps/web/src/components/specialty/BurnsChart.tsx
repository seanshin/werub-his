'use client';

import { useState } from 'react';
import { Unit } from '@/components/ui/display';
import { T, useTAttr } from '@/components/ui/i18n-text';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface BurnRegion {
  region: string;
  percentage: number;
  depth: 'SUPERFICIAL' | 'PARTIAL' | 'FULL' | 'DEEP';
}

interface BurnsChartProps {
  regions: BurnRegion[];
  isChild?: boolean;
  onRegionClick?: (region: string) => void;
  mode?: 'view' | 'edit';
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const DEPTH_COLOR: Record<string, string> = {
  SUPERFICIAL: '#F9A8D4', // pink
  PARTIAL: '#EF4444',     // red
  FULL: '#991B1B',        // darkred
  DEEP: '#1F2937',        // near-black
};

const DEPTH_LABEL: Record<string, string> = {
  SUPERFICIAL: '표재성',
  PARTIAL: '부분층',
  FULL: '전층',
  DEEP: '심부',
};

const SVG_W = 300;
const SVG_H = 500;

/* Rule of 9s reference percentages */
export interface RegionDef {
  id: string;
  label: string;
  pathFront?: string;
  pathBack?: string;
  cx: number;
  cy: number;
  adultPct: number;
  childPct: number;
}

/** 부위 정본 — BurnsTab 편집기가 라벨·기준 면적을 여기서 읽는다(정본 하나) */
export const BURN_REGIONS: RegionDef[] = [
  {
    id: 'HEAD', label: '두부',
    pathFront: 'M150,4 C170,4 182,16 182,40 C182,52 170,60 150,60 C130,60 118,52 118,40 C118,16 130,4 150,4 Z',
    pathBack: 'M150,4 C170,4 182,16 182,40 C182,52 170,60 150,60 C130,60 118,52 118,40 C118,16 130,4 150,4 Z',
    cx: 150, cy: 32, adultPct: 9, childPct: 18,
  },
  {
    id: 'CHEST', label: '흉부(전면)',
    pathFront: 'M112,78 C120,74 180,74 188,78 L186,144 C176,148 124,148 114,144 Z',
    cx: 150, cy: 112, adultPct: 9, childPct: 9,
  },
  {
    id: 'ABDOMEN', label: '복부',
    pathFront: 'M114,146 C126,150 174,150 186,146 L184,210 Q180,218 174,220 L126,220 Q120,218 116,210 Z',
    cx: 150, cy: 182, adultPct: 9, childPct: 9,
  },
  {
    id: 'BACK_UPPER', label: '등(상부)',
    pathBack: 'M112,78 C120,74 180,74 188,78 L186,144 C176,148 124,148 114,144 Z',
    cx: 150, cy: 112, adultPct: 9, childPct: 9,
  },
  {
    id: 'BACK_LOWER', label: '등(하부)',
    pathBack: 'M114,146 C126,150 174,150 186,146 L184,210 Q180,218 174,220 L126,220 Q120,218 116,210 Z',
    cx: 150, cy: 182, adultPct: 9, childPct: 9,
  },
  {
    id: 'LEFT_UPPER_ARM', label: '좌상완',
    pathFront: 'M108,80 C100,78 92,82 88,90 L82,148 L108,148 L112,90 Z',
    pathBack: 'M108,80 C100,78 92,82 88,90 L82,148 L108,148 L112,90 Z',
    cx: 96, cy: 115, adultPct: 4.5, childPct: 4.5,
  },
  {
    id: 'RIGHT_UPPER_ARM', label: '우상완',
    pathFront: 'M192,80 C200,78 208,82 212,90 L218,148 L192,148 L188,90 Z',
    pathBack: 'M192,80 C200,78 208,82 212,90 L218,148 L192,148 L188,90 Z',
    cx: 204, cy: 115, adultPct: 4.5, childPct: 4.5,
  },
  {
    id: 'LEFT_FOREARM', label: '좌전완',
    pathFront: 'M80,150 L108,150 L102,232 L72,232 Z',
    pathBack: 'M80,150 L108,150 L102,232 L72,232 Z',
    cx: 90, cy: 191, adultPct: 4.5, childPct: 4.5,
  },
  {
    id: 'RIGHT_FOREARM', label: '우전완',
    pathFront: 'M192,150 L220,150 L228,232 L198,232 Z',
    pathBack: 'M192,150 L220,150 L228,232 L198,232 Z',
    cx: 210, cy: 191, adultPct: 4.5, childPct: 4.5,
  },
  {
    id: 'LEFT_THIGH', label: '좌대퇴',
    pathFront: 'M124,222 L148,222 L142,318 L122,318 Z',
    pathBack: 'M124,222 L148,222 L142,318 L122,318 Z',
    cx: 134, cy: 270, adultPct: 9, childPct: 6.75,
  },
  {
    id: 'RIGHT_THIGH', label: '우대퇴',
    pathFront: 'M152,222 L176,222 L178,318 L158,318 Z',
    pathBack: 'M152,222 L176,222 L178,318 L158,318 Z',
    cx: 166, cy: 270, adultPct: 9, childPct: 6.75,
  },
  {
    id: 'LEFT_LOWER_LEG', label: '좌하퇴',
    pathFront: 'M122,320 L142,320 L138,414 L124,414 Z',
    pathBack: 'M122,320 L142,320 L138,414 L124,414 Z',
    cx: 132, cy: 367, adultPct: 9, childPct: 6.75,
  },
  {
    id: 'RIGHT_LOWER_LEG', label: '우하퇴',
    pathFront: 'M158,320 L178,320 L176,414 L162,414 Z',
    pathBack: 'M158,320 L178,320 L176,414 L162,414 Z',
    cx: 168, cy: 367, adultPct: 9, childPct: 6.75,
  },
  {
    id: 'PERINEUM', label: '회음부',
    pathFront: 'M138,216 L162,216 L158,228 L142,228 Z',
    cx: 150, cy: 222, adultPct: 1, childPct: 1,
  },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function BurnsChart({ regions, isChild = false, onRegionClick, mode = 'view' }: BurnsChartProps) {
  const [hoveredRegion, setHoveredRegion] = useState<string | null>(null);
  const tAttr = useTAttr();
  const [view, setView] = useState<'front' | 'back'>('front');

  // Map burn data by region
  const burnMap = new Map<string, BurnRegion>();
  regions.forEach((r) => burnMap.set(r.region, r));

  // Filter regions visible in current view
  const visibleRegions = BURN_REGIONS.filter((r) =>
    view === 'front' ? !!r.pathFront : !!r.pathBack,
  );

  // Calculate TBSA
  const totalTBSA = regions.reduce((sum, r) => sum + r.percentage, 0);
  const depthBreakdown = new Map<string, number>();
  regions.forEach((r) => {
    depthBreakdown.set(r.depth, (depthBreakdown.get(r.depth) ?? 0) + r.percentage);
  });

  return (
    <div className="w-full max-w-[380px] mx-auto">
      {/* View toggle */}
      <div className="flex justify-center gap-2 mb-3">
        <button
          onClick={() => setView('front')}
          className={`px-3 py-1 text-xs font-medium rounded-lg transition-all ${
            view === 'front' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          <T k="앞면" />
        </button>
        <button
          onClick={() => setView('back')}
          className={`px-3 py-1 text-xs font-medium rounded-lg transition-all ${
            view === 'back' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          <T k="뒷면" />
        </button>
      </div>

      <p className="text-center text-xs text-gray-500 mb-2 font-medium">
        {view === 'front' ? <T k="앞면 (Front)" /> : <T k="뒷면 (Back)" />}
        {isChild && <T k=" - 소아" />}
      </p>

      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        className="w-full h-auto"
        aria-label={`${tAttr('화상 차트')} - ${tAttr(view === 'front' ? '앞면' : '뒷면')}`}
      >
        {/* Body outline silhouette */}
        <path
          d="M150,2 C172,2 184,14 184,32 C184,46 174,56 164,62
             L162,76 C166,76 180,76 192,80 Q210,86 218,110
             L220,148 Q222,156 220,160 L228,222 Q232,234 230,256
             C228,264 220,268 216,266 L204,230
             Q200,226 198,224 L194,152
             Q192,148 190,146 L188,142
             C176,146 124,146 112,142
             L110,146 Q108,148 106,152
             L102,224 Q100,226 96,230
             L84,266 C80,268 72,264 70,256
             Q68,234 72,222 L80,160 Q78,156 80,148
             L82,110 Q90,86 108,80
             C120,76 134,76 138,76
             L136,62 C126,56 116,46 116,32
             C116,14 128,2 150,2 Z
             M126,218 Q124,222 122,228 L120,310
             Q118,316 120,320 L122,330
             Q122,360 124,400 Q124,410 122,412
             L114,420 Q114,436 124,446
             L130,446 Q140,444 142,436
             L142,420 Q142,414 138,412
             L140,320 Q142,316 142,310
             L148,228 Q150,222 148,218 Z
             M152,218 Q150,222 152,228 L158,310
             Q160,316 160,320 L160,400
             Q160,410 162,412
             L158,420 Q158,436 170,446
             L176,446 Q186,444 186,436
             L186,420 Q186,414 178,412
             L178,400 Q178,360 178,330
             L178,320 Q180,316 178,310
             L176,228 Q184,222 176,218 Z"
          fill="#F9FAFB"
          stroke="#D1D5DB"
          strokeWidth={1}
        />

        {/* Burn-affected regions */}
        {visibleRegions.map((region) => {
          const burn = burnMap.get(region.id);
          const isHovered = hoveredRegion === region.id;
          const path = view === 'front' ? region.pathFront : region.pathBack;
          if (!path) return null;

          const opacity = burn ? 0.3 + (burn.percentage / 100) * 0.7 : 0;
          const fillColor = burn ? DEPTH_COLOR[burn.depth] : 'transparent';
          const pct = isChild ? region.childPct : region.adultPct;

          return (
            <g
              key={region.id}
              onClick={() => onRegionClick?.(region.id)}
              onMouseEnter={() => setHoveredRegion(region.id)}
              onMouseLeave={() => setHoveredRegion(null)}
              style={{ cursor: mode === 'edit' || onRegionClick ? 'pointer' : 'default' }}
              role={onRegionClick ? 'button' : undefined}
              aria-label={`${tAttr(region.label)} (Rule of 9s: ${pct}%)`}
              tabIndex={onRegionClick ? 0 : undefined}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && onRegionClick) onRegionClick(region.id);
              }}
            >
              <path
                d={path}
                fill={burn ? fillColor : isHovered ? '#DBEAFE' : 'transparent'}
                stroke={isHovered ? '#3B82F6' : burn ? DEPTH_COLOR[burn.depth] : '#E5E7EB'}
                strokeWidth={isHovered ? 1.5 : 0.8}
                opacity={burn ? opacity : isHovered ? 0.4 : 0.3}
              />
              {/* Region label */}
              <text
                x={region.cx}
                y={region.cy - 6}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={7}
                fill={isHovered ? '#1D4ED8' : '#6B7280'}
                fontWeight={isHovered ? 600 : 400}
              >
                {tAttr(region.label)}
              </text>
              {/* Rule of 9s % */}
              <text
                x={region.cx}
                y={region.cy + 6}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={6}
                fill="#9CA3AF"
              >
                {pct}%
              </text>
              {/* Burn % if present */}
              {burn && (
                <text
                  x={region.cx}
                  y={region.cy + 16}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={8}
                  fill={DEPTH_COLOR[burn.depth]}
                  fontWeight={700}
                >
                  {burn.percentage}%
                </text>
              )}
              {/* Hover tooltip */}
              {isHovered && burn && (
                <g>
                  <rect
                    x={region.cx - 40}
                    y={region.cy - 36}
                    width={80}
                    height={22}
                    rx={4}
                    fill="white"
                    stroke="#D1D5DB"
                    strokeWidth={0.5}
                  />
                  <text
                    x={region.cx}
                    y={region.cy - 22}
                    textAnchor="middle"
                    fontSize={7}
                    fill="#374151"
                    fontWeight={600}
                  >
                    {tAttr(DEPTH_LABEL[burn.depth])} {burn.percentage}%
                  </text>
                </g>
              )}
            </g>
          );
        })}
      </svg>

      {/* Bottom summary */}
      <div className="mt-3 p-3 bg-gray-50 rounded-xl space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-gray-900">Total TBSA</span>
          <span className={`text-lg font-bold ${totalTBSA > 20 ? 'text-red-600' : totalTBSA > 10 ? 'text-amber-600' : 'text-gray-900'}`}>
            {totalTBSA.toFixed(1)}%
          </span>
        </div>
        {depthBreakdown.size > 0 && (
          <div className="space-y-1">
            {Array.from(depthBreakdown.entries()).map(([depth, pct]) => (
              <div key={depth} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block w-3 h-3 rounded border border-gray-200"
                    style={{ backgroundColor: DEPTH_COLOR[depth] }}
                  />
                  <span className="text-gray-600"><T k={DEPTH_LABEL[depth] ?? depth} /></span>
                </div>
                <span className="font-medium text-gray-700">{pct.toFixed(1)}<Unit>%</Unit></span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-3 mt-3 px-2">
        {Object.entries(DEPTH_LABEL).map(([key, label]) => (
          <div key={key} className="flex items-center gap-1.5">
            <span
              className="inline-block w-3 h-3 rounded border border-gray-200"
              style={{ backgroundColor: DEPTH_COLOR[key] }}
            />
            <span className="text-[10px] text-gray-600 whitespace-nowrap"><T k={label} /></span>
          </div>
        ))}
      </div>
    </div>
  );
}
