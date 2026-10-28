'use client';

import { useState } from 'react';

import { T, useTAttr } from '@/components/ui/i18n-text';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface Lesion {
  id: string;
  bodyRegion: string;
  morphology: string;
  size?: string;
}

interface BodyMapDiagramProps {
  lesions: Lesion[];
  onRegionClick: (region: string) => void;
  onAddLesion?: (region: string, morphology: string, size?: string) => void;
  view: 'front' | 'back';
  mode?: 'view' | 'edit';
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const MORPHOLOGY_COLORS: Record<string, string> = {
  PAPULE: '#EF4444',
  MACULE: '#92400E',
  NODULE: '#3B82F6',
  PLAQUE: '#8B5CF6',
  VESICLE: '#EAB308',
};

const MORPHOLOGY_LABELS: Record<string, string> = {
  PAPULE: '구진',
  MACULE: '반점',
  NODULE: '결절',
  PLAQUE: '판',
  VESICLE: '소수포',
};

const SVG_W = 300;
const SVG_H = 500;

/* Body region definitions: simplified rectangles/paths with center points */

interface RegionDef {
  id: string;
  label: string;
  path: string;
  cx: number;
  cy: number;
  front: boolean;
  back: boolean;
}

const REGIONS: RegionDef[] = [
  // HEAD — 타원형
  { id: 'HEAD', label: '두부',
    path: 'M150,4 C170,4 182,16 182,32 C182,44 170,52 150,52 C130,52 118,44 118,32 C118,16 130,4 150,4 Z',
    cx: 150, cy: 28, front: true, back: true },
  // FACE — 얼굴 하단 (앞면만)
  { id: 'FACE', label: '안면',
    path: 'M136,38 C136,38 142,62 150,62 C158,62 164,38 164,38 Q150,42 136,38 Z',
    cx: 150, cy: 52, front: true, back: false },
  // NECK — 좁은 원통
  { id: 'NECK', label: '경부',
    path: 'M140,60 C143,58 157,58 160,60 L162,76 C158,78 142,78 138,76 Z',
    cx: 150, cy: 68, front: true, back: true },
  // CHEST — 어깨에서 허리로 좁아지는 곡선 (앞면)
  { id: 'CHEST', label: '흉부',
    path: 'M110,78 C115,75 185,75 190,78 L190,82 Q192,84 192,88 L188,140 C175,144 125,144 112,140 L108,88 Q108,84 110,82 Z',
    cx: 150, cy: 110, front: true, back: false },
  // BACK — 등 (뒷면)
  { id: 'BACK', label: '등',
    path: 'M110,78 C115,75 185,75 190,78 L190,82 Q192,84 192,88 L188,140 C175,144 125,144 112,140 L108,88 Q108,84 110,82 Z',
    cx: 150, cy: 110, front: false, back: true },
  // ABDOMEN — 허리~골반 곡선 (앞면)
  { id: 'ABDOMEN', label: '복부',
    path: 'M114,142 C126,146 174,146 186,142 L184,200 Q182,212 174,216 L126,216 Q118,212 116,200 Z',
    cx: 150, cy: 178, front: true, back: false },
  // UPPER ARM LEFT — 어깨에서 팔꿈치, 곡선
  { id: 'UPPER_ARM_L', label: '좌상완',
    path: 'M108,80 C104,78 96,80 92,84 Q86,92 84,110 L82,142 Q82,148 86,150 L106,150 Q110,148 110,142 L112,88 Q112,84 108,80 Z',
    cx: 96, cy: 115, front: true, back: true },
  // UPPER ARM RIGHT
  { id: 'UPPER_ARM_R', label: '우상완',
    path: 'M192,80 C196,78 204,80 208,84 Q214,92 216,110 L218,142 Q218,148 214,150 L194,150 Q190,148 190,142 L188,88 Q188,84 192,80 Z',
    cx: 204, cy: 115, front: true, back: true },
  // FOREARM LEFT — 팔꿈치에서 손목
  { id: 'FOREARM_L', label: '좌전완',
    path: 'M84,152 L106,152 Q108,154 106,160 L100,224 Q98,228 94,228 L76,228 Q72,226 72,222 L80,160 Q80,154 84,152 Z',
    cx: 90, cy: 190, front: true, back: true },
  // FOREARM RIGHT
  { id: 'FOREARM_R', label: '우전완',
    path: 'M194,152 L216,152 Q220,154 220,160 L228,222 Q228,226 224,228 L206,228 Q202,228 200,224 L194,160 Q192,154 194,152 Z',
    cx: 210, cy: 190, front: true, back: true },
  // HAND LEFT — 둥근 손
  { id: 'HAND_L', label: '좌수부',
    path: 'M74,230 L96,230 Q100,232 100,238 L98,256 Q96,264 88,266 L80,266 Q72,264 70,256 L68,238 Q68,232 74,230 Z',
    cx: 84, cy: 248, front: true, back: true },
  // HAND RIGHT
  { id: 'HAND_R', label: '우수부',
    path: 'M204,230 L226,230 Q232,232 232,238 L234,256 Q232,264 224,266 L216,266 Q208,264 206,256 L204,238 Q200,232 204,230 Z',
    cx: 218, cy: 248, front: true, back: true },
  // THIGH LEFT — 골반에서 무릎
  { id: 'THIGH_L', label: '좌대퇴',
    path: 'M124,218 L148,218 Q150,222 148,228 L142,310 Q140,316 138,318 L128,318 Q124,316 122,310 L118,228 Q116,222 124,218 Z',
    cx: 134, cy: 268, front: true, back: true },
  // THIGH RIGHT
  { id: 'THIGH_R', label: '우대퇴',
    path: 'M152,218 L176,218 Q184,222 182,228 L178,310 Q176,316 172,318 L162,318 Q160,316 158,310 L152,228 Q150,222 152,218 Z',
    cx: 166, cy: 268, front: true, back: true },
  // LOWER LEG LEFT — 무릎에서 발목, 약간 볼록
  { id: 'LOWER_LEG_L', label: '좌하퇴',
    path: 'M126,320 L140,320 Q142,324 142,330 L140,400 Q140,408 136,410 L130,410 Q124,408 124,400 L122,330 Q122,324 126,320 Z',
    cx: 132, cy: 365, front: true, back: true },
  // LOWER LEG RIGHT
  { id: 'LOWER_LEG_R', label: '우하퇴',
    path: 'M160,320 L174,320 Q178,324 178,330 L178,400 Q178,408 174,410 L168,410 Q162,408 160,400 L158,330 Q158,324 160,320 Z',
    cx: 168, cy: 365, front: true, back: true },
  // FOOT LEFT — 발 모양
  { id: 'FOOT_L', label: '좌족부',
    path: 'M122,412 L138,412 Q142,414 142,420 L140,436 Q138,444 130,446 L124,446 Q116,444 114,436 L114,420 Q114,414 122,412 Z',
    cx: 128, cy: 430, front: true, back: true },
  // FOOT RIGHT
  { id: 'FOOT_R', label: '우족부',
    path: 'M162,412 L178,412 Q186,414 186,420 L186,436 Q184,444 176,446 L170,446 Q162,444 160,436 L158,420 Q158,414 162,412 Z',
    cx: 172, cy: 430, front: true, back: true },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function BodyMapDiagram({
  lesions,
  onRegionClick,
  onAddLesion,
  view,
  mode = 'view',
}: BodyMapDiagramProps) {
  const [hoveredRegion, setHoveredRegion] = useState<string | null>(null);
  const [editRegion, setEditRegion] = useState<string | null>(null);
  const [formMorphology, setFormMorphology] = useState('PAPULE');
  const [formSize, setFormSize] = useState('');
  const tAttr = useTAttr();

  const visibleRegions = REGIONS.filter((r) =>
    view === 'front' ? r.front : r.back,
  );

  // Group lesions by region
  const lesionsByRegion = new Map<string, Lesion[]>();
  lesions.forEach((l) => {
    const existing = lesionsByRegion.get(l.bodyRegion) ?? [];
    existing.push(l);
    lesionsByRegion.set(l.bodyRegion, existing);
  });

  return (
    <div className="w-full max-w-[340px] mx-auto">
      {/* View toggle is controlled externally via the `view` prop */}
      <p className="text-center text-xs text-gray-500 mb-2 font-medium">
        <T k={view === 'front' ? '앞면 (Front)' : '뒷면 (Back)'} />
      </p>

      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        className="w-full h-auto"
        aria-label={`${tAttr('신체 부위 다이어그램')} - ${tAttr(view === 'front' ? '앞면' : '뒷면')}`}
      >
        {/* Body outline silhouette — 자연스러운 인체 곡선 */}
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

        {/* Clickable regions */}
        {visibleRegions.map((region) => {
          const isHovered = hoveredRegion === region.id;
          const hasLesions = lesionsByRegion.has(region.id);
          return (
            <g
              key={region.id}
              onClick={() => {
                onRegionClick(region.id);
                if (mode === 'edit') {
                  setEditRegion(prev => prev === region.id ? null : region.id);
                  setFormMorphology('PAPULE');
                  setFormSize('');
                }
              }}
              onMouseEnter={() => setHoveredRegion(region.id)}
              onMouseLeave={() => setHoveredRegion(null)}
              style={{ cursor: 'pointer' }}
              role="button"
              aria-label={`${tAttr(region.label)} ${tAttr('부위')}`}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ')
                  onRegionClick(region.id);
              }}
            >
              <path
                d={region.path}
                fill={
                  isHovered
                    ? '#DBEAFE'
                    : hasLesions
                      ? '#FEF3C7'
                      : 'transparent'
                }
                stroke={isHovered ? '#3B82F6' : hasLesions ? '#F59E0B' : '#E5E7EB'}
                strokeWidth={isHovered ? 1.5 : 0.8}
                opacity={0.6}
              />
              {/* Region label */}
              <text
                x={region.cx}
                y={region.cy}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={8}
                fill={isHovered ? '#1D4ED8' : '#9CA3AF'}
                fontWeight={isHovered ? 600 : 400}
              >
                {tAttr(region.label)}
              </text>
            </g>
          );
        })}

        {/* Lesion markers */}
        {visibleRegions.map((region) => {
          const regionLesions = lesionsByRegion.get(region.id);
          if (!regionLesions) return null;
          return regionLesions.map((lesion, i) => {
            const color =
              MORPHOLOGY_COLORS[lesion.morphology] ?? '#6B7280';
            // Offset multiple lesions in same region
            const offsetX = (i - (regionLesions.length - 1) / 2) * 12;
            const markerX = region.cx + offsetX;
            const markerY = region.cy + 12;
            return (
              <g key={lesion.id}>
                <circle
                  cx={markerX}
                  cy={markerY}
                  r={5}
                  fill={color}
                  stroke="white"
                  strokeWidth={1.5}
                  opacity={0.9}
                />
                {hoveredRegion === region.id && (
                  <text
                    x={markerX}
                    y={markerY + 14}
                    textAnchor="middle"
                    fontSize={7}
                    fill={color}
                    fontWeight={600}
                  >
                    {tAttr(MORPHOLOGY_LABELS[lesion.morphology] ?? lesion.morphology)}
                    {lesion.size ? ` ${lesion.size}` : ''}
                  </text>
                )}
              </g>
            );
          });
        })}
      </svg>

      {/* Add lesion mini-form (edit mode) */}
      {mode === 'edit' && editRegion && (() => {
        const regionDef = REGIONS.find(r => r.id === editRegion);
        return (
          <div className="mx-auto mt-2 p-3 border rounded-lg bg-white shadow-sm max-w-[300px] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-700">
                <T k="병변 추가" /> - <T k={regionDef?.label ?? editRegion} />
              </span>
              <button type="button" onClick={() => setEditRegion(null)}
                className="text-gray-400 hover:text-gray-600 text-xs">✕</button>
            </div>
            <div className="flex gap-2">
              <select value={formMorphology} onChange={e => setFormMorphology(e.target.value)}
                className="text-xs border rounded px-2 py-1.5 bg-white flex-1">
                {Object.entries(MORPHOLOGY_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{tAttr(v)} ({k})</option>
                ))}
              </select>
              <input value={formSize} onChange={e => setFormSize(e.target.value)}
                placeholder={tAttr('크기 (mm)')} className="text-xs border rounded px-2 py-1.5 w-20" />
            </div>
            <button type="button"
              onClick={() => {
                onAddLesion?.(editRegion, formMorphology, formSize || undefined);
                setEditRegion(null);
              }}
              className="w-full text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700">
              <T k="저장" />
            </button>
          </div>
        );
      })()}

      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-3 mt-3 px-2">
        {Object.entries(MORPHOLOGY_LABELS).map(([key, label]) => (
          <div key={key} className="flex items-center gap-1.5">
            <span
              className="inline-block w-3 h-3 rounded-full border border-gray-200"
              style={{ backgroundColor: MORPHOLOGY_COLORS[key] }}
            />
            <span className="text-[10px] text-gray-600 whitespace-nowrap">
              <T k={label} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
