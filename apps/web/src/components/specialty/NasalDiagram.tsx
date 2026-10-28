'use client';

import { useState } from 'react';

import { T, useTAttr } from '@/components/ui/i18n-text';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface TurbinateStatus {
  status: string; // normal | hypertrophy | pale | congested
}

export interface PolypData {
  side: 'left' | 'right';
  grade: number; // 1-3
}

interface NasalDiagramProps {
  septum: { status: string; deviation?: 'left' | 'right' };
  leftTurbinates: TurbinateStatus[];
  rightTurbinates: TurbinateStatus[];
  polyps?: PolypData[];
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const TURBINATE_COLORS: Record<string, string> = {
  unknown: '#E5E7EB',     // gray — 미상
  normal: '#F9A8D4',      // pink
  hypertrophy: '#EF4444', // red
  pale: '#FDE68A',        // pale yellow
  congested: '#DC2626',   // dark red
};

const TURBINATE_LABELS: Record<string, string> = {
  unknown: '미상',
  normal: '정상',
  hypertrophy: '비후',
  pale: '창백',
  congested: '충혈',
};

const LEVEL_NAMES = ['상비갑개', '중비갑개', '하비갑개'];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function NasalDiagram({
  septum,
  leftTurbinates,
  rightTurbinates,
  polyps,
}: NasalDiagramProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const tAttr = useTAttr();

  const cx = 200;
  const devOffset = septum.deviation === 'left' ? -12 : septum.deviation === 'right' ? 12 : 0;

  // Turbinate positions: 3 levels on each side
  // Each turbinate is an elongated oval shape
  const turbinatePositions = [
    { y: 60, h: 24 },   // superior
    { y: 100, h: 30 },  // middle
    { y: 150, h: 36 },  // inferior (largest)
  ];

  const renderTurbinate = (
    side: 'left' | 'right',
    level: number,
    status: TurbinateStatus,
  ) => {
    const pos = turbinatePositions[level];
    // 🔴 미상을 '정상'(분홍)으로 칠하지 않는다
    const fill = TURBINATE_COLORS[status.status] ?? TURBINATE_COLORS.unknown;
    const isLeft = side === 'left';
    const baseX = isLeft ? cx - 30 + devOffset : cx + 30 + devOffset;
    const w = 50 + level * 10; // larger for inferior
    const x = isLeft ? baseX - w : baseX;
    const id = `${side}-${level}`;
    const isHov = hovered === id;

    // Check for hypertrophy - make it wider
    const extraW = status.status === 'hypertrophy' ? 8 : 0;

    return (
      <g key={id}>
        <rect
          x={isLeft ? x - extraW : x}
          y={pos.y}
          width={w + extraW}
          height={pos.h}
          rx={pos.h / 2}
          fill={fill}
          stroke={isHov ? '#1D4ED8' : '#D97706'}
          strokeWidth={isHov ? 2 : 0.8}
          opacity={isHov ? 1 : 0.7}
          onMouseEnter={() => setHovered(id)}
          onMouseLeave={() => setHovered(null)}
          style={{ cursor: 'pointer' }}
        />
        <text
          x={isLeft ? x + (w - extraW) / 2 - extraW / 2 : x + (w + extraW) / 2}
          y={pos.y + pos.h / 2 + 3}
          textAnchor="middle"
          fontSize={7}
          fill="#374151"
          pointerEvents="none"
        >
          {tAttr(LEVEL_NAMES[level])}
        </text>
      </g>
    );
  };

  return (
    <div className="w-full max-w-[420px] mx-auto">
      <p className="text-sm font-bold text-gray-700 mb-3 text-center"><T k="비강 단면 (Nasal Cavity)" /></p>
      <svg viewBox="0 0 400 240" className="w-full h-auto" aria-label={tAttr('비강 단면 다이어그램')}>
        {/* Outer nasal cavity border */}
        <path
          d="M 100,30 L 100,210 Q 100,230 120,230 L 280,230 Q 300,230 300,210 L 300,30 Q 300,20 290,20 L 200,15 L 110,20 Q 100,20 100,30 Z"
          fill="#FEF3C7"
          stroke="#D1D5DB"
          strokeWidth={1.5}
          opacity={0.3}
        />

        {/* Septum (center vertical structure) */}
        <rect
          x={cx + devOffset - 4}
          y={20}
          width={8}
          height={210}
          rx={3}
          fill={septum.deviation ? '#F59E0B' : '#F9A8D4'}
          stroke={hovered === 'septum' ? '#1D4ED8' : '#9CA3AF'}
          strokeWidth={hovered === 'septum' ? 2 : 1}
          onMouseEnter={() => setHovered('septum')}
          onMouseLeave={() => setHovered(null)}
          style={{ cursor: 'pointer' }}
        />
        {/* Deviation arrow */}
        {septum.deviation && (
          <text
            x={cx + devOffset}
            y={125}
            textAnchor="middle"
            fontSize={14}
            fill="#DC2626"
            pointerEvents="none"
          >
            {septum.deviation === 'left' ? '\u2190' : '\u2192'}
          </text>
        )}

        {/* Left turbinates */}
        {leftTurbinates.slice(0, 3).map((t, i) => renderTurbinate('left', i, t))}

        {/* Right turbinates */}
        {rightTurbinates.slice(0, 3).map((t, i) => renderTurbinate('right', i, t))}

        {/* Polyps */}
        {polyps?.map((p, i) => {
          const baseX = p.side === 'left' ? cx - 60 + devOffset : cx + 60 + devOffset;
          const py = 90 + i * 20;
          const pr = 4 + p.grade * 3;
          const id = `polyp-${i}`;
          const isHov = hovered === id;

          return (
            <circle
              key={id}
              cx={baseX}
              cy={py}
              r={pr}
              fill="#A855F7"
              opacity={isHov ? 0.9 : 0.6}
              stroke={isHov ? '#1D4ED8' : '#7C3AED'}
              strokeWidth={isHov ? 2 : 1}
              onMouseEnter={() => setHovered(id)}
              onMouseLeave={() => setHovered(null)}
              style={{ cursor: 'pointer' }}
            />
          );
        })}

        {/* Side labels */}
        <text x={120} y={15} textAnchor="middle" fontSize={10} fontWeight={600} fill="#6B7280">{tAttr('좌측')}</text>
        <text x={280} y={15} textAnchor="middle" fontSize={10} fontWeight={600} fill="#6B7280">{tAttr('우측')}</text>
        <text x={cx + devOffset} y={12} textAnchor="middle" fontSize={8} fill="#9CA3AF">{tAttr('비중격')}</text>

        {/* Hover tooltip */}
        {hovered && (() => {
          let label = '';
          if (hovered === 'septum') {
            label = septum.deviation
              ? `${tAttr('비중격 만곡')} (${tAttr(septum.deviation === 'left' ? '좌측' : '우측')})`
              : tAttr('비중격 정상');
          } else if (hovered.startsWith('polyp')) {
            const idx = parseInt(hovered.split('-')[1]);
            const p = polyps?.[idx];
            label = p ? `${tAttr('비용종')} ${tAttr(p.side === 'left' ? '좌' : '우')}${tAttr('측')} Grade ${p.grade}` : '';
          } else {
            const [side, levelStr] = hovered.split('-');
            const level = parseInt(levelStr);
            const t = side === 'left' ? leftTurbinates[level] : rightTurbinates[level];
            label = `${tAttr(side === 'left' ? '좌' : '우')}${tAttr('측')} ${tAttr(LEVEL_NAMES[level])}: ${tAttr(TURBINATE_LABELS[t?.status ?? 'normal'])}`;
          }
          return (
            <g pointerEvents="none">
              <rect x={100} y={232} width={200} height={18} rx={4} fill="#1F2937" opacity={0.9} />
              <text x={200} y={245} textAnchor="middle" fontSize={9} fill="white">{label}</text>
            </g>
          );
        })()}
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-2 mt-2">
        {Object.entries(TURBINATE_LABELS).map(([key, label]) => (
          <div key={key} className="flex items-center gap-1">
            <span className="inline-block w-3 h-2 rounded-sm" style={{ backgroundColor: TURBINATE_COLORS[key] }} />
            <span className="text-[9px] text-gray-500 whitespace-nowrap"><T k={label} /></span>
          </div>
        ))}
        <div className="flex items-center gap-1">
          <span className="inline-block w-3 h-3 rounded-full" style={{ backgroundColor: '#A855F7' }} />
          <span className="text-[9px] text-gray-500 whitespace-nowrap"><T k="비용종" /></span>
        </div>
      </div>
    </div>
  );
}
