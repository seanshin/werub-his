import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScheduleService } from './schedule.service';

/**
 * 이중예약 회귀 — createOne이 충돌검사+생성을 의사 advisory-lock 트랜잭션에 원자화하는지.
 * 락 없이 check-then-act이면 동시 예약 시 이중예약 발생(파이프라인 심층검토 발견).
 */
describe('예약 이중예약 방지 — withDoctorLock 원자화', () => {
  let execRawCalls: string[];
  let createCalled: boolean;
  let conflictReadInTx: boolean;
  let prisma: any;
  let config: any;

  beforeEach(() => {
    execRawCalls = [];
    createCalled = false;
    conflictReadInTx = false;
    const tx = {
      $executeRaw: vi.fn((strings: TemplateStringsArray) => { execRawCalls.push(String(strings.raw?.[0] ?? '')); return Promise.resolve(1); }),
      appointment: {
        findMany: vi.fn(() => { conflictReadInTx = true; return Promise.resolve([]); }), // 충돌 없음
        create: vi.fn(() => { createCalled = true; return Promise.resolve({ id: 'a1', patientId: 'p1', doctorId: 'd1' }); }),
      },
    };
    prisma = {
      $transaction: vi.fn((fn: any) => fn(tx)),
      appointment: { findMany: vi.fn().mockResolvedValue([]) },
      clinicSchedule: { findMany: vi.fn().mockResolvedValue([]) },
      leaveRequest: { findMany: vi.fn().mockResolvedValue([]) },
    };
    config = { get: vi.fn().mockResolvedValue(true) };
  });

  it('createOne: 충돌검사와 생성이 advisory-lock 트랜잭션 안에서 실행', async () => {
    const svc = new ScheduleService(prisma, config as any) as any;
    // validateBookable는 경고만 — 스텁으로 대체(스케줄 조회 회피)
    svc.validateBookable = vi.fn().mockResolvedValue([]);

    await svc.createOne(
      { patientId: 'p1', doctorId: 'd1', scheduledAt: new Date(Date.now() + 3600_000).toISOString(), duration: 30, bookedVia: 'PORTAL' },
      'u1',
      new Date(Date.now() + 3600_000),
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1); // 트랜잭션 사용
    expect(execRawCalls.some((s) => s.includes('pg_advisory_xact_lock'))).toBe(true); // 의사 락 획득
    expect(conflictReadInTx).toBe(true); // 충돌검사가 tx 클라이언트로 수행
    expect(createCalled).toBe(true); // 생성됨
  });
});
