import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VocSlaCronService } from './voc-sla-cron.service';

/**
 * SLA 크론 회귀 — sweepConsultWaiting 오에스컬레이션 방지(검토·테스트·보완).
 * 마지막 메시지가 직원/AI인(응답 완료) 세션은 대기로 보지 않아야 한다.
 */
function makePrisma(sessions: any[]) {
  return {
    consultSession: {
      findMany: vi.fn().mockResolvedValue(sessions),
      update: vi.fn().mockResolvedValue({}),
    },
    consultAgent: { findMany: vi.fn().mockResolvedValue([]) },
    vocTicket: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
  } as any;
}
const config = { get: vi.fn().mockResolvedValue('7') } as any;

describe('VocSlaCron sweepConsultWaiting', () => {
  const HOUR_AGO = () => new Date(Date.now() - 3600_000);

  beforeEach(() => vi.clearAllMocks());

  it('마지막이 직원 메시지면(응답 완료) 오래된 세션도 에스컬레이션 안 함', async () => {
    const prisma = makePrisma([
      { id: 's1', teamId: null, priority: 'NORMAL', escalationLevel: 0, createdAt: HOUR_AGO(),
        messages: [{ sender: 'STAFF', createdAt: HOUR_AGO() }] },
    ]);
    const svc = new VocSlaCronService(prisma, config, undefined);
    await (svc as any).sweepConsultWaiting();
    expect(prisma.consultSession.update).not.toHaveBeenCalled();
  });

  it('메시지 없는 세션은 대기로 보지 않음', async () => {
    const prisma = makePrisma([
      { id: 's2', teamId: null, priority: 'NORMAL', escalationLevel: 0, createdAt: HOUR_AGO(), messages: [] },
    ]);
    const svc = new VocSlaCronService(prisma, config, undefined);
    await (svc as any).sweepConsultWaiting();
    expect(prisma.consultSession.update).not.toHaveBeenCalled();
  });

  it('마지막이 환자 메시지고 15분+ 경과면 L2(URGENT) 에스컬레이션', async () => {
    const prisma = makePrisma([
      { id: 's3', teamId: null, priority: 'NORMAL', escalationLevel: 0, createdAt: HOUR_AGO(),
        messages: [{ sender: 'PATIENT', createdAt: HOUR_AGO() }] },
    ]);
    const svc = new VocSlaCronService(prisma, config, undefined);
    await (svc as any).sweepConsultWaiting();
    expect(prisma.consultSession.update).toHaveBeenCalledTimes(1);
    const arg = prisma.consultSession.update.mock.calls[0][0];
    expect(arg.data.escalationLevel).toBe(2);
    expect(arg.data.priority).toBe('URGENT');
  });

  it('이미 동일 레벨이면 재에스컬레이션 안 함(멱등)', async () => {
    const prisma = makePrisma([
      { id: 's4', teamId: null, priority: 'URGENT', escalationLevel: 2, createdAt: HOUR_AGO(),
        messages: [{ sender: 'PATIENT', createdAt: HOUR_AGO() }] },
    ]);
    const svc = new VocSlaCronService(prisma, config, undefined);
    await (svc as any).sweepConsultWaiting();
    expect(prisma.consultSession.update).not.toHaveBeenCalled();
  });
});
