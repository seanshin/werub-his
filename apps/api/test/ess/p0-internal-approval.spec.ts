import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EssService } from '../../src/modules/ess/ess.service';

describe('P0 — 휴가 서버검증·INTERNAL 결재', () => {
  let service: EssService;
  let mockPrisma: any;
  let configMap: Record<string, unknown>;

  const manager = { id: 'mgr-1', userId: 'u-mgr', familyName: '조', givenName: '간호', status: 'ACTIVE', manager: { id: 'cmo-1', userId: 'u-cmo', familyName: '박', givenName: '원장' } };

  beforeEach(() => {
    configMap = { 'ess.leaveApprovalMode': 'INTERNAL' };
    mockPrisma = {
      $transaction: vi.fn(async (arg: any) => (typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg))),
      approvalDelegation: { findMany: vi.fn().mockResolvedValue([]) },
      staff: {
        findUnique: vi.fn().mockImplementation(({ select }: any) =>
          Promise.resolve(
            select?.manager
              ? { id: 'st-1', familyName: '윤', givenName: '간호', manager, userId: 'u-1' }
              : { id: 'st-1', employeeNumber: 'E-1', clinicUserId: null },
          ),
        ),
      },
      leaveRequest: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'lr-1', status: 'REQUESTED', ...data })),
        update: vi.fn().mockResolvedValue({}),
        findFirst: vi.fn().mockResolvedValue(null),
        findUnique: vi.fn().mockResolvedValue({ id: 'lr-1', userId: 'u-1', type: 'ANNUAL', status: 'REQUESTED', fromDate: new Date('2026-07-27'), toDate: new Date('2026-07-28'), days: 2 }),
        findMany: vi.fn().mockResolvedValue([]),
        // 연차 잔여 교차확인(W7) — 원장 used 와 승인 신청 합계를 함께 낸다
        aggregate: vi.fn().mockResolvedValue({ _sum: { days: 0 } }),
      },
      eApprovalRelay: {
        create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'relay-1', refId: 'lr-1', ...data })),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
      },
      holidayCalendar: { findMany: vi.fn().mockResolvedValue([]) },
      leaveBalance: { findMany: vi.fn().mockResolvedValue([{ type: 'ANNUAL', granted: 15, used: 5 }]), updateMany: vi.fn().mockResolvedValue({}) },
      notification: { create: vi.fn().mockResolvedValue({}) },
      dutyEntry: { count: vi.fn().mockResolvedValue(0) },
      user: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const configRuntime = { get: vi.fn(async (k: string) => configMap[k] ?? null) };
    service = new EssService(mockPrisma, { enqueue: vi.fn() } as any, { get: vi.fn() } as any, configRuntime as any);
    (service as any).audit = vi.fn();
  });

  const dto = (over: any = {}) => ({ type: 'ANNUAL', fromDate: '2026-07-27', toDate: '2026-07-28', days: 99, reason: 't', ...over });

  describe('서버 검증', () => {
    it('역순 날짜 400', async () => {
      await expect(service.requestLeave('u-1', dto({ fromDate: '2026-07-28', toDate: '2026-07-27' }))).rejects.toThrow(/올바르지/);
    });

    it('기간 겹침 400', async () => {
      mockPrisma.leaveRequest.findFirst.mockResolvedValue({ id: 'x', fromDate: new Date('2026-07-27'), toDate: new Date('2026-07-29') });
      await expect(service.requestLeave('u-1', dto())).rejects.toThrow(/동일 기간/);
    });

    it('영업일 서버 계산 — 주말·공휴일 제외, 클라이언트 days 무시', async () => {
      // 7/27(월)~7/31(금) 5영업일 중 7/29 공휴일 → 4일
      mockPrisma.holidayCalendar.findMany.mockResolvedValue([{ date: new Date('2026-07-29') }]);
      const r: any = await service.requestLeave('u-1', dto({ fromDate: '2026-07-27', toDate: '2026-07-31', days: 99 }));
      expect(mockPrisma.leaveRequest.create.mock.calls[0][0].data.days).toBe(4);
      expect(r.mode).toBe('INTERNAL');
    });

    it('주말만 포함 기간 400', async () => {
      await expect(service.requestLeave('u-1', dto({ fromDate: '2026-07-25', toDate: '2026-07-26' }))).rejects.toThrow(/영업일이 없습니다/);
    });

    it('연차 잔여 초과 400 (잔여 10 < 신청 11)', async () => {
      const r = await expect(
        service.requestLeave('u-1', dto({ fromDate: '2026-07-27', toDate: '2026-08-10', days: 1 })),
      ).rejects.toThrow(/잔여.*초과/);
    });

    it('잔여 조회 실패 시 경고 동봉 진행', async () => {
      mockPrisma.leaveBalance.findMany.mockRejectedValue(new Error('db down'));
      const r: any = await service.requestLeave('u-1', dto());
      expect(r.warning).toContain('잔여');
    });

    it('granted=0(부여 미등록)은 하드 차단 대신 경고 진행', async () => {
      mockPrisma.leaveBalance.findMany.mockResolvedValue([{ type: 'ANNUAL', granted: 0, used: 0 }]);
      const r: any = await service.requestLeave('u-1', dto());
      expect(r.warning).toContain('부여 정보');
    });
  });

  describe('INTERNAL 결재', () => {
    it('결재선=직속 상급자 1단계 + 결재자 알림', async () => {
      const r: any = await service.requestLeave('u-1', dto());
      const line = mockPrisma.eApprovalRelay.update.mock.calls[0][0].data.approvalLine;
      expect(line).toEqual([{ order: 1, staffId: 'mgr-1', userId: 'u-mgr', role: 'APPROVE' }]);
      expect(mockPrisma.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ userId: 'u-mgr', type: 'HR_APPROVAL' }) }),
      );
      expect(r.approver).toBe('조간호');
    });

    it('직속 상급자 휴직 시 차상위 승계', async () => {
      mockPrisma.staff.findUnique.mockImplementation(({ select }: any) =>
        Promise.resolve(select?.manager ? { id: 'st-1', familyName: '윤', givenName: '간호', manager: { ...manager, status: 'ON_LEAVE' } } : { id: 'st-1' }),
      );
      await service.requestLeave('u-1', dto());
      const line = mockPrisma.eApprovalRelay.update.mock.calls[0][0].data.approvalLine;
      expect(line[0].staffId).toBe('cmo-1');
    });

    it('보고라인 부재 400', async () => {
      mockPrisma.staff.findUnique.mockImplementation(({ select }: any) =>
        Promise.resolve(select?.manager ? { id: 'st-1', familyName: '김', givenName: '이사장', manager: null } : { id: 'st-1' }),
      );
      await expect(service.requestLeave('u-1', dto())).rejects.toThrow(/보고라인/);
    });
  });

  describe('decideApproval', () => {
    const relay = (over: any = {}) => ({
      id: 'relay-1', docType: 'HR_LEAVE', status: 'PENDING', refModule: 'hr.leave_requests', refId: 'lr-1',
      title: 'ANNUAL 신청', approvalLine: [{ order: 1, staffId: 'mgr-1', userId: 'u-mgr', role: 'APPROVE' }], ...over,
    });

    beforeEach(() => {
      mockPrisma.staff.findUnique.mockImplementation(({ where, select }: any) => {
        if (where?.userId === 'u-mgr') return Promise.resolve({ id: 'mgr-1', familyName: '조', givenName: '간호', ...(select?.manager ? { manager: { userId: 'u-cmo' } } : {}) });
        return Promise.resolve({ id: 'st-1', familyName: '윤', givenName: '간호', manager: { userId: 'u-mgr' } });
      });
      mockPrisma.eApprovalRelay.findUnique.mockResolvedValue(relay());
    });

    it('반려 사유 누락 400', async () => {
      await expect(service.decideApproval('relay-1', 'u-mgr', 'REJECTED')).rejects.toThrow(/사유/);
    });

    it('결재 차례 아님 400', async () => {
      await expect(service.decideApproval('relay-1', 'u-1', 'APPROVED')).rejects.toThrow(/차례/);
    });

    it('승인 → leaveCallback 종결(연차 차감)·기안자 알림 — OFF는 저장하지 않음(LeaveRequest 정본)', async () => {
      const r = await service.decideApproval('relay-1', 'u-mgr', 'APPROVED');
      expect(r.final).toBe(true);
      expect(mockPrisma.leaveRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'REQUESTED' }), data: expect.objectContaining({ status: 'APPROVED' }) }),
      );
      expect(mockPrisma.leaveBalance.updateMany).toHaveBeenCalled(); // 차감
      expect(mockPrisma.dutyEntry.count).toHaveBeenCalled(); // 당직 겹침 검사(모델 이원화 통합 — StaffSchedule OFF 파생 제거)
      const notiTypes = mockPrisma.notification.create.mock.calls.map((c: any) => c[0].data.type);
      expect(notiTypes).toContain('HR_APPROVAL_RESULT');
    });

    it('당직 겹침 시 부서장 경고 알림', async () => {
      mockPrisma.dutyEntry.count.mockResolvedValue(2);
      await service.decideApproval('relay-1', 'u-mgr', 'APPROVED');
      const notiTypes = mockPrisma.notification.create.mock.calls.map((c: any) => c[0].data.type);
      expect(notiTypes).toContain('HR_DUTY_CLASH');
    });
  });
});
