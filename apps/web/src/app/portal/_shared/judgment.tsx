'use client';

import { DIAGNOSTIC_CONCLUSION_CODES, isCriticalFlag, isHighFlag, isLowFlag, isAbnormalFlag } from '@hospital-run/shared';
import { PT } from './PT';

/**
 * 🔴 (2026-10-19 포털 세련화 A2) 환자 화면 판정 단어 정본 — 검사 결과·검진·기초검사가 각자 "이상"·"위험"·"높음"·"🔴 위험"을 썼다(R4).
 *    판정 **근거**는 각 원장의 정본(검사 flag = shared lab-flags 술어 · 검진 finding · 기초검사 결론 = shared DIAGNOSTIC_CONCLUSIONS)이고,
 *    이 파일은 그것을 환자가 읽는 **같은 단어·같은 색**으로 옮기기만 한다. 모르는 값은 '판정 미상'(정상으로 접지 않는다).
 */
export const JUDGMENT_LABEL = {
  NORMAL: '정상',
  BORDERLINE: '경계',
  ABNORMAL: '이상',
  HIGH: '높음',
  LOW: '낮음',
  CRITICAL_HIGH: '매우 높음',
  CRITICAL_LOW: '매우 낮음',
  CRITICAL: '위급',
  UNKNOWN: '판정 미상',
} as const;
export type Judgment = keyof typeof JUDGMENT_LABEL;

const TONE: Record<Judgment, string> = {
  NORMAL: 'text-green-600',
  BORDERLINE: 'text-amber-600',
  ABNORMAL: 'text-amber-600',
  HIGH: 'text-red-600 font-semibold',
  LOW: 'text-blue-600 font-semibold',
  CRITICAL_HIGH: 'text-red-700 font-bold',
  CRITICAL_LOW: 'text-red-700 font-bold',
  CRITICAL: 'text-red-700 font-bold',
  UNKNOWN: 'text-gray-400',
};
export const isCriticalJudgment = (j: Judgment) => j === 'CRITICAL' || j === 'CRITICAL_HIGH' || j === 'CRITICAL_LOW';

/** 검사 flag(N/H/L/HH/LL/A/AA …) → 판정. 정상 flag 는 NORMAL, 비어 있으면 null(판정 칸을 비운다 — 종전과 같다) */
export function labFlagJudgment(flag?: string | null): Judgment | null {
  if (!flag) return null;
  const critical = isCriticalFlag(flag);
  if (isHighFlag(flag)) return critical ? 'CRITICAL_HIGH' : 'HIGH';
  if (isLowFlag(flag)) return critical ? 'CRITICAL_LOW' : 'LOW';
  if (critical) return 'CRITICAL';
  return isAbnormalFlag(flag) ? 'ABNORMAL' : 'NORMAL';
}

/** 검진 항목 finding(NORMAL/ABNORMAL/CRITICAL) → 판정 */
export function findingJudgment(finding?: string | null): Judgment {
  return finding === 'NORMAL' ? 'NORMAL' : finding === 'ABNORMAL' ? 'ABNORMAL' : finding === 'CRITICAL' ? 'CRITICAL' : 'UNKNOWN';
}

/** 기초검사 결론(정본 NORMAL/BORDERLINE/ABNORMAL) → 판정 */
export function conclusionJudgment(code?: string | null): Judgment {
  return code && DIAGNOSTIC_CONCLUSION_CODES.includes(code) ? (code as Judgment) : 'UNKNOWN';
}

export function JudgmentText({ j }: { j: Judgment }) {
  return (
    <span className={TONE[j]} data-judgment={j}>
      {isCriticalJudgment(j) && <span aria-hidden>🔴 </span>}
      <PT k={JUDGMENT_LABEL[j]} />
    </span>
  );
}
