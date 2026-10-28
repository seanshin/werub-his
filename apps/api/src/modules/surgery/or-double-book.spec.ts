import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SurgeryAdvancedService } from './surgery-advanced.service';

/**
 * OR 룸 이중예약 회귀 — assignRoom이 충돌검사+생성을 룸 advisory-lock 트랜잭션에 원자화하는지.
 */
describe('OR 룸 이중예약 방지 — 룸 락 원자화', () => {
  let execRaw: string[];
  let conflictReadInTx: boolean;
  let createCalled: boolean;
  let prisma: any;

  beforeEach(() => {
    execRaw = [];
    conflictReadInTx = false;
    createCalled = false;
    const tx = {
      $executeRaw: vi.fn((s: TemplateStringsArray) => { execRaw.push(String(s.raw?.[0] ?? '')); return Promise.resolve(1); }),
      orSchedule: {
        findMany: vi.fn(() => { conflictReadInTx = true; return Promise.resolve([]); }),
        create: vi.fn(() => { createCalled = true; return Promise.resolve({ id: 'os1' }); }),
      },
    };
    prisma = { $transaction: vi.fn((fn: any) => fn(tx)), orSchedule: { findMany: vi.fn(), create: vi.fn() } };
  });

  it('assignRoom: 룸 advisory-lock 후 tx내 충돌검사→생성', async () => {
    const svc = new SurgeryAdvancedService(prisma) as any;
    await svc.assignRoom({ roomId: 'r1', surgeryId: 's1', date: '2026-09-01', startTime: '09:00', endTime: '11:00', estimatedDuration: 120 });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(execRaw.some((s) => s.includes('pg_advisory_xact_lock'))).toBe(true);
    expect(conflictReadInTx).toBe(true);
    expect(createCalled).toBe(true);
    expect(prisma.orSchedule.create).not.toHaveBeenCalled(); // tx 밖 create 없음
  });

  it('충돌 있으면 생성 안 함(409)', async () => {
    const tx = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      orSchedule: { findMany: vi.fn().mockResolvedValue([{ id: 'existing' }]), create: vi.fn() },
    };
    prisma.$transaction = vi.fn((fn: any) => fn(tx));
    const svc = new SurgeryAdvancedService(prisma) as any;
    await expect(svc.assignRoom({ roomId: 'r1', surgeryId: 's1', date: '2026-09-01', startTime: '09:00', endTime: '11:00', estimatedDuration: 120 }))
      .rejects.toThrow('이미 수술이 예약');
    expect(tx.orSchedule.create).not.toHaveBeenCalled();
  });
});
