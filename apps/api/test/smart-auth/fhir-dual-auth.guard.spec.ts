import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { FhirDualAuthGuard, FHIR_SCOPE_KEY } from '../../src/modules/smart-auth/smart-auth.guard';

function ctx(authHeader?: string, query?: Record<string, string>, user?: { role?: string }) {
  const req: any = { headers: authHeader ? { authorization: authHeader } : {}, query: query ?? {}, user };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    _req: req,
  } as any;
}

describe('FhirDualAuthGuard', () => {
  let guard: FhirDualAuthGuard;
  let smart: any;
  let reflector: any;
  let jwtGuard: any;

  beforeEach(() => {
    smart = {
      validateToken: vi.fn(),
      hasScope: vi.fn(),
      hasSystemScope: vi.fn().mockReturnValue(true), // 기본 system/*(M2M)로 가정 — 환자컨텍스트 테스트에서 false 지정
    };
    reflector = { get: vi.fn() };
    guard = new FhirDualAuthGuard(smart, reflector, { get: vi.fn().mockResolvedValue(undefined) } as any);
    jwtGuard = { canActivate: vi.fn().mockResolvedValue(true) };
    (guard as any).jwtGuard = jwtGuard;
  });

  it('SMART 토큰 + 충족 스코프 → 통과·req.smartClient 설정', async () => {
    const payload = { sub: 'lis', client_id: 'lis', scope: 'system/ServiceRequest.read', token_type: 'smart' };
    smart.validateToken.mockResolvedValue(payload);
    reflector.get.mockReturnValue({ resourceType: 'ServiceRequest', action: 'read' });
    smart.hasScope.mockReturnValue(true);
    const c = ctx('Bearer smart-token');
    await expect(guard.canActivate(c)).resolves.toBe(true);
    expect(c._req.smartClient).toEqual(payload);
    expect(jwtGuard.canActivate).not.toHaveBeenCalled();
  });

  it('[P0] 비system(patient/) 토큰 + 환자 클레임 없음 → 403(전체환자 판독 차단)', async () => {
    smart.validateToken.mockResolvedValue({ token_type: 'smart', scope: 'patient/Observation.read' }); // patient 클레임 없음
    reflector.get.mockReturnValue({ resourceType: 'Observation', action: 'read' });
    smart.hasScope.mockReturnValue(true);
    smart.hasSystemScope.mockReturnValue(false);
    await expect(guard.canActivate(ctx('Bearer t', { patient: 'pat-X' }))).rejects.toThrow(ForbiddenException);
  });

  it('[P0] 비system 토큰 + 환자 클레임 + 요청 대상 불일치 → 403(IDOR)', async () => {
    smart.validateToken.mockResolvedValue({ token_type: 'smart', scope: 'patient/Observation.read', patient: 'pat-A' });
    reflector.get.mockReturnValue({ resourceType: 'Observation', action: 'read' });
    smart.hasScope.mockReturnValue(true);
    smart.hasSystemScope.mockReturnValue(false);
    await expect(guard.canActivate(ctx('Bearer t', { patient: 'pat-B' }))).rejects.toThrow(ForbiddenException);
  });

  it('비system 토큰 + 환자 클레임 + 요청 대상 일치 → 통과', async () => {
    smart.validateToken.mockResolvedValue({ token_type: 'smart', scope: 'patient/Observation.read', patient: 'pat-A' });
    reflector.get.mockReturnValue({ resourceType: 'Observation', action: 'read' });
    smart.hasScope.mockReturnValue(true);
    smart.hasSystemScope.mockReturnValue(false);
    await expect(guard.canActivate(ctx('Bearer t', { subject: 'Patient/pat-A' }))).resolves.toBe(true);
  });

  it('system/* 토큰은 환자 컨텍스트 없이 인구단위 판독 허용(LIS/트윈)', async () => {
    smart.validateToken.mockResolvedValue({ token_type: 'smart', scope: 'system/Observation.read' });
    reflector.get.mockReturnValue({ resourceType: 'Observation', action: 'read' });
    smart.hasScope.mockReturnValue(true);
    smart.hasSystemScope.mockReturnValue(true);
    await expect(guard.canActivate(ctx('Bearer t', {}))).resolves.toBe(true);
  });

  it('SMART 토큰 + 스코프 부족 → 403', async () => {
    smart.validateToken.mockResolvedValue({ token_type: 'smart', scope: 'system/Patient.read' });
    reflector.get.mockReturnValue({ resourceType: 'DiagnosticReport', action: 'write' });
    smart.hasScope.mockReturnValue(false);
    await expect(guard.canActivate(ctx('Bearer smart-token'))).rejects.toThrow(ForbiddenException);
  });

  it('SMART 토큰 + 스코프 메타 없는 라우트 → 403(직원 전용)', async () => {
    smart.validateToken.mockResolvedValue({ token_type: 'smart', scope: 'system/*.*' });
    reflector.get.mockReturnValue(undefined); // @FhirScope 없음
    await expect(guard.canActivate(ctx('Bearer smart-token'))).rejects.toThrow(ForbiddenException);
    expect(jwtGuard.canActivate).not.toHaveBeenCalled();
  });

  it('내부 직원 JWT(비SMART) — 허용 역할이면 통과하고 SMART 컨텍스트는 붙지 않는다', async () => {
    smart.validateToken.mockRejectedValue(new Error('Not a SMART token'));
    const c = ctx('Bearer staff-jwt', undefined, { role: 'DOCTOR' });
    await expect(guard.canActivate(c)).resolves.toBe(true);
    expect(jwtGuard.canActivate).toHaveBeenCalled();
    expect(c._req.smartClient).toBeUndefined();
  });

  /**
   * 🔴 2026-08-27 — 종전에는 이 분기에 **역할 검사가 없어** 급양·원무·의무기록 계정도
   *    `/fhir/R4/Patient` 로 전체 환자 873명(성명·MRN·생년월일·전화·주소)을 받았다.
   *    이 테스트가 종전 계약("직원 JWT 면 통과")을 못박고 있었다 — 계약 자체가 결함이었다.
   */
  it('🔴 허용 목록에 없는 역할은 직원 JWT 라도 거부된다(급양·원무·의무기록)', async () => {
    smart.validateToken.mockRejectedValue(new Error('Not a SMART token'));
    for (const role of ['NUTRITION', 'RECEPTIONIST', 'MEDICAL_RECORDS', 'CHECKUP', 'READ']) {
      await expect(guard.canActivate(ctx('Bearer staff-jwt', undefined, { role }))).rejects.toThrow(ForbiddenException);
    }
  });

  it('설정으로 역할을 추가할 수 있다 — 추가한 역할만 열린다', async () => {
    smart.validateToken.mockRejectedValue(new Error('Not a SMART token'));
    (guard as any).config = { get: vi.fn().mockResolvedValue(['DOCTOR', 'MEDICAL_RECORDS']) };
    await expect(guard.canActivate(ctx('Bearer staff-jwt', undefined, { role: 'MEDICAL_RECORDS' }))).resolves.toBe(true);
    // 대조군 — 설정에 없는 역할은 기본값이 아니라 **설정 목록**으로 판정된다(NURSE 는 기본엔 있다)
    await expect(guard.canActivate(ctx('Bearer staff-jwt', undefined, { role: 'NURSE' }))).rejects.toThrow(ForbiddenException);
  });

  it('🔴 설정을 못 읽으면 기본값으로 좁힌다 — 조용히 넓히지 않는다', async () => {
    smart.validateToken.mockRejectedValue(new Error('Not a SMART token'));
    (guard as any).config = { get: vi.fn().mockRejectedValue(new Error('DB down')) };
    await expect(guard.canActivate(ctx('Bearer staff-jwt', undefined, { role: 'DOCTOR' }))).resolves.toBe(true);
    await expect(guard.canActivate(ctx('Bearer staff-jwt', undefined, { role: 'NUTRITION' }))).rejects.toThrow(ForbiddenException);
  });

  it('역할이 없는 요청은 거부된다(모르면 열지 않는다)', async () => {
    smart.validateToken.mockRejectedValue(new Error('Not a SMART token'));
    await expect(guard.canActivate(ctx('Bearer staff-jwt'))).rejects.toThrow(ForbiddenException);
  });

  it('Authorization 헤더 없음 → JwtAuthGuard로 위임(거부 위임)', async () => {
    jwtGuard.canActivate.mockResolvedValue(false);
    await expect(guard.canActivate(ctx())).resolves.toBe(false);
  });
});

