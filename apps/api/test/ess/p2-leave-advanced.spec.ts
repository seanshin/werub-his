import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EssService } from '../../src/modules/ess/ess.service';

describe('P2 — 회수 결재·대결·팀 캘린더·증빙', () => {
  let service: EssService;
  let mockPrisma: any;
  let configMap: Record<string, unknown>;

  const approvedLeave = { id: 'lr-1', userId: 'u-1', type: 'ANNUAL', status: 'APPROVED', fromDate: new Date('2026-08-03'), toDate: new Date('2026-08-05'), days: 3 };

  beforeEach(() => {
    configMap = { 'ess.leaveApprovalMode': 'INTERNAL' };
    mockPrisma = {
      $transaction: vi.fn(async (arg: any) => (typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg))),
      staff: {
        findUnique: vi.fn().mockImplementation(({ where, select }: any) => {
          if (where?.userId === 'u-mgr') return Promise.resolve({ id: 'mgr-1', familyName: '조', givenName: '간호', department: '간호부', ...(select?.manager ? { manager: null } : {}) });
          if (where?.id === 'dg-1') return Promise.resolve({ id: 'dg-1', status: 'ACTIVE', userId: 'u-dg', familyName: '대', givenName: '리인' });
          if (where?.id === 'mgr-1') return Promise.resolve({ id: 'mgr-1', userId: 'u-mgr', familyName: '조', givenName: '간호', position: '수간호사' });
          return Promise.resolve({ id: 'st-1', familyName: '윤', givenName: '간호', department: '간호부', ...(select?.manager ? { manager: { id: 'mgr-1', userId: 'u-mgr', familyName: '조', givenName: '간호', status: 'ACTIVE', manager: null } } : {}) });
        }),
        findMany: vi.fn().mockResolvedValue([
          { id: 'st-1', userId: 'u-1', familyName: '윤', givenName: '간호', position: '간호사' },
          { id: 'st-2', userId: 'u-2', familyName: '황', givenName: '간호', position: '간호사' },
          { id: 'st-3', userId: 'u-3', familyName: '신', givenName: '간호', position: '간호사' },
        ]),
      },
      leaveRequest: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue(approvedLeave),
        update: vi.fn().mockResolvedValue({}),
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(1),
      },
      leaveBalance: { updateMany: vi.fn().mockResolvedValue({}) },
      eApprovalRelay: {
        create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'relay-c1', refId: data.refId, ...data })),
        update: vi.fn().mockResolvedValue({}),
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
      },
      approvalDelegation: {
        create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'dl-1', ...data })),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn(),
        update: vi.fn().mockResolvedValue({}),
      },
      dutyEntry: { findMany: vi.fn().mockResolvedValue([]) },
      staffDocument: { findUnique: vi.fn().mockResolvedValue({ id: 'doc-1', staffId: 'st-1', fileKey: 'k', mimeType: 'application/pdf', fileName: 'x.pdf' }) },
      notification: { create: vi.fn().mockResolvedValue({}) },
      user: { findMany: vi.fn().mockResolvedValue([]) },
      attendanceCorrectionRequest: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }), findMany: vi.fn().mockResolvedValue([]) },
      overtimeRequest: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }), findMany: vi.fn().mockResolvedValue([]) },
    };
    const configRuntime = { get: vi.fn(async (k: string) => configMap[k] ?? null) };
    service = new EssService(mockPrisma, { enqueue: vi.fn() } as any, { get: vi.fn() } as any, configRuntime as any);
    (service as any).audit = vi.fn();
  });

  describe('회수(HR_LEAVE_CANCEL)', () => {
    it('승인 아닌 휴가 회수 400', async () => {
      mockPrisma.leaveRequest.findUnique.mockResolvedValue({ ...approvedLeave, status: 'REQUESTED' });
      await expect(service.requestLeaveCancel('u-1', 'lr-1', '일정 변경')).rejects.toThrow(/승인 완료/);
    });

    it('중복 회수 진행 400', async () => {
      mockPrisma.eApprovalRelay.findFirst.mockResolvedValue({ id: 'x' });
      await expect(service.requestLeaveCancel('u-1', 'lr-1', '일정 변경')).rejects.toThrow(/진행 중/);
    });

    it('INTERNAL 회수 상신 — 결재선·PENDING', async () => {
      const r: any = await service.requestLeaveCancel('u-1', 'lr-1', '일정 변경');
      expect(r.mode).toBe('INTERNAL');
      expect(mockPrisma.eApprovalRelay.create.mock.calls[0][0].data.docType).toBe('HR_LEAVE_CANCEL');
    });

    it('회수 확정 — WITHDRAWN·차감 복원(decrement). OFF 원복 불요(LeaveRequest 정본 — 모델 이원화 통합)', async () => {
      await (service as any).applyLeaveCancel('lr-1', '조간호');
      expect(mockPrisma.leaveRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: 'APPROVED' }), data: expect.objectContaining({ status: 'WITHDRAWN' }) }));
      expect(mockPrisma.leaveBalance.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { used: { decrement: 3 } } }));
    });

    it('이미 회수된 건 멱등', async () => {
      mockPrisma.leaveRequest.findUnique.mockResolvedValue({ ...approvedLeave, status: 'WITHDRAWN' });
      const r: any = await (service as any).applyLeaveCancel('lr-1');
      expect(r.idempotent).toBe(true);
      expect(mockPrisma.leaveBalance.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('대결(위임)', () => {
    it('본인 위임 400', async () => {
      await expect(service.createDelegation('u-1', { delegateStaffId: 'st-1', fromDate: '2026-07-20', toDate: '2026-07-25', reason: '휴가' })).rejects.toThrow(/본인/);
    });

    it('위임 생성 — 수임자 알림', async () => {
      const r: any = await service.createDelegation('u-1', { delegateStaffId: 'dg-1', fromDate: '2026-07-20', toDate: '2026-07-25', reason: '휴가' });
      expect(r.id).toBe('dl-1');
      expect(mockPrisma.notification.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: 'HR_DELEGATION' }) }));
    });

    it('위임 수신 — 수임자가 위임자 문서를 결재(actedBy·delegated 기록)', async () => {
      // u-dg(수임자 st-dg... 여기선 me=st-1이 mgr-1의 위임 수임자라고 가정
      mockPrisma.approvalDelegation.findMany.mockResolvedValue([{ delegatorStaffId: 'mgr-1' }]);
      mockPrisma.eApprovalRelay.findUnique.mockResolvedValue({
        id: 'relay-1', docType: 'HR_LEAVE', status: 'PENDING', refModule: 'hr.leave_requests', refId: 'lr-1',
        title: 'ANNUAL 신청', approvalLine: [{ order: 1, staffId: 'mgr-1', userId: 'u-mgr', role: 'APPROVE' }],
      });
      const r = await service.decideApproval('relay-1', 'u-1', 'APPROVED'); // me=st-1, 위임자 mgr-1
      expect(r.final).toBe(true);
      const savedLine = mockPrisma.eApprovalRelay.update.mock.calls[0][0].data.approvalLine;
      expect(savedLine[0]).toMatchObject({ actedByStaffId: 'st-1', delegated: true, result: 'APPROVED' });
    });
  });

  describe('팀 캘린더', () => {
    it('부서원·일자별 휴가/당직·인력공백 플래그', async () => {
      mockPrisma.leaveRequest.findMany.mockResolvedValue([
        { userId: 'u-1', type: 'ANNUAL', status: 'APPROVED', fromDate: new Date('2026-08-03'), toDate: new Date('2026-08-03') },
        { userId: 'u-2', type: 'SICK', status: 'REQUESTED', fromDate: new Date('2026-08-03'), toDate: new Date('2026-08-03') },
      ]);
      const r: any = await service.teamCalendar('u-mgr', '2026-08');
      expect(r.members).toHaveLength(4); // 본인 + 직속 보고자 3
      const d3 = r.days.find((d: any) => d.date === '2026-08-03');
      expect(d3.leaves).toHaveLength(2);
      expect(d3.understaffed).toBe(true); // 4명 중 2명 휴가 ≥ max(2, ceil(4*0.3))
    });
  });

  describe('증빙', () => {
    it('타인 문서 첨부 400', async () => {
      mockPrisma.staffDocument.findUnique.mockResolvedValue({ id: 'doc-1', staffId: 'other' });
      mockPrisma.holidayCalendar = { findMany: vi.fn().mockResolvedValue([]) };
      mockPrisma.leaveRequest.findFirst = vi.fn().mockResolvedValue(null);
      mockPrisma.leaveBalance.findMany = vi.fn().mockResolvedValue([{ type: 'ANNUAL', granted: 15, used: 0 }]);
      await expect(service.requestLeave('u-1', { type: 'SICK', fromDate: '2026-08-10', toDate: '2026-08-11', days: 2, attachmentDocId: 'doc-1' } as any)).rejects.toThrow(/본인 서류/);
    });

    it('결재선 외 열람 400', async () => {
      mockPrisma.eApprovalRelay.findUnique.mockResolvedValue({
        id: 'relay-1', docType: 'HR_LEAVE', refId: 'lr-1',
        approvalLine: [{ staffId: 'mgr-1' }],
      });
      await expect(service.readApprovalAttachment('relay-1', 'u-1')).rejects.toThrow(/결재선 참여자/);
    });
  });
});

