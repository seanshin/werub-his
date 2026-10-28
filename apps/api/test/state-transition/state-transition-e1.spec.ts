import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';

import { EmergencyService } from '../../src/modules/emergency/emergency.service';
import { WaitingQueueService } from '../../src/modules/waiting-queue/waiting-queue.service';
import { CheckupService } from '../../src/modules/checkup/checkup.service';
import { ControlledSubstanceService } from '../../src/modules/controlled-substance/controlled-substance.service';
import { EssService } from '../../src/modules/ess/ess.service';

/**
 * 🔴 상태 전이 2차(E1) — D1 이 분류한 "검사안함" 220 중 **위험순 후보 7모듈 38자리**를 한 건씩 판정한 결과다.
 *
 * 기전은 D1 과 같다 — **읽지 않고 쓴다**. 여기서 잠그는 것은 되돌릴 수 없는 것뿐이다
 * (법정 보고·서명·판독자·완료 시각·QI 분모).
 * 🔴 38자리 중 32는 **정당**으로 판정해 손대지 않았다 — 억지 가드를 만들면 진짜 결함이 묻힌다.
 * 각 항목에 **정상 경로가 통과하는 대조군**을 함께 둔다(막는 가드만 만들면 "어디서도 되지 않는 상태"를 통과시킨다).
 */

describe('응급 방문 — 종결된 방문을 되살리지 않는다', () => {
  let prisma: any;
  let service: EmergencyService;

  beforeEach(() => {
    prisma = {
      emergencyVisit: {
        findUnique: vi.fn(),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    service = new EmergencyService(prisma as never, {} as never, {} as never);
  });

  it('대조군 — 재실 중 상태는 전환된다(읽은 상태를 조건으로 건 조건부 갱신)', async () => {
    prisma.emergencyVisit.findUnique.mockResolvedValue({ id: 'v-1', status: 'TRIAGED' });
    await service.updateVisitStatus('v-1', 'IN_TREATMENT');
    expect(prisma.emergencyVisit.updateMany).toHaveBeenCalledWith({
      where: { id: 'v-1', status: 'TRIAGED' },
      data: { status: 'IN_TREATMENT' },
    });
  });

  it('🔴 COMPLETED 방문을 되돌리지 않는다 — 처분·입원 연계·베드 해제·청구가 끝난 사실이다', async () => {
    prisma.emergencyVisit.findUnique.mockResolvedValue({ id: 'v-1', status: 'COMPLETED' });
    await expect(service.updateVisitStatus('v-1', 'PENDING_TRIAGE')).rejects.toThrow(BadRequestException);
    expect(prisma.emergencyVisit.updateMany).not.toHaveBeenCalled();
  });

  it('같은 상태 재요청은 쓰기 없이 멱등', async () => {
    prisma.emergencyVisit.findUnique.mockResolvedValue({ id: 'v-1', status: 'IN_TREATMENT' });
    await service.updateVisitStatus('v-1', 'IN_TREATMENT');
    expect(prisma.emergencyVisit.updateMany).not.toHaveBeenCalled();
  });

  it('읽은 뒤 상태가 바뀌었으면(동시 처리) 409', async () => {
    prisma.emergencyVisit.findUnique.mockResolvedValue({ id: 'v-1', status: 'TRIAGED' });
    prisma.emergencyVisit.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.updateVisitStatus('v-1', 'IN_TREATMENT')).rejects.toThrow(ConflictException);
  });
});

describe('대기열 — 진료를 마친 대기를 미방문으로 뒤집지 않는다', () => {
  let prisma: any;
  let service: WaitingQueueService;

  beforeEach(() => {
    prisma = {
      waitingQueue: {
        findUnique: vi.fn(),
        update: vi.fn().mockResolvedValue({ id: 'q-1', status: 'NO_SHOW' }),
      },
    };
    service = new WaitingQueueService(prisma as never, { emit: vi.fn() } as never);
  });

  it('대조군 — 대기 중(WAITING)은 미방문 처리된다', async () => {
    prisma.waitingQueue.findUnique.mockResolvedValue({ id: 'q-1', status: 'WAITING' });
    await service.noShow('q-1');
    expect(prisma.waitingQueue.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'NO_SHOW' }),
    }));
  });

  it('🔴 COMPLETED 대기는 거부한다 — 완료 시각을 지금으로 덮어쓰고 미방문율(QI)을 오염시켰다', async () => {
    prisma.waitingQueue.findUnique.mockResolvedValue({ id: 'q-1', status: 'COMPLETED' });
    await expect(service.noShow('q-1')).rejects.toThrow(BadRequestException);
    expect(prisma.waitingQueue.update).not.toHaveBeenCalled();
  });

  it('이미 NO_SHOW 인 대기도 다시 쓰지 않는다', async () => {
    prisma.waitingQueue.findUnique.mockResolvedValue({ id: 'q-1', status: 'NO_SHOW' });
    await expect(service.noShow('q-1')).rejects.toThrow(BadRequestException);
    expect(prisma.waitingQueue.update).not.toHaveBeenCalled();
  });
});

