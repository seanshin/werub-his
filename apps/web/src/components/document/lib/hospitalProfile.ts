'use client';

import { createContext, useContext } from 'react';

// 병원 법정정보(HospitalProfile) — 서식 머리·직인
// 🔴 (2026-10-13 결함 발굴 C6) 종전엔 데모 상수(가짜 요양기관기호·사업자번호·대표자)를
//    모든 발급 서식·서버 PDF 가 찍었다. 이제 설정 원장(system_configs hospital.*) **행이 있는 값만** 쓰고, 없으면 '미설정'.
//    어느 키가 등록 명칭인지·발급 시점에 동결할지는 사람 결정 identity.* 대기(설정 키 이름은 그 결정 전 현행).

export interface HospitalProfile {
  name: string;
  ykiho: string;          // 요양기관기호
  businessNumber: string; // 사업자등록번호
  ceo: string;            // 대표자
  address: string;
  tel: string;
  fax?: string;
  logoUrl?: string;
  stampUrl?: string;      // 직인 이미지 — 원장이 없다(지어 붙이지 않는다)
}

export const HOSPITAL_UNSET = '미설정';
export const HOSPITAL_UNKNOWN = '확인 불가';

/** 값이 하나도 없을 때(원장 미설정) — 서식이 지어낸 기관 정보를 찍지 않는다 */
export const UNSET_HOSPITAL_PROFILE: HospitalProfile = {
  name: HOSPITAL_UNSET, ykiho: HOSPITAL_UNSET, businessNumber: HOSPITAL_UNSET, ceo: HOSPITAL_UNSET,
  address: HOSPITAL_UNSET, tel: HOSPITAL_UNSET, fax: undefined, logoUrl: undefined, stampUrl: undefined,
};

/** 서버 응답(설정 키 → 값|null)에서 — 비어 있으면 '미설정' · 조회 실패는 '확인 불가'(호출부가 failed 로) */
export function profileFromConfig(cfg: Record<string, unknown> | null | undefined, failed = false): HospitalProfile {
  const v = (k: string) => {
    if (failed) return HOSPITAL_UNKNOWN;
    const x = cfg?.[k];
    return typeof x === 'string' && x.trim() ? x.trim() : HOSPITAL_UNSET;
  };
  const fax = failed ? undefined : (typeof cfg?.['hospital.fax'] === 'string' && (cfg['hospital.fax'] as string).trim() ? (cfg['hospital.fax'] as string).trim() : undefined);
  return {
    name: v('hospital.name'), ykiho: v('hospital.code'), businessNumber: v('hospital.bizNo'), ceo: v('hospital.ceo'),
    address: v('hospital.address'), tel: v('hospital.phone'), fax, logoUrl: undefined, stampUrl: undefined,
  };
}

const HospitalProfileContext = createContext<HospitalProfile>(UNSET_HOSPITAL_PROFILE);
export const HospitalProfileProvider = HospitalProfileContext.Provider;
/** 서식이 쓰는 기관 정보 — 공급자가 없으면 '미설정'(지어내지 않는다) */
export const useHospitalProfile = () => useContext(HospitalProfileContext);
