import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AppointmentStatus, AppointmentType } from '@prisma/client';
import { ScheduleService } from '../src/modules/schedule/schedule.service';
import { CreateAppointmentDto } from '../src/modules/schedule/dto/create-appointment.dto';
import { ChangeStatusDto } from '../src/modules/schedule/dto/change-status.dto';

describe('ScheduleService', () => {
  let service: ScheduleService;
  let prisma: any;

  const mockAppointment = {
    id: 'apt-1',
    patientId: 'patient-1',
    doctorId: 'doctor-1',
    scheduledAt: new Date('2026-05-20 10:00:00'),
    duration: 30,
    type: AppointmentType.ROUTINE,
    status: AppointmentStatus.SCHEDULED,
    reason: '정기 진료',
    notes: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const createAppointmentDto: CreateAppointmentDto = {
    patientId: 'patient-1',
    doctorId: 'doctor-1',
    scheduledAt: '2026-05-20T10:00:00Z',
    duration: 30,
    type: AppointmentType.ROUTINE,
    reason: '정기 진료',
  };

  beforeEach(() => {
    prisma = {
      appointment: {
        create: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
        findUniqueOrThrow: vi.fn(),
      },
      clinicSchedule: { findMany: vi.fn().mockResolvedValue([]) },
      clinicClosure: { findMany: vi.fn().mockResolvedValue([]) },
      // advisory lock 트랜잭션(withDoctorLock) — tx 는 동일 목을 재사용
      $executeRaw: vi.fn(),
      $queryRaw: vi.fn().mockResolvedValue([]),
      $transaction: vi.fn(async (arg: any) =>
        typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
      ),
    };
    service = new ScheduleService(prisma);
  });

  describe('create', () => {
    it('should create appointment when no conflicts exist', async () => {
      prisma.appointment.count.mockResolvedValue(0);
      prisma.appointment.create.mockResolvedValue(mockAppointment as any);

      const result = await service.create(createAppointmentDto, 'user-1');

      expect(result.appointment).toEqual(mockAppointment);
      expect(prisma.appointment.create).toHaveBeenCalled();
    });

    it('should throw error if doctor has scheduling conflict', async () => {
      // Doctor has overlapping appointment
      // createAppointmentDto is scheduled for 2026-05-20T10:00:00Z with 30 min duration (10:00-10:30)
      // conflictingAppointment is 09:30-10:30 (overlaps with new appointment)
      const conflictingAppointment = {
        ...mockAppointment,
        id: 'apt-2',
        scheduledAt: new Date('2026-05-20T09:30:00Z'), // Overlaps with 10:00-10:30
        duration: 60, // 09:30-10:30
      };
      prisma.appointment.findMany.mockResolvedValue([conflictingAppointment] as any);

      await expect(service.create(createAppointmentDto, 'user-1')).rejects.toThrow();
    });

    // Note: Past appointment validation is not currently implemented in the service
    // This test is skipped until the validation is added
    // it('should throw error if appointment is in the past', async () => {
    //   const pastDto = {
    //     ...createAppointmentDto,
    //     scheduledAt: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
    //   };
    //
    //   await expect(service.create(pastDto, 'user-1')).rejects.toThrow();
    // });
  });

  describe('findAll', () => {
    it('should return paginated appointments', async () => {
      prisma.appointment.findMany.mockResolvedValue([mockAppointment] as any);
      prisma.appointment.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
    });

    it('should filter appointments by doctor', async () => {
      prisma.appointment.findMany.mockResolvedValue([mockAppointment] as any);
      prisma.appointment.count.mockResolvedValue(1);

      await service.findAll({ doctorId: 'doctor-1' });

      const whereClause = prisma.appointment.findMany.mock.calls[0][0].where;
      expect(whereClause.AND[0]).toHaveProperty('doctorId', 'doctor-1');
    });

    it('should filter appointments by patient', async () => {
      prisma.appointment.findMany.mockResolvedValue([mockAppointment] as any);
      prisma.appointment.count.mockResolvedValue(1);

      await service.findAll({ patientId: 'patient-1' });

      const whereClause = prisma.appointment.findMany.mock.calls[0][0].where;
      expect(whereClause.AND[0]).toHaveProperty('patientId', 'patient-1');
    });

    it('should filter appointments by date range', async () => {
      prisma.appointment.findMany.mockResolvedValue([mockAppointment] as any);
      prisma.appointment.count.mockResolvedValue(1);

      await service.findAll({
        dateFrom: '2026-05-15',
        dateTo: '2026-05-25',
      });

      const whereClause = prisma.appointment.findMany.mock.calls[0][0].where;
      expect(whereClause.AND).toBeDefined();
      expect(whereClause.AND.length).toBeGreaterThan(0);
    });

    it('should filter appointments by status', async () => {
      prisma.appointment.findMany.mockResolvedValue([mockAppointment] as any);
      prisma.appointment.count.mockResolvedValue(1);

      await service.findAll({ status: AppointmentStatus.SCHEDULED });

      const whereClause = prisma.appointment.findMany.mock.calls[0][0].where;
      expect(whereClause.AND[0]).toHaveProperty('status', AppointmentStatus.SCHEDULED);
    });
  });

  describe('findById', () => {
    it('should return appointment by id', async () => {
      prisma.appointment.findUniqueOrThrow.mockResolvedValue(mockAppointment as any);

      const result = await service.findById('apt-1');

      expect(result).toEqual(mockAppointment);
    });

    it('should throw error if appointment not found', async () => {
      prisma.appointment.findUniqueOrThrow.mockRejectedValue(new Error('Not found'));

      await expect(service.findById('nonexistent')).rejects.toThrow();
    });
  });

  describe('update', () => {
    it('should update appointment', async () => {
      const updatedAppointment = {
        ...mockAppointment,
        duration: 45,
        notes: 'Updated notes',
      };
      prisma.appointment.findUniqueOrThrow.mockResolvedValue(mockAppointment as any);
      prisma.appointment.count.mockResolvedValue(0);
      prisma.appointment.update.mockResolvedValue(updatedAppointment as any);

      const result = await service.update('apt-1', { duration: 45, notes: 'Updated notes' }, 'user-1');

      expect(result.appointment.duration).toBe(45);
      expect(result.appointment.notes).toBe('Updated notes');
    });

    it('should not allow update of completed appointments', async () => {
      const completedAppointment = {
        ...mockAppointment,
        status: AppointmentStatus.COMPLETED,
      };
      prisma.appointment.findUniqueOrThrow.mockResolvedValue(completedAppointment as any);

      await expect(service.update('apt-1', { duration: 45 }, 'user-1')).rejects.toThrow();
    });

    it('should validate time conflicts when updating scheduledAt', async () => {
      prisma.appointment.findUniqueOrThrow.mockResolvedValue(mockAppointment as any);
      // Updating to 10:30-11:00, conflicting appointment is 10:45-11:15
      const conflictingAppointment = {
        ...mockAppointment,
        id: 'apt-2',
        scheduledAt: new Date('2026-05-20T10:45:00Z'),
        duration: 30,
      };
      prisma.appointment.findMany.mockResolvedValue([conflictingAppointment] as any);

      await expect(
        service.update('apt-1', { scheduledAt: '2026-05-20T10:30:00Z' }, 'user-1'),
      ).rejects.toThrow();
    });
  });

  describe('changeStatus', () => {
    it('should transition from SCHEDULED to CHECKED_IN', async () => {
      prisma.appointment.findUniqueOrThrow.mockResolvedValue(mockAppointment as any);
      const updatedAppointment = {
        ...mockAppointment,
        status: AppointmentStatus.CHECKED_IN,
      };
      prisma.appointment.update.mockResolvedValue(updatedAppointment as any);

      const result = await service.changeStatus('apt-1', { status: AppointmentStatus.CHECKED_IN }, 'user-1');

      expect(result.status).toBe(AppointmentStatus.CHECKED_IN);
    });

    it('should transition from CHECKED_IN to IN_PROGRESS', async () => {
      const checkedInAppointment = {
        ...mockAppointment,
        status: AppointmentStatus.CHECKED_IN,
      };
      prisma.appointment.findUniqueOrThrow.mockResolvedValue(checkedInAppointment as any);
      const updatedAppointment = {
        ...checkedInAppointment,
        status: AppointmentStatus.IN_PROGRESS,
      };
      prisma.appointment.update.mockResolvedValue(updatedAppointment as any);

      const result = await service.changeStatus('apt-1', { status: AppointmentStatus.IN_PROGRESS }, 'user-1');

      expect(result.status).toBe(AppointmentStatus.IN_PROGRESS);
    });

    it('should not allow invalid status transition', async () => {
      prisma.appointment.findUniqueOrThrow.mockResolvedValue(mockAppointment as any);

      // SCHEDULED -> IN_PROGRESS is invalid (must go through CHECKED_IN)
      await expect(
        service.changeStatus('apt-1', { status: AppointmentStatus.IN_PROGRESS }, 'user-1'),
      ).rejects.toThrow();
    });

    it('should allow SCHEDULED to CANCELLED', async () => {
      prisma.appointment.findUniqueOrThrow.mockResolvedValue(mockAppointment as any);
      const cancelledAppointment = {
        ...mockAppointment,
        status: AppointmentStatus.CANCELLED,
      };
      prisma.appointment.update.mockResolvedValue(cancelledAppointment as any);

      const result = await service.changeStatus('apt-1', { status: AppointmentStatus.CANCELLED }, 'user-1');

      expect(result.status).toBe(AppointmentStatus.CANCELLED);
    });

    it('should not allow COMPLETED appointment state changes', async () => {
      const completedAppointment = {
        ...mockAppointment,
        status: AppointmentStatus.COMPLETED,
      };
      prisma.appointment.findUniqueOrThrow.mockResolvedValue(completedAppointment as any);

      await expect(
        service.changeStatus('apt-1', { status: AppointmentStatus.CANCELLED }, 'user-1'),
      ).rejects.toThrow();
    });
  });

  describe('getCalendar', () => {
    it('should return week view with correct date range', async () => {
      prisma.appointment.findMany.mockResolvedValue([mockAppointment] as any);

      const result = await service.getCalendar({
        view: 'week',
        date: '2026-05-20',
      });

      expect(result.data).toHaveLength(1);
      expect(result.meta.view).toBe('week');
      expect(result.meta.start).toBeDefined();
      expect(result.meta.end).toBeDefined();
    });

    it('should return month view with correct date range', async () => {
      prisma.appointment.findMany.mockResolvedValue([mockAppointment] as any);

      const result = await service.getCalendar({
        view: 'month',
        date: '2026-05-15',
      });

      expect(result.data).toHaveLength(1);
      expect(result.meta.view).toBe('month');
    });

    it('should filter calendar by doctor', async () => {
      prisma.appointment.findMany.mockResolvedValue([mockAppointment] as any);

      await service.getCalendar({
        view: 'week',
        doctorId: 'doctor-1',
      });

      const whereClause = prisma.appointment.findMany.mock.calls[0][0].where;
      expect(whereClause).toHaveProperty('doctorId', 'doctor-1');
    });

    it('should exclude cancelled appointments from calendar', async () => {
      prisma.appointment.findMany.mockResolvedValue([]);

      await service.getCalendar({ view: 'week' });

      const whereClause = prisma.appointment.findMany.mock.calls[0][0].where;
      expect(whereClause.status.notIn).toContain(AppointmentStatus.CANCELLED);
    });
  });
});
