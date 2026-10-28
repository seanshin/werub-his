'use client';

import { useState } from 'react';

import { T, useTAttr } from '@/components/ui/i18n-text';
import { Unit } from '@/components/ui/display';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface VisualFieldData {
  /** 8×8 감도 격자. 자료가 없으면 null — 🔴 가짜 격자를 만들어 넣지 말 것 */
  points: number[][] | null;
  md: number | null;
  psd: number | null;
  vfi: number | null;
}

interface VisualFieldMapProps {
  od: VisualFieldData;
  os: VisualFieldData;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const GRID = 8;
const CELL = 18;
const GAP = 2;
const FIELD_SIZE = GRID * (CELL + GAP);

// Sensitivity levels: 0=blind, 1=scotoma(red), 2=reduced(yellow), 3=normal(green)
function sensitivityColor(v: number): string {
  if (v <= 0) return '#1F2937';   // blind spot / black
  if (v === 1) return '#EF4444';  // scotoma / red
  if (v === 2) return '#EAB308';  // reduced / yellow
  return '#22C55E';               // normal / green
}

function sensitivityLabel(v: number): string {
  if (v <= 0) return '맹점';
  if (v === 1) return '암점';
  if (v === 2) return '감도저하';
  return '정상';
}

/* ------------------------------------------------------------------ */
/*  Single Field Grid                                                  */
/* ------------------------------------------------------------------ */

function FieldGrid({
  eye,
  field,
}: {
  eye: 'OD' | 'OS';
  field: VisualFieldData;
}) {
  const [hovered, setHovered] = useState<{ r: number; c: number } | null>(null);
  const tAttr = useTAttr();

  return (
    <div className="flex flex-col items-center">
      <p className="text-xs font-bold text-gray-600 mb-1">{eye} (<T k={eye === 'OD' ? '우안' : '좌안'} />)</p>
      <svg
        viewBox={`0 0 ${FIELD_SIZE + 4} ${FIELD_SIZE + 4}`}
        className="w-full max-w-[180px] h-auto"
        aria-label={`${eye} ${tAttr('시야 검사 맵')}`}
      >
        {/* 🔴 격자 자료가 없으면 가짜 감도 격자를 그리지 않는다 — 없음을 없다고 말한다 */}
        {!field.points && (
          <>
            <rect x={2} y={2} width={FIELD_SIZE} height={FIELD_SIZE} rx={4} fill="#F9FAFB" stroke="#E5E7EB" />
            <text x={(FIELD_SIZE + 4) / 2} y={(FIELD_SIZE + 4) / 2} textAnchor="middle" fontSize={9} fill="#9CA3AF">{tAttr('감도 격자 자료 없음')}</text>
          </>
        )}
        {(field.points ?? []).map((row, ri) =>
          row.map((val, ci) => {
            const x = 2 + ci * (CELL + GAP);
            const y = 2 + ri * (CELL + GAP);
            const isHov = hovered?.r === ri && hovered?.c === ci;

            return (
              <g key={`${ri}-${ci}`}>
                <rect
                  x={x}
                  y={y}
                  width={CELL}
                  height={CELL}
                  rx={2}
                  fill={sensitivityColor(val)}
                  opacity={isHov ? 1 : 0.75}
                  stroke={isHov ? '#1D4ED8' : 'none'}
                  strokeWidth={isHov ? 1.5 : 0}
                  onMouseEnter={() => setHovered({ r: ri, c: ci })}
                  onMouseLeave={() => setHovered(null)}
                  style={{ cursor: 'pointer' }}
                />
              </g>
            );
          }),
        )}

        {/* Hover tooltip */}
        {hovered && (() => {
          const val = field.points?.[hovered.r]?.[hovered.c] ?? 0;
          const label = tAttr(sensitivityLabel(val));
          return (
            <g pointerEvents="none">
              <rect x={FIELD_SIZE / 2 - 30} y={-2} width={60} height={16} rx={3} fill="#1F2937" opacity={0.9} />
              <text x={FIELD_SIZE / 2} y={10} textAnchor="middle" fontSize={8} fill="white">{label}</text>
            </g>
          );
        })()}
      </svg>

      {/* Stats below */}
      <div className="flex gap-2 mt-1.5 text-[9px] text-gray-500">
        <span className="whitespace-nowrap">MD: <b className="text-gray-700">{field.md == null ? <T k="미측정" /> : `${field.md} dB`}</b></span>
        <span className="whitespace-nowrap">PSD: <b className="text-gray-700">{field.psd == null ? <T k="미측정" /> : `${field.psd} dB`}</b></span>
        <span className="whitespace-nowrap">VFI: <b className="text-gray-700">{field.vfi == null ? <T k="미측정" /> : <>{field.vfi}<Unit>%</Unit></>}</b></span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Component                                                     */
/* ------------------------------------------------------------------ */

export default function VisualFieldMap({ od, os }: VisualFieldMapProps) {
  return (
    <div className="w-full max-w-[440px] mx-auto">
      <p className="text-sm font-bold text-gray-700 mb-3 text-center"><T k="시야 검사 (Visual Field)" /></p>
      <div className="grid grid-cols-2 gap-4">
        <FieldGrid eye="OD" field={od} />
        <FieldGrid eye="OS" field={os} />
      </div>

      {/* Legend */}
      <div className="flex justify-center gap-3 mt-3">
        {[
          { color: '#22C55E', label: '정상' },
          { color: '#EAB308', label: '감도저하' },
          { color: '#EF4444', label: '암점' },
          { color: '#1F2937', label: '맹점' },
        ].map((l) => (
          <div key={l.label} className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: l.color }} />
            <span className="text-[9px] text-gray-500 whitespace-nowrap"><T k={l.label} /></span>
          </div>
        ))}
      </div>
    </div>
  );
}
