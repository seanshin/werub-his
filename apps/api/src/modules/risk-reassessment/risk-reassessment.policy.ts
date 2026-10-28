/**
 * 낙상/욕창 재평가 — 임계값·주기 정본(단일 소스).
 *
 * 🔴 원 결함(P12 정본이 둘): 재평가 주기가 FE(admin/risk-reassessment/page.tsx `getRiskInterval`)와
 *    BE(risk-reassessment.service.ts) 양쪽에 있었고 값이 서로 **반대**였다.
 *      - FE: 고위험 4h / 중위험 8h / 저위험 24h
 *      - BE: 고위험 2h / 중위험 4h / 저위험 8h   ← 실제 저장되는 값(FE 가 보낸 suggestedInterval 은 무시됨)
 *    간호사가 화면에서 본 주기와 서버가 잡은 다음 평가 시각이 달랐다.
 *
 * 🔴 값 확정 근거: Morse 원저·NPIAP/AHRQ·KOIHA 인증기준 어디에도 "재평가 주기 몇 시간"은 없다
 *    (전부 '기관 규정'에 위임). 근거로 한쪽을 고를 수 없으므로
 *      (a) 정본을 서버 한 곳(이 파일)으로 모으고,
 *      (b) 값은 기존 두 정본 중 **더 자주 평가하는 쪽**(환자안전 보수적)을 잠정 채택했다.
 *    → FALL_RISK 는 BE 값(2/4/8), PRESSURE_ULCER 는 FE 값(4/8/24)이 각각 더 짧다.
 *    최종 확정은 **환자안전위원회 소관**이며, 확정되면 이 표 한 곳만 고치면 된다.
 *    (욕창 저위험 24h = 급성기 매일 재평가 권고와는 일치한다 — AHRQ Preventing Pressure Ulcers in Hospitals)
 */

import { BRADEN_RISK_BOUNDS, MORSE_RISK_BOUNDS, RISK_REASSESS_INTERVAL_DEFAULT, type RiskReassessIntervals } from '@hospital-run/shared';

export type RiskLevel = 'HIGH' | 'MODERATE' | 'LOW';

/** 평가 유형 — DB `risk_reassessment_schedules.assessment_type` 값 정본 */
export const ASSESSMENT_TYPES = ['FALL_RISK', 'PRESSURE_ULCER'] as const;
export type AssessmentType = (typeof ASSESSMENT_TYPES)[number];

/** 유형별 기본 도구 */
export const DEFAULT_TOOL_BY_TYPE: Record<AssessmentType, string> = {
  FALL_RISK: 'MORSE',
  PRESSURE_ULCER: 'BRADEN',
};

/**
 * 유형별 재평가 주기(시간). 🔴 위원회 확정 전 잠정값 — 위 주석 참조.
 * 이 표 밖에서 주기를 계산하지 말 것(FE 포함 — FE 는 서버가 돌려준 intervalHours 만 표시한다).
 */
/**
 * 재평가 주기 — 🔴 원내 규정(설정 `nursing.riskReassess.intervalHours` · 간호 원내 규정 화면 · 2026-10-27).
 * 이 상수는 **코드 기본값**(shared `RISK_REASSESS_INTERVAL_DEFAULT`) — 규정이 비면 이 값으로 일정을 계속 만든다.
 * 호출부는 읽기 정본 `readRiskReassessIntervals` 로 표를 받아 넘긴다.
 */
export const REASSESSMENT_INTERVAL_HOURS: RiskReassessIntervals = RISK_REASSESS_INTERVAL_DEFAULT;

/** 첫 일정(점수 없음) 주기 = 그 유형의 저위험 주기 */
export function initialIntervalHours(assessmentType: AssessmentType, table: RiskReassessIntervals = REASSESSMENT_INTERVAL_HOURS): number {
  return table[assessmentType].LOW;
}

export function isAssessmentType(v: unknown): v is AssessmentType {
  return typeof v === 'string' && (ASSESSMENT_TYPES as readonly string[]).includes(v);
}

