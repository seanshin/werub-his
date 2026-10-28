import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EssService } from '../../src/modules/ess/ess.service';

describe('P1 — 근태 정정·초과근무 결재', () => {
  let service: EssService;
  let mockPrisma: any;
  let configMap: Record<string, unknown>;

  const manager = { id: 'mgr-1', userId: 'u-mgr', familyName: '조', givenName: '간호', status: 'ACTIVE', manager: null };

  beforeEach(() => {
    configMap = { 'ess.leaveApprovalMode': 'INTERNAL' };
    mockPrisma = {
      $transaction: vi.fn(async (arg: any) => (typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg))),
      approvalDelegation: { findMany: vi.fn().mockResolvedValue([]) },
      staff: {
        findUnique: vi.fn().mockImplementation(({ select }: any) =>
          Promise.resolve(select?.manager ? { id: 'st-1', familyName: '윤', givenName: '간호', manager } : { id: 'st-1', employeeNumber: 'E-1', clinicUserId: null }),
        ),
      },
      attendanceRecord: {
        findUnique: vi.fn().mockResolvedValue({ id: 'ar-1', userId: 'u-1', type: 'CLOCK_OUT', autoClosedAt: null }),
        create: vi.fn().mockResolvedValue({}),
        count: vi.fn().mockResolvedValue(1),
      },
      attendanceCorrectionRequest: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'acr-1', status: 'REQUESTED', ...data })),
        update: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({ id: 'acr-1', userId: 'u-1', status: 'REQUESTED', correctedType: 'CLOCK_OUT', correctedAt: new Date('2026-07-16T18:30:00Z'), targetRecordId: 'ar-1' }),
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([]),
      },
      overtimeRequest: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'ot-1', status: 'REQUESTED', ...data })),
        update: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn().mockResolvedValue({ id: 'ot-1', userId: 'u-1', status: 'REQUESTED' }),
        findMany: vi.fn().mockResolvedValue([]),
        aggregate: vi.fn().mockResolvedValue({ _sum: { hours: 6 } }),
      },
      eApprovalRelay: {
        create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'relay-1', refId: data.refId, ...data })),
        update: vi.fn().mockResolvedValue({}),
        updateMany: vi.fn().mockResolvedValue({}),
        findUnique: vi.fn(),
      },
      notification: { create: vi.fn().mockResolvedValue({}) },
      user: { findMany: vi.fn().mockResolvedValue([]) },
      leaveRequest: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    };
    const configRuntime = { get: vi.fn(async (k: string) => configMap[k] ?? null) };
    service = new EssService(mockPrisma, { enqueue: vi.fn() } as any, { get: vi.fn() } as any, configRuntime as any);
    (service as any).audit = vi.fn();
  });

  describe('근태 정정', () => {
    const dto = (over: any = {}) => ({ targetRecordId: 'ar-1', workDate: '2026-07-16', correctedType: 'CLOCK_OUT', correctedAt: '2026-07-16T18:30:00+09:00', reason: '퇴근 태그 누락', ...over });

    it('INTERNAL 상신 — 결재선·알림·REQUESTED', async () => {
      const r: any = await service.requestAttendanceCorrection('u-1', dto());
      expect(r.mode).toBe('INTERNAL');
      expect(r.approver).toBe('조간호');
      expect(mockPrisma.eApprovalRelay.create.mock.calls[0][0].data.docType).toBe('HR_ATTENDANCE_CORRECTION');
    });

    it('미래 시각 정정 400', async () => {
      await expect(service.requestAttendanceCorrection('u-1', dto({ correctedAt: '2099-01-01T09:00:00Z' }))).rejects.toThrow(/미래/);
    });

    it('자동마감 기록은 소명 10자 미만 400', async () => {
      mockPrisma.attendanceRecord.findUnique.mockResolvedValue({ id: 'ar-1', userId: 'u-1', autoClosedAt: new Date() });
      await expect(service.requestAttendanceCorrection('u-1', dto({ reason: '누락' }))).rejects.toThrow(/소명/);
    });

    it('타인 기록 정정 400', async () => {
      mockPrisma.attendanceRecord.findUnique.mockResolvedValue({ id: 'ar-1', userId: 'other', autoClosedAt: null });
      await expect(service.requestAttendanceCorrection('u-1', dto())).rejects.toThrow(/찾을 수 없습니다/);
    });

    it('승인 확정 — 원본 불변·correctionOf 신규 레코드(MANUAL)', async () => {
      await (service as any).applyCorrectionDecision('acr-1', 'APPROVED', '조간호');
      expect(mockPrisma.attendanceRecord.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ method: 'MANUAL', correctionOf: 'ar-1', type: 'CLOCK_OUT' }) }),
      );
    });

    it('종결 상태 재확정 멱등', async () => {
      mockPrisma.attendanceCorrectionRequest.findUnique.mockResolvedValue({ id: 'acr-1', status: 'APPROVED' });
      const r: any = await (service as any).applyCorrectionDecision('acr-1', 'APPROVED');
      expect(r.idempotent).toBe(true);
      expect(mockPrisma.attendanceRecord.create).not.toHaveBeenCalled();
    });
  });

  describe('초과근무', () => {
    // 고정 과거 날짜는 시간이 지나면 isPostFacto 판정이 뒤집혀 실패(2026-07-21 실측) — 항상 '오늘' 기준 상대 날짜 사용
    const TODAY = new Date().toISOString().slice(0, 10);
    const dto = (over: any = {}) => ({ workDate: TODAY, otType: 'EXTENDED', startAt: `${TODAY}T18:00:00+09:00`, endAt: `${TODAY}T20:45:00+09:00`, reason: '응급 수술 지원', ...over });

    it('시간 서버 계산 — 2.75h → 0.5 반올림 3.0h·사전 신청', async () => {
      const r: any = await service.requestOvertime('u-1', dto());
      expect(mockPrisma.overtimeRequest.create.mock.calls[0][0].data.hours).toBe(3);
      expect(mockPrisma.overtimeRequest.create.mock.calls[0][0].data.isPostFacto).toBe(false);
    });

    it('역순 시간 400·16h 초과 400', async () => {
      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      await expect(service.requestOvertime('u-1', dto({ endAt: `${TODAY}T17:00:00+09:00` }))).rejects.toThrow(/올바르지/);
      await expect(service.requestOvertime('u-1', dto({ endAt: `${tomorrow}T12:00:00+09:00` }))).rejects.toThrow(/16시간/);
    });

    it('사후 신청 + 해당일 근태 없음 → 경고 동봉', async () => {
      mockPrisma.attendanceRecord.count.mockResolvedValue(0);
      const r: any = await service.requestOvertime('u-1', dto({ workDate: '2026-07-01', startAt: '2026-07-01T18:00:00+09:00', endAt: '2026-07-01T20:00:00+09:00' }));
      expect(r.warning).toContain('출퇴근 기록이 없습니다');
      expect(mockPrisma.overtimeRequest.create.mock.calls[0][0].data.isPostFacto).toBe(true);
    });

    it('승인 주간 합계 조회', async () => {
      const h = await service.approvedOvertimeHours('u-1', new Date('2026-07-13'), new Date('2026-07-19'));
      expect(h).toBe(6);
    });
  });

  describe('decideApproval — docType 분기', () => {
    beforeEach(() => {
      mockPrisma.staff.findUnique.mockImplementation(({ where, select }: any) =>
        Promise.resolve(where?.userId === 'u-mgr' ? { id: 'mgr-1', familyName: '조', givenName: '간호' } : { id: 'st-1' }),
      );
    });

    it('HR_OVERTIME 승인 → 신청 APPROVED·relay 종결·기안자 알림', async () => {
      mockPrisma.eApprovalRelay.findUnique.mockResolvedValue({
        id: 'relay-1', docType: 'HR_OVERTIME', status: 'PENDING', refModule: 'hr.overtime_requests', refId: 'ot-1',
        title: '초과근무 EXTENDED', approvalLine: [{ order: 1, staffId: 'mgr-1', userId: 'u-mgr', role: 'APPROVE' }],
      });
      const r = await service.decideApproval('relay-1', 'u-mgr', 'APPROVED');
      expect(r.final).toBe(true);
      expect(mockPrisma.overtimeRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'APPROVED' }) }),
      );
      const notiTypes = mockPrisma.notification.create.mock.calls.map((c: any) => c[0].data.type);
      expect(notiTypes).toContain('HR_APPROVAL_RESULT');
    });

    it('HR_ATTENDANCE_CORRECTION 반려 → 정정 레코드 미생성', async () => {
      mockPrisma.eApprovalRelay.findUnique.mockResolvedValue({
        id: 'relay-1', docType: 'HR_ATTENDANCE_CORRECTION', status: 'PENDING', refModule: 'hr.attendance_corrections', refId: 'acr-1',
        title: '근태 정정', approvalLine: [{ order: 1, staffId: 'mgr-1', userId: 'u-mgr', role: 'APPROVE' }],
      });
      await service.decideApproval('relay-1', 'u-mgr', 'REJECTED', '증빙 부족');
      expect(mockPrisma.attendanceRecord.create).not.toHaveBeenCalled();
      expect(mockPrisma.attendanceCorrectionRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED' }) }),
      );
    });
  });

  describe('콜백 일반화 (CLINIC 대응)', () => {
    it('hr.overtime_requests 콜백 → 초과근무 확정 분기', async () => {
      const r: any = await service.leaveCallback({ ref: { source_module: 'hr.overtime_requests', source_ref: 'ot-1' }, status: 'APPROVED', approvalId: 'doc-1' });
      expect(r.ok).toBe(true);
      expect(mockPrisma.overtimeRequest.updateMany).toHaveBeenCalled();
      expect(mockPrisma.leaveRequest.findUnique).not.toHaveBeenCalled();
    });
  });
});
