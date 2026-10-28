/**
 * 수술 안전(IPSG.4 — 정확한 환자·부위·술식) 판정 정본.
 *
 * 🔴 왜 공용 파일인가: 같은 사실("이 수술은 체크리스트가 미완료다", "좌우가 필요한데 비었다")을
 *    ① 안전 게이트 관제(`safety-gate.service`) ② QI 미완료 워크리스트(`qi/surgery-safety.service`)
 *    ③ 일일 탐지 크론이 각각 다시 계산하면 **정본이 셋**이 된다(P12). 규칙은 여기 하나뿐이고
 *    각 호출부는 자기 쿼리로 행을 읽어 이 함수에 넣는다.
 *
 * 🔴 모르는 것을 아는 것처럼 말하지 않는다 — `lateralityRequired` 는 `null`(판정 근거 없음)을 낼 수 있고,
 *    체크리스트 행 자체가 없는 것과 "행은 있는데 단계가 비었다"는 **다른 사실**이라 따로 낸다.
 */
import { isLateralityRequired, lateralitySpecified, type LateralityRequirement } from './laterality-keywords';

export type ChecklistPhase = 'SIGN_IN' | 'TIME_OUT' | 'SIGN_OUT';

export const CHECKLIST_PHASE_LABEL: Record<ChecklistPhase, string> = {
  SIGN_IN: 'Sign-In(마취 유도 전)',
  TIME_OUT: 'Time-Out(피부 절개 전)',
  SIGN_OUT: 'Sign-Out(환자 퇴실 전)',
};

export interface SurgerySafetyInput {
  id: string;
  procedureName: string;
  bodySite: string | null;
  laterality: string | null;
  status: string;
  scheduledAt: Date;
}

export interface ChecklistInput {
  surgeryId: string;
  signInCompletedAt: Date | null;
  timeOutCompletedAt: Date | null;
  signOutCompletedAt: Date | null;
  countStatus: string | null;
  countDiscrepancyNote: string | null;
}

export interface SurgerySafetyFinding {
  surgeryId: string;
  procedureName: string;
  bodySite: string | null;
  laterality: string | null;
  status: string;
  scheduledAt: Date;
  /** 체크리스트 **행 자체**가 있는가 — 없으면 세 단계 전부 미완료이자 '기록이 시작된 적 없음' */
  checklistPresent: boolean;
  missingPhases: ChecklistPhase[];
  /** true=좌우 필수 · false=좌우 무관 · null=판정 근거 없음(술식명·부위 모두 공백) */
  lateralityRequired: LateralityRequirement;
  /** 좌우가 필요한데 특정되지 않음(null 또는 NA) — 오부위수술 직접 위험 */
  lateralityGap: boolean;
  /** 계수 불일치 미해소(잔류이물 위험) */
  countUnresolved: boolean;
}

export function evaluateSurgerySafety(
  s: SurgerySafetyInput,
  c: ChecklistInput | undefined | null,
  lateralityKeywords: string[],
): SurgerySafetyFinding {
  const missingPhases: ChecklistPhase[] = [];
  if (!c?.signInCompletedAt) missingPhases.push('SIGN_IN');
  if (!c?.timeOutCompletedAt) missingPhases.push('TIME_OUT');
  if (!c?.signOutCompletedAt) missingPhases.push('SIGN_OUT');

  const lateralityRequired = isLateralityRequired(s.procedureName, s.bodySite, lateralityKeywords);
  return {
    surgeryId: s.id,
    procedureName: s.procedureName,
    bodySite: s.bodySite,
    laterality: s.laterality,
    status: s.status,
    scheduledAt: s.scheduledAt,
    checklistPresent: !!c,
    missingPhases,
    lateralityRequired,
    lateralityGap: lateralityRequired === true && !lateralitySpecified(s.laterality),
    countUnresolved: c?.countStatus === 'MISMATCH' && !c?.countDiscrepancyNote,
  };
}

/** 이행 완료 = 세 단계 모두 시각이 찍힘. 부분 이행은 '완료'가 아니다. */
export function isChecklistComplete(f: SurgerySafetyFinding): boolean {
  return f.missingPhases.length === 0;
}
