/**
 * 환자 본인확인용 **시드 환자 목록** — 개발/스테이징 전용 정본.
 *
 * 🔴 이 파일은 운영 번들에 들어가면 안 된다. `next.config.ts` 가 운영 빌드에서
 *    이 모듈과 `components/dev/TestPatientPanel` 을 stub 으로 **치환**한다
 *    (조건부 렌더만 하면 값이 번들에 남아 그대로 검색된다 — 숨긴 것과 없는 것은 다른 사실이다).
 *    직원 계정 쪽(`lib/test-accounts`)과 같은 규약이다(WEB-SEC-01 · 2026-08-24).
 *
 * 🔴 2026-08-25 — 종전에는 `/portal` 로그인과 `(homepage)/booking` 두 화면에 **조건 없이 하드코딩**돼
 *    있었고, 목록도 서로 달랐다(portal 0001·0003·0006·0008 vs booking 0001·0003·0008·0021 — P12
 *    "같은 사실에 정본이 둘"). 여기로 합쳐 정본을 하나로 만든다.
 *
 * MRN + 생년월일은 이 시스템의 **환자 본인확인 자격 그 자체**다(비밀번호가 아니라도 자격이다).
 * 그래서 값이 아니라 **노출 경로**를 막는다.
 */
export interface TestPatient {
  mrn: string;
  name: string;
  /** 본인확인 입력 형식 그대로(YYYY-MM-DD) */
  dob: string;
}

export const TEST_PATIENTS: TestPatient[] = [
  { mrn: 'P2026-0001', name: '김영수', dob: '1958-03-15' },
  { mrn: 'P2026-0003', name: '박철수', dob: '1972-11-08' },
  { mrn: 'P2026-0006', name: '한지영', dob: '1990-09-03' },
  { mrn: 'P2026-0008', name: '강미래', dob: '2021-04-18' },
  { mrn: 'P2026-0021', name: '권도윤', dob: '2019-06-15' },
];
