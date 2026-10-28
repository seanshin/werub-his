import { describe, it, expect, vi } from 'vitest';
import { withAdvisoryLock } from './advisory-lock';

/** 공용 채번 헬퍼 회귀 — $transaction 안에서 advisory lock 획득 후 fn 실행. */
describe('withAdvisoryLock', () => {
  it('트랜잭션 안에서 pg_advisory_xact_lock 획득 후 fn 실행', async () => {
    const execRaw: string[] = [];
    const tx = { $executeRaw: vi.fn((s: TemplateStringsArray) => { execRaw.push(String(s.raw?.[0] ?? '')); return Promise.resolve(1); }) };
    const prisma = { $transaction: vi.fn((fn: any) => fn(tx)) } as any;

    const result = await withAdvisoryLock(prisma, 'specimen:20260725', async (t) => {
      expect(t).toBe(tx); // fn은 tx 클라이언트를 받는다
      return 'created';
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(execRaw.some((s) => s.includes('pg_advisory_xact_lock'))).toBe(true);
    expect(result).toBe('created');
  });
});