describe('검진 판독·결과서 — 판독자와 서명자를 덮어쓰지 않는다', () => {
  let prisma: any;
  let service: CheckupService;

  beforeEach(() => {
    prisma = {
      checkupInterpretation: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({ id: 'i-1' }) },
      checkupResultItem: { update: vi.fn().mockResolvedValue({}) },
      checkupSummary: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({}) },
      checkupVisit: {
        findUnique: vi.fn().mockResolvedValue({ programId: null, patientId: 'p-1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      user: { findUnique: vi.fn().mockResolvedValue({ role: 'DOCTOR' }) },
    };
    // 🔴 (2026-09-16 J1) 판독 완료는 판독 행과 결과 항목 판정이 한 트랜잭션이다 —
    //    E1 가드(이미 완료면 거부)가 재시도를 막아, 갈라지면 임상 판정이 영원히 안 붙는다.
    prisma.$transaction = vi.fn(async (arg: any) => (typeof arg === 'function' ? arg(prisma) : Promise.all(arg)));
    service = new CheckupService(prisma as never, {} as never, { emit: vi.fn() } as never);
  });

  it('대조군 — 대기 중(PENDING) 판독은 완료된다', async () => {
    prisma.checkupInterpretation.findUnique.mockResolvedValue({ id: 'i-1', status: 'PENDING', resultItemId: 'r-1' });
    await service.completeInterpretation('i-1', { finding: '정상', grade: 'A' }, 'u-1');
    expect(prisma.checkupInterpretation.update).toHaveBeenCalled();
  });

  it('🔴 이미 완료된 판독은 거부한다 — interpretedBy·interpretedAt 이 뒤 사람으로 덮어써졌다', async () => {
    prisma.checkupInterpretation.findUnique.mockResolvedValue({
      id: 'i-1', status: 'COMPLETED', resultItemId: 'r-1', interpretedBy: 'doc-a', interpretedAt: new Date('2026-09-01'),
    });
    await expect(service.completeInterpretation('i-1', { finding: '이상', grade: 'C' }, 'doc-b'))
      .rejects.toThrow(BadRequestException);
    expect(prisma.checkupInterpretation.update).not.toHaveBeenCalled();
    expect(prisma.checkupResultItem.update).not.toHaveBeenCalled();
  });

  it('🔴 이미 서명된 결과서는 재서명하지 않는다 — signedBy·signedAt 이 덮어써졌다', async () => {
    prisma.checkupSummary.findUnique.mockResolvedValue({
      visitId: 'v-1', signedAt: new Date('2026-09-01'), signedBy: 'doc-a', authoredBy: 'doc-x',
    });
    await expect(service.signSummary('v-1', 'doc-b')).rejects.toThrow(BadRequestException);
    expect(prisma.checkupSummary.update).not.toHaveBeenCalled();
    expect(prisma.checkupVisit.update).not.toHaveBeenCalled();
  });
});

describe('마약류 NIMS 배치 — 수기 접수번호를 덮어쓰지 않는다', () => {
  let prisma: any;
  let service: ControlledSubstanceService;

  const claim = () => (service as never as { claimNimsRows: (...a: unknown[]) => Promise<{ claimed: number; skipped: number }> }).claimNimsRows.bind(service);

  beforeEach(() => {
    prisma = { nimsReport: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } };
    service = new ControlledSubstanceService(prisma as never);
  });

  it('대조군 — 읽은 상태 그대로인 행은 갱신된다(상태별 조건부)', async () => {
    const r = await claim()(
      [{ id: 'n-1', status: 'PENDING' }],
      { status: 'LOCAL_RECORDED' },
      'LOCAL-1',
    );
    expect(prisma.nimsReport.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['n-1'] }, status: 'PENDING' },
    }));
    expect(r.claimed).toBe(1);
    expect(r.skipped).toBe(0);
  });

  it('🔴 읽은 뒤 수기 접수(ACK)가 기록된 행은 건드리지 않는다 — 식약처 도달의 유일한 근거다', async () => {
    prisma.nimsReport.updateMany.mockResolvedValue({ count: 0 }); // 그 사이 ACK 로 바뀜
    const r = await claim()([{ id: 'n-1', status: 'PENDING' }], { status: 'LOCAL_RECORDED' }, 'LOCAL-1');
    expect(r.claimed).toBe(0);
    expect(r.skipped).toBe(1);
    // 조건 없는 덮어쓰기(where 에 status 가 없는 형태)여서는 안 된다
    for (const [arg] of prisma.nimsReport.updateMany.mock.calls) {
      expect(arg.where.status).toBeDefined();
    }
  });
});

describe('전자결재 릴레이 — 원문서에 적용된 결정과 어긋나지 않는다', () => {
  let prisma: any;
  let service: EssService;

  beforeEach(() => {
    prisma = {
      attendanceCorrectionRequest: {
        findUnique: vi.fn().mockResolvedValue({ id: 'a-1', status: 'APPROVED', userId: 'u-1' }), // 이미 종결
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      attendanceRecord: { create: vi.fn() },
      eApprovalRelay: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findFirst: vi.fn() },
      auditLog: { create: vi.fn() },
    };
    service = new EssService(prisma as never, {} as never, {} as never, {} as never, {} as never);
  });

  it('🔴 늦게 도착한 반려 콜백이 릴레이를 뒤집지 않는다 — 원문서는 APPROVED 인데 결재 문서만 REJECTED 였다', async () => {
    await service.leaveCallback({
      ref: { source_module: 'hr.attendance_corrections', source_ref: 'a-1' },
      status: 'REJECTED', approvalId: 'ap-1',
    });
    const calls = prisma.eApprovalRelay.updateMany.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const [arg] of calls) {
      // 원문서에 실제로 적용된 결정(APPROVED)으로만 적는다
      expect(arg.data.status).toBe('APPROVED');
      // 이미 종결된 릴레이는 건드리지 않는다
      expect(arg.where.status).toEqual({ notIn: ['APPROVED', 'REJECTED'] });
    }
  });
});
