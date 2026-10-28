import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PathologyService } from './pathology.service';

/**
 * 병리 검체 accession 번호 중복 회귀 — createSpecimen이 채번(count+1)+생성을
 * 일자 advisory-lock 트랜잭션에 원자화하는지. 락 없이 count→create이면 동시 등록 시
 * 동일 accessionNo → @unique 위반(P2002)으로 검체 등록 누락.
 */
describe('병리 accession 번호 중복 방지 — 일자 락 원자화', () => {
  let execRaw: string[];
  let countedInTx: boolean;
  let prisma: any;

  beforeEach(() => {
    execRaw = [];
    countedInTx = false;
    const tx = {
      $executeRaw: vi.fn((s: TemplateStringsArray) => { execRaw.push(String(s.raw?.[0] ?? '')); return Promise.resolve(1); }),
      pathologySpecimen: {
        count: vi.fn(() => { countedInTx = true; return Promise.resolve(2); }),
        create: vi.fn((args: any) => Promise.resolve({ id: 'sp1', accessionNo: args.data.accessionNo })),
      },
    };
    prisma = { $transaction: vi.fn((fn: any) => fn(tx)) };
  });

  it('createSpecimen: 일자 advisory-lock 후 tx내 채번→생성(SP-...-0003)', async () => {
    const svc = new PathologyService(prisma) as any;
    const res = await svc.createSpecimen({ patientId: 'p1', specimenType: 'Biopsy', collectorId: 'c1' });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(execRaw.some((s) => s.includes('pg_advisory_xact_lock'))).toBe(true);
    expect(countedInTx).toBe(true);
    expect(res.accessionNo).toMatch(/^SP-\d{8}-0003$/);
  });
});
