'use client';

import React from 'react';
import { UnitText } from './display';
import { T } from '@/components/ui/i18n-text';

/* ── Color palette ───────────────────────────────────────────────────────────── */

const COLOR_MAP: Record<string, { bg: string; border: string; text: string }> = {
  blue:    { bg: 'bg-blue-50',    border: 'border-blue-100',   text: 'text-blue-700' },
  emerald: { bg: 'bg-emerald-50', border: 'border-emerald-100', text: 'text-emerald-700' },
  green:   { bg: 'bg-emerald-50', border: 'border-emerald-100', text: 'text-emerald-700' },
  violet:  { bg: 'bg-violet-50',  border: 'border-violet-100',  text: 'text-violet-700' },
  purple:  { bg: 'bg-purple-50',  border: 'border-purple-100',  text: 'text-purple-700' },
  amber:   { bg: 'bg-amber-50',   border: 'border-amber-100',   text: 'text-amber-700' },
  rose:    { bg: 'bg-rose-50',    border: 'border-rose-100',     text: 'text-rose-700' },
  red:     { bg: 'bg-red-50',     border: 'border-red-100',      text: 'text-red-700' },
  indigo:  { bg: 'bg-indigo-50',  border: 'border-indigo-100',   text: 'text-indigo-700' },
  orange:  { bg: 'bg-orange-50',  border: 'border-orange-100',   text: 'text-orange-700' },
  cyan:    { bg: 'bg-cyan-50',    border: 'border-cyan-100',     text: 'text-cyan-700' },
  slate:   { bg: 'bg-slate-50',   border: 'border-slate-100',    text: 'text-slate-700' },
  gray:    { bg: 'bg-gray-50',    border: 'border-gray-100',     text: 'text-gray-700' },
};

const DEFAULT_COLOR = COLOR_MAP.slate;

/* ── Props ───────────────────────────────────────────────────────────────────── */

export interface StatCardProps {
  /** 카드 제목 (label / title) */
  title: string;
  /** 표시 값 */
  /** 금액처럼 단위를 작게 렌더해야 하면 <Money>·<MoneyText> 를 넘긴다 */
  value: React.ReactNode;
  /** 보조 설명 텍스트 */
  subtitle?: string;
  /** 아이콘 (ReactNode) */
  icon?: React.ReactNode;
  /**
   * 색상 키 (blue, emerald, red 등) 또는
   * Tailwind 클래스 문자열 (예: "bg-gray-50 border-gray-200 text-gray-700")
   */
  color?: string;
  /** 추가 className */
  className?: string;
}

/* ── Component ───────────────────────────────────────────────────────────────── */

export default function StatCard({
  title,
  value,
  subtitle,
  icon,
  color = 'slate',
  className = '',
}: StatCardProps) {
  // color가 Tailwind 클래스 문자열인 경우 (공백 포함) 그대로 사용
  const isRawClass = color.includes(' ');
  const c = isRawClass ? null : (COLOR_MAP[color] ?? DEFAULT_COLOR);

  /**
   * 🔴 **grid 는 같은 줄 카드를 가장 높은 것에 맞춰 늘린다**(2026-09-03).
   *    `subtitle` 이 있는 카드가 한 장만 섞여도 나머지는 내용이 위로 쏠려 아래가 비어 보였다.
   *    (상황판 KPI 띠에서 같은 증상을 고치고, 이 공용 카드를 쓰는 26파일 113곳으로 넓혔다)
   *    `flex flex-col justify-center` 로 남는 높이를 위아래로 나눈다.
   */
  const containerCls = c
    ? `flex flex-col justify-center rounded-2xl border px-4 py-3 ${c.bg} ${c.border} ${c.text}`
    : `flex flex-col justify-center rounded-xl border px-4 py-3 ${color}`;

  return (
    <div className={`${containerCls} ${className}`}>
      {icon && (
        <div className="mb-2">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center opacity-80">
            {icon}
          </div>
        </div>
      )}
      <p className="overflow-x-auto whitespace-nowrap text-xl font-bold leading-tight">
        {/* 값+단위 — 단위는 0.5em(숫자가 먼저 읽히게). 이 컴포넌트가 100곳 넘게 쓰여 여기 한 곳이 전역 규칙이 된다 */}
        {/* 🔴 값은 **한 줄 고정**. 긴 값(금액 8자리·`산출 불가 (사유)`)이 접히면 그 카드만 높아져
            같은 줄 전체가 흔들린다. 넘치면 줄바꿈이 아니라 가로 스크롤로 — 숫자를 조용히 자르지 않는다. */}
        {typeof value === 'number' ? value.toLocaleString() : typeof value === 'string' ? <UnitText text={value} /> : value}
      </p>
      {/* 🔴 라벨·부제는 문자열 prop 이라 여기서 감싼다 — 이 카드가 26파일 113곳에서 쓰여
          한 곳이 전역 규칙이 된다(P1-D 문자열 prop 규약: 히트면 번역·미스면 원문+티). */}
      <p className="text-[11px] font-medium opacity-70"><T k={title} /></p>
      {subtitle && <p className="text-[11px] opacity-60 mt-0.5"><T k={subtitle} /></p>}
    </div>
  );
}
