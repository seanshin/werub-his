import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WaitingQueueService } from './waiting-queue.service';

/**
 * 접수 큐 번호 중복 회귀 — checkIn이 번호할당(max+1)+생성을 부서 advisory-lock 트랜잭션에 원자화하는지.
 * 락 없이 findFirst→create이면 동시 접수 시 동일 번호 발급.
 */
describe('접수 큐 번호 중복 방지 — 부서 락 원자화', () => {
  let execRaw: string[];
  let numberedInTx: boolean;
  let prisma: any;

  beforeEach(() => {
    execRaw = [];
    numberedInTx = false;
    const tx = {
      $executeRaw: vi.fn((s: TemplateStringsArray) => { execRaw.push(String(s.raw?.[0] ?? '')); return Promise.resolve(1); }),
      waitingQueue: {
        findFirst: vi.fn(() => { numberedInTx = true; return Promise.resolve({ queueNumber: 4 }); }),
        create: vi.fn().mockResolvedValue({ id: 'q1', queueNumber: 5, patientId: 'p1', departmentName: '내과' }),
      },
    };
    prisma = {
      $transaction: vi.fn((fn: any) => fn(tx)),
      waitingQueue: { findFirst: vi.fn().mockResolvedValue(null) }, // 중복접수 없음
      clinicSchedule: { findFirst: vi.fn().mockResolvedValue({ roomName: '3진료실' }) },
    };
  });

  it('checkIn: 부서 advisory-lock 후 tx내 번호할당→생성', async () => {
    const eventEmitter = { emit: vi.fn() } as any;
    const svc = new WaitingQueueService(prisma, eventEmitter) as any;
    svc.autoAssignDoctor = vi.fn().mockResolvedValue('d1');
    const res = await svc.checkIn({ patientId: 'p1', doctorId: 'd1', departmentName: '내과' });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(execRaw.some((s) => s.includes('pg_advisory_xact_lock'))).toBe(true);
    expect(numberedInTx).toBe(true);
    // 2026-07: checkIn 은 큐 객체를 그대로 반환한다(컨트롤러가 { data } 로 감싸므로 이중 래핑 제거)
    expect(res.queueNumber).toBe(5);
  });
});