/**
 * 🔴 Express 5 재현 — `req.query` 는 **getter 전용**이다.
 * 종전 구현은 `request.query = {...}` 로 재대입해
 * `TypeError: Cannot set property query of #<IncomingMessage>` → 환자 스코프 FHIR 읽기 **전량 500**
 * (프로드 실측 2026-07-30). 주입 경로에 테스트가 없어 그대로 배포됐다.
 */
function expressLikeCtx(authHeader: string, initial: Record<string, string> = {}) {
  const store = { ...initial };
  const req: any = { headers: { authorization: authHeader } };
  Object.defineProperty(req, 'query', { get: () => store, configurable: true }); // setter 없음 = Express 5
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    _req: req,
  } as any;
}

describe('환자 컨텍스트 주입은 Express 5 의 getter-only query 에서도 동작해야 한다', () => {
  let guard: FhirDualAuthGuard;
  let smart: any;

  beforeEach(() => {
    smart = {
      validateToken: vi.fn().mockResolvedValue({ token_type: 'smart', scope: 'patient/Observation.read', patient: 'pat-A' }),
      hasScope: vi.fn().mockReturnValue(true),
      hasSystemScope: vi.fn().mockReturnValue(false),
    };
    const reflector: any = { get: vi.fn().mockReturnValue({ resourceType: 'Observation', action: 'read' }) };
    guard = new FhirDualAuthGuard(smart, reflector);
    (guard as any).jwtGuard = { canActivate: vi.fn().mockResolvedValue(true) };
  });

  it('🔴 query 재대입으로 TypeError 를 내지 않고 통과한다', async () => {
    const c = expressLikeCtx('Bearer t');
    await expect(guard.canActivate(c)).resolves.toBe(true);
  });

  it('파라미터 누락 시 토큰 환자가 실제로 주입되어 핸들러가 읽을 수 있다', async () => {
    const c = expressLikeCtx('Bearer t');
    await guard.canActivate(c);
    expect(c._req.query.subject).toBe('pat-A');
    expect(c._req.query.patient).toBe('pat-A');
  });

  it('기존 파라미터는 보존한다(주입은 환자 키만 얹는다)', async () => {
    const c = expressLikeCtx('Bearer t', { category: 'vital-signs', _count: '50' });
    await guard.canActivate(c);
    expect(c._req.query).toMatchObject({ category: 'vital-signs', _count: '50', subject: 'pat-A' });
  });

  it('불일치는 주입하지 않고 여전히 403(주입은 누락일 때만)', async () => {
    const c = expressLikeCtx('Bearer t', { patient: 'pat-B' });
    await expect(guard.canActivate(c)).rejects.toThrow(ForbiddenException);
  });
});
