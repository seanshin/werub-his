import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EVERY_STAFF_ROLE } from '@hospital-run/shared';
import { mapClinicRoleToHisRole } from '../../src/modules/clinic-integration/sso.controller';

/**
 * Clinic SSO 역할 어휘 계약 — 2026-09-21.
 *
 * 🔴 Clinic 은 매핑이 없으면 `STAFF`, 미지 역할은 대문자 변환(`SUPPORT` 등)을 보낸다.
 *    HIS `UserRole` 에는 둘 다 없다. 종전 매핑은 받은 문자열을 그대로 대문자로 돌려줘
 *    `user.create` 가 터졌고, **Clinic 에서 처음 들어오는 직원은 로그인 자체가 실패**했다
 *    (2026-09-11 외부 코드 대조 · HEAD 재현).
 *
 * 🔴 모르는 값을 임의의 임상 역할로 바꾸는 것도 답이 아니다(기본 'NURSE' = 모르는 사람에게 임상 권한).
 *    모르면 안전측으로 접는다 — READ 로 만들고 무엇이 미지였는지 기록한다.
 */
const SRC = readFileSync(join(__dirname, '../../src/modules/clinic-integration/sso.controller.ts'), 'utf-8');

// 🔴 소스를 잘라 eval 하지 않는다 — 타입 주석 한 줄에 스캐너가 걸려 "테스트 0개"로 조용히 지나갔다
//    (2026-09-21 재주입 중 실측). 함수를 그대로 부른다.
const map = mapClinicRoleToHisRole;

describe('Clinic → HIS 역할 매핑', () => {

  it('HIS 역할 어휘에 있는 값은 그대로 쓴다', () => {
    expect(map('REGULAR', 'DOCTOR')).toEqual({ role: 'DOCTOR' });
    expect(map('REGULAR', undefined, 'pharmacist')).toEqual({ role: 'PHARMACIST' });
  });

  it("🔴 어휘에 없는 값(STAFF·SUPPORT)은 최소권한 READ 로 접고 미지 값을 남긴다", () => {
    expect(map('REGULAR', 'STAFF')).toEqual({ role: 'READ', unknown: 'STAFF' });
    expect(map('REGULAR', 'SUPPORT')).toEqual({ role: 'READ', unknown: 'SUPPORT' });
  });

  it('돌려주는 역할은 언제나 HIS 어휘 안에 있다(생성이 터지지 않는다)', () => {
    for (const probe of ['STAFF', 'SUPPORT', 'ADMIN', 'DOCTOR', '없는역할', '']) {
      const out = map('REGULAR', probe || undefined);
      expect(EVERY_STAFF_ROLE).toContain(out.role);
    }
  });

  it('Clinic 자체 역할(OWNER·MANAGER·REGULAR) 매핑은 종전 그대로(대조군)', () => {
    expect(map('OWNER')).toEqual({ role: 'ADMIN' });
    expect(map('MANAGER')).toEqual({ role: 'DOCTOR' });
    expect(map('REGULAR')).toEqual({ role: 'NURSE' });
  });

  it('미지 역할을 조용히 넘기지 않는다 — 호출부가 경고로 남긴다', () => {
    expect(SRC).toContain('알 수 없는 역할');
    expect(SRC).toMatch(/if \(mapped\.unknown\)/);
  });
});
