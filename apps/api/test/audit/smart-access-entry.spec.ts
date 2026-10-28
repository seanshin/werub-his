import { describe, it, expect } from 'vitest';
import {
  parseFhirPath,
  userIdFromFhirUser,
  targetPatientId,
  buildSmartAccessEntry,
} from '../../src/modules/audit/smart-access-entry';

/**
 * 외부 SMART 앱 접근 기록 골든 — 2026-07-30.
 *
 * 🔴 종전엔 SMART 토큰 접근이 감사에 **한 줄도 남지 않았다**(인터셉터가 `user.id` 없으면 조기 반환).
 * 여기서 고정하는 것은 "무엇을 남기고 무엇은 남기지 않는가"다 — 특히 **오귀속 금지**(형식이
 * 어긋난 fhirUser·환자 id 를 억지로 해석해 남기면 감사 기록이 거짓이 된다).
 */
const TOKEN = { client_id: 'cerno', scope: 'patient/Patient.read openid', patient: '00000000-0000-4000-a000-00000000000a', fhirUser: 'Practitioner/00000000-0000-4000-a000-0000000000d1' };
const P = TOKEN.patient;
const U = '00000000-0000-4000-a000-0000000000d1';

describe('경로 해석(parseFhirPath)', () => {
  it('단건과 검색을 구분한다', () => {
    expect(parseFhirPath('/fhir/R4/Observation/abc')).toEqual({ resourceType: 'Observation', id: 'abc' });
    expect(parseFhirPath('/fhir/R4/Observation')).toEqual({ resourceType: 'Observation', id: undefined });
  });

  it('FHIR 경로가 아니면 기록 대상이 아니다', () => {
    expect(parseFhirPath('/api/v1/patients/x')).toBeNull();
    expect(parseFhirPath('/fhirx/R4/Patient')).toBeNull();
  });
});

describe('행위 주체 해석(userIdFromFhirUser)', () => {
  it('Practitioner/<uuid> 에서 의료진 UUID를 뽑는다', () => {
    expect(userIdFromFhirUser(`Practitioner/${U}`)).toBe(U);
  });

  it('🔴 UUID 형식이 아니면 남기지 않는다(엉뚱한 주체 귀속 금지)', () => {
    expect(userIdFromFhirUser('Practitioner/not-a-uuid')).toBeUndefined();
    expect(userIdFromFhirUser('')).toBeUndefined();
    expect(userIdFromFhirUser(undefined)).toBeUndefined();
  });
});

describe('대상 환자 해석(targetPatientId)', () => {
  it('토큰 문맥이 있으면 그것이 정본이다(요청 파라미터보다 우선)', () => {
    const other = '00000000-0000-4000-a000-0000000000ff';
    expect(targetPatientId({ resourceType: 'Observation' }, P, { patient: other })).toBe(P);
  });

  it('토큰 문맥이 없으면 요청 파라미터(patient/subject)를 쓴다 — Reference 표기도 해석', () => {
    expect(targetPatientId({ resourceType: 'Observation' }, undefined, { patient: P })).toBe(P);
    expect(targetPatientId({ resourceType: 'Observation' }, undefined, { subject: `Patient/${P}` })).toBe(P);
  });

  it('Patient 단건은 경로 id 가 대상이다', () => {
    expect(targetPatientId({ resourceType: 'Patient', id: P }, undefined, {})).toBe(P);
  });

  it('알 수 없으면 비워 둔다(추정 금지)', () => {
    expect(targetPatientId({ resourceType: 'Observation' }, undefined, {})).toBeUndefined();
    expect(targetPatientId({ resourceType: 'Observation' }, 'not-uuid', { patient: 'also-not' })).toBeUndefined();
  });
});

describe('항목 구성(buildSmartAccessEntry)', () => {
  it('per-user launch 는 클라이언트·의료진·환자가 모두 남는다', () => {
    const e = buildSmartAccessEntry({ path: `/fhir/R4/Patient/${P}`, method: 'GET', smartClient: TOKEN })!;
    expect(e).toMatchObject({ clientId: 'cerno', userId: U, patientId: P, resourceType: 'Patient', action: 'read' });
    expect(e.scope).toBe(TOKEN.scope);
  });

  it('system 단위(client_credentials)는 사용자 없이 남는다 — 기록 자체는 유지', () => {
    const e = buildSmartAccessEntry({ path: '/fhir/R4/Observation', method: 'GET', smartClient: { client_id: 'lis', scope: 'system/Observation.read' } })!;
    expect(e).toMatchObject({ clientId: 'lis', resourceType: 'Observation', action: 'search' });
    expect(e.userId).toBeUndefined();
    expect(e.patientId).toBeUndefined();
  });

  it('검색·단건·쓰기를 구분해 남긴다', () => {
    const base = { smartClient: TOKEN };
    expect(buildSmartAccessEntry({ ...base, path: '/fhir/R4/Condition', method: 'GET' })!.action).toBe('search');
    expect(buildSmartAccessEntry({ ...base, path: '/fhir/R4/Condition/c1', method: 'GET' })!.action).toBe('read');
    expect(buildSmartAccessEntry({ ...base, path: '/fhir/R4/Condition', method: 'POST' })!.action).toBe('write');
  });

  it('FHIR 외 경로는 이 축에서 기록하지 않는다(내부 감사 경로 소관)', () => {
    expect(buildSmartAccessEntry({ path: '/api/v1/patients/x', method: 'GET', smartClient: TOKEN })).toBeNull();
  });

  it('경로·스코프는 길이를 잘라 담는다(로그 폭주 방지)', () => {
    const e = buildSmartAccessEntry({ path: `/fhir/R4/Observation?${'a=1&'.repeat(200)}`, method: 'GET', smartClient: { ...TOKEN, scope: 'x'.repeat(900) } })!;
    expect(e.path.length).toBeLessThanOrEqual(300);
    expect(e.scope!.length).toBeLessThanOrEqual(500);
  });

  it('PHI 값(이름·수치)은 담지 않는다 — 경로·리소스 종류·주체 id 만', () => {
    const e = buildSmartAccessEntry({ path: `/fhir/R4/Patient/${P}`, method: 'GET', smartClient: TOKEN })!;
    expect(Object.keys(e).sort()).toEqual(['action', 'clientId', 'clientName', 'patientId', 'path', 'resourceType', 'scope', 'userId'].sort());
  });
});