/**
 * 점수 → 위험등급. 서버가 유일한 산출 주체(자가입력 riskLevel 신뢰 금지 — IPSG.6 집계 오염 방지).
 *  - FALL_RISK / Morse Fall Scale: ≥45 고위험, 25–44 중위험, <25 저위험
 *    (patient-safety.deriveFallRiskLevel 과 동일 임계 — 두 곳이 갈라지면 낙상 통계가 갈라진다)
 *  - PRESSURE_ULCER / Braden Scale: ≤12 고위험, 13–14 중위험, ≥15 저위험 (Braden & Bergstrom)
 *    🔴 원 결함: BE 가 PRESSURE_ULCER 는 재산정을 아예 안 해서 제출값을 그대로 저장했고,
 *       주기도 24h 로 고정이라 **욕창 고위험 환자도 24시간마다** 평가로 잡혔다.
 */
export function deriveRiskLevel(assessmentType: AssessmentType, score: number): RiskLevel {
  if (assessmentType === 'FALL_RISK') {
    // 경계 = shared `MORSE_RISK_BOUNDS`(화면 `morseRiskLevel` 과 같은 상수 — 2026-10-26 사본 회수)
    return score >= MORSE_RISK_BOUNDS.highMin ? 'HIGH' : score >= MORSE_RISK_BOUNDS.moderateMin ? 'MODERATE' : 'LOW';
  }
  // PRESSURE_ULCER — Braden 은 점수가 낮을수록 고위험(역방향)
  //    경계는 shared `bradenRiskLevel`(이력 화면)과 같다 — 6~23 전 구간 일치는 테스트가 대조한다
  return score <= BRADEN_RISK_BOUNDS.highMax ? 'HIGH' : score <= BRADEN_RISK_BOUNDS.moderateMax ? 'MODERATE' : 'LOW';
}

/** 위험등급 → 다음 재평가 주기(시간) */
export function intervalHoursFor(assessmentType: AssessmentType, riskLevel: RiskLevel, table: RiskReassessIntervals = REASSESSMENT_INTERVAL_HOURS): number {
  return table[assessmentType][riskLevel];
}

/**
 * 간호초기평가 저장 때 재평가 일정 자동 생성 — 원내 결정(설정 `nursing.reassessment.autoScheduleOnAdmission` · 기본 false · 2026-10-10).
 * 🔴 입원 순간(`admission.created` · 설정 `risk.reassessment.autoCreate`)은 점수가 없어 저위험 주기로 시작한다 —
 *    점수가 처음 생기는 지점은 간호초기평가 저장이므로, 이 결정은 거기서 **점수로 등급·주기를 정해** 일정을 연다.
 *    일정의 시작점은 평가 시각(저장 시각이 아니다) · 마지막 점수·등급·평가자를 그 초기평가로 채운다.
 */
export const AUTO_SCHEDULE_ON_ASSESSMENT_KEY = 'nursing.reassessment.autoScheduleOnAdmission';

/** 유형별 유효 점수 범위 — 범위 밖 점수로는 등급·주기를 지어내지 않는다(일정을 만들지 않는다) */
export const SCORE_RANGE: Record<AssessmentType, readonly [number, number]> = {
  FALL_RISK: [0, 125],
  PRESSURE_ULCER: [6, 23],
};

/** 초기평가 점수 → 재평가 일정 값. 점수가 없거나 범위 밖이면 null(만들지 않는다). */
export function scheduleFromInitialScore(assessmentType: AssessmentType, score: number | null | undefined, assessedAt: Date, table: RiskReassessIntervals = REASSESSMENT_INTERVAL_HOURS):
  { lastScore: number; lastRiskLevel: RiskLevel; intervalHours: number; nextDueAt: Date } | null {
  const [lo, hi] = SCORE_RANGE[assessmentType];
  if (typeof score !== 'number' || !Number.isInteger(score) || score < lo || score > hi) return null;
  const lastRiskLevel = deriveRiskLevel(assessmentType, score);
  const intervalHours = intervalHoursFor(assessmentType, lastRiskLevel, table);
  return { lastScore: score, lastRiskLevel, intervalHours, nextDueAt: new Date(assessedAt.getTime() + intervalHours * 3_600_000) };
}
