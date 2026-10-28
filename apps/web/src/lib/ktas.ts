import { KTAS_LEVEL_LABEL } from '@hospital-run/shared';

/**
 * KTAS 표시 정본(웹) — 라벨은 shared, 색은 여기 한 곳(D7·2026-08-05).
 * Tailwind 스캔이 웹 소스 기준이라 클래스 문자열은 웹 모듈에 둔다.
 * 기존 /emergency(red/yellow/green/blue)와 /emergency-board(rose/amber/emerald/sky) 2벌을
 * board 계열로 통일.
 */
export { KTAS_LEVEL_LABEL };

/** 진한 배경(레벨 칩·베드 카드 강조) */
export const KTAS_SOLID: Record<string, string> = {
  LEVEL_1: 'bg-rose-600 text-white',
  LEVEL_2: 'bg-orange-500 text-white',
  LEVEL_3: 'bg-amber-400 text-gray-900',
  LEVEL_4: 'bg-emerald-500 text-white',
  LEVEL_5: 'bg-sky-500 text-white',
};

/** 옅은 배경(목록 배지) */
export const KTAS_BADGE: Record<string, string> = {
  LEVEL_1: 'bg-rose-100 text-rose-700',
  LEVEL_2: 'bg-orange-100 text-orange-700',
  LEVEL_3: 'bg-amber-100 text-amber-700',
  LEVEL_4: 'bg-emerald-100 text-emerald-700',
  LEVEL_5: 'bg-sky-100 text-sky-700',
};

/** 베드 카드 좌측 바/테두리 */
export const KTAS_BORDER: Record<string, string> = {
  LEVEL_1: 'border-rose-500',
  LEVEL_2: 'border-orange-400',
  LEVEL_3: 'border-amber-400',
  LEVEL_4: 'border-emerald-400',
  LEVEL_5: 'border-sky-400',
};
