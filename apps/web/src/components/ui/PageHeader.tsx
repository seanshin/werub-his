'use client';

import React from 'react';

import { T } from '@/components/ui/i18n-text';

/* ── Props ───────────────────────────────────────────────────────────────────── */

export interface PageHeaderProps {
  /** 페이지 제목 */
  title: string;
  /** 우측 액션 영역 (버튼 등) */
  actions?: React.ReactNode;
  /** 추가 className */
  className?: string;
}

/* ── Component ───────────────────────────────────────────────────────────────── */

export default function PageHeader({ title, actions, className = '' }: PageHeaderProps) {
  return (
    <div className={`flex items-center justify-between mb-6 ${className}`}>
      {/* 문자열 prop 렌더 — 카탈로그 히트 시 번역, 미스면 한국어 원문 + 미등록 티(P1-D 규약) */}
      <h2 className="text-2xl font-bold text-gray-900"><T k={title} /></h2>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
