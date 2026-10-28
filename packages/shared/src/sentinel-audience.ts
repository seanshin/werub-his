/**
 * 감시 발견 항목의 **소관(누가 볼 일인가)** 어휘 정본 — 관리자 / 의료진 / 행정.
 *
 * 🔴 이것은 **표시 분류이지 권한이 아니다**(nav 소분류와 같은 규약 — 숨김 ≠ 권한 회수).
 *    화면 노출은 종전대로 관리자 전용(/admin/sentinel · 기획 §7-b 사람 결정 유지)이고,
 *    이 축은 관리자가 "이 발견을 누구에게 가져가야 하는가"를 한눈에 갈라 보게 한다.
 * 🔴 분류하지 못한 키는 null(미분류)로 정직하게 남는다 — 지어내지 않는다.
 */

export const SENTINEL_AUDIENCES = ['ADMIN', 'CLINICAL', 'ADMIN_STAFF'] as const;
export type SentinelAudience = (typeof SENTINEL_AUDIENCES)[number];

export const SENTINEL_AUDIENCE_LABEL: Record<SentinelAudience, string> = {
  ADMIN: '관리자',
  CLINICAL: '의료진',
  ADMIN_STAFF: '행정',
};

export const SENTINEL_AUDIENCE_DESC: Record<SentinelAudience, string> = {
  ADMIN: '시스템·기술 소관 — 파이프·계약 드리프트·시각 아티팩트·DB. 개발/운영 담당이 본다.',
  CLINICAL: '임상 소관 — 오더·처방·기록 서명·검사·수술·응급. 의료진과 함께 회수한다.',
  ADMIN_STAFF: '행정 소관 — 접수·예약·청구·수납·환자 등록·병상 수속. 원무·행정과 함께 회수한다.',
};

/** 미분류 표시 문구 — 0번째 소관을 지어내지 않고 그 사실을 쓴다 */
export const SENTINEL_AUDIENCE_UNASSIGNED_LABEL = '미분류';
