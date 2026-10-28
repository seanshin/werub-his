import { UserRole } from '@prisma/client';

/**
 * 모바일 홈·기능 매핑 — **서버가 정한다**.
 *
 * 🔴 웹 로그인 화면이 `department.startsWith('건강검진센터')` 같은 문자열로 진입점을 갈랐다.
 *    부서명이 바뀌는 순간 조용히 틀리고, 앱이 그걸 따라 하면 두 곳에서 갈라진다.
 *    앱은 role 문자열로 메뉴를 열지 않고 **서버가 준 capability** 로만 연다.
 *
 * 🔴 모르는 role·부서는 **최소 공통만** 준다(요청서 AUTH-S-04). 넓게 열어두지 않는다.
 */
export type MobileCapability =
  | 'ATTENDANCE'
  | 'ESS'
  | 'HANDOFF'
  | 'STAFF_CALL'
  | 'APPROVAL'
  | 'PATIENT_LIST'
  | 'MEDICATION'
  | 'LAB_RESULT'
  | 'IMAGING';

const BASE: MobileCapability[] = ['ATTENDANCE', 'ESS', 'STAFF_CALL'];

const BY_ROLE: Partial<Record<UserRole, { home: string; capabilities: MobileCapability[] }>> = {
  [UserRole.DOCTOR]: {
    home: 'CLINICAL_TODAY',
    capabilities: [...BASE, 'HANDOFF', 'APPROVAL', 'PATIENT_LIST', 'LAB_RESULT', 'IMAGING'],
  },
  [UserRole.NURSE]: {
    home: 'NURSING_TODAY',
    capabilities: [...BASE, 'HANDOFF', 'PATIENT_LIST', 'MEDICATION', 'LAB_RESULT'],
  },
  [UserRole.PHARMACIST]: { home: 'PHARMACY_TODAY', capabilities: [...BASE, 'MEDICATION'] },
  [UserRole.LAB_TECH]: { home: 'DIAGNOSTICS_TODAY', capabilities: [...BASE, 'LAB_RESULT'] },
  [UserRole.ADMIN]: { home: 'ADMIN_TODAY', capabilities: [...BASE, 'APPROVAL'] },
  [UserRole.EXECUTIVE]: { home: 'EXECUTIVE_TODAY', capabilities: [...BASE, 'APPROVAL'] },
};

export function mobileHomeFor(role: string): { homeModule: string; mobileCapabilities: MobileCapability[] } {
  const hit = BY_ROLE[role as UserRole];
  if (!hit) return { homeModule: 'STAFF_TODAY', mobileCapabilities: [...BASE] };
  return { homeModule: hit.home, mobileCapabilities: hit.capabilities };
}
