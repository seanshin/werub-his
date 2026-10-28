import { describe, it, expect } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { ConsultPortalStreamGuard, ConsultStaffStreamGuard } from '../../src/modules/consult/consult-stream.guards';
import { ConsultController } from '../../src/modules/consult/consult.controller';
import { ConsultStaffController } from '../../src/modules/consult/consult-staff.controller';

/**
 * 🔴 **상담 SSE 인가는 가드로 응답 시작 전에 끝난다** (2026-08-31 · 발굴).
 *
 * 종전: 소유권/스코프 검사가 핸들러 `defer(...)` 안에 있어, 거부돼도 `@Sse` 가 이미 200 을
 * 보낸 뒤였다 → EventSource 자동 재접속 루프(403 이면 영구 중단). consent-device 와 동일 유형.
 * 이 스펙은 **가드를 실제로 실행**해 "거부=던짐·허용=통과"를 확인한다(문자열이 아니라 동작).
 */
const ctxWith = (req: any) => ({ switchToHttp: () => ({ getRequest: () => req }) } as any);

describe('🔴 포털 상담 SSE 가드', () => {
  it('본인 세션 아니면 canActivate 가 던진다(응답 시작 전 403)', async () => {
    const svc = { getSessionInfo: async () => { throw new ForbiddenException('본인 상담만'); } } as any;
    const g = new ConsultPortalStreamGuard(svc);
    await expect(g.canActivate(ctxWith({ params: { id: 's1' }, portalPatientId: 'p-other' })))
      .rejects.toBeInstanceOf(ForbiddenException);
  });
  it('본인 세션이면 통과하고, authz 를 실제로 부른다(대조군)', async () => {
    let called = false;
    const svc = { getSessionInfo: async (id: string, pid: string) => { called = true; return { id, patientId: pid }; } } as any;
    const g = new ConsultPortalStreamGuard(svc);
    await expect(g.canActivate(ctxWith({ params: { id: 's1' }, portalPatientId: 'p1' }))).resolves.toBe(true);
    expect(called, 'getSessionInfo 를 실제로 호출').toBe(true);
  });
});

describe('🔴 직원 상담 SSE 가드', () => {
  it('팀 스코프 미일치면 canActivate 가 던진다', async () => {
    const svc = { assertScope: async () => { throw new ForbiddenException('팀 스코프'); } } as any;
    const g = new ConsultStaffStreamGuard(svc);
    await expect(g.canActivate(ctxWith({ params: { id: 's1' }, consultAgent: { teamId: 'tX', role: 'AGENT' }, user: { role: 'NURSE' } })))
      .rejects.toBeInstanceOf(ForbiddenException);
  });
  it('스코프 일치면 통과하고 assertScope 를 부른다', async () => {
    let got: any = null;
    const svc = { assertScope: async (id: string, c: any) => { got = c; } } as any;
    const g = new ConsultStaffStreamGuard(svc);
    await expect(g.canActivate(ctxWith({ params: { id: 's1' }, consultAgent: { teamId: 't1', role: 'ADMIN' }, user: { role: 'NURSE' } }))).resolves.toBe(true);
    expect(got, 'assertScope 에 teamId/isAdmin 전달').toEqual({ teamId: 't1', isAdmin: true });
  });
});

describe('🔴 가드가 SSE 핸들러에 실제로 부착돼 있다(메타데이터)', () => {
  it('포털 stream 에 ConsultPortalStreamGuard', () => {
    const guards = Reflect.getMetadata('__guards__', ConsultController.prototype.stream) ?? [];
    expect(guards.map((g: any) => g.name), '@UseGuards 미부착이면 defer 뒤 200 으로 샌다').toContain('ConsultPortalStreamGuard');
  });
  it('직원 stream 에 ConsultStaffStreamGuard', () => {
    const guards = Reflect.getMetadata('__guards__', ConsultStaffController.prototype.stream) ?? [];
    expect(guards.map((g: any) => g.name)).toContain('ConsultStaffStreamGuard');
  });
});
