'use client';

import { useState } from 'react';

import { useTAttr } from '@/components/ui/i18n-text';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type ToothStatusType =
  | 'NORMAL'
  | 'CARIES'
  | 'FILLING'
  | 'CROWN'
  | 'RCT'
  | 'MISSING'
  | 'IMPLANT'
  | 'BRIDGE'
  | 'EXTRACTION_NEEDED';

export interface ToothStatus {
  tooth: string;
  status: string;
  notes?: string;
  /** 이환면(O·B·L·M·D). 기록이 없으면 undefined — 🔴 '정상'으로 단정하지 않는다 */
  surfaces?: string[];
}

interface DentalChartDiagramProps {
  teethStatus: ToothStatus[];
  selectedTooth: string | null;
  onToothClick: (tooth: string) => void;
  onStatusChange?: (tooth: string, status: string) => void;
  mode: 'view' | 'edit';
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const STATUS_COLORS: Record<string, string> = {
  NORMAL: '#E5E7EB',
  CARIES: '#EF4444',
  FILLING: '#3B82F6',
  CROWN: '#F59E0B',
  RCT: '#8B5CF6',
  MISSING: '#9CA3AF',
  IMPLANT: '#10B981',
  EXTRACTION_NEEDED: '#DC2626',
  BRIDGE: '#A78BFA',   // 브릿지 — 라벨표에는 있는데 그림에 없어 '정상'으로 칠해졌다(W4)
  UNKNOWN: '#F3F4F6',  // 미상
};

const STATUS_LABELS: Record<string, string> = {
  NORMAL: '정상',
  CARIES: '우식',
  FILLING: '충전',
  CROWN: '크라운',
  RCT: '근관치료',
  MISSING: '결손',
  IMPLANT: '임플란트',
  EXTRACTION_NEEDED: '발치필요',
  BRIDGE: '브릿지',
  UNKNOWN: '미상',
};

// 치과 표준 기호 (FDI + 치과 약어)
const STATUS_NOTATION: Record<string, string> = {
  NORMAL: '',
  CARIES: 'Ca',
  FILLING: 'F',
  CROWN: 'Cr',
  RCT: 'RCT',
  MISSING: 'M',
  IMPLANT: 'Imp',
  EXTRACTION_NEEDED: 'Ext',
};

// FDI numbering: upper-right 18-11, upper-left 21-28, lower-left 38-31, lower-right 41-48
const UPPER_RIGHT = ['18', '17', '16', '15', '14', '13', '12', '11'];
const UPPER_LEFT = ['21', '22', '23', '24', '25', '26', '27', '28'];
const LOWER_LEFT = ['38', '37', '36', '35', '34', '33', '32', '31'];
const LOWER_RIGHT = ['41', '42', '43', '44', '45', '46', '47', '48'];

const TOOTH_W = 32;
const TOOTH_H = 44;
const GAP = 4;
const ARCH_GAP = 16; // gap between left and right quadrants
const MARGIN_X = 30;
const MARGIN_Y = 30;

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getToothX(index: number, isRight: boolean): number {
  const quadrantOffset = isRight ? 0 : 8 * (TOOTH_W + GAP) + ARCH_GAP;
  return MARGIN_X + quadrantOffset + index * (TOOTH_W + GAP);
}

function getArchOffsetY(index: number, isUpper: boolean): number {
  // Create slight arch curve: edges higher for upper, lower for lower
  const center = 3.5;
  const dist = Math.abs(index - center);
  const curve = dist * dist * 0.8;
  return isUpper ? curve : -curve;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function DentalChartDiagram({
  teethStatus,
  selectedTooth,
  onToothClick,
  onStatusChange,
  mode,
}: DentalChartDiagramProps) {
  const tAttr = useTAttr();
  const [hoveredTooth, setHoveredTooth] = useState<string | null>(null);
  const [dropdownTooth, setDropdownTooth] = useState<string | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ x: number; y: number } | null>(null);

  const statusMap = new Map<string, ToothStatus>();
  teethStatus.forEach((t) => statusMap.set(t.tooth, t));

  const totalW = MARGIN_X * 2 + 16 * (TOOTH_W + GAP) + ARCH_GAP - GAP;
  const totalH = MARGIN_Y * 2 + 2 * TOOTH_H + 80; // extra space for labels + gap

  const renderTooth = (
    toothNum: string,
    x: number,
    y: number,
    isUpper: boolean,
  ) => {
    const ts = statusMap.get(toothNum);
    const status = (ts?.status ?? 'NORMAL') as ToothStatusType;
    // 🔴 모르는 치식 상태를 '정상'으로 칠하지 않는다 — 표는 '브릿지'인데 그림은 '정상'이었다(P12)
    const fill = STATUS_COLORS[status] ?? STATUS_COLORS.UNKNOWN;
    const isSelected = selectedTooth === toothNum;
    const isHovered = hoveredTooth === toothNum;
    const isMissing = status === 'MISSING';
    const isExtraction = status === 'EXTRACTION_NEEDED';

    return (
      <g
        key={toothNum}
        onClick={() => {
          onToothClick(toothNum);
          if (mode === 'edit') {
            setDropdownTooth(prev => prev === toothNum ? null : toothNum);
            setDropdownPos({ x, y });
          }
        }}
        onMouseEnter={() => setHoveredTooth(toothNum)}
        onMouseLeave={() => setHoveredTooth(null)}
        style={{ cursor: mode === 'edit' ? 'pointer' : 'default' }}
        role="button"
        aria-label={`${tAttr('치아')} ${toothNum} - ${tAttr(STATUS_LABELS[status] ?? status)}`}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onToothClick(toothNum);
        }}
      >
        {/* Selection ring */}
        {isSelected && (
          <rect
            x={x - 3}
            y={y - 3}
            width={TOOTH_W + 6}
            height={TOOTH_H + 6}
            rx={6}
            ry={6}
            fill="none"
            stroke="#2563EB"
            strokeWidth={2.5}
          />
        )}

        {/* Tooth body */}
        <rect
          x={x}
          y={y}
          width={TOOTH_W}
          height={TOOTH_H}
          rx={4}
          ry={4}
          fill={isMissing ? 'white' : fill}
          stroke={isMissing ? '#9CA3AF' : isHovered ? '#1D4ED8' : '#6B7280'}
          strokeWidth={isMissing ? 1.5 : isHovered ? 2 : 1}
          strokeDasharray={isMissing ? '4,3' : undefined}
          opacity={isMissing ? 0.5 : 1}
        />

        {/* 치과 표준 약어 표기 */}
        {status !== 'NORMAL' && status !== 'MISSING' && (
          <text
            x={x + TOOTH_W / 2}
            y={y + TOOTH_H / 2 + 3}
            textAnchor="middle"
            fontSize={8}
            fontWeight={700}
            fill="white"
          >
            {STATUS_NOTATION[status] ?? ''}
          </text>
        )}

        {/* X mark for extraction needed */}
        {isExtraction && (
          <>
            <line
              x1={x + 6}
              y1={y + 8}
              x2={x + TOOTH_W - 6}
              y2={y + TOOTH_H - 8}
              stroke="white"
              strokeWidth={2.5}
              strokeLinecap="round"
            />
            <line
              x1={x + TOOTH_W - 6}
              y1={y + 8}
              x2={x + 6}
              y2={y + TOOTH_H - 8}
              stroke="white"
              strokeWidth={2.5}
              strokeLinecap="round"
            />
          </>
        )}

        {/* Tooth number label */}
        <text
          x={x + TOOTH_W / 2}
          y={isUpper ? y + TOOTH_H + 14 : y - 6}
          textAnchor="middle"
          fontSize={9}
          fontWeight={isSelected ? 700 : 500}
          fill={isSelected ? '#2563EB' : '#374151'}
        >
          {toothNum}
        </text>

        {/* Tooltip */}
        {isHovered && ts?.notes && (
          <g>
            <rect
              x={x - 20}
              y={isUpper ? y - 30 : y + TOOTH_H + 22}
              width={TOOTH_W + 40}
              height={20}
              rx={4}
              fill="#1F2937"
              opacity={0.9}
            />
            <text
              x={x + TOOTH_W / 2}
              y={isUpper ? y - 16 : y + TOOTH_H + 36}
              textAnchor="middle"
              fontSize={8}
              fill="white"
            >
              {ts.notes.length > 12
                ? ts.notes.substring(0, 12) + '...'
                : ts.notes}
            </text>
          </g>
        )}
      </g>
    );
  };

  const renderQuadrant = (
    teeth: string[],
    isUpper: boolean,
    isRight: boolean,
  ) => {
    const baseY = isUpper ? MARGIN_Y : MARGIN_Y + TOOTH_H + 60;
    return teeth.map((tooth, i) => {
      const x = getToothX(isRight ? i : i, isRight);
      const archY = getArchOffsetY(i, isUpper);
      return renderTooth(tooth, x, baseY + archY, isUpper);
    });
  };

  return (
    <div className="w-full max-w-[640px] mx-auto relative">
      <svg
        viewBox={`0 0 ${totalW} ${totalH}`}
        className="w-full h-auto"
        style={{ overflow: 'visible' }}
        aria-label={tAttr('치과 32치아 차트')}
      >
        {/* Jaw labels */}
        <text
          x={totalW / 2}
          y={16}
          textAnchor="middle"
          fontSize={11}
          fontWeight={600}
          fill="#6B7280"
        >
          {tAttr('상악 (Upper Jaw)')}
        </text>
        <text
          x={totalW / 2}
          y={totalH - 8}
          textAnchor="middle"
          fontSize={11}
          fontWeight={600}
          fill="#6B7280"
        >
          {tAttr('하악 (Lower Jaw)')}
        </text>

        {/* Side labels */}
        <text
          x={8}
          y={MARGIN_Y + TOOTH_H / 2 + 30}
          textAnchor="middle"
          fontSize={9}
          fill="#9CA3AF"
          transform={`rotate(-90, 8, ${MARGIN_Y + TOOTH_H / 2 + 30})`}
        >
          {tAttr('우측(R)')}
        </text>
        <text
          x={totalW - 8}
          y={MARGIN_Y + TOOTH_H / 2 + 30}
          textAnchor="middle"
          fontSize={9}
          fill="#9CA3AF"
          transform={`rotate(90, ${totalW - 8}, ${MARGIN_Y + TOOTH_H / 2 + 30})`}
        >
          {tAttr('좌측(L)')}
        </text>

        {/* Center divider */}
        <line
          x1={totalW / 2}
          y1={MARGIN_Y - 5}
          x2={totalW / 2}
          y2={totalH - 20}
          stroke="#E5E7EB"
          strokeWidth={1}
          strokeDasharray="4,4"
        />

        {/* Upper teeth */}
        {renderQuadrant(UPPER_RIGHT, true, true)}
        {renderQuadrant(UPPER_LEFT, true, false)}

        {/* Lower teeth */}
        {renderQuadrant(LOWER_RIGHT, false, true)}
        {renderQuadrant(LOWER_LEFT, false, false)}

        {/* Status dropdown removed from SVG — rendered as HTML below */}
        {mode === 'edit' && dropdownTooth && dropdownPos && (() => {
          return (
            <g>
              <rect x={0} y={0} width={totalW} height={totalH} fill="transparent"
                onClick={(e) => { e.stopPropagation(); setDropdownTooth(null); }} />
            </g>
          );
        })()}
      </svg>

      {/* HTML Status Dropdown (z-index 최상위) */}
      {mode === 'edit' && dropdownTooth && dropdownPos && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setDropdownTooth(null)} />
          <div className="absolute z-50 bg-white rounded-xl shadow-2xl border border-gray-200 py-2 w-40"
            style={{
              left: `clamp(0%, ${(dropdownPos.x / totalW) * 100}%, calc(100% - 160px))`,
              top: dropdownPos.y > totalH / 2
                ? `calc(${(dropdownPos.y / totalH) * 100}% - 240px)` /* 하악: 위로 */
                : `calc(${(dropdownPos.y / totalH) * 100}% + 30px)`, /* 상악: 아래로 */
            }}>
            {Object.entries(STATUS_LABELS).map(([key, label]) => (
              <button key={key} onClick={() => { onStatusChange?.(dropdownTooth, key); setDropdownTooth(null); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-blue-50 text-left transition-colors">
                <span className="w-3.5 h-3.5 rounded border border-gray-300 flex-shrink-0" style={{ backgroundColor: STATUS_COLORS[key] }} />
                <span className="text-gray-700 font-medium">{tAttr(label)}</span>
                {STATUS_NOTATION[key] && <span className="text-gray-400 ml-auto text-[10px] font-mono">{STATUS_NOTATION[key]}</span>}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-3 mt-3 px-2">
        {Object.entries(STATUS_LABELS).map(([key, label]) => (
          <div key={key} className="flex items-center gap-1.5">
            <span
              className="inline-block w-3 h-3 rounded-sm border border-gray-300"
              style={{
                backgroundColor: STATUS_COLORS[key],
                borderStyle: key === 'MISSING' ? 'dashed' : 'solid',
                opacity: key === 'MISSING' ? 0.5 : 1,
              }}
            />
            <span className="text-[10px] text-gray-600 whitespace-nowrap">
              {tAttr(label)}{STATUS_NOTATION[key] ? ` (${STATUS_NOTATION[key]})` : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
