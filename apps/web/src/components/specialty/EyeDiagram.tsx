'use client';

import { useState } from 'react';

import { T, useTAttr } from '@/components/ui/i18n-text';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface EyeInfo {
  va: string;
  /** 안압(mmHg). 미측정은 null — 🔴 0 은 안구위축을 뜻하는 실제 값이라 '미측정'과 뒤섞으면 안 된다 */
  iop: number | null;
  refraction?: string;
}

interface EyeDiagramProps {
  od: EyeInfo;
  os: EyeInfo;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const EYE_CX = 100;
const EYE_CY = 100;
const SCLERA_R = 72;
const IRIS_R = 42;
const PUPIL_R = 16;

/* ------------------------------------------------------------------ */
/*  Single Eye SVG                                                     */
/* ------------------------------------------------------------------ */

function SingleEye({
  eye,
  info,
  isOD,
}: {
  eye: 'OD' | 'OS';
  info: EyeInfo;
  isOD: boolean;
}) {
  const [hoveredQ, setHoveredQ] = useState<string | null>(null);
  const tAttr = useTAttr();

  // OD: temporal=left, nasal=right  |  OS: temporal=right, nasal=left
  const tSide = isOD ? 'left' : 'right';
  const nSide = isOD ? 'right' : 'left';

  const quadrants: { id: string; label: string; labelFull: string; lx: number; ly: number }[] = [
    { id: 'S', label: 'S', labelFull: tAttr('상측(Superior)'), lx: EYE_CX, ly: EYE_CY - SCLERA_R + 16 },
    { id: 'I', label: 'I', labelFull: tAttr('하측(Inferior)'), lx: EYE_CX, ly: EYE_CY + SCLERA_R - 10 },
    {
      id: 'T',
      label: 'T',
      labelFull: `${tAttr('이측(Temporal)')} - ${tSide}`,
      lx: isOD ? EYE_CX - SCLERA_R + 14 : EYE_CX + SCLERA_R - 14,
      ly: EYE_CY + 4,
    },
    {
      id: 'N',
      label: 'N',
      labelFull: `${tAttr('비측(Nasal)')} - ${nSide}`,
      lx: isOD ? EYE_CX + SCLERA_R - 14 : EYE_CX - SCLERA_R + 14,
      ly: EYE_CY + 4,
    },
  ];

  return (
    <div className="flex flex-col items-center">
      <p className="text-xs font-bold text-gray-600 mb-1">{eye} (<T k={isOD ? '우안' : '좌안'} />)</p>
      <svg viewBox="0 0 200 200" className="w-full max-w-[200px] h-auto" aria-label={`${eye} ${tAttr('안구 다이어그램')}`}>
        {/* Sclera */}
        <circle cx={EYE_CX} cy={EYE_CY} r={SCLERA_R} fill="#F9FAFB" stroke="#D1D5DB" strokeWidth={2} />

        {/* Quadrant lines (cross) */}
        <line x1={EYE_CX - SCLERA_R} y1={EYE_CY} x2={EYE_CX + SCLERA_R} y2={EYE_CY} stroke="#E5E7EB" strokeWidth={0.5} strokeDasharray="3,3" />
        <line x1={EYE_CX} y1={EYE_CY - SCLERA_R} x2={EYE_CX} y2={EYE_CY + SCLERA_R} stroke="#E5E7EB" strokeWidth={0.5} strokeDasharray="3,3" />

        {/* Iris */}
        <circle cx={EYE_CX} cy={EYE_CY} r={IRIS_R} fill="#8B7355" stroke="#6B5B45" strokeWidth={1.5} opacity={0.7} />
        {/* Iris texture rings */}
        <circle cx={EYE_CX} cy={EYE_CY} r={IRIS_R - 8} fill="none" stroke="#7A6548" strokeWidth={0.5} opacity={0.5} />
        <circle cx={EYE_CX} cy={EYE_CY} r={IRIS_R - 16} fill="none" stroke="#7A6548" strokeWidth={0.5} opacity={0.4} />

        {/* Pupil */}
        <circle cx={EYE_CX} cy={EYE_CY} r={PUPIL_R} fill="#1F2937" />
        {/* Light reflection */}
        <circle cx={EYE_CX - 5} cy={EYE_CY - 5} r={4} fill="white" opacity={0.6} />

        {/* Quadrant labels */}
        {quadrants.map((q) => (
          <g
            key={q.id}
            onMouseEnter={() => setHoveredQ(q.id)}
            onMouseLeave={() => setHoveredQ(null)}
            style={{ cursor: 'pointer' }}
          >
            <text
              x={q.lx}
              y={q.ly}
              textAnchor="middle"
              fontSize={11}
              fontWeight={700}
              fill={hoveredQ === q.id ? '#2563EB' : '#6B7280'}
            >
              {q.label}
            </text>
          </g>
        ))}

        {/* Tooltip */}
        {hoveredQ && (() => {
          const q = quadrants.find((x) => x.id === hoveredQ);
          if (!q) return null;
          return (
            <g pointerEvents="none">
              <rect x={20} y={2} width={160} height={18} rx={4} fill="#1F2937" opacity={0.9} />
              <text x={100} y={15} textAnchor="middle" fontSize={9} fill="white">{q.labelFull}</text>
            </g>
          );
        })()}
      </svg>

      {/* Info below */}
      <div className="text-center mt-1 space-y-0.5">
        <p className="text-[10px] text-gray-600">
          <span className="font-medium">VA:</span> {info.va}
        </p>
        <p className="text-[10px] text-gray-600">
          <span className="font-medium">IOP:</span>{' '}
          <span className={info.iop != null && info.iop > 21 ? 'text-red-600 font-bold' : info.iop == null ? 'text-gray-400' : ''}>{info.iop == null ? <T k="미측정" /> : `${info.iop} mmHg`}</span>
        </p>
        {info.refraction && (
          <p className="text-[10px] text-gray-500">
            <span className="font-medium">Ref:</span> {info.refraction}
          </p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function EyeDiagram({ od, os }: EyeDiagramProps) {
  return (
    <div className="w-full max-w-[480px] mx-auto">
      <p className="text-sm font-bold text-gray-700 mb-3 text-center"><T k="안구 다이어그램" /></p>
      <div className="grid grid-cols-2 gap-4">
        <SingleEye eye="OD" info={od} isOD={true} />
        <SingleEye eye="OS" info={os} isOD={false} />
      </div>
    </div>
  );
}
