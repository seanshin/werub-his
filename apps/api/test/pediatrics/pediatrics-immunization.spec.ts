import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PediatricsService } from '../../src/modules/pediatrics/pediatrics.service';

describe('PediatricsService P2-H 예방접종 검증', () => {
  let svc: PediatricsService;
  let prisma: any;
  let cfg: { get: any };

  beforeEach(() => {
    prisma = {
      pediatricImmunization: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn(async ({ data }: any) => ({ id: 'i1', ...data })),
      },
    };
    cfg = { get: vi.fn(async () => 'OFF') };
    svc = new PediatricsService(prisma as any, cfg as any);
  });

  it('중복(동일 백신·차수) 차단', async () => {
    prisma.pediatricImmunization.findFirst = vi.fn().mockResolvedValueOnce({ id: 'dup' });
    await expect(svc.createImmunization({ patientId: 'p1', vaccineName: 'HepB', doseNumber: 1, givenBy: 'u1', lotNumber: 'L1' } as any)).rejects.toThrow(/이미 등록/);
  });

  it('BLOCK — 로트번호 없으면 차단', async () => {
    cfg.get = vi.fn(async () => 'BLOCK');
    await expect(svc.createImmunization({ patientId: 'p1', vaccineName: 'HepB', doseNumber: 1, givenBy: 'u1' } as any)).rejects.toThrow(/로트번호/);
  });

  it('BLOCK — 최소 접종간격 미달 차단', async () => {
    cfg.get = vi.fn(async () => 'BLOCK');
    prisma.pediatricImmunization.findFirst = vi.fn()
      .mockResolvedValueOnce(null) // dup 없음
      .mockResolvedValueOnce({ givenAt: new Date('2026-01-01') }); // prev 1차
    await expect(svc.createImmunization({ patientId: 'p1', vaccineName: 'HepB', doseNumber: 2, givenBy: 'u1', lotNumber: 'L1', givenAt: '2026-01-10' } as any)).rejects.toThrow(/간격|규칙/);
  });

  it('OFF — 로트 없어도 통과하되 warnings 반환', async () => {
    const r: any = await svc.createImmunization({ patientId: 'p1', vaccineName: 'HepB', doseNumber: 1, givenBy: 'u1' } as any);
    expect(r.warnings).toBeDefined();
    expect(r.warnings.some((w: string) => w.includes('로트'))).toBe(true);
  });

  it('nextDueDate 자동 산출(HepB 1차→다음 차수)', async () => {
    await svc.createImmunization({ patientId: 'p1', vaccineName: 'HepB', doseNumber: 1, givenBy: 'u1', lotNumber: 'L1', givenAt: '2026-01-01' } as any);
    const arg = prisma.pediatricImmunization.create.mock.calls[0][0];
    expect(arg.data.nextDueDate).toBeDefined();
  });
});
