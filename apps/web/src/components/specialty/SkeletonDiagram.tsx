'use client';

import { useState } from 'react';

import { T, useTAttr } from '@/components/ui/i18n-text';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface SkeletonMarker {
  part: string;
  type: 'pain' | 'fracture' | 'surgery';
}

interface SkeletonDiagramProps {
  selectedPart: string | null;
  onPartClick: (part: string) => void;
  markers?: SkeletonMarker[];
  view: 'front' | 'back';
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

interface JointDef {
  id: string;
  label: string;
  cx: number;
  cy: number;
  front: boolean;
  back: boolean;
}

const JOINTS: JointDef[] = [
  { id: 'SHOULDER', label: '어깨', cx: 95, cy: 120, front: true, back: true },
  { id: 'SHOULDER_R', label: '어깨(우)', cx: 205, cy: 120, front: true, back: true },
  { id: 'ELBOW', label: '팔꿈치', cx: 75, cy: 195, front: true, back: true },
  { id: 'ELBOW_R', label: '팔꿈치(우)', cx: 225, cy: 195, front: true, back: true },
  { id: 'WRIST', label: '손목', cx: 62, cy: 265, front: true, back: true },
  { id: 'WRIST_R', label: '손목(우)', cx: 238, cy: 265, front: true, back: true },
  { id: 'HIP', label: '고관절', cx: 120, cy: 260, front: true, back: true },
  { id: 'HIP_R', label: '고관절(우)', cx: 180, cy: 260, front: true, back: true },
  { id: 'KNEE', label: '무릎', cx: 122, cy: 345, front: true, back: true },
  { id: 'KNEE_R', label: '무릎(우)', cx: 178, cy: 345, front: true, back: true },
  { id: 'ANKLE', label: '발목', cx: 120, cy: 435, front: true, back: true },
  { id: 'ANKLE_R', label: '발목(우)', cx: 180, cy: 435, front: true, back: true },
  { id: 'SPINE_C', label: '경추', cx: 150, cy: 85, front: false, back: true },
  { id: 'SPINE_T', label: '흉추', cx: 150, cy: 160, front: false, back: true },
  { id: 'SPINE_L', label: '요추', cx: 150, cy: 230, front: false, back: true },
];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function SkeletonDiagram({
  selectedPart,
  onPartClick,
  markers = [],
  view,
}: SkeletonDiagramProps) {
  const [hoveredJoint, setHoveredJoint] = useState<string | null>(null);
  const tAttr = useTAttr();

  const visibleJoints = JOINTS.filter((j) =>
    view === 'front' ? j.front : j.back,
  );

  const markerMap = new Map<string, SkeletonMarker>();
  markers.forEach((m) => markerMap.set(m.part, m));

  return (
    <div className="w-full max-w-[340px] mx-auto">
      <p className="text-center text-xs text-gray-500 mb-2 font-medium">
        <T k={view === 'front' ? '앞면 (Front)' : '뒷면 (Back)'} />
      </p>

      <svg
        viewBox="0 0 300 500"
        className="w-full h-auto"
        aria-label={`${tAttr('골격 다이어그램')} - ${tAttr(view === 'front' ? '앞면' : '뒷면')}`}
      >
        {/* Human outline */}
        {/* Head */}
        <ellipse cx={150} cy={40} rx={28} ry={32} fill="#F9FAFB" stroke="#D1D5DB" strokeWidth={1.2} />
        {/* Neck */}
        <rect x={142} y={70} width={16} height={20} rx={4} fill="#F9FAFB" stroke="#D1D5DB" strokeWidth={1} />
        {/* Torso */}
        <path
          d="M100,90 Q95,88 92,95 L88,200 Q88,210 100,215 L120,250 Q130,260 150,262 Q170,260 180,250 L200,215 Q212,210 212,200 L208,95 Q205,88 200,90 Z"
          fill="#F9FAFB" stroke="#D1D5DB" strokeWidth={1.2}
        />
        {/* Left arm */}
        <path
          d="M92,95 Q80,100 75,120 L65,190 Q60,210 55,260 Q54,270 58,275"
          fill="none" stroke="#D1D5DB" strokeWidth={6} strokeLinecap="round"
        />
        {/* Right arm */}
        <path
          d="M208,95 Q220,100 225,120 L235,190 Q240,210 245,260 Q246,270 242,275"
          fill="none" stroke="#D1D5DB" strokeWidth={6} strokeLinecap="round"
        />
        {/* Left leg */}
        <path
          d="M130,260 Q125,280 122,310 L120,345 L118,400 Q117,430 120,450 Q122,460 118,470"
          fill="none" stroke="#D1D5DB" strokeWidth={7} strokeLinecap="round"
        />
        {/* Right leg */}
        <path
          d="M170,260 Q175,280 178,310 L180,345 L182,400 Q183,430 180,450 Q178,460 182,470"
          fill="none" stroke="#D1D5DB" strokeWidth={7} strokeLinecap="round"
        />

        {/* Spine line (back view only) */}
        {view === 'back' && (
          <line x1={150} y1={72} x2={150} y2={250} stroke="#CBD5E1" strokeWidth={2} strokeDasharray="3,3" />
        )}

        {/* Joints */}
        {visibleJoints.map((joint) => {
          const isSelected = selectedPart === joint.id;
          const isHovered = hoveredJoint === joint.id;
          const marker = markerMap.get(joint.id);
          const r = isSelected || isHovered ? 10 : 8;

          return (
            <g
              key={joint.id}
              onClick={() => onPartClick(joint.id)}
              onMouseEnter={() => setHoveredJoint(joint.id)}
              onMouseLeave={() => setHoveredJoint(null)}
              style={{ cursor: 'pointer' }}
              role="button"
              aria-label={tAttr(joint.label)}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onPartClick(joint.id);
              }}
            >
              {/* Joint circle */}
              <circle
                cx={joint.cx}
                cy={joint.cy}
                r={r}
                fill={isSelected ? '#DBEAFE' : isHovered ? '#EFF6FF' : '#F3F4F6'}
                stroke={isSelected ? '#2563EB' : isHovered ? '#60A5FA' : '#9CA3AF'}
                strokeWidth={isSelected ? 2 : 1.2}
              />
              {/* Label */}
              <text
                x={joint.cx}
                y={joint.cy + r + 10}
                textAnchor="middle"
                fontSize={7}
                fill={isSelected ? '#2563EB' : '#6B7280'}
                fontWeight={isSelected ? 600 : 400}
              >
                {tAttr(joint.label)}
              </text>

              {/* Marker overlay */}
              {marker && marker.type === 'pain' && (
                <circle cx={joint.cx} cy={joint.cy} r={5} fill="#EF4444" opacity={0.7} />
              )}
              {marker && marker.type === 'fracture' && (
                <g>
                  <line x1={joint.cx - 4} y1={joint.cy - 4} x2={joint.cx + 4} y2={joint.cy + 4} stroke="#EF4444" strokeWidth={2.5} />
                  <line x1={joint.cx + 4} y1={joint.cy - 4} x2={joint.cx - 4} y2={joint.cy + 4} stroke="#EF4444" strokeWidth={2.5} />
                </g>
              )}
              {marker && marker.type === 'surgery' && (
                <rect
                  x={joint.cx - 4}
                  y={joint.cy - 4}
                  width={8}
                  height={8}
                  fill="#3B82F6"
                  opacity={0.7}
                />
              )}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="flex flex-wrap justify-center gap-3 mt-3 px-2">
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-full bg-red-500" />
          <span className="text-[10px] text-gray-600 whitespace-nowrap"><T k="통증" /></span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 text-red-500 font-bold text-[10px] text-center leading-3">X</span>
          <span className="text-[10px] text-gray-600 whitespace-nowrap"><T k="골절" /></span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 bg-blue-500" />
          <span className="text-[10px] text-gray-600 whitespace-nowrap"><T k="수술" /></span>
        </div>
      </div>
    </div>
  );
}
