'use client';

import React from 'react';
import { labTermText, portalLabTermText } from '@hospital-run/shared';
import { useTermLang } from '@/stores/term-lang-store';

/**
 * 검사 항목명 표시 정본 — 기획 medical-term-display-toggle.plan.md P1.
 * 저장된 testName 은 불변이고 표시만 정돈한다(병기·모드).
 */

/** 직원 화면 — 사용자 용어 모드를 따른다(KO/BOTH=`EN (한글)` 병기·EN=영문 정돈) */
export function LabTerm({ name, className }: { name?: string | null; className?: string }) {
  const mode = useTermLang();
  const t = (name ?? '').trim();
  if (!t) return <span className={className}>-</span>;
  return <span className={className}>{labTermText(t, mode)}</span>;
}

/** 환자 포털 — 일반인 대상이라 항상 한글 우선(토글 없음). 모르면 원문 그대로 */
export function PortalLabTerm({ name, className }: { name?: string | null; className?: string }) {
  const t = (name ?? '').trim();
  if (!t) return <span className={className}>-</span>;
  return <span className={className}>{portalLabTermText(t)}</span>;
}
