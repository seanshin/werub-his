/**
 * Braden Scale(욕창 위험) 정본 — 하위 6항목·점수 범위·위험 등급·기록 점검(2026-10-10).
 *
 * 🔴 종전엔 Braden 이 세 곳에 따로 있었다 — 간호 초기평가(총점 칸만)·재평가 일정(마지막 점수만 덮어씀 · 하위 항목 버림)·
 *    임상 도구 결과(하위 항목 선택 인덱스). 등급 경계도 화면마다 달랐다(4단·5단).
 *  · 등급 경계는 서버 재평가 정본(`risk-reassessment.policy` — Braden & Bergstrom ≤12 고 · 13–14 중 · ≥15 저)과 같다 — 그 정책이 이 함수를 부른다.
 *  · 하위 항목이 하나라도 없으면 총점을 만들지 않는다(부분 합은 Braden 점수가 아니다 — 3항목 9점이 "매우 높음"으로 보인다).
 *  · 점검은 판정이 아니라 "확인 필요" 표시다 — 기록을 고치지 않는다.
 */

export const BRADEN_ITEMS = [
  { key: 'sensory', label: '감각 인지', max: 4, aliases: ['sensoryPerception'] },
  { key: 'moisture', label: '습기', max: 4, aliases: [] },
  { key: 'activity', label: '활동', max: 4, aliases: [] },
  { key: 'mobility', label: '이동', max: 4, aliases: [] },
  { key: 'nutrition', label: '영양', max: 4, aliases: [] },
  { key: 'friction', label: '마찰·전단', max: 3, aliases: ['frictionShear'] },
] as const;

export type BradenItemKey = (typeof BRADEN_ITEMS)[number]['key'];
export type BradenSubscores = Record<BradenItemKey, number>;
export type BradenRiskLevel = 'HIGH' | 'MODERATE' | 'LOW';

/** 재평가에서 남긴 Braden 이력 행의 출처 표식(임상 도구 결과 원장 `used_tool_version`) */
export const BRADEN_REASSESSMENT_TOOL_VERSION = 'risk-reassessment-v1';

/** 간호초기평가에서 하위 항목으로 받은 Braden 행의 출처 표식(같은 원장 · `inputs.nursingAssessmentId` 로 초기평가와 잇는다 · 2026-10-10) */
export const BRADEN_INITIAL_TOOL_VERSION = 'nursing-initial-v1'; // 원장 칸 VARCHAR(20)

/**
 * 간호초기평가 Braden 입력 방식 — 원내 결정(설정 `nursing.initialAssessment.bradenInput`).
 *  · TOTAL(기본·현행) — 총점 한 칸 · SUBSCORES — 6항목을 골라 총점은 합(하위 항목이 이력에 남는다)
 *  · 모르는 값·미설정은 TOTAL 로 읽는다(현행을 바꾸지 않는다)
 */
export const BRADEN_INPUT_CONFIG_KEY = 'nursing.initialAssessment.bradenInput';
export type BradenInputMode = 'TOTAL' | 'SUBSCORES';
export function bradenInputModeOf(v: unknown): BradenInputMode {
  return v === 'SUBSCORES' ? 'SUBSCORES' : 'TOTAL';
}

export const BRADEN_TOTAL_RANGE = { min: 6, max: 23 } as const;
/** 등급 상한 — ≤12 고위험 · 13~14 중위험 · ≥15 저위험(서버 재평가 정책도 이 상수를 쓴다) */
export const BRADEN_RISK_BOUNDS = { highMax: 12, moderateMax: 14 } as const;

export const BRADEN_RISK_LABEL: Record<BradenRiskLevel, string> = { HIGH: '고위험', MODERATE: '중위험', LOW: '저위험' };

/** 총점 → 등급. 범위 밖·정수 아님은 null(등급을 지어내지 않는다). */
export function bradenRiskLevel(total: number | null | undefined): BradenRiskLevel | null {
  if (typeof total !== 'number' || !Number.isInteger(total) || total < BRADEN_TOTAL_RANGE.min || total > BRADEN_TOTAL_RANGE.max) return null;
  return total <= BRADEN_RISK_BOUNDS.highMax ? 'HIGH' : total <= BRADEN_RISK_BOUNDS.moderateMax ? 'MODERATE' : 'LOW';
}

