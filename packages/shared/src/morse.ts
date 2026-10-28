/**
 * Morse 낙상 척도 등급 정본(2026-10-26) — 서버 재평가 정책·간호 워크스테이션·차트 렌더러가 같은 경계를 쓴다.
 * 🔴 종전엔 25/45 경계가 서버 정책·화면 두 곳에 각자 적혀 있었다(한 곳만 고치면 낙상 등급·재평가 주기·통계가 갈라진다).
 * 경계: ≥45 고위험 · 25~44 중위험 · <25 저위험(Morse 1989) · 점수 범위 0~125.
 */
export const MORSE_TOTAL_RANGE = { min: 0, max: 125 } as const;
/** 등급 하한 — 서버 정책(범위 검증 뒤 쓰는 총함수)도 이 상수를 쓴다 */
export const MORSE_RISK_BOUNDS = { moderateMin: 25, highMin: 45 } as const;
export type MorseRiskLevel = 'HIGH' | 'MODERATE' | 'LOW';
export const MORSE_RISK_LABEL: Record<MorseRiskLevel, string> = { HIGH: '고위험', MODERATE: '중위험', LOW: '저위험' };

/** 총점 → 등급. 범위 밖·정수 아님은 null(등급을 지어내지 않는다). */
export function morseRiskLevel(total: number | null | undefined): MorseRiskLevel | null {
  if (typeof total !== 'number' || !Number.isInteger(total) || total < MORSE_TOTAL_RANGE.min || total > MORSE_TOTAL_RANGE.max) return null;
  return total >= MORSE_RISK_BOUNDS.highMin ? 'HIGH' : total >= MORSE_RISK_BOUNDS.moderateMin ? 'MODERATE' : 'LOW';
}

/**
 * 신체보호대 점검 간격(분) — 🔴 원내 규정이다. 설정 키가 없으면 코드 기본값(120분)으로 감시하되,
 * 응답·화면은 그것이 **코드 기본값**임을 밝힌다(기본값을 원내 규정인 척하지 않는다 · 감시를 끄지도 않는다 — 끄는 쪽이 덜 안전하다).
 */
export const RESTRAINT_CHECK_INTERVAL_KEY = 'nursing.restraint.checkIntervalMinutes';
export const RESTRAINT_CHECK_INTERVAL_DEFAULT_MIN = 120;
/** 15~480 정수만 — 형식 밖이면 null(호출부가 코드 기본값으로) */
export function normalizeRestraintCheckInterval(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= 15 && n <= 480 ? n : null;
}
