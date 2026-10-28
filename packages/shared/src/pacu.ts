/**
 * 회복실(PACU) 어휘 정본 — 2026-10-07 회복실 상세화.
 * 서버 DTO 검증과 화면 라벨이 같은 목록을 쓴다(한쪽에만 적으면 갈라진다).
 */

/** 점수 평가 시점 — 첫 평가는 서버가 ADMIT 로 · 퇴실 직전 평가는 화면이 DISCHARGE 로 고른다 */
export const PACU_SCORE_PHASES = ['ADMIT', 'INTERVAL', 'DISCHARGE'] as const;
export type PacuScorePhase = (typeof PACU_SCORE_PHASES)[number];
export const PACU_SCORE_PHASE_LABEL: Record<PacuScorePhase, string> = { ADMIT: '입실', INTERVAL: '중간', DISCHARGE: '퇴실 전' };

export const PACU_SCORE_KINDS = ['ALDRETE', 'PADSS', 'PONV'] as const;
export type PacuScoreKind = (typeof PACU_SCORE_KINDS)[number];

/** 퇴실 지연 사유 — 기준 충족 뒤 나가지 못한 이유(임상 불안정은 기준 미달이라 별개) */
export const PACU_DELAY_REASONS = ['NO_BED', 'TRANSPORT', 'AWAITING_DOCTOR', 'AWAITING_RESULT', 'CLINICAL', 'FAMILY', 'OTHER'] as const;
export type PacuDelayReason = (typeof PACU_DELAY_REASONS)[number];
export const PACU_DELAY_REASON_LABEL: Record<PacuDelayReason, string> = {
  NO_BED: '병상 없음',
  TRANSPORT: '이송 대기',
  AWAITING_DOCTOR: '의사 확인 대기',
  AWAITING_RESULT: '검사 결과 대기',
  CLINICAL: '임상 상태(관찰 연장)',
  FAMILY: '보호자 대기',
  OTHER: '기타',
};

/** 회복실 섭취·배설 경로 */
export const PACU_IO_ROUTES = { IN: ['IV', 'ORAL', 'BLOOD', 'OTHER'], OUT: ['URINE', 'DRAIN', 'EMESIS', 'BLOOD_LOSS', 'OTHER'] } as const;
export const PACU_IO_ROUTE_LABEL: Record<string, string> = {
  IV: '수액', ORAL: '경구', BLOOD: '수혈', URINE: '소변', DRAIN: '배액', EMESIS: '구토', BLOOD_LOSS: '출혈', OTHER: '기타',
};

/** RASS(Richmond Agitation-Sedation Scale) −5 ~ +4 */
export const RASS_MIN = -5;
export const RASS_MAX = 4;
export const RASS_LABEL: Record<number, string> = {
  4: '+4 공격적', 3: '+3 매우 초조', 2: '+2 초조', 1: '+1 불안', 0: '0 명료·차분',
  [-1]: '-1 졸림', [-2]: '-2 가벼운 진정', [-3]: '-3 중등도 진정', [-4]: '-4 깊은 진정', [-5]: '-5 무반응',
};

/** 점수 이력 한 칸(서버 덧붙이기 원장 · 화면 추이) */
export interface PacuScoreEntry { kind: PacuScoreKind; score: number; detail?: Record<string, number> | null; phase: PacuScorePhase; at: string; by: string | null }

/** 섭취·배설 합 — 기록된 것만(없으면 null · 0 으로 접지 않는다) · 수지는 양쪽 다 기록됐을 때만 */
export function pacuIoTotals(entries: { kind: string; ml: number }[] | null | undefined): { inMl: number | null; outMl: number | null; balance: number | null } {
  const list = Array.isArray(entries) ? entries : [];
  const ins = list.filter((e) => e.kind === 'IN');
  const outs = list.filter((e) => e.kind === 'OUT');
  const inMl = ins.length ? ins.reduce((a, e) => a + e.ml, 0) : null;
  const outMl = outs.length ? outs.reduce((a, e) => a + e.ml, 0) : null;
  // 한쪽만 기록됐으면 수지를 말하지 않는다(없는 쪽을 0 으로 보면 거짓 양/음수가 된다)
  return { inMl, outMl, balance: inMl != null && outMl != null ? inMl - outMl : null };
}
