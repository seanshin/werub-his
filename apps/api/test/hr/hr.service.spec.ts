import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HrService } from '../../src/modules/hr/hr.service';
import { NotFoundException, ConflictException } from '@nestjs/common';

describe('HrService', () => {
  let service: HrService;
  let mockPrisma: any;
  let mockOutbox: any;

  const mockStaff = { id: 's-1', employeeNumber: 'E001', familyName: '김', givenName: '간호', category: 'NURSE', department: '내과', position: '주임', status: 'ACTIVE' };

  beforeEach(() => {
    mockPrisma = {
      staff: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), groupBy: vi.fn() },
      user: { findUnique: vi.fn().mockResolvedValue({ role: 'NURSE', department: '내과' }) },
      dutyEntry: { findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValue({}), deleteMany: vi.fn().mockResolvedValue({ count: 0 }) },
      leaveRequest: { findMany: vi.fn().mockResolvedValue([]) },
    };
    mockOutbox = { enqueue: vi.fn() };
    service = new HrService(mockPrisma, mockOutbox);
  });

  describe('findAll', () => {
    it('should return active staff by default', async () => {
      mockPrisma.staff.findMany.mockResolvedValue([mockStaff]);
      const result = await service.findAll({});
      expect(result).toHaveLength(1);
      expect(mockPrisma.staff.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { status: 'ACTIVE' } }));
    });

    it('should filter by category', async () => {
      mockPrisma.staff.findMany.mockResolvedValue([]);
      await service.findAll({ category: 'MEDICAL' });
      expect(mockPrisma.staff.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ category: 'MEDICAL' }) }));
    });

    it('should filter by department', async () => {
      mockPrisma.staff.findMany.mockResolvedValue([]);
      await service.findAll({ department: '내과' });
      expect(mockPrisma.staff.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ department: expect.objectContaining({ contains: '내과' }) }) }),
      );
    });
  });

  describe('findAll – status filter', () => {
    it('should filter by explicit status', async () => {
      mockPrisma.staff.findMany.mockResolvedValue([]);
      await service.findAll({ status: 'RESIGNED' });
      expect(mockPrisma.staff.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'RESIGNED' }) }),
      );
    });

    it('should apply multiple filters together', async () => {
      mockPrisma.staff.findMany.mockResolvedValue([]);
      await service.findAll({ category: 'MEDICAL', department: '외과', status: 'ACTIVE' });
      const call = mockPrisma.staff.findMany.mock.calls[0][0];
      expect(call.where.category).toBe('MEDICAL');
      expect(call.where.department).toEqual(expect.objectContaining({ contains: '외과' }));
      expect(call.where.status).toBe('ACTIVE');
    });
  });

  describe('findById', () => {
    it('should return staff with schedules', async () => {
      mockPrisma.staff.findUnique.mockResolvedValue({ ...mockStaff, schedules: [] });
      const result = await service.findById('s-1');
      expect(result.employeeNumber).toBe('E001');
    });

    it('should throw NotFoundException', async () => {
      mockPrisma.staff.findUnique.mockResolvedValue(null);
      await expect(service.findById('s-x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByUserId', () => {
    it('should return staff by userId', async () => {
      mockPrisma.staff.findUnique.mockResolvedValue({ ...mockStaff, userId: 'u-1', schedules: [] });
      const result = await service.findByUserId('u-1');
      expect(result.userId).toBe('u-1');
      expect(mockPrisma.staff.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'u-1' } }),
      );
    });

    it('should throw NotFoundException when userId not found', async () => {
      mockPrisma.staff.findUnique.mockResolvedValue(null);
      await expect(service.findByUserId('u-x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should update staff fields', async () => {
      mockPrisma.staff.findUnique.mockResolvedValue({ ...mockStaff, schedules: [] });
      mockPrisma.staff.update.mockResolvedValue({ ...mockStaff, department: '외과' });
      const result = await service.update('s-1', { department: '외과' });
      expect(result.department).toBe('외과');
      expect(mockPrisma.staff.update).toHaveBeenCalledWith({ where: { id: 's-1' }, data: { department: '외과' } });
    });

    it('should throw NotFoundException if staff not found', async () => {
      mockPrisma.staff.findUnique.mockResolvedValue(null);
      await expect(service.update('s-x', { department: '외과' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('create', () => {
    it('should create staff', async () => {
      mockPrisma.staff.findUnique.mockResolvedValue(null);
      mockPrisma.staff.create.mockResolvedValue(mockStaff);
      const result = await service.create({ employeeNumber: 'E001', familyName: '김', givenName: '간호', category: 'NURSE' as any, department: '내과', position: '주임', hireDate: '2026-01-01' });
      expect(result.employeeNumber).toBe('E001');
    });

    it('should throw ConflictException on duplicate employee number', async () => {
      mockPrisma.staff.findUnique.mockResolvedValue(mockStaff);
      await expect(service.create({ employeeNumber: 'E001', familyName: '김', givenName: '간호', category: 'NURSE' as any, department: '내과', position: '주임', hireDate: '2026-01-01' })).rejects.toThrow(ConflictException);
    });
  });

  describe('resign', () => {
    it('should set status to RESIGNED', async () => {
      mockPrisma.staff.findUnique.mockResolvedValue(mockStaff);
      mockPrisma.staff.update.mockResolvedValue({ ...mockStaff, status: 'RESIGNED' });
      const result = await service.resign('s-1');
      expect(result.status).toBe('RESIGNED');
    });
  });

  describe('patch', () => {
    it('should update only allowed fields', async () => {
      mockPrisma.staff.findUnique.mockResolvedValue(mockStaff);
      mockPrisma.staff.update.mockResolvedValue({ ...mockStaff, department: '외과' });
      const result = await service.patch('s-1', { department: '외과', dangerousField: 'hack' });
      expect(mockPrisma.staff.update).toHaveBeenCalledWith({ where: { id: 's-1' }, data: { department: '외과' } });
    });

    it('should return unchanged if no allowed fields', async () => {
      mockPrisma.staff.findUnique.mockResolvedValue({ ...mockStaff, schedules: [] });
      const result = await service.patch('s-1', { badField: 'value' });
      expect(mockPrisma.staff.update).not.toHaveBeenCalled();
    });
  });

  describe('setSchedule (정본=DutyEntry — 모델 이원화 통합)', () => {
    const linkedStaff = { id: 's-1', userId: 'u-1', employeeNumber: 'E001', erpEmployeeCode: null, familyName: '김', givenName: '간호', department: '내과' };

    it('should rewrite duty entries per date (delete+create)', async () => {
      mockPrisma.staff.findUnique.mockResolvedValue(linkedStaff);
      const result = await service.setSchedule('s-1', [
        { date: '2026-05-19', shiftType: 'DAY' },
        { date: '2026-05-20', shiftType: 'NIGHT' },
      ]);
      expect(result.updated).toBe(2);
      expect(mockPrisma.dutyEntry.deleteMany).toHaveBeenCalledTimes(2);
      expect(mockPrisma.dutyEntry.create).toHaveBeenCalledTimes(2);
      const createArg = mockPrisma.dutyEntry.create.mock.calls[0][0].data;
      expect(createArg.staffId).toBe('u-1'); // DutyEntry.staffId = User.id
      expect(createArg.shift).toBe('DAY');
      expect(mockOutbox.enqueue).toHaveBeenCalledWith('hr', 'staff.schedule_changed', expect.any(String), expect.any(Object));
    });

    it('OFF should only delete (no create) — OFF는 저장하지 않음', async () => {
      mockPrisma.staff.findUnique.mockResolvedValue(linkedStaff);
      const result = await service.setSchedule('s-1', [{ date: '2026-05-19', shiftType: 'OFF' }]);
      expect(result.updated).toBe(1);
      expect(mockPrisma.dutyEntry.deleteMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.dutyEntry.create).not.toHaveBeenCalled();
    });

    it('should reject staff without linked User', async () => {
      mockPrisma.staff.findUnique.mockResolvedValue({ ...linkedStaff, userId: null });
      await expect(service.setSchedule('s-1', [{ date: '2026-05-19', shiftType: 'DAY' }])).rejects.toThrow();
      expect(mockPrisma.dutyEntry.create).not.toHaveBeenCalled();
    });
  });

  describe('getSchedule (DutyEntry+LeaveRequest 통합조회)', () => {
    const staffRows = [{ id: 's-1', userId: 'u-1', familyName: '김', givenName: '간호', position: '주임', department: '내과' }];

    it('should return duty entries in legacy StaffSchedule shape', async () => {
      mockPrisma.staff.findMany.mockResolvedValue(staffRows);
      mockPrisma.dutyEntry.findMany.mockResolvedValue([
        { id: 'de-1', staffId: 'u-1', date: new Date('2026-05-19'), shift: 'DAY', startTime: '09:00', endTime: '18:00', notes: null, createdAt: new Date() },
      ]);
      const result = await service.getSchedule({ dateFrom: '2026-05-01', dateTo: '2026-05-31' });
      expect(result).toHaveLength(1);
      expect(result[0].shiftType).toBe('DAY');
      expect(result[0].staffId).toBe('s-1'); // 응답은 구 계약대로 Staff.id
      expect(result[0].staff.familyName).toBe('김');
    });

    it('should derive OFF rows from approved leave', async () => {
      mockPrisma.staff.findMany.mockResolvedValue(staffRows);
      mockPrisma.dutyEntry.findMany.mockResolvedValue([]);
      mockPrisma.leaveRequest.findMany.mockResolvedValue([
        { id: 'lr-1', userId: 'u-1', fromDate: new Date('2026-05-10'), toDate: new Date('2026-05-11') },
      ]);
      const result = await service.getSchedule({ dateFrom: '2026-05-01', dateTo: '2026-05-31' });
      expect(result).toHaveLength(2);
      expect(result.every((r: any) => r.shiftType === 'OFF')).toBe(true);
    });

    it('should filter staff by id and department', async () => {
      mockPrisma.staff.findMany.mockResolvedValue([]);
      await service.getSchedule({ staffId: 's-1', department: '내과', dateFrom: '2026-05-01', dateTo: '2026-05-31' });
      const call = mockPrisma.staff.findMany.mock.calls[0][0];
      expect(call.where.id).toBe('s-1');
      expect(call.where.department).toEqual(expect.objectContaining({ contains: '내과' }));
      expect(call.where.userId).toEqual({ not: null });
    });
  });

  describe('getDepartmentList', () => {
    it('should return department with staff count', async () => {
      mockPrisma.staff.groupBy.mockResolvedValue([{ department: '내과', _count: 5 }, { department: '외과', _count: 3 }]);
      const result = await service.getDepartmentList();
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ department: '내과', staffCount: 5 });
    });
  });
});
