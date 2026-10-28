import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getTelehealthDepartmentPolicy,
  isTelehealthDepartmentEligible,
  filterTelehealthDepartments,
  TELEHEALTH_DEPARTMENT_CONFIG_KEY,
} from '../../src/common/telehealth-department-policy';

/**
 * 🔴 이연 회수(2026-08-18) — 비대면 가능 진료과 설정.
 *
 * `enabled: null` 은 **미설정 = 전체 허용**이다. 관리자 화면이 이 상태를 "권고 9개 과만 허용"처럼
 * 칠하면 관리자는 "지금 외과는 비대면 불가"로 읽지만 실제로는 허용 중이다(정반대의 사실).
 * 빈 배열 `[]` 은 또 다른 뜻(아무 과도 불가)이라 null 과 같게 다루면 안 된다.
 */
const cfgReader = (value: unknown) => ({
  systemConfig: { findUnique: async () => (value === undefined ? null : ({ value } as { value: unknown })) },
});

describe('비대면 가능 진료과 정책 — 미설정과 제한을 구분한다', () => {
  it('설정 키가 없으면 enabled=null(전체 허용)', async () => {
    const p = await getTelehealthDepartmentPolicy(cfgReader(undefined));
    expect(p.enabled).toBeNull();
    expect(p.infectiousMode).toBe(false);
  });

  it('🔴 미설정(null)은 전체 허용 — 어떤 진료과도 막지 않는다', async () => {
    const p = await getTelehealthDepartmentPolicy(cfgReader({ enabled: null, infectiousMode: false }));
    expect(isTelehealthDepartmentEligible(p, '외과')).toBe(true);
    expect(isTelehealthDepartmentEligible(p, '응급의학과')).toBe(true);
    expect(filterTelehealthDepartments(p, ['내과', '외과'])).toEqual(['내과', '외과']);
  });

  it('🔴 빈 배열은 미설정과 다르다 — 아무 과도 허용하지 않는다', async () => {
    const p = await getTelehealthDepartmentPolicy(cfgReader({ enabled: [], infectiousMode: false }));
    expect(p.enabled).toEqual([]);
    expect(isTelehealthDepartmentEligible(p, '내과')).toBe(false);
    expect(filterTelehealthDepartments(p, ['내과', '외과'])).toEqual([]);
  });

  it('제한 모드는 목록에 있는 과만 허용한다', async () => {
    const p = await getTelehealthDepartmentPolicy(cfgReader({ enabled: ['내과', '피부과'], infectiousMode: true }));
    expect(isTelehealthDepartmentEligible(p, '내과')).toBe(true);
    expect(isTelehealthDepartmentEligible(p, '외과')).toBe(false);
    expect(filterTelehealthDepartments(p, ['내과', '외과', '피부과'])).toEqual(['내과', '피부과']);
    expect(p.infectiousMode).toBe(true);
  });

  it('진료과 미상은 막지 않는다 — 모르는 것을 근거로 거절하지 않는다', async () => {
    const p = await getTelehealthDepartmentPolicy(cfgReader({ enabled: ['내과'] }));
    expect(isTelehealthDepartmentEligible(p, null)).toBe(true);
    expect(isTelehealthDepartmentEligible(p, undefined)).toBe(true);
  });
});

/** 정본이 둘이 되면 설정 화면의 문장이 한쪽에서만 참이 된다(P12) */
const api = (...p: string[]) => join(__dirname, '..', '..', 'src', ...p);

describe('비대면 예약 경로는 모두 같은 설정을 읽는다', () => {
  it('설정 키 문자열은 정본 한 곳에서만 쓴다', () => {
    for (const f of [
      api('modules', 'remote-consultation', 'remote-consultation.service.ts'),
      api('modules', 'telehealth', 'telehealth.service.ts'),
      api('modules', 'portal', 'portal.service.ts'),
    ]) {
      expect(readFileSync(f, 'utf8')).not.toContain(`'${TELEHEALTH_DEPARTMENT_CONFIG_KEY}'`);
    }
  });

  it('telehealth 세션 예약이 진료과 설정을 읽는다', () => {
    const src = readFileSync(api('modules', 'telehealth', 'telehealth.service.ts'), 'utf8');
    expect(src).toContain('getTelehealthDepartmentPolicy');
    expect(src).toContain('isTelehealthDepartmentEligible');
  });

  it('포털 예약이 담당의 자격과 진료과 설정을 서버에서 검증한다', () => {
    const src = readFileSync(api('modules', 'portal', 'portal.service.ts'), 'utf8');
    const book = src.slice(src.indexOf('async bookTelehealth('), src.indexOf('async cancelTelehealth('));
    expect(book).toContain("role !== 'DOCTOR'");
    expect(book).toContain('isTelehealthDepartmentEligible');
  });
});

describe('원내 예약 EP 는 담당의를 호출자로 박지 않는다', () => {
  const src = readFileSync(api('modules', 'telehealth', 'telehealth.controller.ts'), 'utf8');
  const handler = src.slice(src.indexOf('async createSession('), src.indexOf('@Get(\'sessions\')'));

  it('🔴 body 의 담당의를 받는다(무조건 호출자 id 로 덮어쓰지 않는다)', () => {
    expect(handler).toContain('body.doctorId');
    // 종전 결함 형태: `{ ...body, doctorId }` 에서 doctorId 가 곧 @CurrentUser('id')
    expect(handler).not.toMatch(/@CurrentUser\('id'\)\s+doctorId/);
  });

  it('의사 본인이 잡을 때만 생략을 허용한다', () => {
    expect(handler).toMatch(/role === 'DOCTOR'/);
  });
});
