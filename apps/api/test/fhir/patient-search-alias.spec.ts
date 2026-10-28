import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FhirDualAuthGuard } from '../../src/modules/smart-auth/smart-auth.guard';
import { patientSearchRef } from '../../src/modules/fhir/patient-search-param.util';

/**
 * FHIR 환자 검색 파라미터 별칭 계약 — 2026-09-21.
 *
 * 🔴 외부 실측: 트윈은 Observation 을 `subject=` 로, cerno 는
 *    MedicationRequest·Procedure·DiagnosticReport·DocumentReference 를 `patient=` 로 검색하는데
 *    HIS 핸들러는 각각 **반대 이름만** 읽었다 → `where` 에 환자 조건이 통째로 빠지고
 *    **다른 환자 기록이 섞여 나갔다**(take 100).
 *
 * 🔴 SMART 환자 스코프에서도 뚫렸다 — 가드는 `patient ?? subject` 로 대조해 통과시키되,
 *    값이 일치하면 주입하지 않으므로 핸들러가 안 읽는 이름으로 오면 필터가 없다.
 *    그래서 계약은 두 층이다: ① 가드가 두 이름을 함께 채운다 ② 핸들러가 두 이름을 모두 읽는다.
 */

const SRC = join(__dirname, '../../src/modules/fhir/fhir.controller.ts');
const source = readFileSync(SRC, 'utf-8');

// 환자에 귀속된 검색 핸들러 — 새 리소스를 열면 여기에 더한다(빠뜨리면 아래 계약이 실패한다).
const PATIENT_BOUND_SEARCH = [
  'searchEncounters',
  'searchMedicationRequests',
  'searchConditions',
  'searchAllergyIntolerances',
  'searchProcedures',
  'searchAppointments',
  'searchDiagnosticReports',
  'searchServiceRequests',
  'searchCarePlans',
  'searchDocumentReferences',
  'searchImmunizations',
  'searchObservations',
];

function handlerSignature(name: string): string {
  const at = source.indexOf(`async ${name}(`);
  expect(at, `${name} 핸들러를 찾지 못했다 — 이름이 바뀌었으면 목록을 고친다`).toBeGreaterThan(-1);
  const open = source.indexOf('(', at);
  let depth = 0;
  let i = open;
  for (; i < source.length; i++) {
    if (source[i] === '(') depth++;
    else if (source[i] === ')') {
      depth--;
      if (depth === 0) break;
    }
  }
  const body = source.indexOf('{', i);
  // 시그니처 + 본문 앞머리(정규화 한 줄)까지
  return source.slice(at, source.indexOf('\n', body + 200) > 0 ? body + 200 : source.length);
}

describe('patientSearchRef — 환자 참조 정규화', () => {
  it('Patient/ 접두를 떼고 첫 유효값을 고른다', () => {
    expect(patientSearchRef('Patient/p-1')).toBe('p-1');
    expect(patientSearchRef(undefined, 'p-2')).toBe('p-2');
    expect(patientSearchRef('p-1', 'p-2')).toBe('p-1');
  });

  it('빈 문자열·공백은 값이 아니다(빈 필터로 전 환자가 나가지 않게)', () => {
    expect(patientSearchRef('', '  ', undefined)).toBeUndefined();
    expect(patientSearchRef('   ', 'p-3')).toBe('p-3');
  });
});

describe('🔴 환자 귀속 FHIR 검색 핸들러는 patient·subject 를 모두 읽는다', () => {
  it.each(PATIENT_BOUND_SEARCH)('%s', (name) => {
    const sig = handlerSignature(name);
    expect(sig, `${name}: @Query('patient') 가 없다`).toContain("@Query('patient')");
    expect(sig, `${name}: @Query('subject') 가 없다`).toContain("@Query('subject')");
    expect(sig, `${name}: patientSearchRef 로 정규화하지 않는다`).toContain('patientSearchRef(');
  });

  it('CapabilityStatement 가 두 이름을 모두 광고한다(클라이언트가 이름을 고르는 근거)', () => {
    const cap = source.slice(0, source.indexOf('// ── Patient Search ──'));
    for (const type of ['Encounter', 'MedicationRequest', 'Condition', 'AllergyIntolerance', 'Procedure', 'Appointment', 'DiagnosticReport', 'ServiceRequest', 'CarePlan', 'DocumentReference', 'Immunization', 'Observation']) {
      const at = cap.indexOf(`type: '${type}',`);
      expect(at, `${type} 가 CapabilityStatement 에 없다`).toBeGreaterThan(-1);
      const block = cap.slice(at, cap.indexOf('},\n            {', at) + 1 || undefined);
      expect(block, `${type}: searchParam 에 patient 가 없다`).toContain("name: 'patient'");
      expect(block, `${type}: searchParam 에 subject 가 없다`).toContain("name: 'subject'");
    }
  });
});

describe('🔴 SMART 환자 스코프 가드 — 두 이름을 함께 채운다', () => {
  function guardWith(query: Record<string, string>) {
    const smart = {
      validateToken: vi.fn().mockResolvedValue({ token_type: 'smart', scope: 'patient/Observation.read', patient: 'pat-A' }),
      hasScope: vi.fn().mockReturnValue(true),
      hasSystemScope: vi.fn().mockReturnValue(false),
    };
    const reflector = { get: vi.fn().mockReturnValue({ resourceType: 'Observation', action: 'read' }) };
    const guard = new FhirDualAuthGuard(smart as never, reflector as never, { get: vi.fn().mockResolvedValue(undefined) } as never);
    const req: Record<string, unknown> = { headers: { authorization: 'Bearer t' }, query };
    const ctx = { switchToHttp: () => ({ getRequest: () => req }), getHandler: () => ({}) };
    return { guard, req, ctx: ctx as never };
  }

  it('subject 로만 온 요청도 patient 가 채워진다(핸들러가 patient 만 읽어도 필터가 산다)', async () => {
    const { guard, req, ctx } = guardWith({ subject: 'Patient/pat-A' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect((req.query as Record<string, string>).patient).toBe('pat-A');
    expect((req.query as Record<string, string>).subject).toBe('pat-A');
  });

  it('patient 로만 온 요청도 subject 가 채워진다(거울 방향)', async () => {
    const { guard, req, ctx } = guardWith({ patient: 'pat-A' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect((req.query as Record<string, string>).subject).toBe('pat-A');
  });

  it('둘 다 없으면 토큰 환자를 주입한다(종전 계약 불변)', async () => {
    const { guard, req, ctx } = guardWith({});
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect((req.query as Record<string, string>).patient).toBe('pat-A');
    expect((req.query as Record<string, string>).subject).toBe('pat-A');
  });
});
