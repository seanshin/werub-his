'use client';

import { useState } from 'react';

import { T, useTAttr } from '@/components/ui/i18n-text';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface MotorExamEntry {
  level: string;
  /** 미측정은 `null` — 0 은 "근수축 없음"이라는 **측정된 사실**이라 서로 다른 값이다. */
  left: number | null;
  right: number | null;
}

interface DermatomeMapProps {
  motorExam: MotorExamEntry[];
  onLevelClick?: (level: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const SPINAL_LEVELS = ['C5', 'C6', 'C7', 'C8', 'T1', 'L2', 'L3', 'L4', 'L5', 'S1'];

const MUSCLE_GROUPS: Record<string, string> = {
  C5: '삼각근 / 이두근',
  C6: '손목 신전근',
  C7: '삼두근 / 손목 굴곡근',
  C8: '수지 굴곡근',
  T1: '수지 외전근',
  L2: '장요근',
  L3: '대퇴사두근',
  L4: '전경골근',
  L5: '장무지 신전근',
  S1: '비복근 / 대둔근',
};

function gradeColor(grade: number): string {
  if (grade === 5) return '#22C55E';
  if (grade === 4) return '#84CC16';
  if (grade === 3) return '#EAB308';
  if (grade === 2) return '#F97316';
  return '#EF4444'; // 0-1
}

function gradeLabel(grade: number): string {
  const labels: Record<number, string> = {
    5: '정상',
    4: '약간↓',
    3: '중력↑',
    2: '중력↓',
    1: '미세',
    0: '없음',
  };
  return labels[grade] ?? `${grade}`;
}

/* ------------------------------------------------------------------ */
/*  Chart dimensions                                                   */
/* ------------------------------------------------------------------ */

const SVG_W = 300;
const SVG_H = 400;
const ROW_H = 34;
const HEADER_H = 36;
const START_Y = 20;
const COL_LEFT_X = 30;
const COL_LEVEL_X = 90;
const COL_MUSCLE_X = 150;
const COL_RIGHT_X = 250;
const GRADE_R = 12;

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function DermatomeMap({ motorExam, onLevelClick }: DermatomeMapProps) {
  const [hoveredLevel, setHoveredLevel] = useState<string | null>(null);
  const tAttr = useTAttr();

  // Build lookup
  const examMap = new Map<string, MotorExamEntry>();
  motorExam.forEach((e) => examMap.set(e.level, e));

  return (
    <div className="w-full max-w-[340px] mx-auto">
      <p className="text-sm font-bold text-gray-700 mb-2"><T k="근력 검사 (Motor Exam)" /></p>

      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        className="w-full h-auto"
        aria-label={tAttr('근력 검사 다이어그램')}
      >
        {/* Header row */}
        <text x={COL_LEFT_X} y={START_Y + 14} textAnchor="middle" fontSize={9} fill="#6B7280" fontWeight={600}>{tAttr('좌')}</text>
        <text x={COL_LEVEL_X} y={START_Y + 14} textAnchor="middle" fontSize={9} fill="#6B7280" fontWeight={600}>{tAttr('레벨')}</text>
        <text x={COL_MUSCLE_X} y={START_Y + 14} textAnchor="start" fontSize={9} fill="#6B7280" fontWeight={600}>{tAttr('근육군')}</text>
        <text x={COL_RIGHT_X} y={START_Y + 14} textAnchor="middle" fontSize={9} fill="#6B7280" fontWeight={600}>{tAttr('우')}</text>
        <line x1={10} y1={START_Y + HEADER_H - 4} x2={SVG_W - 10} y2={START_Y + HEADER_H - 4} stroke="#E5E7EB" strokeWidth={1} />

        {/* Rows */}
        {SPINAL_LEVELS.map((level, idx) => {
          const y = START_Y + HEADER_H + idx * ROW_H;
          const exam = examMap.get(level);
          const leftGrade = exam?.left ?? -1;
          const rightGrade = exam?.right ?? -1;
          const isHovered = hoveredLevel === level;

          return (
            <g
              key={level}
              onClick={() => onLevelClick?.(level)}
              onMouseEnter={() => setHoveredLevel(level)}
              onMouseLeave={() => setHoveredLevel(null)}
              style={{ cursor: onLevelClick ? 'pointer' : 'default' }}
              role={onLevelClick ? 'button' : undefined}
              tabIndex={onLevelClick ? 0 : undefined}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && onLevelClick) onLevelClick(level);
              }}
            >
              {/* Row background */}
              <rect
                x={10} y={y}
                width={SVG_W - 20} height={ROW_H}
                rx={4}
                fill={isHovered ? '#F0F9FF' : idx % 2 === 0 ? '#FAFAFA' : 'white'}
                stroke={isHovered ? '#93C5FD' : 'transparent'}
                strokeWidth={0.8}
              />

              {/* Left grade */}
              {leftGrade >= 0 && (
                <>
                  <rect
                    x={COL_LEFT_X - GRADE_R} y={y + (ROW_H - 20) / 2}
                    width={GRADE_R * 2} height={20} rx={4}
                    fill={gradeColor(leftGrade)} opacity={0.2}
                  />
                  <text x={COL_LEFT_X} y={y + ROW_H / 2 + 4} textAnchor="middle" fontSize={10} fill={gradeColor(leftGrade)} fontWeight={600}>
                    {leftGrade}
                  </text>
                </>
              )}
              {leftGrade < 0 && (
                <text x={COL_LEFT_X} y={y + ROW_H / 2 + 4} textAnchor="middle" fontSize={9} fill="#D1D5DB">-</text>
              )}

              {/* Level label */}
              <text x={COL_LEVEL_X} y={y + ROW_H / 2 + 4} textAnchor="middle" fontSize={10} fill="#374151" fontWeight={600}>
                {level}
              </text>

              {/* Muscle group */}
              <text x={COL_MUSCLE_X} y={y + ROW_H / 2 + 4} textAnchor="start" fontSize={8} fill="#6B7280">
                {tAttr(MUSCLE_GROUPS[level])}
              </text>

              {/* Right grade */}
              {rightGrade >= 0 && (
                <>
                  <rect
                    x={COL_RIGHT_X - GRADE_R} y={y + (ROW_H - 20) / 2}
                    width={GRADE_R * 2} height={20} rx={4}
                    fill={gradeColor(rightGrade)} opacity={0.2}
                  />
                  <text x={COL_RIGHT_X} y={y + ROW_H / 2 + 4} textAnchor="middle" fontSize={10} fill={gradeColor(rightGrade)} fontWeight={600}>
                    {rightGrade}
                  </text>
                </>
              )}
              {rightGrade < 0 && (
                <text x={COL_RIGHT_X} y={y + ROW_H / 2 + 4} textAnchor="middle" fontSize={9} fill="#D1D5DB">-</text>
              )}
            </g>
          );
        })}

        {/* Legend */}
        {[5, 4, 3, 2, 1, 0].map((g, i) => (
          <g key={g}>
            <rect
              x={10 + i * 48} y={SVG_H - 26}
              width={10} height={10} rx={2}
              fill={gradeColor(g)} opacity={0.4}
            />
            <text x={24 + i * 48} y={SVG_H - 17} fontSize={7} fill="#6B7280">
              {g}={tAttr(gradeLabel(g))}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
