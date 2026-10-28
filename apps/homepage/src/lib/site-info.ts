/**
 * 병원 운영정보 단일 소스 (#2 데이터화 — ⓐ 공용 상수).
 * 진료시간·전화·주소·이메일 등을 한 곳에서 관리 → 변경 시 누락/불일치 방지.
 * (향후 ⓑ: 여기 값을 기본값으로 두고 HIS hospital-info API 로 override 가능 — 자주 바뀌면 권장)
 */
export const SITE_INFO = {
  name: '위루비병원',
  nameEn: 'WERUBYHOSP',
  url: 'https://hospital.example.org',

  phone: '02-000-0000',           // 대표전화
  emergencyPhone: '02-000-0119',  // 응급실 직통
  fax: '',

  address: '가상특별자치도 가상시 가상로 126',
  addressLocality: '가상시',
  addressRegion: '가상특별자치도',
  postalCode: '00000',
  seoulOffice: '서울특별시 가상구 가상로 1 가상빌딩 5층',

  // 🔴 W9(P12) → T6(2026-09-15): 진료시간 상수(hours)와 hoursLine() 을 지웠다. W9 는 이 값을 CMS 조회 실패 시 폴백으로 썼는데
  //    그 폴백을 구분해 그리는 화면이 0 이라 상수가 병원 사실로 나갔다. 진료시간 정본은 `lib/clinic-hours.ts`(CMS) 하나이고,
  //    못 읽으면 "불러오지 못했습니다·등록된 진료시간 없음"을 말한다.

  email: {
    privacy: 'privacy@hospital.example.org',
    hr: 'hr@hospital.example.org',
    international: 'international@hospital.example.org',
  },
} as const;


/**
 * 환자 포털 절대 URL.
 * 포털은 HIS(his.example.org)에 존재 — 홈페이지(hospital.example.org)에서 상대경로 '/portal' 로 가면 404 나므로
 * 포털·온라인예약 진입은 반드시 이 절대 URL을 사용한다. (인프라/nginx 변경 불필요)
 * 환경변수 NEXT_PUBLIC_PORTAL_URL 로 오버라이드 가능(미설정 시 운영 기본값).
 */
export const PORTAL_URL = process.env.NEXT_PUBLIC_PORTAL_URL ?? 'https://his.example.org/portal';

/** PORTAL_URL 에 쿼리/하위경로를 붙인다. portalUrl('?tab=health') → https://his.example.org/portal?tab=health */
export const portalUrl = (suffix = '') => `${PORTAL_URL}${suffix}`;

/**
 * `tel:` 하이퍼링크로 걸 수 있는 번호인지 판정.
 *
 * 🔴 W9: 진료과 상세 '전화 예약' 이 metadata.phone("내선 2100")에서 숫자만 뽑아 tel:2100 을 만들었다.
 *    운영 22개 진료과 중 21개가 내선이라, 방문자가 눌러도 아무 데도 걸리지 않는 링크였다.
 */
export function isDialable(phone: string | null | undefined): boolean {
  if (!phone) return false;
  if (/내선|ext\.?/i.test(phone)) return false;
  return phone.replace(/[^0-9]/g, '').length >= 9;
}
