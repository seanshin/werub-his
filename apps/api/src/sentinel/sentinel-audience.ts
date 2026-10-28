import type { SentinelAudience } from '@hospital-run/shared';

/**
 * 발견 항목 → 소관(관리자/의료진/행정) 매핑 정본.
 *
 * 🔴 **표시 분류이지 권한이 아니다** — 화면 노출은 종전대로 관리자 전용이고(기획 §7-b 사람 결정),
 *    이 매핑은 관리자가 발견을 "누구에게 가져갈 일인가"로 갈라 보게 한다. 재분류는 여기 한 곳.
 * 🔴 매핑에 없는 키는 null(미분류) — 소관을 지어내지 않는다. 가드가 두 방향을 잰다:
 *    ① 정합성 SQL 의 모든 키가 여기 있다(새 검사를 추가하면 소관도 정한다)
 *    ② 여기 있는 키가 실제 검사에 존재한다(유령 키는 조용히 죽은 분류가 된다).
 *
 * 분류 기준(2026-09-04): 고치는 조치가 어디서 일어나는가 —
 *  · 의료진: 오더·처방·임상기록·검사·수술·응급 현장 조치
 *  · 행정: 접수·예약·청구·수납·환자 등록·입퇴원 수속·급양·병상 지원
 *  · 관리자: 시스템·기술(시각 아티팩트·거버넌스 집계·체인·DB·파이프·계약)
 */

/** 축 전체가 한 소관인 것 — CONTRACT 는 키가 동적(drift.*)이라 축 단위로만 분류한다 */
export const AXIS_AUDIENCE_DEFAULT: Record<string, SentinelAudience> = {
  CONTRACT: 'ADMIN',
  PIPE: 'ADMIN',
};

export const FLOW_AUDIENCE: Record<string, SentinelAudience> = {
  'flow.opd.checkin_to_call': 'ADMIN_STAFF',
  'flow.opd.call_to_start': 'CLINICAL',
  'flow.opd.start_to_cashier': 'ADMIN_STAFF',
};

