import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ObGynService } from '../../src/modules/obgyn/obgyn.service';

describe('ObGynService P2-B 모아 식별', () => {
  let svc: ObGynService;
  let prisma: any;
  let cfg: { get: any };

  beforeEach(() => {
    prisma = {
      deliveryRecord: { findUnique: vi.fn(async () => ({ id: 'd1', status: 'OPEN', patientId: 'p1', deliveredAt: new Date() })) },
      newbornRecord: { findUnique: vi.fn() },
      $transaction: vi.fn(async () => ({ id: 'n1' })),
    };
    cfg = { get: vi.fn(async () => 'OFF') };
    svc = new ObGynService(prisma as any, undefined, undefined, cfg as any);
  });

  // ── 식별밴드 게이트 ──
  it('addNewborn — 게이트 BLOCK인데 밴드 없으면 차단', async () => {
    cfg.get = vi.fn(async () => 'BLOCK');
    await expect(svc.addNewborn('d1', { sex: 'M' } as any)).rejects.toThrow(/식별밴드/);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('addNewborn — 게이트 BLOCK이고 밴드 있으면 통과', async () => {
    cfg.get = vi.fn(async () => 'BLOCK');
    await svc.addNewborn('d1', { sex: 'M', idBandNo: 'B123' } as any);
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('addNewborn — 게이트 OFF면 밴드 없어도 통과', async () => {
    await svc.addNewborn('d1', { sex: 'F' } as any);
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  // ── 모아 대조 ──
  it('verifyMotherBabyMatch — 일치하면 matched', async () => {
    prisma.newbornRecord.findUnique = vi.fn(async () => ({ id: 'n1', idBandNo: 'B123', motherBandNo: 'M123', delivery: { patientId: 'p1' } }));
    const r: any = await svc.verifyMotherBabyMatch('n1', 'M123', 'B123');
    expect(r.matched).toBe(true);
    expect(r.motherPatientId).toBe('p1');
  });

  it('verifyMotherBabyMatch — 신생아 밴드 불일치 차단', async () => {
    prisma.newbornRecord.findUnique = vi.fn(async () => ({ id: 'n1', idBandNo: 'B123', motherBandNo: 'M123', delivery: { patientId: 'p1' } }));
    await expect(svc.verifyMotherBabyMatch('n1', 'M123', 'WRONG')).rejects.toThrow(/불일치/);
  });

  it('verifyMotherBabyMatch — 산모 밴드 불일치 차단', async () => {
    prisma.newbornRecord.findUnique = vi.fn(async () => ({ id: 'n1', idBandNo: 'B123', motherBandNo: 'M123', delivery: { patientId: 'p1' } }));
    await expect(svc.verifyMotherBabyMatch('n1', 'WRONG', 'B123')).rejects.toThrow(/불일치/);
  });

  it('verifyMotherBabyMatch — 밴드 미등록(null)이면 차단', async () => {
    prisma.newbornRecord.findUnique = vi.fn(async () => ({ id: 'n1', idBandNo: null, motherBandNo: null, delivery: { patientId: 'p1' } }));
    await expect(svc.verifyMotherBabyMatch('n1', 'M123', 'B123')).rejects.toThrow(/불일치/);
  });
});
