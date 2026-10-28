/**
 * 환자 화상 입장 토큰 — 포털 스코프 + 세션↔환자 결속(IDOR fail-closed).
 *
 * 🔴 2026-09-02 실측: 포털 화면이 **직원 가드**(`JwtAuthGuard`)가 걸린
 *    `GET /api/v1/telehealth/sessions/:id/patient-token` 을 불렀다. 환자 포털 토큰으로는 **항상 401**
 *    (운영 실호출로 확인 — 같은 토큰의 `/api/v1/portal/telehealth` 는 200).
 *    그런데 화면의 `catch` 가 그 실패를 삼키고 **JWT 없이** `/meet/<room>` 을 열어,
 *    "입장했다"고 보이지만 실제로는 못 들어가는 상태였다(운영 `JITSI_JWT_SECRET` 설정됨).
 *
 * 🔴 원본 `TelehealthService.getPatientJitsiToken(sessionId)` 은 **환자 결속을 보지 않는다**
 *    (직원 문맥 전제). 포털에 그대로 열면 남의 세션 토큰을 받는다 — 결속은 포털 계층이 진다.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { PortalService } from '../../src/modules/portal/portal.service';

describe('포털 화상 입장 토큰 — 본인 세션만', () => {
  let prisma: any;
  let telehealth: any;
  let svc: PortalService;

  beforeEach(() => {
    prisma = { telehealthSession: { findFirst: vi.fn() } };
    telehealth = { getPatientJitsiToken: vi.fn().mockResolvedValue('jwt-token') };
    // 🔴 위치 인자는 순서가 바뀌어도 `as any` 면 tsc 가 못 잡는다 — 정본 생성자 순서 그대로 적는다
    // (prisma, config, configRuntime, clinicSchedule, waitingQueue, schedule, allergy, telehealth, medicalAi?)
    svc = new PortalService(
      prisma, { get: () => undefined } as any, { get: () => undefined } as any,
      {} as any, {} as any, {} as any, {} as any, telehealth,
    );
  });

  it('본인 세션이면 토큰을 준다', async () => {
    prisma.telehealthSession.findFirst.mockResolvedValue({ id: 's1', patientId: 'p1' });
    await expect(svc.getTelehealthPatientToken('s1', 'p1')).resolves.toBe('jwt-token');
    expect(prisma.telehealthSession.findFirst).toHaveBeenCalledWith({ where: { id: 's1', patientId: 'p1' } });
  });

  it('🔴 남의 세션이면 토큰을 만들지 않는다(조회 자체가 안 나간다)', async () => {
    prisma.telehealthSession.findFirst.mockResolvedValue(null); // 결속 없음
    await expect(svc.getTelehealthPatientToken('s-other', 'p1')).rejects.toBeInstanceOf(NotFoundException);
    expect(telehealth.getPatientJitsiToken).not.toHaveBeenCalled();
  });

  it('결속 조회에 patientId 가 반드시 들어간다 — 빠지면 전 환자 세션이 열린다', async () => {
    prisma.telehealthSession.findFirst.mockResolvedValue({ id: 's1', patientId: 'p1' });
    await svc.getTelehealthPatientToken('s1', 'p1');
    const where = prisma.telehealthSession.findFirst.mock.calls[0][0].where;
    expect(where).toHaveProperty('patientId', 'p1');
  });
});

describe('포털 화면은 직원 가드 EP 를 부르지 않는다', () => {
  it('ServicesTab 이 포털 경로로만 토큰을 받는다', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(
      join(process.cwd(), '..', 'web', 'src', 'app', 'portal', '_services', 'ServicesTab.tsx'), 'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // 주석의 경로가 검사를 대신 통과한 적이 있다
    expect(src).toContain('/api/v1/portal/telehealth/');
    expect(src, '직원 가드 EP 를 다시 부르고 있다').not.toContain('/api/v1/telehealth/sessions/');
    expect(src, '토큰 없이 방을 여는 폴백이 되살아났다').not.toMatch(/window\.open\(`\/meet\/\$\{[^}]*\}`/);
  });
});
