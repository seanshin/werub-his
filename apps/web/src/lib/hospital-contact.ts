/**
 * 병원 연락처 — **웹 앱 안의 단일 출처**.
 *
 * 🔴 2026-08-19 실측 결함: 환자 포털이 응급실 번호를 `02-717-1119` 로,
 *    대표번호를 `02-717-1000` 으로 **하드코딩**하고 있었다. 둘 다 틀린 번호다
 *    (정본: 응급 `02-000-0119` · 대표 `02-000-0000`).
 *    환자가 응급 상황에서 화면을 보고 거는 번호가 틀렸다는 뜻이다.
 *    같은 앱 안에 올바른 값(`components/homepage/hospital-facts.ts`)이 이미 있었는데도 그랬다.
 *
 * 🔴 진짜 정본은 서버다(`SystemConfig hospital.*`). 그런데 **그 값을 공개로 내주는 EP 가 없어서**
 *    코드 상수가 여러 벌로 갈라져 있다(진료시간·영문 병원명도 같은 상태).
 *    → 공개 병원정보 EP 신설은 별도 트랙이다. 그때까지 웹 앱은 **이 파일 하나만** 쓴다.
 *    값을 새로 적지 말고 여기서 import 한다.
 *
 * 🔴 모르는 번호는 지어내지 않는다. 서버 값이 오면 그것을 우선하고,
 *    없으면 **119** 로 접는다(119 는 언제나 옳다).
 */
export const HOSPITAL_CONTACT = {
  /** 대표전화 — SystemConfig `hospital.phone` = "+82-2-000-0000" */
  main: '02-000-0000',
  /** 응급실 직통 — CMS FAQ `faq-emergency` */
  emergency: '02-000-0119',
  /** 응급 신고 — 국가 공통 */
  emergency119: '119',
} as const;

/** `tel:` 링크용 — 숫자만 남긴다(하이픈이 있으면 일부 단말에서 연결이 실패한다) */
export const telHref = (phone: string) => `tel:${phone.replace(/[^0-9+]/g, '')}`;

/**
 * 서버가 준 응급 연락처를 우선하고, 없으면 원내 정본, 그것도 없으면 119.
 * 🔴 어떤 경우에도 **틀린 번호를 그리지 않는다** — 모르면 119 로 접는다.
 */
export function emergencyPhoneOf(serverValue?: string | null): string {
  return serverValue?.trim() || HOSPITAL_CONTACT.emergency || HOSPITAL_CONTACT.emergency119;
}