/**
 * 하위 항목 읽기 — 두 모양을 받는다.
 *  · 점수 모양 `{ sensory: 3, … }` 또는 `{ scores: { … } }`(워크스테이션) · 재평가 화면 키 `sensoryPerception`·`frictionShear` 도 같은 항목
 *  · 임상 도구 모양 `{ idx: { sensory: 2, … } }` — 선택지 순서 = 점수 1부터(인덱스 + 1)
 * 반환: 있는 항목만(범위 밖 값은 버리지 않고 `invalid` 로) — 없으면 빈 객체.
 */
export function readBradenSubscores(inputs: unknown): { scores: Partial<BradenSubscores>; invalid: BradenItemKey[] } {
  const scores: Partial<BradenSubscores> = {};
  const invalid: BradenItemKey[] = [];
  if (!inputs || typeof inputs !== 'object') return { scores, invalid };
  const o = inputs as Record<string, unknown>;
  const idx = o.idx && typeof o.idx === 'object' ? (o.idx as Record<string, unknown>) : null;
  const src = idx ? null : (o.scores && typeof o.scores === 'object' ? (o.scores as Record<string, unknown>) : o);
  for (const it of BRADEN_ITEMS) {
    const bag = idx ?? src!;
    const raw = [it.key, ...(it.aliases as readonly string[])].map((k) => bag[k]).find((v) => v != null);
    if (raw == null) continue;
    const v = idx ? (typeof raw === 'number' ? raw + 1 : NaN) : typeof raw === 'number' ? raw : NaN;
    if (!Number.isInteger(v) || v < 1 || v > it.max) { invalid.push(it.key); continue; }
    scores[it.key] = v;
  }
  return { scores, invalid };
}

/** 6항목이 다 있으면 합 · 아니면 null. */
export function bradenTotalOf(scores: Partial<BradenSubscores>): number | null {
  let sum = 0;
  for (const it of BRADEN_ITEMS) {
    const v = scores[it.key];
    if (typeof v !== 'number') return null;
    sum += v;
  }
  return sum;
}

/** 기록 점검 사유 — 화면은 "확인 필요"로 보인다. TOTAL_ONLY 는 결함이 아니라 그 기록 경로가 총점만 받는다는 사실. */
export type BradenCheck = 'OUT_OF_RANGE' | 'INCOMPLETE' | 'INVALID_ITEM' | 'SUM_MISMATCH';

export interface BradenRecordView {
  total: number | null;
  subscores: Partial<BradenSubscores> | null;
  riskLevel: BradenRiskLevel | null;
  checks: BradenCheck[];
}

/**
 * 한 기록 → 표시 모양. `inputs` 가 null 이면 총점만 남는 경로(하위 항목 null · 점검 아님).
 *  · 총점이 없고 6항목이 다 있으면 합으로 · 둘 다 있고 다르면 SUM_MISMATCH(기록된 총점을 그대로 보인다)
 *  · 등급은 범위 안 총점에만
 */
export function evaluateBradenRecord(total: number | null | undefined, inputs: unknown | null): BradenRecordView {
  const checks: BradenCheck[] = [];
  let subscores: Partial<BradenSubscores> | null = null;
  let t: number | null = typeof total === 'number' && Number.isFinite(total) ? total : null;
  if (inputs != null) {
    const r = readBradenSubscores(inputs);
    subscores = r.scores;
    if (r.invalid.length) checks.push('INVALID_ITEM');
    const sum = bradenTotalOf(r.scores);
    if (sum == null) checks.push('INCOMPLETE');
    if (t == null) t = sum;
    else if (sum != null && sum !== t) checks.push('SUM_MISMATCH');
  }
  if (t != null && bradenRiskLevel(t) == null) checks.push('OUT_OF_RANGE');
  return { total: t, subscores, riskLevel: bradenRiskLevel(t), checks };
}
