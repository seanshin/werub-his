import { describe, it, expect } from 'vitest';
import { UserRole } from '@prisma/client';
import { canViewMetric } from '../../src/modules/data-quality/quality-registry';

/**
 * 🔴 data-quality 도메인 역할 접근 (B4 · 2026-08-31).
 * 전 지표 ADMIN 고정이던 것을 산출주체(간호·검사)가 자기 도메인만 보게 확장.
 * 🔴 여는 게 항상 답은 아니다 — PII·임상판단 도메인은 여전히 ADMIN 만.
 */
const M = (domain: string, roles: UserRole[] = [UserRole.ADMIN]) =>
  ({ key: `${domain}.x`, domain, label: '', compute: async () => ({ value: 0 }), drillDown: 'panel', severityWhenOver: 'INFO', roles } as any);

describe('canViewMetric', () => {
  it('ADMIN 은 전 도메인을 본다', () => {
    for (const d of ['patient', 'lab', 'nursing', 'safety', 'billing']) {
      expect(canViewMetric(M(d), UserRole.ADMIN)).toBe(true);
    }
  });
  it('LAB_TECH 은 lab 만 본다(patient·nursing 은 못 본다)', () => {
    expect(canViewMetric(M('lab'), UserRole.LAB_TECH)).toBe(true);
    expect(canViewMetric(M('patient'), UserRole.LAB_TECH)).toBe(false);
    expect(canViewMetric(M('nursing'), UserRole.LAB_TECH)).toBe(false);
  });
  it('NURSE 는 nursing·safety 를 본다(billing·patient 은 못 본다)', () => {
    expect(canViewMetric(M('nursing'), UserRole.NURSE)).toBe(true);
    expect(canViewMetric(M('safety'), UserRole.NURSE)).toBe(true);
    expect(canViewMetric(M('billing'), UserRole.NURSE)).toBe(false);
    expect(canViewMetric(M('patient'), UserRole.NURSE)).toBe(false);
  });
  it('🔴 역할 없음/미인가는 아무것도 못 본다(대조군)', () => {
    expect(canViewMetric(M('lab'), null)).toBe(false);
    expect(canViewMetric(M('lab'), UserRole.RECEPTIONIST)).toBe(false);
  });
  it('지표에 명시된 role 은 도메인과 무관하게 본다', () => {
    expect(canViewMetric(M('patient', [UserRole.NURSE]), UserRole.NURSE)).toBe(true);
  });
});
