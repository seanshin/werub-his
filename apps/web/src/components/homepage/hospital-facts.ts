/**
 * 공개 홈페이지 병원 사실 정본 (W9 · 화면 실사용 점검)
 *
 * 🔴 원 결함(P12 — 같은 사실에 정본이 둘 이상):
 *  - 진료시간이 네 곳에서 서로 달랐다.
 *      · CMS `GENERAL/operating-hours`(= /care/schedule 이 보여주는 정본): 평일 09:00~17:30 · 점심 12:30~13:30
 *      · Footer(전 페이지 하단): 평일 09:00~18:00 · 점심 12:30~14:00
 *      · 진료과 상세 '진료 안내' 탭: 진료시간 09:00~18:00 인데 바로 아래 전화예약은 08:30~17:30
 *      · 예약 챗봇 안내문: 09:00~18:00 · 점심 12:30~14:00
 *    → 방문자가 '진료시간' 페이지와 그 페이지의 푸터에서 서로 다른 시각을 읽었다.
 *  - 대표전화가 두 곳에서 `02-1234-5678`(플레이스홀더)로 박혀 있었다(모바일 플로팅 '전화' 버튼 포함).
 *
 * 규약: 공개 화면에 병원 공통 사실(전화·주소·진료시간)을 새로 적을 때는 반드시 이 파일을 쓴다.
 *      값을 바꿀 때는 CMS `GENERAL/operating-hours` / SystemConfig `hospital.*` 와 함께 바꾼다.
 *      (운영 실측 2026-08-14: system_configs `hospital.name/phone/address` 존재, 아래 값과 일치)
 */

/** SystemConfig `hospital.*` 와 동일해야 하는 값 */
export const HOSPITAL = {
  name: '위루비병원',
  nameEn: 'Weruby Hospital',
  /** 대표전화 — SystemConfig hospital.phone = "+82-2-000-0000" */
  phone: '02-000-0000',
  /** 응급실 직통 — CMS FAQ `faq-emergency` */
  emergencyPhone: '02-000-0119',
  /** SystemConfig hospital.address */
  address: '가상특별자치도 가상시 가상로 126',
  seoulOffice: '서울특별시 가상구 가상로 1 가상빌딩 5층',
} as const;

/**
 * 🔴 (2026-09-15 T6) 외래 진료시간 상수(CLINIC_HOURS·CLINIC_HOURS_ISO)를 지웠다 — Footer·진료과 목록·진료과 상세·JSON-LD·
 *    예약 챗봇이 CMS 를 읽지 않고 이 상수를 병원 사실로 그렸다(병원이 CMS 에서 바꿔도 따라가지 못했다).
 *    진료시간 정본은 `lib/clinic-hours.ts`(CMS `GENERAL/operating-hours`)이고, 못 읽으면 "불러오지 못했습니다·등록된 진료시간 없음"을 말한다.
 */

/** 응급실 운영 표기 — 외래 진료시간과 무관한 상시 운영(CMS FAQ `faq-emergency`) */
export const EMERGENCY_ROOM_HOURS = '365일 24시간';

/** `tel:` 하이퍼링크로 쓸 수 있는 번호인지 — 내선/안내문구는 걸 수 없다. */
export function isDialable(phone: string | null | undefined): boolean {
  if (!phone) return false;
  // 🔴 진료과 metadata.phone 은 21/22 건이 "내선 2100" 형태다. 숫자만 뽑아 tel:2100 을 만들면
  //    방문자 휴대폰에서 아무 데도 걸리지 않는다(= 예약 경로가 끊긴다).
  if (/내선|ext\.?/i.test(phone)) return false;
  const digits = phone.replace(/[^0-9]/g, '');
  return digits.length >= 9; // 국내 유선/휴대 최소 자릿수
}

/** 표시용 전화 문자열 → tel: href (걸 수 없는 값이면 null) */
export function telHref(phone: string | null | undefined): string | null {
  return isDialable(phone) ? `tel:${phone!.replace(/[^0-9+]/g, '')}` : null;
}
