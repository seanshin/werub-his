/**
 * 의료용어 한/영 표시 모드 어휘 정본 — 기획 `medical-term-display-toggle.plan.md`.
 *
 * 🔴 표시 선호는 **표시만** 바꾼다 — 저장 값·검색·집계·인쇄/대외 문서는 불변.
 * 🔴 기본은 KO(현행 유지) — 기본값이 동작을 바꾸지 않는다.
 * 🔴 EN 모드에서 영문명이 없으면 기계번역·로마자 변환으로 지어내지 않는다 —
 *    있는 언어를 그대로 보이고 "영문명 미등록"을 밝힌다.
 */

export const TERM_LANG_MODES = ['KO', 'EN', 'BOTH'] as const;
export type TermLangMode = (typeof TERM_LANG_MODES)[number];

export const TERM_LANG_DEFAULT: TermLangMode = 'KO';

export const TERM_LANG_LABEL: Record<TermLangMode, string> = {
  KO: '한글',
  EN: 'EN',
  BOTH: '병기',
};

export const TERM_LANG_DESC: Record<TermLangMode, string> = {
  KO: '의료용어를 한글로 표시합니다(영문명만 있으면 영문 그대로).',
  EN: '의료용어를 영문으로 표시합니다. 영문명이 없는 항목은 한글 그대로 + 미등록 표시 — 번역을 지어내지 않습니다.',
  BOTH: '한글 (영문) 병기로 표시합니다.',
};

/** EN 모드에서 영문명이 없을 때 화면이 그 사실을 말하는 문구 정본 */
export const TERM_EN_UNREGISTERED = '영문명 미등록';
