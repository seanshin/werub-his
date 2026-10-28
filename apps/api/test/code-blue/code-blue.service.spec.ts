import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CodeBlueService } from '../../src/modules/code-blue/code-blue.service';

describe('CodeBlueService (P2-C 코드블루·RRT)', () => {
  let svc: CodeBlueService;
  let prisma: any;

  beforeEach(() => {
    prisma = {
      codeBlueEvent: {
        create: vi.fn(async ({ data }: any) => ({ id: 'cb1', ...data })),
        findUnique: vi.fn(async () => ({ id: 'cb1' })),
        update: vi.fn(async ({ data }: any) => ({ id: 'cb1', ...data })),
        findMany: vi.fn(async () => []),
      },
      rrtActivation: {
        create: vi.fn(async ({ data }: any) => ({ id: 'r1', ...data })),
        findUnique: vi.fn(async () => ({ id: 'r1', respondedAt: null, activatedAt: new Date() })),
        update: vi.fn(async ({ data }: any) => ({ id: 'r1', ...data })),
        findMany: vi.fn(async () => []),
      },
      earlyWarningScore: { findFirst: vi.fn(async () => ({ id: 'ews1' })) },
      patient: { findMany: vi.fn(async () => []) },
    };
    svc = new CodeBlueService(prisma as any);
  });

  it('createCodeBlue — patientId 필수', async () => {
    await expect(svc.createCodeBlue('u1', {})).rejects.toThrow(/patientId/);
  });

  it('createCodeBlue — 생성', async () => {
    const r: any = await svc.createCodeBlue('u1', { patientId: 'p1', location: 'ICU-3' });
    expect(prisma.codeBlueEvent.create).toHaveBeenCalled();
    expect(r.patientId).toBe('p1');
    expect(r.recordedBy).toBe('u1');
  });

  it('codeBlueStats — 생존율(ROSC%)·평균 기동시간', async () => {
    const base = new Date('2026-07-20T00:00:00Z');
    prisma.codeBlueEvent.findMany = vi.fn(async () => [
      { outcome: 'ROSC', recognizedAt: base, teamArrivedAt: new Date(base.getTime() + 120000) }, // 2분
      { outcome: 'DEATH', recognizedAt: base, teamArrivedAt: new Date(base.getTime() + 240000) }, // 4분
    ]);
    const s = await svc.codeBlueStats();
    expect(s.total).toBe(2);
    expect(s.rosc).toBe(1);
    expect(s.roscRate).toBe(50);
    expect(s.avgArrivalMinutes).toBe(3);
  });

  it('activateRrt — NEWS2 트리거 시 최신 에스컬레이션 EWS 자동참조', async () => {
    await svc.activateRrt('u1', { patientId: 'p1', trigger: 'NEWS2' });
    const arg = prisma.rrtActivation.create.mock.calls[0][0];
    expect(arg.data.ewsId).toBe('ews1');
    expect(prisma.earlyWarningScore.findFirst).toHaveBeenCalled();
  });

  it('activateRrt — DIRECT_CALL은 EWS 조회 안함', async () => {
    await svc.activateRrt('u1', { patientId: 'p1', trigger: 'DIRECT_CALL' });
    expect(prisma.earlyWarningScore.findFirst).not.toHaveBeenCalled();
  });

  it('respondRrt — respondedAt·outcome 설정(SLA 산출용)', async () => {
    await svc.respondRrt('r1', { responderTeam: 'RRT-A', outcome: 'ICU_TRANSFER' });
    const arg = prisma.rrtActivation.update.mock.calls[0][0];
    expect(arg.data.respondedAt).toBeDefined();
    expect(arg.data.outcome).toBe('ICU_TRANSFER');
  });
});
