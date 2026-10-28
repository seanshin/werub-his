import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ClinicScheduleService } from '../../src/modules/clinic-schedule/clinic-schedule.service';
import { NotFoundException } from '@nestjs/common';

describe('ClinicScheduleService', () => {
  let service: ClinicScheduleService;
  let mockPrisma: any;

  beforeEach(() => {
    mockPrisma = {
      clinicSchedule: {
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      clinicClosure: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        delete: vi.fn(),
      },
      waitingQueue: {
        groupBy: vi.fn(),
      },
    };

    service = new ClinicScheduleService(mockPrisma);
  });

  describe('findAll', () => {
    it('should find all active schedules', async () => {
      const mockSchedules = [
        {
          id: 'sched-1',
          doctorId: 'doc-1',
          departmentName: '내과',
          roomName: '1번실',
          dayOfWeek: 1,
          period: 'AM',
          startTime: '09:00',
          endTime: '12:00',
          isActive: true,
          doctor: { id: 'doc-1', familyName: '김', givenName: '의사' },
        },
      ];

      vi.mocked(mockPrisma.clinicSchedule.findMany).mockResolvedValue(mockSchedules);

      const result = await service.findAll();

      expect(result.data).toHaveLength(1);
      expect(result.data[0].departmentName).toBe('내과');
      expect(mockPrisma.clinicSchedule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { isActive: true },
          orderBy: [
            { departmentName: 'asc' },
            { dayOfWeek: 'asc' },
            { period: 'asc' },
          ],
        }),
      );
    });
  });

  describe('findToday', () => {
    it('should find today schedules with correct period', async () => {
      const now = new Date();
      const dayOfWeek = now.getDay();
      const hour = now.getHours();
      const expectedPeriod = hour < 13 ? 'AM' : 'PM';

      const mockSchedules = [
        {
          id: 'sched-1',
          doctorId: 'doc-1',
          departmentName: '내과',
          period: expectedPeriod,
          doctor: { id: 'doc-1', familyName: '김', givenName: '의사' },
        },
      ];

      vi.mocked(mockPrisma.clinicClosure.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.clinicSchedule.findMany).mockResolvedValue(mockSchedules);
      vi.mocked(mockPrisma.waitingQueue.groupBy).mockResolvedValue([]);

      const result = await service.findToday();

      expect(result.data).toHaveLength(1);
      expect(result.data[0].waitingCount).toBe(0);
      expect(mockPrisma.clinicSchedule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            dayOfWeek,
            isActive: true,
          }),
        }),
      );
    });

    it('should filter by department', async () => {
      vi.mocked(mockPrisma.clinicClosure.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.clinicSchedule.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.waitingQueue.groupBy).mockResolvedValue([]);

      await service.findToday('내과');

      expect(mockPrisma.clinicSchedule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            departmentName: '내과',
          }),
        }),
      );
    });

    it('should exclude closed doctors', async () => {
      const mockClosures = [
        { doctorId: 'doc-1', period: 'AM' },
        { doctorId: 'doc-2', period: null },
      ];

      const mockSchedules = [
        { id: 'sched-3', doctorId: 'doc-3', doctor: {} },
      ];

      vi.mocked(mockPrisma.clinicClosure.findMany).mockResolvedValue(mockClosures);
      vi.mocked(mockPrisma.clinicSchedule.findMany).mockResolvedValue(mockSchedules);
      vi.mocked(mockPrisma.waitingQueue.groupBy).mockResolvedValue([]);

      await service.findToday();

      expect(mockPrisma.clinicSchedule.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            doctorId: { notIn: ['doc-1', 'doc-2'] },
          }),
        }),
      );
    });

    it('should add waiting count for each doctor', async () => {
      const mockSchedules = [
        { id: 'sched-1', doctorId: 'doc-1', doctor: {} },
        { id: 'sched-2', doctorId: 'doc-2', doctor: {} },
      ];

      const mockWaitingCounts = [
        { doctorId: 'doc-1', _count: 3 },
      ];

      vi.mocked(mockPrisma.clinicClosure.findMany).mockResolvedValue([]);
      vi.mocked(mockPrisma.clinicSchedule.findMany).mockResolvedValue(mockSchedules);
      vi.mocked(mockPrisma.waitingQueue.groupBy).mockResolvedValue(mockWaitingCounts);

      const result = await service.findToday();

      expect(result.data[0].waitingCount).toBe(3);
      expect(result.data[1].waitingCount).toBe(0);
    });
  });

  describe('findWeek', () => {
    it('should group schedules by doctor', async () => {
      const mockSchedules = [
        {
          id: 'sched-1',
          doctorId: 'doc-1',
          departmentName: '내과',
          roomName: '1번실',
          dayOfWeek: 1,
          period: 'AM',
          startTime: '09:00',
          endTime: '12:00',
          maxPatients: 20,
          doctor: { id: 'doc-1', familyName: '김', givenName: '의사' },
        },
        {
          id: 'sched-2',
          doctorId: 'doc-1',
          departmentName: '내과',
          roomName: '1번실',
          dayOfWeek: 2,
          period: 'PM',
          startTime: '13:00',
          endTime: '17:00',
          maxPatients: 20,
          doctor: { id: 'doc-1', familyName: '김', givenName: '의사' },
        },
      ];

      vi.mocked(mockPrisma.clinicSchedule.findMany).mockResolvedValue(mockSchedules);

      const result = await service.findWeek();

      expect(result.data).toHaveLength(1);
      expect(result.data[0].doctor.familyName).toBe('김');
      expect(result.data[0].slots).toHaveLength(2);
      expect(result.data[0].slots[0].dayOfWeek).toBe(1);
      expect(result.data[0].slots[1].dayOfWeek).toBe(2);
    });

    it('should include slot details', async () => {
      const mockSchedules = [
        {
          id: 'sched-1',
          doctorId: 'doc-1',
          departmentName: '내과',
          roomName: '1번실',
          dayOfWeek: 1,
          period: 'AM',
          startTime: '09:00',
          endTime: '12:00',
          maxPatients: 20,
          doctor: { id: 'doc-1', familyName: '김', givenName: '의사' },
        },
      ];

      vi.mocked(mockPrisma.clinicSchedule.findMany).mockResolvedValue(mockSchedules);

      const result = await service.findWeek();

      expect(result.data[0].slots[0]).toEqual({
        id: 'sched-1',
        dayOfWeek: 1,
        period: 'AM',
        startTime: '09:00',
        endTime: '12:00',
        maxPatients: 20,
      });
    });
  });

  describe('create', () => {
    it('should create new schedule', async () => {
      const mockCreated = {
        id: 'sched-1',
        doctorId: 'doc-1',
        departmentName: '내과',
        roomName: '1번실',
        dayOfWeek: 1,
        period: 'AM',
        startTime: '09:00',
        endTime: '12:00',
      };

      vi.mocked(mockPrisma.clinicSchedule.create).mockResolvedValue(mockCreated);

      const dto = {
        doctorId: 'doc-1',
        departmentName: '내과',
        roomName: '1번실',
        dayOfWeek: 1,
        period: 'AM',
        startTime: '09:00',
        endTime: '12:00',
        maxPatients: 20,
      };

      const result = await service.create(dto);

      expect(result.data.departmentName).toBe('내과');
      expect(mockPrisma.clinicSchedule.create).toHaveBeenCalledWith({
        data: dto,
      });
    });
  });

  describe('update', () => {
    it('should update schedule fields', async () => {
      const mockUpdated = {
        id: 'sched-1',
        departmentName: '외과',
        roomName: '2번실',
        startTime: '10:00',
        endTime: '13:00',
        maxPatients: 15,
      };

      vi.mocked(mockPrisma.clinicSchedule.update).mockResolvedValue(mockUpdated);

      const dto = {
        departmentName: '외과',
        roomName: '2번실',
        startTime: '10:00',
        endTime: '13:00',
        maxPatients: 15,
      };

      const result = await service.update('sched-1', dto);

      expect(result.data.departmentName).toBe('외과');
      expect(mockPrisma.clinicSchedule.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sched-1' },
          data: dto,
        }),
      );
    });

    it('should allow partial update', async () => {
      vi.mocked(mockPrisma.clinicSchedule.update).mockResolvedValue({
        id: 'sched-1',
        isActive: false,
      });

      await service.update('sched-1', { isActive: false });

      expect(mockPrisma.clinicSchedule.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { isActive: false },
        }),
      );
    });
  });

  describe('delete', () => {
    it('should delete schedule', async () => {
      vi.mocked(mockPrisma.clinicSchedule.delete).mockResolvedValue({});

      const result = await service.delete('sched-1');

      expect(result.data.success).toBe(true);
      expect(mockPrisma.clinicSchedule.delete).toHaveBeenCalledWith({
        where: { id: 'sched-1' },
      });
    });
  });

  describe('findClosures', () => {
    it('should find all closures', async () => {
      const mockClosures = [
        {
          id: 'closure-1',
          doctorId: 'doc-1',
          date: new Date('2026-05-20'),
          period: 'AM',
          reason: '학회참석',
          doctor: { id: 'doc-1', familyName: '김', givenName: '의사' },
          substitute: null,
        },
      ];

      vi.mocked(mockPrisma.clinicClosure.findMany).mockResolvedValue(mockClosures);

      const result = await service.findClosures();

      expect(result.data).toHaveLength(1);
      expect(result.data[0].reason).toBe('학회참석');
      expect(mockPrisma.clinicClosure.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
        }),
      );
    });

    it('should filter closures by date', async () => {
      vi.mocked(mockPrisma.clinicClosure.findMany).mockResolvedValue([]);

      await service.findClosures('2026-05-20');

      expect(mockPrisma.clinicClosure.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { date: expect.any(Date) },
        }),
      );
    });
  });

  describe('createClosure', () => {
    it('should create clinic closure', async () => {
      const mockCreated = {
        id: 'closure-1',
        doctorId: 'doc-1',
        date: new Date('2026-05-20'),
        period: 'AM',
        reason: '휴가',
        substituteId: null,
      };

      vi.mocked(mockPrisma.clinicClosure.create).mockResolvedValue(mockCreated);

      const dto = {
        doctorId: 'doc-1',
        date: '2026-05-20',
        period: 'AM',
        reason: '휴가',
      };

      const result = await service.createClosure(dto);

      expect(result.data.reason).toBe('휴가');
      expect(mockPrisma.clinicClosure.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            doctorId: 'doc-1',
            reason: '휴가',
          }),
        }),
      );
    });

    it('should handle optional substitute', async () => {
      vi.mocked(mockPrisma.clinicClosure.create).mockResolvedValue({
        id: 'closure-1',
        substituteId: 'doc-2',
      });

      await service.createClosure({
        doctorId: 'doc-1',
        date: '2026-05-20',
        reason: '휴가',
        substituteId: 'doc-2',
      });

      expect(mockPrisma.clinicClosure.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            substituteId: 'doc-2',
          }),
        }),
      );
    });

    it('should handle null period', async () => {
      vi.mocked(mockPrisma.clinicClosure.create).mockResolvedValue({
        id: 'closure-1',
        period: null,
      });

      await service.createClosure({
        doctorId: 'doc-1',
        date: '2026-05-20',
        reason: '휴가',
      });

      expect(mockPrisma.clinicClosure.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            period: null,
          }),
        }),
      );
    });
  });

  describe('deleteClosure', () => {
    it('should delete closure', async () => {
      vi.mocked(mockPrisma.clinicClosure.findUnique).mockResolvedValue({
        id: 'closure-1',
      });
      vi.mocked(mockPrisma.clinicClosure.delete).mockResolvedValue({});

      const result = await service.deleteClosure('closure-1');

      expect(result.data.success).toBe(true);
      expect(mockPrisma.clinicClosure.delete).toHaveBeenCalledWith({
        where: { id: 'closure-1' },
      });
    });

    it('should throw NotFoundException if closure not found', async () => {
      vi.mocked(mockPrisma.clinicClosure.findUnique).mockResolvedValue(null);

      await expect(service.deleteClosure('non-existent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
