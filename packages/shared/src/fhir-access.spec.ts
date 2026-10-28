/**
 * FHIR 접근 역할 설정 파서 — **운영자가 시스템 설정에서 손으로 고치는 값**이라
 * 오타·빈 값·중복이 실제로 들어온다. 그때 무슨 일이 일어나는지를 못박는다.
 */
import { describe, it, expect } from 'vitest';
import {
  parseFhirStaffRoles,
  canAccessFhirAsStaff,
  FHIR_STAFF_ROLES_DEFAULT,
} from './fhir-access';
import { CHART_CLINICAL_ROLES } from './screen-access';

describe('FHIR 직원 역할 설정', () => {
  it('배열·쉼표 문자열 둘 다 받는다', () => {
    expect(parseFhirStaffRoles(['DOCTOR', 'NURSE']).roles).toEqual(['DOCTOR', 'NURSE']);
    expect(parseFhirStaffRoles('DOCTOR, NURSE').roles).toEqual(['DOCTOR', 'NURSE']);
    expect(parseFhirStaffRoles(' doctor ').roles).toEqual(['DOCTOR']); // 대소문자·공백 정규화
  });

  it('🔴 알 수 없는 역할은 버린다 — 오타로 권한이 생기지 않는다', () => {
    const r = parseFhirStaffRoles(['DOCTOR', 'DOCTORS', 'admin', '의사']);
    expect(r.roles).toEqual(['DOCTOR', 'ADMIN']);
    expect(r.dropped).toEqual(['DOCTORS', '의사']); // 무엇이 무시됐는지 말할 수 있어야 한다
  });

  it('중복은 한 번만 남는다', () => {
    expect(parseFhirStaffRoles(['DOCTOR', 'DOCTOR', 'doctor']).roles).toEqual(['DOCTOR']);
  });

  it('🔴 비우거나 전부 무효면 기본값으로 돌아간다 — 설정 실수로 FHIR 가 잠기지 않는다', () => {
    for (const v of [[], '', null, undefined, 42, ['nope', 'nada']]) {
      const r = parseFhirStaffRoles(v);
      expect(r.usedDefault, `${JSON.stringify(v)}`).toBe(true);
      expect(r.roles).toEqual([...FHIR_STAFF_ROLES_DEFAULT]);
    }
  });

  it('기본값은 임상 3역할 + ADMIN (지원 직군은 포함되지 않는다)', () => {
    expect([...FHIR_STAFF_ROLES_DEFAULT].sort()).toEqual(['ADMIN', 'DOCTOR', 'NURSE', 'PHARMACIST']);
    for (const r of ['NUTRITION', 'RECEPTIONIST', 'MEDICAL_RECORDS', 'CHECKUP', 'EXECUTIVE', 'READ']) {
      expect(canAccessFhirAsStaff(r, FHIR_STAFF_ROLES_DEFAULT), r).toBe(false);
    }
  });

  /**
   * 🔴 2026-08-27 사람 결정 — API 가 화면보다 넓으면 안 된다.
   *
   * 같은 날 오전에 만든 이 목록엔 `LAB_TECH` 가 있었고, 오후에 만든 화면 정본
   * `CHART_CLINICAL_ROLES` 엔 없었다. 그래서 검사기사는 **화면에서 못 보는 임상정보를 API 로는
   * 전건 조회**할 수 있었다. 같은 비대칭이 다시 생기지 않게 두 정본을 기계 대조한다.
   * (역은 허용한다 — `MEDICAL_RECORDS` 처럼 화면은 되고 FHIR 는 아닌 것은 의도된 좁힘이다.)
   */
  it('🔴 FHIR 기본값이 차트 임상필드 역할보다 넓지 않다(권한 역전 방지)', () => {
    const chart = new Set<string>(CHART_CLINICAL_ROLES as readonly string[]);
    const wider = [...FHIR_STAFF_ROLES_DEFAULT].filter((r) => !chart.has(r));
    expect(wider, `화면이 막은 역할에 API 를 열어두면 권한 역전이다: ${wider.join(',')}`).toEqual([]);
  });

  it('🔴 대조군 — 판정이 무조건 참/거짓이 아니다', () => {
    const roles = parseFhirStaffRoles(['DOCTOR']).roles;
    expect(canAccessFhirAsStaff('DOCTOR', roles)).toBe(true);
    expect(canAccessFhirAsStaff('NURSE', roles)).toBe(false);
    expect(canAccessFhirAsStaff(null, roles)).toBe(false);
    expect(canAccessFhirAsStaff('', roles)).toBe(false);
  });
});
