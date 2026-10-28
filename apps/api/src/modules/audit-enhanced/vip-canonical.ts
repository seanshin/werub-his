/**
 * VIP 표식 정본 — 화면 실사용 점검 W8(2026-08-14).
 *
 * 🔴 **정본이 둘이었다.**
 *  - 쓰는 곳: `/admin/patient-flags`(환자 마킹) → `patient_flags(flagType='VIP')` — 운영 실측 **2행**
 *  - 읽는 곳: 이상탐지 `checkVipAccess()` → `vip_patients` — 운영 실측 **0행**
 * 즉 화면에서 VIP 로 찍어도 **접근 경보가 걸릴 수 있는 경로가 아예 없었다**.
 * (게다가 `checkVipAccess()` 는 어디서도 호출되지 않았다 — 있는 줄 알았던 통제가 없었다.)
 *
 * 정본을 **`patient_flags(flagType='VIP', isActive=true)`** 하나로 정한다. 근거:
 *  ① 실제 쓰기 경로가 임상/관리 화면에 살아 있고 운영 데이터가 거기 있다(2행 vs 0행).
 *  ② 같은 테이블이 '악성(루비)'·'직원 지인'도 담아, 접근 감시 대상 표식이 한 곳에 모인다.
 *  ③ `vip_patients` 는 환자 UUID 를 손으로 입력하는 관리 화면 하나뿐이고 0행이었다.
 *
 * `vip_patients` 테이블은 **더 이상 읽지도 쓰지도 않는다**(스키마 삭제는 별도 마이그레이션 판단).
 * VIP 를 새로 읽는 코드는 반드시 이 파일의 조건식을 쓴다 — 세 번째 정본을 만들지 말 것.
 */

export const VIP_FLAG_TYPE = 'VIP';

/** 활성 VIP 표식 조건 — 환자 지정 시 그 환자, 미지정 시 전체 */
export function vipFlagWhere(patientId?: string) {
  return {
    flagType: VIP_FLAG_TYPE,
    isActive: true,
    ...(patientId ? { patientId } : {}),
  };
}
