import { describe, it, expect } from 'vitest';
import {
  SAFETY_REVIEW_API_ROLES,
  canReviewSafety,
  hiddenSafetyTabLabels,
  safetyReviewBlockReason,
  visibleSafetyTabs,
} from './safety-access';

/**
 * `/safety` 역할 게이트 — 화면이 부를 수 없는 EP 를 부르지 않는가.
 *
 * 배경(운영 실로그인 프로브): nav 는 13역할에 열려 있는데 통계 5종(`incidents/stats`·
 * `identification-check/stats`·`read-back/pending`·`restraints/active`·`rca`)은
 * `PatientSafetyController` 클래스 레벨 `@Roles(DOCTOR, NURSE, ADMIN)` 뒤에 있다.
 *
 * 🔴 이 스펙은 **결함을 재주입하면 실패해야 한다**: 판정을 "권한만"으로 되돌리면
 *    `PHARMACIST + 전담인력 권한` 케이스가 통과해버린다(아래 첫 번째 it).
 */

const REVIEW_TABS = ['dashboard', 'identification', 'restraint', 'rca'];
const REVIEW_PERM = ['safety:incident:review', 'safety:incident:report'];

describe('전담인력 탭 판정 = 역할 AND 권한', () => {
  it('🔴 권한이 있어도 서버 역할 게이트 밖이면 열지 않는다(재주입 지점)', () => {
    // /admin/rbac 오버라이드는 권한을 넓히지만 @Roles 는 넓히지 못한다 → 열면 5EP 전부 403
    const v = { role: 'PHARMACIST', permissions: REVIEW_PERM };
    expect(canReviewSafety(v)).toBe(false);
    const keys = visibleSafetyTabs(v).map((t) => t.key as string);
    for (const t of REVIEW_TABS) expect(keys).not.toContain(t);
    expect(safetyReviewBlockReason(v)).toBe('ROLE');
  });

  it('역할이 맞아도 권한이 없으면 열지 않는다', () => {
    const v = { role: 'NURSE', permissions: ['safety:incident:report'] };
    expect(canReviewSafety(v)).toBe(false);
    expect(safetyReviewBlockReason(v)).toBe('PERMISSION');
  });

  /** 🔴 대조군 — 무조건 false 를 돌려주는 판정으로 바꾸면 여기서 실패한다 */
  it('대조군: 역할·권한을 모두 갖춘 전담인력에게는 전 탭이 열린다', () => {
    for (const role of SAFETY_REVIEW_API_ROLES) {
      const v = { role, permissions: REVIEW_PERM };
      expect(canReviewSafety(v)).toBe(true);
      const keys = visibleSafetyTabs(v).map((t) => t.key as string);
      for (const t of REVIEW_TABS) expect(keys).toContain(t);
      expect(safetyReviewBlockReason(v)).toBeNull();
      expect(hiddenSafetyTabLabels(v)).toEqual([]);
    }
  });
});

describe('보고 직군(전담인력 아님) — 보고와 본인 건만', () => {
  const REPORTERS = ['PHARMACIST', 'LAB_TECH', 'NUTRITION', 'RECEPTIONIST', 'MEDICAL_RECORDS', 'CHECKUP'];

  it('사고 보고·본인 보고 목록만 남고 통계·RCA·복창은 접힌다', () => {
    for (const role of REPORTERS) {
      const v = { role, permissions: ['safety:incident:report'] };
      const keys = visibleSafetyTabs(v).map((t) => t.key as string);
      expect(keys).toEqual(['list', 'report']);
      // 복창 확인은 임상 행위 — 이 직군에는 탭 자체가 없다
      expect(keys).not.toContain('readback');
    }
  });

  it('🔴 접은 사실을 화면이 말할 재료가 있다(빈 화면으로 뭉개지 않는다)', () => {
    const labels = hiddenSafetyTabLabels({ role: 'NUTRITION', permissions: ['safety:incident:report'] });
    expect(labels.length).toBe(5);
    expect(labels).toContain('대시보드');
    expect(labels).toContain('근본원인분석(RCA)');
  });
});

describe('로그인 전·권한 미로딩', () => {
  it('아무것도 모르면 전담인력 탭을 열지 않는다(모르면 안전측으로 접는다)', () => {
    expect(canReviewSafety({})).toBe(false);
    expect(visibleSafetyTabs({}).map((t) => t.key as string)).toEqual(['list', 'report']);
  });
});
