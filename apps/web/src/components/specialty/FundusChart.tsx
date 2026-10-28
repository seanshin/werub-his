'use client';

import { useState } from 'react';

import { T, useTAttr } from '@/components/ui/i18n-text';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface FundusRegions {
  disc: string;
  macula: string;
  vessels: string;
  periphery: string;
}

interface FundusChartProps {
  od: FundusRegions;
  os: FundusRegions;
  onRegionClick: (eye: 'OD' | 'OS', region: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const STATUS_COLORS: Record<string, string> = {
  unknown: '#9CA3AF',   // gray — 미상(자료 없음/등급 판정 불가)
  normal: '#22C55E',
  abnormal: '#EAB308',
  pathological: '#EF4444',
};

const STATUS_LABELS: Record<string, string> = {
  unknown: '미상',
  normal: '정상',
  abnormal: '이상',
  pathological: '병적',
};

const REGION_LABELS: Record<string, string> = {
  disc: '시신경유두',
  macula: '황반부',
  vessels: '혈관',
  periphery: '주변부',
};

/* ------------------------------------------------------------------ */
/*  Single Fundus Eye                                                  */
/* ------------------------------------------------------------------ */

interface FundusRegionDef {
  id: string;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

function SingleFundus({
  eye,
  regions,
  onRegionClick,
}: {
  eye: 'OD' | 'OS';
  regions: FundusRegions;
  onRegionClick: (region: string) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const tAttr = useTAttr();
  const isOD = eye === 'OD';

  // Disc is nasal (OD=right, OS=left), macula is center, arcades surround
  const discCx = isOD ? 130 : 70;

  const regionDefs: FundusRegionDef[] = [
    { id: 'disc', cx: discCx, cy: 100, rx: 18, ry: 20 },
    { id: 'macula', cx: 100, cy: 100, rx: 14, ry: 14 },
  ];

  const regMap = regions as unknown as Record<string, string>;

  return (
    <div className="flex flex-col items-center">
      <p className="text-xs font-bold text-gray-600 mb-1">{eye} (<T k={isOD ? '우안' : '좌안'} />)</p>
      <svg viewBox="0 0 200 200" className="w-full max-w-[200px] h-auto" aria-label={`${eye} ${tAttr('안저 차트')}`}>
        {/* Background fundus circle */}
        <circle cx={100} cy={100} r={85} fill="#C4622D" opacity={0.15} stroke="#B45B27" strokeWidth={1.5} />

        {/* Periphery ring (clickable) */}
        <circle
          cx={100}
          cy={100}
          r={85}
          fill="none"
          stroke={STATUS_COLORS[regMap.periphery] ?? STATUS_COLORS.unknown}
          strokeWidth={6}
          opacity={hovered === 'periphery' ? 0.9 : 0.5}
          onClick={() => onRegionClick('periphery')}
          onMouseEnter={() => setHovered('periphery')}
          onMouseLeave={() => setHovered(null)}
          style={{ cursor: 'pointer' }}
        />

        {/* Vessel arcades */}
        <path
          d={isOD
            ? 'M 130,100 Q 100,40 60,60 Q 40,80 55,100 Q 40,120 60,140 Q 100,160 130,100'
            : 'M 70,100 Q 100,40 140,60 Q 160,80 145,100 Q 160,120 140,140 Q 100,160 70,100'
          }
          fill="none"
          stroke={STATUS_COLORS[regMap.vessels] ?? STATUS_COLORS.unknown}
          strokeWidth={hovered === 'vessels' ? 3 : 2}
          opacity={0.7}
          onClick={() => onRegionClick('vessels')}
          onMouseEnter={() => setHovered('vessels')}
          onMouseLeave={() => setHovered(null)}
          style={{ cursor: 'pointer' }}
        />

        {/* Disc and macula */}
        {regionDefs.map((rd) => {
          const status = regMap[rd.id] ?? 'normal';
          // 🔴 모르는 등급을 초록(정상)으로 칠하지 않는다 — 녹내장 소견이 '정상'으로 보였다(2026-08-13 W4)
          const fill = STATUS_COLORS[status] ?? STATUS_COLORS.unknown;
          const isHov = hovered === rd.id;

          return (
            <g key={rd.id}>
              <ellipse
                cx={rd.cx}
                cy={rd.cy}
                rx={rd.rx}
                ry={rd.ry}
                fill={fill}
                opacity={isHov ? 0.9 : 0.6}
                stroke={isHov ? '#1D4ED8' : '#6B7280'}
                strokeWidth={isHov ? 2 : 1}
                onClick={() => onRegionClick(rd.id)}
                onMouseEnter={() => setHovered(rd.id)}
                onMouseLeave={() => setHovered(null)}
                style={{ cursor: 'pointer' }}
              />
              <text
                x={rd.cx}
                y={rd.cy + 3}
                textAnchor="middle"
                fontSize={8}
                fontWeight={600}
                fill="white"
                pointerEvents="none"
              >
                {rd.id === 'disc' ? 'Disc' : 'Mac'}
              </text>
            </g>
          );
        })}

        {/* Quadrant labels around rim */}
        <text x={100} y={22} textAnchor="middle" fontSize={8} fill="#9CA3AF">ST</text>
        <text x={100} y={190} textAnchor="middle" fontSize={8} fill="#9CA3AF">IT</text>
        <text x={isOD ? 18 : 182} y={104} textAnchor="middle" fontSize={8} fill="#9CA3AF">T</text>
        <text x={isOD ? 182 : 18} y={104} textAnchor="middle" fontSize={8} fill="#9CA3AF">N</text>

        {/* Tooltip */}
        {hovered && (() => {
          const status = regMap[hovered] ?? 'normal';
          const label = `${tAttr(REGION_LABELS[hovered] ?? hovered)}: ${tAttr(STATUS_LABELS[status] ?? status)}`;
          return (
            <g pointerEvents="none">
              <rect x={20} y={2} width={160} height={18} rx={4} fill="#1F2937" opacity={0.9} />
              <text x={100} y={15} textAnchor="middle" fontSize={9} fill="white">{label}</text>
            </g>
          );
        })()}
      </svg>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function FundusChart({ od, os, onRegionClick }: FundusChartProps) {
  return (
    <div className="w-full max-w-[480px] mx-auto">
      <p className="text-sm font-bold text-gray-700 mb-3 text-center"><T k="안저 소견 (Fundus)" /></p>
      <div className="grid grid-cols-2 gap-4">
        <SingleFundus eye="OD" regions={od} onRegionClick={(r) => onRegionClick('OD', r)} />
        <SingleFundus eye="OS" regions={os} onRegionClick={(r) => onRegionClick('OS', r)} />
      </div>

      {/* Legend */}
      <div className="flex justify-center gap-3 mt-3">
        {Object.entries(STATUS_LABELS).map(([key, label]) => (
          <div key={key} className="flex items-center gap-1">
            <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: STATUS_COLORS[key] }} />
            <span className="text-[10px] text-gray-500 whitespace-nowrap"><T k={label} /></span>
          </div>
        ))}
      </div>
    </div>
  );
}
