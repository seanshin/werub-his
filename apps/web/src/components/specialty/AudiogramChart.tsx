'use client';

import { useState } from 'react';

import { T, useTAttr } from '@/components/ui/i18n-text';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface AudiogramPoint {
  freq: number;
  db: number;
}

interface AudiogramChartProps {
  rightAC: AudiogramPoint[];
  leftAC: AudiogramPoint[];
  rightBC?: AudiogramPoint[];
  leftBC?: AudiogramPoint[];
  mode?: 'view' | 'edit';
  onDataChange?: (ear: 'right' | 'left', data: AudiogramPoint[]) => void;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const FREQUENCIES = [250, 500, 1000, 2000, 4000, 8000];
const FREQ_LABELS = ['250', '500', '1K', '2K', '4K', '8K'];
const DB_MIN = -10;
const DB_MAX = 120;
const DB_STEP = 10;

// Chart area
const CHART_LEFT = 60;
const CHART_TOP = 30;
const CHART_RIGHT = 540;
const CHART_BOTTOM = 400;
const CHART_W = CHART_RIGHT - CHART_LEFT;
const CHART_H = CHART_BOTTOM - CHART_TOP;

const SVG_W = 580;
const SVG_H = 460;

// Hearing level bands
const BANDS: { min: number; max: number; color: string; label: string }[] = [
  { min: -10, max: 25, color: '#DCFCE7', label: '정상' },
  { min: 26, max: 40, color: '#FEF9C3', label: '경도' },
  { min: 41, max: 55, color: '#FED7AA', label: '중등도' },
  { min: 56, max: 70, color: '#FECACA', label: '중등고도' },
  { min: 71, max: 90, color: '#B91C1C33', label: '고도' },
  { min: 91, max: 120, color: '#E5E7EB', label: '심도' },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function freqToX(freq: number): number {
  // Log scale: map 250..8000 to CHART_LEFT..CHART_RIGHT
  const logMin = Math.log2(250);
  const logMax = Math.log2(8000);
  const logFreq = Math.log2(freq);
  const ratio = (logFreq - logMin) / (logMax - logMin);
  return CHART_LEFT + ratio * CHART_W;
}

function dbToY(db: number): number {
  // -10 at top, 120 at bottom (inverted)
  const ratio = (db - DB_MIN) / (DB_MAX - DB_MIN);
  return CHART_TOP + ratio * CHART_H;
}

function computePTA(points: AudiogramPoint[]): number | null {
  // Pure Tone Average: average of 500, 1000, 2000 Hz
  const ptaFreqs = [500, 1000, 2000];
  const vals = ptaFreqs
    .map((f) => points.find((p) => p.freq === f)?.db)
    .filter((v): v is number => v !== undefined);
  if (vals.length === 0) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
}

function buildPolyline(points: AudiogramPoint[]): string {
  const sorted = [...points].sort((a, b) => a.freq - b.freq);
  return sorted.map((p) => `${freqToX(p.freq)},${dbToY(p.db)}`).join(' ');
}

function xToFreq(x: number): number {
  const logMin = Math.log2(250);
  const logMax = Math.log2(8000);
  const ratio = (x - CHART_LEFT) / CHART_W;
  const logFreq = logMin + ratio * (logMax - logMin);
  const rawFreq = Math.pow(2, logFreq);
  // Snap to nearest standard frequency
  let best = FREQUENCIES[0];
  let bestDist = Math.abs(rawFreq - best);
  for (const f of FREQUENCIES) {
    const d = Math.abs(rawFreq - f);
    if (d < bestDist) { best = f; bestDist = d; }
  }
  return best;
}

function yToDb(y: number): number {
  const ratio = (y - CHART_TOP) / CHART_H;
  const raw = DB_MIN + ratio * (DB_MAX - DB_MIN);
  // Snap to nearest 5dB
  return Math.round(raw / 5) * 5;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function AudiogramChart({
  rightAC,
  leftAC,
  rightBC,
  leftBC,
  mode = 'view',
  onDataChange,
}: AudiogramChartProps) {
  const [hovered, setHovered] = useState<{
    ear: string;
    freq: number;
    db: number;
    x: number;
    y: number;
  } | null>(null);
  const [editEar, setEditEar] = useState<'right' | 'left'>('right');
  const tAttr = useTAttr();

  const ptaRight = computePTA(rightAC);
  const ptaLeft = computePTA(leftAC);

  const renderMarker = (
    point: AudiogramPoint,
    ear: 'right' | 'left',
    type: 'AC' | 'BC',
  ) => {
    const x = freqToX(point.freq);
    const y = dbToY(point.db);
    const isRight = ear === 'right';
    const color = isRight ? '#EF4444' : '#3B82F6';
    const labelPrefix = `${tAttr(isRight ? '우' : '좌')}${tAttr('측')} ${tAttr(type === 'AC' ? '기도' : '골도')}`;

    return (
      <g
        key={`${ear}-${type}-${point.freq}`}
        onMouseEnter={() =>
          setHovered({
            ear: labelPrefix,
            freq: point.freq,
            db: point.db,
            x,
            y,
          })
        }
        onMouseLeave={() => setHovered(null)}
        style={{ cursor: 'default' }}
      >
        {type === 'AC' && isRight && (
          /* Red circle for right AC */
          <circle
            cx={x}
            cy={y}
            r={6}
            fill="none"
            stroke={color}
            strokeWidth={2}
          />
        )}
        {type === 'AC' && !isRight && (
          /* Blue X for left AC */
          <>
            <line
              x1={x - 5}
              y1={y - 5}
              x2={x + 5}
              y2={y + 5}
              stroke={color}
              strokeWidth={2}
              strokeLinecap="round"
            />
            <line
              x1={x + 5}
              y1={y - 5}
              x2={x - 5}
              y2={y + 5}
              stroke={color}
              strokeWidth={2}
              strokeLinecap="round"
            />
          </>
        )}
        {type === 'BC' && isRight && (
          /* Right BC: < bracket */
          <>
            <line
              x1={x + 4}
              y1={y - 6}
              x2={x - 4}
              y2={y}
              stroke={color}
              strokeWidth={2}
              strokeLinecap="round"
            />
            <line
              x1={x - 4}
              y1={y}
              x2={x + 4}
              y2={y + 6}
              stroke={color}
              strokeWidth={2}
              strokeLinecap="round"
            />
          </>
        )}
        {type === 'BC' && !isRight && (
          /* Left BC: > bracket */
          <>
            <line
              x1={x - 4}
              y1={y - 6}
              x2={x + 4}
              y2={y}
              stroke={color}
              strokeWidth={2}
              strokeLinecap="round"
            />
            <line
              x1={x + 4}
              y1={y}
              x2={x - 4}
              y2={y + 6}
              stroke={color}
              strokeWidth={2}
              strokeLinecap="round"
            />
          </>
        )}
        {/* Invisible hit area */}
        <circle cx={x} cy={y} r={10} fill="transparent" />
      </g>
    );
  };

  return (
    <div className="w-full max-w-[620px] mx-auto">
      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        className="w-full h-auto"
        aria-label={tAttr('청력도 (Audiogram)')}
      >
        {/* Background bands */}
        {BANDS.map((band) => {
          const y1 = dbToY(Math.max(band.min, DB_MIN));
          const y2 = dbToY(Math.min(band.max, DB_MAX));
          return (
            <g key={band.label}>
              <rect
                x={CHART_LEFT}
                y={y1}
                width={CHART_W}
                height={y2 - y1}
                fill={band.color}
              />
              <text
                x={CHART_RIGHT + 4}
                y={(y1 + y2) / 2 + 3}
                fontSize={8}
                fill="#6B7280"
              >
                {tAttr(band.label)}
              </text>
            </g>
          );
        })}

        {/* Grid lines - horizontal (dB) */}
        {Array.from(
          { length: (DB_MAX - DB_MIN) / DB_STEP + 1 },
          (_, i) => DB_MIN + i * DB_STEP,
        ).map((db) => {
          const y = dbToY(db);
          return (
            <g key={`db-${db}`}>
              <line
                x1={CHART_LEFT}
                y1={y}
                x2={CHART_RIGHT}
                y2={y}
                stroke="#D1D5DB"
                strokeWidth={0.5}
              />
              <text
                x={CHART_LEFT - 8}
                y={y + 3}
                textAnchor="end"
                fontSize={9}
                fill="#6B7280"
              >
                {db}
              </text>
            </g>
          );
        })}

        {/* Grid lines - vertical (frequency) */}
        {FREQUENCIES.map((freq, i) => {
          const x = freqToX(freq);
          return (
            <g key={`freq-${freq}`}>
              <line
                x1={x}
                y1={CHART_TOP}
                x2={x}
                y2={CHART_BOTTOM}
                stroke="#D1D5DB"
                strokeWidth={0.5}
              />
              <text
                x={x}
                y={CHART_BOTTOM + 16}
                textAnchor="middle"
                fontSize={10}
                fill="#374151"
              >
                {FREQ_LABELS[i]}
              </text>
            </g>
          );
        })}

        {/* Axis labels */}
        <text
          x={SVG_W / 2}
          y={CHART_BOTTOM + 32}
          textAnchor="middle"
          fontSize={11}
          fill="#374151"
          fontWeight={500}
        >
          {tAttr('주파수 (Hz)')}
        </text>
        <text
          x={14}
          y={(CHART_TOP + CHART_BOTTOM) / 2}
          textAnchor="middle"
          fontSize={11}
          fill="#374151"
          fontWeight={500}
          transform={`rotate(-90, 14, ${(CHART_TOP + CHART_BOTTOM) / 2})`}
        >
          dB HL
        </text>

        {/* Chart border + edit click area */}
        <rect
          x={CHART_LEFT}
          y={CHART_TOP}
          width={CHART_W}
          height={CHART_H}
          fill="transparent"
          stroke="#9CA3AF"
          strokeWidth={1}
          style={{ cursor: mode === 'edit' ? 'crosshair' : 'default' }}
          onClick={mode === 'edit' ? (e) => {
            const svg = (e.target as SVGRectElement).ownerSVGElement;
            if (!svg) return;
            const pt = svg.createSVGPoint();
            pt.x = e.clientX;
            pt.y = e.clientY;
            const svgPt = pt.matrixTransform(svg.getScreenCTM()?.inverse());
            const freq = xToFreq(svgPt.x);
            const db = yToDb(svgPt.y);
            if (db < DB_MIN || db > DB_MAX) return;
            const currentData = editEar === 'right' ? [...rightAC] : [...leftAC];
            const existingIdx = currentData.findIndex(p => p.freq === freq);
            if (existingIdx >= 0) {
              currentData[existingIdx] = { freq, db };
            } else {
              currentData.push({ freq, db });
            }
            onDataChange?.(editEar, currentData);
          } : undefined}
        />

        {/* Right AC line (solid red) */}
        {rightAC.length > 1 && (
          <polyline
            points={buildPolyline(rightAC)}
            fill="none"
            stroke="#EF4444"
            strokeWidth={1.5}
          />
        )}

        {/* Left AC line (dashed blue) */}
        {leftAC.length > 1 && (
          <polyline
            points={buildPolyline(leftAC)}
            fill="none"
            stroke="#3B82F6"
            strokeWidth={1.5}
            strokeDasharray="6,3"
          />
        )}

        {/* Right BC line (solid red, thinner) */}
        {rightBC && rightBC.length > 1 && (
          <polyline
            points={buildPolyline(rightBC)}
            fill="none"
            stroke="#EF4444"
            strokeWidth={1}
            strokeDasharray="2,2"
          />
        )}

        {/* Left BC line (dashed blue, thinner) */}
        {leftBC && leftBC.length > 1 && (
          <polyline
            points={buildPolyline(leftBC)}
            fill="none"
            stroke="#3B82F6"
            strokeWidth={1}
            strokeDasharray="2,2"
          />
        )}

        {/* Markers */}
        {rightAC.map((p) => renderMarker(p, 'right', 'AC'))}
        {leftAC.map((p) => renderMarker(p, 'left', 'AC'))}
        {rightBC?.map((p) => renderMarker(p, 'right', 'BC'))}
        {leftBC?.map((p) => renderMarker(p, 'left', 'BC'))}

        {/* Tooltip */}
        {hovered && (
          <g>
            <rect
              x={hovered.x - 45}
              y={hovered.y - 30}
              width={90}
              height={22}
              rx={4}
              fill="#1F2937"
              opacity={0.92}
            />
            <text
              x={hovered.x}
              y={hovered.y - 15}
              textAnchor="middle"
              fontSize={9}
              fill="white"
            >
              {hovered.ear} {hovered.freq}Hz: {hovered.db}dB
            </text>
          </g>
        )}
      </svg>

      {/* Edit ear toggle */}
      {mode === 'edit' && (
        <div className="flex items-center justify-center gap-2 mt-3">
          <span className="text-xs text-gray-500"><T k="편집 귀:" /></span>
          <button type="button"
            onClick={() => setEditEar('right')}
            className={`text-xs px-3 py-1 rounded-lg font-medium ${editEar === 'right' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-500'}`}>
            <T k="우측 (R)" />
          </button>
          <button type="button"
            onClick={() => setEditEar('left')}
            className={`text-xs px-3 py-1 rounded-lg font-medium ${editEar === 'left' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
            <T k="좌측 (L)" />
          </button>
        </div>
      )}

      {/* PTA display + Legend */}
      <div className="flex items-center justify-between mt-3 px-2">
        <div className="flex gap-4">
          <div className="flex items-center gap-1.5">
            <svg width="14" height="14" viewBox="0 0 14 14">
              <circle
                cx="7"
                cy="7"
                r="5"
                fill="none"
                stroke="#EF4444"
                strokeWidth="2"
              />
            </svg>
            <span className="text-[10px] text-gray-600 whitespace-nowrap">
              <T k="우측 기도 (AC)" />
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <svg width="14" height="14" viewBox="0 0 14 14">
              <line
                x1="2"
                y1="2"
                x2="12"
                y2="12"
                stroke="#3B82F6"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <line
                x1="12"
                y1="2"
                x2="2"
                y2="12"
                stroke="#3B82F6"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            <span className="text-[10px] text-gray-600 whitespace-nowrap">
              <T k="좌측 기도 (AC)" />
            </span>
          </div>
          {(rightBC?.length ?? 0) > 0 && (
            <div className="flex items-center gap-1.5">
              <svg width="14" height="14" viewBox="0 0 14 14">
                <line
                  x1="9"
                  y1="2"
                  x2="3"
                  y2="7"
                  stroke="#EF4444"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <line
                  x1="3"
                  y1="7"
                  x2="9"
                  y2="12"
                  stroke="#EF4444"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              <span className="text-[10px] text-gray-600 whitespace-nowrap">
                <T k="우측 골도 (BC)" />
              </span>
            </div>
          )}
          {(leftBC?.length ?? 0) > 0 && (
            <div className="flex items-center gap-1.5">
              <svg width="14" height="14" viewBox="0 0 14 14">
                <line
                  x1="5"
                  y1="2"
                  x2="11"
                  y2="7"
                  stroke="#3B82F6"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <line
                  x1="11"
                  y1="7"
                  x2="5"
                  y2="12"
                  stroke="#3B82F6"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
              <span className="text-[10px] text-gray-600 whitespace-nowrap">
                <T k="좌측 골도 (BC)" />
              </span>
            </div>
          )}
        </div>

        <div className="flex gap-4 text-xs">
          {ptaRight !== null && (
            <span className="text-red-600 font-semibold whitespace-nowrap">
              PTA(R): {ptaRight} dB
            </span>
          )}
          {ptaLeft !== null && (
            <span className="text-blue-600 font-semibold whitespace-nowrap">
              PTA(L): {ptaLeft} dB
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