describe('P2-보안 하드닝 (적대 리뷰)', () => {
  it('teamCalendar — 직속 보고자 없으면(평사원) 빈 결과(전 부서 노출 차단)', async () => {
    const mp: any = {
      staff: { findUnique: vi.fn().mockResolvedValue({ id: 'st-9' }), findMany: vi.fn().mockResolvedValue([]) },
      leaveRequest: { findMany: vi.fn() }, dutyEntry: { findMany: vi.fn() },
      $transaction: vi.fn(),
    };
    const svc = new EssService(mp, { enqueue: vi.fn() } as any, { get: vi.fn() } as any, { get: vi.fn(async () => null) } as any);
    const r: any = await svc.teamCalendar('u-9');
    expect(r.members).toEqual([]);
    expect(mp.leaveRequest.findMany).not.toHaveBeenCalled(); // 조회 자체를 안 함
  });

  it('applyLeaveCancel — 동시 콜백 2번째는 claimed.count=0으로 멱등(이중 복원 차단)', async () => {
    const mp: any = {
      leaveRequest: {
        findUnique: vi.fn().mockResolvedValue({ id: 'lr-1', userId: 'u-1', type: 'ANNUAL', status: 'APPROVED', fromDate: new Date('2026-08-03'), toDate: new Date('2026-08-03'), days: 1 }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }), // 이미 다른 콜백이 claim
      },
      leaveBalance: { updateMany: vi.fn() },
      staff: { findUnique: vi.fn().mockResolvedValue({ id: 'st-1' }) },
      // 🔴 (2026-09-16 J1) 종전엔 `vi.fn()` 이라 **콜백이 아예 실행되지 않았다** — 정본이 claim 을
      //    트랜잭션 안으로 옮긴 뒤에도 목은 조용히 undefined 를 돌려줬다(I2 가 같은 함정을 2건 찾았다).
      //    정본의 실제 호출 모양(콜백형)을 그대로 돌린다.
      $transaction: vi.fn(async (arg: any) => (typeof arg === 'function' ? arg(mp) : Promise.all(arg))),
    };
    const svc = new EssService(mp, { enqueue: vi.fn() } as any, { get: vi.fn() } as any, { get: vi.fn() } as any);
    (svc as any).audit = vi.fn();
    const r: any = await (svc as any).applyLeaveCancel('lr-1');
    expect(r.idempotent).toBe(true);
    expect(mp.leaveBalance.updateMany).not.toHaveBeenCalled(); // 복원 미실행
  });

  it('반차(HALF)는 당일만 — 장기 기간 신청 400', async () => {
    const mp: any = {
      staff: { findUnique: vi.fn().mockResolvedValue({ id: 'st-1' }) },
      leaveRequest: { findFirst: vi.fn().mockResolvedValue(null) },
      holidayCalendar: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const svc = new EssService(mp, { enqueue: vi.fn() } as any, { get: vi.fn() } as any, { get: vi.fn(async () => 'INTERNAL') } as any);
    await expect(svc.requestLeave('u-1', { type: 'HALF', fromDate: '2026-08-03', toDate: '2026-08-31', days: 0.5 } as any)).rejects.toThrow(/반차는 하루만/);
  });
});
