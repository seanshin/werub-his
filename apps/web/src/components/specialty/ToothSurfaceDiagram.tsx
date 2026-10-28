'use client';

import { useState } from 'react';

import { T, useTAttr } from '@/components/ui/i18n-text';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface SurfaceData {
  surface: string;
  status: string;
  material?: string;
}

interface ToothSurfaceDiagramProps {
  tooth: string;
  surfaces: SurfaceData[];
  onSurfaceClick: (surface: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const MATERIAL_COLORS: Record<string, string> = {
  caries: '#EF4444',
  resin: '#3B82F6',
  amalgam: '#6B7280',
  gold: '#F59E0B',
  zirconia: '#F9FAFB',
  ceramic: '#EC4899',
};

const MATERIAL_LABELS: Record<string, string> = {
  caries: '우식',
  resin: '레진',
  amalgam: '아말감',
  gold: '금',
  zirconia: '지르코니아',
  ceramic: '도재',
};

const STATUS_FILL: Record<string, string> = {
  UNKNOWN: '#F3F4F6',   // 미상 — 자료 없음/미등록 상태
  NORMAL: '#E5E7EB',
  CARIES: '#EF4444',
  FILLED: '#3B82F6',
  DEFECTIVE: '#F97316',
  // 치식 상태(RCT·CROWN·IMPLANT·BRIDGE 등)는 면 단위 판정이 아니다 — 미상으로 둔다
};

function getFill(s: SurfaceData): string {
  if (s.material && MATERIAL_COLORS[s.material]) return MATERIAL_COLORS[s.material];
  // 🔴 미등록 상태를 '정상'으로 칠하면 화면이 없는 사실을 말한다(2026-08-13 W4)
  return STATUS_FILL[s.status] ?? STATUS_FILL.UNKNOWN;
}

/* ------------------------------------------------------------------ */
/*  Geometry — cross / pentagon layout                                 */
/* ------------------------------------------------------------------ */

// Center of viewBox = 100,100. Total viewBox = 200x200.
// Cross layout: center square (O), top (B), bottom (L), left (M), right (D)

interface Region {
  id: string;
  label: string;
  path: string;
}

const REGIONS: Region[] = [
  {
    id: 'O',
    label: '교합(O)',
    path: 'M 60,60 L 140,60 L 140,140 L 60,140 Z',
  },
  {
    id: 'B',
    label: '협측(B)',
    path: 'M 40,10 L 160,10 L 140,60 L 60,60 Z',
  },
  {
    id: 'L',
    label: '설측(L)',
    path: 'M 60,140 L 140,140 L 160,190 L 40,190 Z',
  },
  {
    id: 'M',
    label: '근심(M)',
    path: 'M 10,40 L 60,60 L 60,140 L 10,160 Z',
  },
  {
    id: 'D',
    label: '원심(D)',
    path: 'M 140,60 L 190,40 L 190,160 L 140,140 Z',
  },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ToothSurfaceDiagram({
  tooth,
  surfaces,
  onSurfaceClick,
}: ToothSurfaceDiagramProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const tAttr = useTAttr();

  const surfaceMap = new Map<string, SurfaceData>();
  surfaces.forEach((s) => surfaceMap.set(s.surface, s));

  return (
    <div className="w-full max-w-[280px] mx-auto">
      <p className="text-center text-sm font-bold text-gray-700 mb-2">
        <T k="치아" /> #{tooth} <T k="5면 뷰" />
      </p>
      <svg
        viewBox="0 0 200 200"
        className="w-full h-auto"
        aria-label={`${tAttr('치아')} ${tooth} ${tAttr('5면 다이어그램')}`}
      >
        {REGIONS.map((r) => {
          const sd = surfaceMap.get(r.id);
          const fill = sd ? getFill(sd) : '#E5E7EB';
          const isHovered = hovered === r.id;

          return (
            <g
              key={r.id}
              onClick={() => onSurfaceClick(r.id)}
              onMouseEnter={() => setHovered(r.id)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: 'pointer' }}
              role="button"
              aria-label={r.label}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onSurfaceClick(r.id);
              }}
            >
              <path
                d={r.path}
                fill={fill}
                stroke={isHovered ? '#1D4ED8' : '#6B7280'}
                strokeWidth={isHovered ? 2.5 : 1.5}
              />
              {/* Label in center of region */}
              <text
                x={
                  r.id === 'O' ? 100 :
                  r.id === 'B' ? 100 :
                  r.id === 'L' ? 100 :
                  r.id === 'M' ? 35 : 165
                }
                y={
                  r.id === 'O' ? 104 :
                  r.id === 'B' ? 40 :
                  r.id === 'L' ? 170 :
                  r.id === 'M' ? 104 : 104
                }
                textAnchor="middle"
                fontSize={12}
                fontWeight={600}
                fill={fill === '#E5E7EB' || fill === '#F9FAFB' ? '#374151' : '#FFFFFF'}
                pointerEvents="none"
              >
                {r.id}
              </text>
            </g>
          );
        })}

        {/* Tooltip */}
        {hovered && (() => {
          const sd = surfaceMap.get(hovered);
          const region = REGIONS.find((r) => r.id === hovered);
          if (!region) return null;
          const label = sd?.material
            ? `${tAttr(region.label)}: ${tAttr(MATERIAL_LABELS[sd.material] ?? sd.material)}`
            : `${tAttr(region.label)}: ${tAttr(sd?.status ?? '정상')}`;
          return (
            <g pointerEvents="none">
              <rect x={30} y={-2} width={140} height={20} rx={4} fill="#1F2937" opacity={0.9} />
              <text x={100} y={13} textAnchor="middle" fontSize={10} fill="white">
                {label}
              </text>
            </g>
          );
        })()}
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-2 mt-2">
        {Object.entries(MATERIAL_LABELS).map(([key, label]) => (
          <div key={key} className="flex items-center gap-1">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm border border-gray-300"
              style={{ backgroundColor: MATERIAL_COLORS[key] }}
            />
            <span className="text-[9px] text-gray-500 whitespace-nowrap"><T k={label} /></span>
          </div>
        ))}
      </div>
    </div>
  );
}
