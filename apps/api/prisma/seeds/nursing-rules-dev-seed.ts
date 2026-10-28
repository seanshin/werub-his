/**
 * 간호 원내 규정 — **개발 시드 값**(사용자 지시 2026-10-27 "원내 규정도 시드 형태로 UI로 구현").
 *
 * 🔴 원내 규정이 아니다 — seed.ts 가 설정 행 label 에 `개발 시드(DEV-SEED)` 표식을 달아 넣는다.
 *    서버·화면은 출처를 SEED("개발 시드 — 원내 규정 아님")로 말하고, 사람 몫 H11·H12 는 미충족으로 남는다.
 *    관리자가 간호 원내 규정 화면(3418)에서 저장하면(같은 값이라도) 표식이 사라져 원내 설정이 된다.
 * 🔴 없을 때만 넣는다 — 사람이 저장한 값을 덮지 않는다 · 시드 진입점 REAL 모드 가드가 막는다.
 * 선택 원칙 — 데모가 규정이 있는 모양으로 돌게 하되 권한·자동 동작을 넓히지 않는다(인수 방식은 현행 그대로).
 * 값은 shared nursing-rules 정본 검사를 통과해야 한다(가드 test/seed/nursing-rules-dev-seed.spec.ts).
 */
export interface NursingRuleDevSeed { key: string; value: unknown; why: string }

export const NURSING_RULE_DEV_SEEDS: NursingRuleDevSeed[] = [
  { key: 'nursing.pain.reassessRule', value: { thresholdScore: 4, withinMinutes: 60, afterAnalgesicMinutes: 60 }, why: '중등도 이상 통증(NRS 4 이상)·중재 뒤 1시간 안 재평가 — 흔한 원내 규정 모양(개발 시드 · 주사·경구 구분 없이 60분)' },
  { key: 'nursing.handoff.ackTakeOverMode', value: 'OFFER_BOTH', why: '현행 그대로 — 인수 확인과 담당 인수를 인수 간호사가 고른다(자동으로 담당을 옮기지 않는다)' },
  { key: 'nursing.riskReassess.intervalHours', value: { FALL_RISK: { HIGH: 2, MODERATE: 4, LOW: 8 }, PRESSURE_ULCER: { HIGH: 4, MODERATE: 8, LOW: 24 } }, why: '현행 코드 기본값과 같은 주기 — 재평가 간격을 시드가 넓히거나 좁히지 않는다' },
  { key: 'nursing.restraint.checkIntervalMinutes', value: 120, why: '현행 코드 기본값과 같은 2시간 — 감시 간격을 시드가 넓히거나 좁히지 않는다' },
];
