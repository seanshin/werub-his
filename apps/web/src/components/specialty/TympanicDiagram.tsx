'use client';

import { useState } from 'react';

import { T, useTAttr } from '@/components/ui/i18n-text';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface TympanicData {
  /** 소견 코드. 모르면 'unknown' — 🔴 미상을 'normal' 로 넘기지 말 것(정상이라 말하게 된다) */
  status: string;
  /** 광추: true=정상 · false=소실 · null=미검사 */
  lightReflex: boolean | null;
  findings?: string;
}

interface TympanicDiagramProps {
  right: TympanicData;
  left: TympanicData;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const STATUS_FILLS: Record<string, string> = {
  unknown: '#E5E7EB',     // gray — 미상(자료 없음/매핑 불가)
  normal: '#F5F0E8',      // pearl
  retracted: '#FDE68A',   // yellow
  bulging: '#FCA5A5',     // red
  perforation: '#374151', // dark hole
  effusion: '#FCD34D',    // amber
};

const STATUS_LABELS: Record<string, string> = {
  unknown: '미상',
  normal: '정상',
  retracted: '함몰',
  bulging: '팽윤',
  perforation: '천공',
  effusion: '삼출',
};

const QUADRANT_LABELS: Record<string, string> = {
  AS: '전상',
  AI: '전하',
  PS: '후상',
  PI: '후하',
};

/* ------------------------------------------------------------------ */
/*  Single Tympanic Membrane                                           */
/* ------------------------------------------------------------------ */

function SingleTympanic({
  side,
  data,
}: {
  side: 'right' | 'left';
  data: TympanicData;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const tAttr = useTAttr();
  const cx = 100;
  const cy = 100;
  const r = 72;

  // 🔴 모르는 소견을 '정상'(진주색)으로 칠하면 화면이 없는 사실을 말한다 — 미상은 미상으로.
  const fill = STATUS_FILLS[data.status] ?? STATUS_FILLS.unknown;
  const sideLabel = side === 'right' ? '우측' : '좌측';

  // Quadrant boundaries: malleus handle goes roughly from top-center to center
  // AS=anterosuperior, AI=anteroinferior, PS=posterosuperior, PI=posteroinferior
  // Anterior is toward the front of the patient
  // For right ear: anterior=left side of diagram; for left ear: anterior=right side
  const isRight = side === 'right';

  // Quadrant paths (clip to circle)
  const quadrants = [
    {
      id: 'AS',
      // top half, anterior side
      path: isRight
        ? `M ${cx},${cy} L ${cx},${cy - r} A ${r} ${r} 0 0 0 ${cx - r},${cy} Z`
        : `M ${cx},${cy} L ${cx},${cy - r} A ${r} ${r} 0 0 1 ${cx + r},${cy} Z`,
    },
    {
      id: 'AI',
      // bottom half, anterior side
      path: isRight
        ? `M ${cx},${cy} L ${cx - r},${cy} A ${r} ${r} 0 0 0 ${cx},${cy + r} Z`
        : `M ${cx},${cy} L ${cx + r},${cy} A ${r} ${r} 0 0 1 ${cx},${cy + r} Z`,
    },
    {
      id: 'PS',
      // top half, posterior side
      path: isRight
        ? `M ${cx},${cy} L ${cx + r},${cy} A ${r} ${r} 0 0 0 ${cx},${cy - r} Z`
        : `M ${cx},${cy} L ${cx - r},${cy} A ${r} ${r} 0 0 1 ${cx},${cy - r} Z`,
    },
    {
      id: 'PI',
      // bottom half, posterior side
      path: isRight
        ? `M ${cx},${cy} L ${cx},${cy + r} A ${r} ${r} 0 0 0 ${cx + r},${cy} Z`
        : `M ${cx},${cy} L ${cx},${cy + r} A ${r} ${r} 0 0 1 ${cx - r},${cy} Z`,
    },
  ];

  // Malleus handle: line from slightly above center going up
  const malleusEnd = { x: cx, y: cy - r * 0.6 };

  // Light reflex triangle in anteroinferior quadrant
  const reflexAngle = isRight ? Math.PI * 0.75 : Math.PI * 0.25; // 5 o'clock for right, 7 o'clock for left
  const reflexR = r * 0.45;
  const reflexSpread = 0.25;

  return (
    <div className="flex flex-col items-center">
      <p className="text-xs font-bold text-gray-600 mb-1"><T k={sideLabel} /> <T k="고막" /></p>
      <svg viewBox="0 0 200 200" className="w-full max-w-[200px] h-auto" aria-label={`${tAttr(sideLabel)} ${tAttr('고막 다이어그램')}`}>
        {/* Outer ear canal ring */}
        <circle cx={cx} cy={cy} r={r + 6} fill="none" stroke="#D1D5DB" strokeWidth={2} />

        {/* Quadrant fills */}
        {quadrants.map((q) => {
          const isHov = hovered === q.id;
          return (
            <path
              key={q.id}
              d={q.path}
              fill={fill}
              stroke={isHov ? '#1D4ED8' : '#C4B89A'}
              strokeWidth={isHov ? 2 : 0.8}
              opacity={isHov ? 1 : 0.85}
              onMouseEnter={() => setHovered(q.id)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: 'pointer' }}
            />
          );
        })}

        {/* Malleus handle */}
        <line
          x1={cx}
          y1={cy + 4}
          x2={malleusEnd.x}
          y2={malleusEnd.y}
          stroke="#8B7355"
          strokeWidth={2.5}
          strokeLinecap="round"
        />
        {/* Malleus umbo (small circle at center) */}
        <circle cx={cx} cy={cy + 4} r={3} fill="#8B7355" />

        {/* Light reflex triangle (anteroinferior) */}
        {data.lightReflex && (
          <polygon
            points={[
              `${cx},${cy + 4}`,
              `${cx + Math.cos(reflexAngle - reflexSpread) * reflexR},${cy + Math.sin(reflexAngle - reflexSpread) * reflexR}`,
              `${cx + Math.cos(reflexAngle + reflexSpread) * reflexR},${cy + Math.sin(reflexAngle + reflexSpread) * reflexR}`,
            ].join(' ')}
            fill="white"
            opacity={0.7}
          />
        )}

        {/* Quadrant labels */}
        {quadrants.map((q) => {
          // Position labels in each quadrant
          const angle =
            q.id === 'AS' ? (isRight ? Math.PI * 1.25 : Math.PI * 1.75)
            : q.id === 'AI' ? (isRight ? Math.PI * 0.75 : Math.PI * 0.25)
            : q.id === 'PS' ? (isRight ? Math.PI * 1.75 : Math.PI * 1.25)
            : (isRight ? Math.PI * 0.25 : Math.PI * 0.75);
          const lx = cx + Math.cos(angle) * r * 0.55;
          const ly = cy + Math.sin(angle) * r * 0.55;

          return (
            <text
              key={q.id}
              x={lx}
              y={ly + 3}
              textAnchor="middle"
              fontSize={8}
              fontWeight={500}
              fill="#6B7280"
              pointerEvents="none"
            >
              {QUADRANT_LABELS[q.id]}
            </text>
          );
        })}

        {/* Hover tooltip */}
        {hovered && (
          <g pointerEvents="none">
            <rect x={20} y={2} width={160} height={18} rx={4} fill="#1F2937" opacity={0.9} />
            <text x={100} y={15} textAnchor="middle" fontSize={9} fill="white">
              {tAttr(QUADRANT_LABELS[hovered])} - {tAttr(STATUS_LABELS[data.status] ?? data.status)}
            </text>
          </g>
        )}
      </svg>

      {/* Status info */}
      <div className="text-center mt-1 space-y-0.5">
        <p className="text-[10px] text-gray-600">
          <T k="상태" />: <span className="font-medium"><T k={STATUS_LABELS[data.status] ?? data.status} /></span>
        </p>
        <p className="text-[10px] text-gray-500">
          <T k="광추" />: <span className={data.lightReflex == null ? 'text-gray-400 font-medium' : data.lightReflex ? 'text-emerald-600 font-medium' : 'text-red-500 font-medium'}>
            <T k={data.lightReflex == null ? '미검사' : data.lightReflex ? '정상 (+)' : '소실 (-)'} />
          </span>
        </p>
        {data.findings && (
          <p className="text-[10px] text-gray-400 max-w-[180px] truncate">{data.findings}</p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function TympanicDiagram({ right, left }: TympanicDiagramProps) {
  return (
    <div className="w-full max-w-[480px] mx-auto">
      <p className="text-sm font-bold text-gray-700 mb-3 text-center"><T k="고막 소견 (Tympanic Membrane)" /></p>
      <div className="grid grid-cols-2 gap-4">
        <SingleTympanic side="right" data={right} />
        <SingleTympanic side="left" data={left} />
      </div>

      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-2 mt-3">
        {Object.entries(STATUS_LABELS).map(([key, label]) => (
          <div key={key} className="flex items-center gap-1">
            <span
              className="inline-block w-3 h-3 rounded-full border border-gray-300"
              style={{ backgroundColor: STATUS_FILLS[key] }}
            />
            <span className="text-[9px] text-gray-500 whitespace-nowrap"><T k={label} /></span>
          </div>
        ))}
      </div>
    </div>
  );
}
