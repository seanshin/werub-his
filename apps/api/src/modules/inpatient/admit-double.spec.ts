import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InpatientService } from './inpatient.service';

/**
 * 입원 이중입원 회귀 — admit()이 환자 advisory-lock을 tx 안에서 획득하고
 * 재원 중복 체크를 락 안에서 수행하는지(동시 이중입원 race 제거).
 */
describe('입원 이중입원 방지 — 환자 락 + tx내 재검사', () => {
  let execRaw: string[];
  let activeCheckedInTx: boolean;
  let prisma: any;

  beforeEach(() => {
    execRaw = [];
    activeCheckedInTx = false;
    const tx = {
      $executeRaw: vi.fn((s: TemplateStringsArray) => { execRaw.push(String(s.raw?.[0] ?? '')); return Promise.resolve(1); }),
      admission: {
        findFirst: vi.fn(() => { activeCheckedInTx = true; return Promise.resolve(null); }), // 재원 없음
        create: vi.fn().mockResolvedValue({ id: 'a1', patientId: 'p1', bed: { ward: { name: '3A' } } }),
      },
      bed: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      chargeOfCare: { create: vi.fn().mockResolvedValue({}) },
      bedAssignment: { create: vi.fn().mockResolvedValue({}) },
    };
    prisma = { $transaction: vi.fn((fn: any) => fn(tx)), admission: { findFirst: vi.fn() } };
  });

  it('admit: 환자 advisory-lock 획득 + tx내 재원체크 후 병상 claim', async () => {
    const svc = new InpatientService(prisma) as any;
    await svc.admit({ patientId: 'p1', bedId: 'b1', doctorId: 'd1' });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(execRaw.some((s) => s.includes('pg_advisory_xact_lock'))).toBe(true);
    expect(activeCheckedInTx).toBe(true);
    // 재원 중복 체크가 tx 밖(prisma.admission.findFirst)에서 수행되지 않아야 함
    expect(prisma.admission.findFirst).not.toHaveBeenCalled();
  });

  it('이미 재원 중이면 차단(tx내 findFirst가 기존 입원 반환)', async () => {
    const svc = new InpatientService(prisma) as any;
    prisma.$transaction = vi.fn((fn: any) => fn({
      $executeRaw: vi.fn().mockResolvedValue(1),
      admission: { findFirst: vi.fn().mockResolvedValue({ id: 'existing' }), create: vi.fn() },
      bed: { updateMany: vi.fn() },
      chargeOfCare: { create: vi.fn() }, bedAssignment: { create: vi.fn() },
    }));
    await expect(svc.admit({ patientId: 'p1', bedId: 'b1', doctorId: 'd1' })).rejects.toThrow('이미 재원 중');
  });
});
