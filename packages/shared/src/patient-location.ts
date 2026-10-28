/**
 * 환자 위치 원장(PatientLocation)의 출처·해상도 — 어휘 정본 (기획 `spatial-flow-vision-3d.plan.md` P0-1·P0-2)
 *
 * 🔴 위치는 세 종류다 — **관측**(QR 스캔·검진 스테이션 도착) / **추정**(여정 이벤트를 위치로 번역) / 모름.
 *    종전에는 "오더가 났다 → 검사실에 있다", "수납했다 → 약국에 있다" 같은 추정이 관측과 같은 모양으로 같은 원장에 들어가,
 *    동선 화면이 추정을 관측처럼 그렸다(P1·P17). 원장·API·화면은 이 출처를 함께 싣는다.
 */

export const LOCATION_SOURCES = [
  'OBSERVED_QR',       // 위치 스테이션에서 환자 QR 을 스캔했다
  'OBSERVED_STATION',  // 검진 스테이션 도착 기록(직원이 처리) — 스테이션이 공간에 연결된 경우만
  'OBSERVED_WIFI',     // 무선 AP 측위(wifi-location.v1) — 동의 받아 연결한 단말·태그만 · 근사(오차 반경을 함께 싣는다)
  'INFERRED_EVENT',    // 여정 이벤트에서 번역한 추정
  'SIMULATED',         // 시뮬레이터·데모 시드가 만든 가짜 이동
  'MANUAL',            // 직원이 손으로 적은 위치
  'UNKNOWN',           // 출처를 알 수 없는 기존 행(마이그레이션 이전 시드)
] as const;
export type LocationSource = (typeof LOCATION_SOURCES)[number];

export const LOCATION_SOURCE_LABEL: Record<LocationSource, string> = {
  OBSERVED_QR: 'QR 스캔(관측)',
  OBSERVED_STATION: '스테이션 도착(관측)',
  OBSERVED_WIFI: '무선 AP 측위(관측·근사)',
  INFERRED_EVENT: '이벤트로 추정',
  SIMULATED: '시뮬레이션',
  MANUAL: '직원 입력',
  UNKNOWN: '출처 미상',
};

/** 관측으로 세는 출처 — 체류·병목 분석의 표본은 이것만 쓴다 */
export const OBSERVED_LOCATION_SOURCES: readonly LocationSource[] = ['OBSERVED_QR', 'OBSERVED_STATION', 'OBSERVED_WIFI', 'MANUAL'];

/**
 * 체류 분석 최소 표본 — 구역·출처별 완료 체류가 이보다 적으면 p50/p90 을 내지 않는다("표본 부족 n/5").
 * 🔴 1~2건으로 p90 을 그리면 한 환자의 체류가 "그 구역의 병목"이 된다.
 */
export const DWELL_MIN_SAMPLE = 5;

/** 체류 분석 기간(일) 허용 범위 */
export const DWELL_WINDOW_DAYS = { min: 1, max: 90, default: 7 } as const;

/** 접촉자 후보 조회 기간(일) — 지표 환자의 위치 구간을 이만큼 거슬러 본다 */
export const CONTACT_WINDOW_DAYS = { min: 1, max: 30, default: 14 } as const;

/**
 * 접촉자 후보 등급 — OBSERVED = 양쪽 모두 관측 위치가 같은 구역·겹친 시간 · INFERRED = 한쪽이라도 추정.
 * 🔴 둘 다 "후보"다. 해상도가 구역 단위라 같은 대기실이라도 거리는 모른다 — 확정은 감염관리실이 한다.
 */
export const CONTACT_CANDIDATE_GRADES = ['OBSERVED', 'INFERRED'] as const;
export type ContactCandidateGrade = (typeof CONTACT_CANDIDATE_GRADES)[number];

export function isObservedLocation(source: string | null | undefined): boolean {
  return !!source && (OBSERVED_LOCATION_SOURCES as readonly string[]).includes(source);
}

/**
 * 위치 해상도 — 추정 매핑이 구역 후보를 여럿 찾으면 **아무 구역이나 고르지 않고** 층까지만 적는다.
 * FLOOR 이면 `zoneId` 는 층(FLOOR) 노드다.
 */
export const LOCATION_GRANULARITIES = ['ZONE', 'FLOOR'] as const;
export type LocationGranularity = (typeof LOCATION_GRANULARITIES)[number];
