import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PatientSafetyService } from '../../src/modules/patient-safety/patient-safety.service';

describe('PatientSafetyService P2-G RCA·에스컬레이션', () => {
  let svc: PatientSafetyService;
  let prisma: any;
  let events: { emit: any };

  beforeEach(() => {
    events = { emit: vi.fn() };
    prisma = {
      safetyIncident: {
        create: vi.fn(async ({ data }: any) => ({ id: 'i1', ...data })),
        findUnique: vi.fn(async () => ({ id: 'i1' })),
        update: vi.fn(async () => ({})),
      },
      rcaReport: {
        upsert: vi.fn(async ({ create }: any) => ({ id: 'r1', ...create })),
        findUnique: vi.fn(async () => ({ incidentId: 'i1' })),
        update: vi.fn(async ({ data }: any) => ({ id: 'r1', ...data })),
        findMany: vi.fn(async () => []),
      },
      $transaction: vi.fn(async (ops: any[]) => Promise.all(ops)),
    };
    svc = new PatientSafetyService(prisma as any, events as any);
  });

  it('reportIncident — SENTINEL이면 incident.critical emit', async () => {
    await svc.reportIncident({ reporterId: 'u1', type: 'FALL', severity: 'sentinel', description: 'x', occurredAt: '2026-07-20' });
    expect(events.emit).toHaveBeenCalledWith('incident.critical', expect.objectContaining({ severity: 'SENTINEL' }));
  });

  it('reportIncident — MINOR면 emit 없음', async () => {
    await svc.reportIncident({ reporterId: 'u1', type: 'FALL', severity: 'minor', description: 'x', occurredAt: '2026-07-20' });
    expect(events.emit).not.toHaveBeenCalled();
  });

  it('reportIncident — 저장 severity 원본 유지(HIGH 변형 안함)', async () => {
    const r: any = await svc.reportIncident({ reporterId: 'u1', type: 'FALL', severity: 'HIGH', description: 'x', occurredAt: '2026-07-20' });
    expect(r.severity).toBe('HIGH');
  });

  it('createRca — upsert(45일 기한)', async () => {
    await svc.createRca('i1', { findings: '근본원인' }, 'u1');
    expect(prisma.rcaReport.upsert).toHaveBeenCalled();
  });

  it('approveRca — rcaCompleted 연동', async () => {
    await svc.approveRca('i1', 'u1');
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.safetyIncident.update).toHaveBeenCalledWith(expect.objectContaining({ data: { rcaCompleted: true } }));
  });

  it('monitorRcaDue — 기한초과건 rca.overdue emit', async () => {
    prisma.rcaReport.findMany = vi.fn(async () => [{ id: 'r1', incidentId: 'i1', owner: 'u2' }]);
    await svc.monitorRcaDue();
    expect(events.emit).toHaveBeenCalledWith('rca.overdue', expect.objectContaining({ incidentId: 'i1' }));
  });
});
