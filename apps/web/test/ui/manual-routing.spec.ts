import { describe, it, expect } from 'vitest';
import { UserRole } from '@prisma/client';
import { MANUAL_BY_ROLE } from '../../src/components/layout/ManualLink';

/**
 * 사용 매뉴얼 역할 라우팅 계약 — 2026-08-10.
 *
 * 🔴 `UserRole` 이 늘어나면 이 표도 같이 늘어야 한다. v3.96 에서 지원부서 역할 4종이 신설됐을 때
 *    표가 그대로여서 급양·총무·의무기록·검진 담당이 **자기 매뉴얼 대신 통합 허브**로 떨어졌고,
 *    원무를 NURSE→RECEPTIONIST 로 재배정한 뒤엔 **원무 직원이 원무 매뉴얼에 닿지 못했다**.
 *    (조용한 실패다 — 허브가 열리니 아무도 고장으로 인지하지 않는다.)
 */

/** 매뉴얼이 따로 없는 게 맞는 역할 — 통합 허브로 보낸다. 근거를 남긴다. */
const HUB_BY_DESIGN: string[] = [
  UserRole.ADMIN,          // 전 영역을 보므로 허브가 맞다
  UserRole.EXECUTIVE,      // 경영 열람 — 업무 매뉴얼 대상 아님
  UserRole.READ,           // 읽기 전용 참관 계정
  UserRole.CRM_MANAGER,    // CRM 관리 — 원무 매뉴얼과 업무가 다르다(전용 문서 미작성)
];

describe('사용 매뉴얼 역할 라우팅', () => {
  it('🔴 모든 UserRole 이 매핑 또는 명시 예외에 들어 있다(신규 역할 누락 방지)', () => {
    const missing = Object.values(UserRole).filter(
      (r) => !(r in MANUAL_BY_ROLE) && !HUB_BY_DESIGN.includes(r),
    );
    expect(missing, `매뉴얼 라우팅 누락: ${missing.join(', ')}`).toEqual([]);
  });

  it('원무는 RECEPTIONIST 로 재배정됐다 — 원무 매뉴얼에 닿아야 한다', () => {
    expect(MANUAL_BY_ROLE[UserRole.RECEPTIONIST]?.href).toBe('/custom/manual');
  });

  it('v3.96 신설 지원부서 4역할이 각자 매뉴얼을 갖는다', () => {
    expect(MANUAL_BY_ROLE[UserRole.NUTRITION]?.href).toBe('/custom/guide-nutrition');
    expect(MANUAL_BY_ROLE[UserRole.ADMIN_STAFF]?.href).toBe('/custom/guide-admin-staff');
    expect(MANUAL_BY_ROLE[UserRole.MEDICAL_RECORDS]?.href).toBe('/custom/guide-records');
    expect(MANUAL_BY_ROLE[UserRole.CHECKUP]?.href).toBe('/custom/guide-checkup');
  });

  it('임상 3역할 매핑은 그대로다(회귀 방지)', () => {
    expect(MANUAL_BY_ROLE[UserRole.DOCTOR]?.href).toBe('/custom/guide-doctor');
    expect(MANUAL_BY_ROLE[UserRole.NURSE]?.href).toBe('/custom/guide-nurse');
    expect(MANUAL_BY_ROLE[UserRole.PHARMACIST]?.href).toBe('/custom/guide-support');
    expect(MANUAL_BY_ROLE[UserRole.LAB_TECH]?.href).toBe('/custom/guide-support');
  });

  it('모든 목적지가 /custom/<slug> 형식이다(오타·절대URL 방지)', () => {
    for (const [role, m] of Object.entries(MANUAL_BY_ROLE)) {
      expect(m.href, role).toMatch(/^\/custom\/[a-z-]+$/);
      expect(m.label.length, role).toBeGreaterThan(1);
    }
  });
});