export const DATA_AUDIENCE: Record<string, SentinelAudience> = {
  // ── 오더·처방 상태 정합 — 임상
  'integrity.01': 'CLINICAL', 'integrity.02': 'CLINICAL', 'integrity.03': 'CLINICAL',
  // 2026-09-30 처방 중단 — 접수 전 오더 잔존(73)·중단 이후 예정 투약 잔존(74)은 처방·간호 소관
  'integrity.73': 'CLINICAL', 'integrity.74': 'CLINICAL',
  // 2026-10-01 여정 원장 — 중복 의심(75)·어휘 밖 저장값(76)은 발행 코드·시드 문제라 관리자 소관
  'integrity.75': 'ADMIN', 'integrity.76': 'ADMIN',
  // 2026-10-01 여정 P1 — 방문 단위 귀속 누락(77)·응급 도착 시각 이중(78)은 발행 코드 문제라 관리자 소관
  'integrity.77': 'ADMIN', 'integrity.78': 'ADMIN',
  // 2026-10-01 여정 P2 — 상태–사건 대조(79·80)·종결 중복(81)은 발행 경로 문제라 관리자 소관
  'integrity.79': 'ADMIN', 'integrity.80': 'ADMIN', 'integrity.81': 'ADMIN',
  // 2026-10-01 여정 P2 확장 — 응급 도착·입원·수술·PACU 상태–사건 대조(82~85)도 같은 이유로 관리자 소관
  'integrity.82': 'ADMIN', 'integrity.83': 'ADMIN', 'integrity.84': 'ADMIN', 'integrity.85': 'ADMIN',
  // 2026-10-01 LIS 카탈로그에 실리지 않는 검사 패널(86) — 코드 마스터 매핑 문제라 관리자 소관
  'integrity.86': 'ADMIN',
  // 2026-10-03 위치 원장 — 열린 위치가 둘 이상인 환자(87) — 쓰기 경로 동시성 문제라 관리자 소관
  'integrity.87': 'ADMIN',
  'integrity.04': 'CLINICAL', 'integrity.05': 'CLINICAL', 'integrity.06': 'CLINICAL',
  'integrity.07': 'CLINICAL', 'integrity.08': 'CLINICAL',
  // ── 진료 기록·서명·진단 — 임상
  'integrity.09': 'CLINICAL', 'integrity.10': 'CLINICAL', 'integrity.11': 'CLINICAL',
  'integrity.12': 'CLINICAL', 'integrity.13': 'CLINICAL',
  // ── 입퇴원·병상 수속 — 행정(입퇴원계)
  'integrity.14': 'ADMIN_STAFF', 'integrity.15': 'ADMIN_STAFF', 'integrity.16': 'ADMIN_STAFF',
  'integrity.17': 'ADMIN_STAFF', 'integrity.18': 'ADMIN_STAFF', 'integrity.20': 'ADMIN_STAFF',
  // 퇴원요약은 기록 작성 주체가 의료진이다
  'integrity.19': 'CLINICAL',
  // ── 예약·접수·대기 — 행정
  'integrity.21': 'ADMIN_STAFF', 'integrity.22': 'ADMIN_STAFF',
  'integrity.23': 'ADMIN_STAFF', 'integrity.24': 'ADMIN_STAFF',
  // ── 검사·영상 — 임상(검사실·영상실)
  'integrity.25': 'CLINICAL', 'integrity.25b': 'CLINICAL', 'integrity.25c': 'CLINICAL',
  'integrity.26': 'CLINICAL', 'integrity.27': 'CLINICAL',
  // ── 청구·수납 — 행정(원무·재무)
  'integrity.28': 'ADMIN_STAFF', 'integrity.29': 'ADMIN_STAFF', 'integrity.30': 'ADMIN_STAFF',
  'integrity.31': 'ADMIN_STAFF', 'integrity.32': 'ADMIN_STAFF', 'integrity.32b': 'ADMIN_STAFF',
  // ── 환자 마스터(등록·병합·인적사항) — 행정(원무 등록)
  'integrity.33': 'ADMIN_STAFF', 'integrity.34': 'ADMIN_STAFF', 'integrity.35': 'ADMIN_STAFF',
  'integrity.36': 'ADMIN_STAFF', 'integrity.36b': 'ADMIN_STAFF', 'integrity.45': 'ADMIN_STAFF',
  'integrity.46': 'ADMIN_STAFF', 'integrity.47': 'ADMIN_STAFF',
  // ── 시스템(알림·감사 시각·체인) — 관리자
  'integrity.37': 'ADMIN', 'integrity.38': 'ADMIN', 'integrity.39': 'ADMIN',
  // ── 응급 베드·재실 — 임상(응급·병동 현장 조치)
  'integrity.40': 'CLINICAL', 'integrity.41': 'CLINICAL', 'integrity.42': 'CLINICAL',
  'integrity.43': 'CLINICAL', 'integrity.44': 'CLINICAL',
  // ── 장기 미처리 오더/방문 — 성격별
  'integrity.48': 'CLINICAL',        // 치료 오더
  'integrity.48b': 'ADMIN_STAFF',    // 식사 오더(급양)
  'integrity.48c': 'CLINICAL',       // 응급 방문 미종결
  'integrity.48d': 'CLINICAL',       // PACU 재실
  'integrity.48e': 'ADMIN_STAFF',    // 베드 청소(병동 지원)
  // ── 수술·마취 — 임상
  'integrity.49': 'CLINICAL', 'integrity.49b': 'CLINICAL', 'integrity.50': 'CLINICAL',
  // ── 임상경로 거버넌스·집계 정합 — 관리자(엔진·의결 데이터)
  'integrity.54': 'ADMIN', 'integrity.55': 'ADMIN', 'integrity.56': 'ADMIN', 'integrity.57': 'ADMIN',
  // ── 서명·기록 시각 아티팩트 — 관리자(트랜잭션/백필 시각 문제 — 사람이 고칠 임상 사실이 아니다)
  'integrity.58': 'ADMIN', 'integrity.58b': 'ADMIN', 'integrity.58c': 'ADMIN',
  'integrity.59': 'ADMIN', 'integrity.61': 'ADMIN',
  // ── 시각 롤포워드·DB — 관리자
  'integrity.60': 'ADMIN', 'integrity.65': 'ADMIN', 'integrity.66': 'ADMIN',
  // ── 2026-09-15 추가 — 휴진 예약·분납은 행정(원무·예약), 기초검사 전이 사유·폐기 기구 연결은 임상
  'integrity.67': 'ADMIN_STAFF', 'integrity.68': 'ADMIN_STAFF',
  'integrity.69': 'CLINICAL', 'integrity.70': 'CLINICAL',
  // ── 2026-09-21 추가 — 퇴직↔계정 회수 미연결은 인사·전산 소관(임상이 고칠 사실이 아니다)
  'integrity.71': 'ADMIN',
  // ── 2026-09-23 추가 — 전사 보존기간 초과 잔존(72)·기간 미설정(72b)은 파기 관제(/admin/retention)·설정 소관 = 관리자
  'integrity.72': 'ADMIN', 'integrity.72b': 'ADMIN',
};

/** 소관 판정 — 모르면 null(미분류). 지어내지 않는다 */
export function audienceOf(axis: string, checkKey: string): SentinelAudience | null {
  if (axis === 'DATA') return DATA_AUDIENCE[checkKey] ?? null;
  if (axis === 'FLOW') return FLOW_AUDIENCE[checkKey] ?? null;
  return AXIS_AUDIENCE_DEFAULT[axis] ?? null;
}
