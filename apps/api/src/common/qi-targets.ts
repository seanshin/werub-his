/**
 * 표면화 config 소비 헬퍼 (§7 P1·2026-08-04)
 * 원칙: config 는 오버라이드, 코드 상수가 폴백 — 형식 위반 값은 조용히 무시하고 기본으로(fail-safe).
 * 소비처: emergency(KTAS 재평가·NEDOCS 경계)·journey-analytics(대기 목표)·rehab/imaging/radiation/
 * dialysis(판정 기준 맵)·blood-bank(교차시험 유효시간)·surgery(좌우구분 키워드) 등 게이트 판정 기준 전반.
 */

/**
 * KTAS 레벨별 목표 재평가 간격(분) 폴백 — 표준(KTAS 2:15분·3:30분 등). 개정 표면=config
 * `qi.targets.ktasReassessMin`(부분 병합). emergency.service(관제)와 er-bed.service(베드 보드)가
 * 같은 판정을 공유(이중 선언 금지 — ER 베드 P1 에서 emergency.service 로컬 상수를 여기로 승격).
 */
export const KTAS_REASSESS_MIN: Record<string, number> = {
  LEVEL_1: 15, LEVEL_2: 15, LEVEL_3: 30, LEVEL_4: 60, LEVEL_5: 120,
};

/** 레벨별 목표 맵 부분 병합 — base 에 있는 키만, 유한 양수만 채택 */
export function mergeTargetMap(base: Record<string, number>, raw: unknown): Record<string, number> {
  const out = { ...base };
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const n = Number(v);
      if (k in base && Number.isFinite(n) && n > 0) out[k] = n;
    }
  }
  return out;
}

/** 단일 목표값 — 유한 양수만 채택 */
export function positiveNumberOr(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** 문자열 배열 마스터 — 비어있지 않은 문자열 배열일 때만 전량 대체(부분 병합 없음 — 목록은 통째 개정 단위) */
export function nonEmptyStringArrayOr(raw: unknown, fallback: string[]): string[] {
  if (!Array.isArray(raw) || raw.length === 0) return fallback;
  const items = raw.filter((s): s is string => typeof s === 'string' && s.trim() !== '').map((s) => s.trim());
  return items.length === raw.length ? items : fallback;
}

/** 등급 경계 배열 — 같은 길이·전부 유한수·순증(오름차순)일 때만 채택 */
export function ascendingBoundsOr(raw: unknown, fallback: number[]): number[] {
  if (!Array.isArray(raw) || raw.length !== fallback.length) return fallback;
  const nums = raw.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return fallback;
  for (let i = 1; i < nums.length; i++) if (nums[i] <= nums[i - 1]) return fallback;
  return nums;
}
